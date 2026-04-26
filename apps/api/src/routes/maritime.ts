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
import { authenticate } from '../middleware/auth'

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

// ─── Chokepoint Registry ─────────────────────────────────────────────────────

export const CHOKEPOINTS = [
  { id: 'suez',          name: 'Suez Canal',              lat: 30.46, lng: 32.34, region: 'Middle East',     dailyTransits: 50,  pctGlobalTrade: 12 },
  { id: 'panama',        name: 'Panama Canal',            lat:  9.08, lng: -79.68, region: 'Central America', dailyTransits: 36,  pctGlobalTrade: 5 },
  { id: 'hormuz',        name: 'Strait of Hormuz',        lat: 26.57, lng: 56.25, region: 'Middle East',     dailyTransits: 80,  pctGlobalTrade: 21 },
  { id: 'malacca',       name: 'Strait of Malacca',       lat:  2.50, lng: 101.50, region: 'Southeast Asia', dailyTransits: 83,  pctGlobalTrade: 25 },
  { id: 'bab-el-mandeb', name: 'Bab el-Mandeb',           lat: 12.58, lng: 43.32, region: 'Middle East',     dailyTransits: 30,  pctGlobalTrade: 9 },
  { id: 'dover',         name: 'Strait of Dover',          lat: 51.02, lng:  1.45, region: 'Europe',          dailyTransits: 500, pctGlobalTrade: 7 },
  { id: 'gibraltar',     name: 'Strait of Gibraltar',      lat: 35.97, lng: -5.60, region: 'Europe',          dailyTransits: 300, pctGlobalTrade: 6 },
  { id: 'taiwan',        name: 'Taiwan Strait',            lat: 24.50, lng: 119.50, region: 'East Asia',      dailyTransits: 240, pctGlobalTrade: 8 },
  { id: 'good-hope',     name: 'Cape of Good Hope',        lat: -34.36, lng: 18.47, region: 'Africa',         dailyTransits: 60,  pctGlobalTrade: 4 },
  { id: 'bosporus',      name: 'Turkish Straits',          lat: 41.12, lng: 29.05, region: 'Europe',          dailyTransits: 120, pctGlobalTrade: 3 },
  { id: 'lombok',        name: 'Lombok Strait',            lat: -8.47, lng: 115.72, region: 'Southeast Asia', dailyTransits: 40,  pctGlobalTrade: 2 },
  { id: 'danish-straits', name: 'Danish Straits',          lat: 55.70, lng: 12.60, region: 'Europe',          dailyTransits: 90,  pctGlobalTrade: 3 },
] as const

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerMaritimeRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['maritime']
  })

  // ── GET /overview ──────────────────────────────────────────────────────────
  // Summary stats: chokepoints, signal counts, carrier positions, piracy alerts

  app.get('/overview', {
    preHandler: [authenticate],
    config: { rateLimit: { max: MARITIME_RATE_LIMIT, timeWindow: '1 minute' } },
    schema: {
      tags: ['maritime'],
      summary: 'Maritime intelligence overview — chokepoints, signal stats, latest alerts',
    },
  }, async (_req, reply) => {
    const cacheKey = 'maritime:overview'
    const cached = await redis.get(cacheKey)
    if (cached) return reply.send(JSON.parse(cached))

    // Signal counts for maritime-tagged content (last 7 days)
    const [signalStats] = await db('signals')
      .where('status', 'verified')
      .whereRaw("created_at > now() - interval '7 days'")
      .whereRaw("(category IN ('military','maritime','economy') AND (tags @> ARRAY['maritime']::text[] OR category = 'military'))")
      .select(
        db.raw("count(*) as total_signals"),
        db.raw("count(*) filter (where severity IN ('critical','high')) as high_severity"),
        db.raw("count(*) filter (where category = 'military') as military_signals"),
        db.raw("count(*) filter (where tags @> ARRAY['piracy']::text[]) as piracy_alerts"),
      ) as [{ total_signals: string; high_severity: string; military_signals: string; piracy_alerts: string }]

    // Recent maritime signals (top 20)
    const recentSignals = await db('signals')
      .where('status', 'verified')
      .whereRaw("created_at > now() - interval '48 hours'")
      .whereRaw("(category IN ('military','maritime','economy') AND (tags @> ARRAY['maritime']::text[] OR tags @> ARRAY['shipping']::text[] OR tags @> ARRAY['naval']::text[] OR category = 'military'))")
      .orderBy('created_at', 'desc')
      .limit(20)
      .select('id', 'title', 'category', 'severity', 'location_name', 'source_url', 'created_at',
        db.raw('ST_X(location::geometry) as lng'),
        db.raw('ST_Y(location::geometry) as lat'),
      )

    const response = {
      success: true,
      data: {
        chokepoints: CHOKEPOINTS,
        stats: {
          total_signals:   Number(signalStats.total_signals),
          high_severity:   Number(signalStats.high_severity),
          military_signals: Number(signalStats.military_signals),
          piracy_alerts:   Number(signalStats.piracy_alerts),
        },
        recent_signals: recentSignals.map((r: Record<string, unknown>) => ({
          id:            r.id,
          title:         r.title,
          category:      r.category,
          severity:      r.severity,
          location_name: r.location_name ?? null,
          source_url:    r.source_url ?? null,
          lat:           r.lat ?? null,
          lng:           r.lng ?? null,
          created_at:    r.created_at instanceof Date ? (r.created_at as Date).toISOString() : r.created_at,
        })),
      },
    }

    await redis.setex(cacheKey, MARITIME_CACHE_TTL, JSON.stringify(response))
    return reply.send(response)
  })

  // ── GET /signals ───────────────────────────────────────────────────────────
  // Maritime-filtered signal feed with pagination

  app.get('/signals', {
    preHandler: [authenticate],
    config: { rateLimit: { max: MARITIME_RATE_LIMIT, timeWindow: '1 minute' } },
    schema: {
      tags: ['maritime'],
      summary: 'Maritime intelligence signal feed with filters',
      querystring: {
        type: 'object',
        properties: {
          type:   { type: 'string', enum: ['all', 'piracy', 'naval', 'shipping', 'port', 'sanctions'], default: 'all' },
          limit:  { type: 'number', default: 30, maximum: 100, minimum: 1 },
          offset: { type: 'number', default: 0, minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const { type = 'all', limit = 30, offset = 0 } = req.query as { type?: string; limit?: number; offset?: number }

    let query = db('signals')
      .where('status', 'verified')
      .whereRaw("(category IN ('military','maritime','economy','conflict') AND (tags @> ARRAY['maritime']::text[] OR tags @> ARRAY['shipping']::text[] OR tags @> ARRAY['naval']::text[] OR tags @> ARRAY['piracy']::text[] OR tags @> ARRAY['ports']::text[] OR category = 'military'))")
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)

    if (type === 'piracy')     query = query.whereRaw("tags @> ARRAY['piracy']::text[]")
    if (type === 'naval')      query = query.where('category', 'military')
    if (type === 'shipping')   query = query.whereRaw("tags @> ARRAY['shipping']::text[]")
    if (type === 'port')       query = query.whereRaw("tags @> ARRAY['ports']::text[]")
    if (type === 'sanctions')  query = query.whereRaw("tags @> ARRAY['sanctions']::text[]")

    const rows = await query.select(
      'id', 'title', 'category', 'severity', 'reliability_score',
      'location_name', 'source_url', 'created_at',
      db.raw('ST_X(location::geometry) as lng'),
      db.raw('ST_Y(location::geometry) as lat'),
    )

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id:               r.id,
        title:            r.title,
        category:         r.category,
        severity:         r.severity,
        reliability_score: r.reliability_score != null ? Number(r.reliability_score) : null,
        location_name:    r.location_name ?? null,
        source_url:       r.source_url ?? null,
        lat:              r.lat ?? null,
        lng:              r.lng ?? null,
        created_at:       r.created_at instanceof Date ? (r.created_at as Date).toISOString() : r.created_at,
      })),
      total: rows.length,
      limit,
      offset,
    })
  })

  // ── GET /vessels ────────────────────────────────────────────────────────────

  app.get('/vessels', {
    preHandler: [authenticate],
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
