/**
 * EU CFSP Sanctions Signal Source
 *
 * Polls the European Union Consolidated Financial Sanctions List (CFSP)
 * via the EU Sanctions Map API for newly listed/updated sanctioned entities.
 * Creates WorldPulse signals for EU sanctions events affecting global
 * trade, diplomacy, and security.
 *
 * API: https://www.sanctionsmap.eu/api/v1/regime
 * Backup: https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content
 * Free, no API key required. European Commission public data.
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

const log = rootLogger.child({ module: 'eu-sanctions-source' })

const EU_SANCTIONS_URL = 'https://www.sanctionsmap.eu/api/v1/regime?lang=en'
const EU_SANCTIONS_FALLBACK_URL = 'https://data.europa.eu/api/hub/search/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions'
const RELIABILITY = 0.96
const DEDUP_TTL_S = 14 * 86_400 // 14-day dedup (sanctions are persistent)
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

interface EuRegime {
  id?: number
  programme?: string
  programme_name?: string
  url?: string
  description?: string
  adoption_date?: string
  last_updated?: string
}

async function fetchEuSanctions(): Promise<EuRegime[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(EU_SANCTIONS_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WorldPulse-OSINT/1.0 (open-source intelligence aggregator)',
      },
    })

    if (!res.ok) {
      log.warn({ status: res.status }, 'EU Sanctions API returned non-OK status')
      return []
    }

    const data = await res.json()
    // API may return { data: [...] } or [...] depending on version
    return Array.isArray(data) ? data : (data?.data ?? data?.regimes ?? [])
  } catch (err) {
    log.error({ err }, 'Failed to fetch EU sanctions data')
    return []
  } finally {
    clearTimeout(timeout)
  }
}

async function pollEuSanctions(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  log.debug('Polling EU CFSP sanctions regimes…')

  const regimes = await fetchEuSanctions()
  if (regimes.length === 0) {
    log.debug('No EU sanctions regimes returned')
    return
  }

  let inserted = 0

  for (const regime of regimes.slice(0, 20)) {
    const name = regime.programme_name || regime.programme || 'Unknown Regime'
    const desc = regime.description || ''
    const regimeId = regime.id ?? name.slice(0, 50)
    const dedupKey = `osint:eu-sanctions:${regimeId}`

    // Skip if recently seen
    const seen = await redis.get(dedupKey)
    if (seen) continue

    const severity = euSanctionsSeverity(name, desc)
    const { lat, lon } = inferEuSanctionsLocation(name)

    const signalData = {
      title: `EU Sanctions: ${name}`,
      summary: desc.slice(0, 500) || `European Union CFSP sanctions regime: ${name}`,
      original_urls: [regime.url || `https://www.sanctionsmap.eu/#/main/details/${regimeId}`],
      source_ids: [],
      category: 'security',
      severity,
      status: 'pending',
      reliability_score: RELIABILITY,
      location: db.raw('ST_MakePoint(?, ?)', [lon, lat]),
      location_name: name,
      country_code: null,
      region: null,
      tags: ['osint', 'sanctions', 'eu', 'security'],
      language: 'en',
      event_time: new Date(),
      source_count: 1,
    }

    try {
      const signal = await insertAndCorrelate(signalData, { lat, lng: lon, sourceId: 'eu-sanctions' })

      if (producer) {
        await producer.send({
          topic: 'signals',
          messages: [{ key: signal.source_id, value: JSON.stringify(signal) }],
        })
      }

      await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
      inserted++
    } catch (err) {
      log.error({ err, regimeId }, 'Failed to insert EU sanctions signal')
    }
  }

  log.info({ inserted, total: regimes.length }, 'EU CFSP sanctions poll complete')
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
  return () => clearInterval(timer)
}
