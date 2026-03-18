import type { FastifyPluginAsync } from 'fastify'
import { MeiliSearch } from 'meilisearch'
import { db } from '../db/postgres'

const meili = new MeiliSearch({
  host:   process.env.MEILI_HOST  ?? 'http://localhost:7700',
  apiKey: process.env.MEILI_KEY   ?? '',
})

// ─── INDEX SETUP ──────────────────────────────────────────────────────────
export async function setupSearchIndexes() {
  // Signals index
  const signalsIdx = meili.index('signals')
  await signalsIdx.updateSettings({
    searchableAttributes: ['title', 'summary', 'tags', 'locationName', 'countryCode'],
    filterableAttributes: ['category', 'severity', 'status', 'countryCode', 'language', 'createdAt'],
    sortableAttributes:   ['createdAt', 'reliabilityScore', 'viewCount', 'postCount'],
    rankingRules:         ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  })

  // Posts index
  const postsIdx = meili.index('posts')
  await postsIdx.updateSettings({
    searchableAttributes: ['content', 'tags', 'authorHandle', 'authorDisplayName', 'sourceName'],
    filterableAttributes: ['postType', 'language', 'authorId', 'sourceName'],
    sortableAttributes:   ['createdAt', 'likeCount', 'boostCount', 'replyCount'],
  })

  // Users index
  const usersIdx = meili.index('users')
  await usersIdx.updateSettings({
    searchableAttributes: ['handle', 'displayName', 'bio'],
    filterableAttributes: ['accountType', 'verified'],
    sortableAttributes:   ['followerCount', 'trustScore'],
  })

  console.log('✅ Search indexes configured')
}

// ─── INDEX HELPERS ────────────────────────────────────────────────────────
export async function indexSignal(signal: Record<string, unknown>) {
  await meili.index('signals').addDocuments([{
    id:               signal.id,
    title:            signal.title,
    summary:          signal.summary,
    category:         signal.category,
    severity:         signal.severity,
    status:           signal.status,
    reliabilityScore: signal.reliability_score,
    locationName:     signal.location_name,
    countryCode:      signal.country_code,
    tags:             signal.tags,
    language:         signal.language,
    viewCount:        signal.view_count,
    postCount:        signal.post_count,
    createdAt:        signal.created_at,
  }])
}

export async function indexPost(post: Record<string, unknown>) {
  await meili.index('posts').addDocuments([{
    id:              post.id,
    content:         post.content,
    postType:        post.post_type,
    tags:            post.tags,
    authorId:        post.author_id,
    authorHandle:    post.author_handle,
    authorDisplayName: post.author_display_name,
    likeCount:       post.like_count,
    boostCount:      post.boost_count,
    replyCount:      post.reply_count,
    sourceName:      post.source_name,
    language:        post.language,
    createdAt:       post.created_at,
  }])
}

