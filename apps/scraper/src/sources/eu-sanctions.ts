/**
 * EU CFSP Sanctions Signal Source
 *
 * Reports each amendment of an EU sanctions regime (new listings, extensions,
 * changed measures), read from the EU Sanctions Map: every regime carries the
 * date of its latest amendment (`amendment`, unix seconds). A regime amended in
 * the last 7 days becomes one signal per amendment.
 *
 * API: https://www.sanctionsmap.eu/api/v1/regime (public, no key; ~55 regimes)
 * Until Oct 2026 this read `programme_name`/`programme` (not fields of this API;
 * `programme` is a list), so every poll failed, and it would have re-posted the
 * same regimes as news every 14 days rather than reporting changes.
 *
 * Reliability: 0.96 (EU Council is the authoritative source for EU sanctions;
 *   CFSP designations are legally binding across all EU member states)
 * Category: security
 *
 * Unique to WorldPulse — complements OFAC sanctions with European perspective.
 * No competitor (Crucix, Shadowbroker, Ground News) tracks EU sanctions.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'eu-sanctions-source' })

const EU_SANCTIONS_URL = 'https://www.sanctionsmap.eu/api/v1/regime?lang=en'
const RELIABILITY = 0.96
const DEDUP_TTL_S = 30 * 86_400 // one signal per amendment
const MAX_AGE_DAYS = 7
const POLL_INTERVAL_MS = Number(process.env.EU_SANCTIONS_INTERVAL_MS) || 60 * 60_000 // 60 min (EU updates less frequently)

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** Critical: Russia, Belarus, Iran, DPRK, Syria — major geopolitical sanctions regimes */
const CRITICAL_REGIMES = /russia|belarus|iran|north korea|dprk|syria|terrorism|chemical weapons|cyber/i

/** High: Myanmar, Mali, Libya, Venezuela, humanitarian/arms embargo regimes */
const HIGH_REGIMES = /myanmar|burma|mali|libya|venezuela|south sudan|somalia|central african|guinea|afghanistan|haiti|nicaragua|human rights|arms embargo|proliferation/i

/** Medium: thematic sanctions, asset freezes, travel bans on individuals */
const MEDIUM_REGIMES = /tunisia|lebanon|moldova|bosnia|misappropriation|threat to peace/i

/**
 * Map EU sanctions regime to WorldPulse severity based on regime
 * name, description, and geopolitical significance.
 */
export function euSanctionsSeverity(
  regimeName: string,
  description: string,
): SignalSeverity {
  const combined = `${regimeName} ${description}`

  if (CRITICAL_REGIMES.test(combined)) return 'critical'
  if (HIGH_REGIMES.test(combined)) return 'high'
  if (MEDIUM_REGIMES.test(combined)) return 'medium'

  return 'low'
}

// ─── GEOLOCATION ────────────────────────────────────────────────────────────

/** Map common EU sanctions regime countries to approximate centroids */
const REGIME_COORDS: Record<string, { lat: number; lon: number }> = {
  russia: { lat: 55.75, lon: 37.62 },
  belarus: { lat: 53.90, lon: 27.57 },
  iran: { lat: 35.69, lon: 51.39 },
  'north korea': { lat: 39.02, lon: 125.75 },
  dprk: { lat: 39.02, lon: 125.75 },
  syria: { lat: 33.51, lon: 36.29 },
  myanmar: { lat: 19.76, lon: 96.07 },
  burma: { lat: 19.76, lon: 96.07 },
  mali: { lat: 12.64, lon: -8.00 },
  libya: { lat: 32.90, lon: 13.18 },
  venezuela: { lat: 10.49, lon: -66.88 },
  'south sudan': { lat: 4.85, lon: 31.58 },
  somalia: { lat: 2.05, lon: 45.34 },
  'central african': { lat: 4.36, lon: 18.56 },
  guinea: { lat: 9.64, lon: -13.58 },
  afghanistan: { lat: 34.53, lon: 69.17 },
  haiti: { lat: 18.54, lon: -72.34 },
  nicaragua: { lat: 12.13, lon: -86.27 },
  tunisia: { lat: 36.81, lon: 10.18 },
  lebanon: { lat: 33.89, lon: 35.50 },
  moldova: { lat: 47.01, lon: 28.86 },
  bosnia: { lat: 43.86, lon: 18.41 },
}

/**
 * Infer geolocation from EU sanctions regime name.
 * Falls back to Brussels (EU headquarters) if no country match.
 */
