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
 *
 * @module routes/knowledge-graph
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

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
    const cacheKey = `kg:api:entities:${search ?? ''}:${type ?? ''}:${sort}:${order}:${limit}:${offset}:${minMentions}`
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
    const dataResult = await db.raw(
      `SELECT * FROM entity_nodes WHERE ${where}
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

    // Cache trending results (short TTL — 2 min)
    const cacheKey = `kg:api:trending:${type ?? 'all'}:${windowHours}:${limit}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      reply.header('X-Cache', 'HIT')
      return reply.send(JSON.parse(cached))
    }

    const windowStart = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()

    const conditions: string[] = ['last_seen >= ?', 'mention_count >= 2']
    const params: any[] = [windowStart]
    if (type) {
      conditions.push('type = ?')
      params.push(type)
    }
    params.push(limit)

    const where = conditions.join(' AND ')
    const result = await db.raw(
      `SELECT *,
              GREATEST(1, mention_count / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - first_seen)) / 86400)) as daily_avg,
              mention_count as recent_mentions
       FROM entity_nodes
       WHERE ${where}
       ORDER BY mention_count DESC, last_seen DESC
       LIMIT ?`,
      params,
    )

    const trending = result.rows.map((row: any) => ({
      entity: mapNodeRow(row),
      daily_avg: Number(row.daily_avg) || 1,
      recent_mentions: Number(row.recent_mentions) || 0,
      spike_ratio: Number(row.recent_mentions) / Math.max(1, Number(row.daily_avg)),
    }))

    // Sort by spike ratio
    trending.sort((a: any, b: any) => b.spike_ratio - a.spike_ratio)

    const response = { trending, window_hours: windowHours, generated_at: new Date().toISOString() }
    await redis.setex(cacheKey, 120, JSON.stringify(response))
    reply.header('X-Cache', 'MISS')
    return reply.send(response)
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
    const result = await db.raw(
      `SELECT s.id, s.title, s.category, s.severity, s.published_at, s.source_id
       FROM signals s
       WHERE s.id = ANY(
         SELECT unnest(signal_ids) FROM entity_nodes WHERE id = ?
       )
       ORDER BY s.published_at DESC
       LIMIT ?`,
      [entityId, limit],
    )
    return result.rows
  } catch {
    return []
  }
}

export default knowledgeGraphRoutes
