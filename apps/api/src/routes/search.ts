import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { meili, setupSearchIndexes, indexSignal, indexPost } from '../lib/search'
import { logSearchQuery } from '../lib/search-analytics'
import { searchEntities } from '../lib/opensanctions'
import { sanitizeString } from '../utils/sanitize'
import { recordSearchLatency, maybeLogPercentiles } from '../lib/search-latency'
import { generateEmbedding, querySimilar, isPineconeEnabled } from '../lib/pinecone'
import { sendError } from '../lib/errors'

/** Wrap a Meilisearch promise with a 150ms timeout.
 *  Resolves with { result, partial: false } on success,
 *  or { result: null, partial: true } on timeout. */
async function withMeiliTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 150,
): Promise<{ result: T | null; partial: boolean }> {
  return Promise.race([
    promise.then(result => ({ result, partial: false as const })),
    new Promise<{ result: null; partial: true }>(resolve =>
      setTimeout(() => resolve({ result: null, partial: true }), timeoutMs),
    ),
  ])
}

// ─── Query param schemas ──────────────────────────────────────────────────────

export const SearchQuerySchema = z.object({
  q:           z.string().trim().min(2, 'Query must be at least 2 characters').max(500),
  type:        z.enum(['all', 'signals', 'posts', 'users', 'tags']).default('all'),
  limit:       z.coerce.number().int().min(1).max(50).default(20),
  page:        z.coerce.number().int().min(0).default(0),
  category:    z.string().trim().max(200).optional(),
  severity:    z.string().trim().max(100).optional(),
  country:     z.string().trim().max(2).toUpperCase().optional(),
  from:        z.string().trim().max(30).optional(),
  to:          z.string().trim().max(30).optional(),
  source:      z.string().trim().max(200).optional(),
  language:    z.string().trim().max(10).optional(),
  sort:        z.enum(['newest', 'oldest', 'discussed', 'boosted']).default('newest'),
  reliability: z.coerce.number().min(0).max(100).optional(),
  tier:        z.enum(['FLASH', 'PRIORITY', 'ROUTINE']).optional(),
})

export const EntityQuerySchema = z.object({
  q:      z.string().trim().min(2, 'Query must be at least 2 characters').max(200),
  schema: z.string().trim().max(50).optional(),
  limit:  z.coerce.number().int().min(1).max(20).default(10),
})

export const AutocompleteQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
})

const SEARCH_CACHE_TTL = 60 // seconds — cache search results per unique query+filters

export { setupSearchIndexes, indexSignal, indexPost }

