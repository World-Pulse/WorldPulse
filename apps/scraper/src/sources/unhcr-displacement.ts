/**
 * UNHCR Population Displacement Signal Source
 *
 * Polls the UNHCR Refugee Data Finder API for population displacement
 * situations worldwide. Creates WorldPulse signals for refugee movements,
 * internal displacement, asylum-seeker surges, and statelessness crises.
 *
 * API: https://api.unhcr.org/population/v1/situations/
 * Docs: https://www.unhcr.org/refugee-statistics/
 * Free, no API key required, public humanitarian data.
 *
 * Reliability: 0.93 (UNHCR is the UN Refugee Agency — authoritative source
 *   for global displacement data, serving 100M+ displaced people worldwide)
 * Category: humanitarian
 *
 * Unique to WorldPulse — no competitor (Crucix, Shadowbroker, Ground News)
 * tracks UNHCR displacement situations as intelligence signals.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'unhcr-displacement-source' })

const UNHCR_API = 'https://api.unhcr.org/population/v1/situations/'
const RELIABILITY = 0.93
const DEDUP_TTL_S = 14 * 86_400 // 14-day dedup (displacement situations evolve slowly)
const POLL_INTERVAL_MS = Number(process.env.UNHCR_INTERVAL_MS) || 60 * 60_000 // 60 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** Keywords indicating critical displacement crises */
const CRITICAL_KEYWORDS = /mass displacement|ethnic cleansing|genocide|famine|war|armed conflict|siege|emergency declaration/i
const HIGH_KEYWORDS = /refugee crisis|influx|border surge|forced displacement|internal displacement|humanitarian emergency|protection crisis/i

/**
 * Map UNHCR displacement situations to WorldPulse severity based on
 * population figures, situation name, and country count.
 */
export function displacementSeverity(
  name: string,
  description: string,
  population: number,
  countryCount: number,
): SignalSeverity {
  const combined = `${name} ${description}`

  // Critical: 1M+ displaced, multi-region crises, or critical keywords
  if (population >= 1_000_000 || countryCount >= 8 || CRITICAL_KEYWORDS.test(combined)) return 'critical'

  // High: 100K+ displaced, significant situations, or high keywords
  if (population >= 100_000 || countryCount >= 4 || HIGH_KEYWORDS.test(combined)) return 'high'

  // Medium: 10K+ displaced or multi-country
  if (population >= 10_000 || countryCount >= 2) return 'medium'

  return 'low'
}

/**
 * Infer geographic center from UNHCR situation country list.
 */
export function inferDisplacementLocation(
  countries: string[],
): { lat: number; lon: number } | null {
  if (!countries || countries.length === 0) return null

  const first = countries[0]?.toUpperCase().trim()
  if (!first) return null

  return DISPLACEMENT_CENTROIDS[first] ?? null
}

/** Country/region centroids for major displacement situations */
const DISPLACEMENT_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  'UKRAINE': { lat: 48.38, lon: 31.17 },
  'SYRIA': { lat: 34.80, lon: 38.99 },
  'AFGHANISTAN': { lat: 33.94, lon: 67.71 },
  'SOUTH SUDAN': { lat: 6.88, lon: 31.31 },
  'MYANMAR': { lat: 21.91, lon: 95.96 },
  'DEMOCRATIC REPUBLIC OF THE CONGO': { lat: -4.04, lon: 21.76 },
  'SUDAN': { lat: 12.86, lon: 30.22 },
  'SOMALIA': { lat: 5.15, lon: 46.20 },
  'YEMEN': { lat: 15.55, lon: 48.52 },
  'VENEZUELA': { lat: 6.42, lon: -66.59 },
  'ETHIOPIA': { lat: 9.14, lon: 40.49 },
  'ERITREA': { lat: 15.18, lon: 39.78 },
  'PALESTINE': { lat: 31.95, lon: 35.23 },
  'HAITI': { lat: 18.97, lon: -72.29 },
  'NIGERIA': { lat: 9.08, lon: 7.49 },
  'COLOMBIA': { lat: 4.57, lon: -74.30 },
  'BANGLADESH': { lat: 23.68, lon: 90.36 },
  'MALI': { lat: 17.57, lon: -4.00 },
  'BURKINA FASO': { lat: 12.37, lon: -1.52 },
  'CENTRAL AFRICAN REPUBLIC': { lat: 6.61, lon: 20.94 },
  'IRAQ': { lat: 33.22, lon: 43.68 },
  'LEBANON': { lat: 33.85, lon: 35.86 },
  'JORDAN': { lat: 30.59, lon: 36.24 },
  'TURKEY': { lat: 38.96, lon: 35.24 },
  'PAKISTAN': { lat: 30.38, lon: 69.35 },
  'MOZAMBIQUE': { lat: -18.67, lon: 35.53 },
  'CHAD': { lat: 15.45, lon: 18.73 },
  'NIGER': { lat: 17.61, lon: 8.08 },
  'CAMEROON': { lat: 7.37, lon: 12.35 },
  'LIBYA': { lat: 26.34, lon: 17.23 },
}

