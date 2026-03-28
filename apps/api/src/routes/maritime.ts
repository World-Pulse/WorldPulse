/**
 * Maritime Intelligence API
 *
 * Returns carrier strike group positions and AIS distress vessel signals
 * from the last 24 hours, sourced from the signals table.
 *
 * GET /api/v1/maritime/vessels
 *   - category IN ('military', 'maritime') with status='verified'
 *   - Classifies each signal as 'carrier' | 'vessel' | 'dark_ship'
 *   - Redis-cached for 5 minutes (key: 'maritime:vessels')
 *   - Rate limited to 30 req/min
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

// Carrier data inlined here to avoid cross-package import in the API
export const CARRIER_REGISTRY_ALIASES: Array<{
  hull: string
  name: string
  fleet: string
  aliases: string[]
}> = [
  { hull: 'CVN-78', name: 'USS Gerald R. Ford',         fleet: 'Atlantic Fleet / 2nd Fleet', aliases: ['Gerald Ford', 'Ford', 'CVN-78', 'CVN 78'] },
  { hull: 'CVN-73', name: 'USS George Washington',      fleet: '7th Fleet',                  aliases: ['George Washington', 'GW', 'CVN-73', 'CVN 73'] },
  { hull: 'CVN-75', name: 'USS Harry S. Truman',        fleet: 'Atlantic Fleet / 2nd Fleet', aliases: ['Harry Truman', 'Truman', 'HST', 'CVN-75', 'CVN 75'] },
  { hull: 'CVN-71', name: 'USS Theodore Roosevelt',     fleet: 'Pacific Fleet / 3rd Fleet',  aliases: ['Theodore Roosevelt', 'TR', 'CVN-71', 'CVN 71'] },
  { hull: 'CVN-72', name: 'USS Abraham Lincoln',        fleet: 'Pacific Fleet / 3rd Fleet',  aliases: ['Abraham Lincoln', 'Lincoln', 'CVN-72', 'CVN 72'] },
  { hull: 'CVN-70', name: 'USS Carl Vinson',            fleet: 'Pacific Fleet / 3rd Fleet',  aliases: ['Carl Vinson', 'Vinson', 'CVN-70', 'CVN 70'] },
  { hull: 'CVN-69', name: 'USS Dwight D. Eisenhower',   fleet: 'Atlantic Fleet / 2nd Fleet', aliases: ['Dwight Eisenhower', 'Eisenhower', 'Ike', 'CVN-69', 'CVN 69'] },
  { hull: 'CVN-68', name: 'USS Nimitz',                 fleet: 'Pacific Fleet / 3rd Fleet',  aliases: ['Nimitz', 'CVN-68', 'CVN 68'] },
  { hull: 'CVN-74', name: 'USS John C. Stennis',        fleet: 'Pacific Fleet / 3rd Fleet',  aliases: ['John Stennis', 'Stennis', 'CVN-74', 'CVN 74'] },
  { hull: 'CVN-76', name: 'USS Ronald Reagan',          fleet: 'Pacific Fleet / 3rd Fleet',  aliases: ['Ronald Reagan', 'Reagan', 'RR', 'CVN-76', 'CVN 76'] },
  { hull: 'CVN-77', name: 'USS George H.W. Bush',       fleet: 'Atlantic Fleet / 2nd Fleet', aliases: ['George Bush', 'H.W. Bush', 'GHWB', 'CVN-77', 'CVN 77'] },
]

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for maritime vessel cache: 5 minutes */
export const MARITIME_CACHE_TTL = 300

/** Rate limit for maritime endpoints: requests per minute */
export const MARITIME_RATE_LIMIT = 30

/** Redis key for the maritime vessels cache */
export const MARITIME_CACHE_KEY = 'maritime:vessels'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VesselType = 'carrier' | 'vessel' | 'dark_ship'

export interface MaritimeVessel {
  id:          string
  title:       string
  lat:         number
  lng:         number
  type:        VesselType
  fleet:       string | null
  status_text: string
  severity:    string
  created_at:  string
}

// ─── Helpers (exported for unit tests) ───────────────────────────────────────

/**
 * Classify a signal as a carrier, generic vessel, or dark ship based on title
 * and category. Military signals with carrier aliases → 'carrier'.
 * Maritime signals with dark ship keywords → 'dark_ship'.
 * Everything else → 'vessel'.
 */
