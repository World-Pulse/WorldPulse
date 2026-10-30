import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { optionalAuth, authenticate } from '../middleware/auth'
import { sendDigestEmail, filterBySeverity } from '../lib/email-digest'
import { sendError } from '../lib/errors'
import { EMAIL_CONFIGURED } from '../lib/email'
import {
  normalizeEmail, verifyEmailToken, subscribersReady, linksConfigured, SITE_URL,
  splitFollows, joinFollows, MAX_COUNTRIES,
} from '../lib/subscribers'
import { sendConfirmEmail } from '../lib/briefing-email'
import type { Signal, SignalSeverity } from '@worldpulse/types'

/**
 * The email briefing's subscriptions (plan G4, Oct 11, 2026).
 *
 * Anyone can sign up with an address; nothing is sent to it until its owner
 * taps the link in the confirmation email. Confirm and unsubscribe links are
 * signed (lib/subscribers.ts), so no one can sign up or remove an address
 * that isn't theirs. Before this, GET /status?email= showed anyone's
 * settings and DELETE /unsubscribe removed anyone's subscription by address.
 */

// ─── Validation schemas ────────────────────────────────────────────────────

const SubscribeSchema = z.object({
  email:        z.string().trim().max(254).email(),
  frequency:    z.enum(['daily', 'weekly']).default('daily'),
  categories:   z.array(z.string().max(40)).max(20).default([]),
  /** Countries the reader follows (two-letter codes): their stories lead the briefing (plan G13) */
  countries:    z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(MAX_COUNTRIES).default([]),
  min_severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('info'),
  /** The page the reader signed up on */
  source:       z.string().max(200).optional(),
})

const LinkQuerySchema = z.object({
  e: z.string().max(254),
  t: z.string().max(64),
})

/** What a subscribe request always answers (it never says whether an address was already on the list) */
const CHECK_INBOX = 'Check your inbox and tap the link to confirm (it can take a minute, and may land in Promotions). Already subscribed? You’re all set.'

/** The signed-in reader's account address, if any */
async function accountEmail(req: FastifyRequest): Promise<{ userId: string; email: string | null } | null> {
  const id = (req.user as { id?: string } | undefined)?.id
  if (!id) return null
  const row = await db('users').where('id', id).first(['email']).catch(() => null) as { email?: string | null } | null | undefined
  return { userId: id, email: row?.email ? normalizeEmail(row.email) : null }
}

