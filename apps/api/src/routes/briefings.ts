import type { FastifyPluginAsync } from 'fastify'
import { generateDailyBriefing, getBriefingHistory } from '../lib/briefing-generator'
import { optionalAuth } from '../middleware/auth'

export const registerBriefingRoutes: FastifyPluginAsync = async (app) => {

  // Auto-tag all routes in this plugin
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['briefings']
  })

  // ─── GET /api/v1/briefings/daily ────────────────────────────────────────────
  // Generate or retrieve today's daily intelligence briefing.
  // Optional query param: ?hours=24 (default 24, max 72)
  app.get('/daily', {
    schema: {
      summary: 'Get daily intelligence briefing',
      description: 'Returns an AI-generated daily intelligence briefing summarizing the most significant signals, event clusters, geographic hotspots, and threat assessment for the specified period.',
      querystring: {
        type: 'object',
        properties: {
          hours: { type: 'integer', minimum: 1, maximum: 72, default: 24 },
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
                id: { type: 'string' },
                date: { type: 'string' },
                generated_at: { type: 'string' },
                model: { type: 'string' },
                period_hours: { type: 'integer' },
                total_signals: { type: 'integer' },
                total_clusters: { type: 'integer' },
                executive_summary: { type: 'string' },
                key_developments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      headline: { type: 'string' },
                      detail: { type: 'string' },
                      severity: { type: 'string' },
                      category: { type: 'string' },
                      signal_count: { type: 'integer' },
                    },
                  },
                },
                category_breakdown: { type: 'array' },
                geographic_hotspots: { type: 'array' },
                threat_assessment: { type: 'string' },
                outlook: { type: 'string' },
                top_signals: { type: 'array' },
              },
            },
          },
        },
      },
    },
    preHandler: optionalAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const { hours = 24 } = req.query as { hours?: number }
    const briefing = await generateDailyBriefing(Math.min(hours, 72))
    return { success: true, data: briefing }
  })

  // ─── GET /api/v1/briefings/history ──────────────────────────────────────────
  // Returns a list of recent daily briefings (last 30).
  app.get('/history', {
    schema: {
      summary: 'Get briefing history',
      description: 'Returns metadata for the last 30 daily intelligence briefings.',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  date: { type: 'string' },
                  generated_at: { type: 'string' },
                  total_signals: { type: 'integer' },
                  total_clusters: { type: 'integer' },
                  model: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    preHandler: optionalAuth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async () => {
    const history = await getBriefingHistory()
    return { success: true, data: history }
  })
}
