/**
 * GDELT 2.0 Events Feed
 *
 * Polls http://data.gdeltproject.org/gdeltv2/lastupdate.txt every 15 minutes,
 * downloads the .export.CSV.zip file, unzips it using Node.js built-ins (no
 * external zip library required), parses the tab-separated CAMEO event rows,
 * and creates WorldPulse signals from conflict/disruption events.
 *
 * GDELT 2.0: http://data.gdeltproject.org/gdeltv2/lastupdate.txt
 * Updated every 15 minutes. No API key required.
 *
 * Dedup key: gdelt:seen:{GlobalEventID} — 24 h TTL
 * File-level dedup: gdelt:file:{urlHash} — 20 min TTL (prevents reprocessing
 *   the same 15-min file on every scraper restart within that window)
 *
 * Reliability: 0.65 — GDELT events are machine-coded from news, high-volume
 *   but lower per-event confidence compared to curated feeds.
 *
 * Column spec: GDELT 2.0 Event Codebook V2.0 (61 columns, 0-indexed)
 *   https://www.gdeltproject.org/data/documentation/GDELT-Event_Codebook-V2.0.pdf
 */

import { createHash }                  from 'node:crypto'
import zlib                            from 'node:zlib'
import { promisify }                   from 'node:util'
import type { Knex }                   from 'knex'
import type Redis                      from 'ioredis'
import type { Producer }               from 'kafkajs'
import { logger as rootLogger }        from '../lib/logger'
import type { Category, SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate }          from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'gdelt-source' })

const inflateRawAsync = promisify(zlib.inflateRaw)

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const LASTUPDATE_URL  = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt'
const RELIABILITY     = 0.65
const DEDUP_TTL_S     = 86_400   // 24 h — per-event dedup
const FILE_TTL_S      = 1_200   // 20 min — prevent re-processing the same file
const MAX_EVENTS_POLL = 50      // cap new signals per 15-min cycle
const MAX_GOLDSTEIN   = 3       // skip cooperative/neutral events above this score

// ─── GDELT 2.0 CSV COLUMN INDICES ───────────────────────────────────────────
// The events export has exactly 61 tab-separated columns.
const COL = {
  GLOBALEVENTID:         0,
  SQLDATE:               1,   // YYYYMMDD
  EVENTCODE:             26,  // CAMEO code, e.g. "190", "145"
  EVENTROOTCODE:         28,  // Top-level CAMEO root (strings "1"–"20")
  GOLDSTEINSCALE:        30,  // float, -10 (hostile) → +10 (cooperative)
  ACTIONGEO_FULLNAME:    52,  // human-readable location, e.g. "Kyiv, Ukraine"
  ACTIONGEO_COUNTRYCODE: 53,  // FIPS 2-letter country code
  ACTIONGEO_LAT:         56,
  ACTIONGEO_LONG:        57,
  DATEADDED:             59,  // YYYYMMDDHHMMSS
  SOURCEURL:             60,
} as const

const EXPECTED_COLS = 61

// ─── CAMEO ROOT → WORLDPULSE CATEGORY ───────────────────────────────────────

const CAMEO_CATEGORY: Record<string, Category> = {
  '01': 'geopolitics',   // Make public statement
  '02': 'geopolitics',   // Appeal
  '03': 'geopolitics',   // Express intent to cooperate
  '04': 'geopolitics',   // Consult
  '05': 'geopolitics',   // Engage in diplomatic cooperation
  '06': 'economy',       // Engage in material cooperation
  '07': 'other',         // Provide aid
  '08': 'geopolitics',   // Yield / concession
  '09': 'security',      // Investigate
  '10': 'conflict',      // Demand
  '11': 'geopolitics',   // Disapprove
  '12': 'geopolitics',   // Reject
  '13': 'conflict',      // Threaten
  '14': 'elections',     // Protest / demonstration
  '15': 'conflict',      // Exhibit force posture
  '16': 'geopolitics',   // Reduce relations
  '17': 'conflict',      // Coerce
  '18': 'conflict',      // Assault
  '19': 'conflict',      // Fight
  '20': 'conflict',      // Use unconventional mass violence
}

const CAMEO_LABEL: Record<string, string> = {
  '01': 'Public statement',
  '02': 'Appeal',
  '03': 'Intent to cooperate',
  '04': 'Consultation',
  '05': 'Diplomatic cooperation',
  '06': 'Material cooperation',
  '07': 'Humanitarian aid',
  '08': 'Concession',
  '09': 'Investigation',
  '10': 'Demand',
  '11': 'Disapproval',
  '12': 'Rejection',
  '13': 'Threat',
  '14': 'Protest',
  '15': 'Military show of force',
  '16': 'Diplomatic reduction',
  '17': 'Coercion',
  '18': 'Assault',
  '19': 'Armed conflict',
  '20': 'Mass atrocity',
}

// ─── EXPORTED PURE HELPERS (also exercised in tests) ────────────────────────

