import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate, optionalAuth } from '../middleware/auth'
import type { Post, Signal, PaginatedResponse } from '@worldpulse/types'

const FEED_CACHE_TTL = 30 // seconds
const PAGE_SIZE = 20

export const registerFeedRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/v1/feed/global
   * Main global feed — latest verified signals + high-trust posts
   */
  app.get('/global', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { cursor, category, severity, limit = PAGE_SIZE } = req.query as {
      cursor?:   string
      category?: string
      severity?: string
      limit?:    number
    }

    const cacheKey = `feed:global:${category ?? 'all'}:${severity ?? 'all'}:${cursor ?? 'start'}`
    
    // Try cache first
    const cached = await redis.get(cacheKey)
    if (cached && !req.user) {
      return reply.send(JSON.parse(cached))
    }

    const pageLimit = Math.min(Number(limit), 50)
    
    let query = db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .leftJoin('signals as s', 'p.signal_id', 's.id')
      .where('p.deleted_at', null)
      .whereNull('p.parent_id')  // top-level only
      .select([
        'p.id', 'p.post_type', 'p.content', 'p.media_urls', 'p.media_types',
        'p.source_url', 'p.source_name', 'p.tags', 'p.like_count',
        'p.boost_count', 'p.reply_count', 'p.view_count', 'p.reliability_score',
        'p.location_name', 'p.language', 'p.created_at', 'p.updated_at',
        'p.signal_id',
        // Author fields
        'u.id as author_id', 'u.handle as author_handle',
        'u.display_name as author_display_name', 'u.avatar_url as author_avatar',
        'u.account_type as author_type', 'u.trust_score as author_trust',
        'u.verified as author_verified',
        // Signal fields
        's.title as signal_title', 's.summary as signal_summary',
        's.category as signal_category', 's.severity as signal_severity',
        's.status as signal_status', 's.reliability_score as signal_reliability',
        's.location_name as signal_location', 's.country_code as signal_country',
        's.tags as signal_tags',
      ])
      .limit(pageLimit + 1)
      .orderBy('p.created_at', 'desc')

    // Cursor-based pagination
    if (cursor) {
      const cursorPost = await db('posts').where('id', cursor).first()
      if (cursorPost) {
        query = query.where('p.created_at', '<', cursorPost.created_at)
      }
    }

    // Category filter via signal
    if (category && category !== 'all') {
      query = query.where('s.category', category)
    }

    // Severity filter
    if (severity && severity !== 'all') {
      query = query.where('s.severity', severity)
    }

    const rows = await query

    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    // Enrich with viewer-relative data if authenticated
    let likedIds = new Set<string>()
    let boostedIds = new Set<string>()
    let bookmarkedIds = new Set<string>()

    if (req.user) {
      const postIds = items.map(r => r.id)
      const [likes, boosts, bookmarks] = await Promise.all([
        db('likes').whereIn('post_id', postIds).where('user_id', req.user.id).select('post_id'),
        db('posts').whereIn('boost_of_id', postIds).where('author_id', req.user.id).select('boost_of_id'),
        db('bookmarks').whereIn('post_id', postIds).where('user_id', req.user.id).select('post_id'),
      ])
      likedIds = new Set(likes.map(l => l.post_id))
      boostedIds = new Set(boosts.map(b => b.boost_of_id))
      bookmarkedIds = new Set(bookmarks.map(b => b.post_id))
    }

    const posts: Post[] = items.map(row => formatPost(row, likedIds, boostedIds, bookmarkedIds))

    const response: PaginatedResponse<Post> = {
      items:   posts,
      total:   posts.length,
      cursor:  hasMore ? items[items.length - 1].id : null,
      hasMore,
    }

    // Cache for unauthenticated users
    if (!req.user) {
      await redis.setex(cacheKey, FEED_CACHE_TTL, JSON.stringify(response))
    }

    return reply.send(response)
  })

  /**
   * GET /api/v1/feed/following
   * Personalized feed from accounts the user follows
   */
  app.get('/following', { preHandler: [authenticate] }, async (req, reply) => {
    const { cursor, limit = PAGE_SIZE } = req.query as { cursor?: string; limit?: number }

    const followingIds = await db('follows')
      .where('follower_id', req.user!.id)
      .pluck('following_id')

    if (followingIds.length === 0) {
      return reply.send({ items: [], total: 0, cursor: null, hasMore: false })
    }

    let query = db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .leftJoin('signals as s', 'p.signal_id', 's.id')
      .whereIn('p.author_id', followingIds)
      .where('p.deleted_at', null)
      .whereNull('p.parent_id')
      .select([
        'p.*',
        'u.id as author_id', 'u.handle as author_handle',
        'u.display_name as author_display_name', 'u.avatar_url as author_avatar',
        'u.account_type as author_type', 'u.trust_score as author_trust',
        'u.verified as author_verified',
        's.title as signal_title', 's.summary as signal_summary',
        's.category as signal_category', 's.severity as signal_severity',
        's.status as signal_status', 's.reliability_score as signal_reliability',
      ])
      .orderBy('p.created_at', 'desc')
      .limit(Math.min(Number(limit), 50) + 1)

    if (cursor) {
      const cursorPost = await db('posts').where('id', cursor).first()
      if (cursorPost) query = query.where('p.created_at', '<', cursorPost.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 50)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      items:   items.map(r => formatPost(r, new Set(), new Set(), new Set())),
      total:   items.length,
      cursor:  hasMore ? items[items.length - 1].id : null,
      hasMore,
    })
  })

  /**
   * GET /api/v1/feed/trending
   * Trending topics across time windows
   */
  app.get('/trending', async (req, reply) => {
    const { window = '1h' } = req.query as { window?: '1h' | '6h' | '24h' }
    const cacheKey = `trending:${window}`
    
    const cached = await redis.get(cacheKey)
    if (cached) return reply.send(JSON.parse(cached))

    const topics = await db('trending_topics')
      .where('window', window)
      .where('snapshot_at', '>', db.raw("NOW() - INTERVAL '2 hours'"))
      .orderBy('score', 'desc')
      .limit(10)

    const response = { items: topics, window }
    await redis.setex(cacheKey, 60, JSON.stringify(response))
    return reply.send(response)
  })

  /**
   * GET /api/v1/feed/signals
   * Breaking signals / events stream
   */
  app.get('/signals', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { cursor, category, severity, country, limit = PAGE_SIZE } = req.query as {
      cursor?:   string
      category?: string
      severity?: string
      country?:  string
      limit?:    number
    }

    let query = db('signals as s')
      .whereIn('s.status', ['verified', 'pending'])
      .select([
        's.id', 's.title', 's.summary', 's.body', 's.category', 's.severity', 's.status',
        's.reliability_score', 's.source_count', 's.location_name', 's.country_code', 's.region',
        's.tags', 's.source_ids', 's.original_urls', 's.language',
        's.view_count', 's.share_count', 's.post_count',
        's.event_time', 's.first_reported', 's.verified_at', 's.last_updated', 's.created_at',
        db.raw(`ST_AsGeoJSON(s.location)::json as location_geojson`),
        db.raw(`
          ARRAY(
            SELECT json_build_object('id', src.id, 'slug', src.slug, 'name', src.name,
                                     'logoUrl', src.logo_url, 'tier', src.tier,
                                     'trustScore', src.trust_score)
            FROM sources src
            WHERE src.id = ANY(s.source_ids)
          ) as sources_data
        `),
      ])
      .orderBy('s.created_at', 'desc')
      .limit(Math.min(Number(limit), 50) + 1)

    if (category && category !== 'all') query = query.where('s.category', category)
    if (severity && severity !== 'all') query = query.where('s.severity', severity)
    if (country) query = query.where('s.country_code', country.toUpperCase())
    if (cursor) {
      const cur = await db('signals').where('id', cursor).first()
      if (cur) query = query.where('s.created_at', '<', cur.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 50)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      items:   items.map(formatSignal),
      total:   items.length,
      cursor:  hasMore ? items[items.length - 1].id : null,
      hasMore,
    })
  })
}

