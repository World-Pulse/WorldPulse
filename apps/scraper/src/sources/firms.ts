/**
 * NASA FIRMS Fire Hotspot Signal Source
 *
 * Polls NASA FIRMS (Fire Information for Resource Management System) every
 * 30 minutes for active fire hotspots globally. Aggregates nearby detections
 * into ~1° grid cells to avoid flooding. Creates WorldPulse signals for
 * high-confidence fire events.
 *
 * API: https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv
 * Free, no API key required, updated every few hours.
 *
 * Counters Shadowbroker's fire monitoring feed advantage.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'firms-source' })

const FIRMS_API =
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv'

const MAX_SIGNALS_PER_POLL = 20

// ─── TYPES ──────────────────────────────────────────────────────────────────
interface FirmsRow {
  latitude:   number
  longitude:  number
  frp:        number    // Fire Radiative Power (MW)
  confidence: string   // 'h' (high), 'n' (nominal), 'l' (low)
  acq_date:   string   // YYYY-MM-DD
  acq_time:   string   // HHMM
}

interface GridCell {
  gridKey:   string
  lat:       number   // centroid
  lng:       number   // centroid
  frp:       number   // max FRP in cell
  count:     number
  acq_date:  string
  acq_time:  string
}

// ─── HTTP HELPER ────────────────────────────────────────────────────────────
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 30_000,  // CSV can be large
      headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('FIRMS request timeout')) })
  })
}

// ─── CSV PARSER ─────────────────────────────────────────────────────────────
// Parses the FIRMS CSV manually (no external deps).
// FIRMS CSV format: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
export function parseFirmsCSV(csv: string): FirmsRow[] {
  const lines  = csv.split('\n')
  if (lines.length < 2) return []

  const header = lines[0].split(',').map(h => h.trim())
  const idxLat  = header.indexOf('latitude')
  const idxLng  = header.indexOf('longitude')
  const idxFrp  = header.indexOf('frp')
  const idxConf = header.indexOf('confidence')
  const idxDate = header.indexOf('acq_date')
  const idxTime = header.indexOf('acq_time')

  if (idxLat < 0 || idxLng < 0 || idxFrp < 0 || idxConf < 0) return []

  const rows: FirmsRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(',')
    const conf = (cols[idxConf] ?? '').trim().toLowerCase()

    // Skip low-confidence detections
    if (conf === 'l') continue

    const lat  = parseFloat(cols[idxLat] ?? '')
    const lng  = parseFloat(cols[idxLng] ?? '')
    const frp  = parseFloat(cols[idxFrp] ?? '')

    if (isNaN(lat) || isNaN(lng) || isNaN(frp)) continue

    rows.push({
      latitude:   lat,
      longitude:  lng,
      frp,
      confidence: conf,
      acq_date:   (cols[idxDate] ?? '').trim(),
      acq_time:   (cols[idxTime] ?? '').trim(),
    })
  }

  return rows
}

// ─── GRID AGGREGATION ───────────────────────────────────────────────────────
// Snap each detection to a ~1° grid cell to avoid flooding.
export function gridKey(lat: number, lng: number): string {
  const gridLat = Math.floor(lat)
  const gridLng = Math.floor(lng)
  return `${gridLat}:${gridLng}`
}

export function aggregateIntoGridCells(rows: FirmsRow[]): GridCell[] {
  const cells = new Map<string, GridCell>()

  for (const row of rows) {
    const key      = gridKey(row.latitude, row.longitude)
    const existing = cells.get(key)

    if (existing) {
      existing.count++
      if (row.frp > existing.frp) {
        existing.frp      = row.frp
        existing.acq_date = row.acq_date
        existing.acq_time = row.acq_time
      }
    } else {
      cells.set(key, {
        gridKey:  key,
        lat:      Math.floor(row.latitude)  + 0.5,
        lng:      Math.floor(row.longitude) + 0.5,
        frp:      row.frp,
        count:    1,
        acq_date: row.acq_date,
        acq_time: row.acq_time,
      })
    }
  }

  // Sort by FRP descending, take top N
  return Array.from(cells.values())
    .sort((a, b) => b.frp - a.frp)
    .slice(0, MAX_SIGNALS_PER_POLL)
}

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────
export function firmsSeverity(frp: number): SignalSeverity {
  if (frp >= 500) return 'critical'
  if (frp >= 200) return 'high'
  if (frp >= 50)  return 'medium'
  return 'low'
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────
export function startFirmsPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.FIRMS_INTERVAL_MS ?? 30 * 60_000) // 30 min default

  async function poll(): Promise<void> {
    try {
      log.debug('Polling NASA FIRMS fire hotspots...')
      let rows: FirmsRow[]
      try {
        rows = await fetchWithResilience(
          'firms',
          'NASA FIRMS',
          FIRMS_API,
          () => httpsGet(FIRMS_API).then(raw => parseFirmsCSV(raw)),
          { retryDelays: [2_000, 10_000] },  // slightly longer delays for large CSV
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return  // circuit open — skip silently
        throw err
      }

      if (rows.length === 0) {
        log.debug('FIRMS: no qualifying detections')
        return
      }

      const cells = aggregateIntoGridCells(rows)
      let created = 0

      for (const cell of cells) {
        const key  = `firms:dedup:${cell.gridKey}`
        const seen = await redis.get(key)
        if (seen) continue

        const severity = firmsSeverity(cell.frp)
        const title    = `Active Fire — ${cell.lat.toFixed(1)}°, ${cell.lng.toFixed(1)}°`

        const summary = [
          `NASA FIRMS satellite detected active fire at approximately ${cell.lat.toFixed(1)}°N, ${cell.lng.toFixed(1)}°E.`,
          `Fire Radiative Power: ${cell.frp.toFixed(0)} MW (${cell.count} detection(s) in grid cell).`,
          `Detection time: ${cell.acq_date} ${cell.acq_time} UTC.`,
          'Source: NASA FIRMS / NOAA-20 VIIRS.',
        ].join(' ')

        try {
          const signal = await insertAndCorrelate({
            title:             title.slice(0, 500),
            summary,
            category:          'disaster',
            severity,
            status:            'pending',
            reliability_score: 0.80, // VIIRS satellite detection is reliable
            source_count:      cell.count,
            source_ids:        [],
            original_urls:     ['https://firms.modaps.eosdis.nasa.gov/map/'],
            location:          db.raw('ST_MakePoint(?, ?)', [cell.lng, cell.lat]),
            location_name:     `${cell.lat.toFixed(1)}°N, ${cell.lng.toFixed(1)}°E`,
            country_code:      null,
            region:            null,
            tags:              ['osint', 'firms', 'fire', 'nasa', 'viirs'],
            language:          'en',
            event_time:        cell.acq_date
              ? new Date(`${cell.acq_date}T${cell.acq_time.slice(0, 2)}:${cell.acq_time.slice(2, 4)}:00Z`)
              : new Date(),
          }, { lat: cell.lat, lng: cell.lng, sourceId: 'firms' })

          // Dedup for 3h (data refreshes every ~3 hours)
          await redis.setex(key, 3 * 3_600, '1')
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
          log.debug({ err, gridKey: cell.gridKey }, 'FIRMS signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, cells: cells.length, detections: rows.length }, 'FIRMS: fire signals created')
      } else {
        log.debug({ cells: cells.length, detections: rows.length }, 'FIRMS poll complete (no new cells)')
      }
    } catch (err) {
      log.warn({ err }, 'FIRMS poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'FIRMS poller started (NASA VIIRS)')

  return () => {
    clearInterval(timer)
    log.info('FIRMS poller stopped')
  }
}
