/**
 * Smithsonian Global Volcanism Program (GVP) Volcanic Activity Source
 *
 * Polls the Smithsonian GVP weekly volcanic activity reports and
 * USGS Volcano Hazards Program alerts for active eruptions and
 * elevated volcanic unrest worldwide.
 *
 * API: https://volcano.si.edu/volcanolist_holocene.cfm (RSS)
 * Backup: https://volcanoes.usgs.gov/vhp/api/volcanoAlerts (JSON)
 * Free, no API key required.
 *
 * Reliability: 0.93 (Smithsonian Institution is the world's most
 *   comprehensive volcanic activity database; USGS VHP is the
 *   authoritative US volcanic hazard assessment agency)
 * Category: science
 *
 * Complements USGS seismic + NASA FIRMS fire feeds with volcanic
 * eruption intelligence. No competitor tracks volcanic activity.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'gvp-volcano-source' })

const USGS_VOLCANO_URL = 'https://volcanoes.usgs.gov/hans2/api/volcanoAlerts'
const RELIABILITY = 0.93
const DEDUP_TTL_S = 7 * 86_400 // 7-day dedup
const POLL_INTERVAL_MS = Number(process.env.GVP_INTERVAL_MS) || 30 * 60_000 // 30 min

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/**
 * USGS Volcanic Alert Levels → WorldPulse severity
 *
 * WARNING = hazardous eruption imminent or underway → critical
 * WATCH = elevated/escalating unrest with potential eruption → high
 * ADVISORY = elevated unrest above known background → medium
 * NORMAL = typical background activity → low
 */
const ALERT_LEVEL_MAP: Record<string, SignalSeverity> = {
  WARNING: 'critical',
  WATCH: 'high',
  ADVISORY: 'medium',
  NORMAL: 'low',
  UNASSIGNED: 'low',
}

/**
 * USGS Aviation Color Codes → additional severity context
 *
 * RED = eruption with significant ash cloud → critical
 * ORANGE = heightened/escalating unrest → high
 * YELLOW = elevated unrest → medium
 * GREEN = normal background → low
 */
const AVIATION_COLOR_MAP: Record<string, SignalSeverity> = {
  RED: 'critical',
  ORANGE: 'high',
  YELLOW: 'medium',
  GREEN: 'low',
}

/**
 * Map volcanic alert to WorldPulse severity based on alert level
 * and aviation color code. Takes the higher of the two.
 */
export function volcanoSeverity(
  alertLevel: string,
  aviationColor: string,
): SignalSeverity {
  const severityOrder: SignalSeverity[] = ['low', 'medium', 'high', 'critical']

  const alertSeverity = ALERT_LEVEL_MAP[alertLevel?.toUpperCase()] ?? 'low'
  const aviationSeverity = AVIATION_COLOR_MAP[aviationColor?.toUpperCase()] ?? 'low'

  const alertIdx = severityOrder.indexOf(alertSeverity)
  const aviationIdx = severityOrder.indexOf(aviationSeverity)

  return severityOrder[Math.max(alertIdx, aviationIdx)]
}

// ─── WELL-KNOWN VOLCANO LOCATIONS ──────────────────────────────────────────

const VOLCANO_COORDS: Record<string, { lat: number; lon: number }> = {
  'kilauea':          { lat: 19.42, lon: -155.29 },
  'mauna loa':        { lat: 19.48, lon: -155.61 },
  'mount st. helens': { lat: 46.20, lon: -122.18 },
  'mount rainier':    { lat: 46.85, lon: -121.76 },
  'mount shasta':     { lat: 41.41, lon: -122.19 },
  'yellowstone':      { lat: 44.43, lon: -110.59 },
  'mount hood':       { lat: 45.37, lon: -121.70 },
  'mount baker':      { lat: 48.78, lon: -121.81 },
  'augustine':        { lat: 59.36, lon: -153.43 },
  'redoubt':          { lat: 60.49, lon: -152.74 },
  'pavlof':           { lat: 55.42, lon: -161.89 },
  'shishaldin':       { lat: 54.76, lon: -163.97 },
  'cleveland':        { lat: 52.82, lon: -169.94 },
  'great sitkin':     { lat: 52.08, lon: -176.13 },
  'semisopochnoi':    { lat: 51.93, lon: 179.58 },
  'etna':             { lat: 37.75, lon: 14.99 },
  'vesuvius':         { lat: 40.82, lon: 14.43 },
  'stromboli':        { lat: 38.79, lon: 15.21 },
  'piton de la fournaise': { lat: -21.24, lon: 55.71 },
  'eyjafjallajökull': { lat: 63.63, lon: -19.62 },
  'sakurajima':       { lat: 31.58, lon: 130.66 },
  'mount fuji':       { lat: 35.36, lon: 138.73 },
  'taal':             { lat: 14.00, lon: 120.99 },
  'mayon':            { lat: 13.26, lon: 123.69 },
  'pinatubo':         { lat: 15.13, lon: 120.35 },
  'krakatoa':         { lat: -6.10, lon: 105.42 },
  'merapi':           { lat: -7.54, lon: 110.45 },
  'agung':            { lat: -8.34, lon: 115.51 },
  'ruang':            { lat: 2.30, lon: 125.37 },
  'popocatépetl':     { lat: 19.02, lon: -98.62 },
  'colima':           { lat: 19.51, lon: -103.62 },
  'cotopaxi':         { lat: -0.68, lon: -78.44 },
  'villarrica':       { lat: -39.42, lon: -71.93 },
  'white island':     { lat: -37.52, lon: 177.18 },
  'tongariro':        { lat: -39.13, lon: 175.64 },
  'nyiragongo':       { lat: -1.52, lon: 29.25 },
}

