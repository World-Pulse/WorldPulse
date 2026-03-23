import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate, optionalAuth } from '../middleware/auth'
import { broadcast } from '../ws/handler'
import { z } from 'zod'
import { indexPost, removePost } from '../lib/search'
import { publishPostCreated, publishPostDeleted } from '../lib/search-events'

// Simple script-based language detector — no external dependency needed.
// Covers the languages most likely to appear in news posts.
const SCRIPT_PATTERNS: [RegExp, string][] = [
  [/[\u4E00-\u9FFF]/, 'zh'],          // CJK Unified Ideographs (Chinese)
  [/[\u3040-\u30FF]/, 'ja'],          // Hiragana / Katakana (Japanese)
  [/[\uAC00-\uD7AF]/, 'ko'],          // Hangul (Korean)
  [/[\u0600-\u06FF]/, 'ar'],          // Arabic
  [/[\u0400-\u04FF]/, 'ru'],          // Cyrillic (Russian default)
  [/[\u0900-\u097F]/, 'hi'],          // Devanagari (Hindi)
  [/[\u0370-\u03FF]/, 'el'],          // Greek
  [/[\u0E00-\u0E7F]/, 'th'],          // Thai
  [/[\u0590-\u05FF]/, 'he'],          // Hebrew
]

// Latin-script stop-word heuristic for common European languages
const LATIN_STOPWORDS: Record<string, string[]> = {
  es: ['que', 'del', 'los', 'las', 'una', 'por', 'con', 'para'],
  fr: ['les', 'des', 'une', 'dans', 'sur', 'est', 'pas', 'aux'],
  de: ['die', 'der', 'das', 'und', 'ist', 'ein', 'nicht', 'mit'],
  pt: ['que', 'uma', 'não', 'com', 'dos', 'são', 'para', 'por'],
  it: ['che', 'del', 'una', 'con', 'per', 'non', 'dei', 'sul'],
}

function detectLanguage(text: string): string {
  for (const [pattern, lang] of SCRIPT_PATTERNS) {
    if (pattern.test(text)) return lang
  }
  const words = text.toLowerCase().split(/\W+/).filter(Boolean)
  let bestLang = 'en'
  let bestScore = 0
  for (const [lang, stopwords] of Object.entries(LATIN_STOPWORDS)) {
    const hits = words.filter(w => stopwords.includes(w)).length
    if (hits > bestScore) { bestScore = hits; bestLang = lang }
  }
  return bestLang
}

const CreatePostSchema = z.object({
  content:     z.string().min(1).max(2000),
  postType:    z.enum(['signal', 'thread', 'report', 'boost', 'deep_dive', 'poll']).default('signal'),
  signalId:    z.string().uuid().optional(),
  parentId:    z.string().uuid().optional(),
  boostOfId:   z.string().uuid().optional(),
  locationName:z.string().max(255).optional(),
  lat:         z.number().optional(),
  lng:         z.number().optional(),
  mediaUrls:   z.array(z.string().url()).max(4).default([]),
  mediaTypes:  z.array(z.string()).max(4).default([]),
  sourceUrl:   z.string().url().optional(),
  sourceName:  z.string().max(255).optional(),
  tags:        z.array(z.string().max(50)).max(10).default([]),
})

