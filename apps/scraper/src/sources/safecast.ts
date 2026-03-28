/**
 * Safecast Radiation Monitoring Signal Source
 *
 * Polls the Safecast API every 30 minutes for environmental radiation
 * measurements that exceed normal background levels. Creates WorldPulse
 * signals for radiation anomalies detected by the global crowdsourced
 * sensor network.
 *
 * API: https://api.safecast.org/measurements.json (free, no auth required)
 * Safecast is the world's largest open environmental radiation monitoring network.
 *
 * Reliability: 0.75 (crowdsourced sensor data — high volume but variable quality)
 * Category: science
 *
 * Closes competitive gap vs Crucix — radiation monitoring is one of Crucix's feeds.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'safecast-source' })

const SAFECAST_API_URL = 'https://api.safecast.org/measurements.json'
const RELIABILITY      = 0.75
const DEDUP_TTL_S      = 24 * 3_600  // 24-hour dedup

// Normal background radiation: ~0.05–0.20 µSv/h
// Alert thresholds (in CPM, roughly 1 CPM ≈ 0.0057 µSv/h for common sensors)
const CPM_ELEVATED  = 100   // ~0.57 µSv/h — notably above background
const CPM_HIGH      = 350   // ~2.0 µSv/h  — concerning
const CPM_CRITICAL  = 1000  // ~5.7 µSv/h  — immediate concern

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

export function radiationSeverity(cpm: number): SignalSeverity {
  if (cpm >= CPM_CRITICAL) return 'critical'
  if (cpm >= CPM_HIGH)     return 'high'
  if (cpm >= CPM_ELEVATED) return 'medium'
  return 'low'
}

// ─── LOCATION INFERENCE ─────────────────────────────────────────────────────

function formatLocation(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lng).toFixed(2)}°${lngDir}`
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────

export function startSafecastPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.SAFECAST_INTERVAL_MS ?? 30 * 60_000)

  async function poll(): Promise<void> {
    try {
      log.debug('Polling Safecast radiation measurements API...')

      // Fetch recent measurements with elevated CPM
      const since = new Date(Date.now() - 6 * 3_600_000).toISOString()

      const params = new URLSearchParams({
        since:          since,
        order:          'captured_at desc',
        per_page:       '200',
      })

      const safecastUrl = `${SAFECAST_API_URL}?${params.toString()}`
      let measurements: SafecastMeasurement[]
      try {
        measurements = await fetchWithResilience(
          'safecast',
          'Safecast',
          safecastUrl,
          async () => {
            const res = await fetch(safecastUrl, {
              headers: {
                'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)',
                'Accept':     'application/json',
              },
              signal: AbortSignal.timeout(30_000),
            })
            if (!res.ok) throw Object.assign(new Error(`Safecast: HTTP ${res.status}`), { statusCode: res.status })
            return res.json() as Promise<SafecastMeasurement[]>
          },
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }

      if (!Array.isArray(measurements) || measurements.length === 0) {
        log.debug('Safecast: no measurements returned')
        return
      }

      // Filter to only elevated readings
      const elevated = measurements.filter(m => (m.value ?? 0) >= CPM_ELEVATED)

      if (elevated.length === 0) {
        log.debug({ total: measurements.length }, 'Safecast: no elevated readings')
        return
      }

      // Aggregate nearby readings into 1° grid cells to avoid spam
      const gridCells = new Map<string, {
        maxCpm:   number
        count:    number
        lat:      number
        lng:      number
        capturedAt: string
      }>()

      for (const m of elevated) {
        const lat = Number(m.latitude)  || 0
        const lng = Number(m.longitude) || 0
        const cpm = Number(m.value)     || 0

        if (lat === 0 && lng === 0) continue

        const gridKey = `${Math.floor(lat)}_${Math.floor(lng)}`
        const existing = gridCells.get(gridKey)

        if (!existing || cpm > existing.maxCpm) {
          gridCells.set(gridKey, {
            maxCpm:     cpm,
            count:      (existing?.count ?? 0) + 1,
            lat:        lat,
            lng:        lng,
            capturedAt: m.captured_at || new Date().toISOString(),
          })
        } else {
          existing.count++
        }
      }

      let created = 0

      for (const [gridKey, cell] of gridCells) {
        // Dedup by grid cell
        const key  = `osint:safecast:${gridKey}:${Math.floor(cell.maxCpm / 50)}`
        const seen = await redis.get(key)
        if (seen) continue

        const severity     = radiationSeverity(cell.maxCpm)
        const locationStr  = formatLocation(cell.lat, cell.lng)
        const microSv      = (cell.maxCpm * 0.0057).toFixed(2)

        const title = `Elevated Radiation Detected: ${cell.maxCpm} CPM (${microSv} µSv/h) near ${locationStr}`

        const summary = [
          `Safecast crowdsourced radiation sensor network detected elevated radiation levels.`,
          `Peak reading: ${cell.maxCpm} CPM (~${microSv} µSv/h), ${cell.count} elevated sensor(s) in area.`,
          `Normal background: 30-60 CPM (~0.17-0.34 µSv/h).`,
          `Location: ${locationStr}.`,
        ].join(' ')

        const capturedDate = new Date(cell.capturedAt)
        const eventTime    = isNaN(capturedDate.getTime()) ? new Date() : capturedDate

        try {
          const signal = await insertAndCorrelate({
            title:             title.slice(0, 500),
            summary,
            category:          'science',
            severity,
            status:            'pending',
            reliability_score: RELIABILITY,
            source_count:      cell.count,
            source_ids:        [],
            original_urls:     ['https://safecast.org/tilemap/'],
            location:          db.raw('ST_MakePoint(?, ?)', [cell.lng, cell.lat]),
            location_name:     locationStr,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'radiation', 'safecast', 'environmental', 'science'],
            language:          'en',
            event_time:        eventTime,
          }, { lat: cell.lat, lng: cell.lng, sourceId: 'safecast' })

          await redis.setex(key, DEDUP_TTL_S, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'science',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'science', severity },
                }),
              }],
            }).catch(() => {})
          }
        } catch (err) {
          log.debug({ err, gridKey }, 'Safecast signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, elevated: elevated.length, total: measurements.length }, 'Safecast: radiation signals created')
      } else {
        log.debug({ elevated: elevated.length, total: measurements.length }, 'Safecast poll complete (no new anomalies)')
      }
    } catch (err) {
      log.warn({ err }, 'Safecast poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'Safecast radiation monitoring poller started')

  return () => {
    clearInterval(timer)
    log.info('Safecast radiation monitoring poller stopped')
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface SafecastMeasurement {
  id:           number
  value:        number
  unit:         string
  latitude:     number
  longitude:    number
  captured_at:  string
  device_id:    number
  location_name?: string
}
