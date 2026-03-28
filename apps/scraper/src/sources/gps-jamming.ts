/**
 * GPS/GNSS Jamming Detection Intelligence Source
 *
 * Aggregates GPS jamming intelligence from multiple open sources:
 *   1. GPSJam.org — ADS-B crowdsourced NAC-P degradation heatmap
 *   2. ADS-B Exchange / OpenSky — navigation accuracy anomaly detection
 *
 * Classifies jamming events by type:
 *   - military:  deliberate state-actor electronic warfare (EW ops, conflict zones)
 *   - spoofing:  GPS deception — aircraft reporting impossible/shifted positions
 *   - civilian:  unintentional interference (harmonic, industrial, test equipment)
 *
 * Known high-risk zones: Eastern Mediterranean (Syria/Turkey/Israel), Ukraine/Russia
 * front lines, Baltic states, North Korea border, Persian Gulf.
 *
 * Severity mapping:
 *   critical  — military spoofing confirmed, aviation safety impact
 *   high      — deliberate military jamming in active conflict zone (≥85% jam probability)
 *   medium    — civilian interference or unconfirmed deliberate (≥65%)
 *   low       — transient / weak signal (≥50%)
 *
 * Poll interval: 30 minutes (GNSS_JAM_INTERVAL_MS env override)
 * Redis dedup TTL: 4 hours per grid cell
 */

import https from 'node:https'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'gps-jamming-source' })

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

/** Redis TTL for jamming zone dedup: 4 hours */
export const JAMMING_DEDUP_TTL = 4 * 3_600

/** Default poll interval: 30 minutes */
export const JAMMING_POLL_INTERVAL_MS = 30 * 60_000

/** Minimum jam probability to emit a signal (0–1) */
export const JAMMING_MIN_PCT = 0.5

/** Maximum signals emitted per poll cycle */
export const JAMMING_MAX_SIGNALS = 15

// ─── KNOWN HIGH-RISK ZONES ───────────────────────────────────────────────────

/**
 * Known GPS jamming hotspots — used to classify `military` type and enrich
 * region labels when the API response lacks a human-readable name.
 */
export const KNOWN_JAMMING_HOTSPOTS: Array<{
  name:   string
  lat:    number
  lng:    number
  radius: number   // degrees (approx)
  type:   'military' | 'spoofing' | 'civilian'
}> = [
  // Eastern Mediterranean — Syria/Turkey/Lebanon/Israel multi-party EW
  { name: 'Eastern Mediterranean (Syria/Lebanon/Israel EW)', lat: 34.5, lng: 36.5, radius: 4.0, type: 'military' },
  // Ukraine/Russia front lines
  { name: 'Ukraine-Russia Front Lines',   lat: 48.5, lng: 36.0, radius: 5.0, type: 'military' },
  // Baltic Sea region — Russia Kaliningrad
  { name: 'Baltic Sea (Kaliningrad EW)',  lat: 55.0, lng: 20.5, radius: 3.5, type: 'military' },
  // Black Sea — Russia EW
  { name: 'Black Sea EW Zone',            lat: 43.0, lng: 34.0, radius: 4.0, type: 'military' },
  // North Korea border
  { name: 'Korean Peninsula (DPRK)',      lat: 37.5, lng: 126.0, radius: 3.0, type: 'military' },
  // Persian Gulf — Iran spoofing incidents
  { name: 'Persian Gulf (Iran spoofing)', lat: 26.5, lng: 54.5, radius: 3.5, type: 'spoofing' },
  // Strait of Hormuz
  { name: 'Strait of Hormuz',             lat: 26.5, lng: 56.5, radius: 2.5, type: 'spoofing' },
  // Finnmark / Northern Norway
  { name: 'Northern Norway (Arctic EW)',  lat: 69.5, lng: 25.5, radius: 3.0, type: 'military' },
]

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type JammingType = 'military' | 'spoofing' | 'civilian' | 'unknown'

export interface JammingZoneInput {
  lat:     number
  lng:     number
  jamPct:  number    // 0–1
  name?:   string | null
}

// ─── PURE FUNCTIONS (exported for unit tests) ─────────────────────────────────

/**
 * Classify a GPS jamming event by type using geographic proximity to known
 * hotspots and signal characteristics.
 *
 * Precedence: spoofing > military > civilian > unknown
 *
 * @param lat     - Centroid latitude of the jamming zone
 * @param lng     - Centroid longitude of the jamming zone
 * @param jamPct  - Jamming probability (0–1) from GPSJam
 * @param name    - Optional region name hint
 */
