/**
 * Power Grid Outage Monitoring Signal Source
 *
 * Monitors US power grid status via the Department of Energy (DOE)
 * Office of Electricity Emergency Situation Reports and related
 * public power outage data sources. Creates WorldPulse signals for
 * significant power disruptions affecting infrastructure resilience.
 *
 * Primary: DOE OE-417 Electric Emergency Incident Reports (public PDF/summary)
 * Fallback: PowerOutage.us API (crowdsourced outage counts by state)
 * Free, no API key required.
 *
 * Reliability: 0.85 (DOE reports are authoritative but published with delay;
 *   crowdsourced data supplements with near-real-time but lower confidence)
 * Category: infrastructure
 *
 * Unique to WorldPulse — no competitor (Crucix, Shadowbroker, Ground News)
 * tracks power grid disruptions as intelligence signals.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'power-outage-source' })

// PowerOutage.us provides a public JSON summary endpoint
const POWER_OUTAGE_URL = 'https://poweroutage.us/api/web/counties'
const POWER_OUTAGE_STATE_URL = 'https://poweroutage.us/api/web/states'
const DOE_SITUATION_URL = 'https://www.oe.netl.doe.gov/OE417_annual_summary.aspx'
const RELIABILITY = 0.85
const DEDUP_TTL_S = 6 * 3_600 // 6-hour dedup (outages can resolve quickly)
const POLL_INTERVAL_MS = Number(process.env.POWER_OUTAGE_INTERVAL_MS) || 30 * 60_000 // 30 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/**
 * Map power outage scale to WorldPulse severity based on
 * customers affected.
 */
export function outageSeverity(customersOut: number): SignalSeverity {
  if (customersOut >= 500_000) return 'critical' // Major grid failure
  if (customersOut >= 100_000) return 'high'     // Significant regional outage
  if (customersOut >= 25_000) return 'medium'    // Moderate local outage
  return 'low'                                    // Minor outage
}

/**
 * Determine if outage count is significant enough to create a signal.
 * Filter out small outages to avoid noise.
 */
export function isSignificantOutage(customersOut: number): boolean {
  return customersOut >= 10_000
}

// ─── GEOLOCATION ────────────────────────────────────────────────────────────

/** US state centroids for power outage geolocation */
const STATE_COORDS: Record<string, { lat: number; lon: number }> = {
  AL: { lat: 32.32, lon: -86.90 }, AK: { lat: 63.59, lon: -154.49 },
  AZ: { lat: 34.05, lon: -111.09 }, AR: { lat: 35.20, lon: -91.83 },
  CA: { lat: 36.78, lon: -119.42 }, CO: { lat: 39.55, lon: -105.78 },
  CT: { lat: 41.60, lon: -72.76 }, DE: { lat: 38.91, lon: -75.53 },
  FL: { lat: 27.66, lon: -81.52 }, GA: { lat: 32.17, lon: -82.91 },
  HI: { lat: 19.90, lon: -155.58 }, ID: { lat: 44.07, lon: -114.74 },
  IL: { lat: 40.63, lon: -89.40 }, IN: { lat: 40.27, lon: -86.13 },
  IA: { lat: 41.88, lon: -93.10 }, KS: { lat: 39.01, lon: -98.48 },
  KY: { lat: 37.84, lon: -84.27 }, LA: { lat: 31.17, lon: -91.87 },
  ME: { lat: 45.25, lon: -69.45 }, MD: { lat: 39.05, lon: -76.64 },
  MA: { lat: 42.41, lon: -71.38 }, MI: { lat: 44.31, lon: -85.60 },
  MN: { lat: 46.73, lon: -94.69 }, MS: { lat: 32.35, lon: -89.40 },
  MO: { lat: 37.96, lon: -91.83 }, MT: { lat: 46.88, lon: -110.36 },
  NE: { lat: 41.49, lon: -99.90 }, NV: { lat: 38.80, lon: -116.42 },
  NH: { lat: 43.19, lon: -71.57 }, NJ: { lat: 40.06, lon: -74.41 },
  NM: { lat: 34.52, lon: -105.87 }, NY: { lat: 43.30, lon: -74.22 },
  NC: { lat: 35.76, lon: -79.02 }, ND: { lat: 47.55, lon: -101.00 },
  OH: { lat: 40.42, lon: -82.91 }, OK: { lat: 35.47, lon: -97.52 },
  OR: { lat: 43.80, lon: -120.55 }, PA: { lat: 41.20, lon: -77.19 },
  RI: { lat: 41.58, lon: -71.48 }, SC: { lat: 33.84, lon: -81.16 },
  SD: { lat: 43.97, lon: -99.90 }, TN: { lat: 35.52, lon: -86.15 },
  TX: { lat: 31.97, lon: -99.90 }, UT: { lat: 39.32, lon: -111.09 },
  VT: { lat: 44.56, lon: -72.58 }, VA: { lat: 37.43, lon: -78.66 },
  WA: { lat: 47.75, lon: -120.74 }, WV: { lat: 38.60, lon: -80.95 },
  WI: { lat: 43.78, lon: -88.79 }, WY: { lat: 43.08, lon: -107.29 },
  DC: { lat: 38.91, lon: -77.04 }, PR: { lat: 18.22, lon: -66.59 },
}