export const registerPostRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['posts']
  })

  // ─── CREATE POST ─────────────────────────────────────────
  app.post('/', { preHandler: [authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = CreatePostSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input', code: 'VALIDATION' })
    }

    const userId = req.user!.id
    const d = body.data

    // Validate references exist
    if (d.signalId) {
      const signal = await db('signals').where('id', d.signalId).first('id')
      if (!signal) return reply.status(404).send({ success: false, error: 'Signal not found' })
    }
    if (d.parentId) {
      const parent = await db('posts').where('id', d.parentId).whereNull('deleted_at').first('id, thread_root_id')
      if (!parent) return reply.status(404).send({ success: false, error: 'Parent post not found' })
    }
    if (d.boostOfId) {
      const original = await db('posts').where('id', d.boostOfId).whereNull('deleted_at').first('id')
      if (!original) return reply.status(404).send({ success: false, error: 'Original post not found' })
    }

    // Determine thread root
    let threadRootId: string | null = null
    if (d.parentId) {
      const parent = await db('posts').where('id', d.parentId).first('thread_root_id, id')
      threadRootId = parent?.thread_root_id ?? d.parentId
    }

    // Extract @mentions
    const mentionHandles = [...(d.content.match(/@([a-zA-Z0-9_]+)/g) ?? [])].map(m => m.slice(1))
    let mentionIds: string[] = []
    if (mentionHandles.length > 0) {
      const users = await db('users').whereIn('handle', mentionHandles).select('id')
      mentionIds = users.map(u => u.id)
    }

    const [post] = await db('posts')
      .insert({
        author_id:    userId,
        post_type:    d.postType,
        content:      d.content,
        signal_id:    d.signalId ?? null,
        parent_id:    d.parentId ?? null,
        boost_of_id:  d.boostOfId ?? null,
        thread_root_id: threadRootId,
        location_name: d.locationName ?? null,
        location:     (d.lat && d.lng) ? db.raw('ST_MakePoint(?, ?)', [d.lng, d.lat]) : null,
        media_urls:   d.mediaUrls,
        media_types:  d.mediaTypes,
        source_url:   d.sourceUrl ?? null,
        source_name:  d.sourceName ?? null,
        tags:         d.tags,
        mentions:     mentionIds,
        language:     detectLanguage(d.content),
      })
      .returning('*')

    // Update parent reply count
    if (d.parentId) {
      await db('posts').where('id', d.parentId).increment('reply_count', 1)
    }

    // Update boost count on original
    if (d.boostOfId) {
      await db('posts').where('id', d.boostOfId).increment('boost_count', 1)
    }

    // Update signal post count
    if (d.signalId) {
      await db('signals').where('id', d.signalId).increment('post_count', 1)
    }

    // Update user signal count
    await db('users').where('id', userId).increment('signal_count', 1)

    // Get full post with author
    const full = await getPostWithAuthor(post.id, userId)

    // Index in Meilisearch — direct call (fast) + Kafka event (consumer path)
    const author = full?.author
    indexPost({
      ...post,
      author_handle:       author?.handle ?? '',
      author_display_name: author?.displayName ?? '',
    }).catch(() => {})
    publishPostCreated(post.id as string)

    // Broadcast via WebSocket
    await redis.publish('wp:post.new', JSON.stringify({
      event:   'post.new',
      payload: { post: full },
      filter:  { category: d.signalId ? 'signal' : 'social' },
    }))

    // Create mention notifications
    if (mentionIds.length > 0) {
      await db('notifications').insert(
        mentionIds.map(uid => ({
          user_id:  uid,
          type:     'mention',
          actor_id: userId,
          post_id:  post.id,
          payload:  { preview: d.content.slice(0, 100) },
        }))
      )
    }

    return reply.status(201).send({ success: true, data: full })
  })

  // ─── GET POST ────────────────────────────────────────────
  app.get('/:id', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user?.id

    const post = await getPostWithAuthor(id, userId)
    if (!post) return reply.status(404).send({ success: false, error: 'Post not found' })

    // Increment view count (async, no await)
    db('posts').where('id', id).increment('view_count', 1).catch(() => {})

    return reply.send({ success: true, data: post })
  })

  // ─── GET REPLIES ─────────────────────────────────────────
  app.get('/:id/replies', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { cursor, limit = 20 } = req.query as { cursor?: string; limit?: number }
    const userId = req.user?.id

    let query = db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .where('p.parent_id', id)
      .whereNull('p.deleted_at')
      .select([
        'p.id', 'p.content', 'p.post_type', 'p.like_count', 'p.boost_count',
        'p.reply_count', 'p.view_count', 'p.tags', 'p.created_at', 'p.updated_at',
        'p.signal_id', 'p.media_urls', 'p.location_name', 'p.reliability_score',
        'u.id as author_id', 'u.handle as author_handle', 'u.display_name as author_display_name',
        'u.avatar_url as author_avatar', 'u.account_type as author_type',
        'u.trust_score as author_trust', 'u.verified as author_verified',
      ])
      .orderBy('p.like_count', 'desc')
      .orderBy('p.created_at', 'asc')
      .limit(Math.min(Number(limit), 50) + 1)

    if (cursor) {
      const cur = await db('posts').where('id', cursor).first()
      if (cur) query = query.where('p.created_at', '>', cur.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 50)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    // Get viewer-relative likes
    let likedIds = new Set<string>()
    if (userId) {
      const likes = await db('likes').whereIn('post_id', items.map(i => i.id)).where('user_id', userId).pluck('post_id')
      likedIds = new Set(likes)
    }

    return reply.send({
      success: true,
      data: {
        items:   items.map(r => formatBasicPost(r, likedIds)),
        cursor:  hasMore ? items[items.length - 1].id : null,
        hasMore,
      },
    })
  })

  // ─── LIKE / UNLIKE ───────────────────────────────────────
  app.post('/:id/like', { preHandler: [authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    const post = await db('posts').where('id', id).whereNull('deleted_at').first('id, author_id, like_count')
    if (!post) return reply.status(404).send({ success: false, error: 'Post not found' })

    const existing = await db('likes').where({ user_id: userId, post_id: id }).first()

    if (existing) {
      // Unlike
      await db('likes').where({ user_id: userId, post_id: id }).delete()
      return reply.send({ success: true, data: { liked: false, count: Math.max(0, post.like_count - 1) } })
    }

    // Like
    await db('likes').insert({ user_id: userId, post_id: id })

    // Notify post author (not self-likes)
    if (post.author_id !== userId) {
      await db('notifications').insert({
        user_id:  post.author_id,
        type:     'like',
        actor_id: userId,
        post_id:  id,
        payload:  {},
      })
    }

    return reply.send({ success: true, data: { liked: true, count: post.like_count + 1 } })
  })

  // ─── BOOKMARK ────────────────────────────────────────────
  app.post('/:id/bookmark', { preHandler: [authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    const post = await db('posts').where('id', id).first('id')
    if (!post) return reply.status(404).send({ success: false, error: 'Post not found' })

    const existing = await db('bookmarks').where({ user_id: userId, post_id: id }).first()
    if (existing) {
      await db('bookmarks').where({ user_id: userId, post_id: id }).delete()
      return reply.send({ success: true, data: { bookmarked: false } })
    }

    await db('bookmarks').insert({ user_id: userId, post_id: id })
    return reply.send({ success: true, data: { bookmarked: true } })
  })

  // ─── DELETE POST ─────────────────────────────────────────
  app.delete('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    const post = await db('posts').where('id', id).first('id, author_id')
    if (!post) return reply.status(404).send({ success: false, error: 'Not found' })
    if (post.author_id !== userId) return reply.status(403).send({ success: false, error: 'Forbidden' })

    await db('posts').where('id', id).update({ deleted_at: new Date() })
    removePost(id).catch(() => {})
    publishPostDeleted(id)
    return reply.send({ success: true })
  })
}

