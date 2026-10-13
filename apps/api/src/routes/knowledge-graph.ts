/**
 * Knowledge Graph API Routes
 *
 * Exposes the WorldPulse Entity-Relationship Knowledge Graph — AI-extracted
 * entities and their connections across all ingested signals.
 *
 * Directly counters GDELT 5.0's Gemini-powered knowledge graphs by providing
 * open, queryable, real-time entity intelligence.
 *
 * Endpoints:
 *   GET /api/v1/knowledge-graph/entities          — Search/list entities
 *   GET /api/v1/knowledge-graph/entities/:id       — Get entity detail + signals
 *   GET /api/v1/knowledge-graph/entities/:id/graph — Get entity neighborhood graph
 *   GET /api/v1/knowledge-graph/edges              — List/filter relationships
 *   GET /api/v1/knowledge-graph/trending           — Trending entities (spike detection)
 *   GET /api/v1/knowledge-graph/stats              — Graph statistics
 *   GET /api/v1/knowledge-graph/directory          — Who's in the news: most named in 7 days, by kind
 *
 * @module routes/knowledge-graph
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { entityProfile, sharedStories } from '../lib/entity-profile'
import { entityDirectory } from '../lib/entity-directory'

// ─── TYPES ─────────────────────────────────────────────────────────────────────

type EntityType = 'person' | 'organisation' | 'location' | 'event' | 'weapon_system' | 'legislation' | 'commodity' | 'technology'

interface EntityNode {
  id: string
  type: EntityType
  canonical_name: string
  aliases: string[]
  first_seen: string
  last_seen: string
  mention_count: number
  signal_ids: string[]
  metadata: Record<string, unknown>
}

interface EntityEdge {
  id: string
  source_entity_id: string
  target_entity_id: string
  predicate: string
  weight: number
  signal_ids: string[]
  first_seen: string
  last_seen: string
}

interface GraphResponse {
  nodes: EntityNode[]
  edges: EntityEdge[]
  meta: { node_count: number; edge_count: number; center_entity?: string }
}

// ─── VALID ENTITY TYPES ────────────────────────────────────────────────────────

const VALID_ENTITY_TYPES: EntityType[] = [
  'person', 'organisation', 'location', 'event',
  'weapon_system', 'legislation', 'commodity', 'technology',
]

const VALID_PREDICATES = [
  'leads', 'member_of', 'located_in', 'sanctions', 'allied_with', 'opposes',
  'caused_by', 'resulted_in', 'supplies', 'funds', 'attacks', 'defends',
  'negotiates_with', 'signed', 'deployed_to', 'manufactures', 'regulates',
  'employs', 'successor_of', 'predecessor_of',
] as const

const VALID_SORT_FIELDS = ['mention_count', 'last_seen', 'first_seen', 'canonical_name'] as const

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function mapNodeRow(row: any): EntityNode {
  return {
    id: row.id,
    type: row.type,
    canonical_name: row.canonical_name,
    aliases: row.aliases ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    mention_count: Number(row.mention_count),
    signal_ids: row.signal_ids ?? [],
    metadata: row.metadata ?? {},
  }
}

function mapEdgeRow(row: any): EntityEdge {
  return {
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    predicate: row.predicate,
    weight: Number(row.weight),
    signal_ids: row.signal_ids ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Entity ids are short hashes (entity-graph.ts entityId); anything else is not one */
const ENTITY_ID_RE = /^[A-Za-z0-9_-]{4,64}$/

/**
 * The signal ids entity rows point at (each keeps its last 100), well-formed
 * and lowercase. entity_nodes.signal_ids is text[] while signals.id is a
 * uuid, so they're compared as uuid[] in queries (a uuid = text comparison
 * fails, which left every entity's "recent signals" empty).
 */