// ─── API RESPONSE TYPES ─────────────────────────────────────────────────────

interface UnhcrSituation {
  id: number
  name: string
  description?: string
  url?: string
  countries?: Array<{ name: string; iso3?: string }>
  population?: number
  date?: string
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

export function startUnhcrDisplacementPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let timer: ReturnType<typeof setInterval>

  async function poll(): Promise<void> {
    try {
      log.info('Polling UNHCR displacement situations API')

      const res = await fetch(UNHCR_API, {
        headers: {
          'User-Agent': 'WorldPulse/1.0 (OSINT intelligence network)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        log.warn({ status: res.status }, 'UNHCR API returned non-OK status')
        return
      }

      const data = await res.json() as { items?: UnhcrSituation[] }
      const situations = data.items ?? []

      if (situations.length === 0) {
        log.debug('No displacement situations returned from UNHCR')
        return
      }

      log.info({ count: situations.length }, 'UNHCR displacement situations fetched')

      let inserted = 0

      for (const situation of situations.slice(0, 20)) {
        if (!situation.name) continue

        const dedupKey = `osint:unhcr:${situation.id}`
        const exists = await redis.get(dedupKey)
        if (exists) continue

        const countries = situation.countries?.map(c => c.name) ?? []
        const severity = displacementSeverity(
          situation.name,
          situation.description ?? '',
          situation.population ?? 0,
          countries.length,
        )
        const location = inferDisplacementLocation(countries)
        const countryNames = countries.slice(0, 10).join(', ')

        const signalData = {
          title: `Displacement Crisis: ${situation.name.slice(0, 200)}`,
          summary: (situation.description ?? `UNHCR situation affecting ${countryNames || 'multiple regions'}. Population of concern: ${(situation.population ?? 0).toLocaleString()}.`).slice(0, 2000),
          original_urls: [situation.url ?? `https://www.unhcr.org/refugee-statistics/`],
          source_ids: [],
          category: 'humanitarian' as const,
          severity,
          status: 'pending',
          reliability_score: RELIABILITY,
          location: location ? db.raw('ST_MakePoint(?, ?)', [location.lng, location.lat]) : null,
          location_name: countryNames || 'Multiple regions',
          country_code: null,
          region: null,
          tags: ['osint', 'humanitarian', 'unhcr', 'displacement', 'refugee'],
          language: 'en',
          event_time: situation.date ? new Date(situation.date) : new Date(),
          source_count: 1,
        }

        await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lng ?? null, sourceId: 'unhcr-displacement' })
        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)

        if (producer) {
          try {
            await producer.send({
              topic: 'worldpulse.signals.new',
              messages: [{ value: JSON.stringify(signal) }],
            })
          } catch (kafkaErr) {
            log.warn({ kafkaErr }, 'Failed to publish UNHCR signal to Kafka')
          }
        }

        inserted++
      }

      if (inserted > 0) {
        log.info({ inserted }, 'New UNHCR displacement signals created')
      }
    } catch (err) {
      log.error({ err }, 'UNHCR displacement poll error')
    }
  }

  // Initial poll
  void poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    log.info('UNHCR displacement poller stopped')
  }
}
