import type { FastifyPluginAsync } from 'fastify'
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

const BREAKING_CACHE_TTL = 15 // 15-second cache for GET

export const registerBreakingRoutes: FastifyPluginAsync = async (app) => {
  // Tag all routes in this plugin
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['breaking-alerts']
  })

  // ─── GET /alerts — active breaking alerts (public, no auth) ───────────
  app.get<{
    Reply: { success: boolean; data: { alerts: BreakingAlert[]; count: number } }
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

        // Filter out expired alerts
        const now = Date.now()
        const active = alerts.filter((a) => new Date(a.expiresAt).getTime() > now)

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
