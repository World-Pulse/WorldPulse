/**
 * NOAA National Weather Service (NWS) Severe Weather Alert Source
 *
 * Polls the NWS CAP/ATOM alerts feed for active severe weather events
 * across the United States and territories. Creates WorldPulse signals
 * for tornadoes, hurricanes, severe thunderstorms, flooding, blizzards,
 * and other dangerous weather events.
 *
 * API: https://api.weather.gov/alerts/active
 * Docs: https://www.weather.gov/documentation/services-web-api
 * Free, no API key required. US Government public data.
 *
 * Reliability: 0.96 (NOAA NWS is the authoritative US weather warning
 *   authority; CAP alerts are official emergency notifications)
 * Category: weather
 *
 * Unique to WorldPulse — no competitor (Crucix, Shadowbroker, Ground News)
 * tracks NWS severe weather alerts as intelligence signals.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'nws-alerts-source' })

const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert&severity=Extreme,Severe'
const RELIABILITY = 0.96
const DEDUP_TTL_S = 3 * 86_400 // 3-day dedup
const POLL_INTERVAL_MS = Number(process.env.NWS_INTERVAL_MS) || 10 * 60_000 // 10 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/** NWS CAP severity levels → WorldPulse severity */
const CAP_SEVERITY_MAP: Record<string, SignalSeverity> = {
  Extreme: 'critical',
  Severe: 'high',
  Moderate: 'medium',
  Minor: 'low',
  Unknown: 'low',
}

/** Event types that always escalate to critical regardless of CAP severity */
const CRITICAL_EVENTS = /tornado warning|hurricane warning|tsunami warning|extreme wind warning|flash flood emergency|storm surge warning|nuclear power plant warning/i

/** Event types that escalate to high */
const HIGH_EVENTS = /tornado watch|hurricane watch|severe thunderstorm warning|blizzard warning|ice storm warning|flood warning|winter storm warning|fire weather warning|red flag warning|excessive heat warning/i

/**
 * Map NWS alert properties to WorldPulse severity based on
 * CAP severity, event type, and urgency.
 */
export function nwsSeverity(
  capSeverity: string,
  event: string,
  urgency: string,
): SignalSeverity {
  // Critical: life-threatening events always escalate
  if (CRITICAL_EVENTS.test(event)) return 'critical'

  // High: significant severe weather events
  if (HIGH_EVENTS.test(event)) return 'high'

  // Immediate urgency bumps severity up by one level
  if (urgency === 'Immediate') {
    const base = CAP_SEVERITY_MAP[capSeverity] ?? 'medium'
    if (base === 'high') return 'critical'
    if (base === 'medium') return 'high'
    return base
  }

  return CAP_SEVERITY_MAP[capSeverity] ?? 'medium'
}

/**
 * Extract a representative coordinate from NWS alert geometry or
 * affected zones. Returns centroid of the first polygon if available,
 * otherwise falls back to known state centroids.
 */
