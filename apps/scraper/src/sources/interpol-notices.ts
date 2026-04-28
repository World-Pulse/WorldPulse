/**
 * Interpol Red Notice Signal Source
 *
 * Polls the Interpol public REST API for recently published Red Notices
 * (wanted persons) and Yellow Notices (missing persons). Creates WorldPulse
 * signals for international law enforcement and security situations.
 *
 * API: https://ws-public.interpol.int/notices/v1/red
 * Docs: https://interpol.api.bund.dev/ (community docs)
 * Free, no API key required, public law enforcement data.
 *
 * Reliability: 0.96 (INTERPOL is the world's largest international police
 *   organization with 196 member countries)
 * Category: security
 *
 * Unique to WorldPulse — no competitor (Crucix, Shadowbroker, Ground News)
 * tracks Interpol notices as intelligence signals.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'interpol-notices-source' })

const INTERPOL_RED_API = 'https://ws-public.interpol.int/notices/v1/red'
const RELIABILITY = 0.96
const DEDUP_TTL_S = 30 * 86_400 // 30-day dedup (notices persist long)
const POLL_INTERVAL_MS = Number(process.env.INTERPOL_INTERVAL_MS) || 60 * 60_000 // 60 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** Charge keywords indicating critical-severity offenses */
const CRITICAL_CHARGES = /terrorism|war crime|genocide|human trafficking|chemical|biological|nuclear|weapons of mass|mass murder|crime against humanity/i
const HIGH_CHARGES = /murder|homicide|kidnapping|armed robbery|drug trafficking|money laundering|cybercrime|sexual exploitation|child abuse|organized crime|extortion/i

/**
 * Map Interpol Red Notice charges to WorldPulse severity based on
 * the nature of the alleged offenses and nationality diversity.
 */
export function noticeSeverity(
  charges: string,
  nationalityCount: number,
): SignalSeverity {
  // Critical: terrorism, war crimes, WMD, mass atrocities
  if (CRITICAL_CHARGES.test(charges)) return 'critical'

  // High: violent crime, major trafficking, multi-national involvement
  if (HIGH_CHARGES.test(charges) || nationalityCount >= 3) return 'high'

  // Medium: other serious international crimes
  if (nationalityCount >= 2) return 'medium'

  return 'low'
}

/**
 * Infer geographic location from Interpol notice nationality/country data.
 */
export function inferNoticeLocation(
  nationalities: string[],
  issuingCountry?: string,
): { lat: number; lon: number } | null {
  // Prefer issuing country for location (where the crime happened)
  const primary = issuingCountry ?? nationalities[0]
  if (!primary) return null

  const key = primary.toUpperCase().trim()
  return NOTICE_CENTROIDS[key] ?? null
}

/** Country centroids for Interpol notice locations */
const NOTICE_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  'US': { lat: 38.90, lon: -77.04 },
  'GB': { lat: 51.51, lon: -0.13 },
  'FR': { lat: 48.86, lon: 2.35 },
  'DE': { lat: 52.52, lon: 13.41 },
  'RU': { lat: 55.76, lon: 37.62 },
  'CN': { lat: 39.90, lon: 116.41 },
  'BR': { lat: -15.79, lon: -47.88 },
  'IN': { lat: 28.61, lon: 77.21 },
  'MX': { lat: 19.43, lon: -99.13 },
  'CO': { lat: 4.71, lon: -74.07 },
  'AR': { lat: -34.60, lon: -58.38 },
  'TR': { lat: 39.93, lon: 32.86 },
  'EG': { lat: 30.04, lon: 31.24 },
  'NG': { lat: 9.06, lon: 7.49 },
  'ZA': { lat: -25.75, lon: 28.19 },
  'SA': { lat: 24.71, lon: 46.68 },
  'AE': { lat: 25.20, lon: 55.27 },
  'IR': { lat: 35.69, lon: 51.39 },
  'PK': { lat: 33.69, lon: 73.04 },
  'JP': { lat: 35.68, lon: 139.69 },
  'KR': { lat: 37.57, lon: 126.98 },
  'AU': { lat: -33.87, lon: 151.21 },
  'IT': { lat: 41.90, lon: 12.50 },
  'ES': { lat: 40.42, lon: -3.70 },
  'NL': { lat: 52.37, lon: 4.90 },
  'PL': { lat: 52.23, lon: 21.01 },
  'UA': { lat: 50.45, lon: 30.52 },
  'TH': { lat: 13.76, lon: 100.50 },
  'ID': { lat: -6.21, lon: 106.85 },
  'PH': { lat: 14.60, lon: 120.98 },
}

