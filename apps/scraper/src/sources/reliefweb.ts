/**
 * UN ReliefWeb Humanitarian Crisis Signal Source
 *
 * Polls the UN OCHA ReliefWeb API for active disasters and humanitarian
 * crises worldwide. Creates WorldPulse signals for natural disasters,
 * complex emergencies, epidemics, and humanitarian access disruptions.
 *
 * API: https://api.reliefweb.int/v1/disasters
 * Docs: https://apidoc.rwlabs.org/
 * Free, no API key required, public humanitarian data.
 *
 * Reliability: 0.94 (UN OCHA is the authoritative coordinator for
 *   global humanitarian response; ReliefWeb is the #1 humanitarian
 *   information portal serving 300K+ aid workers worldwide)
 * Category: humanitarian
 *
 * Unique to WorldPulse — no competitor (Crucix, Shadowbroker, Ground News)
 * tracks UN humanitarian disasters as intelligence signals.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'reliefweb-source' })

const RELIEFWEB_API = 'https://api.reliefweb.int/v1/disasters'
const RELIABILITY = 0.94
const DEDUP_TTL_S = 7 * 86_400 // 7-day dedup
const POLL_INTERVAL_MS = Number(process.env.RELIEFWEB_INTERVAL_MS) || 30 * 60_000 // 30 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** ReliefWeb disaster status to severity mapping */
const STATUS_SEVERITY: Record<string, SignalSeverity> = {
  alert: 'high',
  ongoing: 'medium',
  past: 'low',
}

/** Disaster type keywords that escalate severity */
const CRITICAL_TYPES = /earthquake|tsunami|cyclone|hurricane|typhoon|volcano|famine|genocide|armed conflict|complex emergency/i
const HIGH_TYPES = /flood|epidemic|drought|landslide|wildfire|storm|displacement|refugee/i

/**
 * Map ReliefWeb disaster entries to WorldPulse severity based on
 * disaster type, status, and affected country count.
 */
export function disasterSeverity(
  name: string,
  typeName: string,
  status: string,
  countryCount: number,
): SignalSeverity {
  const combined = `${name} ${typeName}`

  // Critical: mega-disasters, multi-country crises, or critical keywords
  if (countryCount >= 5 || CRITICAL_TYPES.test(combined)) return 'critical'

  // High: significant natural disasters or status=alert
  if (HIGH_TYPES.test(combined) || status === 'alert') return 'high'

  // Medium: ongoing disasters
  if (status === 'ongoing') return 'medium'

  return STATUS_SEVERITY[status] ?? 'low'
}

/**
 * Extract primary country coordinates from ReliefWeb disaster country list.
 * Uses the first country's lat/lon if available.
 */
export function extractDisasterLocation(
  countries: Array<{ iso3?: string; name?: string; location?: { lat?: number; lon?: number } }>,
): { lat: number; lon: number } | null {
  if (!countries || countries.length === 0) return null

  // ReliefWeb API sometimes includes location in country fields
  for (const c of countries) {
    if (c.location?.lat != null && c.location?.lon != null) {
      return { lat: c.location.lat, lon: c.location.lon }
    }
  }

  // Fallback: infer from country name/ISO3
  return inferCountryCenter(countries[0]?.name ?? '', countries[0]?.iso3 ?? '')
}

/** Country centroid lookup for common humanitarian crisis locations */
const COUNTRY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  AFG: { lat: 33.94, lon: 67.71 },
  SYR: { lat: 34.80, lon: 38.99 },
  YEM: { lat: 15.55, lon: 48.52 },
  SDN: { lat: 12.86, lon: 30.22 },
  SSD: { lat: 6.88, lon: 31.31 },
  COD: { lat: -4.04, lon: 21.76 },
  MMR: { lat: 21.91, lon: 95.96 },
  ETH: { lat: 9.14, lon: 40.49 },
  SOM: { lat: 5.15, lon: 46.20 },
  HTI: { lat: 18.97, lon: -72.29 },
  UKR: { lat: 48.38, lon: 31.17 },
  PSE: { lat: 31.95, lon: 35.23 },
  NGA: { lat: 9.08, lon: 7.49 },
  MOZ: { lat: -18.67, lon: 35.53 },
  BGD: { lat: 23.68, lon: 90.36 },
  PAK: { lat: 30.38, lon: 69.35 },
  TUR: { lat: 38.96, lon: 35.24 },
  LBY: { lat: 26.34, lon: 17.23 },
  IRQ: { lat: 33.22, lon: 43.68 },
  MLI: { lat: 17.57, lon: -4.00 },
  BFA: { lat: 12.37, lon: -1.52 },
  NER: { lat: 17.61, lon: 8.08 },
  TCD: { lat: 15.45, lon: 18.73 },
  CMR: { lat: 7.37, lon: 12.35 },
  CAF: { lat: 6.61, lon: 20.94 },
  LBN: { lat: 33.85, lon: 35.86 },
  PHL: { lat: 12.88, lon: 121.77 },
  IDN: { lat: -0.79, lon: 113.92 },
  NPL: { lat: 28.39, lon: 84.12 },
  IND: { lat: 20.59, lon: 78.96 },
  CHN: { lat: 35.86, lon: 104.20 },
  BRA: { lat: -14.24, lon: -51.93 },
  MEX: { lat: 23.63, lon: -102.55 },
  CHL: { lat: -35.68, lon: -71.54 },
  JPN: { lat: 36.20, lon: 138.25 },
}

