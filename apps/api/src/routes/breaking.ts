import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import {
  getActiveBreakingAlerts,
  dismissBreakingAlert,
  BREAKING_ALERT_RATE_LIMIT,
  BREAKING_ALERT_WINDOW_S,
} from '../lib/breaking-alerts'
import type { BreakingAlert } from '../lib/breaking-alerts'
import { redis } from '../db/redis'
import { logger } from '../lib/logger'
import { sendError } from '../lib/errors'
import { authenticate } from '../middleware/auth'
import { internalCallHeaders } from '../lib/internal-call'

const BREAKING_CACHE_TTL = 15 // 15-second cache for GET

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An alert's story as GET /api/v1/stories/outlets counts it: what the banner shows beside the headline */
export interface AlertStory { id: string; outlets: number; verified: boolean; countries: number; page: string }

/**
 * Each story once, as its newest alert, with its outlet count (Nov 9, 2026; Devon: "the banner should always be
 * accurate"): a story often gets an alert from two of its reports ("21 dead after migrant boat sinks off Senegal",
 * "At least 35 killed in migrant boat sinking off Senegal"), and a headline alone doesn't say how sure the news is.
 * The counts are the story page's, asked of the outlets route; without them the alerts still go out, story null.
 */
export async function withStories(app: FastifyInstance, alerts: BreakingAlert[]): Promise<Array<BreakingAlert & { story: AlertStory | null }>> {
  const newest = alerts.slice().sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
  const ids = [...new Set(newest.map(a => a.signalId).filter(id => UUID_RE.test(String(id))))].slice(0, 50)
  type Count = { storyId?: string; outlets?: number; verified?: boolean; countries?: number; canonicalId?: string | null }
  let counts: Record<string, Count> = {}
  if (ids.length > 0) {
    try {
      const res = await app.inject({ method: 'GET', url: `/api/v1/stories/outlets?ids=${ids.join(',')}`, headers: internalCallHeaders('breaking-alerts') })
      if (res.statusCode === 200) counts = ((res.json() as { data?: { stories?: Record<string, Count> } }).data?.stories) ?? {}
    } catch (err) {
      logger.warn({ err }, 'Breaking alerts: outlet counts unavailable')
    }
  }
  const seen = new Set<string>()
  const out: Array<BreakingAlert & { story: AlertStory | null }> = []
  for (const a of newest) {
    const c = counts[a.signalId]
    const key = c?.storyId ?? a.signalId
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      ...a,
      story: c ? {
        id: key, outlets: Number(c.outlets) || 1, verified: c.verified === true, countries: Number(c.countries) || 0,
        page: c.canonicalId && UUID_RE.test(c.canonicalId) ? c.canonicalId : a.signalId,
      } : null,
    })
  }
  return out
}

export const registerBreakingRoutes: FastifyPluginAsync = async (app) => {
  // Tag all routes in this plugin
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['breaking-alerts']
  })

  // ─── GET /alerts — active breaking alerts (public, no auth) ───────────
  app.get<{
    Reply: { success: boolean; data: { alerts: Array<BreakingAlert & { story: AlertStory | null }>; count: number } }
  }>(
    '/alerts',
    {
      schema: {
        tags: ['breaking-alerts'],
        description: 'Get all active breaking news alerts',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  alerts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        alertId:      { type: 'string' },
                        signalId:     { type: 'string' },
                        title:        { type: 'string' },
                        severity:     { type: 'string', enum: ['critical', 'high'] },
                        category:     { type: 'string' },
                        locationName: { type: 'string' },
                        countryCode:  { type: 'string' },
                        sourceUrl:    { type: 'string' },
                        timestamp:    { type: 'string', format: 'date-time' },
                        expiresAt:    { type: 'string', format: 'date-time' },
                        story: {
                          type: ['object', 'null'],
                          properties: {
                            id:        { type: 'string' },
                            outlets:   { type: 'number' },
                            verified:  { type: 'boolean' },
                            countries: { type: 'number' },
                            page:      { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                  count: { type: 'number' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    async (_request, reply) => {
      try {
        // Cache hit?
        const cached = await redis.get('breaking:alerts:cache')
        if (cached) {
          reply.header('X-Cache', 'HIT')
          return reply.send(JSON.parse(cached))
        }

        const alerts = await getActiveBreakingAlerts()

        // Filter out expired alerts; each story once, with its outlet count
        const now = Date.now()
        const active = await withStories(app, alerts.filter((a) => new Date(a.expiresAt).getTime() > now))

        const body = { success: true as const, data: { alerts: active, count: active.length } }

        await redis.setex('breaking:alerts:cache', BREAKING_CACHE_TTL, JSON.stringify(body))
        reply.header('X-Cache', 'MISS')
        return reply.send(body)
      } catch (err) {
        logger.error({ err }, 'Failed to fetch breaking alerts')
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error')
      }
    },
  )

  // ─── POST /alerts/:alertId/dismiss — dismiss a single alert ───────────
  app.post<{ Params: { alertId: string }; Reply: { success: boolean } }>(
    '/alerts/:alertId/dismiss',
    {
      // admins only (Nov 8, 2026): anyone could remove an alert for everyone, and the banner did each one after 60 seconds
      preHandler: [authenticate],
      schema: {
        tags: ['breaking-alerts'],
        description: 'Dismiss a breaking news alert',
        params: {
          type: 'object',
          properties: {
            alertId: { type: 'string', description: 'UUID of the alert to dismiss' },
          },
          required: ['alertId'],
        },
        response: {
          200: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        if (!request.user || request.user.accountType !== 'admin') {
          return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
        }
        const { alertId } = request.params
        if (!alertId || alertId.trim().length === 0) {
          return sendError(reply, 400, 'BAD_REQUEST', 'Bad request')
        }

        await dismissBreakingAlert(alertId)
        // Invalidate cache
        await redis.del('breaking:alerts:cache')

        return reply.send({ success: true })
      } catch (err) {
        logger.error({ err }, 'Failed to dismiss breaking alert')
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error')
      }
    },
  )

  // ─── GET /stats — breaking alert statistics ────────────────────────────
  app.get<{
    Reply: { success: boolean; data: { activeCount: number; alertsLastHour: number; rateLimit: number; rateLimitWindowS: number } }
  }>(
    '/stats',
    {
      schema: {
        tags: ['breaking-alerts'],
        description: 'Get breaking news alert statistics',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  activeCount:      { type: 'number' },
                  alertsLastHour:   { type: 'number' },
                  rateLimit:        { type: 'number' },
                  rateLimitWindowS: { type: 'number' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    async (_request, reply) => {
      try {
        const alerts = await getActiveBreakingAlerts()
        const now = Date.now()
        const active = alerts.filter((a) => new Date(a.expiresAt).getTime() > now)
        const oneHourAgo = now - 3_600_000
        const recentCount = active.filter((a) => new Date(a.timestamp).getTime() > oneHourAgo).length

        return reply.send({
          success: true,
          data: {
            activeCount: active.length,
            alertsLastHour: recentCount,
            rateLimit: BREAKING_ALERT_RATE_LIMIT,
            rateLimitWindowS: BREAKING_ALERT_WINDOW_S,
          },
        })
      } catch (err) {
        logger.error({ err }, 'Failed to fetch breaking alert stats')
        return reply.status(500).send({
          success: true,
          data: { activeCount: 0, alertsLastHour: 0, rateLimit: BREAKING_ALERT_RATE_LIMIT, rateLimitWindowS: BREAKING_ALERT_WINDOW_S },
        })
      }
    },
  )
}
