import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

const EMBED_CACHE_TTL = 30 // seconds

/**
 * Public embed API — no authentication required.
 * All responses include CORS headers that allow any origin.
 *
 * Routes registered under /api/v1/embed/:
 *   GET /signals  — latest verified signals (public, cacheable)
 */
export const registerEmbedRoutes: FastifyPluginAsync = async (app) => {

  // CORS pre-flight for all embed routes
  app.options('*', {
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    reply
      .header('Access-Control-Allow-Origin',  '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      .header('Access-Control-Max-Age',       '86400')
      .code(204)
      .send()
  })

  // ─── GET /api/v1/embed/signals ──────────────────────────────────────────────
  app.get('/signals', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const {
      limit    = 10,
      category = 'all',
      severity,
    } = req.query as {
      limit?:    number
      category?: string
      severity?: string
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20)

    const cacheKey = `embed:signals:${safeLimit}:${category}:${severity ?? 'all'}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      return reply
        .header('Access-Control-Allow-Origin', '*')
        .header('X-Cache-Hit', 'true')
        .header('Content-Type', 'application/json')
        .send(cached)
    }

    // Use Knex query builder so parameterization is handled correctly.
    type EmbedRow = {
      id:                string
      title:             string
      summary:           string | null
      severity:          string
      category:          string
      location_name:     string | null
      country_code:      string | null
      reliability_score: number
      created_at:        Date
    }

    let baseQuery = db('signals as s')
      .where('s.status', 'verified')
      .select([
        's.id', 's.title', 's.summary', 's.severity', 's.category',
        's.location_name', 's.country_code', 's.reliability_score', 's.created_at',
      ])
      .orderBy('s.created_at', 'desc')
      .limit(safeLimit)

    if (category && category !== 'all') baseQuery = baseQuery.where('s.category', category)
    if (severity) baseQuery = baseQuery.where('s.severity', severity)

    const rows = (await baseQuery) as EmbedRow[]

    const signals = rows.map((r) => ({
      id:                r.id,
      title:             r.title,
      summary:           r.summary,
      severity:          r.severity,
      category:          r.category,
      location_name:     r.location_name,
      country_code:      r.country_code,
      reliability_score: r.reliability_score,
      created_at:        r.created_at.toISOString(),
      url:               `https://worldpulse.io/signals/${r.id}`,
    }))

    const payload = JSON.stringify({ signals, total: signals.length })
    await redis.set(cacheKey, payload, 'EX', EMBED_CACHE_TTL)

    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('X-Cache-Hit', 'false')
      .header('Cache-Control', `public, max-age=${EMBED_CACHE_TTL}`)
      .header('Content-Type', 'application/json')
      .send(payload)
  })
}
