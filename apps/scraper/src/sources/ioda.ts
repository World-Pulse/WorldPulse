/**
 * Internet outages, from IODA (Internet Outage Detection and Analysis, Georgia Tech)
 *
 * Every 10 minutes: the outage events IODA has detected for countries in the
 * last 6 hours, from
 *   https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=<unix>&until=<unix>&entityType=country
 * Free, no key. (IODA moved from CAIDA to Georgia Tech: api.ioda.caida.org and
 * its /v2/alerts/ path stopped answering, so this source made nothing until
 * Oct 2026. The alerts endpoint has no score; the events endpoint does.)
 *
 * An event is one country's drop in one of IODA's measurements, with when it
 * began, how long it has lasted and a score that grows with how much
 * connectivity was lost and for how long. A report is made, once, when:
 *   - the drop is in routing (BGP) or active probing (ping-slash24) data, the
 *     two that mean networks went dark; Google traffic (gtr) and the network
 *     telescope (merit-nt) move for other reasons;
 *   - its score reaches IODA_MIN_SCORE (1,000; Oct 20, 2026: a day had 45
 *     events, most of them North Korea's 10–30 minute blips under 500);
 *   - it began within the last 6 hours (an outage that started days ago was
 *     news then, not now);
 *   - it isn't one of 3 or more countries far apart starting together on the
 *     same measurement: that is IODA's own glitch (Oct 20: Anguilla, the Cook
 *     Islands, Micronesia and Saint Lucia, at the same minute). Neighbours
 *     starting together stay in: a cut undersea cable takes out a coast.
 * At most one report per country every 6 hours.
 *
 * IODA's data notice: "Copyright (c) Georgia Tech Research Corporation. All
 * Rights Reserved." A report keeps only the facts (country, start, measurement,
 * score) and links to IODA's page for the country.
 *
 * Severity: score ≥ 20,000 critical · ≥ 5,000 high · otherwise medium.
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'
import { countryPin } from '../pipeline/geo'
import { countryNameOf } from '../pipeline/world-countries'

const log = rootLogger.child({ module: 'ioda-source' })

export const IODA_API_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2'
export const IODA_SITE = 'https://ioda.inetintel.cc.gatech.edu'

/** Measurements whose drops mean networks went dark */
const OUTAGE_DATASOURCES: Record<string, string> = {
  'bgp':          'routing data (BGP)',
  'ping-slash24': "active probing (pings to the country's networks)",
}

/** One country's outage, as IODA's /outages/events lists it */
export interface IodaOutage {
  /** ISO 3166-1 alpha-2, from "country/BI" */
  code:       string
  /** IODA's name for it */
  iodaName:   string
  datasource: string
  /** Unix seconds */
  start:      number
  /** Seconds; runs to the end of the asked window while the outage goes on */
  duration:   number
  score:      number
}

export interface OutagePickOptions {
  /** The least score that makes a report */
  minScore:        number
  /** Only outages that began this recently (seconds) */
  maxAgeS:         number
  /** This many countries far apart starting together on one measurement is a glitch */
  glitchCountries: number
}

export const DEFAULT_PICK: OutagePickOptions = { minScore: 1_000, maxAgeS: 6 * 3600, glitchCountries: 3 }

/** Starts this close together count as "together" (seconds) */
const TOGETHER_S = 5 * 60
/** Countries further apart than this aren't one region's outage (km) */
const NEIGHBOURS_KM = 3_000

function parseEvent(raw: unknown): IodaOutage | null {
  const e = (raw ?? {}) as Record<string, unknown>
  const m = typeof e.location === 'string' ? /^country\/([A-Za-z]{2})$/.exec(e.location) : null
  const start = Number(e.start)
  const duration = Number(e.duration)
  const score = Number(e.score)
  const datasource = typeof e.datasource === 'string' ? e.datasource : ''
  if (!m || !datasource || !Number.isFinite(start) || !Number.isFinite(score)) return null
  return {
    code: m[1].toUpperCase(),
    iodaName: typeof e.location_name === 'string' ? e.location_name : m[1].toUpperCase(),
    datasource,
    start,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    score,
  }
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Whether these countries starting together look like IODA's own glitch:
 * enough of them, and not all neighbours (a country we can't place counts as
 * far from the rest).
 */
function scatteredGroup(codes: string[], minCountries: number): boolean {
  if (codes.length < minCountries) return false
  const pins = codes.map(code => countryPin(code))
  if (pins.some(p => p === null)) return true
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      if (km(pins[i]!, pins[j]!) > NEIGHBOURS_KM) return true
    }
  }
  return false
}

