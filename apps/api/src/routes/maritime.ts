/**
 * Maritime Intelligence API
 *
 * Returns carrier strike group positions and AIS distress vessel signals
 * from the last 24 hours, sourced from the signals table.
 *
 * GET /api/v1/maritime/vessels
 *   - category IN ('military', 'maritime') with status IN ('verified', 'pending')
 *   - Classifies each signal as 'carrier' | 'vessel' | 'dark_ship'
 *   - Redis-cached for 5 minutes (key: 'maritime:vessels')
 *   - Rate limited to 30 req/min
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { optionalAuth } from '../middleware/auth'
import { NAVAL_SHIP_NAME, firstOfEach, headlineKey, isShipHeadline, notOffSea, pgToJs } from '../lib/sea-headlines'
import { longQuery } from '../lib/long-query'
import { staleWhileRevalidate } from '../lib/swr-cache'

/** The Naval intelligence query's own time limit, off the request path (lib/long-query.ts) */
const VESSELS_QUERY_SECONDS = 30

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

/**
 * A headline about navies and warships, or a named carrier (PostgreSQL, ~*):
 * the Naval intelligence layer's stories (Oct 19, 2026). USS, HMS and INS are
 * matched case-sensitively instead (NAVAL_SHIP_NAME): here "break-ins" was INS.
 */
const NAVAL_WORDS = 'navy|navies|naval|warships?|destroyers?|frigates?|corvettes?|submarines?|aircraft carriers?|carrier strike group|amphibious assault ship|dark (ship|vessel)s?|AIS (off|gap)|transponder (off|disabled)|' +
  CARRIER_REGISTRY_ALIASES.map(c => c.name.replace(/[.]/g, '\\.')).join('|')
export const NAVAL_HEADLINE = '\\m(' + NAVAL_WORDS + ')\\M'

/**
 * What the database looks for: ONE pattern per story (two more took the
 * query past the database's 5-second limit, Oct 19, 3:22 PM). The ship
 * prefixes are in it, case-insensitive; isNavalHeadline then checks them
 * case-sensitively and leaves out the phrases that aren't about the sea.
 */
export const NAVAL_CANDIDATE = '\\m(USS|HMS|INS|HMAS|HMCS|' + NAVAL_WORDS + ')\\M'

const NAVAL_JS = pgToJs(NAVAL_HEADLINE)
const SHIP_NAME_JS = pgToJs(NAVAL_SHIP_NAME, '')

/** Naval news, for the Naval intelligence layer (on the database's candidates) */
export function isNavalHeadline(title: string): boolean {
  return notOffSea(title) && (NAVAL_JS.test(title) || SHIP_NAME_JS.test(title))
}

/**
 * Sea news for the Maritime page's lists. Their tag filter (shipping, ports,
 * or any military story) let road-freight and trucking stories through ("Failed
 * CDL exams ...", "Freight Fraud Gets More Strategic ..." led the page on
 * Oct 19, 2026), so the rows it finds are checked by headline, as the map's
 * Ships and Naval intelligence layers are.
 */
export function isSeaHeadline(title: string): boolean {
  return isShipHeadline(title) || isNavalHeadline(title)
}

/** The newest rows the lists read before the headline check (the check drops some) */
export const SEA_LIST_READ = 400

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
 * The carrier a headline names, if any (Oct 19, 2026). Aliases used to match
 * anywhere in the text, so "TR" matched "patrol" and "destroyer", "GW" and
 * "Ford" matched inside other words, and every naval story became a carrier.
 * Now an alias counts only as a whole word (the two- and three-letter ones in
 * capitals), and only in a headline that says carrier, USS or a hull number.
 */