// ─── FORMATTERS ───────────────────────────────────────────────────────────
function formatPost(
  row: Record<string, unknown>,
  likedIds: Set<string>,
  boostedIds: Set<string>,
  bookmarkedIds: Set<string>,
): Post {
  return {
    id:          row.id as string,
    postType:    row.post_type as Post['postType'],
    content:     row.content as string,
    mediaUrls:   (row.media_urls as string[]) ?? [],
    mediaTypes:  (row.media_types as string[]) ?? [],
    sourceUrl:   row.source_url as string | null,
    sourceName:  row.source_name as string | null,
    tags:        (row.tags as string[]) ?? [],
    likeCount:   (row.like_count as number) ?? 0,
    boostCount:  (row.boost_count as number) ?? 0,
    replyCount:  (row.reply_count as number) ?? 0,
    viewCount:   (row.view_count as number) ?? 0,
    locationName: row.location_name as string | null,
    language:    (row.language as string) ?? 'en',
    createdAt:   (row.created_at as Date).toISOString(),
    updatedAt:   (row.updated_at as Date).toISOString(),
    signalId:    row.signal_id as string | null,
    parentId:    row.parent_id as string | null,
    parent:      null,
    boostOfId:   row.boost_of_id as string | null,
    boostOf:     null,
    threadRootId: row.thread_root_id as string | null,
    location:    null,
    reliabilityScore: row.reliability_score as number | null,
    author: {
      id:            row.author_id as string,
      handle:        row.author_handle as string,
      displayName:   row.author_display_name as string,
      bio:           null,
      avatarUrl:     row.author_avatar as string | null,
      location:      null,
      website:       null,
      accountType:   row.author_type as Post['author']['accountType'],
      trustScore:    (row.author_trust as number) ?? 0.5,
      followerCount: 0,
      followingCount:0,
      signalCount:   0,
      verified:      (row.author_verified as boolean) ?? false,
      createdAt:     '',
    },
    signal: row.signal_id ? {
      id:               row.signal_id as string,
      title:            row.signal_title as string,
      summary:          row.signal_summary as string | null,
      body:             null,
      category:         row.signal_category as Signal['category'],
      severity:         row.signal_severity as Signal['severity'],
      status:           row.signal_status as Signal['status'],
      reliabilityScore: (row.signal_reliability as number) ?? 0,
      sourceCount:      0,
      location:         null,
      locationName:     row.signal_location as string | null,
      countryCode:      row.signal_country as string | null,
      region:           null,
      tags:             (row.signal_tags as string[]) ?? [],
      sources:          [],
      originalUrls:     [],
      language:         'en',
      viewCount:        0,
      shareCount:       0,
      postCount:        0,
      eventTime:        null,
      firstReported:    '',
      verifiedAt:       null,
      lastUpdated:      '',
      createdAt:        '',
    } : null,
    isEdited:      (row.is_edited as boolean) ?? false,
    pollData:      (row.poll_data as Post['pollData']) ?? null,
    hasLiked:      likedIds.has(row.id as string),
    hasBoosted:    boostedIds.has(row.id as string),
    hasBookmarked: bookmarkedIds.has(row.id as string),
  }
}

function formatSignal(row: Record<string, unknown>) {
  return {
    id:               row.id,
    title:            row.title,
    summary:          row.summary,
    body:             row.body,
    category:         row.category,
    severity:         row.severity,
    status:           row.status,
    reliabilityScore: row.reliability_score,
    sourceCount:      row.source_count,
    location:         row.location ? { lat: (row.location as { coordinates: number[] }).coordinates[1], lng: (row.location as { coordinates: number[] }).coordinates[0] } : null,
    locationName:     row.location_name,
    countryCode:      row.country_code,
    region:           row.region,
    tags:             row.tags,
    sources:          row.sources_data ?? [],
    originalUrls:     row.original_urls,
    language:         row.language,
    viewCount:        row.view_count,
    shareCount:       row.share_count,
    postCount:        row.post_count,
    eventTime:        row.event_time ? (row.event_time as Date).toISOString() : null,
    firstReported:    (row.first_reported as Date).toISOString(),
    verifiedAt:       row.verified_at ? (row.verified_at as Date).toISOString() : null,
    lastUpdated:      (row.last_updated as Date).toISOString(),
    createdAt:        (row.created_at as Date).toISOString(),
  }
}
