import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { optionalAuth, authenticate } from '../middleware/auth'
import { sendDigestEmail, filterBySeverity } from '../lib/email-digest'
import type { Signal, SignalSeverity } from '@worldpulse/types'

// ─── Validation schemas ────────────────────────────────────────────────────

const SubscribeSchema = z.object({
  email:        z.string().email(),
  frequency:    z.enum(['daily', 'weekly']).default('weekly'),
  categories:   z.array(z.string()).max(20).default([]),
  min_severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
})

const UnsubscribeSchema = z.object({
  email: z.string().email(),
})

// ─── Plugin ────────────────────────────────────────────────────────────────

export const registerDigestRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['digest']
  })

  // ── POST /api/v1/digest/subscribe ─────────────────────────────────────────
  // No auth required for email-only subscriptions.
  // If the user is authenticated the subscription is linked to their account.
  app.post('/subscribe', { preHandler: [optionalAuth] }, async (req, reply) => {
    const parsed = SubscribeSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input', details: parsed.error.flatten() })
    }

    const { email, frequency, categories, min_severity } = parsed.data
    const userId = (req.user as { id?: string } | undefined)?.id ?? null

    // Upsert: if a (possibly inactive) row exists for this email, reactivate it.
    const existing = await db('digest_subscriptions')
      .where('email', email)
      .first()

    if (existing) {
      await db('digest_subscriptions')
        .where('email', email)
        .update({
          frequency,
          categories,
          min_severity,
          is_active:  true,
          updated_at: db.fn.now(),
          ...(userId && !existing.user_id ? { user_id: userId } : {}),
        })

      return reply.send({ success: true, message: 'Subscription updated' })
    }

    await db('digest_subscriptions').insert({
      user_id:      userId,
      email,
      frequency,
      categories,
      min_severity,
      is_active:    true,
    })

    return reply.status(201).send({ success: true, message: 'Subscribed to digest' })
  })

  // ── DELETE /api/v1/digest/unsubscribe ─────────────────────────────────────
  // Accepts body { email } or query ?email=X
  app.delete('/unsubscribe', async (req, reply) => {
    const rawEmail =
      (req.query as Record<string, string>).email ??
      (req.body as Record<string, unknown> | undefined)?.email

    const parsed = UnsubscribeSchema.safeParse({ email: rawEmail })
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Valid email required' })
    }

    const { email } = parsed.data

    const updated = await db('digest_subscriptions')
      .where('email', email)
      .where('is_active', true)
      .update({ is_active: false, updated_at: db.fn.now() })

    if (updated === 0) {
      return reply.status(404).send({ success: false, error: 'Subscription not found' })
    }

    return reply.send({ success: true, message: 'Unsubscribed from digest' })
  })

  // ── GET /api/v1/digest/status?email=X ────────────────────────────────────
  app.get('/status', async (req, reply) => {
    const email = (req.query as Record<string, string>).email

    if (!email || typeof email !== 'string') {
      return reply.status(400).send({ success: false, error: 'email query parameter required' })
    }

    const sub = await db('digest_subscriptions')
      .where('email', email)
      .first([
        'id', 'email', 'frequency', 'categories',
        'min_severity', 'is_active', 'last_sent_at', 'created_at',
      ])

    if (!sub) {
      return reply.send({ success: true, data: { subscribed: false } })
    }

    return reply.send({
      success: true,
      data: {
        subscribed:   sub.is_active,
        frequency:    sub.frequency,
        categories:   sub.categories,
        min_severity: sub.min_severity,
        last_sent_at: sub.last_sent_at,
        created_at:   sub.created_at,
      },
    })
  })
}

// ─── Admin digest plugin ───────────────────────────────────────────────────

export const registerAdminDigestRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['admin']
  })

  // ── POST /api/v1/admin/digest/send ────────────────────────────────────────
  // Triggers a manual digest send (for cron jobs / testing).
  // Admin-only.
  app.post('/digest/send', { preHandler: [authenticate] }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Admin access required', code: 'FORBIDDEN' })
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)
    const now          = new Date()

    // Fetch top 30 verified signals from the last 7 days
    const rawSignals = await db('signals')
      .where('verified', true)
      .where('published_at', '>', sevenDaysAgo)
      .orderBy('reliability_score', 'desc')
      .orderByRaw(`CASE severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC`)
      .limit(30)
      .select([
        'id', 'title', 'summary', 'body', 'category', 'severity', 'status',
        'reliability_score', 'source_count', 'location', 'location_name',
        'country_code', 'region', 'tags', 'sources', 'original_urls',
        'language', 'view_count', 'share_count', 'post_count',
        'event_time', 'first_reported', 'verified_at', 'last_updated',
        'created_at', 'is_breaking',
      ])

    // Map snake_case DB rows to camelCase Signal objects
    const signals: Signal[] = rawSignals.map((r: Record<string, unknown>) => ({
      id:               r.id as string,
      title:            r.title as string,
      summary:          r.summary as string | null,
      body:             r.body as string | null,
      category:         r.category as string,
      severity:         r.severity as SignalSeverity,
      status:           r.status as Signal['status'],
      reliabilityScore: Number(r.reliability_score),
      sourceCount:      Number(r.source_count ?? 0),
      location:         r.location as Signal['location'],
      locationName:     r.location_name as string | null,
      countryCode:      r.country_code as string | null,
      region:           r.region as string | null,
      tags:             (r.tags as string[]) ?? [],
      sources:          (r.sources as Signal['sources']) ?? [],
      originalUrls:     (r.original_urls as string[]) ?? [],
      language:         (r.language as string) ?? 'en',
      viewCount:        Number(r.view_count ?? 0),
      shareCount:       Number(r.share_count ?? 0),
      postCount:        Number(r.post_count ?? 0),
      eventTime:        r.event_time as string | null,
      firstReported:    r.first_reported as string,
      verifiedAt:       r.verified_at as string | null,
      lastUpdated:      r.last_updated as string,
      createdAt:        r.created_at as string,
      isBreaking:       Boolean(r.is_breaking),
    }))

    // Fetch all active subscriptions
    const subscriptions = await db('digest_subscriptions').where('is_active', true)

    const period = { from: sevenDaysAgo, to: now }
    let sent = 0
    let skipped = 0

    for (const sub of subscriptions) {
      // Filter signals by subscriber's category preferences
      let filtered = signals
      if (Array.isArray(sub.categories) && sub.categories.length > 0) {
        filtered = filtered.filter((s: Signal) => sub.categories.includes(s.category))
      }

      // Filter by minimum severity
      filtered = filterBySeverity(filtered, sub.min_severity as SignalSeverity)

      if (filtered.length === 0) {
        skipped++
        continue
      }

      await sendDigestEmail(sub.email, filtered, period)

      await db('digest_subscriptions')
        .where('id', sub.id)
        .update({ last_sent_at: now, updated_at: now })

      sent++
    }

    return reply.send({
      success: true,
      data: {
        total_subscriptions: subscriptions.length,
        sent,
        skipped,
        period: {
          from: sevenDaysAgo.toISOString(),
          to:   now.toISOString(),
        },
      },
    })
  })
}
