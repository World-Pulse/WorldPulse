import { db } from '../db/postgres'
import { redis } from '../db/redis'

const SIGNALS_CACHE_TTL  = 30  // seconds
const TRENDING_CACHE_TTL = 60  // seconds

// ─── Row → GraphQL shape ──────────────────────────────────────────────────────

interface SignalRow {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  reliability_score: number | null
  original_urls: string[] | null
  created_at: Date | string
  location_geojson: { coordinates?: [number, number] } | null
}

function formatSignalGql(row: SignalRow) {
  const geo = row.location_geojson
  return {
    id:               row.id,
    title:            row.title,
    description:      row.summary ?? null,
    category:         row.category,
    severity:         row.severity,
    lat:              geo?.coordinates ? geo.coordinates[1] : null,
    lng:              geo?.coordinates ? geo.coordinates[0] : null,
    source:           null as string | null,   // sources joined lazily if needed
    sourceUrl:        Array.isArray(row.original_urls) ? (row.original_urls[0] ?? null) : null,
    reliabilityScore: row.reliability_score ?? null,
    createdAt:        new Date(row.created_at).toISOString(),
  }
}

// ─── Base query — shared column list ─────────────────────────────────────────

function baseSignalQuery() {
  return db('signals as s')
    .where('s.status', 'verified')
    .select([
      's.id', 's.title', 's.summary', 's.category', 's.severity',
      's.reliability_score', 's.original_urls', 's.created_at',
      db.raw('ST_AsGeoJSON(s.location)::json as location_geojson'),
    ])
}

// ─── Resolvers ───────────────────────────────────────────────────────────────