// ─── ROUTES ──────────────────────────────────────────────────────────────
export const registerSearchRoutes: FastifyPluginAsync = async (app) => {

  // ─── UNIFIED SEARCH ──────────────────────────────────────
  app.get('/', async (req, reply) => {
    const {
      q, type = 'all', limit = 20,
      category, severity, country,
      from, to, source, language, sort = 'newest',
    } = req.query as {
      q?:        string
      type?:     'all' | 'signals' | 'posts' | 'users' | 'tags'
      limit?:    number
      category?: string   // comma-separated
      severity?: string   // comma-separated
      country?:  string
      from?:     string   // ISO date string
      to?:       string   // ISO date string
      source?:   string   // filter by source name (partial match)
      language?: string
      sort?:     'newest' | 'oldest' | 'discussed' | 'boosted'
    }

    if (!q || q.trim().length < 2) {
      return reply.status(400).send({ success: false, error: 'Query must be at least 2 characters' })
    }

    const pageLimit = Math.min(Number(limit), 50)
    const results: Record<string, unknown[]> = {}

    // Build Meilisearch sort expression from sort param
    const signalSort = (() => {
      switch (sort) {
        case 'oldest':   return ['createdAt:asc']
        case 'discussed': return ['postCount:desc']
        case 'newest':
        default:         return ['createdAt:desc']
      }
    })()

    const postSort = (() => {
      switch (sort) {
        case 'oldest':   return ['createdAt:asc']
        case 'discussed': return ['replyCount:desc']
        case 'boosted':   return ['boostCount:desc']
        case 'newest':
        default:         return ['createdAt:desc']
      }
    })()

    const searchPromises: Promise<void>[] = []

    // Signals search
    if (type === 'all' || type === 'signals') {
      const filters: string[] = ['status = "verified"']

      // Multi-value category filter
      if (category) {
        const cats = category.split(',').map(c => c.trim()).filter(Boolean)
        if (cats.length === 1) {
          filters.push(`category = "${cats[0]}"`)
        } else if (cats.length > 1) {
          filters.push(`(${cats.map(c => `category = "${c}"`).join(' OR ')})`)
        }
      }

      // Multi-value severity filter
      if (severity) {
        const sevs = severity.split(',').map(s => s.trim()).filter(Boolean)
        if (sevs.length === 1) {
          filters.push(`severity = "${sevs[0]}"`)
        } else if (sevs.length > 1) {
          filters.push(`(${sevs.map(s => `severity = "${s}"`).join(' OR ')})`)
        }
      }

      if (country) filters.push(`countryCode = "${country.toUpperCase()}"`)
      if (language) filters.push(`language = "${language}"`)

      // Date range filters (Meilisearch uses unix timestamps for numeric filters)
      if (from) {
        const fromTs = Math.floor(new Date(from).getTime() / 1000)
        if (!isNaN(fromTs)) filters.push(`createdAt >= ${fromTs}`)
      }
      if (to) {
        const toTs = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000)
        if (!isNaN(toTs)) filters.push(`createdAt <= ${toTs}`)
      }

      searchPromises.push(
        meili.index('signals')
          .search(q, {
            limit:  type === 'all' ? 5 : pageLimit,
            filter: filters.join(' AND '),
            sort:   signalSort,
          })
          .then(r => { results.signals = r.hits })
          .catch(() => {
            // Fall back to Postgres text search
            return db('signals')
              .whereRaw(`to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'')) @@ plainto_tsquery('english', ?)`, [q])
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
                if (country) qb.where('country_code', country.toUpperCase())
                if (language) qb.where('language', language)
                if (from) qb.where('created_at', '>=', new Date(from))
                if (to) qb.where('created_at', '<=', new Date(to + 'T23:59:59Z'))
              })
              .select(['id', 'title', 'summary', 'category', 'severity', 'status',
                       'reliability_score as reliabilityScore', 'location_name as locationName',
                       'country_code as countryCode', 'tags', 'language', 'view_count as viewCount', 'created_at as createdAt'])
              .orderBy(sort === 'oldest' ? 'created_at' : sort === 'discussed' ? 'post_count' : 'created_at',
                       sort === 'oldest' ? 'asc' : 'desc')
              .limit(type === 'all' ? 5 : pageLimit)
              .then(rows => { results.signals = rows })
              .catch(() => { results.signals = [] })
          })
      )
    }

    // Posts search
    if (type === 'all' || type === 'posts') {
      const postFilters: string[] = []
      if (language) postFilters.push(`language = "${language}"`)
      if (source) postFilters.push(`sourceName = "${source}"`)

      searchPromises.push(
        meili.index('posts')
          .search(q, {
            limit:  type === 'all' ? 5 : pageLimit,
            filter: postFilters.length > 0 ? postFilters.join(' AND ') : undefined,
            sort:   postSort,
          })
          .then(r => { results.posts = r.hits })
          .catch(() => { results.posts = [] })
      )
    }

    // Users search
    if (type === 'all' || type === 'users') {
      searchPromises.push(
        meili.index('users')
          .search(q, {
            limit: type === 'all' ? 3 : pageLimit,
            sort:  ['followerCount:desc'],
          })
          .then(r => { results.users = r.hits })
          .catch(() => { results.users = [] })
      )
    }

    // Tag search (from DB)
    if (type === 'all' || type === 'tags') {
      searchPromises.push(
        db.raw(`
          SELECT DISTINCT unnest(tags) as tag, COUNT(*) as count
          FROM signals
          WHERE ? = ANY(tags) OR tags && ARRAY(
            SELECT unnest(tags) FROM signals
            WHERE to_tsvector('english', title) @@ plainto_tsquery('english', ?)
            LIMIT 10
          )
          GROUP BY tag
          ORDER BY count DESC
          LIMIT ?
        `, [q.toLowerCase(), q, type === 'all' ? 5 : pageLimit])
          .then(r => { results.tags = r.rows })
          .catch(() => { results.tags = [] })
      )
    }

    await Promise.allSettled(searchPromises)

    return reply.send({
      success: true,
      data: {
        query:   q,
        type,
        filters: { category, severity, country, from, to, source, language, sort },
        results,
        total:   Object.values(results).reduce((s, a) => s + a.length, 0),
      },
    })
  })

  // ─── AUTOCOMPLETE ─────────────────────────────────────────
  app.get('/autocomplete', async (req, reply) => {
    const { q } = req.query as { q?: string }
    if (!q || q.length < 1) return reply.send({ success: true, data: [] })

    const [signals, users, tags] = await Promise.allSettled([
      meili.index('signals').search(q, { limit: 3, attributesToRetrieve: ['id', 'title', 'category'] }),
      meili.index('users').search(q, { limit: 3, attributesToRetrieve: ['id', 'handle', 'displayName', 'avatarUrl', 'verified'] }),
      db.raw(
        `SELECT DISTINCT unnest(tags) as tag FROM signals WHERE array_to_string(tags, ' ') ILIKE ? LIMIT 5`,
        [`%${q}%`]
      ),
    ])

    return reply.send({
      success: true,
      data: {
        signals: signals.status === 'fulfilled' ? signals.value.hits : [],
        users:   users.status === 'fulfilled' ? users.value.hits : [],
        tags:    tags.status === 'fulfilled' ? (tags.value as { rows: {tag: string}[] }).rows.map(r => r.tag) : [],
      },
    })
  })
}