/** The outages worth a report, worst first, one per country */
export function pickOutages(events: unknown[], nowS: number, opts: OutagePickOptions = DEFAULT_PICK): IodaOutage[] {
  const all = events.map(parseEvent).filter((e): e is IodaOutage => e !== null)
  const best = new Map<string, IodaOutage>()
  for (const e of all) {
    if (!(e.datasource in OUTAGE_DATASOURCES)) continue
    if (e.score < opts.minScore) continue
    if (nowS - e.start > opts.maxAgeS || e.start > nowS + TOGETHER_S) continue
    const together = new Set(all
      .filter(o => o.datasource === e.datasource && Math.abs(o.start - e.start) <= TOGETHER_S)
      .map(o => o.code))
    if (scatteredGroup([...together], opts.glitchCountries)) continue
    const prev = best.get(e.code)
    if (!prev || e.score > prev.score) best.set(e.code, e)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

export function iodaSeverity(score: number): SignalSeverity {
  if (score >= 20_000) return 'critical'
  if (score >= 5_000) return 'high'
  return 'medium'
}

function utcClock(s: number): string {
  const d = new Date(s * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${hh}:${mm} UTC on ${day}`
}

function lasted(s: number): string {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} minutes`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

/** A report's headline, text and link. untilS is the end of the window asked for. */
export function outageReport(o: IodaOutage, untilS: number): { title: string; summary: string; url: string; name: string } {
  const name = countryNameOf(o.code) ?? o.iodaName
  const ongoing = o.start + o.duration >= untilS - TOGETHER_S
  const how = OUTAGE_DATASOURCES[o.datasource] ?? o.datasource
  const summary = [
    `IODA, Georgia Tech's internet outage monitor, detected an internet outage in ${name} from ${utcClock(o.start)}, seen in its ${how}.`,
    ongoing ? 'It had not recovered at IODA\'s last check.' : `It lasted about ${lasted(o.duration)}.`,
    `IODA's outage score: ${Math.round(o.score).toLocaleString('en-US')}. Its page for ${name} shows the measurements.`,
  ].join(' ')
  return {
    title: `Internet outage in ${name}, detected by IODA`,
    summary: summary.slice(0, 600),
    url: `${IODA_SITE}/country/${o.code}`,
    name,
  }
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20_000,
      headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://world-pulse.io)', Accept: 'application/json' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`IODA answered ${res.statusCode}`))
        return
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('IODA request timeout')) })
  })
}

// ─── POLLER ─────────────────────────────────────────────────────────────────
export function startIodaPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.IODA_INTERVAL_MS || 10 * 60_000)
  const opts: OutagePickOptions = {
    ...DEFAULT_PICK,
    minScore: Number(process.env.IODA_MIN_SCORE || DEFAULT_PICK.minScore),
    maxAgeS:  Number(process.env.IODA_LOOKBACK_S || DEFAULT_PICK.maxAgeS),
  }

  async function poll(): Promise<void> {
    try {
      const now  = Math.floor(Date.now() / 1_000)
      const from = now - opts.maxAgeS
      const url  = `${IODA_API_BASE}/outages/events?from=${from}&until=${now}&entityType=country&limit=200`

      let raw: string
      try {
        raw = await fetchWithResilience('ioda', 'IODA', url, () => httpsGet(url))
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }
      const body = JSON.parse(raw) as { data?: unknown[] }
      const events = Array.isArray(body.data) ? body.data : []
      const outages = pickOutages(events, now, opts)

      let created = 0
      for (const o of outages) {
        // Once per outage, and at most once per country every 6 hours
        const eventKey   = `ioda:event:${o.code}:${o.datasource}:${o.start}`
        const countryKey = `ioda:country:${o.code}`
        if (await redis.get(eventKey) || await redis.get(countryKey)) continue

        const report = outageReport(o, now)
        const pin = countryPin(o.code)
        const severity = iodaSeverity(o.score)
        const insertData: Record<string, unknown> = {
          title:             report.title.slice(0, 500),
          summary:           report.summary,
          category:          'technology',
          severity,
          status:            'pending',
          reliability_score: 0.87,
          source_count:      1,
          source_ids:        [],
          original_urls:     [report.url],
          location_name:     report.name,
          country_code:      o.code,
          region:            null,
          tags:              ['osint', 'internet', 'outage', 'ioda', 'connectivity', 'country', o.datasource],
          language:          'en',
          event_time:        new Date(o.start * 1_000),
        }
        if (pin) insertData.location = db.raw('ST_MakePoint(?, ?)', [pin.lng, pin.lat])

        try {
          const signal = await insertAndCorrelate(insertData, { lat: pin?.lat ?? null, lng: pin?.lng ?? null, sourceId: 'ioda' })
          await redis.setex(eventKey, 3 * 24 * 3600, '1')
          await redis.setex(countryKey, 6 * 3600, '1')
          created++
          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'technology',
                value: JSON.stringify({ event: 'signal.new', payload: signal, filter: { category: 'technology', severity } }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, eventKey }, 'IODA report not stored (likely a duplicate)')
        }
      }

      if (created > 0) log.info({ created, events: events.length }, 'IODA: internet outage reports made')
      else log.debug({ events: events.length, picked: outages.length }, 'IODA poll: no new outages')
    } catch (err) {
      log.warn({ err }, 'IODA poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)
  log.info({ intervalMs: INTERVAL_MS, minScore: opts.minScore }, 'IODA internet outage poller started (Georgia Tech)')

  return () => {
    clearInterval(timer)
    log.info('IODA poller stopped')
  }
}