const CARRIER_CONTEXT = /\b(carriers?|USS|CVN[- ]?\d{2})\b/i
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function carrierIn(title: string): (typeof CARRIER_REGISTRY_ALIASES)[number] | null {
  if (!CARRIER_CONTEXT.test(title)) return null
  for (const entry of CARRIER_REGISTRY_ALIASES) {
    for (const alias of [entry.hull, entry.name.replace(/^USS /, ''), ...entry.aliases]) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(alias)}($|[^A-Za-z0-9])`, alias.length <= 3 ? '' : 'i')
      if (re.test(title)) return entry
    }
  }
  return null
}

/**
 * Classify a signal as a carrier, generic vessel, or dark ship based on title
 * and category. Military signals with carrier aliases → 'carrier'.
 * Maritime signals with dark ship keywords → 'dark_ship'.
 * Everything else → 'vessel'.
 */
export function classifyVesselType(title: string, category: string, anyCategory = false): VesselType {
  const lower = title.toLowerCase()

  // (anyCategory: the naval stories are found by their headlines, Oct 19, 2026)
  if ((category === 'military' || anyCategory) && carrierIn(title)) return 'carrier'

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
  return carrierIn(title)?.fleet ?? null
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

// ─── Live ships (aisstream.io) ─────────────────────────────────────────────────

/** The fleet the scraper writes every 30 s (apps/scraper/src/sources/ais.ts) */
export const AIS_LIVE_KEY = 'ais:live:v1'

export type ShipKind = 'tanker' | 'cargo' | 'passenger' | 'fishing' | 'military' | 'other'

/** What a ship is, from its AIS type code (80s tanker, 70s cargo, 60s passenger, 30 fishing, 35 military, 55 law enforcement) */
export function shipKind(type: number | null | undefined): ShipKind {
  if (type == null) return 'other'
  if (type >= 80 && type <= 89) return 'tanker'
  if (type >= 70 && type <= 79) return 'cargo'
  if (type >= 60 && type <= 69) return 'passenger'
  if (type === 30) return 'fishing'
  if (type === 35 || type === 55) return 'military'
  return 'other'
}

interface LiveShipRow { mmsi: string; name: string | null; lat: number; lon: number; sog: number | null; cog: number | null; heading: number | null; nav: number | null; type: number | null; dest: string | null; area: string; at: number }

/** The fleet as GeoJSON for the map (positions rounded to about 100 m) */
export function liveShipsGeoJson(snap: { ships?: LiveShipRow[] } | null) {
  const ships = Array.isArray(snap?.ships) ? snap!.ships : []
  return ships
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map(s => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [Math.round(s.lon * 1e3) / 1e3, Math.round(s.lat * 1e3) / 1e3] },
      properties: {
        mmsi: s.mmsi, name: s.name, kind: shipKind(s.type), sog: s.sog, cog: s.cog, heading: s.heading,
        nav: s.nav, dest: s.dest, area: s.area, seen: new Date(s.at).toISOString(),
      },
    }))
}

export const registerMaritimeRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['maritime']
  })

  // ── GET /overview ──────────────────────────────────────────────────────────
  // Summary stats: chokepoints, signal counts, carrier positions, piracy alerts

  app.get('/overview', {
    preHandler: [optionalAuth],
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
    // Include both verified and pending — RSS-ingested signals stay pending
    // because the verification pipeline only runs on article-clustered signals.
    const [signalStats] = await db('signals')
      .whereIn('status', ['verified', 'pending'])
      .whereRaw("created_at > now() - interval '7 days'")
      .whereRaw("(category IN ('military','maritime','economy','conflict') AND (tags @> ARRAY['maritime']::text[] OR category = 'military'))")
      .select(
        db.raw("count(*) as total_signals"),
        db.raw("count(*) filter (where severity IN ('critical','high')) as high_severity"),
        db.raw("count(*) filter (where category = 'military') as military_signals"),
        db.raw("count(*) filter (where tags @> ARRAY['piracy']::text[]) as piracy_alerts"),
      ) as [{ total_signals: string; high_severity: string; military_signals: string; piracy_alerts: string }]

    // Recent maritime signals (top 20)
    const recentSignals = await db('signals')
      .whereIn('status', ['verified', 'pending'])
      .whereRaw("created_at > now() - interval '48 hours'")
      .whereRaw("(category IN ('military','maritime','economy','conflict') AND (tags @> ARRAY['maritime']::text[] OR tags @> ARRAY['shipping']::text[] OR tags @> ARRAY['naval']::text[] OR category = 'military'))")
      .orderBy('created_at', 'desc')
      .limit(SEA_LIST_READ)
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
        recent_signals: recentSignals.filter((r: Record<string, unknown>) => isSeaHeadline(String(r.title ?? ''))).slice(0, 20).map((r: Record<string, unknown>) => ({
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
    preHandler: [optionalAuth],
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
          near:   { type: 'string', description: 'lat,lng — filter signals within radius of this point' },
          radius: { type: 'number', default: 500, minimum: 50, maximum: 2000, description: 'Radius in km (default 500)' },
        },
      },
    },
  }, async (req, reply) => {
    const { type = 'all', limit = 30, offset = 0, near, radius = 500 } = req.query as {
      type?: string; limit?: number; offset?: number; near?: string; radius?: number
    }

    let query = db('signals')
      .whereIn('status', ['verified', 'pending'])
      .whereRaw("(category IN ('military','maritime','economy','conflict') AND (tags @> ARRAY['maritime']::text[] OR tags @> ARRAY['shipping']::text[] OR tags @> ARRAY['naval']::text[] OR tags @> ARRAY['piracy']::text[] OR tags @> ARRAY['ports']::text[] OR category = 'military'))")
      .whereRaw("created_at > now() - interval '7 days'")
      .orderBy('created_at', 'desc')
      .limit(SEA_LIST_READ)

    if (type === 'piracy')     query = query.whereRaw("tags @> ARRAY['piracy']::text[]")
    if (type === 'naval')      query = query.where('category', 'military')
    if (type === 'shipping')   query = query.whereRaw("tags @> ARRAY['shipping']::text[]")
    if (type === 'port')       query = query.whereRaw("tags @> ARRAY['ports']::text[]")
    if (type === 'sanctions')  query = query.whereRaw("tags @> ARRAY['sanctions']::text[]")

    // Geographic proximity filter — filter signals near a chokepoint
    if (near) {
      const [latStr, lngStr] = near.split(',')
      const lat = parseFloat(latStr)
      const lng = parseFloat(lngStr)
      if (!isNaN(lat) && !isNaN(lng)) {
        const radiusMeters = (radius ?? 500) * 1000
        query = query.whereRaw(
          'location IS NOT NULL AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)',
          [lng, lat, radiusMeters]
        )
      }
    }

    const read = await query.select(
      'id', 'title', 'category', 'severity', 'reliability_score',
      'location_name', 'source_url', 'created_at',
      db.raw('ST_X(location::geometry) as lng'),
      db.raw('ST_Y(location::geometry) as lat'),
    )
    const rows = read
      .filter((r: Record<string, unknown>) => (type === 'naval' ? isNavalHeadline : isSeaHeadline)(String(r.title ?? '')))
      .slice(offset, offset + limit)

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
    preHandler: [optionalAuth],
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
    // This reads every story of the last 3 days and runs near the pool's 5-second limit (past it
    // from 3:22 PM on Oct 19: 500 every time). Kept in Redis and served at once; once 5 minutes
    // old, one process makes the next in the background with its own time limit.
    let made = false
    const vessels = await staleWhileRevalidate(
      `${MARITIME_CACHE_KEY}:v2`,
      { freshSeconds: MARITIME_CACHE_TTL, staleSeconds: 6 * 3600, lockSeconds: 2 * VESSELS_QUERY_SECONDS },
      async (): Promise<MaritimeVessel[]> => {
        made = true

        // ── DB query ─────────────────────────────────────────────────────────────
        const rows = await longQuery(VESSELS_QUERY_SECONDS, trx => trx('signals')
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
          // Oct 19, 2026: by headline (categories "military" and "maritime" are
          // no longer used, so this found nothing), over 3 days
          .whereRaw('title ~* ?', [NAVAL_CANDIDATE])
          .whereRaw("category::text NOT IN ('sports', 'culture', 'entertainment')")
          .whereIn('status', ['verified', 'pending'])
          .whereRaw("created_at > now() - interval '72 hours'")
          .orderBy('created_at', 'desc')
          .limit(200)) as Array<{
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

        // the same report at the same place (a carrier tracker repeats its reports
        // every few hours) shows once: the newest
        const placed = rows.filter(row => row.lat != null && row.lng != null && isValidCoordinate(row.lat!, row.lng!) && isNavalHeadline(String(row.title ?? '')))
        const list: MaritimeVessel[] = firstOfEach(placed, row => `${headlineKey(row.title)}|${Number(row.lat).toFixed(1)}|${Number(row.lng).toFixed(1)}`)
          .map(row => ({
            id:          row.id,
            title:       row.title,
            lat:         row.lat!,
            lng:         row.lng!,
            type:        classifyVesselType(row.title, row.category, true),
            fleet:       parseFleetFromTitle(row.title),
            status_text: row.location_name ?? 'Unknown position',
            severity:    row.severity,
            created_at:  typeof row.created_at === 'string'
              ? row.created_at
              : (row.created_at as Date).toISOString(),
          }))
        return list
      },
    )

    return reply.send({ success: true, cached: !made, data: vessels })
  })

  // ── GET /api/v1/maritime/live ── ships in the main straits right now (AIS) ──
  app.get('/live', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['maritime'],
      summary: 'Live ships in the main straits and canals (AIS, via aisstream.io)',
      description: 'Each ship heard in the last 30 minutes in the straits and canals WorldPulse watches (Hormuz, Bab el-Mandeb, Suez, Malacca and Singapore, Taiwan, the Bosporus, the western Black Sea, Kerch, Gibraltar, Dover, Panama), as GeoJSON, with how many per area. available is false when no live feed is running.',
    },
  }, async (_req, reply) => {
    let snap: { at?: string; connected?: boolean; areas?: unknown[]; ships?: LiveShipRow[] } | null = null
    try {
      const raw = await redis.get(AIS_LIVE_KEY)
      if (raw) snap = JSON.parse(raw)
    } catch { /* no fleet kept */ }
    const features = liveShipsGeoJson(snap)
    void reply.header('Cache-Control', 'public, max-age=30')
    return reply.send({
      success:   true,
      available: !!snap,
      connected: snap?.connected ?? false,
      at:        snap?.at ?? null,
      source:    'aisstream.io',
      areas:     Array.isArray(snap?.areas) ? snap!.areas : [],
      type:      'FeatureCollection',
      features,
    })
  })
}
