/**
 * GET /api/v1/admin/kafka/lag
 *
 * Admin endpoint for Kafka consumer group lag monitoring.
 * Returns full lag report with per-partition breakdown.
 * Requires admin auth. Results are cached 30s in Redis.
 */

import type { FastifyPluginAsync } from 'fastify'
import { authenticate } from '../middleware/auth'
import { getLagSummary } from '../lib/kafka-lag'

export const registerAdminKafkaRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags     = routeOptions.schema.tags     ?? ['admin']
    routeOptions.schema.security = routeOptions.schema.security ?? [{ bearerAuth: [] }]
  })

  // ─── GET /api/v1/admin/kafka/lag ─────────────────────────────────────────
  app.get('/kafka/lag', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags:        ['admin'],
      summary:     'Kafka consumer group lag report',
      description: [
        'Returns per-partition lag for all monitored consumer groups.',
        'Results are cached 30 s in Redis (key: kafka:lag:report).',
        'Status thresholds: warning ≥ 500 msgs, critical ≥ 2000 msgs.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      response: {
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
          },
        },
        503: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
          },
        },
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total_lag:      { type: 'number' },
                overall_status: { type: 'string', enum: ['healthy', 'warning', 'critical', 'unavailable'] },
                checked_at:     { type: 'string', format: 'date-time' },
                groups: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      groupId:   { type: 'string' },
                      totalLag:  { type: 'number' },
                      status:    { type: 'string', enum: ['healthy', 'warning', 'critical'] },
                      partitions: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            topic:     { type: 'string' },
                            partition: { type: 'number' },
                            lag:       { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Admin access required', code: 'FORBIDDEN' })
    }
    try {
      const summary = await getLagSummary()
      if (summary.overall_status === 'unavailable') {
        return reply.status(503).send({ success: false, error: 'Kafka unavailable', code: 'KAFKA_ERROR' })
      }
      return reply.send({ success: true, data: summary })
    } catch (err) {
      req.log.error({ err }, 'Kafka lag fetch failed')
      return reply.status(503).send({ success: false, error: 'Kafka unavailable', code: 'KAFKA_ERROR' })
    }
  })
}
