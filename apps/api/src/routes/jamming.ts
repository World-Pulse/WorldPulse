/**
 * GPS/GNSS Jamming Intelligence API
 *
 * Returns active GPS/GNSS jamming zones with type classification, affected area,
 * confidence, and detection metadata from the last 24 hours.
 *
 * GET /api/v1/jamming/zones
 *   - category = 'electronic_warfare' OR tags @> '["gps_jamming"]'
 *   - Classifies each signal as 'military' | 'spoofing' | 'civilian' | 'unknown'
 *   - Redis-cached for 5 minutes (key: 'jamming:zones')
 *   - Rate limited to 30 req/min
 *   - Returns: id, title, lat, lng, radius_km, jamming_type, severity, confidence,
 *              affected_systems, first_detected, last_confirmed, source
 *
 * Counters Shadowbroker's GPS jamming zones feature by providing richer
 * classification (military/spoofing/civilian), multi-source confidence scoring,
 * and affected-systems metadata.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate } from '../middleware/auth'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for jamming zones cache: 5 minutes */
export const JAMMING_CACHE_TTL = 300

/** Rate limit for jamming endpoints: requests per minute */
export const JAMMING_RATE_LIMIT = 30

/** Redis key for the active jamming zones cache */
export const JAMMING_CACHE_KEY = 'jamming:zones'

// ─── Types ────────────────────────────────────────────────────────────────────

export type JammingType = 'military' | 'spoofing' | 'civilian' | 'unknown'

export interface JammingZone {
  id:               string
  title:            string
  lat:              number
  lng:              number
  radius_km:        number
  jamming_type:     JammingType
  severity:         string
  confidence:       number
  affected_systems: string[]
  first_detected:   string
  last_confirmed:   string
  source:           string
}

// ─── Helpers (exported for unit tests) ───────────────────────────────────────

/**
 * Extract the jamming type from signal tags array.
 * Looks for a tag matching `jamming_type:<value>`.
 * Falls back to title/category-based classification.
 */
export function classifyJammingType(tags: string[], title: string): JammingType {
  // Tag-encoded type takes highest precedence (set by the scraper)
  for (const tag of tags) {
    if (tag === 'jamming_type:military')  return 'military'
    if (tag === 'jamming_type:spoofing')  return 'spoofing'
    if (tag === 'jamming_type:civilian')  return 'civilian'
    if (tag === 'jamming_type:unknown')   return 'unknown'
  }

  // Title-based fallback classification
  const lower = title.toLowerCase()
  if (lower.includes('spoof') || lower.includes('deception') || lower.includes('fake gps')) {
    return 'spoofing'
  }
  if (
    lower.includes('military') ||
    lower.includes('ew)') ||
    lower.includes('electronic warfare') ||
    lower.includes('conflict zone') ||
    lower.includes('ukraine') ||
    lower.includes('russia') ||
    lower.includes('dprk') ||
    lower.includes('north korea') ||
    lower.includes('kaliningrad')
  ) {
    return 'military'
  }
  if (lower.includes('civilian') || lower.includes('interference') || lower.includes('industrial')) {
    return 'civilian'
  }

  return 'unknown'
}

/**
 * Derive a radius (km) for the affected area based on severity.
 * Used for map circle rendering and downstream geofencing.
 *
 * critical  → 250 km (spoofing / major military EW can affect wide corridor)
 * high      → 150 km
 * medium    → 80 km
 * low       → 40 km
 */
export function jammingRadius(severity: string): number {
  switch (severity.toLowerCase()) {
    case 'critical': return 250
    case 'high':     return 150
    case 'medium':   return 80
    case 'low':      return 40
    default:         return 60
  }
}

/**
 * Derive the list of affected systems from jamming type and severity.
 * Returns human-readable strings describing impacted navigation systems.
 */
export function jammingAffectedSystems(
  jammingType: JammingType,
  severity:    string,
): string[] {
  const systems: string[] = ['Civilian GPS receivers', 'Maritime GNSS']
  const sev = severity.toLowerCase()

  if (jammingType === 'spoofing') {
    return [
      'Aviation GPS (position deception)',
      'Maritime AIS positioning',
      'Precision agriculture GPS',
      'Financial timestamp synchronisation',
    ]
  }

  if (jammingType === 'military') {
    systems.push('Aviation GPS/GNSS', 'Military navigation systems')
    if (sev === 'critical' || sev === 'high') {
      systems.push('Commercial aviation approach procedures', 'Drone navigation')
    }
  } else {
    systems.push('Vehicle navigation')
    if (sev !== 'low') systems.push('Aviation GPS (advisory)')
  }

  return systems
}

/**
 * Map reliability_score (0–1) to a confidence percentage (0–100).
 * Clamps to valid range and rounds to nearest integer.
 */
export function jammingConfidence(reliabilityScore: number | null): number {
  const score = reliabilityScore ?? 0.5
  return Math.round(Math.min(1, Math.max(0, score)) * 100)
}