// ─── API RESPONSE TYPES ─────────────────────────────────────────────────────

interface InterpolNotice {
  entity_id: string
  name?: string
  forename?: string
  date_of_birth?: string
  nationalities?: string[]
  charge?: string
  issuing_country_id?: string
  _links?: {
    self?: { href?: string }
    thumbnail?: { href?: string }
  }
}

interface InterpolResponse {
  total: number
  _embedded?: {
    notices?: InterpolNotice[]
  }
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

export function startInterpolNoticesPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let timer: ReturnType<typeof setInterval>

  async function poll(): Promise<void> {
    try {
      log.info('Polling Interpol Red Notices API')

      const params = new URLSearchParams({
        resultPerPage: '20',
        page: '1',
      })

      const fetchUrl = `${INTERPOL_RED_API}?${params}`
      let data: InterpolResponse
      try {
        data = await fetchWithResilience(
          'interpol-notices',
          'Interpol Notices',
          fetchUrl,
          async () => {
            const res = await fetch(fetchUrl, {
              headers: {
                'User-Agent': 'WorldPulse/1.0 (OSINT intelligence network)',
                'Accept': 'application/json',
              },
              signal: AbortSignal.timeout(30_000),
            })
            if (!res.ok) throw Object.assign(new Error(`Interpol Notices: HTTP ${res.status}`), { statusCode: res.status })
            return res.json() as Promise<InterpolResponse>
          },
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }
      const notices = data._embedded?.notices ?? []

      if (notices.length === 0) {
        log.debug('No Red Notices returned from Interpol')
        return
      }

      log.info({ count: notices.length, total: data.total }, 'Interpol Red Notices fetched')

      let inserted = 0

      for (const notice of notices) {
        if (!notice.entity_id) continue

        const dedupKey = `osint:interpol:${notice.entity_id}`
        const exists = await redis.get(dedupKey)
        if (exists) continue

        const fullName = [notice.forename, notice.name].filter(Boolean).join(' ') || 'Unknown'
        const nationalities = notice.nationalities ?? []
        const charges = notice.charge ?? ''
        const severity = noticeSeverity(charges, nationalities.length)
        const location = inferNoticeLocation(nationalities, notice.issuing_country_id)

        const signalData = {
          title: `Interpol Red Notice: ${fullName.slice(0, 180)}`,
          summary: (charges || `International wanted person alert for ${fullName}. Nationalities: ${nationalities.join(', ') || 'undisclosed'}.`).slice(0, 2000),
          original_urls: [notice._links?.self?.href ?? 'https://www.interpol.int/en/How-we-work/Notices/Red-Notices'],
          source_ids: [],
          category: 'security' as const,
          severity,
          status: 'pending',
          reliability_score: RELIABILITY,
          location: location ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]) : null,
          location_name: 'Unknown',
          country_code: null,
          region: null,
          tags: ['osint', 'security', 'interpol', 'law-enforcement', 'red-notice'],
          language: 'en',
          event_time: new Date(),
          source_count: 1,
        }

        await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'interpol-notices' })
        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)

        if (producer) {
          try {
            await producer.send({
              topic: 'worldpulse.signals.new',
              messages: [{ value: JSON.stringify(signalData) }],
            })
          } catch (kafkaErr) {
            log.warn({ kafkaErr }, 'Failed to publish Interpol signal to Kafka')
          }
        }

        inserted++
      }

      if (inserted > 0) {
        log.info({ inserted }, 'New Interpol Red Notice signals created')
      }
    } catch (err) {
      log.error({ err }, 'Interpol notices poll error')
    }
  }

  // Initial poll
  void poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    log.info('Interpol notices poller stopped')
  }
}