/**
 * Look up volcano coordinates from name. Falls back to null if unknown.
 */
export function lookupVolcanoCoords(
  volcanoName: string,
  lat?: number | null,
  lon?: number | null,
): { lat: number; lon: number } | null {
  // Use provided coordinates if available
  if (lat != null && lon != null && lat !== 0 && lon !== 0) {
    return { lat, lon }
  }

  const lower = volcanoName.toLowerCase()
  for (const [name, coords] of Object.entries(VOLCANO_COORDS)) {
    if (lower.includes(name)) return coords
  }

  return null
}

// ─── POLLER ─────────────────────────────────────────────────────────────────

interface UsgsVolcanoAlert {
  volcanoName: string
  alertLevel: string
  aviationColorCode: string
  observatoryCode: string
  activity: string
  sent: string
  latitude?: number
  longitude?: number
  volcanoId?: number
}

async function pollVolcanoAlerts(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): Promise<void> {
  try {
    let alerts: UsgsVolcanoAlert[]
    try {
      alerts = await fetchWithResilience(
        'gvp-volcano',
        'GVP Volcano',
        USGS_VOLCANO_URL,
        async () => {
          const res = await fetch(USGS_VOLCANO_URL, {
            headers: {
              'User-Agent': 'WorldPulse/1.0 (https://world-pulse.io)',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(30_000),
          })
          if (!res.ok) throw Object.assign(new Error(`GVP Volcano: HTTP ${res.status}`), { statusCode: res.status })
          return res.json() as Promise<UsgsVolcanoAlert[]>
        },
      )
    } catch (err) {
      if (err instanceof CircuitOpenError) return
      throw err
    }

    if (!Array.isArray(alerts) || !alerts.length) {
      log.debug('No active USGS volcano alerts')
      return
    }

    // Filter to non-NORMAL alerts (only elevated activity)
    const elevated = alerts.filter(
      a => a.alertLevel && a.alertLevel.toUpperCase() !== 'NORMAL' && a.alertLevel.toUpperCase() !== 'UNASSIGNED',
    )

    let ingested = 0

    for (const alert of elevated.slice(0, 15)) {
      const dedupKey = `osint:gvp:${alert.volcanoName.toLowerCase().replace(/\s+/g, '-')}:${alert.alertLevel}`
      const seen = await redis.get(dedupKey)
      if (seen) continue

      const severity = volcanoSeverity(alert.alertLevel, alert.aviationColorCode)
      const location = lookupVolcanoCoords(
        alert.volcanoName,
        alert.latitude,
        alert.longitude,
      )

      const colorLabel = alert.aviationColorCode
        ? ` | Aviation: ${alert.aviationColorCode}`
        : ''

      const signalData = {
        title: `Volcanic Alert — ${alert.volcanoName}: ${alert.alertLevel}${colorLabel}`.slice(0, 500),
        summary: `${(alert.activity ?? '').slice(0, 500)}\n\nObservatory: ${alert.observatoryCode ?? 'Unknown'}\nAlert Level: ${alert.alertLevel}\nAviation Color Code: ${alert.aviationColorCode ?? 'N/A'}`,
        original_urls: [`https://volcanoes.usgs.gov/hans2/view/notice/${alert.volcanoId ?? ''}`],
        source_ids: [],
        category: 'disaster',
        severity,
        status: 'pending',
        reliability_score: RELIABILITY,
        location: location ? db.raw('ST_MakePoint(?, ?)', [location.lon, location.lat]) : null,
        location_name: alert.volcanoName,
        country_code: null,
        region: null,
        tags: ['osint', 'volcano', 'volcanic', 'usgs', 'gvp'],
        language: 'en',
        event_time: alert.sent ? new Date(alert.sent) : new Date(),
        source_count: 1,
      }

      try {
        const signal = await insertAndCorrelate(signalData, { lat: location?.lat ?? null, lng: location?.lon ?? null, sourceId: 'gvp-volcano' })

        if (producer) {
          await producer.send({
            topic: 'signals.verified',
            messages: [{ value: JSON.stringify(signal) }],
          })
        }

        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S)
        ingested++
      } catch (err) {
        log.warn({ err, volcano: alert.volcanoName }, 'Failed to ingest volcano alert')
      }
    }

    if (ingested > 0) {
      log.info({ ingested, elevated: elevated.length }, 'Volcano alerts ingested')
    }
  } catch (err) {
    log.error({ err }, 'Volcano alert poll failed')
  }
}

export function startGvpVolcanoPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  log.info('Starting GVP/USGS volcano alert poller (30-min interval)')
  pollVolcanoAlerts(db, redis, producer)

  const timer = setInterval(() => pollVolcanoAlerts(db, redis, producer), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
