import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { authenticate, optionalAuth } from '../middleware/auth'
import { redis } from '../db/redis'
import { indexUser } from '../lib/search'
import { z } from 'zod'

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  bio:         z.string().max(500).optional(),
  location:    z.string().max(100).optional(),
  website:     z.union([z.string().url().max(255), z.literal('')]).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'No fields to update' })

export const registerUserRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['users']
  })

  // ─── GET PROFILE ─────────────────────────────────────────
  app.get('/:handle', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { handle } = req.params as { handle: string }
    const viewerId = req.user?.id

    const user = await db('users')
      .where('handle', handle.toLowerCase())
      .first([
        'id', 'handle', 'display_name', 'bio', 'avatar_url', 'location',
        'website', 'account_type', 'trust_score', 'follower_count',
        'following_count', 'signal_count', 'verified', 'created_at',
      ])

    if (!user) return reply.status(404).send({ success: false, error: 'User not found' })

    let isFollowing = false
    let isFollowedBy = false

    if (viewerId && viewerId !== user.id) {
      const [following, followedBy] = await Promise.all([
        db('follows').where({ follower_id: viewerId, following_id: user.id }).first('follower_id'),
        db('follows').where({ follower_id: user.id, following_id: viewerId }).first('follower_id'),
      ])
      isFollowing = !!following
      isFollowedBy = !!followedBy
    }

    return reply.send({
      success: true,
      data: {
        id:            user.id,
        handle:        user.handle,
        displayName:   user.display_name,
        bio:           user.bio,
        avatarUrl:     user.avatar_url,
        location:      user.location,
        website:       user.website,
        accountType:   user.account_type,
        trustScore:    user.trust_score,
        followerCount: user.follower_count,
        followingCount:user.following_count,
        signalCount:   user.signal_count,
        verified:      user.verified,
        createdAt:     user.created_at.toISOString(),
        isFollowing,
        isFollowedBy,
      },
    })
  })

  // ─── UPDATE PROFILE ──────────────────────────────────────
  app.put('/me', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user!.id

    const parsed = UpdateProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error:   parsed.error.issues[0]?.message ?? 'Invalid input',
        code:    'VALIDATION_ERROR',
      })
    }

    const { displayName, bio, location, website } = parsed.data
    const updates: Record<string, unknown> = {}
    if (displayName !== undefined) updates.display_name = displayName.trim()
    if (bio !== undefined) updates.bio = bio.trim()
    if (location !== undefined) updates.location = location.trim()
    if (website !== undefined) updates.website = website.trim()

    const [user] = await db('users')
      .where('id', userId)
      .update(updates)
      .returning(['id', 'handle', 'display_name', 'bio', 'avatar_url', 'location',
                  'website', 'account_type', 'trust_score', 'follower_count',
                  'following_count', 'signal_count', 'verified', 'created_at'])

    // Re-index updated user (non-blocking)
    indexUser(user).catch(() => {})

    return reply.send({
      success: true,
      data: {
        id:             user.id,
        handle:         user.handle,
        displayName:    user.display_name,
        bio:            user.bio,
        avatarUrl:      user.avatar_url,
        location:       user.location,
        website:        user.website,
        accountType:    user.account_type,
        trustScore:     user.trust_score,
        followerCount:  user.follower_count,
        followingCount: user.following_count,
        signalCount:    user.signal_count,
        verified:       user.verified,
        createdAt:      user.created_at instanceof Date
          ? user.created_at.toISOString()
          : user.created_at,
      },
    })
  })

  // ─── FOLLOW / UNFOLLOW ───────────────────────────────────
  app.post('/:handle/follow', { preHandler: [authenticate] }, async (req, reply) => {
    const { handle } = req.params as { handle: string }
    const followerId = req.user!.id

    const target = await db('users').where('handle', handle.toLowerCase()).first('id')
    if (!target) return reply.status(404).send({ success: false, error: 'User not found' })
    if (target.id === followerId) return reply.status(400).send({ success: false, error: 'Cannot follow yourself' })

    const existing = await db('follows').where({ follower_id: followerId, following_id: target.id }).first()

    if (existing) {
      await db('follows').where({ follower_id: followerId, following_id: target.id }).delete()
      return reply.send({ success: true, data: { following: false } })
    }

    await db('follows').insert({ follower_id: followerId, following_id: target.id })

    // Notify target
    await db('notifications').insert({
      user_id:  target.id,
      type:     'follow',
      actor_id: followerId,
      payload:  {},
    })

    return reply.send({ success: true, data: { following: true } })
  })

  // ─── USER POSTS ──────────────────────────────────────────
  app.get('/:handle/posts', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { handle } = req.params as { handle: string }
    const { cursor, limit = 20, type } = req.query as { cursor?: string; limit?: number; type?: string }

    const user = await db('users').where('handle', handle.toLowerCase()).first('id')
    if (!user) return reply.status(404).send({ success: false, error: 'User not found' })

    let query = db('posts as p')
      .where('p.author_id', user.id)
      .whereNull('p.deleted_at')
      .whereNull('p.parent_id')
      .select(['p.id', 'p.content', 'p.post_type', 'p.like_count', 'p.boost_count',
               'p.reply_count', 'p.tags', 'p.created_at', 'p.signal_id',
               'p.media_urls', 'p.reliability_score'])
      .orderBy('p.created_at', 'desc')
      .limit(Math.min(Number(limit), 50) + 1)

    if (type) query = query.where('p.post_type', type)
    if (cursor) {
      const cur = await db('posts').where('id', cursor).first('created_at')
      if (cur) query = query.where('p.created_at', '<', cur.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 50)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      success: true,
      data: { items, cursor: hasMore ? items[items.length - 1].id : null, hasMore },
    })
  })

  // ─── NOTIFICATIONS ───────────────────────────────────────
  app.get('/me/notifications', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const { cursor, limit = 30, unreadOnly } = req.query as {
      cursor?: string; limit?: number; unreadOnly?: string
    }

    let query = db('notifications as n')
      .leftJoin('users as a', 'n.actor_id', 'a.id')
      .where('n.user_id', userId)
      .select([
        'n.id', 'n.type', 'n.post_id', 'n.signal_id', 'n.payload', 'n.read', 'n.created_at',
        'a.id as actor_id', 'a.handle as actor_handle',
        'a.display_name as actor_name', 'a.avatar_url as actor_avatar',
      ])
      .orderBy('n.created_at', 'desc')
      .limit(Math.min(Number(limit), 50) + 1)

    if (unreadOnly === 'true') query = query.where('n.read', false)
    if (cursor) {
      const cur = await db('notifications').where('id', cursor).first('created_at')
      if (cur) query = query.where('n.created_at', '<', cur.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 50)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    // Mark as read
    const unreadIds = items.filter(n => !n.read).map(n => n.id)
    if (unreadIds.length > 0) {
      db('notifications').whereIn('id', unreadIds).update({ read: true }).catch(() => {})
    }

    const unreadCount = await db('notifications')
      .where({ user_id: userId, read: false })
      .count('id as count')
      .first()

    return reply.send({
      success: true,
      data: {
        items,
        cursor:      hasMore ? items[items.length - 1].id : null,
        hasMore,
        unreadCount: Number((unreadCount as { count: string })?.count ?? 0),
      },
    })
  })

  // ─── USER SIGNALS ────────────────────────────────────────
  app.get('/:handle/signals', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { handle } = req.params as { handle: string }
    const { cursor, limit = 20 } = req.query as { cursor?: string; limit?: number }

    const user = await db('users').where('handle', handle.toLowerCase()).first('id')
    if (!user) return reply.status(404).send({ success: false, error: 'User not found' })

    const pageLimit = Math.min(Number(limit), 50)

    // Distinct signal IDs this user contributed posts to
    const signalIdsSub = db('posts')
      .where('author_id', user.id)
      .whereNull('deleted_at')
      .whereNotNull('signal_id')
      .distinct('signal_id')

    let query = db('signals as s')
      .whereIn('s.id', signalIdsSub)
      .select([
        's.id', 's.title', 's.summary', 's.category', 's.severity', 's.status',
        's.reliability_score', 's.source_count', 's.location_name', 's.country_code',
        's.region', 's.tags', 's.view_count', 's.post_count', 's.event_time',
        's.first_reported', 's.verified_at', 's.last_updated', 's.created_at',
      ])
      .orderBy('s.created_at', 'desc')
      .limit(pageLimit + 1)

    if (cursor) {
      const cur = await db('signals').where('id', cursor).first('created_at')
      if (cur) query = query.where('s.created_at', '<', cur.created_at)
    }

    const rows = await query
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      success: true,
      data: { items, cursor: hasMore ? items[items.length - 1].id : null, hasMore },
    })
  })

  // ─── COMPLETE ONBOARDING ─────────────────────────────────
  app.patch('/me/onboarding', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const { interests, regions, followHandles } = req.body as {
      interests?:    string[]
      regions?:      string[]
      followHandles?: string[]
    }

    await db('users').where('id', userId).update({
      onboarded: true,
      interests: interests ?? [],
      regions:   regions ?? [],
    })

    // Bulk-follow selected handles (skip self + duplicates)
    if (followHandles && followHandles.length > 0) {
      const targets = await db('users')
        .whereIn('handle', followHandles)
        .whereNot('id', userId)
        .select('id')

      if (targets.length > 0) {
        const inserts = targets.map(t => ({ follower_id: userId, following_id: t.id }))
        await db('follows').insert(inserts).onConflict(['follower_id', 'following_id']).ignore()
      }
    }

    // Invalidate cached user in Redis so next JWT verification fetches fresh data
    await redis.del(`user:${userId}`)

    return reply.send({ success: true, data: { onboarded: true } })
  })

  // ─── SUGGESTED USERS ─────────────────────────────────────
  app.get('/suggestions/follow', { preHandler: [optionalAuth] }, async (req, reply) => {
    const viewerId = req.user?.id

    // Get official sources + high-trust accounts the user isn't following
    let query = db('users')
      .whereIn('account_type', ['official', 'journalist', 'expert', 'ai'])
      .where('verified', true)
      .orderBy('follower_count', 'desc')
      .limit(10)
      .select(['id', 'handle', 'display_name', 'bio', 'avatar_url',
               'account_type', 'trust_score', 'follower_count', 'verified'])

    if (viewerId) {
      const followingIds = await db('follows').where('follower_id', viewerId).pluck('following_id')
      if (followingIds.length > 0) {
        query = query.whereNotIn('id', followingIds)
      }
      query = query.whereNot('id', viewerId)
    }

    const users = await query
    return reply.send({ success: true, data: users })
  })
}