/** Map a CAMEO EventRootCode string ("1"–"20") to a WorldPulse Category. */
export function gdeltCameoCategory(rootCode: string): Category {
  const key = rootCode.padStart(2, '0')
  return CAMEO_CATEGORY[key] ?? 'other'
}

/**
 * Derive signal severity from the GDELT GoldsteinScale.
 * The scale runs from -10 (most hostile) to +10 (most cooperative).
 * We only emit signals for events at or below MAX_GOLDSTEIN, so the
 * highest severity band is reached for very hostile events.
 */
export function gdeltSeverity(goldstein: number): SignalSeverity {
  if (goldstein <= -7) return 'critical'
  if (goldstein <= -4) return 'high'
  if (goldstein <=  0) return 'medium'
  return 'low'
}

/**
 * Parse a GDELT DATEADDED timestamp (YYYYMMDDHHMMSS, 14 chars) to a Date.
 * Returns null when the input is missing, wrong length, or invalid.
 */
export function parseDateAdded(raw: string): Date | null {
  if (!raw || raw.length !== 14) return null
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` +
              `T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`
  const dt = new Date(iso)
  return isNaN(dt.getTime()) ? null : dt
}

/**
 * Parse the text content of lastupdate.txt and return the URL of the
 * .export.CSV.zip file.  Each line has the format:
 *   <md5>  <bytes>  <url>
 */
export function parseLastUpdateUrl(text: string): string | null {
  for (const line of text.trim().split('\n')) {
    const parts = line.trim().split(/\s+/)
    const url = parts[2] ?? ''
    if (url.endsWith('.export.CSV.zip')) return url
  }
  return null
}

/** Fields extracted from a single GDELT event TSV row. */
export interface GdeltRow {
  globalEventId: string
  sqlDate:       string
  eventCode:     string
  eventRootCode: string
  goldstein:     number
  geoName:       string
  countryCode:   string
  lat:           number | null
  lng:           number | null
  dateAdded:     string
  sourceUrl:     string
}

/**
 * Parse one tab-separated GDELT event row.
 * Returns null for rows with too few columns or missing required fields
 * (GlobalEventID or SOURCEURL), so callers can skip them gracefully.
 */
export function parseTsvRow(line: string): GdeltRow | null {
  const cols = line.split('\t')
  if (cols.length < EXPECTED_COLS) return null

  const globalEventId = cols[COL.GLOBALEVENTID]?.trim() ?? ''
  const sourceUrl     = cols[COL.SOURCEURL]?.trim()     ?? ''
  if (!globalEventId || !sourceUrl) return null

  const latRaw = cols[COL.ACTIONGEO_LAT]?.trim()  ?? ''
  const lngRaw = cols[COL.ACTIONGEO_LONG]?.trim() ?? ''
  const latVal = latRaw !== '' ? parseFloat(latRaw) : NaN
  const lngVal = lngRaw !== '' ? parseFloat(lngRaw) : NaN

  return {
    globalEventId,
    sqlDate:       cols[COL.SQLDATE]?.trim()               ?? '',
    eventCode:     cols[COL.EVENTCODE]?.trim()             ?? '',
    eventRootCode: cols[COL.EVENTROOTCODE]?.trim()         ?? '',
    goldstein:     parseFloat(cols[COL.GOLDSTEINSCALE] ?? '') || 0,
    geoName:       cols[COL.ACTIONGEO_FULLNAME]?.trim()    ?? '',
    countryCode:   cols[COL.ACTIONGEO_COUNTRYCODE]?.trim() ?? '',
    lat:           !isNaN(latVal) ? latVal : null,
    lng:           !isNaN(lngVal) ? lngVal : null,
    dateAdded:     cols[COL.DATEADDED]?.trim()             ?? '',
    sourceUrl,
  }
}

// ─── ZIP READER (Node built-ins only) ───────────────────────────────────────
// GDELT export ZIPs contain exactly one file compressed with DEFLATE.
// We parse the local file header manually to avoid any external dependency.
//
// ZIP local file header layout (offsets from header start):
//   0–3:   signature PK\x03\x04
//   4–5:   version needed
//   6–7:   general purpose bit flag
//   8–9:   compression method  (0=stored, 8=deflate)
//  10–11:  last mod time
//  12–13:  last mod date
//  14–17:  crc-32
//  18–21:  compressed size
//  22–25:  uncompressed size
//  26–27:  file name length (n)
//  28–29:  extra field length (m)
//  30+n+m: compressed data

async function unzipFirstEntry(buf: Buffer): Promise<Buffer> {
  const SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  const offset = buf.indexOf(SIG)
  if (offset === -1) throw new Error('GDELT: buffer is not a valid ZIP file')

  const h = buf.subarray(offset)
  const compression = h.readUInt16LE(8)
  const compSize    = h.readUInt32LE(18)
  const fnLen       = h.readUInt16LE(26)
  const extraLen    = h.readUInt16LE(28)
  const dataStart   = offset + 30 + fnLen + extraLen
  const compData    = buf.subarray(dataStart, dataStart + compSize)

  if (compression === 0) return compData                             // stored
  if (compression === 8) return inflateRawAsync(compData) as Promise<Buffer>  // deflate
  throw new Error(`GDELT: unsupported ZIP compression method ${compression}`)
}

// ─── NETWORK HELPERS ────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GDELT: HTTP ${res.status} fetching ${url}`)
  return res.text()
}

