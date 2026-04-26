import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { generateDailyBriefing } from '../lib/briefing-generator'

const BRIEFING_CACHE_TTL = 15 * 60 // 15 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

interface BriefingSignalRow {
  id: string
  title: string
  summary: string | null
  severity: string
  reliability_score: string | number
  location_name: string | null
  country_code: string | null
  category: string
  published_at: Date | string
  source_count: string | number
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export const registerBriefingDailyRoutes: FastifyPluginAsync = async (app) => {

  // Auto-tag all routes in this plugin
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['briefing']
  })

  // ─── GET /api/v1/briefing/daily ──────────────────────────────────────────────
  // Returns structured top-20 signals from the last 24h (or specified date),
  // grouped by category. Cached in Redis for 15 minutes. Public, no auth.
  app.get('/daily', {
    schema: {
      summary: 'Get structured daily intelligence briefing',
      description: [
        'Returns the top 20 signals from the last 24 hours (or the specified date),',
        'ordered by severity then reliability score.',
        'Results are grouped by category and cached for 15 minutes.',
        'No authentication required.',
      ].join(' '),
      querystring: {
        type: 'object',
        properties: {
          date:     { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to today.' },
          category: { type: 'string', description: 'Filter to a single category (e.g. conflict, climate).' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                date:            { type: 'string' },
                generated_at:    { type: 'string' },
                headline_count:  { type: 'integer' },
                sections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      category: { type: 'string' },
                      signals: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id:                { type: 'string' },
                            title:             { type: 'string' },
                            summary:           { type: ['string', 'null'] },
                            severity:          { type: 'string' },
                            reliability_score: { type: 'number' },
                            location_name:     { type: ['string', 'null'] },
                            country_code:      { type: ['string', 'null'] },
                            category:          { type: 'string' },
                            published_at:      { type: 'string' },
                            source_count:      { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
                top_locations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      location_name: { type: 'string' },
                      count:         { type: 'integer' },
                    },
                  },
                },
                severity_breakdown: {
                  type: 'object',
                  properties: {
                    critical: { type: 'integer' },
                    high:     { type: 'integer' },
                    medium:   { type: 'integer' },
                    low:      { type: 'integer' },
                  },
                },
              },
            },
          },
        },
        429: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
          },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
    const { date, category } = req.query as { date?: string; category?: string }

    // Determine date window
    const targetDate = date ?? new Date().toISOString().slice(0, 10)
    const categoryKey = category ?? 'all'
    const cacheKey = `briefing:${targetDate}:${categoryKey}`

    // Return cached result if available
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))
    }

    // Build time range: full day if date supplied, last 24h otherwise
    let fromDate: Date
    let toDate: Date
    if (date) {
      fromDate = new Date(`${date}T00:00:00.000Z`)
      toDate   = new Date(`${date}T23:59:59.999Z`)
    } else {
      toDate   = new Date()
      fromDate = new Date(toDate.getTime() - 24 * 60 * 60 * 1000)
    }

    // ── Query top 20 signals ordered by severity then reliability ─────────────
    let query = db('signals')
      .select([
        'id',
        'title',
        'summary',
        'severity',
        'reliability_score',
        'location_name',
        'country_code',
        'category',
        db.raw('created_at AS published_at'),
        db.raw('COALESCE(cardinality(source_ids), 0) AS source_count'),
        db.raw(`
          CASE severity
            WHEN 'critical' THEN 4
            WHEN 'high'     THEN 3
            WHEN 'medium'   THEN 2
            WHEN 'low'      THEN 1
            ELSE 0
          END AS severity_rank
        `),
      ])
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .orderByRaw('severity_rank DESC, reliability_score DESC')
      .limit(20)

    if (category && category !== 'all') {
      query = query.where('category', category)
    }

    const rows = (await query) as BriefingSignalRow[]

    // ── Group by category into sections ───────────────────────────────────────
    const sectionMap = new Map<string, BriefingSignalRow[]>()
    for (const row of rows) {
      const cat = row.category
      if (!sectionMap.has(cat)) sectionMap.set(cat, [])
      sectionMap.get(cat)?.push(row)
    }

    const sections = Array.from(sectionMap.entries()).map(([cat, sigs]) => ({
      category: cat,
      signals:  sigs.map((s) => ({
        id:                s.id,
        title:             s.title,
        summary:           s.summary ?? null,
        severity:          s.severity,
        reliability_score: Number(s.reliability_score),
        location_name:     s.location_name ?? null,
        country_code:      s.country_code ?? null,
        category:          s.category,
        published_at:      s.published_at instanceof Date
          ? s.published_at.toISOString()
          : String(s.published_at),
        source_count:      Number(s.source_count),
      })),
    }))

    // ── Top locations (up to 5) ────────────────────────────────────────────────
    const locationCounts = new Map<string, number>()
    for (const row of rows) {
      if (row.location_name) {
        locationCounts.set(row.location_name, (locationCounts.get(row.location_name) ?? 0) + 1)
      }
    }
    const top_locations = Array.from(locationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([location_name, count]) => ({ location_name, count }))

    // ── Severity breakdown ────────────────────────────────────────────────────
    const severity_breakdown = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const row of rows) {
      const sev = row.severity as keyof typeof severity_breakdown
      if (sev in severity_breakdown) severity_breakdown[sev]++
    }

    const response = {
      success: true,
      data: {
        date:           targetDate,
        generated_at:   new Date().toISOString(),
        headline_count: rows.length,
        sections,
        top_locations,
        severity_breakdown,
      },
    }

    // Cache for 15 minutes (non-blocking)
    redis.setex(cacheKey, BRIEFING_CACHE_TTL, JSON.stringify(response)).catch(() => {})

    return reply.send(response)
    } catch (err) {
      req.log.error({ err }, 'briefing/daily: handler error')
      return reply.send({
        success: true,
        data: {
          date: new Date().toISOString().slice(0, 10),
          generated_at: new Date().toISOString(),
          headline_count: 0,
          sections: [],
          top_locations: [],
          severity_breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
        },
      })
    }
  })

  // ─── GET /api/v1/briefing/structured ────────────────────────────────────────
  // Returns the AI-generated 7-section structured briefing (with caching).
  // No auth required — public endpoint.
  app.get('/structured', {
    schema: {
      tags: ['briefing'],
      summary: 'Get AI-generated structured daily briefing with 7 fixed sections',
    },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
      const briefing = await generateDailyBriefing(24)
      return reply.send(briefing)
    } catch (err) {
      req.log.error({ err }, 'briefing/structured: handler error')
      return reply.status(500).send({ success: false, error: 'Failed to generate structured briefing' })
    }
  })
}
