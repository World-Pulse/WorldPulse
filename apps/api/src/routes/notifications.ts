import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'
import { z } from 'zod'
import { logger } from '../lib/logger'

const DeviceTokenSchema = z.object({
  token:    z.string().min(10).max(512),
  platform: z.enum(['expo', 'fcm', 'apns']).default('expo'),
})

export const registerNotificationRoutes: FastifyPluginAsync = async (app) => {

  // ─── REGISTER DEVICE TOKEN ────────────────────────────────
  app.post('/device-token', { preHandler: [authenticate] }, async (req, reply) => {
    const body = DeviceTokenSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid input',
        details: body.error.flatten().fieldErrors,
        code: 'VALIDATION_ERROR',
      })
    }

    const { token, platform } = body.data
    const userId = req.user!.id

    // Upsert device token
    await db('device_push_tokens')
      .insert({
        user_id:  userId,
        token,
        platform,
        active:   true,
      })
      .onConflict(['user_id', 'token'])
      .merge({ active: true, updated_at: new Date() })

    logger.debug({ userId, platform }, 'Device push token registered')

    return reply.status(201).send({
      success: true,
      message: 'Device token registered',
    })
  })

  // ─── DEREGISTER DEVICE TOKEN ──────────────────────────────
  app.delete('/device-token', { preHandler: [authenticate] }, async (req, reply) => {
    const { token } = req.body as { token: string }
    if (!token) {
      return reply.status(400).send({ success: false, error: 'Token is required' })
    }

    await db('device_push_tokens')
      .where('user_id', req.user!.id)
      .where('token', token)
      .update({ active: false, updated_at: new Date() })

    return reply.send({ success: true, message: 'Device token deregistered' })
  })

  // ─── LIST NOTIFICATIONS ───────────────────────────────────
  app.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const { limit = 30, cursor } = req.query as { limit?: number; cursor?: string }

    let query = db('notifications as n')
      .leftJoin('users as actor', 'n.actor_id', 'actor.id')
      .where('n.user_id', req.user!.id)
      .orderBy('n.created_at', 'desc')
      .limit(Math.min(Number(limit), 100) + 1)
      .select([
        'n.id', 'n.type', 'n.payload', 'n.read', 'n.created_at',
        'n.post_id', 'n.signal_id',
        'actor.handle as actor_handle',
        'actor.display_name as actor_display_name',
        'actor.avatar_url as actor_avatar',
      ])

    if (cursor) {
      const cur = await db('notifications').where('id', cursor).first('created_at')
      if (cur) query = query.where('n.created_at', '<', cur.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 100)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      success: true,
      data: {
        items,
        cursor: hasMore ? items[items.length - 1].id : null,
        hasMore,
      },
    })
  })

  // ─── MARK AS READ ─────────────────────────────────────────
  app.patch('/read', { preHandler: [authenticate] }, async (req, reply) => {
    const { ids } = req.body as { ids?: string[] }

    let query = db('notifications').where('user_id', req.user!.id)
    if (ids && ids.length > 0) {
      query = query.whereIn('id', ids)
    }

    await query.update({ read: true })

    return reply.send({ success: true, message: 'Notifications marked as read' })
  })

  // ─── UNREAD COUNT ─────────────────────────────────────────
  app.get('/unread-count', { preHandler: [authenticate] }, async (req, reply) => {
    const result = await db('notifications')
      .where('user_id', req.user!.id)
      .where('read', false)
      .count('id as count')
      .first()

    return reply.send({ success: true, data: { count: Number(result?.count ?? 0) } })
  })
}
