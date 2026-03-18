import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { authenticate, optionalAuth } from '../middleware/auth'
import { redis } from '../db/redis'

export const registerUserRoutes: FastifyPluginAsync = async (app) => {

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
    const { displayName, bio, location, website } = req.body as {
      displayName?: string
      bio?: string
      location?: string
      website?: string
    }

    const updates: Record<string, unknown> = {}
    if (displayName !== undefined) updates.display_name = displayName.trim().slice(0, 100)
    if (bio !== undefined) updates.bio = bio.trim().slice(0, 500)
    if (location !== undefined) updates.location = location.trim().slice(0, 100)
    if (website !== undefined) updates.website = website.trim().slice(0, 255)

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ success: false, error: 'No fields to update' })
    }

    const [user] = await db('users')
      .where('id', userId)
      .update(updates)
      .returning(['id', 'handle', 'display_name', 'bio', 'avatar_url', 'location',
                  'website', 'account_type', 'trust_score', 'follower_count',
                  'following_count', 'signal_count', 'verified', 'created_at'])

    return reply.send({ success: true, data: user })
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