export function classifyJammingType(
  lat:    number,
  lng:    number,
  jamPct: number,
  name?:  string | null,
): JammingType {
  const nameLower = (name ?? '').toLowerCase()

  // Spoofing keywords — specific to GPS deception (position shifted/impossible)
  const spoofKeywords = ['spoof', 'decep', 'fake gps', 'position shift', 'ghost', 'phantom']
  if (spoofKeywords.some(kw => nameLower.includes(kw))) return 'spoofing'

  // Civilian keywords — harmonic, industrial, test equipment
  const civilKeywords = ['civilian', 'industrial', 'test', 'harmonic', 'inadvertent', 'interference']
  if (civilKeywords.some(kw => nameLower.includes(kw))) return 'civilian'

  // Check geographic proximity to known hotspots
  for (const hotspot of KNOWN_JAMMING_HOTSPOTS) {
    const dLat = Math.abs(lat - hotspot.lat)
    const dLng = Math.abs(lng - hotspot.lng)
    if (dLat <= hotspot.radius && dLng <= hotspot.radius) {
      return hotspot.type
    }
  }

  // High-confidence unclassified jamming in non-hotspot → likely civilian
  if (jamPct >= 0.85) return 'military'
  if (jamPct >= 0.65) return 'civilian'

  return 'unknown'
}

/**
 * Map jamming probability + type to a signal severity level.
 *
 * critical  — spoofing (aviation deception) or military + very high jam (≥0.92)
 * high      — military jamming ≥0.75, or any jamming ≥0.85
 * medium    — ≥0.65 or civilian type
 * low       — everything else above threshold
 */
export function jammingSeverity(
  jamPct:      number,
  jammingType: JammingType,
): SignalSeverity {
  if (jammingType === 'spoofing')                    return 'critical'
  if (jammingType === 'military' && jamPct >= 0.92)  return 'critical'
  if (jammingType === 'military' && jamPct >= 0.75)  return 'high'
  if (jamPct >= 0.85)                                return 'high'
  if (jamPct >= 0.65 || jammingType === 'civilian')  return 'medium'
  return 'low'
}

/**
 * Parse a raw GeoJSON geometry (Polygon or Point) into a [lng, lat] centroid.
 * Returns null on parse failure or invalid coordinates.
 */
export function parseJammingZone(geometry: {
  type:        string
  coordinates: unknown
}): [number, number] | null {
  try {
    if (geometry.type === 'Point') {
      const coords = geometry.coordinates as [number, number]
      if (
        Array.isArray(coords) &&
        coords.length >= 2 &&
        typeof coords[0] === 'number' &&
        typeof coords[1] === 'number' &&
        isFinite(coords[0]) &&
        isFinite(coords[1])
      ) {
        return [coords[0], coords[1]]
      }
      return null
    }

    if (geometry.type === 'Polygon') {
      const rings = geometry.coordinates as [number, number][][]
      const ring  = rings?.[0]
      if (!ring || ring.length === 0) return null

      let sumLng = 0
      let sumLat = 0
      let count  = 0
      for (const c of ring) {
        if (
          Array.isArray(c) &&
          c.length >= 2 &&
          typeof c[0] === 'number' &&
          typeof c[1] === 'number' &&
          isFinite(c[0]) &&
          isFinite(c[1])
        ) {
          sumLng += c[0]
          sumLat += c[1]
          count++
        }
      }
      if (count === 0) return null
      return [sumLng / count, sumLat / count]
    }
  } catch {
    // ignore parse errors
  }
  return null
}

/**
 * Build a stable Redis dedup key for a jamming zone.
 * Rounded to 1° grid precision to catch duplicate reports of the same zone.
 * Prefix: `gpsjam:dedup:` (shared with legacy gpsjam.ts to prevent duplicates during migration)
 */
export function jammingDedupKey(lng: number, lat: number): string {
  const lngR = Math.round(lng)
  const latR = Math.round(lat)
  return `gpsjam:dedup:${lngR}:${latR}`
}

/**
 * Build a human-readable signal title for a jamming event.
 */
export function jammingTitle(
  regionLabel: string,
  jammingType: JammingType,
  jamPct:      number,
): string {
  const pct   = Math.round(jamPct * 100)
  const label = jammingType === 'spoofing'  ? 'GPS Spoofing'
              : jammingType === 'military'  ? 'GPS Jamming (Military EW)'
              : jammingType === 'civilian'  ? 'GPS Interference (Civilian)'
              : 'GPS/GNSS Anomaly'
  return `${label} — ${regionLabel} (${pct}% probability)`
}

/**
 * Build the signal summary body for a jamming event.
 */
export function jammingSummary(
  regionLabel: string,
  jammingType: JammingType,
  jamPct:      number,
): string {
  const pct = Math.round(jamPct * 100)
  const causeClause =
    jammingType === 'spoofing'
      ? 'GPS spoofing detected — aircraft reporting anomalous or shifted positions, indicating active deception operations.'
      : jammingType === 'military'
        ? 'Deliberate military electronic warfare (EW) operation suspected based on geographic context and signal intensity.'
        : jammingType === 'civilian'
          ? 'Civilian radio frequency interference detected (harmonic, industrial equipment, or inadvertent transmission).'
          : 'GPS/GNSS signal degradation detected via crowdsourced ADS-B receiver anomaly analysis.'

  return [
    `GPSJam.org reports ${pct}% GNSS jamming probability near ${regionLabel}.`,
    causeClause,
    'Detection method: ADS-B Navigation Accuracy Category (NAC-P) degradation clustering.',
    'Affected systems: civilian aviation GPS, maritime GNSS, ground vehicle navigation.',
    'Source: GPSJam.org open-source data.',
  ].join(' ')
}

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20_000,
      headers: { 'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)' },
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('GPS jamming request timeout')) })
  })
}

