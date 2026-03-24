/**
 * USGS Earthquake Signal Source
 *
 * Polls the USGS Earthquake Hazards Program GeoJSON feed every 5 minutes for
 * significant earthquakes (magnitude >= 4.5). Creates WorldPulse signals for
 * seismic events.
 *
 * API: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson
 * Free, no API key required, updated in real-time.
 *
 * Counters Shadowbroker's seismic feed advantage.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'

const log = rootLogger.child({ module: 'seismic-source' })

const USGS_API =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson'

// ─── API TYPES ──────────────────────────────────────────────────────────────
interface UsgsProperties {
  mag:   number
  place: string
  time:  number   // epoch ms
  title: string
}

interface UsgsGeometry {
  type:        'Point'
  coordinates: [number, number, number]  // [lng, lat, depth_km]
}

interface UsgsFeature {
  type:       'Feature'
  id:         string
  properties: UsgsProperties
  geometry:   UsgsGeometry
}

interface UsgsFeatureCollection {
  type:     'FeatureCollection'
  features: UsgsFeature[]
}

// ─── HTTP HELPER ────────────────────────────────────────────────────────────
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 15_000,
      headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('USGS request timeout')) })
  })
}

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────
export function seismicSeverity(mag: number): SignalSeverity {
  if (mag >= 7.0) return 'critical'
  if (mag >= 6.0) return 'high'
  if (mag >= 5.0) return 'medium'
  return 'low'
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────
export function startSeismicPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.SEISMIC_INTERVAL_MS ?? 5 * 60_000) // 5 min default

  async function poll(): Promise<void> {
    try {
      log.debug('Polling USGS seismic feed...')
      const raw  = await httpsGet(USGS_API)
      const data = JSON.parse(raw) as UsgsFeatureCollection

      const features = data.features ?? []
      if (features.length === 0) {
        log.debug('Seismic: no features returned')
        return
      }

      let created = 0

      for (const feature of features) {
        const { mag, place, time, title } = feature.properties
        if (mag < 4.5) continue

        const key  = `seismic:dedup:${feature.id}`
        const seen = await redis.get(key)
        if (seen) continue

        const severity = seismicSeverity(mag)
        const lng      = feature.geometry.coordinates[0]
        const lat      = feature.geometry.coordinates[1]
        const depth    = feature.geometry.coordinates[2]

        // Build a clean title from mag + place (USGS title field is already like "M6.2 - Turkey")
        const signalTitle = title ?? `M${mag.toFixed(1)} Earthquake — ${place}`

        const summary = [
          `Magnitude ${mag.toFixed(1)} earthquake detected ${place}.`,
          `Depth: ${depth.toFixed(1)} km.`,
          'Source: USGS Earthquake Hazards Program.',
        ].join(' ')

        try {
          const [signal] = await db('signals').insert({
            title:             signalTitle.slice(0, 500),
            summary,
            category:          'disaster',
            severity,
            status:            'pending',
            reliability_score: 0.95, // USGS is authoritative sensor data
            source_count:      1,
            source_ids:        [],
            original_urls:     [`https://earthquake.usgs.gov/earthquakes/eventpage/${feature.id}`],
            location:          db.raw('ST_MakePoint(?, ?)', [lng, lat]),
            location_name:     place,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'seismic', 'earthquake', 'usgs'],
            language:          'en',
            event_time:        new Date(time),
          }).returning('*')

          // Dedup for 48h (earthquakes don't repeat on same event ID)
          await redis.setex(key, 48 * 3_600, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'disaster',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'disaster', severity },
                }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, id: feature.id }, 'Seismic signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, total: features.length }, 'Seismic: signals created')
      } else {
        log.debug({ total: features.length }, 'Seismic poll complete (no new events)')
      }
    } catch (err) {
      log.warn({ err }, 'Seismic poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'Seismic poller started (USGS)')

  return () => {
    clearInterval(timer)
    log.info('Seismic poller stopped')
  }
}