// ─── HELPERS ─────────────────────────────────────────────────────────────
async function getPostWithAuthor(id: string, viewerId?: string) {
  const row = await db('posts as p')
    .join('users as u', 'p.author_id', 'u.id')
    .leftJoin('signals as s', 'p.signal_id', 's.id')
    .where('p.id', id)
    .whereNull('p.deleted_at')
    .select([
      'p.id', 'p.content', 'p.post_type', 'p.like_count', 'p.boost_count',
      'p.reply_count', 'p.view_count', 'p.tags', 'p.created_at', 'p.updated_at',
      'p.signal_id', 'p.parent_id', 'p.boost_of_id', 'p.thread_root_id',
      'p.media_urls', 'p.media_types', 'p.source_url', 'p.source_name',
      'p.location_name', 'p.reliability_score', 'p.language',
      'u.id as author_id', 'u.handle as author_handle',
      'u.display_name as author_display_name', 'u.avatar_url as author_avatar',
      'u.account_type as author_type', 'u.trust_score as author_trust', 'u.verified as author_verified',
      's.title as signal_title', 's.category as signal_category',
      's.severity as signal_severity', 's.status as signal_status',
      's.reliability_score as signal_reliability', 's.location_name as signal_location',
    ])
    .first()

  if (!row) return null

  let hasLiked = false
  let hasBoosted = false
  let hasBookmarked = false

  if (viewerId) {
    const [like, boost, bookmark] = await Promise.all([
      db('likes').where({ user_id: viewerId, post_id: id }).first('post_id'),
      db('posts').where({ author_id: viewerId, boost_of_id: id }).first('id'),
      db('bookmarks').where({ user_id: viewerId, post_id: id }).first('post_id'),
    ])
    hasLiked = !!like
    hasBoosted = !!boost
    hasBookmarked = !!bookmark
  }

  return formatBasicPost(row, new Set(hasLiked ? [id] : []), new Set(hasBoosted ? [id] : []), new Set(hasBookmarked ? [id] : []))
}

