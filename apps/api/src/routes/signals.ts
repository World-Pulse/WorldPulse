import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { optionalAuth, authenticate } from '../middleware/auth'
import { indexSignal, removeSignal } from '../lib/search'
import { publishSignalUpsert, publishSignalDelete } from '../lib/search-events'
import { z } from 'zod'

// ─── Cache TTLs ───────────────────────────────────────────────────────────────
const MAP_CACHE_TTL    = 30  // seconds — map points refresh every 30s
const DETAIL_CACHE_TTL = 60  // seconds — signal detail (view count incremented async)
const LIST_CACHE_TTL   = 20  // seconds — paginated list for unauthenticated users

const UpdateSignalSchema = z.object({
  status:            z.enum(['pending', 'verified', 'disputed', 'false', 'retracted']).optional(),
  severity:          z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  reliability_score: z.number().min(0).max(1).optional(),
  location_name:     z.string().max(255).optional(),
  country_code:      z.string().length(2).toUpperCase().optional(),
  tags:              z.array(z.string().max(50)).max(20).optional(),
  summary:           z.string().max(1000).optional(),
  body:              z.string().max(50000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'No updatable fields provided' })

const FlagSignalSchema = z.object({
  reason: z.enum(['inaccurate', 'outdated', 'duplicate', 'misinformation']),
  notes:  z.string().max(500).optional(),
})

export const registerSignalRoutes: FastifyPluginAsync = async (app) => {

  // ─── LIST SIGNALS ────────────────────────────────────────
  app.get('/', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const {
      category, severity, country, status = 'verified',
      cursor, limit = 20, bbox,
    } = req.query as {
      category?: string; severity?: string; country?: string
      status?: string;   cursor?: string;   limit?: number
      bbox?: string  // "minLng,minLat,maxLng,maxLat"
    }

    // Cache unauthenticated list requests (no cursor-based pages beyond first)
    const isFirstPage = !cursor
    const cacheKey = `signals:list:${status}:${category ?? 'all'}:${severity ?? 'all'}:${country ?? 'all'}:${limit}`
    if (!req.user && isFirstPage) {
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) return reply.send(JSON.parse(cached))
    }

    let query = db('signals as s')
      .select([
        's.id', 's.title', 's.summary', 's.category', 's.severity', 's.status',
        's.reliability_score', 's.source_count', 's.location_name', 's.country_code',
        's.region', 's.tags', 's.language', 's.view_count', 's.share_count',
        's.post_count', 's.event_time', 's.first_reported', 's.verified_at',
        's.last_updated', 's.created_at', 's.is_breaking', 's.community_flag_count',
        db.raw('ST_AsGeoJSON(s.location)::json as location_geojson'),
      ])
      .orderBy('s.created_at', 'desc')
      .limit(Math.min(Number(limit), 100) + 1)

    if (status) query = query.where('s.status', status)
    if (category && category !== 'all') query = query.where('s.category', category)
    if (severity && severity !== 'all') query = query.where('s.severity', severity)
    if (country) query = query.where('s.country_code', country.toUpperCase())

    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number)
      query = query.whereRaw(
        'ST_Within(s.location, ST_MakeEnvelope(?, ?, ?, ?, 4326))',
        [minLng, minLat, maxLng, maxLat]
      )
    }

    if (cursor) {
      const cur = await db('signals').where('id', cursor).first('created_at')
      if (cur) query = query.where('s.created_at', '<', cur.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 100)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    const response = {
      success: true,
      data: {
        items:   items.map(formatSignal),
        cursor:  hasMore ? items[items.length - 1].id : null,
        hasMore,
      },
    }

    // Cache first-page results for unauthenticated users
    if (!req.user && isFirstPage) {
      redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response)).catch(() => {})
    }

    return reply.send(response)
  })

  // ─── SIGNAL DETAIL ───────────────────────────────────────
  app.get('/:id', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    // Try cache for unauthenticated requests
    const cacheKey = `signals:detail:${id}`
    if (!req.user) {
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) return reply.send(JSON.parse(cached))
    }

    const signal = await db('signals as s')
      .where('s.id', id)
      .select([
        's.*',
        db.raw('ST_AsGeoJSON(s.location)::json as location_geojson'),
        db.raw(`
          ARRAY(
            SELECT row_to_json(src)
            FROM (
              SELECT id, slug, name, logo_url as "logoUrl", tier, trust_score as "trustScore"
              FROM sources
              WHERE id = ANY(s.source_ids)
            ) src
          ) as sources_data
        `),
      ])
      .first()

    if (!signal) return reply.status(404).send({ success: false, error: 'Signal not found' })

    // Increment view count async
    db('signals').where('id', id).increment('view_count', 1).catch(() => {})

    // Get verification log
    const verifications = await db('verification_log')
      .where('signal_id', id)
      .orderBy('created_at', 'desc')
      .limit(10)
      .select(['check_type', 'result', 'confidence', 'notes', 'created_at'])

    const response = {
      success: true,
      data: {
        ...formatSignal(signal),
        sources:       signal.sources_data ?? [],
        verifications,
      },
    }

    // Cache for unauthenticated requests
    if (!req.user) {
      redis.setex(cacheKey, DETAIL_CACHE_TTL, JSON.stringify(response)).catch(() => {})
    }

    return reply.send(response)
  })

  // ─── SIGNAL POSTS ────────────────────────────────────────
  app.get('/:id/posts', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { cursor, limit = 20, sort = 'recent' } = req.query as {
      cursor?: string; limit?: number; sort?: 'recent' | 'top'
    }

    const signal = await db('signals').where('id', id).first('id')
    if (!signal) return reply.status(404).send({ success: false, error: 'Signal not found' })

    let query = db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .where('p.signal_id', id)
      .whereNull('p.deleted_at')
      .whereNull('p.parent_id')
      .select([
        'p.id', 'p.content', 'p.post_type', 'p.like_count', 'p.boost_count',
        'p.reply_count', 'p.tags', 'p.created_at', 'p.media_urls', 'p.source_url',
        'p.source_name', 'p.reliability_score',
        'u.id as author_id', 'u.handle as author_handle',
        'u.display_name as author_display_name', 'u.avatar_url as author_avatar',
        'u.account_type as author_type', 'u.trust_score as author_trust',
        'u.verified as author_verified',
      ])
      .limit(Math.min(Number(limit), 50) + 1)

    if (sort === 'top') {
      query = query.orderBy('p.like_count', 'desc')
    } else {
      query = query.orderBy('p.created_at', 'desc')
      if (cursor) {
        const cur = await db('posts').where('id', cursor).first('created_at')
        if (cur) query = query.where('p.created_at', '<', cur.created_at)
      }
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 50)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      success: true,
      data: {
        items:   items.map(r => formatBasicPost(r)),
        cursor:  hasMore ? items[items.length - 1].id : null,
        hasMore,
      },
    })
  })

  // ─── UPDATE SIGNAL (admin/moderator) ─────────────────────
  // Used by moderation flows and the Kafka consumer when signal status changes.
  // Triggers a Meilisearch re-index so search results stay current.
  app.patch('/:id', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    // Only admins and moderators may update signals
    const actor = await db('users').where('id', userId).first('account_type')
    if (!actor || !['admin', 'official', 'journalist'].includes(actor.account_type as string)) {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }

    const parsed = UpdateSignalSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error:   parsed.error.issues[0]?.message ?? 'Invalid input',
        code:    'VALIDATION_ERROR',
      })
    }

    const updates = parsed.data

    const [signal] = await db('signals')
      .where('id', id)
      .update({ ...updates, last_updated: new Date() })
      .returning('*')

    if (!signal) return reply.status(404).send({ success: false, error: 'Signal not found' })

    // Invalidate caches
    redis.del(`signals:detail:${id}`).catch(() => {})
    // Bust map cache keys (broad pattern) — best-effort
    redis.keys('signals:map:*').then(keys => keys.length && redis.del(...keys)).catch(() => {})

    // Re-index in Meilisearch — direct call (fast) + Kafka event (consumer path)
    indexSignal(signal).catch(() => {})
    publishSignalUpsert(signal.id as string)

    return reply.send({ success: true, data: formatSignal(signal) })
  })

  // ─── DELETE SIGNAL (admin only) ──────────────────────────
  app.delete('/:id', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    const actor = await db('users').where('id', userId).first('account_type')
    if (!actor || actor.account_type !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }

    const deleted = await db('signals').where('id', id).delete()
    if (!deleted) return reply.status(404).send({ success: false, error: 'Signal not found' })

    // Invalidate caches
    redis.del(`signals:detail:${id}`).catch(() => {})
    redis.keys('signals:map:*').then(keys => keys.length && redis.del(...keys)).catch(() => {})

    removeSignal(id).catch(() => {})
    publishSignalDelete(id)
    return reply.send({ success: true })
  })

  // ─── FLAG SIGNAL (community) ─────────────────────────────
  app.post('/:id/flag', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const flagBody = FlagSignalSchema.safeParse(req.body)
    if (!flagBody.success) {
      return reply.status(400).send({
        success: false,
        error:   flagBody.error.issues[0]?.message ?? 'Invalid flag reason',
        code:    'VALIDATION_ERROR',
      })
    }
    const { reason, notes } = flagBody.data

    const signal = await db('signals').where('id', id).first('id')
    if (!signal) return reply.status(404).send({ success: false, error: 'Signal not found' })

    const userId  = req.user?.id ?? null
    const ipRaw   = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? ''
    const ipHash  = ipRaw ? Buffer.from(ipRaw).toString('base64').slice(0, 32) : null

    if (userId) {
      const existing = await db('signal_flags').where({ signal_id: id, user_id: userId }).first('id')
      if (existing) return reply.status(409).send({ success: false, error: 'Already flagged' })
    }

    await db('signal_flags').insert({ signal_id: id, user_id: userId, ip_hash: ipHash, reason, notes: notes ?? null })
    await db('signals').where('id', id).increment('community_flag_count', 1)

    // Invalidate detail cache so flag count updates immediately
    redis.del(`signals:detail:${id}`).catch(() => {})

    return reply.status(201).send({ success: true })
  })

  // ─── MAP DATA ─────────────────────────────────────────────
  // Returns signals with geo data for map rendering
  app.get('/map/points', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { category, severity, hours = 24 } = req.query as {
      category?: string; severity?: string; hours?: number
    }

    // Cache map points — these are expensive PostGIS queries
    const cacheKey = `signals:map:${category ?? 'all'}:${severity ?? 'all'}:${Math.min(Number(hours), 168)}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.send(JSON.parse(cached))

    let query = db('signals')
      .whereNotNull('location')
      .whereIn('status', ['verified', 'pending'])
      .where('created_at', '>', db.raw(`NOW() - INTERVAL '${Math.min(Number(hours), 168)} hours'`))
      .select([
        'id', 'title', 'summary', 'category', 'severity', 'status',
        'location_name', 'country_code', 'reliability_score', 'created_at',
        'original_urls', 'is_breaking', 'community_flag_count',
        db.raw('ST_X(location::geometry) as lng'),
        db.raw('ST_Y(location::geometry) as lat'),
      ])
      .limit(500)

    if (category && category !== 'all') query = query.where('category', category)
    if (severity && severity !== 'all') query = query.where('severity', severity)

    const points = await query
    const response = { success: true, data: points }

    // Cache the expensive PostGIS query result
    redis.setex(cacheKey, MAP_CACHE_TTL, JSON.stringify(response)).catch(() => {})

    return reply.send(response)
  })
}

function formatSignal(row: Record<string, unknown>) {
  const geo = row.location_geojson as { coordinates?: [number, number] } | null
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
    location:         geo?.coordinates ? { lng: geo.coordinates[0], lat: geo.coordinates[1] } : null,
    locationName:     row.location_name,
    countryCode:      row.country_code,
    region:           row.region,
    tags:             row.tags ?? [],
    originalUrls:     row.original_urls ?? [],
    language:         row.language ?? 'en',
    viewCount:        row.view_count ?? 0,
    shareCount:       row.share_count ?? 0,
    postCount:        row.post_count ?? 0,
    eventTime:        row.event_time ? (row.event_time as Date).toISOString() : null,
    firstReported:    row.first_reported ? (row.first_reported as Date).toISOString() : null,
    verifiedAt:       row.verified_at ? (row.verified_at as Date).toISOString() : null,
    lastUpdated:      row.last_updated ? (row.last_updated as Date).toISOString() : null,
    createdAt:          row.created_at ? (row.created_at as Date).toISOString() : null,
    isBreaking:         row.is_breaking ?? false,
    communityFlagCount: row.community_flag_count ?? 0,
    sources:            row.sources_data ?? [],
  }
}

function formatBasicPost(row: Record<string, unknown>) {
  return {
    id:          row.id,
    postType:    row.post_type,
    content:     row.content,
    mediaUrls:   row.media_urls ?? [],
    sourceUrl:   row.source_url,
    sourceName:  row.source_name,
    tags:        row.tags ?? [],
    likeCount:   row.like_count ?? 0,
    boostCount:  row.boost_count ?? 0,
    replyCount:  row.reply_count ?? 0,
    createdAt:   (row.created_at as Date).toISOString(),
    reliabilityScore: row.reliability_score,
    author: {
      id:          row.author_id,
      handle:      row.author_handle,
      displayName: row.author_display_name,
      avatarUrl:   row.author_avatar,
      accountType: row.author_type,
      trustScore:  row.author_trust,
      verified:    row.author_verified,
    },
  }
}