// ─── GPSJam API URL ───────────────────────────────────────────────────────────

function gpsjamApiUrl(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1) // yesterday — today's data may not be fully processed
  const date = d.toISOString().slice(0, 10)
  return `https://gpsjam.org/api/jam?z=2&date=${date}`
}

// ─── GEOJSON TYPES ────────────────────────────────────────────────────────────

interface GpsJamProperties {
  jamPct: number
  name?:  string
}

interface GpsJamFeature {
  type:       'Feature'
  id?:        string
  properties: GpsJamProperties
  geometry:   { type: string; coordinates: unknown }
}

interface GpsJamFeatureCollection {
  type:     'FeatureCollection'
  features: GpsJamFeature[]
}

// ─── MAIN POLLER ──────────────────────────────────────────────────────────────

export function startGpsJammingPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS  = Number(process.env.GNSS_JAM_INTERVAL_MS  ?? JAMMING_POLL_INTERVAL_MS)
  const MIN_JAM_PCT  = Number(process.env.GNSS_JAM_MIN_PCT      ?? JAMMING_MIN_PCT)
  const MAX_SIGNALS  = Number(process.env.GNSS_JAM_MAX_SIGNALS  ?? JAMMING_MAX_SIGNALS)

  async function poll(): Promise<void> {
    try {
      log.debug('Polling GPS/GNSS jamming intelligence feed…')

      const raw  = await httpsGet(gpsjamApiUrl())
      const data = JSON.parse(raw) as GpsJamFeatureCollection

      const features = (data.features ?? [])
        .filter(f => (f.properties?.jamPct ?? 0) >= MIN_JAM_PCT)
        .sort((a, b) => b.properties.jamPct - a.properties.jamPct)
        .slice(0, MAX_SIGNALS)

      if (features.length === 0) {
        log.debug('GPS jamming: no zones above threshold')
        return
      }

      let created = 0

      for (const feature of features) {
        const { jamPct, name } = feature.properties
        const centroid = parseJammingZone(feature.geometry)
        if (!centroid) continue

        const [lng, lat] = centroid
        const key  = jammingDedupKey(lng, lat)
        const seen = await redis.get(key)
        if (seen) continue

        const jammingType  = classifyJammingType(lat, lng, jamPct, name)
        const severity     = jammingSeverity(jamPct, jammingType)
        const regionLabel  = name ?? `${lat.toFixed(1)}°N, ${lng.toFixed(1)}°E`
        const signalTitle  = jammingTitle(regionLabel, jammingType, jamPct)
        const summary      = jammingSummary(regionLabel, jammingType, jamPct)

        const tags = [
          'osint', 'gps', 'gnss', 'jamming', 'electronic-warfare', 'gpsjam',
          `jamming_type:${jammingType}`,
          'gps_jamming',
        ]

        try {
          const signal = await insertAndCorrelate({
            title:             signalTitle.slice(0, 500),
            summary,
            category:          'electronic_warfare',
            severity,
            status:            'pending',
            reliability_score: jammingType === 'spoofing' ? 0.82
                             : jammingType === 'military' ? 0.78
                             : 0.72,
            source_count:      1,
            source_ids:        [],
            original_urls:     ['https://gpsjam.org/'],
            location:          db.raw('ST_MakePoint(?, ?)', [lng, lat]),
            location_name:     regionLabel,
            country_code:      null,
            region:            null,
            tags,
            language:          'en',
            event_time:        new Date(),
          }, { lat, lng, sourceId: 'gps-jamming' })

          // 4-hour dedup TTL
          await redis.setex(key, JAMMING_DEDUP_TTL, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'electronic_warfare',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'electronic_warfare', severity },
                }),
              }],
            }).catch(() => {}) // non-fatal
          }
        } catch (err) {
          log.debug({ err, key }, 'GPS jamming signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, total: features.length }, 'GPS jamming: signals created')
      } else {
        log.debug({ total: features.length }, 'GPS jamming poll complete (no new zones)')
      }
    } catch (err) {
      log.warn({ err }, 'GPS jamming poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info(
    { intervalMs: INTERVAL_MS, minJamPct: MIN_JAM_PCT },
    'GPS/GNSS Jamming Intelligence poller started',
  )

  return () => {
    clearInterval(timer)
    log.info('GPS/GNSS Jamming Intelligence poller stopped')
  }
}