export function classifyVesselType(title: string, category: string): VesselType {
  const lower = title.toLowerCase()

  if (category === 'military') {
    for (const entry of CARRIER_REGISTRY_ALIASES) {
      if (lower.includes(entry.hull.toLowerCase())) return 'carrier'
      for (const alias of entry.aliases) {
        if (lower.includes(alias.toLowerCase())) return 'carrier'
      }
    }
  }

  const DARK_SHIP_KEYWORDS = [
    'dark ship', 'ais off', 'ais gap', 'transponder off',
    'transponder disabled', 'dark vessel', 'untracked vessel',
  ]
  if (DARK_SHIP_KEYWORDS.some(kw => lower.includes(kw))) return 'dark_ship'

  return 'vessel'
}

/**
 * Extract fleet assignment from a signal title by matching CARRIER_REGISTRY_ALIASES.
 * Returns null if no carrier match found.
 */
export function parseFleetFromTitle(title: string): string | null {
  const lower = title.toLowerCase()
  for (const entry of CARRIER_REGISTRY_ALIASES) {
    if (lower.includes(entry.hull.toLowerCase())) return entry.fleet
    for (const alias of entry.aliases) {
      if (lower.includes(alias.toLowerCase())) return entry.fleet
    }
  }
  return null
}

/**
 * Returns true if lat/lng are valid WGS-84 coordinates.
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    isFinite(lat) &&
    isFinite(lng) &&
    lat >= -90  && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerMaritimeRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['maritime']
  })

  // ── GET /vessels ────────────────────────────────────────────────────────────

  app.get('/vessels', {
    config: {
      rateLimit: {
        max:        MARITIME_RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags:    ['maritime'],
      summary: 'Carrier strike group positions and AIS distress vessel signals (24-hour window)',
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
                required: ['id', 'title', 'lat', 'lng', 'type', 'severity', 'created_at'],
                properties: {
                  id:          { type: 'string' },
                  title:       { type: 'string' },
                  lat:         { type: 'number' },
                  lng:         { type: 'number' },
                  type:        { type: 'string', enum: ['carrier', 'vessel', 'dark_ship'] },
                  fleet:       { type: ['string', 'null'] },
                  status_text: { type: 'string' },
                  severity:    { type: 'string' },
                  created_at:  { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    // ── Cache check ──────────────────────────────────────────────────────────
    const cached = await redis.get(MARITIME_CACHE_KEY)
    if (cached) {
      const vessels = JSON.parse(cached) as MaritimeVessel[]
      return reply.send({ success: true, cached: true, data: vessels })
    }

    // ── DB query ─────────────────────────────────────────────────────────────
    const rows = await db('signals')
      .select(
        'id',
        'title',
        'category',
        'severity',
        'status',
        'location_name',
        'created_at',
        db.raw('ST_X(location::geometry) as lng'),
        db.raw('ST_Y(location::geometry) as lat'),
      )
      .whereIn('category', ['military', 'maritime'])
      .where('status', 'verified')
      .whereRaw("created_at > now() - interval '24 hours'")
      .orderBy('created_at', 'desc')
      .limit(200) as Array<{
        id:            string
        title:         string
        category:      string
        severity:      string
        status:        string
        location_name: string | null
        created_at:    string
        lat:           number | null
        lng:           number | null
      }>

    const vessels: MaritimeVessel[] = rows
      .filter(row => row.lat != null && row.lng != null && isValidCoordinate(row.lat!, row.lng!))
      .map(row => ({
        id:          row.id,
        title:       row.title,
        lat:         row.lat!,
        lng:         row.lng!,
        type:        classifyVesselType(row.title, row.category),
        fleet:       parseFleetFromTitle(row.title),
        status_text: row.location_name ?? 'Unknown position',
        severity:    row.severity,
        created_at:  typeof row.created_at === 'string'
          ? row.created_at
          : (row.created_at as Date).toISOString(),
      }))

    // ── Cache and respond ────────────────────────────────────────────────────
    await redis.setex(MARITIME_CACHE_KEY, MARITIME_CACHE_TTL, JSON.stringify(vessels))

    return reply.send({ success: true, cached: false, data: vessels })
  })
}