// ─── ROUTES ──────────────────────────────────────────────────────────────
export const registerSearchRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['search']
  })

  // ─── UNIFIED SEARCH ──────────────────────────────────────
  app.get('/', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const reqStart = Date.now()
    const parsed = SearchQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid query parameters')
    }

    const {
      q: rawQ, type, limit, page,
      category, severity, country,
      from, to, source, language,
      sort, reliability, tier,
    } = parsed.data

    const q = sanitizeString(rawQ)

    const pageLimit  = limit
    const pageOffset = page * pageLimit

    // Cache-aside: stable key derived from all query parameters
    const cacheKey = `search:${q}:${type}:${page}:${pageLimit}:${category ?? ''}:${severity ?? ''}:${country ?? ''}:${from ?? ''}:${to ?? ''}:${source ?? ''}:${language ?? ''}:${sort}:${reliability ?? ''}:${tier ?? ''}`
    const cachedResult = await redis.get(cacheKey).catch(() => null)
    if (cachedResult) {
      const cacheLatency = Date.now() - reqStart
      recordSearchLatency(cacheLatency)
      void maybeLogPercentiles(req.log as Parameters<typeof maybeLogPercentiles>[0])
      return reply
        .header('X-Cache-Hit', 'true')
        .header('X-Search-Latency-Ms', String(cacheLatency))
        .send(JSON.parse(cachedResult))
    }

    const results: Record<string, unknown[]> = {}
    const facets: Record<string, unknown> = {}
    let partialResults = false

    // Build Meilisearch sort expression from sort param
    const signalSort = (() => {
      switch (sort) {
        case 'oldest':    return ['createdAt:asc']
        case 'discussed': return ['postCount:desc']
        case 'newest':
        default:          return ['createdAt:desc']
      }
    })()

    const postSort = (() => {
      switch (sort) {
        case 'oldest':    return ['createdAt:asc']
        case 'discussed': return ['replyCount:desc']
        case 'boosted':   return ['boostCount:desc']
        case 'newest':
        default:          return ['createdAt:desc']
      }
    })()

    const searchPromises: Promise<void>[] = []

    // ── Signals ──────────────────────────────────────────────
    if (type === 'all' || type === 'signals') {
      const filters: string[] = ['status = "verified"']

      if (category) {
        const cats = category.split(',').map(c => c.trim()).filter(Boolean)
        if (cats.length === 1)      filters.push(`category = "${cats[0]}"`)
        else if (cats.length > 1)   filters.push(`(${cats.map(c => `category = "${c}"`).join(' OR ')})`)
      }

      if (severity) {
        const sevs = severity.split(',').map(s => s.trim()).filter(Boolean)
        if (sevs.length === 1)     filters.push(`severity = "${sevs[0]}"`)
        else if (sevs.length > 1)  filters.push(`(${sevs.map(s => `severity = "${s}"`).join(' OR ')})`)
      }

      if (country)     filters.push(`countryCode = "${country.toUpperCase()}"`)
      if (language)    filters.push(`language = "${language}"`)

      if (from) {
        const ts = Math.floor(new Date(from).getTime() / 1000)
        if (!isNaN(ts)) filters.push(`createdAt >= ${ts}`)
      }
      if (to) {
        const ts = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000)
        if (!isNaN(ts)) filters.push(`createdAt <= ${ts}`)
      }

      // Reliability: 0–100 input → 0.0–1.0 Meilisearch value
      if (reliability !== undefined) {
        const minRel = Math.min(1, Math.max(0, Number(reliability) / 100))
        filters.push(`reliabilityScore >= ${minRel}`)
      }

      if (tier) filters.push(`alertTier = "${tier}"`)

      // Helper: Postgres FTS fallback when Meilisearch times out
      const signalsFtsFallback = (): Promise<void> =>
        db('signals')
          .whereRaw(
            `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'')) @@ plainto_tsquery('english', ?)`,
            [q],
          )
          .where('status', 'verified')
          .modify(qb => {
            if (category) {
              const cats = category.split(',').map(c => c.trim()).filter(Boolean)
              qb.whereIn('category', cats)
            }
            if (severity) {
              const sevs = severity.split(',').map(s => s.trim()).filter(Boolean)
              qb.whereIn('severity', sevs)
            }
            if (country)  qb.where('country_code', country.toUpperCase())
            if (language) qb.where('language', language)
            if (from)     qb.where('created_at', '>=', new Date(from))
            if (to)       qb.where('created_at', '<=', new Date(to + 'T23:59:59Z'))
            if (reliability !== undefined) {
              qb.where('reliability_score', '>=', Number(reliability) / 100)
            }
          })
          .select([
            'id', 'title', 'summary', 'category', 'severity', 'status',
            'reliability_score as reliabilityScore',
            'location_name as locationName',
            'country_code as countryCode',
            'tags', 'language',
            'view_count as viewCount',
            'created_at as createdAt',
          ])
          .orderBy(
            sort === 'oldest' ? 'created_at' : sort === 'discussed' ? 'post_count' : 'created_at',
            sort === 'oldest' ? 'asc' : 'desc',
          )
          .limit(type === 'all' ? 5 : pageLimit)
          .offset(type === 'all' ? 0 : pageOffset)
          .then(rows => { results.signals = rows })
          .catch(() => { results.signals = [] })

      searchPromises.push(
        withMeiliTimeout(
          meili.index('signals').search(q, {
            limit:  type === 'all' ? 5 : pageLimit,
            offset: type === 'all' ? 0 : pageOffset,
            filter: filters.join(' AND '),
            sort:   signalSort,
            facets: type !== 'all' ? ['category', 'severity'] : undefined,
          }),
        ).then(({ result: r, partial }) => {
          if (partial || r === null) {
            // Meilisearch timed out — use Postgres FTS fallback
            partialResults = true
            return signalsFtsFallback()
          }
          // Meilisearch succeeded
          results.signals = r.hits
          if (r.facetDistribution) {
            facets.category = r.facetDistribution['category'] ?? {}
            facets.severity = r.facetDistribution['severity'] ?? {}
          }
        }).catch(() => signalsFtsFallback()),
      )
    }

    // ── Posts ─────────────────────────────────────────────────
    if (type === 'all' || type === 'posts') {
      const postFilters: string[] = []
      if (language) postFilters.push(`language = "${language}"`)
      if (source)   postFilters.push(`sourceName = "${source}"`)

      searchPromises.push(
        meili.index('posts')
          .search(q, {
            limit:  type === 'all' ? 5 : pageLimit,
            offset: type === 'all' ? 0 : pageOffset,
            filter: postFilters.length > 0 ? postFilters.join(' AND ') : undefined,
            sort:   postSort,
          })
          .then(r => { results.posts = r.hits })
          .catch(() => { results.posts = [] })
      )
    }

    // ── Users ─────────────────────────────────────────────────
    if (type === 'all' || type === 'users') {
      searchPromises.push(
        meili.index('users')
          .search(q, {
            limit:  type === 'all' ? 3 : pageLimit,
            offset: type === 'all' ? 0 : pageOffset,
            sort:   ['followerCount:desc'],
          })
          .then(r => { results.users = r.hits })
          .catch(() => { results.users = [] })
      )
    }

    // ── Tags ──────────────────────────────────────────────────
    // Simplified: look up tags that contain the query term exactly, ranked by
    // how many signals carry each tag.  Uses idx_signals_tags (GIN array index)
    // on the ANY() predicate — far cheaper than the previous nested unnest+FTS.
    if (type === 'all' || type === 'tags') {
      searchPromises.push(
        db.raw<{ rows: { tag: string; count: string }[] }>(`
          SELECT unnest(tags) AS tag, COUNT(*) AS count
          FROM signals
          WHERE ? = ANY(tags)
          GROUP BY tag
          ORDER BY count DESC
          LIMIT ?
        `, [q.toLowerCase(), type === 'all' ? 5 : pageLimit])
          .then(r => { results.tags = r.rows })
          .catch(() => { results.tags = [] })
      )
    }

    await Promise.allSettled(searchPromises)

    const totalResults = Object.values(results).reduce((s, a) => s + a.length, 0)

    // ── Analytics (fire-and-forget) ───────────────────────────
    logSearchQuery({
      query:       q,
      searchType:  type,
      resultCount: totalResults,
      zeroResults: totalResults === 0,
    })

    const searchLatencyMs = Date.now() - reqStart

    // Record latency and periodically log percentiles
    recordSearchLatency(searchLatencyMs)
    void maybeLogPercentiles(req.log as Parameters<typeof maybeLogPercentiles>[0])

    const responseBody = {
      success: true,
      data: {
        query:   q,
        type,
        page:    Number(page),
        limit:   pageLimit,
        filters: { category, severity, country, from, to, source, language, sort, reliability, tier },
        results,
        facets,
        total:   totalResults,
        // Gate 3: surface partial flag when Meilisearch timed out and FTS was used
        ...(partialResults ? { partial: true, partial_reason: 'meilisearch_timeout' } : {}),
      },
    }

    // Cache the assembled response — skip caching partial/zero-result pages to
    // avoid polluting Redis with transient degraded states.
    if (totalResults > 0 && !partialResults) {
      redis.setex(cacheKey, SEARCH_CACHE_TTL, JSON.stringify(responseBody)).catch(() => {})
    }

    return reply
      .header('X-Search-Latency-Ms', String(searchLatencyMs))
      .send(responseBody)
  })

  // ─── ENTITY / SANCTIONS SEARCH ───────────────────────────
  /**
   * GET /api/v1/search/entities?q=&schema=&limit=
   *
   * Searches 100+ global sanctions lists via OpenSanctions:
   *   OFAC SDN, EU FSF, UN Security Council, UK HMT, Interpol Red Notices,
   *   World Bank Debarment, FBI Most Wanted, and 90+ more.
   *
   * Schema filter values: Person | Company | Organization | Vessel | Aircraft
   * Rate-limited: 20 req/min per IP.
   */
  app.get('/entities', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags:        ['search'],
      summary:     'Search sanctioned entities across 100+ global sanctions lists',
      querystring: {
        type: 'object',
        properties: {
          q:      { type: 'string',  description: 'Search query (name, alias, identifier)' },
          schema: { type: 'string',  description: 'Entity type: Person | Company | Organization | Vessel | Aircraft' },
          limit:  { type: 'integer', description: 'Max results (1–20, default 10)' },
        },
        required: ['q'],
      },
    },
  }, async (req, reply) => {
    const parsed = EntityQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid query parameters')
    }

    const { q: rawQ, schema, limit } = parsed.data
    const q = sanitizeString(rawQ)

    try {
      const { entities, total } = await searchEntities(q, limit, schema)

      return reply.send({
        success: true,
        data: {
          query:    q,
          schema:   schema ?? null,
          limit,
          total,
          entities,
          source:   'opensanctions',
          datasets: 'default',
          note:     'Results from OpenSanctions — 100+ global sanctions and watchlists',
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      req.log.error({ err, q }, 'OpenSanctions entity search failed')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', `Sanctions database temporarily unavailable: ${msg}`)
    }
  })

  // ─── AUTOCOMPLETE ─────────────────────────────────────────
  app.get('/autocomplete', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = AutocompleteQuerySchema.safeParse(req.query)
    if (!parsed.success) return reply.send({ success: true, data: [] })
    const q = sanitizeString(parsed.data.q, 200)
    if (q.length < 1) return reply.send({ success: true, data: [] })

    const [signals, users, tags] = await Promise.allSettled([
      meili.index('signals').search(q, {
        limit: 3,
        attributesToRetrieve: ['id', 'title', 'category'],
      }),
      meili.index('users').search(q, {
        limit: 3,
        attributesToRetrieve: ['id', 'handle', 'displayName', 'avatarUrl', 'verified'],
      }),
      db.raw<{ rows: { tag: string }[] }>(
        `SELECT DISTINCT unnest(tags) as tag FROM signals WHERE array_to_string(tags, ' ') ILIKE ? LIMIT 5`,
        [`%${q}%`],
      ),
    ])

    return reply.send({
      success: true,
      data: {
        signals: signals.status === 'fulfilled' ? signals.value.hits : [],
        users:   users.status   === 'fulfilled' ? users.value.hits   : [],
        tags:    tags.status    === 'fulfilled'
          ? tags.value.rows.map(r => r.tag)
          : [],
      },
    })
  })

  // ─── SEMANTIC SEARCH ─────────────────────────────────────────────────────
  // GET /api/v1/search/semantic?q=...&limit=10&category=...
  //
  // Generates an OpenAI embedding for q, queries Pinecone for similar signal
  // vectors, then fetches matching signal rows from PostgreSQL.
  // Falls back gracefully when Pinecone is not configured.
  app.get('/semantic', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({
      q:        z.string().trim().min(2, 'Query must be at least 2 characters').max(500),
      limit:    z.coerce.number().int().min(1).max(50).default(10),
      category: z.string().trim().max(200).optional(),
    }).safeParse(req.query)

    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid query parameters')
    }

    const { q: rawQ, limit, category } = parsed.data
    const q = sanitizeString(rawQ)

    if (!isPineconeEnabled()) {
      return reply.send({
        success:  true,
        results:  [],
        semantic: false,
        partial:  false,
        message:  'Semantic search not configured',
      })
    }

    const embedding = await generateEmbedding(q)
    if (!embedding) {
      return reply.send({
        success:  true,
        results:  [],
        semantic: false,
        partial:  true,
        message:  'Embedding generation unavailable',
      })
    }

    const matches = await querySimilar(embedding, limit, category ? { category } : undefined)
    if (matches.length === 0) {
      return reply.send({ success: true, results: [], semantic: true, partial: false })
    }

    const ids = matches.map(m => m.id)
    const signals = await db('signals')
      .select(
        'id', 'title', 'summary', 'category', 'severity', 'status',
        'reliability_score', 'location_name', 'country_code', 'tags',
        'created_at', 'alert_tier',
      )
      .whereIn('id', ids)
      .catch(() => [] as Record<string, unknown>[])

    // Re-order by Pinecone score
    const scoreMap = new Map(matches.map(m => [String(m.id), m.score]))
    const sorted = (signals as Record<string, unknown>[])
      .slice()
      .sort((a, b) => (scoreMap.get(String(b.id)) ?? 0) - (scoreMap.get(String(a.id)) ?? 0))

    return reply.send({
      success:  true,
      results:  sorted.map(s => ({
        id:              s.id,
        title:           s.title,
        summary:         s.summary,
        category:        s.category,
        severity:        s.severity,
        status:          s.status,
        reliabilityScore: s.reliability_score,
        locationName:    s.location_name,
        countryCode:     s.country_code,
        tags:            s.tags ?? [],
        createdAt:       s.created_at ? (s.created_at as Date).toISOString() : null,
        alertTier:       s.alert_tier,
        score:           scoreMap.get(String(s.id)) ?? 0,
      })),
      semantic: true,
      partial:  false,
    })
  })
}
