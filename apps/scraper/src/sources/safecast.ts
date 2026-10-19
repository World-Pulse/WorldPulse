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
 *
 * Oct 19, 2026 (Map Lab review): "Elevated Radiation Detected: 6477 CPM
 * (36.92 µSv/h) near 52.45°N, 13.31°E" (Berlin) sat in the site's ticker all
 * day: one sensor's readings. Any single reading of 100 CPM or more among the
 * newest uploads made an alert, and uploads can be old drives sent in late or
 * readings in other units. Now an area alerts only on readings in CPM taken in
 * the last 6 hours from at least two different sensors, and the alert gives
 * the lower of the two highest sensors' readings (radiationAlerts).
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

// ─── WHICH READINGS ALERT (Oct 19, 2026) ────────────────────────────────────

/** Readings this recent count (an upload can be an old drive sent in late) */
export const READING_MAX_AGE_MS = 6 * 3_600_000
/** Different sensors in one area that must read high before it alerts */
export const MIN_SENSORS = 2

export interface RadiationCell {
  gridKey:    string
  /** The lower of the two highest sensors' readings: what at least two sensors agree on */
  cpm:        number
  sensors:    number
  readings:   number
  lat:        number
  lng:        number
  capturedAt: string
}

/** Who took a reading: its device, else its sensor, else the person who uploaded it */
function sensorOf(m: SafecastMeasurement): string {
  if (m.device_id != null) return `d${m.device_id}`
  if (m.sensor_id != null) return `s${m.sensor_id}`
  if (m.user_id != null) return `u${m.user_id}`
  return `m${m.id}`
}

/** The 1° areas where at least two different sensors read 100 CPM or more in the last 6 hours */
export function radiationAlerts(measurements: SafecastMeasurement[], now = Date.now()): RadiationCell[] {
  const cells = new Map<string, { bySensor: Map<string, number>; readings: number; lat: number; lng: number; capturedAt: string; top: number }>()
  for (const m of measurements) {
    if (String(m.unit ?? '').toLowerCase() !== 'cpm') continue
    const cpm = Number(m.value)
    const lat = Number(m.latitude)
    const lng = Number(m.longitude)
    if (!Number.isFinite(cpm) || cpm < CPM_ELEVATED) continue
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue
    const taken = Date.parse(m.captured_at)
    if (!Number.isFinite(taken) || now - taken > READING_MAX_AGE_MS || taken - now > 10 * 60_000) continue
    const gridKey = `${Math.floor(lat)}_${Math.floor(lng)}`
    let cell = cells.get(gridKey)
    if (!cell) {
      cell = { bySensor: new Map(), readings: 0, lat, lng, capturedAt: m.captured_at, top: 0 }
      cells.set(gridKey, cell)
    }
    cell.readings++
    const id = sensorOf(m)
    cell.bySensor.set(id, Math.max(cell.bySensor.get(id) ?? 0, cpm))
    if (cpm > cell.top) Object.assign(cell, { top: cpm, lat, lng, capturedAt: m.captured_at })
  }
  const out: RadiationCell[] = []
  for (const [gridKey, cell] of cells) {
    if (cell.bySensor.size < MIN_SENSORS) continue
    const highs = [...cell.bySensor.values()].sort((a, b) => b - a)
    out.push({ gridKey, cpm: highs[1], sensors: cell.bySensor.size, readings: cell.readings, lat: cell.lat, lng: cell.lng, capturedAt: cell.capturedAt })
  }
  return out
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
                'User-Agent': 'WorldPulse/0.1 (open-source; https://world-pulse.io)',
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

      // Areas where at least two sensors read high, in CPM, in the last 6 hours
      const alerts = radiationAlerts(measurements)
      const elevated = alerts.reduce((n, c) => n + c.readings, 0)

      if (alerts.length === 0) {
        log.debug({ total: measurements.length }, 'Safecast: no area with two sensors reading high')
        return
      }

      let created = 0

      for (const cell of alerts) {
        const gridKey = cell.gridKey
        // Dedup by grid cell
        const key  = `osint:safecast:${gridKey}:${Math.floor(cell.cpm / 50)}`
        const seen = await redis.get(key)
        if (seen) continue

        const severity     = radiationSeverity(cell.cpm)
        const locationStr  = formatLocation(cell.lat, cell.lng)
        const microSv      = (cell.cpm * 0.0057).toFixed(2)

        const title = `Elevated Radiation Detected: ${cell.cpm} CPM (${microSv} µSv/h) near ${locationStr}`

        const summary = [
          `Safecast crowdsourced radiation sensor network detected elevated radiation levels.`,
          `${cell.sensors} sensors read high in the area; at least two agree on ${cell.cpm} CPM (~${microSv} µSv/h) (${cell.readings} readings).`,
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
            source_count:      cell.sensors,
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
        log.info({ created, elevated, areas: alerts.length, total: measurements.length }, 'Safecast: radiation signals created')
      } else {
        log.debug({ elevated, areas: alerts.length, total: measurements.length }, 'Safecast poll complete (no new anomalies)')
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

export interface SafecastMeasurement {
  id:           number
  value:        number
  unit:         string
  latitude:     number
  longitude:    number
  captured_at:  string
  device_id:    number | null
  sensor_id?:   number | null
  user_id?:     number | null
  location_name?: string | null
}
