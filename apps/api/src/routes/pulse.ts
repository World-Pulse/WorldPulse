/**
 * PULSE API routes — endpoints for the autonomous AI editorial system.
 *
 * Public routes:
 *   GET  /api/v1/pulse/feed     — PULSE-authored posts for AI Digest tab
 *   GET  /api/v1/pulse/stats    — publishing statistics
 *   GET  /api/v1/pulse/latest   — latest PULSE post by content type
 *
 * Internal routes (require PULSE_API_KEY):
 *   POST /api/v1/pulse/publish/flash     — publish a flash brief
 *   POST /api/v1/pulse/publish/analysis  — publish an analysis
 *   POST /api/v1/pulse/publish/briefing  — publish daily briefing
 *   POST /api/v1/pulse/publish/syndicate — syndicate a social post
 *   POST /api/v1/pulse/check-flash       — auto-check for new flash briefs
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/postgres'
import { optionalAuth } from '../middleware/auth'
import { sendError } from '../lib/errors'
import { PULSE_USER_ID, ContentType } from '../lib/pulse/constants'
import {
  publishFlashBrief,
  publishAnalysis,
  publishDailyBriefing,
  publishBriefingUpdate,
  syndicatePost,
  checkAndPublishFlashBriefs,
  getTopSignals,
  getPublishStats,
} from '../lib/pulse/publisher'
import { getAgentStatus, runAgentBeatScan } from '../lib/pulse/agents/coordinator'
import {
  registerSocialPost,
  batchRegisterSocialPosts,
  getSyndicatedPosts,
} from '../lib/pulse/syndication'

// ─── Internal auth — requires PULSE_API_KEY env var ───────────────────────

function requirePulseKey(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const key = process.env.PULSE_API_KEY
  if (!key) {
    reply.status(503).send({ success: false, error: 'PULSE system not configured' })
    return
  }
  const provided = req.headers['x-pulse-key'] ?? req.headers.authorization?.replace('Bearer ', '')
  if (provided !== key) {
    reply.status(401).send({ success: false, error: 'Invalid PULSE API key' })
    return
  }
  done()
}

// ─── Plugin ───────────────────────────────────────────────────────────────

export const registerPulseRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['pulse']
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/pulse/feed
   * Returns posts authored by PULSE for the AI Digest tab.
   * Supports pagination, optional content_type filter.
   */
  app.get('/feed', { preHandler: [optionalAuth] }, async (req, reply) => {
    const query = req.query as Record<string, string>
    const cursor = query.cursor
    const contentType = query.content_type
    const limit = Math.min(Number(query.limit) || 20, 50)

    let q = db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .where('p.author_id', PULSE_USER_ID)
      .where('p.deleted_at', null)
      .orderBy('p.created_at', 'desc')
      .limit(limit)
      .select([
        'p.id', 'p.post_type', 'p.content', 'p.media_urls', 'p.media_types',
        'p.source_url', 'p.source_name', 'p.tags', 'p.like_count',
        'p.boost_count', 'p.reply_count', 'p.view_count', 'p.reliability_score',
        'p.location_name', 'p.language', 'p.created_at', 'p.updated_at',
        'p.signal_id', 'p.pulse_content_type',
        // Author
        'u.id as author_id', 'u.handle as author_handle',
        'u.display_name as author_display_name', 'u.avatar_url as author_avatar',
        'u.account_type as author_type', 'u.trust_score as author_trust',
        'u.verified as author_verified',
      ])

    if (contentType) {
      q = q.where('p.pulse_content_type', contentType)
    }

    if (cursor) {
      q = q.where('p.created_at', '<', cursor)
    }

    // Enrichment: has the current user liked/bookmarked?
    const userId = (req as any).user?.id
    const posts = await q

    const items = await Promise.all(posts.map(async (post: any) => {
      let hasLiked = false
      let hasBookmarked = false

      if (userId) {
        const [likeRow, bookmarkRow] = await Promise.all([
          db('post_likes').where({ post_id: post.id, user_id: userId }).first(),
          db('post_bookmarks').where({ post_id: post.id, user_id: userId }).first(),
        ])
        hasLiked = !!likeRow
        hasBookmarked = !!bookmarkRow
      }

      return {
        id: post.id,
        type: 'ai_digest' as const,
        postType: post.post_type,
        content: post.content,
        mediaUrls: post.media_urls,
        mediaTypes: post.media_types,
        sourceUrl: post.source_url,
        sourceName: post.source_name,
        tags: post.tags,
        likeCount: post.like_count ?? 0,
        boostCount: post.boost_count ?? 0,
        replyCount: post.reply_count ?? 0,
        viewCount: post.view_count ?? 0,
        reliabilityScore: post.reliability_score,
        locationName: post.location_name,
        language: post.language,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        signalId: post.signal_id,
        pulseContentType: post.pulse_content_type,
        author: {
          id: post.author_id,
          handle: post.author_handle,
          displayName: post.author_display_name,
          avatar: post.author_avatar,
          type: post.author_type,
          trustScore: post.author_trust,
          verified: post.author_verified,
        },
        hasLiked,
        hasBookmarked,
      }
    }))

    const nextCursor = items.length === limit
      ? items[items.length - 1]?.createdAt
      : null

    return reply.send({
      success: true,
      items,
      cursor: nextCursor,
      hasMore: items.length === limit,
    })
  })

  /**
   * GET /api/v1/pulse/stats
   * Publishing statistics — public.
   */
  app.get('/stats', async (_req, reply) => {
    const stats = await getPublishStats()
    return reply.send({ success: true, data: stats })
  })

  /**
   * GET /api/v1/pulse/latest
   * Latest PULSE post, optionally filtered by content_type.
   */
  app.get('/latest', async (req, reply) => {
    const query = req.query as Record<string, string>
    const contentType = query.content_type

    let q = db('posts')
      .where('author_id', PULSE_USER_ID)
      .where('deleted_at', null)
      .orderBy('created_at', 'desc')
      .first()

    if (contentType) {
      q = q.where('pulse_content_type', contentType)
    }

    const post = await q
    if (!post) {
      return reply.send({ success: true, data: null })
    }

    return reply.send({ success: true, data: post })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL ROUTES — require PULSE_API_KEY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/pulse/publish/flash
   * Publish a flash brief for a specific signal.
   * Body: { signalId: string }
   */
  app.post('/publish/flash', { preHandler: [requirePulseKey] }, async (req, reply) => {
    const { signalId } = req.body as { signalId: string }
    if (!signalId) return sendError(reply, 400, 'VALIDATION_ERROR', 'signalId required')

    const signal = await db('signals').where('id', signalId).first()
    if (!signal) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

    const result = await publishFlashBrief(signal)
    return reply.status(result.success ? 201 : 500).send(result)
  })

  /**
   * POST /api/v1/pulse/publish/analysis
   * Publish an analysis connecting multiple signals.
   * Body: { signalIds: string[], topic: string }
   */
  app.post('/publish/analysis', { preHandler: [requirePulseKey] }, async (req, reply) => {
    const { signalIds, topic } = req.body as { signalIds: string[]; topic: string }
    if (!signalIds?.length || !topic) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'signalIds[] and topic required')
    }

    const signals = await db('signals').whereIn('id', signalIds)
    if (signals.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'No signals found')

    const result = await publishAnalysis(signals, topic)
    return reply.status(result.success ? 201 : 500).send(result)
  })

  /**
   * POST /api/v1/pulse/publish/briefing
   * Trigger a daily briefing publication.
   */
  app.post('/publish/briefing', { preHandler: [requirePulseKey] }, async (_req, reply) => {
    const result = await publishDailyBriefing()
    return reply.status(result.success ? 201 : 500).send(result)
  })

  /**
   * POST /api/v1/pulse/publish/syndicate
   * Syndicate a social media post back into the feed.
   * Body: { platform, externalUrl, title, content, externalId? }
   */
  app.post('/publish/syndicate', { preHandler: [requirePulseKey] }, async (req, reply) => {
    const { platform, externalUrl, title, content, externalId } = req.body as {
      platform: string
      externalUrl: string
      title: string
      content: string
      externalId?: string
    }

    if (!platform || !externalUrl || !title || !content) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'platform, externalUrl, title, content required')
    }

    const result = await syndicatePost(platform, externalUrl, title, content, externalId)
    return reply.status(result.success ? 201 : 500).send(result)
  })

  /**
   * POST /api/v1/pulse/check-flash
   * Auto-check for critical signals and publish flash briefs.
   * Returns count of new flash briefs published.
   */
  app.post('/check-flash', { preHandler: [requirePulseKey] }, async (_req, reply) => {
    const count = await checkAndPublishFlashBriefs()
    return reply.send({ success: true, published: count })
  })

  /**
   * GET /api/v1/pulse/signals/top
   * Get top signals for editorial planning (internal).
   */
  app.get('/signals/top', { preHandler: [requirePulseKey] }, async (req, reply) => {
    const query = req.query as Record<string, string>
    const hours = Number(query.hours) || 24
    const limit = Math.min(Number(query.limit) || 20, 50)

    const signals = await getTopSignals(hours, limit)
    return reply.send({ success: true, data: signals })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // SYNDICATION ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/pulse/syndicate
   * Register a social media post and auto-create a syndicated feed entry.
   * Body: { platform, externalUrl, title, content, externalId? }
   */
  app.post('/syndicate', { preHandler: [requirePulseKey] }, async (req, reply) => {
    const body = req.body as {
      platform: 'x' | 'reddit' | 'linkedin' | 'hackernews'
      externalUrl: string
      title: string
      content: string
      externalId?: string
    }

    if (!body.platform || !body.externalUrl || !body.title || !body.content) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'platform, externalUrl, title, content required')
    }

    const result = await registerSocialPost(body)
    return reply.status(result.skipped ? 200 : 201).send({ success: true, ...result })
  })

  /**
   * POST /api/v1/pulse/syndicate/batch
   * Batch-register multiple social posts at once.
   * Body: { posts: Array<{ platform, externalUrl, title, content, externalId? }> }
   */
  app.post('/syndicate/batch', { preHandler: [requirePulseKey] }, async (req, reply) => {
    const { posts } = req.body as { posts: any[] }
    if (!posts?.length) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'posts[] required')
    }

    const created = await batchRegisterSocialPosts(posts)
    return reply.send({ success: true, created, total: posts.length })
  })

  /**
   * GET /api/v1/pulse/syndicated
   * List syndicated posts, optionally filtered by platform.
   */
  app.get('/syndicated', async (req, reply) => {
    const query = req.query as Record<string, string>
    const platform = query.platform
    const limit = Math.min(Number(query.limit) || 20, 50)

    const posts = await getSyndicatedPosts(platform, limit)
    return reply.send({ success: true, data: posts })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // BRIEFING UPDATE ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/pulse/publish/update
   * Publish a mid-day or evening briefing update.
   * Body: { type: 'midday' | 'evening' }
   */
  app.post('/publish/update', { preHandler: [requirePulseKey] }, async (req, reply) => {
    const { type } = req.body as { type: 'midday' | 'evening' }
    if (type !== 'midday' && type !== 'evening') {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'type must be "midday" or "evening"')
    }

    const result = await publishBriefingUpdate(type)
    return reply.status(result.success ? 201 : 500).send(result)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AGENT ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/pulse/agents
   * Get status of all PULSE agents — public.
   */
  app.get('/agents', async (_req, reply) => {
    const status = await getAgentStatus()
    return reply.send({ success: true, data: status })
  })

  /**
   * POST /api/v1/pulse/agents/scan
   * Trigger an immediate agent beat scan — internal.
   */
  app.post('/agents/scan', { preHandler: [requirePulseKey] }, async (_req, reply) => {
    const results = await runAgentBeatScan()
    const published = results.filter(r => r.published).length
    return reply.send({
      success: true,
      data: {
        agentsRun: results.length,
        postsPublished: published,
        results,
      },
    })
  })
}
