import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { optionalAuth, authenticate } from '../middleware/auth'
import { generateEmbedding, querySimilar, isPineconeEnabled } from '../lib/pinecone'
import { indexSignal, removeSignal } from '../lib/search'
import { publishSignalUpsert, publishSignalDelete } from '../lib/search-events'
import { generateSignalSummary, refreshSignalSummary } from '../lib/signal-summary'
import { slopDetector } from '../lib/slop-detector'
import { computeRiskScore } from '../lib/risk-score'
import { detectCIB } from '../lib/cib-detection'
import type { CIBSignalInput } from '../lib/cib-detection'
import { z } from 'zod'
import { sendError } from '../lib/errors'
import { getSourceBias, extractDomain } from '../lib/source-bias'
import {
  parseQuery,
  SignalListQuerySchema,
  MapPointsQuerySchema,
  HistoryQuerySchema,
  HotspotsQuerySchema,
} from '../lib/query-schemas'

// ─── Bbox Validation Helper ───────────────────────────────────────────────────
/**
 * Validates a bbox query string ("minLng,minLat,maxLng,maxLat") and returns
 * the four parsed coordinate numbers, or null if the string is invalid.
 *
 * Returns `{ error: string }` if validation fails, `{ coords: number[] }` if ok.
 */
function parseBbox(raw: string): { coords: [number, number, number, number] } | { error: string } {
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some(n => !isFinite(n) || isNaN(n))) {
    return { error: 'bbox must be exactly 4 comma-separated finite numbers: minLng,minLat,maxLng,maxLat' }
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number]
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
    return { error: 'bbox coordinates out of valid range: lng ∈ [-180, 180], lat ∈ [-90, 90]' }
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    return { error: 'bbox min values must be strictly less than their max counterparts' }
  }
  return { coords: [minLng, minLat, maxLng, maxLat] }
}

// ─── Cache TTLs ───────────────────────────────────────────────────────────────
const MAP_CACHE_TTL    = 45  // seconds — map points (expensive PostGIS queries)
const DETAIL_CACHE_TTL = 60  // seconds — signal detail (view count incremented async)
const LIST_CACHE_TTL   = 30  // seconds — paginated list for unauthenticated users
const CIB_CACHE_TTL    = 300 // seconds — CIB check result (5 minutes)

/**
 * Delete all Redis keys matching a glob pattern using SCAN so we never block
 * the Redis event loop (unlike KEYS which is O(N) and single-threaded).
 */
async function flushCachePattern(pattern: string): Promise<void> {
  let cursor = '0'
  const toDelete: string[] = []
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = next
    toDelete.push(...keys)
  } while (cursor !== '0')
  if (toDelete.length > 0) {
    // UNLINK is async on the server side — non-blocking unlike DEL
    await redis.unlink(...toDelete)
  }
}

