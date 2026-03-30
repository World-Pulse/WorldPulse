/**
 * Space Weather Intelligence API
 *
 * Exposes NOAA Space Weather Prediction Center (spaceweather) and CelesTrak
 * satellite tracking (celestrak) signals as structured intelligence endpoints.
 *
 * Endpoints:
 *   GET /api/v1/space-weather/recent   — recent space weather events (last N hours)
 *   GET /api/v1/space-weather/summary  — current G/R/S storm levels + satellite counts
 *
 * Sources:
 *   - NOAA SWPC (source_slug='spaceweather'): G/R/S scale events (G1-G5, R1-R5, S1-S5)
 *   - CelesTrak (source_slug='celestrak'): satellite launches, re-entries, decay events
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for recent events cache: 3 minutes */
const SW_CACHE_TTL         = 180

/** Redis TTL for summary cache: 5 minutes */
const SUMMARY_CACHE_TTL    = 300

/** Rate limit: requests per minute */
const SW_RATE_LIMIT        = 60

/** Default hours to look back */
const SW_DEFAULT_HOURS     = 48

/** Maximum hours to look back (30 days) */
const SW_MAX_HOURS         = 720

/** Default result limit */
const SW_DEFAULT_LIMIT     = 50

/** Maximum result limit */
const SW_MAX_LIMIT         = 200

/** Source slugs for space weather data */
const SW_SOURCES           = ['spaceweather', 'celestrak']

/** Redis cache key for recent events */
const CACHE_KEY_RECENT     = 'space-weather:recent'

/** Redis cache key for summary */
const CACHE_KEY_SUMMARY    = 'space-weather:summary'

/** Ordered severity levels (highest → lowest) */
const SEVERITY_ORDER       = ['critical', 'high', 'medium', 'low']

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpaceWeatherEvent {
  id:                string
  title:             string
  summary:           string
  severity:          string
  published_at:      string
  reliability_score: number
  source_slug:       string
  source_url:        string | null
  lat:               number | null
  lng:               number | null
}