function formatBasicPost(
  row: Record<string, unknown>,
  likedIds = new Set<string>(),
  boostedIds = new Set<string>(),
  bookmarkedIds = new Set<string>(),
) {
  const id = row.id as string
  return {
    id,
    postType:    row.post_type,
    content:     row.content,
    mediaUrls:   row.media_urls ?? [],
    mediaTypes:  row.media_types ?? [],
    sourceUrl:   row.source_url,
    sourceName:  row.source_name,
    tags:        row.tags ?? [],
    likeCount:   row.like_count ?? 0,
    boostCount:  row.boost_count ?? 0,
    replyCount:  row.reply_count ?? 0,
    viewCount:   row.view_count ?? 0,
    locationName: row.location_name,
    language:    row.language ?? 'en',
    createdAt:   (row.created_at as Date).toISOString(),
    updatedAt:   (row.updated_at as Date).toISOString(),
    signalId:    row.signal_id,
    parentId:    row.parent_id,
    boostOfId:   row.boost_of_id,
    threadRootId: row.thread_root_id,
    location:    null,
    reliabilityScore: row.reliability_score,
    author: {
      id:          row.author_id,
      handle:      row.author_handle,
      displayName: row.author_display_name,
      avatarUrl:   row.author_avatar,
      accountType: row.author_type,
      trustScore:  row.author_trust,
      verified:    row.author_verified,
      bio: null, location: null, website: null,
      followerCount: 0, followingCount: 0, signalCount: 0, createdAt: '',
    },
    signal: row.signal_id ? {
      id:               row.signal_id,
      title:            row.signal_title,
      category:         row.signal_category,
      severity:         row.signal_severity,
      status:           row.signal_status,
      reliabilityScore: row.signal_reliability,
      locationName:     row.signal_location,
      summary: null, body: null, countryCode: null, region: null,
      tags: [], sources: [], originalUrls: [], language: 'en',
      viewCount: 0, shareCount: 0, postCount: 0, sourceCount: 0,
      eventTime: null, firstReported: '', verifiedAt: null, lastUpdated: '', createdAt: '',
      location: null,
    } : null,
    hasLiked:      likedIds.has(id),
    hasBoosted:    boostedIds.has(id),
    hasBookmarked: bookmarkedIds.has(id),
  }
}
