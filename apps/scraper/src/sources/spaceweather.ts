/**
 * NOAA Space Weather Alert Signal Source
 *
 * Polls the NOAA Space Weather Prediction Center alerts API every 10 minutes
 * for geomagnetic storms, solar radiation storms, and radio blackout events.
 * Creates WorldPulse signals for significant space weather events.
 *
 * API: https://services.swpc.noaa.gov/products/alerts.json
 * Free, no API key required, real-time updates.
 *
 * Counters Shadowbroker's space weather feed advantage.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'spaceweather-source' })

const NOAA_ALERTS_API = 'https://services.swpc.noaa.gov/products/alerts.json'

// Maximum age of alerts to process (3 hours)
const MAX_AGE_MS = 3 * 60 * 60 * 1_000

// ─── API TYPES ──────────────────────────────────────────────────────────────
interface NoaaAlert {
  product_id:     string
  issue_datetime: string   // "2026-03-22 14:35:00.000"
  message:        string
  serial_number?: string
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
    req.on('timeout', () => { req.destroy(); reject(new Error('NOAA space weather request timeout')) })
  })
}

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────
// G = Geomagnetic, R = Radio blackout, S = Solar radiation storm
// Scale levels 1-5, where 5 is most severe
const SCALE_CRITICAL = /\b(G5|R5|S5)\b/
const SCALE_HIGH     = /\b(G4|R4|S4)\b/
const SCALE_MEDIUM   = /\b(G3|R3|S3)\b/

export function spaceWeatherSeverity(message: string): SignalSeverity {
  if (SCALE_CRITICAL.test(message)) return 'critical'
  if (SCALE_HIGH.test(message))     return 'high'
  if (SCALE_MEDIUM.test(message))   return 'medium'
  return 'low'
}

// ─── ALERT FILTER ───────────────────────────────────────────────────────────
const RELEVANT_KEYWORDS = /GEOMAGNETIC STORM|SOLAR RADIATION STORM|RADIO BLACKOUT/i

export function isRelevantAlert(alert: NoaaAlert, now: Date): boolean {
  if (!RELEVANT_KEYWORDS.test(alert.message)) return false

  // Parse issue_datetime: "2026-03-22 14:35:00.000"
  const issued = new Date(alert.issue_datetime.replace(' ', 'T') + 'Z')
  if (isNaN(issued.getTime())) return false
  if (now.getTime() - issued.getTime() > MAX_AGE_MS) return false

  return true
}

// ─── ALERT TITLE EXTRACTION ─────────────────────────────────────────────────
// Use the first non-empty line of the alert message as the title.
export function extractAlertTitle(message: string): string {
  const lines = message.split('\n').map(l => l.trim()).filter(Boolean)
  return lines[0] ?? 'Space Weather Alert'
}

// ─── DEDUP KEY ──────────────────────────────────────────────────────────────
// Use serial_number if available, otherwise fall back to product_id
function dedupKey(alert: NoaaAlert): string {
  const id = alert.serial_number ?? alert.product_id
  return `spaceweather:dedup:${id}`
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────
export function startSpaceWeatherPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.SPACEWEATHER_INTERVAL_MS ?? 10 * 60_000) // 10 min default

  async function poll(): Promise<void> {
    try {
      log.debug('Polling NOAA space weather alerts...')
      let raw: string
      try {
        raw = await fetchWithResilience(
          'spaceweather',
          'Space Weather',
          NOAA_ALERTS_API,
          () => httpsGet(NOAA_ALERTS_API),
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }
      const alerts = JSON.parse(raw) as NoaaAlert[]

      if (!Array.isArray(alerts) || alerts.length === 0) {
        log.debug('Space weather: no alerts returned')
        return
      }

      const now      = new Date()
      const relevant = alerts.filter(a => isRelevantAlert(a, now))

      if (relevant.length === 0) {
        log.debug({ total: alerts.length }, 'Space weather: no relevant recent alerts')
        return
      }

      let created = 0

      for (const alert of relevant) {
        const key  = dedupKey(alert)
        const seen = await redis.get(key)
        if (seen) continue

        const severity = spaceWeatherSeverity(alert.message)
        const title    = extractAlertTitle(alert.message).slice(0, 500)
        const body     = alert.message.slice(0, 300)

        const issued = new Date(alert.issue_datetime.replace(' ', 'T') + 'Z')

        try {
          const signal = await insertAndCorrelate({
            title,
            summary:           body,
            category:          'climate',
            severity,
            status:            'pending',
            reliability_score: 0.90, // NOAA is authoritative source
            source_count:      1,
            source_ids:        [],
            original_urls:     ['https://www.swpc.noaa.gov/'],
            // Space weather is global — no precise lat/lng
            location:          db.raw('ST_MakePoint(?, ?)', [0, 0]),
            location_name:     'Global',
            country_code:      null,
            region:            null,
            tags:              ['osint', 'spaceweather', 'noaa', 'geomagnetic'],
            language:          'en',
            event_time:        issued,
          }, { lat: null, lng: null, sourceId: 'spaceweather' })

          // Dedup for 24h (alerts don't repeat with same serial)
          await redis.setex(key, 24 * 3_600, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'climate',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'climate', severity },
                }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, product_id: alert.product_id }, 'Space weather signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, relevant: relevant.length }, 'Space weather: signals created')
      } else {
        log.debug({ relevant: relevant.length }, 'Space weather poll complete (no new alerts)')
      }
    } catch (err) {
      log.warn({ err }, 'Space weather poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'Space weather poller started (NOAA SWPC)')

  return () => {
    clearInterval(timer)
    log.info('Space weather poller stopped')
  }
}
