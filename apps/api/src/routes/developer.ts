import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'
import { generateApiKey, TIER_LIMITS } from '../lib/api-keys'

const CreateKeySchema = z.object({
  name: z.string().min(1).max(100),
  tier: z.enum(['free', 'pro', 'enterprise']),
})

export const registerDeveloperRoutes: FastifyPluginAsync = async (app) => {

  // ─── CREATE KEY ──────────────────────────────────────────
  app.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = CreateKeySchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' })
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
      return reply.status(404).send({ success: false, error: 'API key not found', code: 'NOT_FOUND' })
    }

    return reply.send({ success: true })
  })
}
