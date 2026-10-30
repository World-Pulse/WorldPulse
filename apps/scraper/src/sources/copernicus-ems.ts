/**
 * Copernicus EMS rapid mapping activations (plan N11, Oct 30, 2026)
 *
 * When a disaster is bad enough that a country, the EU or a UN body asks the
 * EU's Copernicus Emergency Management Service for satellite maps of it, CEMS
 * opens an activation ("EMSR935 · Flood in Alicante-Valencia Regions, Spain").
 * That is an official confirmation that a disaster is under way, with its
 * place and its kind, often within hours. It takes the place of UN ReliefWeb's
 * disaster list, which now turns automated readers away unless they hold an
 * approved app name (Devon, Oct 29: no accounts for it).
 *
 * API: https://mapping.emergency.copernicus.eu/activations/api/activations/
 * (public JSON, no key, newest first, 20 a page).
 * Terms (mapping.emergency.copernicus.eu/terms-and-conditions/): free
 * reproduction and distribution, telling readers where the data comes from;
 * every signal names the Copernicus Emergency Management Service and links
 * its activation page.
 *
 * One signal per new activation, deduplicated by its code, only for
 * activations of the last 3 days in the response phase (a first start, or a
 * long pause, doesn't fill the feed with old or recovery-phase work).
 *
 * Reliability: 0.95 (an EU service activated by a government or UN request)
 * Category: disaster
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { Category, SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'
import { extractGeo } from '../pipeline/geo'

const log = rootLogger.child({ module: 'copernicus-ems-source' })

export const CEMS_API_URL = 'https://mapping.emergency.copernicus.eu/activations/api/activations/'
const CEMS_PAGE = (code: string) => `https://mapping.emergency.copernicus.eu/activations/${encodeURIComponent(code)}/`
const RELIABILITY = 0.95
const DEDUP_TTL_S = 30 * 86_400
const MAX_AGE_MS = 3 * 86_400_000
const MAX_PER_POLL = 10
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io)'
const POLL_INTERVAL_MS = Number(process.env.COPERNICUS_EMS_INTERVAL_MS) || 30 * 60_000 // 30 min

/** One activation as the list gives it (the fields this reader uses) */
export interface CemsActivation {
  code: string
  name: string
  countries?: Array<{ short_name?: string | null }> | null
  category?: { slug?: string | null; name?: string | null } | null
  centroid?: string | null
  activationTime?: string | null
  lastUpdate?: string | null
  drmPhase?: string | null
  closed?: boolean | null
  search_snippet?: string | null
}

/** "POINT (0.0229 38.8162)" (longitude first) → { lat, lon }, or null */
export function parseCentroid(wkt: string | null | undefined): { lat: number; lon: number } | null {
  const m = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i.exec(String(wkt || ''))
  if (!m) return null
  const lon = Number(m[1]), lat = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  if (lat === 0 && lon === 0) return null
  return { lat, lon }
}