export interface SpaceWeatherSummary {
  geomagnetic_level:     number        // 0-5 (G-scale)
  solar_radiation_level: number        // 0-5 (S-scale)
  radio_blackout_level:  number        // 0-5 (R-scale)
  active_events:         number        // total events in last 24h
  latest_at:             string | null // ISO timestamp of most recent event
  satellite_events_24h:  number        // celestrak events in last 24h
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerSpaceWeatherRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['space-weather']
  })

  // ── GET /recent ────────────────────────────────────────────────────────────

  app.get('/recent', {
    config: {
      rateLimit: { max: SW_RATE_LIMIT, timeWindow: '1 minute' },
    },
    schema: {
      tags:    ['space-weather'],
      summary: 'Recent space weather events — NOAA SWPC geomagnetic/radiation/blackout + CelesTrak satellite activity',
      querystring: {
        type: 'object',
        properties: {
          hours:    { type: 'number', description: 'Hours to look back (1-720, default 48)' },
          limit:    { type: 'number', description: 'Max results (1-200, default 50)' },
          severity: { type: 'string', description: 'Filter by minimum severity: critical|high|medium|low' },
        },
      },
    },
  }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>

    // ── Parse hours ──────────────────────────────────────────────────────────
    let hours = SW_DEFAULT_HOURS
    if (q.hours !== undefined) {
      const h = Number(q.hours)
      if (!isFinite(h) || h < 1 || h > SW_MAX_HOURS) {
        return reply.status(400).send({
          success: false,
          error:   `hours must be 1-${SW_MAX_HOURS}`,
          code:    'INVALID_HOURS',
        })
      }
      hours = h
    }

    // ── Parse limit ──────────────────────────────────────────────────────────
    let limit = SW_DEFAULT_LIMIT
    if (q.limit !== undefined) {
      const l = Number(q.limit)
      if (!isFinite(l) || l < 1 || l > SW_MAX_LIMIT) {
        return reply.status(400).send({
          success: false,
          error:   `limit must be 1-${SW_MAX_LIMIT}`,
          code:    'INVALID_LIMIT',
        })
      }
      limit = l
    }

    // ── Parse severity filter ────────────────────────────────────────────────
    const minSeverity: string | null =
      typeof q.severity === 'string' && SEVERITY_ORDER.includes(q.severity)
        ? q.severity
        : null

    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = `${CACHE_KEY_RECENT}:${hours}:${minSeverity ?? 'all'}:${limit}`
    const cachedRaw = await redis.get(cacheKey)
    if (cachedRaw) {
      const events = JSON.parse(cachedRaw) as SpaceWeatherEvent[]
      return reply.send({ success: true, cached: true, data: { events, count: events.length, hours } })
    }

    // ── DB query ─────────────────────────────────────────────────────────────
    try {
      let query = db('signals')
        .select(
          'id',
          'title',
          'summary',
          'severity',
          'source_url',
          'reliability_score',
          'published_at',
          'source_id as source_slug',
          db.raw('ST_X(location::geometry) as lng'),
          db.raw('ST_Y(location::geometry) as lat'),
        )
        .whereIn('source_id', SW_SOURCES)
        .whereRaw(`published_at > now() - interval '${hours} hours'`)
        .orderBy('published_at', 'desc')
        .limit(limit)

      if (minSeverity) {
        const minIdx = SEVERITY_ORDER.indexOf(minSeverity)
        const allowed = SEVERITY_ORDER.slice(0, minIdx + 1)
        query = query.whereIn('severity', allowed)
      }

      const rows = await query as Array<{
        id:                string
        title:             string
        summary:           string | null
        severity:          string
        source_url:        string | null
        source_slug:       string
        reliability_score: number
        published_at:      string | Date
        lat:               number | null
        lng:               number | null
      }>

      const events: SpaceWeatherEvent[] = rows.map(r => ({
        id:                r.id,
        title:             r.title,
        summary:           r.summary ?? '',
        severity:          r.severity,
        source_slug:       r.source_slug,
        source_url:        r.source_url,
        published_at:      typeof r.published_at === 'string'
          ? r.published_at
          : (r.published_at as Date).toISOString(),
        reliability_score: r.reliability_score,
        lat:               typeof r.lat === 'number' && isFinite(r.lat) ? r.lat : null,
        lng:               typeof r.lng === 'number' && isFinite(r.lng) ? r.lng : null,
      }))

      await redis.setex(cacheKey, SW_CACHE_TTL, JSON.stringify(events))

      return reply.send({ success: true, cached: false, data: { events, count: events.length, hours } })
    } catch (err) {
      console.error('[space-weather] DB error (recent):', err)
      return reply.status(500).send({ success: false, error: 'Database error', code: 'DB_ERROR' })
    }
  })

  // ── GET /summary ───────────────────────────────────────────────────────────

  app.get('/summary', {
    config: {
      rateLimit: { max: SW_RATE_LIMIT, timeWindow: '1 minute' },
    },
    schema: {
      tags:    ['space-weather'],
      summary: 'Space weather summary — current G/R/S storm levels and active event counts (last 24h)',
    },
  }, async (_req, reply) => {

    // ── Cache check ──────────────────────────────────────────────────────────
    const cachedRaw = await redis.get(CACHE_KEY_SUMMARY)
    if (cachedRaw) {
      const summary = JSON.parse(cachedRaw) as SpaceWeatherSummary
      return reply.send({ success: true, cached: true, data: summary })
    }

    // ── DB query ─────────────────────────────────────────────────────────────
    try {
      const rows = await db('signals')
        .select('id', 'title', 'severity', 'source_id', 'published_at')
        .whereIn('source_id', SW_SOURCES)
        .whereRaw("published_at > now() - interval '24 hours'")
        .orderBy('published_at', 'desc')
        .limit(500) as Array<{
          id:           string
          title:        string
          severity:     string
          source_id:    string
          published_at: string | Date
        }>

      const spaceweatherRows = rows.filter(r => r.source_id === 'spaceweather')
      const celestrakRows    = rows.filter(r => r.source_id === 'celestrak')

      let geomagneticLevel   = 0
      let solarRadLevel      = 0
      let radioBlackoutLevel = 0
      let latestAt: string | null = null

      for (const row of spaceweatherRows) {
        const published = typeof row.published_at === 'string'
          ? row.published_at
          : (row.published_at as Date).toISOString()

        if (!latestAt || published > latestAt) latestAt = published

        const g = extractScaleLevel(row.title, 'G')
        const s = extractScaleLevel(row.title, 'S')
        const r = extractScaleLevel(row.title, 'R')
        if (g > geomagneticLevel)   geomagneticLevel   = g
        if (s > solarRadLevel)      solarRadLevel      = s
        if (r > radioBlackoutLevel) radioBlackoutLevel = r
      }

      // Update latestAt if a celestrak row is newer
      for (const row of celestrakRows) {
        const published = typeof row.published_at === 'string'
          ? row.published_at
          : (row.published_at as Date).toISOString()
        if (!latestAt || published > latestAt) latestAt = published
      }

      const summary: SpaceWeatherSummary = {
        geomagnetic_level:     geomagneticLevel,
        solar_radiation_level: solarRadLevel,
        radio_blackout_level:  radioBlackoutLevel,
        active_events:         rows.length,
        latest_at:             latestAt,
        satellite_events_24h:  celestrakRows.length,
      }

      await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(summary))

      return reply.send({ success: true, cached: false, data: summary })
    } catch (err) {
      console.error('[space-weather] DB error (summary):', err)
      return reply.status(500).send({ success: false, error: 'Database error', code: 'DB_ERROR' })
    }
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extracts the numeric level (1–5) from a NOAA scale designation in a title.
 * Examples: "Geomagnetic Storm Watch G3" → 3 (scale='G')
 *           "Radio Blackout R1 Minor"    → 1 (scale='R')
 * Returns 0 if not found or not parseable.
 */
function extractScaleLevel(title: string, scale: 'G' | 'R' | 'S'): number {
  const match = title.match(new RegExp(`${scale}([1-5])`, 'i'))
  if (!match || !match[1]) return 0
  const n = parseInt(match[1], 10)
  return isNaN(n) ? 0 : Math.min(5, Math.max(0, n))
}