export function extractNwsLocation(
  geometry: { type?: string; coordinates?: number[][][] } | null,
  areaDesc: string,
): { lat: number; lon: number } | null {
  // Use geometry centroid if polygon data is present
  if (geometry?.type === 'Polygon' && geometry.coordinates?.[0]?.length) {
    const ring = geometry.coordinates[0]
    let latSum = 0
    let lonSum = 0
    for (const [lon, lat] of ring) {
      latSum += lat
      lonSum += lon
    }
    return {
      lat: latSum / ring.length,
      lon: lonSum / ring.length,
    }
  }

  // Fallback: infer from area description using US state centroids
  const stateCentroids: Record<string, { lat: number; lon: number }> = {
    'AL': { lat: 32.32, lon: -86.90 }, 'AK': { lat: 63.59, lon: -154.49 },
    'AZ': { lat: 34.05, lon: -111.09 }, 'AR': { lat: 35.20, lon: -91.83 },
    'CA': { lat: 36.78, lon: -119.42 }, 'CO': { lat: 39.55, lon: -105.78 },
    'CT': { lat: 41.60, lon: -72.76 }, 'DE': { lat: 38.91, lon: -75.53 },
    'FL': { lat: 27.66, lon: -81.52 }, 'GA': { lat: 32.17, lon: -82.91 },
    'HI': { lat: 19.90, lon: -155.58 }, 'ID': { lat: 44.07, lon: -114.74 },
    'IL': { lat: 40.63, lon: -89.40 }, 'IN': { lat: 40.27, lon: -86.13 },
    'IA': { lat: 41.88, lon: -93.10 }, 'KS': { lat: 39.01, lon: -98.48 },
    'KY': { lat: 37.84, lon: -84.27 }, 'LA': { lat: 30.98, lon: -91.96 },
    'TX': { lat: 31.97, lon: -99.90 }, 'OK': { lat: 35.01, lon: -97.09 },
    'NY': { lat: 42.17, lon: -74.95 }, 'PA': { lat: 41.20, lon: -77.19 },
    'OH': { lat: 40.42, lon: -82.91 }, 'MI': { lat: 44.31, lon: -84.64 },
    'MO': { lat: 38.46, lon: -92.29 }, 'NC': { lat: 35.76, lon: -79.02 },
    'SC': { lat: 33.84, lon: -81.16 }, 'TN': { lat: 35.52, lon: -86.58 },
    'VA': { lat: 37.43, lon: -78.66 }, 'WA': { lat: 47.75, lon: -120.74 },
  }

  const upper = areaDesc.toUpperCase()
  for (const [abbr, coords] of Object.entries(stateCentroids)) {
    if (upper.includes(abbr) || upper.includes(abbr)) {
      return coords
    }
  }

  // Default: center of CONUS
  return { lat: 39.83, lon: -98.58 }
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

async function pollNwsAlerts(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  try {
    const res = await fetch(NWS_ALERTS_URL, {
      headers: {
        'User-Agent': 'WorldPulse/1.0 (https://world-pulse.io)',
        Accept: 'application/geo+json',
      },
    })

    if (!res.ok) {
      log.warn({ status: res.status }, 'NWS alerts API non-200 response')
      return
    }

    const data = (await res.json()) as {
      features?: Array<{
        id: string
        properties: {
          event: string
          severity: string
          urgency: string
          headline: string
          description: string
          areaDesc: string
          onset: string
          expires: string
          senderName: string
        }
        geometry: { type?: string; coordinates?: number[][][] } | null
      }>
    }

    const features = data.features ?? []
    if (!features.length) {
      log.debug('No active NWS alerts matching severity filter')
      return
    }

    // Process top 15 most severe alerts per poll
    const sorted = features.slice(0, 15)
    let ingested = 0

    for (const feature of sorted) {
      const { properties: p, geometry } = feature
      const dedupKey = `osint:nws:${feature.id}`

      // Skip if already seen
      const seen = await redis.get(dedupKey)
      if (seen) continue

      const severity = nwsSeverity(p.severity, p.event, p.urgency)
      const location = extractNwsLocation(geometry, p.areaDesc)

      const signalData = {
        title: `${p.event}: ${p.headline?.slice(0, 120) ?? p.areaDesc}`.slice(0, 500),
        summary: `${p.description?.slice(0, 500) ?? ''}\n\nArea: ${p.areaDesc}\nIssued by: ${p.senderName ?? 'NWS'}`,
        original_urls: [`https://api.weather.gov/alerts/${encodeURIComponent(feature.id)}`],
        source_ids: [],
        category: 'weather',
        severity,
        status: 'pending',
        reliability_score: RELIABILITY,
        location: location ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]) : null,
        location_name: p.areaDesc || 'Unknown',
        country_code: 'US',
        region: null,
        tags: ['osint', 'weather', 'nws', 'alert', p.event?.toLowerCase()?.replace(/\s+/g, '-') || ''].filter(Boolean),
        language: 'en',
        event_time: p.onset ? new Date(p.onset) : new Date(),
        source_count: 1,
      }

      try {
        const signal = await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'nws-alerts' })

        if (producer) {
          await producer.send({
            topic: 'signals.verified',
            messages: [{ value: JSON.stringify(signal) }],
          })
        }

        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        ingested++
      } catch (err) {
        log.warn({ err, alertId: feature.id }, 'Failed to ingest NWS alert')
      }
    }

    if (ingested > 0) {
      log.info({ ingested, total: features.length }, 'NWS severe weather alerts ingested')
    }
  } catch (err) {
    log.error({ err }, 'NWS alerts poll failed')
  }
}

export function startNwsAlertsPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  log.info('Starting NWS severe weather alerts poller (10-min interval)')
  pollNwsAlerts(db, redis, producer)

  const timer = setInterval(() => pollNwsAlerts(db, redis, producer), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
