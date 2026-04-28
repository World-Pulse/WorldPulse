import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'
import { generateApiKey, TIER_LIMITS } from '../lib/api-keys'
import { sendError } from '../lib/errors'

const CreateKeySchema = z.object({
  name: z.string().min(1).max(100),
  tier: z.enum(['free', 'pro', 'enterprise']),
})

// ─── Webhook schemas ─────────────────────────────────────────────────────────

const ALLOWED_EVENTS = ['signal.new', 'signal.updated', 'alert.breaking'] as const

const CreateWebhookSchema = z.object({
  url:     z.string().url().max(2048),
  events:  z.array(z.enum(ALLOWED_EVENTS)).min(1).max(10).default(['signal.new']),
  filters: z.object({
    category:     z.string().max(50).optional(),
    severity:     z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
    country_code: z.string().length(2).toUpperCase().optional(),
  }).default({}),
})

const MAX_WEBHOOKS_PER_USER = 10

export const registerDeveloperRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['developer']
  })

  // ─── CREATE KEY ──────────────────────────────────────────
  app.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = CreateKeySchema.safeParse(req.body)
    if (!body.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input')
    }

    const { name, tier } = body.data
    // Zod already validated tier is one of the three known keys
    const limits = TIER_LIMITS[tier] ?? { rpm: 60, rpd: 1_000 }
    const { key, hash } = generateApiKey()

    const [row] = await db('api_keys')
      .insert({
        user_id:            req.user.id,
        name,
        key_hash:           hash,
        tier,
        rate_limit_per_min: limits.rpm,
        rate_limit_per_day: limits.rpd,
      })
      .returning(['id', 'name', 'tier', 'rate_limit_per_min', 'rate_limit_per_day', 'is_active', 'created_at'])

    return reply.status(201).send({
      success: true,
      data: {
        ...row,
        key, // returned ONCE — not stored in plaintext
      },
    })
  })

  // ─── LIST KEYS ───────────────────────────────────────────
  app.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const keys = await db('api_keys')
      .where('user_id', req.user.id)
      .orderBy('created_at', 'desc')
      .select(['id', 'name', 'tier', 'rate_limit_per_min', 'rate_limit_per_day', 'is_active', 'last_used_at', 'created_at'])

    return reply.send({ success: true, data: keys })
  })

  // ─── REVOKE KEY ──────────────────────────────────────────
  app.delete('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const updated = await db('api_keys')
      .where({ id, user_id: req.user.id })
      .update({ is_active: false })

    if (!updated) {
      return sendError(reply, 404, 'NOT_FOUND', 'API key not found')
    }

    return reply.send({ success: true })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS — /api/v1/developer/webhooks
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── REGISTER WEBHOOK ────────────────────────────────────
  app.post('/webhooks', {
    preHandler: [authenticate],
    schema: {
      summary:     'Register an outbound webhook',
      description: 'Register a URL to receive HTTP POST deliveries when WorldPulse events fire. The signing secret is returned ONCE — store it securely.',
    },
  }, async (req, reply) => {
    const parsed = CreateWebhookSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input')
    }

    // Enforce per-user limit
    const countRows = await db('developer_webhooks').where({ user_id: req.user.id, is_active: true }).count('id as count')
    const currentCount = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)
    if (currentCount >= MAX_WEBHOOKS_PER_USER) {
      return sendError(reply, 429, 'RATE_LIMITED', `Maximum ${MAX_WEBHOOKS_PER_USER} active webhooks allowed per user`)
    }

    const { url, events, filters } = parsed.data
    // Generate a random 32-byte secret; returned once to the developer
    const secret = crypto.randomBytes(32).toString('hex')

    const [row] = await db('developer_webhooks')
      .insert({
        user_id:  req.user.id,
        url,
        secret,
        events,
        filters:  JSON.stringify(filters),
      })
      .returning(['id', 'url', 'events', 'filters', 'is_active', 'created_at', 'total_deliveries', 'failed_deliveries'])

    return reply.status(201).send({
      success: true,
      data: {
        ...row,
        secret, // returned ONCE — not stored in plaintext; developer must save it
      },
      docs: 'Verify incoming deliveries with: HMAC-SHA256(secret, `${timestamp}.${body}`). Header: X-WorldPulse-Signature: t={ts},v1={hex}',
    })
  })

  // ─── LIST WEBHOOKS ───────────────────────────────────────
  app.get('/webhooks', {
    preHandler: [authenticate],
    schema: { summary: 'List registered webhooks (secrets never returned)' },
  }, async (req, reply) => {
    const webhooks = await db('developer_webhooks')
      .where('user_id', req.user.id)
      .orderBy('created_at', 'desc')
      .select(['id', 'url', 'events', 'filters', 'is_active', 'created_at', 'last_triggered_at', 'total_deliveries', 'failed_deliveries'])

    return reply.send({ success: true, data: webhooks })
  })

  // ─── DELETE / DEACTIVATE WEBHOOK ─────────────────────────
  app.delete('/webhooks/:webhookId', {
    preHandler: [authenticate],
    schema: { summary: 'Delete (deactivate) a webhook' },
  }, async (req, reply) => {
    const { webhookId } = req.params as { webhookId: string }

    const updated = await db('developer_webhooks')
      .where({ id: webhookId, user_id: req.user.id })
      .update({ is_active: false })

    if (!updated) {
      return sendError(reply, 404, 'NOT_FOUND', 'Webhook not found')
    }

    return reply.send({ success: true })
  })

  // ─── WEBHOOK DELIVERY HISTORY ────────────────────────────
  app.get('/webhooks/:webhookId/deliveries', {
    preHandler: [authenticate],
    schema: { summary: 'Get delivery history for a webhook (last 50)' },
  }, async (req, reply) => {
    const { webhookId } = req.params as { webhookId: string }

    // Verify webhook belongs to this user
    const webhook = await db('developer_webhooks')
      .where({ id: webhookId, user_id: req.user.id })
      .first(['id'])

    if (!webhook) {
      return sendError(reply, 404, 'NOT_FOUND', 'Webhook not found')
    }

    const deliveries = await db('webhook_deliveries')
      .where('webhook_id', webhookId)
      .orderBy('delivered_at', 'desc')
      .limit(50)
      .select(['id', 'event', 'status_code', 'success', 'error_msg', 'duration_ms', 'delivered_at'])

    return reply.send({ success: true, data: deliveries })
  })
}