export const UpdateSignalSchema = z.object({
  status:            z.enum(['pending', 'verified', 'disputed', 'false', 'retracted']).optional(),
  severity:          z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  reliability_score: z.number().min(0).max(1).optional(),
  location_name:     z.string().max(255).optional(),
  country_code:      z.string().length(2).toUpperCase().optional(),
  tags:              z.array(z.string().max(50)).max(20).optional(),
  summary:           z.string().max(1000).optional(),
  body:              z.string().max(50000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'No updatable fields provided' })

export const FlagSignalSchema = z.object({
  reason: z.enum(['inaccurate', 'outdated', 'duplicate', 'misinformation']),
  notes:  z.string().max(500).optional(),
})

export const registerSignalRoutes: FastifyPluginAsync = async (app) => {

  // Auto-tag all routes in this plugin
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['signals']
  })

  // ─── LIST SIGNALS ────────────────────────────────────────
  app.get('/', {
    schema: {
      tags: ['signals'],
      summary: 'List verified signals',
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (e.g. breaking, conflict, climate)' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          country:  { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
          status:   { type: 'string', enum: ['pending', 'verified', 'disputed', 'false', 'retracted'], default: 'verified' },
          cursor:   { type: 'string', description: 'Pagination cursor (ISO timestamp)' },
          limit:    { type: 'number', default: 20, maximum: 100 },
          bbox:     { type: 'string', description: 'Bounding box: minLng,minLat,maxLng,maxLat' },
        },
      },
    },
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const qr = parseQuery(SignalListQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { category, severity, country, status, cursor, limit, bbox } = qr.data

    // Cache unauthenticated list requests (no cursor-based pages beyond first)
    const isFirstPage = !cursor
    const cacheKey = `signals:list:${status}:${category ?? 'all'}:${severity ?? 'all'}:${country ?? 'all'}:${limit}`
    if (!req.user && isFirstPage) {
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))
    }

    let query = db('signals as s')
      .select([
        's.id', 's.title', 's.summary', 's.category', 's.severity', 's.status',
        's.reliability_score', 's.source_count', 's.location_name', 's.country_code',
        's.region', 's.tags', 's.language', 's.view_count', 's.share_count',
        's.post_count', 's.event_time', 's.first_reported', 's.verified_at',
        's.last_updated', 's.last_corroborated_at', 's.created_at', 's.is_breaking', 's.community_flag_count',
        db.raw('ST_AsGeoJSON(s.location)::json as location_geojson'),
      ])
      .orderBy('s.created_at', 'desc')
      .limit(Math.min(Number(limit), 100) + 1)

    if (status) query = query.where('s.status', status)
    if (category && category !== 'all') query = query.where('s.category', category)
    if (severity && severity !== 'all') query = query.where('s.severity', severity)
    if (country) query = query.where('s.country_code', country.toUpperCase())

    if (bbox) {
      const parsed = parseBbox(bbox)
      if ('error' in parsed) {
        return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error)
      }
      const [minLng, minLat, maxLng, maxLat] = parsed.coords
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
      if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))
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
              SELECT s2.id, s2.slug, s2.name, s2.logo_url as "logoUrl", s2.tier,
                     s2.trust_score as "trustScore", ss.article_url as "articleUrl"
              FROM sources s2
              LEFT JOIN signal_sources ss ON ss.source_id = s2.id AND ss.signal_id = s.id
              -- Cast to text on both sides: prod's source_ids was migrated to text[]
              -- during Apr 15 hotfix, so uuid = text fails without an explicit cast.
              WHERE s2.id::text = ANY(s.source_ids::text[])
              ORDER BY s2.trust_score DESC
            ) src
          ) as sources_data
        `),
      ])
      .first()

    if (!signal) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

    // Increment view count async
    db('signals').where('id', id).increment('view_count', 1).catch(() => {})

    // Get verification log
    const verifications = await db('verification_log')
      .where('signal_id', id)
      .orderBy('created_at', 'desc')
      .limit(10)
      .select(['check_type', 'result', 'confidence', 'notes', 'created_at'])

    // Get multimedia items (YouTube, podcast audio) — table may not exist yet
    let media: Array<Record<string, unknown>> = []
    try {
      const mediaRows = await db('signal_media')
        .where('signal_id', id)
        .orderBy('created_at', 'asc')
        .select(['id', 'media_type', 'url', 'embed_id', 'title', 'thumbnail_url', 'source_name'])

      media = mediaRows.map((row: Record<string, unknown>) => ({
        id:           row.id,
        mediaType:    row.media_type,
        url:          row.url,
        embedId:      row.embed_id      ?? null,
        title:        row.title         ?? null,
        thumbnailUrl: row.thumbnail_url ?? null,
        sourceName:   row.source_name   ?? null,
      }))
    } catch {
      // signal_media table may not exist yet — non-critical
    }

    // Bias lookup — use first source URL if available, fall back to original_urls
    const primarySourceUrl =
      (signal.sources_data as Array<{ articleUrl?: string }> | null)?.[0]?.articleUrl ??
      (Array.isArray(signal.original_urls) && (signal.original_urls as string[]).length > 0 ? (signal.original_urls as string[])[0] : null)
    const sourceBias = primarySourceUrl
      ? await getSourceBias(extractDomain(primarySourceUrl)).catch(() => null)
      : null

    // Generate AI summary async (non-blocking for response cache, fire-and-get)
    const aiSummary = await generateSignalSummary({
      id:       signal.id as string,
      title:    signal.title as string,
      summary:  signal.summary as string | null,
      body:     signal.body as string | null,
      category: signal.category as string,
      severity: signal.severity as string,
      tags:     (signal.tags as string[]) ?? [],
      language: (signal.language as string) ?? 'en',
    }).catch(() => null)

    const response = {
      success: true,
      data: {
        ...formatSignal(signal),
        sources:       signal.sources_data ?? [],
        verifications,
        aiSummary,
        sourceBias,
        media,
      },
    }

    // Cache for unauthenticated requests
    if (!req.user) {
      redis.setex(cacheKey, DETAIL_CACHE_TTL, JSON.stringify(response)).catch(() => {})
    }

    return reply.send(response)
  })

  // ─── AI SUMMARY (on-demand + refresh) ───────────────────
  app.get('/:id/summary', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id }     = req.params as { id: string }
    const { refresh } = req.query as { refresh?: string }

    const signal = await db('signals')
      .where('id', id)
      .first(['id', 'title', 'summary', 'body', 'category', 'severity', 'tags', 'language'])

    if (!signal) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

    const fn = refresh === 'true' && req.user ? refreshSignalSummary : generateSignalSummary

    const aiSummary = await fn({
      id:       signal.id as string,
      title:    signal.title as string,
      summary:  signal.summary as string | null,
      body:     signal.body as string | null,
      category: signal.category as string,
      severity: signal.severity as string,
      tags:     (signal.tags as string[]) ?? [],
      language: (signal.language as string) ?? 'en',
    })

    return reply.send({ success: true, data: { signalId: id, aiSummary } })
  })

  // ─── CIB CHECK ───────────────────────────────────────────
  // Runs Coordinated Information Behavior detection for a signal.
  // Fetches recent signals in the same category from the last 2h and calls detectCIB().
  // Results are cached in Redis for 5 minutes to avoid repeated heavy queries.
  app.get('/:id/cib-check', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const cacheKey = `signals:cib:${id}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const signal = await db('signals')
      .where('id', id)
      .first('id', 'title', 'category', 'reliability_score', 'created_at')
      .catch(() => null)

    if (!signal) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const recentRows = await db('signals')
      .where('category', signal.category as string)
      .where('created_at', '>=', twoHoursAgo)
      .whereNot('id', id)
      .select('id', 'title', 'category', 'reliability_score', 'created_at')
      .limit(200)
      .catch(() => [] as Record<string, unknown>[])

    const target: CIBSignalInput = {
      id:               signal.id as string,
      title:            signal.title as string,
      category:         signal.category as string,
      publishedAt:      new Date(signal.created_at as Date | string),
      reliabilityScore: (signal.reliability_score as number) ?? 0,
    }

    const peers: CIBSignalInput[] = recentRows.map(s => ({
      id:               s.id as string,
      title:            s.title as string,
      category:         s.category as string,
      publishedAt:      new Date(s.created_at as Date | string),
      reliabilityScore: (s.reliability_score as number) ?? 0,
    }))

    const cibResult = detectCIB(target, peers)
    const response = { success: true, data: cibResult }

    redis.setex(cacheKey, CIB_CACHE_TTL, JSON.stringify(response)).catch(() => {})

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
    if (!signal) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

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
      return sendError(reply, 403, 'FORBIDDEN', 'Forbidden')
    }

    const parsed = UpdateSignalSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input')
    }

    const updates = parsed.data

    const [signal] = await db('signals')
      .where('id', id)
      .update({ ...updates, last_updated: new Date() })
      .returning('*')

    if (!signal) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

    // Invalidate caches
    redis.del(`signals:detail:${id}`).catch(() => {})
    flushCachePattern('signals:list:*').catch(() => {})
    flushCachePattern('signals:map:*').catch(() => {})

    // Re-index in Meilisearch — direct call (fast) + Kafka event (consumer path)
    indexSignal(signal).catch(() => {})
    publishSignalUpsert(signal.id as string)

    // Publish real-time GraphQL subscription event (fire-and-forget)
    try {
      const pubsub = (app.graphql as unknown as { pubsub?: { publish(args: { topic: string; payload: unknown }): Promise<void> } }).pubsub
      if (pubsub) {
        pubsub.publish({ topic: 'SIGNAL_UPDATED', payload: { signalUpdated: formatSignal(signal) } }).catch(() => {})
      }
    } catch { /* never block the HTTP response */ }

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
      return sendError(reply, 403, 'FORBIDDEN', 'Forbidden')
    }

    const deleted = await db('signals').where('id', id).delete()
    if (!deleted) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

    // Invalidate caches
    redis.del(`signals:detail:${id}`).catch(() => {})
    flushCachePattern('signals:list:*').catch(() => {})
    flushCachePattern('signals:map:*').catch(() => {})

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
      return sendError(reply, 400, 'VALIDATION_ERROR', flagBody.error.issues[0]?.message ?? 'Invalid flag reason')
    }
    const { reason, notes } = flagBody.data

    const signal = await db('signals').where('id', id).first('id')
    if (!signal) return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')

    const userId  = req.user?.id ?? null
    const ipRaw   = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? ''
    const ipHash  = ipRaw ? Buffer.from(ipRaw).toString('base64').slice(0, 32) : null

    if (userId) {
      const existing = await db('signal_flags').where({ signal_id: id, user_id: userId }).first('id')
      if (existing) return sendError(reply, 409, 'CONFLICT', 'Already flagged')
    }

    await db('signal_flags').insert({ signal_id: id, user_id: userId, ip_hash: ipHash, reason, notes: notes ?? null })
    await db('signals').where('id', id).increment('community_flag_count', 1)

    // Invalidate detail cache so flag count updates immediately
    redis.del(`signals:detail:${id}`).catch(() => {})

    return reply.status(201).send({ success: true })
  })

  // ─── SLOP SCORE (admin only) ──────────────────────────────
  // Returns AI-generated content probability score for a signal.
  // Only visible to admin users — not exposed in public API.
  app.get('/:id/slop-score', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    // Admin-only endpoint
    const actor = await db('users').where('id', userId).first('account_type')
    if (!actor || actor.account_type !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Forbidden — admin only')
    }

    // Fetch signal metadata for scoring
    const signal = await db('signals')
      .where('id', id)
      .first('id', 'title', 'summary', 'source_url', 'author', 'created_at')
      .catch(() => null)

    if (!signal) {
      return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')
    }

    const result = await slopDetector.scoreSignal({
      id:           signal.id as string,
      source_url:   signal.source_url as string | null,
      title:        signal.title as string | null,
      content:      signal.summary as string | null,
      author:       signal.author as string | null,
    })

    return reply.send({
      success:  true,
      signalId: id,
      score:    result.score,
      flags:    result.flags,
      cached:   result.cached,
      isSlop:   result.score >= 0.7,
    })
  })

  // ─── SIGNAL COUNT ──────────────────────────────────────────
  // Returns total count of verified signals + recent (last 24h) count
  app.get('/count', {
    schema: {
      tags: ['signals'],
      summary: 'Get signal counts',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total:      { type: 'number' },
                last24h:    { type: 'number' },
                lastHour:   { type: 'number' },
                bySeverity: {
                  type: 'object',
                  properties: {
                    critical: { type: 'number' },
                    high:     { type: 'number' },
                    medium:   { type: 'number' },
                    low:      { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const cacheKey = 'signals:count'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const [totalResult] = await db('signals')
      .whereIn('status', ['verified', 'pending'])
      .count('id as count')

    const [last24hResult] = await db('signals')
      .whereIn('status', ['verified', 'pending'])
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .count('id as count')

    const [lastHourResult] = await db('signals')
      .whereIn('status', ['verified', 'pending'])
      .where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'"))
      .count('id as count')

    const severityCounts = await db('signals')
      .whereIn('status', ['verified', 'pending'])
      .select('severity')
      .count('id as count')
      .groupBy('severity')

    const bySeverity: Record<string, number> = {}
    for (const row of severityCounts) {
      bySeverity[row.severity as string] = Number(row.count)
    }

    const response = {
      success: true,
      data: {
        total:      Number(totalResult?.count ?? 0),
        last24h:    Number(last24hResult?.count ?? 0),
        lastHour:   Number(lastHourResult?.count ?? 0),
        bySeverity,
      },
    }

    // Cache for 15 seconds — short TTL for near-real-time accuracy
    redis.setex(cacheKey, 15, JSON.stringify(response)).catch(() => {})

    return reply.send(response)
  })

  // ─── RECENT HEADLINES ─────────────────────────────────────
  // Returns latest breaking/high-severity signals for the news ticker
  app.get('/headlines', {
    schema: {
      tags: ['signals'],
      summary: 'Get recent headlines for news ticker',
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
      const cacheKey = 'signals:headlines'
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

      const headlines = await db('signals')
        .whereIn('status', ['verified', 'pending'])
        .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
        .orderByRaw("CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC")
        .orderBy('created_at', 'desc')
        .limit(10)
        .select('id', 'title', 'category', 'severity', 'location_name', 'created_at')

      const CATEGORY_COLORS: Record<string, string> = {
        conflict:   'red',
        security:   'red',
        breaking:   'red',
        politics:   'amber',
        markets:    'amber',
        economics:  'amber',
        climate:    'cyan',
        science:    'cyan',
        technology: 'cyan',
        health:     'green',
        culture:    'green',
        sports:     'green',
      }

      const data = headlines.map((h: Record<string, unknown>) => ({
        id:    h.id,
        type:  CATEGORY_COLORS[h.category as string] ?? 'amber',
        label: ((h.category as string) ?? 'news').toUpperCase(),
        text:  h.title as string,
      }))

      const response = { success: true, data }
      redis.setex(cacheKey, 30, JSON.stringify(response)).catch(() => {})
      return reply.send(response)
    } catch (err) {
      req.log.error({ err }, 'headlines: handler error')
      return reply.send({ success: true, data: [] })
    }
  })

  // ─── MAP DATA ─────────────────────────────────────────────
  // Returns signals with geo data for map rendering
  app.get('/map/points', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['signals'],
      summary: 'Map signal points',
      description: 'Returns geo-located signals for map rendering. Supports bbox, category, severity, and hours filters.',
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          severity:  { type: 'string' },
          hours:     { type: 'number', default: 24 },
          bbox:      { type: 'string', description: 'Bounding box filter: minLng,minLat,maxLng,maxLat' },
        },
      },
    },
  }, async (req, reply) => {
    const qr = parseQuery(MapPointsQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { category, severity, hours, bbox } = qr.data

    const safeHours = hours
    const bboxKey   = bbox ? `:${bbox}` : ''

    // Cache map points — these are expensive PostGIS queries
    const cacheKey = `signals:map:${category ?? 'all'}:${severity ?? 'all'}:${safeHours}${bboxKey}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    let query = db('signals')
      .whereNotNull('location')
      .whereIn('status', ['verified', 'pending'])
      .where('created_at', '>', db.raw(`NOW() - INTERVAL '${safeHours} hours'`))
      .select([
        'id', 'title', 'summary', 'category', 'severity', 'status',
        'location_name', 'country_code', 'reliability_score', 'created_at',
        'original_urls', 'is_breaking', 'community_flag_count',
        db.raw('ST_X(location::geometry) as lng'),
        db.raw('ST_Y(location::geometry) as lat'),
      ])
      .orderBy('created_at', 'desc')
      .limit(500)

    if (category && category !== 'all') query = query.where('category', category)
    if (severity && severity !== 'all') query = query.where('severity', severity)

    // Bounding-box spatial filter (Gate 2: map validation hardening)
    if (bbox) {
      const parsed = parseBbox(bbox)
      if ('error' in parsed) {
        return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error)
      }
      const [minLng, minLat, maxLng, maxLat] = parsed.coords
      query = query.whereRaw(
        'ST_Within(location::geometry, ST_MakeEnvelope(?, ?, ?, ?, 4326))',
        [minLng, minLat, maxLng, maxLat],
      )
    }

    const points = await query

    // Count how many signals have geo data for health monitoring
    const geoCount = points.length

    const response = {
      success:   true,
      data:      points,
      meta: {
        total:        geoCount,
        hours:        safeHours,
        bbox:         bbox ?? null,
        generated_at: new Date().toISOString(),
      },
    }

    // Cache the expensive PostGIS query result
    redis.setex(cacheKey, MAP_CACHE_TTL, JSON.stringify(response)).catch(() => {})

    // Log warning if geo coverage is low (< 10 signals in last 24h)
    if (safeHours <= 24 && !bbox && !category && geoCount < 10) {
      req.log?.warn({ map_geo_count: geoCount }, '[MAP HEALTH] Low geo signal count in last 24h — check scraper location enrichment')
    }

    return reply.send(response)
  })

  // ─── MAP HEALTH SUMMARY ───────────────────────────────────
  // Returns count of verified signals with geo in last 24h (for health monitoring)
  app.get('/map/health', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['signals'],
      summary: 'Map geo signal health',
      description: 'Returns count of geo-located verified signals in last 24h. Used by health monitoring.',
    },
  }, async (_req, reply) => {
    const cacheKey = 'signals:map:health:24h'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const [row] = await db('signals')
      .whereNotNull('location')
      .whereIn('status', ['verified', 'pending'])
      .where('created_at', '>', db.raw(`NOW() - INTERVAL '24 hours'`))
      .count('id as count')

    const mapSignalsWithGeo = Number((row as { count: string | number } | undefined)?.count ?? 0)
    const result = {
      map_signals_with_geo_24h: mapSignalsWithGeo,
      geo_coverage_status:     mapSignalsWithGeo >= 10 ? 'healthy' : mapSignalsWithGeo > 0 ? 'low' : 'empty',
      checked_at:              new Date().toISOString(),
    }

    redis.setex(cacheKey, 300, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── CORRELATED SIGNALS (Event Cluster) ──────────────────────
  app.get('/:id/correlated', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    // Look up cluster membership in Redis
    const clusterId = await redis.get(`correlation:signal:${id}`).catch(() => null)
    if (!clusterId) {
      return reply.send({ success: true, data: { cluster: null, signals: [] } })
    }

    const clusterRaw = await redis.get(`correlation:cluster:${clusterId}`).catch(() => null)
    if (!clusterRaw) {
      return reply.send({ success: true, data: { cluster: null, signals: [] } })
    }

    const cluster = JSON.parse(clusterRaw) as {
      cluster_id: string
      primary_signal_id: string
      signal_ids: string[]
      categories: string[]
      sources: string[]
      severity: string
      correlation_type: string
      correlation_score: number
      created_at: string
    }

    // Fetch the correlated signals (excluding the requested one)
    const otherIds = cluster.signal_ids.filter(sid => sid !== id)
    const signals = otherIds.length > 0
      ? await db('signals')
          .select('id', 'title', 'summary', 'category', 'severity',
                  'reliability_score', 'location_name', 'source_id', 'created_at')
          .whereIn('id', otherIds)
          .limit(20)
      : []

    return reply.send({
      success: true,
      data: {
        cluster: {
          id: cluster.cluster_id,
          primarySignalId: cluster.primary_signal_id,
          correlationType: cluster.correlation_type,
          correlationScore: cluster.correlation_score,
          categories: cluster.categories,
          sourceCount: cluster.sources.length,
          signalCount: cluster.signal_ids.length,
          createdAt: cluster.created_at,
        },
        signals: signals.map((s: Record<string, unknown>) => ({
          id: s.id,
          title: s.title,
          summary: s.summary,
          category: s.category,
          severity: s.severity,
          reliabilityScore: s.reliability_score,
          locationName: s.location_name,
          sourceId: s.source_id,
          createdAt: s.created_at ? (s.created_at as Date).toISOString() : null,
        })),
      },
    })
  })

  // ─── RECENT EVENT CLUSTERS ────────────────────────────────────
  app.get('/clusters/recent', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { limit = 20 } = req.query as { limit?: number }
    const safeLimit = Math.min(Math.max(1, Number(limit)), 50)

    const clusterIds = await redis.zrevrange('correlation:recent', 0, safeLimit - 1)
    if (clusterIds.length === 0) {
      return reply.send({ success: true, data: [] })
    }

    const pipeline = redis.pipeline()
    for (const cid of clusterIds) {
      pipeline.get(`correlation:cluster:${cid}`)
    }
    const results = await pipeline.exec()

    const clusters = (results ?? [])
      .map(([err, val]) => {
        if (err || !val) return null
        try { return JSON.parse(val as string) } catch { return null }
      })
      .filter(Boolean)
      .map((c: Record<string, unknown>) => ({
        cluster_id: c.cluster_id,
        primary_signal_id: c.primary_signal_id,
        signal_ids: c.signal_ids,
        correlation_type: c.correlation_type,
        correlation_score: c.correlation_score,
        categories: c.categories,
        sources: c.sources,
        source_count: (c.sources as string[])?.length ?? 0,
        signal_count: (c.signal_ids as string[])?.length ?? 0,
        severity: c.severity,
        created_at: c.created_at,
      }))

    return reply.send({ success: true, data: clusters })
  })

  // ─── VERIFICATION HISTORY ─────────────────────────────────────────────────
  // GET /api/v1/signals/:id/verifications
  // Returns paginated verification_log entries for a signal.
  app.get('/:id/verifications', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['signals'],
      summary: 'Get verification history for a signal',
      description: 'Returns paginated verification_log entries including verifier_type, verdict, score_delta, confidence, notes, and timestamps.',
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const qr = parseQuery(HistoryQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { page, limit } = qr.data

    const safeLimit = limit
    const offset    = (page - 1) * safeLimit

    try {
      const [items, countRows] = await Promise.all([
        db('verification_log')
          .where('signal_id', id)
          .orderBy('created_at', 'desc')
          .limit(safeLimit)
          .offset(offset)
          .select([
            'id', 'check_type', 'verifier_type', 'result',
            'verdict', 'confidence', 'score_delta', 'notes', 'created_at',
          ]),
        db('verification_log')
          .where('signal_id', id)
          .count('id as count'),
      ])
      const count = (countRows[0] as { count: string | number })?.count ?? 0

      return reply.send({
        success: true,
        data: {
          items: items.map((v: Record<string, unknown>) => ({
            id:           v.id,
            verifierType: v.verifier_type ?? v.check_type,
            checkType:    v.check_type,
            verdict:      v.verdict ?? null,
            result:       v.result,
            confidence:   v.confidence != null ? Number(v.confidence) : null,
            scoreDelta:   v.score_delta != null ? Number(v.score_delta) : null,
            notes:        v.notes ?? null,
            createdAt:    v.created_at ? (v.created_at as Date).toISOString() : null,
          })),
          total: Number(count),
          page:  Math.max(1, Number(page)),
          limit: safeLimit,
        },
      })
    } catch {
      // Table may not exist on fresh deploys — return empty gracefully
      return reply.send({
        success: true,
        data: { items: [], total: 0, page: 1, limit: safeLimit },
      })
    }
  })

  // ─── GEOGRAPHIC CONVERGENCE HOTSPOTS ──────────────────────────────────────
  // Detects 1°×1° geographic cells where 3+ distinct signal categories converge.
  // Directly mirrors World Monitor's "convergence alert" feature.
  // GET /api/v1/signals/map/hotspots?hours=24&min_categories=3&limit=20
  app.get('/map/hotspots', {
    schema: {
      tags: ['signals'],
      summary: 'Geographic convergence hotspots',
      description: 'Returns geographic cells (1°×1°) where multiple distinct signal categories have converged in the given time window. Cells with 3+ category types indicate multi-domain event escalation.',
      querystring: {
        type: 'object',
        properties: {
          hours:          { type: 'integer', minimum: 1, maximum: 168, default: 24 },
          min_categories: { type: 'integer', minimum: 2, maximum: 10,  default: 3  },
          limit:          { type: 'integer', minimum: 1, maximum: 50,  default: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const qr = parseQuery(HotspotsQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { hours, min_categories: minCat, limit } = qr.data

    const cacheKey = `signals:hotspots:${hours}:${minCat}:${limit}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      try { return reply.send(JSON.parse(cached)) } catch { /* fallthrough */ }
    }

    // Use validated integers — safe for template literal interpolation
    const result = await db.raw<{ rows: Array<Record<string, unknown>> }>(`
      SELECT
        ROUND(ST_Y(location::geometry)::numeric, 0)::integer  AS cell_lat,
        ROUND(ST_X(location::geometry)::numeric, 0)::integer  AS cell_lng,
        COUNT(*)::integer                                      AS signal_count,
        COUNT(DISTINCT category)::integer                      AS category_count,
        ARRAY_AGG(DISTINCT category)                           AS categories,
        MAX(severity)                                          AS max_severity,
        ROUND(AVG(reliability_score)::numeric, 3)              AS avg_reliability,
        MAX(created_at)                                        AS latest_signal_at,
        MIN(ROUND(ST_Y(location::geometry)::numeric, 4))       AS center_lat,
        MIN(ROUND(ST_X(location::geometry)::numeric, 4))       AS center_lng,
        (ARRAY_AGG(title ORDER BY created_at DESC))[1:3]       AS sample_titles,
        (ARRAY_AGG(id    ORDER BY created_at DESC))[1:3]       AS sample_ids
      FROM signals
      WHERE location IS NOT NULL
        AND created_at > NOW() - INTERVAL '${hours} hours'
        AND status IN ('verified', 'pending')
      GROUP BY cell_lat, cell_lng
      HAVING COUNT(DISTINCT category) >= ${minCat}
      ORDER BY COUNT(DISTINCT category) DESC, COUNT(*) DESC
      LIMIT ${limit}
    `)

    const hotspots = result.rows.map(r => ({
      cellLat:         r.cell_lat,
      cellLng:         r.cell_lng,
      centerLat:       parseFloat(String(r.center_lat ?? r.cell_lat)),
      centerLng:       parseFloat(String(r.center_lng ?? r.cell_lng)),
      signalCount:     Number(r.signal_count),
      categoryCount:   Number(r.category_count),
      categories:      r.categories as string[],
      maxSeverity:     r.max_severity as string,
      avgReliability:  parseFloat(String(r.avg_reliability ?? '0')),
      latestSignalAt:  r.latest_signal_at ? (r.latest_signal_at as Date).toISOString() : null,
      sampleTitles:    (r.sample_titles as string[] | null) ?? [],
      sampleIds:       (r.sample_ids   as string[] | null) ?? [],
    }))

    const payload = { success: true, data: { hotspots, hours, minCategoryCount: minCat, generatedAt: new Date().toISOString() } }
    redis.setex(cacheKey, 120, JSON.stringify(payload)).catch(() => {})
    return reply.send(payload)
  })

  // ─── ADS-B AVIATION SIGNALS MAP ──────────────────────────────────────────────
  // GET /api/v1/signals/map/adsb
  // Returns aviation-category signals from the last 4 hours for the live flight overlay.
  // Cached in Redis for 60 s to allow frequent client polling.
  app.get('/map/adsb', {
    schema: {
      tags: ['signals'],
      summary: 'ADS-B aviation signals for map overlay',
      description: 'Returns aviation signals from the last 4 hours with geographic coordinates for the ADS-B flight path map layer.',
    },
  }, async (_req, reply) => {
    const cacheKey = 'signals:map:adsb'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      try { return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached)) } catch { /* fallthrough */ }
    }

    const result = await db.raw<{ rows: Array<Record<string, unknown>> }>(`
      SELECT id, title, created_at AS published_at, reliability_score,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
      FROM signals
      WHERE category = 'aviation'
        AND location IS NOT NULL
        AND created_at > NOW() - INTERVAL '168 hours'
      ORDER BY created_at DESC
      LIMIT 300
    `)

    const data = result.rows.map(r => ({
      id:                String(r.id),
      title:             String(r.title ?? ''),
      lat:               parseFloat(String(r.lat)),
      lng:               parseFloat(String(r.lng)),
      reliability_score: parseFloat(String(r.reliability_score ?? 0)),
      published_at:      r.published_at ? (r.published_at as Date).toISOString() : null,
    }))

    const payload = { success: true, data }
    redis.setex(cacheKey, 60, JSON.stringify(payload)).catch(() => {})
    return reply.send(payload)
  })

  // ─── MARITIME AIS SIGNALS MAP ─────────────────────────────────────────────────
  // GET /api/v1/signals/map/maritime
  //
  // Returns maritime-category signals from the last 4 hours as a GeoJSON
  // FeatureCollection for the civilian AIS ship-tracking map overlay.
  // Signals are filtered to those with a valid location (non-null, non-zero coords).
  // Results are Redis-cached for 120 s (matches client poll interval).
  app.get('/map/maritime', {
    schema: {
      tags: ['signals'],
      summary: 'Maritime AIS signals for map overlay (GeoJSON)',
      description: 'Returns maritime signals from the last 4 hours as a GeoJSON FeatureCollection for the civilian AIS ship-tracking layer.',
    },
  }, async (_req, reply) => {
    const cacheKey = 'signals:map:maritime'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      try { return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached)) } catch { /* fallthrough */ }
    }

    const result = await db.raw<{ rows: Array<Record<string, unknown>> }>(`
      SELECT id, title, reliability_score, severity,
        created_at AS published_at,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
      FROM signals
      WHERE category = 'maritime'
        AND location IS NOT NULL
        AND ST_Y(location::geometry) != 0
        AND ST_X(location::geometry) != 0
        AND created_at > NOW() - INTERVAL '168 hours'
      ORDER BY created_at DESC
      LIMIT 500
    `)

    const features = result.rows
      .filter(r => r.lat != null && r.lng != null)
      .map(r => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [parseFloat(String(r.lng)), parseFloat(String(r.lat))],
        },
        properties: {
          id:                String(r.id),
          title:             String(r.title ?? ''),
          severity:          String(r.severity ?? 'low'),
          reliability_score: parseFloat(String(r.reliability_score ?? 0)),
          published_at:      r.published_at
            ? (r.published_at as Date).toISOString()
            : null,
        },
      }))

    const payload = {
      type: 'FeatureCollection' as const,
      features,
    }

    redis.setex(cacheKey, 120, JSON.stringify(payload)).catch(() => {})
    return reply.send(payload)
  })

  // ─── CONFLICT ZONE SIGNALS MAP ───────────────────────────────────────────────
  // GET /api/v1/signals/map/conflict-zones
  //
  // Returns conflict/military/security-category signals from the last 72 hours
  // as a GeoJSON FeatureCollection for the conflict zone map overlay.
  // Signals are filtered to those with valid coordinates (non-null, non-zero).
  // Results are Redis-cached for 90 s.
  app.get('/map/conflict-zones', {
    schema: {
      tags: ['signals'],
      summary: 'Conflict zone signals for map overlay (GeoJSON)',
      description: 'Returns conflict, military, and security signals from the last 72 hours as a GeoJSON FeatureCollection for the conflict zone map layer.',
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const cacheKey = 'signals:map:conflict-zones'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      try { return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached)) } catch { /* fallthrough */ }
    }

    const result = await db.raw<{ rows: Array<Record<string, unknown>> }>(`
      SELECT id, title, severity, category, reliability_score, location_name,
        created_at AS published_at,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
      FROM signals
      WHERE category IN ('conflict', 'military', 'security')
        AND location IS NOT NULL
        AND ST_Y(location::geometry) IS NOT NULL
        AND ST_X(location::geometry) IS NOT NULL
        AND ST_Y(location::geometry) != 0
        AND ST_X(location::geometry) != 0
        AND created_at > NOW() - INTERVAL '168 hours'
      ORDER BY created_at DESC
      LIMIT 300
    `)

    const features = result.rows.map(r => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [parseFloat(String(r.lng)), parseFloat(String(r.lat))],
      },
      properties: {
        id:                String(r.id),
        title:             String(r.title ?? ''),
        severity:          String(r.severity ?? 'low'),
        category:          String(r.category ?? 'conflict'),
        reliability_score: parseFloat(String(r.reliability_score ?? 0)),
        source_name:       r.location_name ? String(r.location_name) : null,
        published_at:      r.published_at
          ? (r.published_at as Date).toISOString()
          : null,
      },
    }))

    const payload = {
      type: 'FeatureCollection' as const,
      features,
    }

    redis.setex(cacheKey, 90, JSON.stringify(payload)).catch(() => {})
    return reply.send(payload)
  })

  // ─── GDELT TV CLIPS ───────────────────────────────────────────────────────────
  // GET /api/v1/signals/:id/tv-clips
  //
  // Surfaces relevant TV news clips from the GDELT TV News API for the given
  // signal. Keywords are extracted from the signal title (stop words stripped),
  // then used to query GDELT. Results are cached in Redis for 30 min.
  //
  // - Recent signals (≤7d):  uses timespan=7d
  // - Older signals:         uses startdatetime/enddatetime bracketing the event
  // - Error/timeout:         returns empty clips array — never fails the request
  app.get('/:id/tv-clips', {
    config: { rateLimit: { max: TV_CLIPS_RATE_LIMIT, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    // ── Redis cache ──────────────────────────────────────────────────────────
    const cacheKey = `tv-clips:${id}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      try { return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached)) } catch { /* fallthrough */ }
    }

    // ── Fetch signal ─────────────────────────────────────────────────────────
    const signal = await db('signals')
      .where('id', id)
      .first('id', 'title', 'summary', 'created_at')
      .catch(() => null)

    if (!signal) {
      return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')
    }

    // ── Build GDELT query ────────────────────────────────────────────────────
    const keywords = extractTVKeywords(signal.title as string)
    const query    = keywords.join(' AND ')
    const encodedQ = encodeURIComponent(query)

    const publishedAt = new Date((signal.created_at as Date | string))
    const ageMs       = Date.now() - publishedAt.getTime()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

    let gdeltUrl: string
    if (ageMs <= sevenDaysMs) {
      gdeltUrl = `https://api.gdeltproject.org/api/v2/tv/tv?query=${encodedQ}&mode=clipgallery&format=json&maxrecords=6&timespan=7d`
    } else {
      const start = new Date(publishedAt.getTime() - 24 * 60 * 60 * 1000)
      const end   = new Date(publishedAt.getTime() + 3 * 24 * 60 * 60 * 1000)
      gdeltUrl = `https://api.gdeltproject.org/api/v2/tv/tv?query=${encodedQ}&mode=clipgallery&format=json&maxrecords=6&startdatetime=${formatGdeltDate(start)}&enddatetime=${formatGdeltDate(end)}`
    }

    // ── Fetch from GDELT (5s timeout, never throw) ───────────────────────────
    let clips: TVClip[] = []
    try {
      const res = await fetch(gdeltUrl, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const json = await res.json() as GdeltTVResponse
        clips = (json.clips ?? []).map((item, idx): TVClip => ({
          id:          item.url ? String(idx) + '_' + item.url.slice(-12).replace(/\W/g, '') : String(idx),
          station:     item.station ?? '',
          showName:    item.show ?? '',
          showDate:    item.date_time ?? '',
          previewUrl:  item.preview_url ?? '',
          clipUrl:     item.embed_url ?? item.url ?? '',
          durationSecs: null,
        }))
      }
    } catch {
      // Timeout, network error, parse error — return empty clips
      clips = []
    }

    const response = {
      success: true,
      data: { clips, query, total: clips.length },
    }

    redis.setex(cacheKey, TV_CLIPS_CACHE_TTL, JSON.stringify(response)).catch(() => {})

    return reply.send(response)
  })

  // ─── GDELT NEWS IMAGES ────────────────────────────────────────────────────
  // GET /api/v1/signals/:id/news-images
  //
  // Surfaces related visual news imagery from the GDELT DOC API for the given
  // signal. Keywords are extracted from the signal title (stop words stripped),
  // then used to query GDELT artlist mode which returns Open Graph images from
  // news articles covering the same topic.
  //
  // - Error/timeout: returns empty images array — never fails the request
  // - Redis cache:   'news-images:{signalId}', TTL 3600s (1 hour)
  app.get('/:id/news-images', {
    config: { rateLimit: { max: NEWS_IMAGES_RATE_LIMIT, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    // ── Redis cache ──────────────────────────────────────────────────────────
    const cacheKey = `news-images:${id}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      try { return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached)) } catch { /* fallthrough */ }
    }

    // ── Fetch signal ─────────────────────────────────────────────────────────
    const signal = await db('signals')
      .where('id', id)
      .first('id', 'title', 'created_at')
      .catch(() => null)

    if (!signal) {
      return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')
    }

    // ── Build GDELT DOC API query ─────────────────────────────────────────────
    const keywords = extractTVKeywords(signal.title as string)
    const query    = keywords.join(' ')
    const encodedQ = encodeURIComponent(query)

    // Use timespan based on signal age — recent signals get 7d window
    const publishedAt  = new Date((signal.created_at as Date | string))
    const ageMs        = Date.now() - publishedAt.getTime()
    const sevenDaysMs  = 7 * 24 * 60 * 60 * 1000
    const timespan     = ageMs <= sevenDaysMs ? '7d' : '30d'

    const gdeltUrl = (
      `https://api.gdeltproject.org/api/v2/doc/doc` +
      `?query=${encodedQ}&mode=artlist&format=json&maxrecords=6` +
      `&timespan=${timespan}&SOURCELANG:eng`
    )

    // ── Fetch from GDELT DOC (5s timeout, never throw) ───────────────────────
    let images: NewsImage[] = []
    try {
      const res = await fetch(gdeltUrl, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const json = await res.json() as GdeltDocResponse
        images = (json.articles ?? [])
          .filter((item): item is GdeltDocArticle => !!(item.socialimage))
          .map((item, idx): NewsImage => ({
            id:           `ni_${idx}_${(item.url ?? '').slice(-10).replace(/\W/g, '')}`,
            imageUrl:     item.socialimage ?? '',
            caption:      item.title ?? null,
            sourceUrl:    item.url ?? null,
            sourceDomain: item.domain ?? null,
            date:         item.seendate ?? null,
          }))
      }
    } catch {
      // Timeout, network error, parse error — return empty images
      images = []
    }

    const response = {
      success: true,
      data: { images, query, total: images.length },
    }

    redis.setex(cacheKey, NEWS_IMAGES_CACHE_TTL, JSON.stringify(response)).catch(() => {})

    return reply.send(response)
  })

  // ─── SIMILAR SIGNALS (Pinecone semantic) ─────────────────────────────────
  // GET /api/v1/signals/:id/similar?limit=5
  //
  // Fetches the signal's title+summary, generates an embedding, and queries
  // Pinecone for the topK most similar vectors. Falls back gracefully when
  // Pinecone or OpenAI is not configured.
  app.get('/:id/similar', {
    preHandler: [optionalAuth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['signals'],
      summary: 'Get semantically similar signals',
      description: 'Uses Pinecone vector search to find signals semantically similar to the given signal.',
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { limit = 5 } = req.query as { limit?: number }
    const safeLimit = Math.min(20, Math.max(1, Number(limit)))

    if (!isPineconeEnabled()) {
      return reply.send({ success: true, similar: [], count: 0 })
    }

    // Fetch the signal to build the embedding text
    const signal = await db('signals')
      .select('id', 'title', 'summary', 'category')
      .where('id', id)
      .first()
      .catch(() => null)

    if (!signal) {
      return sendError(reply, 404, 'NOT_FOUND', 'Signal not found')
    }

    const text = [signal.title, signal.summary].filter(Boolean).join('. ')
    const embedding = await generateEmbedding(text)
    if (!embedding) {
      return reply.send({ success: true, similar: [], count: 0 })
    }

    // Query Pinecone — topK + 1 so we can exclude the source signal itself
    const matches = await querySimilar(embedding, safeLimit + 1)
    const filtered = matches.filter(m => String(m.id) !== String(id)).slice(0, safeLimit)

    if (filtered.length === 0) {
      return reply.send({ success: true, similar: [], count: 0 })
    }

    const ids = filtered.map(m => m.id)
    const signals = await db('signals')
      .select(
        'id', 'title', 'summary', 'category', 'severity', 'status',
        'reliability_score', 'location_name', 'country_code', 'tags',
        'created_at', 'alert_tier',
      )
      .whereIn('id', ids)
      .catch(() => [] as Record<string, unknown>[])

    const scoreMap = new Map(filtered.map(m => [String(m.id), m.score]))
    const sorted = (signals as Record<string, unknown>[])
      .slice()
      .sort((a, b) => (scoreMap.get(String(b.id)) ?? 0) - (scoreMap.get(String(a.id)) ?? 0))

    return reply.send({
      success: true,
      similar: sorted.map(s => ({
        id:               s.id,
        title:            s.title,
        summary:          s.summary,
        category:         s.category,
        severity:         s.severity,
        status:           s.status,
        reliabilityScore: s.reliability_score,
        locationName:     s.location_name,
        countryCode:      s.country_code,
        tags:             s.tags ?? [],
        createdAt:        s.created_at ? (s.created_at as Date).toISOString() : null,
        alertTier:        s.alert_tier,
        score:            scoreMap.get(String(s.id)) ?? 0,
      })),
      count: sorted.length,
    })
  })
}

// ─── GDELT TV CLIPS — exported types + helpers (testable) ────────────────────

export const TV_CLIPS_CACHE_TTL  = 1800 // 30 minutes
export const TV_CLIPS_RATE_LIMIT = 30   // req / min

// ─── GDELT NEWS IMAGES — exported types + constants (testable) ───────────────

export const NEWS_IMAGES_CACHE_TTL  = 3600 // 1 hour
export const NEWS_IMAGES_RATE_LIMIT = 30   // req / min

export interface NewsImage {
  id:           string
  imageUrl:     string
  caption:      string | null
  sourceUrl:    string | null
  sourceDomain: string | null
  date:         string | null
}

interface GdeltDocArticle {
  url:          string
  title:        string
  seendate:     string
  socialimage:  string
  domain:       string
  language:     string
  sourcecountry: string
}

interface GdeltDocResponse {
  articles?: GdeltDocArticle[]
  status?:   string
}

export interface TVClip {
  id:          string
  station:     string
  showName:    string
  showDate:    string
  previewUrl:  string
  clipUrl:     string
  durationSecs: number | null
}

interface GdeltTVItem {
  url:         string
  station:     string
  show:        string
  date_time:   string
  preview_url: string
  embed_url:   string
}

interface GdeltTVResponse {
  clips?: GdeltTVItem[]
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'of', 'for',
  'to', 'by', 'with', 'from', 'and', 'or', 'is', 'are',
])

/** Extract up to 3 meaningful keywords from a signal title. */
export function extractTVKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 3)
}