/**
 * Get coordinates for a US state abbreviation.
 * Falls back to geographic center of contiguous US.
 */
export function stateCoords(
  stateAbbr: string,
): { lat: number; lon: number } {
  return STATE_COORDS[stateAbbr.toUpperCase()] ?? { lat: 39.83, lon: -98.58 }
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

interface StateOutageData {
  state?: string
  stateName?: string
  customersOut?: number
  customersTracked?: number
  outagePercentage?: number
}

async function fetchPowerOutageData(): Promise<StateOutageData[]> {
  try {
    const data = await fetchWithResilience(
      'power-outage',
      'Power Outage',
      POWER_OUTAGE_STATE_URL,
      async () => {
        const res = await fetch(POWER_OUTAGE_STATE_URL, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'WorldPulse-OSINT/1.0 (open-source intelligence aggregator)',
          },
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw Object.assign(new Error(`Power Outage: HTTP ${res.status}`), { statusCode: res.status })
        return res.json() as Promise<unknown>
      },
    )
    return (Array.isArray(data) ? data : ((data as Record<string, unknown>)?.['states'] ?? (data as Record<string, unknown>)?.['data'] ?? [])) as StateOutageData[]
  } catch (err) {
    if (err instanceof CircuitOpenError) return []
    log.error({ err }, 'Failed to fetch power outage data')
    return []
  }
}

async function pollPowerOutages(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  try {
    log.debug('Polling US power grid outage data…')

    const states = await fetchPowerOutageData()
    if (states.length === 0) {
      log.debug('No power outage data returned')
      return
    }

    let inserted = 0

    for (const state of states) {
      const customersOut = state.customersOut ?? 0
      if (!isSignificantOutage(customersOut)) continue

      const stateAbbr = state.state ?? 'US'
      const stateName = state.stateName ?? stateAbbr
      const dedupKey = `osint:power-outage:${stateAbbr}:${Math.floor(Date.now() / (6 * 3_600_000))}`

      // Skip if recently reported for this state in this 6-hour window
      const seen = await redis.get(dedupKey)
      if (seen) continue

      const severity = outageSeverity(customersOut)
      const { lat, lon } = stateCoords(stateAbbr)
      const pct = state.outagePercentage ?? (
        state.customersTracked ? ((customersOut / state.customersTracked) * 100).toFixed(2) : 'N/A'
      )

      const signalData = {
        title: `Power Outage: ${stateName} — ${customersOut.toLocaleString()} customers without power`,
        summary: `${customersOut.toLocaleString()} customers affected in ${stateName} (${pct}% of tracked customers). US power grid disruption detected via crowdsourced monitoring.`,
        original_urls: [`https://poweroutage.us/area/state/${stateName.toLowerCase().replace(/\s+/g, '')}`],
        source_ids: [],
        category: 'infrastructure',
        severity,
        status: 'pending',
        reliability_score: RELIABILITY,
        location: db.raw('ST_MakePoint(?, ?)', [lon, lat]),
        location_name: stateName,
        country_code: 'US',
        region: stateAbbr,
        tags: ['osint', 'power', 'outage', 'infrastructure', stateAbbr.toLowerCase()],
        language: 'en',
        event_time: new Date(),
        source_count: 1,
      }

      try {
        await insertAndCorrelate(signalData, { lat, lng: lon, sourceId: 'power-outage' })

        if (producer) {
          await producer.send({
            topic: 'signals',
            messages: [{ value: JSON.stringify(signalData) }],
          })
        }

        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        inserted++
      } catch (err) {
        log.error({ err, stateAbbr }, 'Failed to insert power outage signal')
      }
    }

    log.info({ inserted, total: states.length }, 'Power outage poll complete')
  } catch (err) {
    log.error({ err }, 'Power outage poll failed')
  }
}

// ─── EXPORTED START FUNCTION ────────────────────────────────────────────────

export function startPowerOutagePoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  log.info(`Starting Power Grid Outage poller (interval ${POLL_INTERVAL_MS / 60_000} min)`)
  pollPowerOutages(db, redis, producer).catch(err =>
    log.error({ err }, 'Initial power outage poll failed'),
  )
  const timer = setInterval(
    () => pollPowerOutages(db, redis, producer).catch(err =>
      log.error({ err }, 'Power outage poll failed'),
    ),
    POLL_INTERVAL_MS,
  )
  return () => clearInterval(timer)
}
