/**
 * Natural Hazards Map Layer API
 *
 * Returns natural hazard signals (seismic, volcanic, tsunami, wildfire) from the last
 * N hours with geolocation data suitable for map rendering.
 *
 * GET /api/v1/hazards/map/points
 *   - source_slug IN ('seismic', 'gvp-volcano', 'tsunami-warnings', 'firms')
 *   - Only returns signals with valid lat/lng
 *   - Time window: ?hours=48 (default), max 720 (30 days)
 *   - Redis-cached for 3 minutes (key: `hazards:map:points:${hours}`)
 *   - Rate limited to 60 req/min no auth
 *   - Returns: id, title, lat, lng, severity, category, source_slug, published_at, reliability_score
 *
 * Counters Crucix satellite fire + seismic features by providing unified natural
 * hazard intelligence (earthquakes, volcanos, tsunamis, wildfires) in a single layer.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for hazards map cache: 3 minutes */
export const HAZARDS_CACHE_TTL = 180

/** Rate limit for hazards endpoints: requests per minute */
export const HAZARDS_RATE_LIMIT = 60

/** Redis key prefix for hazards cache */
export const HAZARDS_CACHE_KEY_PREFIX = 'hazards:map:points'

/** Maximum hours to look back (30 days) */
export const HAZARDS_MAX_HOURS = 720

/** Default hours to look back (2 days) */
export const HAZARDS_DEFAULT_HOURS = 48

/** Hazard source slugs */
const HAZARD_SOURCES = ['seismic', 'gvp-volcano', 'tsunami-warnings', 'firms']

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HazardPoint {
  id: string
  title: string
  lat: number
  lng: number
  severity: string
  category: string
  source_slug: string
  published_at: string
  reliability_score: number
}

export interface HazardsMapResponse {
  success: boolean
  cached: boolean
  data: {
    points: HazardPoint[]
    count: number
    hours: number
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerHazardsRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['hazards']
  })

  // ── GET /map/points ────────────────────────────────────────────────────────

  app.get('/map/points', {
    config: {
      rateLimit: {
        max:        HAZARDS_RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags:    ['hazards'],
      summary: 'Natural hazard signals (seismic, volcano, tsunami, wildfire) for map layer',
      querystring: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Hours to look back (1-720, default 48)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cached:  { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                points: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'title', 'lat', 'lng', 'severity', 'category', 'source_slug', 'published_at', 'reliability_score'],
                    properties: {
                      id:                 { type: 'string' },
                      title:              { type: 'string' },
                      lat:                { type: 'number' },
                      lng:                { type: 'number' },
                      severity:           { type: 'string' },
                      category:           { type: 'string' },
                      source_slug:        { type: 'string' },
                      published_at:       { type: 'string' },
                      reliability_score:  { type: 'number' },
                    },
                  },
                },
                count: { type: 'number' },
                hours: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    // ── Parse and validate hours parameter ──────────────────────────────────
    let hours = HAZARDS_DEFAULT_HOURS
    if (typeof req.query === 'object' && req.query !== null) {
      const hParam = (req.query as Record<string, unknown>).hours
      if (hParam !== undefined) {
        const h = Number(hParam)
        if (!isFinite(h) || h < 1 || h > HAZARDS_MAX_HOURS) {
          return reply.status(400).send({
            success: false,
            error: `hours must be between 1 and ${HAZARDS_MAX_HOURS}`,
            code: 'INVALID_HOURS',
          })
        }
        hours = h
      }
    }

    // ── Cache check ────────────────────────────────────────────────────────
    const cacheKey = `${HAZARDS_CACHE_KEY_PREFIX}:${hours}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      const points = JSON.parse(cached) as HazardPoint[]
      return reply.send({
        success: true,
        cached: true,
        data: {
          points,
          count: points.length,
          hours,
        },
      } as HazardsMapResponse)
    }

    // ── DB query ──────────────────────────────────────────────────────────
    try {
      const rows = await db('signals')
        .select(
          'id',
          'title',
          'category',
          'severity',
          'reliability_score',
          'source_id as source_slug',
          'published_at',
          db.raw('ST_X(location::geometry) as lng'),
          db.raw('ST_Y(location::geometry) as lat'),
        )
        .whereIn('source_id', HAZARD_SOURCES)
        .whereRaw('location IS NOT NULL')
        .whereRaw('ST_X(location::geometry) IS NOT NULL AND ST_Y(location::geometry) IS NOT NULL')
        .whereRaw(`published_at > now() - interval '${hours} hours'`)
        .orderBy('published_at', 'desc')
        .limit(1000) as Array<{
          id:                string
          title:             string
          category:          string
          severity:          string
          reliability_score: number
          source_slug:       string
          published_at:      string | Date
          lat:               number | null
          lng:               number | null
        }>

      // Filter valid coordinates and normalize dates
      const points: HazardPoint[] = rows
        .filter(row => row.lat != null && row.lng != null && isValidCoordinate(row.lat, row.lng))
        .map(row => ({
          id:                row.id,
          title:             row.title,
          lat:               row.lat!,
          lng:               row.lng!,
          severity:          row.severity,
          category:          row.category,
          source_slug:       row.source_slug,
          published_at:      typeof row.published_at === 'string'
            ? row.published_at
            : (row.published_at as Date).toISOString(),
          reliability_score: row.reliability_score,
        }))

      // ── Cache and respond ──────────────────────────────────────────────
      await redis.setex(cacheKey, HAZARDS_CACHE_TTL, JSON.stringify(points))

      return reply.send({
        success: true,
        cached: false,
        data: {
          points,
          count: points.length,
          hours,
        },
      } as HazardsMapResponse)
    } catch (err) {
      console.error('[hazards] DB error:', err)
      return reply.status(500).send({
        success: false,
        error: 'Database error',
        code: 'DB_ERROR',
      })
    }
  })
}

/**
 * Returns true if lat/lng are valid WGS-84 coordinates.
 */
function isValidCoordinate(lat: number, lng: number): boolean {
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