/** Format a Date as GDELT datetime string: YYYYMMDDHHMMSS */
export function formatGdeltDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  )
}

export function formatSignal(row: Record<string, unknown>) {
  const geo = row.location_geojson as { coordinates?: [number, number] } | null

  const riskScore = computeRiskScore({
    severity:         (row.severity as string) ?? 'low',
    reliabilityScore: (row.reliability_score as number) ?? 0,
    sourceCount:      (row.sources_data as unknown[] | null)?.length ?? (row.source_count as number) ?? 1,
    hasLocation:      !!geo?.coordinates,
    category:         (row.category as string) ?? 'general',
    publishedAt:      new Date((row.created_at as Date | string | undefined) ?? Date.now()),
    countryCode:      (row.country_code as string) ?? undefined,
  })

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
    verifiedAt:           row.verified_at ? (row.verified_at as Date).toISOString() : null,
    lastUpdated:          row.last_updated ? (row.last_updated as Date).toISOString() : null,
    lastCorroboratedAt:   row.last_corroborated_at ? (row.last_corroborated_at as Date).toISOString() : null,
    createdAt:            row.created_at ? (row.created_at as Date).toISOString() : null,
    isBreaking:         row.is_breaking ?? false,
    communityFlagCount: row.community_flag_count ?? 0,
    sources:            row.sources_data ?? [],
    riskScore,
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
