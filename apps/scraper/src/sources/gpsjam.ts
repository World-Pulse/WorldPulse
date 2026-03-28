/**
 * GPS Jamming Signal Source
 *
 * Polls GPSJam.org's public API for GPS interference hotspots every 15 minutes.
 * Detects regions with high GPS jamming probability (>= 0.6 on their 0–1 scale).
 * No API key required — fully open data.
 *
 * API: https://gpsjam.org/api/jam?z=2
 * Returns GeoJSON FeatureCollection where each cell has a `jamPct` probability.
 *
 * Counters Shadowbroker's GPS jamming tracking advantage.
 * Severity: jamPct >= 0.9 → high, >= 0.7 → medium, else → low
 * Reliability: 0.78 (inferred from ADS-B crowdsource data)
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'gpsjam-source' })

// GPSJam API requires a date param (YYYY-MM-DD). Without it the endpoint returns HTML.
// We use yesterday's date since today's data may not be fully processed yet.
function gpsjamApiUrl(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  const date = d.toISOString().slice(0, 10)
  return `https://gpsjam.org/api/jam?z=2&date=${date}`
}

// ─── API TYPES ──────────────────────────────────────────────────────────────
interface GpsJamProperties {
  jamPct: number        // 0.0 – 1.0 jamming probability
  name?:  string        // optional region name
}

interface GpsJamGeometry {
  type:        'Polygon' | 'Point'
  coordinates: unknown
}

interface GpsJamFeature {
  type:       'Feature'
  id?:        string
  properties: GpsJamProperties
  geometry:   GpsJamGeometry
}

interface GpsJamFeatureCollection {
  type:     'FeatureCollection'
  features: GpsJamFeature[]
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
    req.on('timeout', () => { req.destroy(); reject(new Error('GPSJam request timeout')) })
  })
}

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────
export function gpsjamSeverity(jamPct: number): SignalSeverity {
  if (jamPct >= 0.9) return 'high'
  if (jamPct >= 0.7) return 'medium'
  return 'low'
}

/**
 * Extract the centroid of a GeoJSON polygon or point geometry for DB insertion.
 * For polygons, approximates centroid as average of exterior ring coordinates.
 */
function extractCentroid(geometry: GpsJamGeometry): [number, number] | null {
  try {
    if (geometry.type === 'Point') {
      const coords = geometry.coordinates as [number, number]
      return coords
    }
    if (geometry.type === 'Polygon') {
      const ring = (geometry.coordinates as [number, number][][])[0]
      if (!ring || ring.length === 0) return null
      const lng = ring.reduce((sum, c) => sum + c[0], 0) / ring.length
      const lat = ring.reduce((sum, c) => sum + c[1], 0) / ring.length
      return [lng, lat]
    }
  } catch {
    // ignore parse errors
  }
  return null
}

/**
 * Build a stable dedup key from a grid cell: round to 1° precision.
 * GPSJam updates every ~15 minutes; we dedup for 2 hours to avoid flood.
 */
function cellDedupKey(lng: number, lat: number): string {
  const lngR = Math.round(lng)
  const latR = Math.round(lat)
  return `gpsjam:dedup:${lngR}:${latR}`
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────
export function startGpsJamPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.GPSJAM_INTERVAL_MS ?? 15 * 60_000) // 15 min default
  const MIN_JAM_PCT = Number(process.env.GPSJAM_MIN_PCT ?? 0.6)             // threshold
  const MAX_SIGNALS = Number(process.env.GPSJAM_MAX_SIGNALS ?? 10)          // cap per poll

  async function poll(): Promise<void> {
    try {
      log.debug('Polling GPSJam feed...')
      const raw  = await httpsGet(gpsjamApiUrl())
      const data = JSON.parse(raw) as GpsJamFeatureCollection

      const features = (data.features ?? [])
        .filter(f => (f.properties?.jamPct ?? 0) >= MIN_JAM_PCT)
        // Sort descending by jamming intensity — most severe first
        .sort((a, b) => b.properties.jamPct - a.properties.jamPct)
        .slice(0, MAX_SIGNALS)

      if (features.length === 0) {
        log.debug('GPSJam: no hotspots above threshold')
        return
      }

      let created = 0

      for (const feature of features) {
        const { jamPct, name } = feature.properties
        const centroid = extractCentroid(feature.geometry)
        if (!centroid) continue

        const [lng, lat] = centroid
        const key  = cellDedupKey(lng, lat)
        const seen = await redis.get(key)
        if (seen) continue

        const severity    = gpsjamSeverity(jamPct)
        const pctLabel    = Math.round(jamPct * 100)
        const regionLabel = name ?? `${lat.toFixed(1)}°, ${lng.toFixed(1)}°`
        const signalTitle = `GPS Jamming Detected — ${regionLabel} (${pctLabel}% probability)`
        const summary = [
          `GPSJam.org reports ${pctLabel}% jamming probability near ${regionLabel}.`,
          'GPS interference detected via crowdsourced ADS-B receiver anomaly analysis.',
          'Possible causes: military electronic warfare, testing, or spoofing activity.',
          'Source: GPSJam.org open data.',
        ].join(' ')

        try {
          const signal = await insertAndCorrelate({
            title:             signalTitle.slice(0, 500),
            summary,
            category:          'technology',
            severity,
            status:            'pending',
            reliability_score: 0.78,
            source_count:      1,
            source_ids:        [],
            original_urls:     ['https://gpsjam.org/'],
            location:          db.raw('ST_MakePoint(?, ?)', [lng, lat]),
            location_name:     regionLabel,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'gps', 'jamming', 'electronic-warfare', 'gpsjam'],
            language:          'en',
            event_time:        new Date(),
          }, { lat, lng, sourceId: 'gpsjam' })

          // Dedup for 2 hours — GPSJam updates frequently but we don't want duplicates per cell
          await redis.setex(key, 2 * 3_600, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'technology',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'technology', severity },
                }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, key }, 'GPS jamming signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, total: features.length }, 'GPSJam: signals created')
      } else {
        log.debug({ total: features.length }, 'GPSJam poll complete (no new hotspots)')
      }
    } catch (err) {
      log.warn({ err }, 'GPSJam poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS, minJamPct: MIN_JAM_PCT }, 'GPS Jamming poller started (GPSJam.org)')

  return () => {
    clearInterval(timer)
    log.info('GPS Jamming poller stopped')
  }
}
