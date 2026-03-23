import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'
import { z } from 'zod'

const AlertSchema = z.object({
  name:        z.string().min(1).max(100),
  keywords:    z.array(z.string().max(50)).max(20).default([]),
  categories:  z.array(z.string()).max(10).default([]),
  countries:   z.array(z.string().length(2)).max(20).default([]),
  minSeverity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
  channels:    z.object({
    email:  z.boolean().default(true),
    push:   z.boolean().default(true),
    in_app: z.boolean().default(true),
  }).default({}),
})

export const registerAlertRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['alerts']
  })

  app.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const alerts = await db('alert_subscriptions')
      .where('user_id', req.user!.id)
      .orderBy('created_at', 'desc')
    return reply.send({ success: true, data: alerts })
  })

  app.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = AlertSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ success: false, error: 'Invalid input' })

    // Max 20 alerts per user
    const count = await db('alert_subscriptions').where('user_id', req.user!.id).count('id as c').first()
    if (Number((count as { c: string })?.c ?? 0) >= 20) {
      return reply.status(429).send({ success: false, error: 'Maximum 20 alerts allowed' })
    }

    const [alert] = await db('alert_subscriptions')
      .insert({
        user_id:      req.user!.id,
        name:         body.data.name,
        keywords:     body.data.keywords,
        categories:   body.data.categories,
        countries:    body.data.countries,
        min_severity: body.data.minSeverity,
        channels:     JSON.stringify(body.data.channels),
      })
      .returning('*')

    return reply.status(201).send({ success: true, data: alert })
  })

  app.put('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = AlertSchema.partial().safeParse(req.body)
    if (!body.success) return reply.status(400).send({ success: false, error: 'Invalid input' })

    const alert = await db('alert_subscriptions')
      .where({ id, user_id: req.user!.id })
      .first('id')

    if (!alert) return reply.status(404).send({ success: false, error: 'Alert not found' })

    const updates: Record<string, unknown> = {}
    if (body.data.name !== undefined) updates.name = body.data.name
    if (body.data.keywords !== undefined) updates.keywords = body.data.keywords
    if (body.data.categories !== undefined) updates.categories = body.data.categories
    if (body.data.countries !== undefined) updates.countries = body.data.countries
    if (body.data.minSeverity !== undefined) updates.min_severity = body.data.minSeverity
    if (body.data.channels !== undefined) updates.channels = JSON.stringify(body.data.channels)

    const [updated] = await db('alert_subscriptions').where('id', id).update(updates).returning('*')
    return reply.send({ success: true, data: updated })
  })

  app.delete('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db('alert_subscriptions').where({ id, user_id: req.user!.id }).delete()
    return reply.send({ success: true })
  })
}

// ─── ALERT MATCHING ENGINE ────────────────────────────────────────────────
// Called when a new signal is created
export async function matchAndDispatchAlerts(signal: {
  id: string
  title: string
  category: string
  severity: string
  country_code: string | null
  tags: string[]
}) {
  const SEVERITY_RANK: Record<string, number> = {
    critical: 5, high: 4, medium: 3, low: 2, info: 1,
  }

  const signalRank = SEVERITY_RANK[signal.severity] ?? 1

  // Get all active alerts that could match
  const alerts = await db('alert_subscriptions')
    .where('active', true)
    .where(function() {
      this.whereRaw('? >= CASE min_severity WHEN \'critical\' THEN 5 WHEN \'high\' THEN 4 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 2 ELSE 1 END', [signalRank])
    })

  const matched: string[] = []

  for (const alert of alerts) {
    let match = false

    // Category match
    if (alert.categories?.length > 0 && alert.categories.includes(signal.category)) match = true
    // Keyword match
    if (!match && alert.keywords?.length > 0) {
      const titleLower = signal.title.toLowerCase()
      match = alert.keywords.some((kw: string) => titleLower.includes(kw.toLowerCase()))
    }
    // Country match
    if (!match && alert.countries?.length > 0 && signal.country_code) {
      match = alert.countries.includes(signal.country_code)
    }
    // Tag match
    if (!match && signal.tags?.length > 0 && alert.keywords?.length > 0) {
      match = signal.tags.some((t: string) => alert.keywords.includes(t))
    }

    if (match) {
      matched.push(alert.user_id)
      
      // Create in-app notification
      await db('notifications').insert({
        user_id:   alert.user_id,
        type:      'alert',
        signal_id: signal.id,
        payload:   {
          alertName: alert.name,
          preview:   signal.title.slice(0, 100),
          severity:  signal.severity,
        },
      }).catch(() => {})
    }
  }

  return matched
}