function inferCountryCenter(name: string, iso3: string): { lat: number; lon: number } | null {
  if (iso3 && COUNTRY_CENTROIDS[iso3.toUpperCase()]) {
    return COUNTRY_CENTROIDS[iso3.toUpperCase()]
  }
  return null
}

// ─── API RESPONSE TYPES ─────────────────────────────────────────────────────

interface ReliefWebDisaster {
  id: number
  fields: {
    name: string
    description?: string
    status: string
    date?: { created?: string }
    type?: Array<{ name: string; code: string }>
    country?: Array<{ iso3?: string; name?: string; location?: { lat?: number; lon?: number } }>
    primary_country?: { iso3?: string; name?: string; location?: { lat?: number; lon?: number } }
    glide?: string
  }
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

export function startReliefWebPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let timer: ReturnType<typeof setInterval>

  async function poll(): Promise<void> {
    try {
      log.info('Polling UN ReliefWeb disasters API')

      // Fetch recent disasters updated in the last 30 days
      const params = new URLSearchParams({
        'appname': 'worldpulse-osint',
        'preset': 'latest',
        'limit': '20',
        'fields[include][]': 'name,description,status,date,type,country,primary_country,glide',
        'sort[]': 'date.created:desc',
      })

      const res = await fetch(`${RELIEFWEB_API}?${params}`, {
        headers: {
          'User-Agent': 'WorldPulse/1.0 (OSINT intelligence network)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        log.warn({ status: res.status }, 'ReliefWeb API returned non-OK status')
        return
      }

      const data = await res.json() as { data?: ReliefWebDisaster[] }
      const disasters = data.data ?? []

      if (disasters.length === 0) {
        log.debug('No disasters returned from ReliefWeb')
        return
      }

      log.info({ count: disasters.length }, 'ReliefWeb disasters fetched')

      let inserted = 0

      for (const disaster of disasters) {
        const { fields } = disaster
        if (!fields?.name) continue

        const dedupKey = `osint:reliefweb:${disaster.id}`
        const exists = await redis.get(dedupKey)
        if (exists) continue

        const countries = fields.country ?? (fields.primary_country ? [fields.primary_country] : [])
        const typeName = fields.type?.[0]?.name ?? 'unknown'
        const severity = disasterSeverity(
          fields.name,
          typeName,
          fields.status,
          countries.length,
        )
        const location = extractDisasterLocation(countries)
        const countryNames = countries.map(c => c.name).filter(Boolean).join(', ')

        const signalData = {
          title: `UN Crisis: ${fields.name.slice(0, 200)}`,
          summary: (fields.description ?? `${typeName} affecting ${countryNames || 'multiple regions'}. Status: ${fields.status}.`).slice(0, 2000),
          original_urls: [`https://reliefweb.int/disaster/${disaster.id}`],
          source_ids: [],
          category: 'humanitarian' as const,
          severity,
          status: 'pending',
          reliability_score: RELIABILITY,
          location: location ? db.raw('ST_MakePoint(?, ?)', [location.lng, location.lat]) : null,
          location_name: countryNames || 'Multiple regions',
          country_code: null,
          region: null,
          tags: ['osint', 'humanitarian', 'reliefweb', 'un', typeName?.toLowerCase()].filter(Boolean),
          language: 'en',
          event_time: fields.date?.created ? new Date(fields.date.created) : new Date(),
          source_count: 1,
        }

        await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lng ?? null, sourceId: 'reliefweb' })
        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)

        if (producer) {
          try {
            await producer.send({
              topic: 'worldpulse.signals.new',
              messages: [{ value: JSON.stringify(signal) }],
            })
          } catch (kafkaErr) {
            log.warn({ kafkaErr }, 'Failed to publish ReliefWeb signal to Kafka')
          }
        }

        inserted++
      }

      if (inserted > 0) {
        log.info({ inserted }, 'New ReliefWeb humanitarian signals created')
      }
    } catch (err) {
      log.error({ err }, 'ReliefWeb poll error')
    }
  }

  // Initial poll
  void poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    log.info('ReliefWeb humanitarian poller stopped')
  }
}