export const resolvers = {
  Query: {
    // signal(id: ID!): Signal
    async signal(_: unknown, { id }: { id: string }) {
      const row = await baseSignalQuery()
        .where('s.id', id)
        .first() as SignalRow | undefined

      return row ? formatSignalGql(row) : null
    },

    // signals(...): SignalConnection
    async signals(
      _: unknown,
      {
        category,
        severity,
        limit = 20,
        offset = 0,
        since,
      }: {
        category?: string
        severity?: string
        limit?: number
        offset?: number
        since?: string
      },
    ) {
      const safeLimit  = Math.min(Number(limit), 100)
      const safeOffset = Math.max(0, Number(offset))

      const cacheKey = `gql:signals:${category ?? 'all'}:${severity ?? 'all'}:${safeLimit}:${safeOffset}:${since ?? ''}`
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) return JSON.parse(cached) as ReturnType<typeof buildConnection>

      let query = baseSignalQuery()
        .orderBy('s.created_at', 'desc')
        .limit(safeLimit)
        .offset(safeOffset)

      if (category && category !== 'all') query = query.where('s.category', category)
      if (severity && severity !== 'all') query = query.where('s.severity', severity)
      if (since) query = query.where('s.created_at', '>', new Date(since))

      // Count query (same filters, no pagination)
      let countQuery = db('signals as s').where('s.status', 'verified').count('s.id as total')
      if (category && category !== 'all') countQuery = countQuery.where('s.category', category)
      if (severity && severity !== 'all') countQuery = countQuery.where('s.severity', severity)
      if (since) countQuery = countQuery.where('s.created_at', '>', new Date(since))

      const [rows, countResult] = await Promise.all([
        query as Promise<SignalRow[]>,
        countQuery.first() as Promise<{ total: string } | undefined>,
      ])

      const totalCount = Number(countResult?.total ?? 0)
      const result = buildConnection(rows, totalCount, safeOffset, safeLimit)

      redis.setex(cacheKey, SIGNALS_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      return result
    },

    // search(q: String!, limit: Int): [Signal!]!
    async search(_: unknown, { q, limit = 10 }: { q: string; limit?: number }) {
      const safeLimit = Math.min(Number(limit), 50)

      const rows = await db('signals as s')
        .where('s.status', 'verified')
        .whereRaw(
          `to_tsvector('english', s.title || ' ' || coalesce(s.summary, '')) @@ plainto_tsquery('english', ?)`,
          [q],
        )
        .select([
          's.id', 's.title', 's.summary', 's.category', 's.severity',
          's.reliability_score', 's.original_urls', 's.created_at',
          db.raw('ST_AsGeoJSON(s.location)::json as location_geojson'),
        ])
        .orderBy('s.created_at', 'desc')
        .limit(safeLimit) as SignalRow[]

      return rows.map(formatSignalGql)
    },

    // trending: [Signal!]!
    async trending(_: unknown, __: unknown) {
      const cacheKey = 'gql:trending'
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) return JSON.parse(cached) as ReturnType<typeof formatSignalGql>[]

      const rows = await db('signals as s')
        .where('s.status', 'verified')
        .where('s.created_at', '>', db.raw("NOW() - INTERVAL '48 hours'"))
        .select([
          's.id', 's.title', 's.summary', 's.category', 's.severity',
          's.reliability_score', 's.original_urls', 's.created_at',
          's.view_count', 's.post_count',
          db.raw('ST_AsGeoJSON(s.location)::json as location_geojson'),
        ])
        .orderByRaw('(s.view_count + s.post_count * 3) DESC')
        .limit(20) as SignalRow[]

      const result = rows.map(formatSignalGql)
      redis.setex(cacheKey, TRENDING_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      return result
    },

    // ─── Event Correlation Queries ────────────────────────────────
    async correlatedSignals(_: unknown, { signalId }: { signalId: string }) {
      const clusterId = await redis.get(`correlation:signal:${signalId}`).catch(() => null)
      if (!clusterId) return null

      const clusterRaw = await redis.get(`correlation:cluster:${clusterId}`).catch(() => null)
      if (!clusterRaw) return null

      const cluster = JSON.parse(clusterRaw) as {
        cluster_id: string; primary_signal_id: string; signal_ids: string[]
        categories: string[]; sources: string[]; severity: string
        correlation_type: string; correlation_score: number; created_at: string
      }

      const signalRows = cluster.signal_ids.length > 0
        ? await baseSignalQuery().whereIn('s.id', cluster.signal_ids).limit(20) as SignalRow[]
        : []

      return {
        id: cluster.cluster_id,
        primarySignalId: cluster.primary_signal_id,
        correlationType: cluster.correlation_type,
        correlationScore: cluster.correlation_score,
        categories: cluster.categories,
        sourceCount: cluster.sources.length,
        signalCount: cluster.signal_ids.length,
        severity: cluster.severity,
        signals: signalRows.map(formatSignalGql),
        createdAt: cluster.created_at,
      }
    },

    async recentClusters(_: unknown, { limit = 20 }: { limit?: number }) {
      const safeLimit = Math.min(Math.max(1, limit), 50)
      const clusterIds = await redis.zrevrange('correlation:recent', 0, safeLimit - 1)
      if (clusterIds.length === 0) return []

      const pipeline = redis.pipeline()
      for (const cid of clusterIds) pipeline.get(`correlation:cluster:${cid}`)
      const results = await pipeline.exec()

      const clusters: Array<Record<string, unknown>> = []
      for (const [err, val] of results ?? []) {
        if (err || !val) continue
        try { clusters.push(JSON.parse(val as string)) } catch { /* skip */ }
      }

      // For each cluster, fetch minimal signal data
      const formatted = []
      for (const c of clusters) {
        const sids = c.signal_ids as string[] ?? []
        const signalRows = sids.length > 0
          ? await baseSignalQuery().whereIn('s.id', sids).limit(12) as SignalRow[]
          : []
        formatted.push({
          id: c.cluster_id,
          primarySignalId: c.primary_signal_id,
          correlationType: c.correlation_type,
          correlationScore: c.correlation_score,
          categories: c.categories,
          sourceCount: (c.sources as string[])?.length ?? 0,
          signalCount: sids.length,
          severity: c.severity,
          signals: signalRows.map(formatSignalGql),
          createdAt: c.created_at,
        })
      }
      return formatted
    },
  },
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildConnection(rows: SignalRow[], totalCount: number, offset: number, limit: number) {
  return {
    nodes:      rows.map(formatSignalGql),
    totalCount,
    pageInfo: {
      hasPreviousPage: offset > 0,
      hasNextPage:     offset + limit < totalCount,
    },
  }
}