export function inferEuSanctionsLocation(
  regimeName: string,
): { lat: number; lon: number } {
  const lower = regimeName.toLowerCase()
  for (const [key, coords] of Object.entries(REGIME_COORDS)) {
    if (lower.includes(key)) return coords
  }
  // Default: Brussels (EU Council headquarters)
  return { lat: 50.85, lon: 4.35 }
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

/** A regime as the EU Sanctions Map API returns it (only the fields used) */
interface EuRegime {
  id?: unknown
  specification?: unknown
  notes?: unknown
  amendment?: unknown
  country?: { data?: unknown } | null
}

export interface EuAmendment {
  id: number
  /** e.g. "Restrictive measures in view of the situation in Nicaragua" */
  name: string
  /** The regime's country (or countries), "" for thematic regimes */
  country: string
  amendedAt: Date
  /** Unix seconds as the API gives it, part of the dedup key */
  amendment: number
  notes: string
  url: string
}

/** Regimes amended in the last `days` days, newest first */
export function recentEuAmendments(regimes: unknown, now: number = Date.now(), days: number = MAX_AGE_DAYS): EuAmendment[] {
  if (!Array.isArray(regimes)) return []
  const cutoff = now - days * 86_400_000
  const out: EuAmendment[] = []
  for (const r of regimes as EuRegime[]) {
    if (!r || typeof r.id !== 'number' || typeof r.specification !== 'string' || !r.specification.trim()) continue
    if (typeof r.amendment !== 'number') continue
    const at = r.amendment * 1000
    if (at <= cutoff || at > now + 86_400_000) continue
    const data = r.country?.data
    const countries = (Array.isArray(data) ? data : data ? [data] : [])
      .map(c => (c && typeof c === 'object' && typeof (c as { title?: unknown }).title === 'string') ? (c as { title: string }).title : '')
      .filter(Boolean)
    out.push({
      id: r.id,
      name: r.specification.replace(/\s+/g, ' ').trim(),
      country: countries.join(', '),
      amendedAt: new Date(at),
      amendment: r.amendment,
      notes: typeof r.notes === 'string' ? r.notes.replace(/\s+/g, ' ').trim() : '',
      url: `https://www.sanctionsmap.eu/#/main/details/${r.id}`,
    })
  }
  return out.sort((a, b) => b.amendedAt.getTime() - a.amendedAt.getTime())
}

async function fetchEuRegimes(): Promise<unknown> {
  try {
    const body = await fetchWithResilience(
      'eu-sanctions',
      'EU Sanctions',
      EU_SANCTIONS_URL,
      async () => {
        const res = await fetch(EU_SANCTIONS_URL, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'WorldPulse-OSINT/1.0 (open-source intelligence aggregator)',
          },
          signal: AbortSignal.timeout(60_000), // ~400 KB
        })
        if (!res.ok) throw Object.assign(new Error(`EU Sanctions: HTTP ${res.status}`), { statusCode: res.status })
        return res.json() as Promise<unknown>
      },
    )
    return Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data
  } catch (err) {
    if (err instanceof CircuitOpenError) return []
    log.error({ err }, 'Failed to fetch EU sanctions data')
    return []
  }
}

async function pollEuSanctions(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  try {
    log.debug('Polling EU sanctions regimes for amendments…')

    const amendments = recentEuAmendments(await fetchEuRegimes())
    let inserted = 0

    for (const a of amendments) {
      const dedupKey = `osint:eu-sanctions:${a.id}:${a.amendment}`
      if (await redis.get(dedupKey)) continue

      const severity = euSanctionsSeverity(a.name, a.notes)
      const { lat, lon } = inferEuSanctionsLocation(`${a.name} ${a.country}`)
      const day = a.amendedAt.toLocaleDateString('en-GB', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric' })

      const signalData = {
        title: `EU sanctions amended: ${a.name}`.slice(0, 300),
        summary: `The EU amended its sanctions regime "${a.name}"${a.country ? ` (${a.country})` : ''} on ${day}. ${a.notes}`.trim().slice(0, 800),
        original_urls: [a.url],
        source_ids: [],
        category: 'security',
        severity,
        status: 'pending',
        reliability_score: RELIABILITY,
        location: db.raw('ST_MakePoint(?, ?)', [lon, lat]),
        location_name: a.country || 'European Union',
        country_code: null,
        region: null,
        tags: ['osint', 'sanctions', 'eu', 'security'],
        language: 'en',
        event_time: a.amendedAt,
        source_count: 1,
      }

      try {
        const signal = await insertAndCorrelate(signalData, { lat, lng: lon, sourceId: 'eu-sanctions' })

        if (producer) {
          await producer.send({
            topic: 'signals',
            messages: [{ key: String(signal['source_id'] ?? ''), value: JSON.stringify(signal) }],
          })
        }

        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        inserted++
      } catch (err) {
        log.error({ err, regimeId: a.id }, 'Failed to insert EU sanctions signal')
      }
    }

    log.info({ inserted, amended: amendments.length }, 'EU sanctions poll complete')
  } catch (err) {
    log.error({ err }, 'EU sanctions poll failed')
  }
}

// ─── EXPORTED START FUNCTION ────────────────────────────────────────────────

export function startEuSanctionsPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  log.info(`Starting EU CFSP Sanctions poller (interval ${POLL_INTERVAL_MS / 60_000} min)`)
  pollEuSanctions(db, redis, producer).catch(err =>
    log.error({ err }, 'Initial EU sanctions poll failed'),
  )
  const timer = setInterval(
    () => pollEuSanctions(db, redis, producer).catch(err =>
      log.error({ err }, 'EU sanctions poll failed'),
    ),
    POLL_INTERVAL_MS,
  )
  return () => {
    clearInterval(timer)
    log.info('EU CFSP Sanctions poller stopped')
  }
}