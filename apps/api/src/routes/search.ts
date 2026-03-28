import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { meili, setupSearchIndexes, indexSignal, indexPost } from '../lib/search'
import { logSearchQuery } from '../lib/search-analytics'
import { searchEntities } from '../lib/opensanctions'

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
    const {
      q, type = 'all',
      limit = 20, page = 0,
      category, severity, country,
      from, to, source, language,
      sort = 'newest',
      reliability,   // minimum reliabilityScore (0–100, mapped to 0.0–1.0)
    } = req.query as {
      q?:           string
      type?:        'all' | 'signals' | 'posts' | 'users' | 'tags'
      limit?:       number
      page?:        number
      category?:    string   // comma-separated
      severity?:    string   // comma-separated
      country?:     string
      from?:        string   // ISO date string
      to?:          string   // ISO date string
      source?:      string
      language?:    string
      sort?:        'newest' | 'oldest' | 'discussed' | 'boosted'
      reliability?: number   // 0–100 minimum reliability
    }

    if (!q || q.trim().length < 2) {
      return reply.status(400).send({ success: false, error: 'Query must be at least 2 characters' })
    }

    const pageLimit  = Math.min(Number(limit), 50)
    const pageOffset = Math.max(0, Number(page)) * pageLimit

    // Cache-aside: stable key derived from all query parameters
    const cacheKey = `search:${q}:${type}:${page}:${pageLimit}:${category ?? ''}:${severity ?? ''}:${country ?? ''}:${from ?? ''}:${to ?? ''}:${source ?? ''}:${language ?? ''}:${sort}:${reliability ?? ''}`
    const cachedResult = await redis.get(cacheKey).catch(() => null)
    if (cachedResult) {
      return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cachedResult))
    }

    const results: Record<string, unknown[]> = {}
    const facets: Record<string, unknown> = {}

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

      searchPromises.push(
        meili.index('signals')
          .search(q, {
            limit:  type === 'all' ? 5 : pageLimit,
            offset: type === 'all' ? 0 : pageOffset,
            filter: filters.join(' AND '),
            sort:   signalSort,
            // Return facet distributions for category + severity (signals only)
            facets: type !== 'all' ? ['category', 'severity'] : undefined,
          })
          .then(r => {
            results.signals = r.hits
            if (r.facetDistribution) {
              facets.category = r.facetDistribution['category'] ?? {}
              facets.severity = r.facetDistribution['severity'] ?? {}
            }
          })
          .catch(() =>
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
          )
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

    const responseBody = {
      success: true,
      data: {
        query:   q,
        type,
        page:    Number(page),
        limit:   pageLimit,
        filters: { category, severity, country, from, to, source, language, sort, reliability },
        results,
        facets,
        total:   totalResults,
      },
    }

    // Cache the assembled response — skip caching zero-result pages to avoid
    // polluting Redis with transient empty states.
    if (totalResults > 0) {
      redis.setex(cacheKey, SEARCH_CACHE_TTL, JSON.stringify(responseBody)).catch(() => {})
    }

    return reply.send(responseBody)
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
    const {
      q,
      schema,
      limit = 10,
    } = req.query as { q?: string; schema?: string; limit?: number }

    if (!q || q.trim().length < 2) {
      return reply.status(400).send({ success: false, error: 'Query must be at least 2 characters' })
    }

    const safeLimit = Math.min(Math.max(1, Number(limit)), 20)

    try {
      const { entities, total } = await searchEntities(q.trim(), safeLimit, schema)

      return reply.send({
        success: true,
        data: {
          query:    q.trim(),
          schema:   schema ?? null,
          limit:    safeLimit,
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
      return reply.status(502).send({
        success: false,
        error:   `Sanctions database temporarily unavailable: ${msg}`,
      })
    }
  })

  // ─── AUTOCOMPLETE ─────────────────────────────────────────
  app.get('/autocomplete', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { q } = req.query as { q?: string }
    if (!q || q.length < 1) return reply.send({ success: true, data: [] })

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
}