/**
 * Map jamming probability + type to a signal severity level.
 * Mirrors the scraper's logic; exported here for API-side enrichment and tests.
 *
 * critical  — spoofing (aviation deception), or military ≥ 0.92 jam probability
 * high      — military ≥ 0.75, or any ≥ 0.85
 * medium    — ≥ 0.65 or civilian type
 * low       — all other confirmed events
 */
export function jammingSeverityLabel(
  jamPct:      number,
  jammingType: JammingType,
): 'critical' | 'high' | 'medium' | 'low' {
  if (jammingType === 'spoofing')                    return 'critical'
  if (jammingType === 'military' && jamPct >= 0.92)  return 'critical'
  if (jammingType === 'military' && jamPct >= 0.75)  return 'high'
  if (jamPct >= 0.85)                                return 'high'
  if (jamPct >= 0.65 || jammingType === 'civilian')  return 'medium'
  return 'low'
}

/**
 * Parse a GeoJSON geometry (Polygon or Point) into a [lng, lat] centroid.
 * Returns null on parse failure or when coordinates are non-finite.
 * Exported for unit tests.
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
 * Rounded to 1° grid precision to merge duplicate reports of the same zone.
 * Format: `gnss:jam:<lngRounded>:<latRounded>`
 */
export function jammingDedupKey(lng: number, lat: number): string {
  const lngR = Math.round(lng)
  const latR = Math.round(lat)
  return `gnss:jam:${lngR}:${latR}`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerJammingRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['jamming']
  })

  // ── GET /zones ─────────────────────────────────────────────────────────────

  app.get('/zones', {
    preHandler: [authenticate],
    config: {
      rateLimit: {
        max:        JAMMING_RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags:    ['jamming'],
      summary: 'Active GPS/GNSS jamming zones — type, severity, affected area, confidence (24h window)',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cached:  { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                required: [
                  'id', 'title', 'lat', 'lng', 'radius_km', 'jamming_type',
                  'severity', 'confidence', 'affected_systems',
                  'first_detected', 'last_confirmed', 'source',
                ],
                properties: {
                  id:               { type: 'string' },
                  title:            { type: 'string' },
                  lat:              { type: 'number' },
                  lng:              { type: 'number' },
                  radius_km:        { type: 'number' },
                  jamming_type:     { type: 'string', enum: ['military', 'spoofing', 'civilian', 'unknown'] },
                  severity:         { type: 'string' },
                  confidence:       { type: 'number' },
                  affected_systems: { type: 'array', items: { type: 'string' } },
                  first_detected:   { type: 'string' },
                  last_confirmed:   { type: 'string' },
                  source:           { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    // ── Cache check ───────────────────────────────────────────────────────────
    const cached = await redis.get(JAMMING_CACHE_KEY)
    if (cached) {
      const zones = JSON.parse(cached) as JammingZone[]
      return reply.send({ success: true, cached: true, data: zones })
    }

    // ── DB query ──────────────────────────────────────────────────────────────
    const rows = await db('signals')
      .select(
        'id',
        'title',
        'severity',
        'reliability_score',
        'tags',
        'original_urls',
        'location_name',
        'created_at',
        db.raw('ST_X(location::geometry) as lng'),
        db.raw('ST_Y(location::geometry) as lat'),
      )
      .where(function () {
        this.where('category', 'electronic_warfare')
          .orWhereRaw("tags @> '[\"gps_jamming\"]'::jsonb")
      })
      .whereRaw("created_at > NOW() - INTERVAL '24 hours'")
      .orderBy('created_at', 'desc')
      .limit(200) as Array<{
        id:                string
        title:             string
        severity:          string
        reliability_score: number | null
        tags:              string[] | string | null
        original_urls:     string[] | string | null
        location_name:     string | null
        created_at:        string | Date
        lat:               number | null
        lng:               number | null
      }>

    const zones: JammingZone[] = rows
      .filter(row => row.lat != null && row.lng != null)
      .map(row => {
        // Normalise tags — DB may return a JSON string or an array
        const tags: string[] = Array.isArray(row.tags)
          ? row.tags
          : typeof row.tags === 'string'
            ? (() => { try { return JSON.parse(row.tags as string) as string[] } catch { return [] } })()
            : []

        const jammingType = classifyJammingType(tags, row.title)
        const createdAt   = typeof row.created_at === 'string'
          ? row.created_at
          : (row.created_at as Date).toISOString()

        return {
          id:               row.id,
          title:            row.title,
          lat:              row.lat!,
          lng:              row.lng!,
          radius_km:        jammingRadius(row.severity),
          jamming_type:     jammingType,
          severity:         row.severity,
          confidence:       jammingConfidence(row.reliability_score),
          affected_systems: jammingAffectedSystems(jammingType, row.severity),
          first_detected:   createdAt,
          last_confirmed:   createdAt,
          source:           'GPSJam.org / ADS-B GNSS anomaly detection',
        }
      })

    // ── Cache and respond ─────────────────────────────────────────────────────
    await redis.setex(JAMMING_CACHE_KEY, JAMMING_CACHE_TTL, JSON.stringify(zones))

    return reply.send({ success: true, cached: false, data: zones })
  })
}