/** The activation's time: CEMS writes UTC without a zone ("2026-10-19T16:03:00") */
export function activationTime(a: Pick<CemsActivation, 'activationTime'>): Date | null {
  const raw = String(a.activationTime || '').trim()
  if (!raw) return null
  const d = new Date(/(?:Z|[+-]\d\d:?\d\d)$/.test(raw) ? raw : `${raw}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Activations worth a signal now: in the response phase, made in the last 3 days, not seen before (codes in `seen`) */
export function newActivations(list: CemsActivation[], seen: Set<string>, now = Date.now()): CemsActivation[] {
  return list.filter(a => {
    if (!a || !/^EMSR\d+$/i.test(String(a.code || '')) || !String(a.name || '').trim()) return false
    if (seen.has(a.code.toUpperCase())) return false
    const phase = String(a.drmPhase || 'response').toLowerCase()
    if (phase !== 'response') return false
    const at = activationTime(a)
    return !!at && now - at.getTime() <= MAX_AGE_MS && at.getTime() <= now + 3_600_000
  })
}

/** Floods, fires, quakes and storms are disasters; a humanitarian activation (camps, displacement) is humanitarian */
export function cemsCategory(slug: string | null | undefined): Category {
  return /humanitarian/i.test(String(slug || '')) ? 'humanitarian' : 'disaster'
}

/**
 * Severity: an activation means the authorities asked for outside help to map
 * the damage, so it is high; one that names no country stays medium.
 */
export function cemsSeverity(a: Pick<CemsActivation, 'countries'>): SignalSeverity {
  const named = (a.countries || []).some(c => String(c?.short_name || '').trim())
  return named ? 'high' : 'medium'
}

/** "Flood in Crete, Greece" → "Crete, Greece"; else the countries */
export function cemsPlaceName(a: Pick<CemsActivation, 'name' | 'countries'>): string | null {
  const m = /\bin\s+(.+)$/i.exec(String(a.name || '').trim())
  if (m && m[1]!.trim()) return m[1]!.trim().slice(0, 200)
  const names = (a.countries || []).map(c => String(c?.short_name || '').trim()).filter(Boolean)
  return names.length ? names.join(', ').slice(0, 200) : null
}

/** The signal's headline and summary, in plain words, with the source named */
export function cemsText(a: CemsActivation): { title: string; summary: string } {
  const name = String(a.name || '').replace(/\s+/g, ' ').trim()
  const title = `${name}: EU emergency satellite mapping activated (${a.code.toUpperCase()})`.slice(0, 500)
  const snippet = String(a.search_snippet || '').replace(/\s+/g, ' ').trim()
  const at = activationTime(a)
  const when = at ? `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null
  const summary = [
    snippet,
    `The Copernicus Emergency Management Service (EU) opened rapid mapping activation ${a.code.toUpperCase()}${when ? ` on ${when}` : ''}: it maps the affected area from satellites at the request of the authorities.`,
    'Source: Copernicus Emergency Management Service (mapping.emergency.copernicus.eu).',
  ].filter(Boolean).join('\n').slice(0, 2000)
  return { title, summary }
}

async function fetchActivations(): Promise<CemsActivation[]> {
  const body = await fetchWithResilience('copernicus-ems', 'Copernicus EMS', CEMS_API_URL, async () => {
    const res = await fetch(CEMS_API_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      void res.body?.cancel().catch(() => {})
      throw Object.assign(new Error(`Copernicus EMS: HTTP ${res.status}`), { statusCode: res.status })
    }
    return res.json() as Promise<{ results?: unknown }>
  })
  return Array.isArray(body?.results) ? body.results as CemsActivation[] : []
}

async function pollActivations(db: Knex, redis: Redis, producer?: Producer | null): Promise<void> {
  try {
    let list: CemsActivation[]
    try {
      list = await fetchActivations()
    } catch (err) {
      if (err instanceof CircuitOpenError) return
      throw err
    }
    if (!list.length) return

    const codes = list.map(a => String(a?.code || '').toUpperCase()).filter(c => /^EMSR\d+$/.test(c))
    const seen = new Set<string>()
    if (codes.length) {
      const hits = await redis.mget(...codes.map(c => `osint:cems:${c}`))
      codes.forEach((c, i) => { if (hits[i]) seen.add(c) })
    }

    let ingested = 0
    const fresh = newActivations(list, seen)
    const freshCodes = new Set(fresh.map(a => a.code.toUpperCase()))
    for (const a of fresh.slice(0, MAX_PER_POLL)) {
      const code = a.code.toUpperCase()
      const point = parseCentroid(a.centroid)
      const countryNames = (a.countries || []).map(c => String(c?.short_name || '').trim()).filter(Boolean)
      let countryCode: string | null = null
      if (countryNames.length) {
        try { countryCode = (await extractGeo(countryNames[0]!)).countryCode || null } catch { countryCode = null }
      }
      const { title, summary } = cemsText(a)
      const signalData = {
        title,
        summary,
        original_urls: [CEMS_PAGE(code)],
        source_ids: [],
        category: cemsCategory(a.category?.slug),
        severity: cemsSeverity(a),
        status: 'pending',
        reliability_score: RELIABILITY,
        location: point ? db.raw('ST_MakePoint(?, ?)', [point.lon, point.lat]) : null,
        location_name: cemsPlaceName(a),
        country_code: countryCode,
        region: null,
        tags: ['osint', 'copernicus', 'cems', 'disaster', ...(a.category?.slug ? [String(a.category.slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40)] : [])],
        language: 'en',
        event_time: activationTime(a) || new Date(),
        source_count: 1,
      }
      try {
        const signal = await insertAndCorrelate(signalData, { lat: point?.lat ?? null, lng: point?.lon ?? null, sourceId: 'copernicus-ems' })
        if (producer) {
          await producer.send({ topic: 'signals.verified', messages: [{ value: JSON.stringify(signal) }] })
        }
        await redis.set(`osint:cems:${code}`, '1', 'EX', DEDUP_TTL_S)
        ingested++
      } catch (err) {
        log.warn({ err, code }, 'Failed to ingest a Copernicus EMS activation')
      }
    }
    // Activations too old or not in the response phase are remembered too, so each is looked at once;
    // a new one whose insert failed, or beyond this poll's 10, is tried again next time
    const skip = codes.filter(c => !seen.has(c) && !freshCodes.has(c))
    if (skip.length) {
      const m = redis.multi()
      for (const c of skip) m.set(`osint:cems:${c}`, '1', 'EX', DEDUP_TTL_S, 'NX')
      await m.exec()
    }
    if (ingested > 0) log.info({ ingested }, 'Copernicus EMS activations ingested')
  } catch (err) {
    log.error({ err }, 'Copernicus EMS poll failed')
  }
}

export function startCopernicusEmsPoller(db: Knex, redis: Redis, producer?: Producer | null): () => void {
  log.info({ intervalMs: POLL_INTERVAL_MS }, 'Copernicus EMS activations poller started')
  void pollActivations(db, redis, producer)
  const timer = setInterval(() => void pollActivations(db, redis, producer), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