/** The signed-in reader's subscription (linked to the account, or at its address) */
async function ownSubscription(req: FastifyRequest) {
  const me = await accountEmail(req)
  if (!me) return null
  return db('digest_subscriptions')
    .where(q => { q.where('user_id', me.userId); if (me.email) q.orWhere('email', me.email) })
    .orderBy('is_active', 'desc')
    .first()
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const registerDigestRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['digest']
  })

  // One-click unsubscribe (RFC 8058) posts a form body: accept it here
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body))
  }

  // ── GET /api/v1/digest/config ─────────────────────────────────────────────
  // Whether the sign-up box should show: email can be sent and stored.
  app.get('/config', async (_req, reply) => {
    return reply.header('Cache-Control', 'public, max-age=300').send({
      success: true,
      data: { enabled: EMAIL_CONFIGURED && subscribersReady() && linksConfigured(), sendsAt: '7:00 AM New York time' },
    })
  })

  // ── POST /api/v1/digest/subscribe ─────────────────────────────────────────
  // No account needed. A new address (or one that left) gets a confirmation
  // email; the briefing starts once its owner confirms.
  app.post('/subscribe', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = SubscribeSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Please enter a valid email address')
    }
    if (!EMAIL_CONFIGURED || !subscribersReady() || !linksConfigured()) {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The email briefing isn’t open yet')
    }

    const { frequency, min_severity, source } = parsed.data
    // Followed countries live beside the topics (plan G13)
    const categories = joinFollows(parsed.data.categories, parsed.data.countries.map(c => c.toUpperCase()))
    const email = normalizeEmail(parsed.data.email)
    const userId = (req.user as { id?: string } | undefined)?.id ?? null

    const existing = await db('digest_subscriptions').where('email', email).orderBy('is_active', 'desc').first()
    if (existing && existing.is_active && existing.confirmed_at) {
      // Already receiving it: the same answer as a new address, so a stranger
      // can't learn who is on the list
      return reply.status(201).send({ success: true, message: CHECK_INBOX })
    }
    if (existing) {
      await db('digest_subscriptions').where('id', existing.id).update({
        frequency, categories, min_severity,
        is_active: true, confirmed_at: null, updated_at: db.fn.now(),
        ...(source ? { source } : {}),
        ...(userId && !existing.user_id ? { user_id: userId } : {}),
      })
    } else {
      await db('digest_subscriptions').insert({
        user_id: userId, email, frequency, categories, min_severity,
        is_active: true, confirmed_at: null, source: source ?? null,
      })
    }

    const sent = await sendConfirmEmail(email)
    if (!sent) {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'We couldn’t send the confirmation email just now. Please try again later.')
    }
    return reply.status(201).send({ success: true, message: CHECK_INBOX })
  })

  // ── GET /api/v1/digest/confirm?e=&t= ──────────────────────────────────────
  // The link in the confirmation email. Back to the site either way.
  app.get('/confirm', async (req, reply) => {
    const q = LinkQuerySchema.safeParse(req.query)
    const email = q.success ? normalizeEmail(q.data.e) : ''
    if (!q.success || !verifyEmailToken(email, 'confirm', q.data.t) || !subscribersReady()) {
      return reply.redirect(`${SITE_URL}/briefing?subscribed=invalid`, 302)
    }
    const updated = await db('digest_subscriptions')
      .where('email', email)
      .where('is_active', true)
      .update({ confirmed_at: db.fn.now(), updated_at: db.fn.now() })
    // Weekly readers are told their first email comes on Monday (plan G11 slice 2)
    const row = updated > 0
      ? await db('digest_subscriptions').where('email', email).where('is_active', true).first('frequency').catch(() => null) as { frequency?: string } | null | undefined
      : null
    return reply.redirect(`${SITE_URL}/briefing?subscribed=${updated > 0 ? (row?.frequency === 'weekly' ? 'weekly' : '1') : 'invalid'}`, 302)
  })

  // ── GET|POST /api/v1/digest/unsubscribe?e=&t= ─────────────────────────────
  // The link in every briefing (GET, back to the site) and the mail app's
  // one-click unsubscribe (POST, RFC 8058).
  const unsubscribeByLink = async (req: FastifyRequest): Promise<boolean> => {
    const q = LinkQuerySchema.safeParse(req.query)
    if (!q.success) return false
    const email = normalizeEmail(q.data.e)
    if (!verifyEmailToken(email, 'unsubscribe', q.data.t) || !subscribersReady()) return false
    await db('digest_subscriptions')
      .where('email', email)
      .where('is_active', true)
      .update({ is_active: false, updated_at: db.fn.now() })
    return true
  }
  app.get('/unsubscribe', async (req, reply) => {
    const ok = await unsubscribeByLink(req)
    return reply.redirect(`${SITE_URL}/briefing?unsubscribed=${ok ? '1' : 'invalid'}`, 302)
  })
  app.post('/unsubscribe', async (req, reply) => {
    const ok = await unsubscribeByLink(req)
    if (!ok) return sendError(reply, 400, 'VALIDATION_ERROR', 'This unsubscribe link isn’t valid')
    return reply.send({ success: true, message: 'Unsubscribed' })
  })

  // ── DELETE /api/v1/digest/unsubscribe ─────────────────────────────────────
  // From Settings: the signed-in reader's own subscription only.
  app.delete('/unsubscribe', { preHandler: [authenticate] }, async (req, reply) => {
    const sub = await ownSubscription(req)
    if (!sub || !sub.is_active) {
      return sendError(reply, 404, 'NOT_FOUND', 'Subscription not found')
    }
    await db('digest_subscriptions').where('id', sub.id).update({ is_active: false, updated_at: db.fn.now() })
    return reply.send({ success: true, message: 'Unsubscribed from the briefing' })
  })

  // ── GET /api/v1/digest/status ─────────────────────────────────────────────
  // The signed-in reader's own subscription (no lookups of other addresses).
  app.get('/status', { preHandler: [authenticate] }, async (req, reply) => {
    const sub = await ownSubscription(req)
    if (!sub) {
      return reply.send({ success: true, data: { subscribed: false } })
    }
    return reply.send({
      success: true,
      data: {
        subscribed:   Boolean(sub.is_active && sub.confirmed_at),
        pending:      Boolean(sub.is_active && !sub.confirmed_at),
        email:        sub.email,
        frequency:    sub.frequency,
        categories:   splitFollows(sub.categories).topics,
        countries:    splitFollows(sub.categories).countries,
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
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)
    const now          = new Date()

    // Fetch top 30 verified signals from the last 7 days. (signals has a
    // status column, not "verified", and no "sources" column: the old query
    // failed on every send.)
    const rawSignals = await db('signals')
      .where('status', 'verified')
      .where('created_at', '>', sevenDaysAgo)
      .orderBy('reliability_score', 'desc')
      .orderByRaw(`CASE severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC`)
      .limit(30)
      .select([
        'id', 'title', 'summary', 'body', 'category', 'severity', 'status',
        'reliability_score', 'source_count', 'location_name',
        'country_code', 'region', 'tags', 'original_urls',
        'language', 'view_count', 'share_count', 'post_count',
        'event_time', 'first_reported', 'verified_at', 'last_updated',
        'last_corroborated_at', 'created_at', 'is_breaking',
      ])

    const iso = (v: unknown): string | null =>
      v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null

    // Map snake_case DB rows to camelCase Signal objects (the email uses the
    // headline, category, severity, place and reliability)
    const signals: Signal[] = rawSignals.map((r: Record<string, unknown>) => ({
      id:               r.id as string,
      title:            r.title as string,
      summary:          r.summary as string | null,
      body:             r.body as string | null,
      category:         r.category as Signal['category'],
      severity:         r.severity as SignalSeverity,
      status:           r.status as Signal['status'],
      reliabilityScore: Number(r.reliability_score),
      alertTier:        'ROUTINE' as const,
      sourceCount:      Number(r.source_count ?? 0),
      location:         null,
      locationName:     r.location_name as string | null,
      countryCode:      r.country_code as string | null,
      region:           r.region as string | null,
      tags:             (r.tags as string[]) ?? [],
      sources:          [],
      originalUrls:     (r.original_urls as string[]) ?? [],
      language:         (r.language as string) ?? 'en',
      viewCount:        Number(r.view_count ?? 0),
      shareCount:       Number(r.share_count ?? 0),
      postCount:        Number(r.post_count ?? 0),
      eventTime:        iso(r.event_time),
      firstReported:    iso(r.first_reported) ?? '',
      verifiedAt:       iso(r.verified_at),
      lastUpdated:      iso(r.last_updated) ?? '',
      lastCorroboratedAt: iso(r.last_corroborated_at),
      createdAt:        iso(r.created_at) ?? '',
      isBreaking:       Boolean(r.is_breaking),
    }))

    // Fetch all active subscriptions
    // Confirmed subscribers only (an address gets nothing until its owner confirms)
    const subscriptions = await db('digest_subscriptions').where('is_active', true).whereNotNull('confirmed_at')

    const period = { from: sevenDaysAgo, to: now }
    let sent = 0
    let skipped = 0

    for (const sub of subscriptions) {
      // Filter signals by subscriber's category preferences
      let filtered = signals
      const topics = splitFollows(sub.categories).topics   // (followed countries aren't topics: plan G13)
      if (topics.length > 0) {
        filtered = filtered.filter((s: Signal) => topics.includes(s.category))
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
