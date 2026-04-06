import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { authenticate, optionalAuth } from '../middleware/auth'
import { z } from 'zod'
import { sendError } from '../lib/errors'
import { parseQuery, CommunityListQuerySchema, CommunityMembersQuerySchema } from '../lib/query-schemas'

const CreateCommunitySchema = z.object({
  slug:        z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  name:        z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
  categories:  z.array(z.string()).max(5).default([]),
  isPublic:    z.boolean().default(true),
})

const UpdateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
})

// ─── ROLE HELPERS ────────────────────────────────────────────────────────
type MemberRole = 'admin' | 'moderator' | 'member'

async function getMemberRole(communityId: string, userId: string): Promise<MemberRole | null> {
  const row = await db('community_members')
    .where({ community_id: communityId, user_id: userId })
    .first('role')
  return row?.role ?? null
}

function canModerate(role: MemberRole | null): boolean {
  return role === 'admin' || role === 'moderator'
}

// ─── ROUTES ──────────────────────────────────────────────────────────────
export const registerCommunityRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['communities']
  })

  // ─── LIST COMMUNITIES (with discovery features) ───────────
  app.get('/', { preHandler: [optionalAuth] }, async (req, reply) => {
    const qr = parseQuery(CommunityListQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { search, category, sort, limit } = qr.data

    const pageLimit = limit

    // Build query — exclude demo/seeded communities from public listing
    let query = db('communities as c')
      .where('c.public', true)
      .where(function() {
        this.whereNull('c.is_demo').orWhere('c.is_demo', false)
      })
      .select([
        'c.id', 'c.slug', 'c.name', 'c.description', 'c.avatar_url',
        'c.banner_url', 'c.categories', 'c.member_count', 'c.post_count',
        'c.created_at', 'c.created_by',
      ])

    if (search) {
      query = query.whereILike('c.name', `%${search}%`)
    }

    if (category) {
      query = query.whereRaw('? = ANY(c.categories)', [category])
    }

    // Sort
    if (sort === 'members') {
      query = query.orderBy('c.member_count', 'desc')
    } else if (sort === 'posts') {
      query = query.orderBy('c.post_count', 'desc')
    } else if (sort === 'newest') {
      query = query.orderBy('c.created_at', 'desc')
    } else if (sort === 'trending') {
      // Most posts in last 24h — join with posts table
      query = db('communities as c')
        .leftJoin(
          db('posts')
            .where('created_at', '>=', db.raw("NOW() - INTERVAL '24 hours'"))
            .whereNull('deleted_at')
            .whereNotNull('pinned_in_community_id')
            .groupBy('pinned_in_community_id')
            .select([
              'pinned_in_community_id as cid',
              db.raw('COUNT(*) as recent_posts'),
            ])
            .as('rp'),
          'c.id', 'rp.cid'
        )
        .where('c.public', true)
        .where(function() {
          this.whereNull('c.is_demo').orWhere('c.is_demo', false)
        })
        .select([
          'c.id', 'c.slug', 'c.name', 'c.description', 'c.avatar_url',
          'c.banner_url', 'c.categories', 'c.member_count', 'c.post_count',
          'c.created_at', 'c.created_by',
          db.raw('COALESCE(rp.recent_posts, 0) as recent_posts'),
        ])
        .orderByRaw('COALESCE(rp.recent_posts, 0) DESC, c.member_count DESC')
    }

    const communities = await query.limit(pageLimit)

    // Also compute "trending" for the listing (last 24h post count per community)
    const communityIds = communities.map(c => c.id)
    let recentPostCounts: Record<string, number> = {}
    if (communityIds.length > 0) {
      const rows = await db('posts')
        .whereIn('pinned_in_community_id', communityIds)
        .where('created_at', '>=', db.raw("NOW() - INTERVAL '24 hours'"))
        .whereNull('deleted_at')
        .groupBy('pinned_in_community_id')
        .select([
          'pinned_in_community_id as community_id',
          db.raw('COUNT(*) as count'),
        ])
      for (const row of rows as Array<{ community_id: string; count: string }>) {
        recentPostCounts[row.community_id] = Number(row.count)
      }
    }

    // Add viewer membership info
    const viewerId = req.user?.id
    let memberMap: Record<string, MemberRole> = {}
    if (viewerId && communityIds.length > 0) {
      const memberships = await db('community_members')
        .whereIn('community_id', communityIds)
        .where('user_id', viewerId)
        .select(['community_id', 'role'])
      for (const m of memberships as Array<{ community_id: string; role: MemberRole }>) {
        memberMap[m.community_id] = m.role
      }
    }

    // Group by category
    const byCategory: Record<string, typeof communities> = {}
    for (const c of communities) {
      const cats: string[] = c.categories ?? []
      const primary = cats[0] ?? 'other'
      if (!byCategory[primary]) byCategory[primary] = []
      byCategory[primary].push(c)
    }

    // Featured = top 5 by member count
    const featured = [...communities].sort((a, b) => b.member_count - a.member_count).slice(0, 5)

    // Trending = top 5 by recent_posts in last 24h
    const trending = [...communities]
      .sort((a, b) => (recentPostCounts[b.id] ?? 0) - (recentPostCounts[a.id] ?? 0))
      .slice(0, 5)
      .filter(c => (recentPostCounts[c.id] ?? 0) > 0)

    return reply.send({
      success: true,
      data: {
        communities: communities.map(c => ({
          ...c,
          recentPosts:  recentPostCounts[c.id] ?? 0,
          viewerRole:   memberMap[c.id] ?? null,
          isMember:     !!memberMap[c.id],
        })),
        featured:    featured.map(c => ({ ...c, recentPosts: recentPostCounts[c.id] ?? 0, isMember: !!memberMap[c.id] })),
        trending:    trending.map(c => ({ ...c, recentPosts: recentPostCounts[c.id] ?? 0, isMember: !!memberMap[c.id] })),
        byCategory,
      },
    })
  })

  // ─── GET SINGLE COMMUNITY ────────────────────────────────
  app.get('/:slug', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const viewerId = req.user?.id

    const community = await db('communities').where('slug', slug).first()
    if (!community) return sendError(reply, 404, 'NOT_FOUND', 'Community not found')

    let viewerRole: MemberRole | null = null
    if (viewerId) {
      viewerRole = await getMemberRole(community.id, viewerId)
    }

    // Pinned posts
    const pinnedPosts = await db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .where('p.pinned', true)
      .where('p.pinned_in_community_id', community.id)
      .whereNull('p.deleted_at')
      .select([
        'p.id', 'p.content', 'p.post_type', 'p.like_count', 'p.boost_count',
        'p.reply_count', 'p.created_at', 'p.tags',
        'u.handle as author_handle', 'u.display_name as author_display_name',
      ])
      .orderBy('p.created_at', 'desc')

    return reply.send({
      success: true,
      data: {
        id:          community.id,
        slug:        community.slug,
        name:        community.name,
        description: community.description,
        avatarUrl:   community.avatar_url,
        bannerUrl:   community.banner_url,
        categories:  community.categories,
        memberCount: community.member_count,
        postCount:   community.post_count,
        public:      community.public,
        createdAt:   community.created_at.toISOString(),
        viewerRole,
        isMember:    !!viewerRole,
        pinnedPosts,
      },
    })
  })

  // ─── CREATE COMMUNITY ────────────────────────────────────
  app.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = CreateCommunitySchema.safeParse(req.body)
    if (!body.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input')

    const userId = req.user!.id
    const d = body.data

    // Check slug uniqueness
    const existing = await db('communities').where('slug', d.slug).first('id')
    if (existing) return sendError(reply, 409, 'CONFLICT', 'Slug already taken')

    const [community] = await db.transaction(async (trx) => {
      const [c] = await trx('communities')
        .insert({
          slug:        d.slug,
          name:        d.name,
          description: d.description ?? null,
          categories:  d.categories,
          public:      d.isPublic,
          created_by:  userId,
          member_count: 1,
        })
        .returning('*')

      // Add creator as admin
      await trx('community_members').insert({
        community_id: c.id,
        user_id:      userId,
        role:         'admin',
      })

      return [c]
    })

    return reply.status(201).send({ success: true, data: community })
  })

  // ─── JOIN / LEAVE COMMUNITY ───────────────────────────────
  app.post('/:id/join', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    const community = await db('communities').where('id', id).first('id, public')
    if (!community) return sendError(reply, 404, 'NOT_FOUND', 'Community not found')
    if (!community.public) return sendError(reply, 403, 'FORBIDDEN', 'Community is private')

    const existing = await db('community_members').where({ community_id: id, user_id: userId }).first()
    if (existing) {
      // Leave
      await db('community_members').where({ community_id: id, user_id: userId }).delete()
      await db('communities').where('id', id).decrement('member_count', 1)
      return reply.send({ success: true, data: { joined: false } })
    }

    await db('community_members').insert({ community_id: id, user_id: userId, role: 'member' })
    await db('communities').where('id', id).increment('member_count', 1)
    return reply.send({ success: true, data: { joined: true } })
  })

  // ─── UPDATE MEMBER ROLE (admin only) ─────────────────────
  app.put('/:id/members/:userId/role', { preHandler: [authenticate] }, async (req, reply) => {
    const { id, userId: targetUserId } = req.params as { id: string; userId: string }
    const callerId = req.user!.id

    // Caller must be admin
    const callerRole = await getMemberRole(id, callerId)
    if (callerRole !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Only community admins can change roles')
    }

    const roleParsed = UpdateMemberRoleSchema.safeParse(req.body)
    if (!roleParsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid role. Must be admin, moderator, or member')
    }
    const { role } = roleParsed.data

    // Prevent demoting the last admin
    if (role !== 'admin') {
      const adminCount = await db('community_members')
        .where({ community_id: id, role: 'admin' })
        .count('user_id as c')
        .first()
      if (Number((adminCount as { c: string })?.c ?? 0) <= 1) {
        const target = await db('community_members').where({ community_id: id, user_id: targetUserId, role: 'admin' }).first('user_id')
        if (target) {
          return sendError(reply, 400, 'BAD_REQUEST', 'Cannot demote the last admin')
        }
      }
    }

    const updated = await db('community_members')
      .where({ community_id: id, user_id: targetUserId })
      .update({ role })
      .returning('*')

    if (!updated.length) {
      return sendError(reply, 404, 'NOT_FOUND', 'Member not found in this community')
    }

    return reply.send({ success: true, data: updated[0] })
  })

  // ─── PIN POST (moderator/admin only) ─────────────────────
  app.post('/:id/pin/:postId', { preHandler: [authenticate] }, async (req, reply) => {
    const { id, postId } = req.params as { id: string; postId: string }
    const userId = req.user!.id

    const role = await getMemberRole(id, userId)
    if (!canModerate(role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Only moderators and admins can pin posts')
    }

    const community = await db('communities').where('id', id).first('id')
    if (!community) return sendError(reply, 404, 'NOT_FOUND', 'Community not found')

    const post = await db('posts').where('id', postId).whereNull('deleted_at').first('id, pinned, pinned_in_community_id')
    if (!post) return sendError(reply, 404, 'NOT_FOUND', 'Post not found')

    // Toggle pin
    if (post.pinned && post.pinned_in_community_id === id) {
      await db('posts').where('id', postId).update({ pinned: false, pinned_in_community_id: null })
      return reply.send({ success: true, data: { pinned: false } })
    }

    await db('posts').where('id', postId).update({ pinned: true, pinned_in_community_id: id })
    return reply.send({ success: true, data: { pinned: true } })
  })

  // ─── UNPIN POST ───────────────────────────────────────────
  app.delete('/:id/pin/:postId', { preHandler: [authenticate] }, async (req, reply) => {
    const { id, postId } = req.params as { id: string; postId: string }
    const userId = req.user!.id

    const role = await getMemberRole(id, userId)
    if (!canModerate(role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Only moderators and admins can unpin posts')
    }

    await db('posts')
      .where('id', postId)
      .where('pinned_in_community_id', id)
      .update({ pinned: false, pinned_in_community_id: null })

    return reply.send({ success: true, data: { pinned: false } })
  })

  // ─── GET COMMUNITY MEMBERS ───────────────────────────────
  app.get('/:id/members', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const qr = parseQuery(CommunityMembersQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { role, limit, cursor } = qr.data

    const community = await db('communities').where('id', id).first('id')
    if (!community) return sendError(reply, 404, 'NOT_FOUND', 'Community not found')

    let query = db('community_members as cm')
      .join('users as u', 'cm.user_id', 'u.id')
      .where('cm.community_id', id)
      .select([
        'u.id', 'u.handle', 'u.display_name', 'u.avatar_url', 'u.verified',
        'u.account_type', 'u.follower_count',
        'cm.role', 'cm.joined_at',
      ])
      .orderBy('cm.joined_at', 'asc')
      .limit(limit + 1)

    if (role) query = query.where('cm.role', role)
    if (cursor) {
      const cur = await db('community_members').where({ community_id: id, user_id: cursor }).first('joined_at')
      if (cur) query = query.where('cm.joined_at', '>', cur.joined_at)
    }

    const rows = await query
    const pageLimit = limit
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      success: true,
      data: {
        items,
        cursor:  hasMore ? items[items.length - 1].id : null,
        hasMore,
      },
    })
  })
}