export function signalIdsOf(rows: Array<{ signal_ids?: string[] | null }>): string[] {
  return [...new Set(rows.flatMap(r => r.signal_ids ?? []).filter(id => UUID_RE.test(id)).map(id => id.toLowerCase()))]
}

/**
 * Trending, as a reader means it: named in more reports than just before.
 * Each entity's reports in the window (default 24 hours) against the same
 * length just before it, from the reports' own times. Both are scaled by how
 * many reports the whole graph got in each window, so a quiet stretch in the
 * pipeline (Oct 12, 2026: the disk filled overnight and nothing came in for
 * ten hours) doesn't make everything look like it's spiking afterwards.
 *
 * Until Oct 13 this compared the window with mention_count / days since
 * first_seen. Entity extraction was down from April to October, so
 * mention_count had barely grown and the United States showed a "32.8x spike".
 *
 * change: how many times more than before (null with fewer than 3 reports
 * before: too few to compare); isNew: none before and 5 or more now. Ranked
 * by reports now × change (kept between 0.2 and 5), so a big story and a
 * sudden newcomer can both lead.
 */
export interface TrendCount { id: string; recent: number; previous: number }
export interface TrendScore extends TrendCount { change: number | null; isNew: boolean; score: number }

export function trendScores(counts: TrendCount[]): TrendScore[] {
  const totalRecent = counts.reduce((n, c) => n + c.recent, 0)
  const totalPrevious = counts.reduce((n, c) => n + c.previous, 0)
  const graphGrowth = (totalRecent + 1) / (totalPrevious + 1)
  return counts
    .filter(c => c.recent > 0)
    .map(c => {
      const relative = ((c.recent + 2) / (c.previous + 2)) / graphGrowth
      return {
        ...c,
        change: c.previous >= 3 ? Math.round(relative * 10) / 10 : null,
        isNew: c.previous === 0 && c.recent >= 5,
        score: c.recent * Math.min(5, Math.max(0.2, relative)),
      }
    })
    .sort((a, b) => b.score - a.score || b.recent - a.recent || a.id.localeCompare(b.id))
}

// ─── ROUTE PLUGIN ──────────────────────────────────────────────────────────────

const knowledgeGraphRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /entities ─────────────────────────────────────────────────────
  app.get('/entities', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>
    const search = q.search?.trim()
    const type = q.type as EntityType | undefined
    const sort = (q.sort as string) ?? 'mention_count'
    const order = q.order === 'asc' ? 'ASC' : 'DESC'
    const limit = clamp(parseInt(q.limit ?? '50', 10), 1, 200)
    const offset = clamp(parseInt(q.offset ?? '0', 10), 0, 10000)
    const minMentions = parseInt(q.min_mentions ?? '1', 10)

    // Validate type
    if (type && !VALID_ENTITY_TYPES.includes(type)) {
      return reply.status(400).send({
        error: 'Invalid entity type',
        valid_types: VALID_ENTITY_TYPES,
      })
    }

    // Validate sort
    if (!VALID_SORT_FIELDS.includes(sort as any)) {
      return reply.status(400).send({
        error: 'Invalid sort field',
        valid_fields: VALID_SORT_FIELDS,
      })
    }

    // Cache key
    // lean=1: without signal_ids (a search box doesn't need the thousands of
    // report ids a big entity like the UN carries)
    const lean = q.lean === '1' || q.lean === 'true'
    const cacheKey = `kg:api:entities:${search ?? ''}:${type ?? ''}:${sort}:${order}:${limit}:${offset}:${minMentions}${lean ? ':lean' : ''}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      reply.header('X-Cache', 'HIT')
      return reply.send(JSON.parse(cached))
    }

    // Build query
    const conditions: string[] = ['mention_count >= ?']
    const params: any[] = [minMentions]

    if (type) {
      conditions.push(`type = ?`)
      params.push(type)
    }

    if (search) {
      conditions.push(`(LOWER(canonical_name) LIKE ? OR ? = ANY(aliases))`)
      params.push(`%${search.toLowerCase()}%`, search)
    }

    const where = conditions.join(' AND ')
    const countResult = await db.raw(
      `SELECT COUNT(*) as total FROM entity_nodes WHERE ${where}`,
      params,
    )
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10)

    const dataParams = [...params, limit, offset]
    const columns = lean ? 'id, type, canonical_name, aliases, first_seen, last_seen, mention_count, metadata' : '*'
    const dataResult = await db.raw(
      `SELECT ${columns} FROM entity_nodes WHERE ${where}
       ORDER BY ${sort} ${order}
       LIMIT ? OFFSET ?`,
      dataParams,
    )

    const response = {
      data: dataResult.rows.map(mapNodeRow),
      pagination: { total, limit, offset, has_more: offset + limit < total },
    }

    await redis.setex(cacheKey, 300, JSON.stringify(response)) // 5 min cache
    reply.header('X-Cache', 'MISS')
    return reply.send(response)
  })

  // ── GET /entities/:id ─────────────────────────────────────────────────
  app.get('/entities/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }

    // Check Redis cache first
    const cached = await redis.get(`kg:node:${id}`)
    if (cached) {
      const node = JSON.parse(cached)
      // Also fetch recent signals for this entity
      const signals = await getEntitySignals(id, 10)
      reply.header('X-Cache', 'HIT')
      return reply.send({ entity: node, recent_signals: signals })
    }

    const result = await db.raw(`SELECT * FROM entity_nodes WHERE id = ?`, [id])
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Entity not found' })
    }

    const entity = mapNodeRow(result.rows[0])
    const signals = await getEntitySignals(id, 10)

    await redis.setex(`kg:node:${id}`, 600, JSON.stringify(entity))
    return reply.send({ entity, recent_signals: signals })
  })

  // ── GET /entities/:id/profile ─────────────────────────────────────────
  // The entity's page (world-pulse.io/entities/...): activity, stories naming
  // it, newest reports, and who it is named with (lib/entity-profile.ts)
  app.get('/entities/:id/profile', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }
    if (!ENTITY_ID_RE.test(id)) return reply.status(404).send({ error: 'Entity not found' })
    const profile = await entityProfile(id)
    if (!profile) return reply.status(404).send({ error: 'Entity not found' })
    return reply.send({ success: true, data: profile })
  })

  // ── GET /entities/:id/with/:other ─────────────────────────────────────
  // Why two entities are connected: the stories naming both (last 30 days)
  app.get('/entities/:id/with/:other', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, other } = req.params as { id: string; other: string }
    if (!ENTITY_ID_RE.test(id) || !ENTITY_ID_RE.test(other) || id === other) {
      return reply.status(404).send({ error: 'Entity not found' })
    }
    const shared = await sharedStories(id, other)
    if (!shared) return reply.status(404).send({ error: 'Entity not found' })
    return reply.send({ success: true, data: shared })
  })

  // ── GET /entities/:id/graph ───────────────────────────────────────────
  app.get('/entities/:id/graph', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }
    const q = req.query as Record<string, string | undefined>
    const depth = clamp(parseInt(q.depth ?? '1', 10), 1, 2)
    const limit = clamp(parseInt(q.limit ?? '50', 10), 1, 200)

    // Verify entity exists
    const entityResult = await db.raw(`SELECT * FROM entity_nodes WHERE id = ?`, [id])
    if (entityResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Entity not found' })
    }

    const centerNode = mapNodeRow(entityResult.rows[0])

    // Get edges where this entity is source or target
    const edgeResult = await db.raw(
      `SELECT * FROM entity_edges
       WHERE source_entity_id = ? OR target_entity_id = ?
       ORDER BY weight DESC, last_seen DESC
       LIMIT ?`,
      [id, id, limit],
    )

    const edges = edgeResult.rows.map(mapEdgeRow)

    // Collect unique neighbor IDs
    const neighborIds = new Set<string>()
    for (const edge of edges) {
      neighborIds.add(edge.source_entity_id)
      neighborIds.add(edge.target_entity_id)
    }
    neighborIds.delete(id)

    // Fetch neighbor nodes
    const nodes: EntityNode[] = [centerNode]
    if (neighborIds.size > 0) {
      const nodeResult = await db.raw(
        `SELECT * FROM entity_nodes WHERE id = ANY(?) ORDER BY mention_count DESC`,
        [Array.from(neighborIds)],
      )
      nodes.push(...nodeResult.rows.map(mapNodeRow))
    }

    // Depth 2: get inter-neighbor edges
    const allEdges = [...edges]
    if (depth >= 2 && neighborIds.size > 1) {
      const neighborArray = Array.from(neighborIds)
      const interEdges = await db.raw(
        `SELECT * FROM entity_edges
         WHERE source_entity_id = ANY(?) AND target_entity_id = ANY(?)
         ORDER BY weight DESC
         LIMIT ?`,
        [neighborArray, neighborArray, limit],
      )
      allEdges.push(...interEdges.rows.map(mapEdgeRow))
    }

    // Deduplicate edges
    const uniqueEdges = Array.from(
      new Map(allEdges.map(e => [e.id, e])).values(),
    )

    const graph: GraphResponse = {
      nodes,
      edges: uniqueEdges,
      meta: {
        node_count: nodes.length,
        edge_count: uniqueEdges.length,
        center_entity: centerNode.canonical_name,
      },
    }

    return reply.send(graph)
  })

  // ── GET /edges ────────────────────────────────────────────────────────
  app.get('/edges', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>
    const predicate = q.predicate
    const entityId = q.entity_id
    const minWeight = parseFloat(q.min_weight ?? '0')
    const limit = clamp(parseInt(q.limit ?? '50', 10), 1, 200)
    const offset = clamp(parseInt(q.offset ?? '0', 10), 0, 10000)

    if (predicate && !VALID_PREDICATES.includes(predicate as any)) {
      return reply.status(400).send({
        error: 'Invalid predicate',
        valid_predicates: VALID_PREDICATES,
      })
    }

    const conditions: string[] = ['weight >= ?']
    const params: any[] = [minWeight]

    if (predicate) {
      conditions.push(`predicate = ?`)
      params.push(predicate)
    }

    if (entityId) {
      conditions.push(`(source_entity_id = ? OR target_entity_id = ?)`)
      params.push(entityId, entityId)
    }

    const where = conditions.join(' AND ')

    const countResult = await db.raw(
      `SELECT COUNT(*) as total FROM entity_edges WHERE ${where}`,
      params,
    )
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10)

    const dataParams = [...params, limit, offset]
    const dataResult = await db.raw(
      `SELECT e.*,
              sn.canonical_name as source_name, sn.type as source_type,
              tn.canonical_name as target_name, tn.type as target_type
       FROM entity_edges e
       LEFT JOIN entity_nodes sn ON e.source_entity_id = sn.id
       LEFT JOIN entity_nodes tn ON e.target_entity_id = tn.id
       WHERE ${where}
       ORDER BY e.weight DESC, e.last_seen DESC
       LIMIT ? OFFSET ?`,
      dataParams,
    )

    const data = dataResult.rows.map((row: any) => ({
      ...mapEdgeRow(row),
      source_name: row.source_name,
      source_type: row.source_type,
      target_name: row.target_name,
      target_type: row.target_type,
    }))

    return reply.send({
      data,
      pagination: { total, limit, offset, has_more: offset + limit < total },
    })
  })

  // ── GET /trending ─────────────────────────────────────────────────────
  app.get('/trending', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>
    const type = q.type as EntityType | undefined
    const limit = clamp(parseInt(q.limit ?? '20', 10), 1, 100)
    const windowHours = clamp(parseInt(q.window_hours ?? '24', 10), 1, 168)

    if (type && !VALID_ENTITY_TYPES.includes(type)) {
      return reply.status(400).send({
        error: 'Invalid entity type',
        valid_types: VALID_ENTITY_TYPES,
      })
    }

    // Cache trending results (short TTL — 2 min). lean=1: entities without
    // their signal_ids (the home page's "In the news" row needs names, not ids)
    const lean = q.lean === '1' || q.lean === 'true'
    const cacheKey = `kg:api:trending:${type ?? 'all'}:${windowHours}:${limit}${lean ? ':lean' : ''}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      reply.header('X-Cache', 'HIT')
      return reply.send(JSON.parse(cached))
    }

    const now = Date.now()
    const windowStart = new Date(now - windowHours * 3600 * 1000).toISOString()
    const previousStart = new Date(now - 2 * windowHours * 3600 * 1000).toISOString()

    // Reports naming each entity seen in the window: in the window, and in the
    // same length before it (signal ids are text in entity rows)
    const countParams: unknown[] = [windowStart, windowStart, windowStart]
    if (type) countParams.push(type)
    countParams.push(previousStart)
    const countResult = await db.raw(
      `SELECT n.id,
              count(*) FILTER (WHERE s.created_at >= ?)::int AS recent,
              count(*) FILTER (WHERE s.created_at <  ?)::int AS previous
         FROM entity_nodes n
         CROSS JOIN LATERAL unnest(n.signal_ids) AS u(sid)
         JOIN signals s ON s.id::text = lower(u.sid)
        WHERE n.last_seen >= ? AND n.mention_count >= 2${type ? ' AND n.type = ?' : ''}
          AND s.created_at >= ?
        GROUP BY n.id`,
      countParams,
    )
    const scores = trendScores(((countResult.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: String(r.id), recent: Number(r.recent) || 0, previous: Number(r.previous) || 0,
    }))).slice(0, limit)

    const rows = scores.length > 0
      ? (await db.raw(`SELECT * FROM entity_nodes WHERE id = ANY(?)`, [scores.map(t => t.id)])).rows ?? []
      : []
    const byId = new Map((rows as any[]).map(r => [String(r.id), r]))
    const trending = scores.flatMap(t => {
      const row = byId.get(t.id)
      if (!row) return []
      return [{
        entity: lean ? { ...mapNodeRow(row), signal_ids: [] } : mapNodeRow(row),
        recent_mentions: t.recent,
        previous_mentions: t.previous,
        // (the window before, per day; kept for API users of the old field)
        daily_avg: Math.round((t.previous * 24 / windowHours) * 100) / 100,
        spike_ratio: t.change,
        is_new: t.isNew,
      }]
    })

    const response = { trending, window_hours: windowHours, generated_at: new Date().toISOString() }
    await redis.setex(cacheKey, 120, JSON.stringify(response))
    reply.header('X-Cache', 'MISS')
    return reply.send(response)
  })

  // ── GET /sitemap ──────────────────────────────────────────────────────
  // The entity pages worth a search engine's time (world-pulse.io/sitemap.xml):
  // entities named in 3+ reports in the last 14 days, most named first, at
  // most 1,000. Kept for an hour.
  app.get('/sitemap', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const cacheKey = 'kg:api:sitemap:v1'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache', 'HIT').send(JSON.parse(cached))
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
    const result = await db.raw(
      `SELECT n.id, n.canonical_name AS name, max(s.created_at) AS last_report, count(*)::int AS reports
         FROM entity_nodes n
         CROSS JOIN LATERAL unnest(n.signal_ids) AS u(sid)
         JOIN signals s ON s.id::text = lower(u.sid)
        WHERE n.last_seen >= ? AND s.created_at >= ?
        GROUP BY n.id, n.canonical_name
       HAVING count(*) >= 3
        ORDER BY reports DESC, n.id
        LIMIT 1000`,
      [since, since],
    )
    const entities = ((result.rows ?? []) as Array<Record<string, unknown>>).flatMap(r => {
      const last = new Date(r.last_report as string)
      const name = String(r.name ?? '').trim()
      return name && !Number.isNaN(last.getTime())
        ? [{ id: String(r.id), name, lastReport: last.toISOString(), reports: Number(r.reports) || 0 }]
        : []
    })
    const response = { success: true, data: { entities, generatedAt: new Date().toISOString() } }
    redis.setex(cacheKey, 3600, JSON.stringify(response)).catch(() => {})
    return reply.send(response)
  })

  // ── GET /directory ────────────────────────────────────────────────────
  // world-pulse.io/entities: the people, places and organisations named in
  // the most reports in the last 7 days (lib/entity-directory.ts). Kept 30
  // min, so it has the API-wide limit only: the website's server renders the
  // page from one address, and a tighter limit would fail it on a busy day.
  app.get('/directory', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ success: true, data: await entityDirectory() })
  })

  // ── GET /stats ────────────────────────────────────────────────────────
  app.get('/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const cacheKey = 'kg:api:stats'
    const cached = await redis.get(cacheKey)
    if (cached) {
      reply.header('X-Cache', 'HIT')
      return reply.send(JSON.parse(cached))
    }

    const [nodeStats, edgeStats, typeBreakdown, predicateBreakdown] = await Promise.all([
      db.raw(`SELECT COUNT(*) as total_entities, SUM(mention_count) as total_mentions,
                       MAX(last_seen) as last_updated FROM entity_nodes`),
      db.raw(`SELECT COUNT(*) as total_edges, AVG(weight) as avg_weight FROM entity_edges`),
      db.raw(`SELECT type, COUNT(*) as count FROM entity_nodes GROUP BY type ORDER BY count DESC`),
      db.raw(`SELECT predicate, COUNT(*) as count FROM entity_edges GROUP BY predicate ORDER BY count DESC`),
    ])

    const stats = {
      entities: {
        total: parseInt(nodeStats.rows[0]?.total_entities ?? '0', 10),
        total_mentions: parseInt(nodeStats.rows[0]?.total_mentions ?? '0', 10),
        last_updated: nodeStats.rows[0]?.last_updated,
        by_type: typeBreakdown.rows.reduce((acc: any, row: any) => {
          acc[row.type] = parseInt(row.count, 10)
          return acc
        }, {}),
      },
      edges: {
        total: parseInt(edgeStats.rows[0]?.total_edges ?? '0', 10),
        avg_weight: Number(edgeStats.rows[0]?.avg_weight ?? 0).toFixed(3),
        by_predicate: predicateBreakdown.rows.reduce((acc: any, row: any) => {
          acc[row.predicate] = parseInt(row.count, 10)
          return acc
        }, {}),
      },
      generated_at: new Date().toISOString(),
    }

    await redis.setex(cacheKey, 300, JSON.stringify(stats))
    reply.header('X-Cache', 'MISS')
    return reply.send(stats)
  })
}

// ─── SIGNAL LOOKUP HELPER ──────────────────────────────────────────────────────

async function getEntitySignals(entityId: string, limit: number): Promise<any[]> {
  try {
    const node = await db.raw(`SELECT signal_ids FROM entity_nodes WHERE id = ?`, [entityId])
    const ids = signalIdsOf(node.rows)
    if (ids.length === 0) return []
    // (signals has no source_id column, and published_at only on some installs)
    const result = await db.raw(
      `SELECT s.id, s.title, s.category, s.severity, s.status, s.location_name,
              s.created_at AS published_at
       FROM signals s
       WHERE s.id = ANY(?::uuid[])
       ORDER BY s.created_at DESC
       LIMIT ?`,
      [ids, limit],
    )
    return result.rows
  } catch {
    return []
  }
}

export default knowledgeGraphRoutes