async function fetchBinary(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`GDELT: HTTP ${res.status} fetching ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────

export function startGdeltPoller(
  db:        Knex,
  redis:     Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.GDELT_INTERVAL_MS ?? 15 * 60_000)

  async function poll(): Promise<void> {
    try {
      log.debug('GDELT: polling lastupdate.txt')

      // 1. Discover the latest export file URL
      let updateText: string
      try {
        updateText = await fetchWithResilience(
          'gdelt-lastupdate',
          'GDELT lastupdate',
          LASTUPDATE_URL,
          () => fetchText(LASTUPDATE_URL),
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }
      const zipUrl = parseLastUpdateUrl(updateText)
      if (!zipUrl) {
        log.warn('GDELT: no .export.CSV.zip URL found in lastupdate.txt')
        return
      }

      // 2. File-level dedup — avoid reprocessing the same 15-min file
      const fileKey = `gdelt:file:${createHash('sha256').update(zipUrl).digest('hex').slice(0, 16)}`
      if (await redis.get(fileKey)) {
        log.debug({ zipUrl }, 'GDELT: file already processed, skipping')
        return
      }

      log.debug({ zipUrl }, 'GDELT: downloading events export ZIP')

      // 3. Download and unzip
      let zipBuf: Buffer
      try {
        zipBuf = await fetchWithResilience(
          'gdelt-csv',
          'GDELT CSV export',
          zipUrl,
          () => fetchBinary(zipUrl),
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }
      const tsvBuf = await unzipFirstEntry(zipBuf)
      const tsvText = tsvBuf.toString('utf8')

      const lines = tsvText.split('\n').filter(l => l.trim().length > 0)
      log.info({ total: lines.length }, 'GDELT: events file parsed')

      let created = 0
      let skipped = 0

      for (const line of lines) {
        if (created >= MAX_EVENTS_POLL) break

        const row = parseTsvRow(line)
        if (!row) { skipped++; continue }

        // Skip cooperative / neutral events
        if (row.goldstein > MAX_GOLDSTEIN) { skipped++; continue }

        // Skip rows whose source URL looks invalid
        if (!row.sourceUrl.startsWith('http')) { skipped++; continue }

        // Per-event dedup
        const dedupKey = `gdelt:seen:${row.globalEventId}`
        if (await redis.get(dedupKey)) { skipped++; continue }

        const category  = gdeltCameoCategory(row.eventRootCode)
        const severity  = gdeltSeverity(row.goldstein)
        const eventTime = parseDateAdded(row.dateAdded)

        const rootLabel = CAMEO_LABEL[row.eventRootCode.padStart(2, '0')] ?? `CAMEO-${row.eventCode}`
        const locPart   = row.geoName ? ` in ${row.geoName}` : ''
        const title     = `${rootLabel}${locPart}`.slice(0, 500)
        const summary   = (
          `GDELT CAMEO event ${row.eventCode}${locPart}. ` +
          `GoldsteinScale: ${row.goldstein}. Source: ${row.sourceUrl}`
        ).slice(0, 600)

        try {
          const signal = await insertAndCorrelate({
            title,
            summary,
            category,
            severity,
            status:            'pending',
            reliability_score: RELIABILITY,
            source_count:      1,
            source_ids:        [],
            original_urls:     [row.sourceUrl],
            location: row.lat != null && row.lng != null
              ? db.raw('ST_MakePoint(?, ?)', [row.lng, row.lat])
              : null,
            location_name: row.geoName || null,
            country_code:  row.countryCode || null,
            region:        null,
            tags:          ['osint', 'gdelt', `cameo-${row.eventRootCode}`],
            language:      'en',
            event_time:    eventTime,
          }, {
            lat:        row.lat ?? null,
            lng:        row.lng ?? null,
            sourceId:   'gdelt',
            sourceName: 'GDELT',
            sourceSlug: 'gdelt',
          })

          await redis.setex(dedupKey, DEDUP_TTL_S, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   category,
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category, severity },
                }),
              }],
            }).catch(() => {})  // non-fatal
          }
        } catch (err) {
          log.debug({ err, id: row.globalEventId }, 'GDELT signal insert skipped (likely duplicate)')
          skipped++
        }
      }

      // Mark this file fully processed
      await redis.setex(fileKey, FILE_TTL_S, '1')

      if (created > 0) {
        log.info({ created, skipped, total: lines.length }, 'GDELT: signals created')
      } else {
        log.debug({ skipped, total: lines.length }, 'GDELT poll complete (no new events)')
      }
    } catch (err) {
      log.warn({ err }, 'GDELT poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)
  log.info({ intervalMs: INTERVAL_MS }, 'GDELT 2.0 events poller started')

  return () => {
    clearInterval(timer)
    log.info('GDELT poller stopped')
  }
}
