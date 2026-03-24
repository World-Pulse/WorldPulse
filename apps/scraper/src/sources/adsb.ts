/**
 * ADS-B / Aircraft Tracking Signal Source
 *
 * Polls the OpenSky Network anonymous API every 5 minutes for aircraft
 * transmitting emergency squawk codes. Creates WorldPulse signals for:
 *   - 7700: General emergency
 *   - 7600: Radio failure
 *   - 7500: Hijacking
 *
 * OpenSky Network: https://opensky-network.org/api/states/all
 * Free, anonymous access (no auth required). Returns up to 400 random aircraft.
 *
 * Counters Shadowbroker's ADS-B flight tracking advantage.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { Category, SignalSeverity } from '@worldpulse/types'

const log = rootLogger.child({ module: 'adsb-source' })

const OPENSKY_API = 'https://opensky-network.org/api/states/all'

// Emergency squawk code metadata
const SQUAWK_INFO: Record<string, { description: string; severity: SignalSeverity; category: Category }> = {
  '7500': { description: 'Unlawful interference (hijacking)',   severity: 'critical', category: 'security' },
  '7600': { description: 'Radio communication failure',         severity: 'medium',   category: 'security' },
  '7700': { description: 'General emergency',                   severity: 'high',     category: 'disaster' },
}

// OpenSky state vector — positional index map
// [icao24, callsign, origin_country, time_position, last_contact,
//  longitude, latitude, baro_altitude, on_ground, velocity,
//  true_track, vertical_rate, sensors, geo_altitude, squawk,
//  spi, position_source]
const IDX = {
  ICAO24:         0,
  CALLSIGN:       1,
  ORIGIN_COUNTRY: 2,
  LONGITUDE:      5,
  LATITUDE:       6,
  BARO_ALTITUDE:  7,
  ON_GROUND:      8,
  SQUAWK:         14,
} as const

interface OpenSkyResponse {
  time:   number
  states: Array<Array<string | number | boolean | null>>
}

// ─── HTTP HELPER ───────────────────────────────────────────────────────────
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20_000,
      headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    }, (res) => {
      // OpenSky returns 429 when rate limited
      if (res.statusCode === 429) {
        reject(new Error('OpenSky rate limited (429)'))
        res.resume()
        return
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenSky request timeout')) })
  })
}

// ─── REDIS DEDUP KEY ────────────────────────────────────────────────────────
// Dedup key includes icao24 + squawk: same aircraft/squawk combination
// Only alert once per hour (to avoid spamming for persistent squawk codes)
function dedupKey(icao24: string, squawk: string): string {
  const hour = Math.floor(Date.now() / 3_600_000)
  return `osint:adsb:${icao24}:${squawk}:${hour}`
}

// ─── MAIN POLLER ───────────────────────────────────────────────────────────
export function startAdsbPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.ADSB_INTERVAL_MS ?? 5 * 60_000) // 5 min default

  async function poll(): Promise<void> {
    try {
      log.debug('Polling OpenSky ADS-B...')
      const raw = await httpsGet(OPENSKY_API)
      const data: OpenSkyResponse = JSON.parse(raw)

      if (!data.states?.length) {
        log.debug('ADS-B: no states returned')
        return
      }

      // Filter for emergency squawk codes on airborne aircraft
      const emergencies = data.states.filter((state) => {
        const squawk   = state[IDX.SQUAWK] as string | null
        const onGround = state[IDX.ON_GROUND] as boolean
        return squawk != null && squawk in SQUAWK_INFO && !onGround
      })

      let created = 0

      for (const state of emergencies) {
        const icao24   = String(state[IDX.ICAO24]   ?? '').trim()
        const callsign = String(state[IDX.CALLSIGN] ?? '').trim() || 'UNKNOWN'
        const country  = String(state[IDX.ORIGIN_COUNTRY] ?? 'Unknown')
        const squawk   = String(state[IDX.SQUAWK] ?? '')
        const lng      = state[IDX.LONGITUDE] as number | null
        const lat      = state[IDX.LATITUDE]  as number | null

        const info = SQUAWK_INFO[squawk]
        if (!info) continue

        const key = dedupKey(icao24, squawk)
        const seen = await redis.get(key)
        if (seen) continue

        const title = `Aircraft ${callsign} squawking ${squawk} — ${info.description} (${country})`

        try {
          const [signal] = await db('signals').insert({
            title:             title.slice(0, 500),
            summary:           [
              `Aircraft ${callsign} (ICAO: ${icao24}) from ${country}`,
              `is transmitting squawk code ${squawk}: ${info.description}.`,
              lat != null && lng != null ? `Last position: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E` : '',
              'Source: OpenSky Network (ADS-B telemetry)',
            ].filter(Boolean).join(' '),
            category:          info.category,
            severity:          info.severity,
            status:            'pending',
            reliability_score: 0.70,  // ADS-B telemetry is reliable data
            source_count:      1,
            source_ids:        [],
            original_urls:     [`https://opensky-network.org/aircraft-profile?icao24=${icao24}`],
            location:          lat != null && lng != null
              ? db.raw('ST_MakePoint(?, ?)', [lng, lat])
              : null,
            location_name:     country,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'adsb', 'aviation', `squawk-${squawk}`],
            language:          'en',
            event_time:        new Date(),
          }).returning('*')

          // Dedup for 1 hour (TTL = 3600)
          await redis.setex(key, 3_600, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   info.category,
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: info.category, severity: info.severity },
                }),
              }],
            }).catch(() => {})
          }
        } catch (err) {
          log.debug({ err, icao24 }, 'ADS-B signal insert skipped')
        }
      }

      if (created > 0) {
        log.info({ created, emergencies: emergencies.length }, 'ADS-B: emergency signals created')
      } else {
        log.debug({ total: data.states.length, emergencies: emergencies.length }, 'ADS-B poll complete (no new emergencies)')
      }
    } catch (err) {
      log.warn({ err }, 'ADS-B poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'ADS-B poller started (OpenSky Network)')

  return () => {
    clearInterval(timer)
    log.info('ADS-B poller stopped')
  }
}
