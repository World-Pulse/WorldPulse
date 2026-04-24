/**
 * Phase 1.3 — Personalization Routes
 *
 * Endpoints:
 *   POST   /interactions          — Record a user interaction (click, expand, bookmark)
 *   GET    /interests             — Get computed implicit interest weights
 *   GET    /for-you               — "For You" personalized feed
 *   GET    /alert-rules           — List user's alert rules
 *   POST   /alert-rules           — Create an alert rule
 *   PUT    /alert-rules/:id       — Update an alert rule
 *   DELETE /alert-rules/:id       — Delete an alert rule
 *   GET    /saved-searches        — List user's saved searches
 *   POST   /saved-searches        — Save a search
 *   DELETE /saved-searches/:id    — Delete a saved search
 *   POST   /saved-searches/:id/use — Increment use count
 *   GET    /notifications         — Get user notifications
 *   PUT    /notifications/:id/read — Mark notification as read
 *   PUT    /notifications/read-all — Mark all as read
 */

import type { FastifyPluginAsync } from 'fastify'
import { authenticate } from '../middleware/auth'
import { db } from '../db/postgres'
import { recordInteraction, computeImplicitWeights } from '../lib/implicit-interests'

export const registerPersonalizationRoutes: FastifyPluginAsync = async (app) => {

  // ══════════════════════════════════════════════════════════════════════
  // IMPLICIT LEARNING
  // ══════════════════════════════════════════════════════════════════════

  /** Record a user interaction for implicit learning */
  app.post('/interactions', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const body = req.body as any

    await recordInteraction({
      userId,
      signalId: body.signal_id,
      postId: body.post_id,
      interactionType: body.type || 'click',
      category: body.category,
      countryCode: body.country_code,
      severity: body.severity,
      metadata: body.metadata,
    })

    return reply.code(204).send()
  })

  /** Get computed implicit interest weights */
  app.get('/interests', { preHandler: [authenticate] }, async (req) => {
    const userId = (req as any).user.id
    const weights = await computeImplicitWeights(userId)
    return weights
  })

  // ══════════════════════════════════════════════════════════════════════
  // "FOR YOU" PERSONALIZED FEED
  // ══════════════════════════════════════════════════════════════════════

  /** Personalized feed using implicit + explicit interests */
  app.get('/for-you', { preHandler: [authenticate] }, async (req) => {
    const userId = (req as any).user.id
    const query = req.query as Record<string, string>
    const limit = Math.min(Number(query.limit) || 20, 50)
    const cursor = query.cursor

    // Get both explicit and implicit interests
    const user = await db('users').where('id', userId).first('interests', 'regions')
    const implicit = await computeImplicitWeights(userId)

    // Merge explicit + implicit interests
    const categoryWeights: Record<string, number> = { ...implicit.categories }
    const regionWeights: Record<string, number> = { ...implicit.regions }

    // Explicit interests get a baseline weight
    if (user?.interests && Array.isArray(user.interests)) {
      for (const interest of user.interests) {
        categoryWeights[interest] = Math.max(categoryWeights[interest] || 0, 0.5)
      }
    }
    if (user?.regions && Array.isArray(user.regions)) {
      for (const region of user.regions) {
        regionWeights[region] = Math.max(regionWeights[region] || 0, 0.5)
      }
    }

    // Fetch recent signals (wider window for personalization)
    let q = db('signals')
      .select('*')
      .where('published_at', '>=', db.raw("NOW() - INTERVAL '48 hours'"))
      .whereIn('severity', ['critical', 'high', 'medium'])
      .where('reliability_score', '>=', 0.50)
      .whereNotIn('category', ['culture', 'sports', 'other'])
      .orderBy('published_at', 'desc')
      .limit(limit * 3)

    if (cursor) {
      q = q.where('published_at', '<', cursor)
    }

    const signals = await q

    // Score each signal by personal relevance
    const SEVERITY_WEIGHT: Record<string, number> = {
      critical: 1.0, high: 0.7, medium: 0.4, low: 0.15, info: 0.05,
    }
    const HALF_LIFE_MS = 6 * 60 * 60 * 1000 // 6h half-life for For You
    const now = Date.now()

    const scored = signals.map((s: any) => {
      const sevWeight = SEVERITY_WEIGHT[s.severity] ?? 0.15
      const ageMs = now - new Date(s.published_at).getTime()
      const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS)

      // Personalization boost from category + region match
      let personalBoost = 0
      const catWeight = categoryWeights[s.category] ?? 0
      personalBoost += catWeight * 0.4

      const ccWeight = regionWeights[s.country_code] ?? 0
      personalBoost += ccWeight * 0.3

      // Multi-source bonus
      const sourceBonus = (s.source_count >= 3) ? 0.15 : (s.source_count >= 2) ? 0.08 : 0

      const score = (sevWeight + personalBoost + sourceBonus) * decay

      return { ...s, _personalScore: score }
    })

    // Sort by personal relevance
    scored.sort((a: any, b: any) => b._personalScore - a._personalScore)

    // Category diversity filter
    const categoryCounts: Record<string, number> = {}
    const results: typeof scored = []

    for (const signal of scored) {
      if (results.length >= limit) break
      const cat = signal.category
      if ((categoryCounts[cat] ?? 0) >= 4) continue
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1
      results.push(signal)
    }

    return {
      items: results.map((s: any) => ({
        id: s.id,
        title: s.title,
        summary: s.summary,
        category: s.category,
        severity: s.severity,
        reliability_score: s.reliability_score,
        source_count: s.source_count,
        country_code: s.country_code,
        location_name: s.location_name,
        published_at: s.published_at,
        tags: s.tags,
        _personalScore: s._personalScore,
      })),
      cursor: results.length > 0 ? results[results.length - 1].published_at : null,
      profile: {
        totalInteractions: implicit.totalInteractions,
        isActive: implicit.isActive,
        topCategories: Object.entries(categoryWeights)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([cat, weight]) => ({ category: cat, weight })),
      },
    }
  })

  // ══════════════════════════════════════════════════════════════════════
  // ALERT RULES
  // ══════════════════════════════════════════════════════════════════════

  /** List user's alert rules */
  app.get('/alert-rules', { preHandler: [authenticate] }, async (req) => {
    const userId = (req as any).user.id
    const rules = await db('alert_rules')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')

    return { items: rules }
  })

  /** Create an alert rule */
  app.post('/alert-rules', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const body = req.body as any

    // Limit to 10 rules per user
    const [{ count }] = await db('alert_rules').where('user_id', userId).count('id as count')
    if (Number(count) >= 10) {
      return reply.code(400).send({ error: 'Maximum 10 alert rules per account' })
    }

    const [rule] = await db('alert_rules').insert({
      user_id: userId,
      name: body.name || 'Untitled Alert',
      min_severity: body.min_severity || 'critical',
      categories: body.categories || [],
      regions: body.regions || [],
      country_codes: body.country_codes || [],
      keywords: body.keywords || [],
      notify_email: body.notify_email ?? true,
      notify_in_app: body.notify_in_app ?? true,
      notify_push: body.notify_push ?? false,
      cooldown_minutes: body.cooldown_minutes ?? 60,
    }).returning('*')

    return reply.code(201).send(rule)
  })

  /** Update an alert rule */
  app.put('/alert-rules/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const { id } = req.params as any
    const body = req.body as any

    const updates: Record<string, unknown> = { updated_at: db.raw('NOW()') }
    if (body.name !== undefined) updates.name = body.name
    if (body.enabled !== undefined) updates.enabled = body.enabled
    if (body.min_severity !== undefined) updates.min_severity = body.min_severity
    if (body.categories !== undefined) updates.categories = body.categories
    if (body.regions !== undefined) updates.regions = body.regions
    if (body.country_codes !== undefined) updates.country_codes = body.country_codes
    if (body.keywords !== undefined) updates.keywords = body.keywords
    if (body.notify_email !== undefined) updates.notify_email = body.notify_email
    if (body.notify_in_app !== undefined) updates.notify_in_app = body.notify_in_app
    if (body.notify_push !== undefined) updates.notify_push = body.notify_push
    if (body.cooldown_minutes !== undefined) updates.cooldown_minutes = body.cooldown_minutes

    const [rule] = await db('alert_rules')
      .where({ id, user_id: userId })
      .update(updates)
      .returning('*')

    if (!rule) return reply.code(404).send({ error: 'Rule not found' })
    return rule
  })

  /** Delete an alert rule */
  app.delete('/alert-rules/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const { id } = req.params as any

    const deleted = await db('alert_rules').where({ id, user_id: userId }).del()
    if (!deleted) return reply.code(404).send({ error: 'Rule not found' })
    return reply.code(204).send()
  })

  // ══════════════════════════════════════════════════════════════════════
  // SAVED SEARCHES
  // ══════════════════════════════════════════════════════════════════════

  /** List saved searches */
  app.get('/saved-searches', { preHandler: [authenticate] }, async (req) => {
    const userId = (req as any).user.id
    const searches = await db('saved_searches')
      .where('user_id', userId)
      .orderBy('use_count', 'desc')

    return { items: searches }
  })

  /** Save a search */
  app.post('/saved-searches', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const body = req.body as any

    // Limit to 20 saved searches per user
    const [{ count }] = await db('saved_searches').where('user_id', userId).count('id as count')
    if (Number(count) >= 20) {
      return reply.code(400).send({ error: 'Maximum 20 saved searches per account' })
    }

    const [search] = await db('saved_searches').insert({
      user_id: userId,
      name: body.name || 'Untitled Search',
      query: body.query || null,
      search_type: body.search_type || 'all',
      categories: body.categories || [],
      severities: body.severities || [],
      countries: body.countries || [],
      date_from: body.date_from || null,
      date_to: body.date_to || null,
      min_reliability: body.min_reliability || null,
      sort_by: body.sort_by || 'newest',
    }).returning('*')

    return reply.code(201).send(search)
  })

  /** Delete a saved search */
  app.delete('/saved-searches/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const { id } = req.params as any

    const deleted = await db('saved_searches').where({ id, user_id: userId }).del()
    if (!deleted) return reply.code(404).send({ error: 'Search not found' })
    return reply.code(204).send()
  })

  /** Record a saved search use (increment counter) */
  app.post('/saved-searches/:id/use', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const { id } = req.params as any

    await db('saved_searches')
      .where({ id, user_id: userId })
      .update({
        use_count: db.raw('use_count + 1'),
        last_used_at: db.raw('NOW()'),
      })

    return reply.code(204).send()
  })

  // ══════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ══════════════════════════════════════════════════════════════════════

  /** Get user notifications */
  app.get('/notifications', { preHandler: [authenticate] }, async (req) => {
    const userId = (req as any).user.id
    const query = req.query as Record<string, string>
    const limit = Math.min(Number(query.limit) || 20, 50)
    const unreadOnly = query.unread === 'true'

    let q = db('notifications')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)

    if (unreadOnly) {
      q = q.where('read', false)
    }

    const items = await q

    const [{ count: unreadCount }] = await db('notifications')
      .where({ user_id: userId, read: false })
      .count('id as count')

    return { items, unread_count: Number(unreadCount) }
  })

  /** Mark notification as read */
  app.put('/notifications/:id/read', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const { id } = req.params as any

    await db('notifications').where({ id, user_id: userId }).update({ read: true })
    return reply.code(204).send()
  })

  /** Mark all notifications as read */
  app.put('/notifications/read-all', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    await db('notifications').where({ user_id: userId, read: false }).update({ read: true })
    return reply.code(204).send()
  })
}
