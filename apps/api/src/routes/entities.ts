/**
 * Entity API — Phase 1.6.3
 *
 * Knowledge graph entity endpoints.
 *
 * GET /api/v1/entities/:id/timeline  — Chronological signal appearances + trend
 * GET /api/v1/entities/:id           — Entity detail with edges and metadata
 *
 * @module routes/entities
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { mentionIds } from '../lib/entity-profile'
import { longQuery } from '../lib/long-query'
import { logger } from '../lib/logger'

const CACHE_TTL = 120
/** The timeline's page of reports, at most; and the other entities shown with each, at most */
export const TIMELINE_MAX = 100
export const CO_ENTITIES_SHOWN = 5
/** The page's co-entities are read in one query under this limit; past it the page answers without them */
export const CO_ENTITY_SECONDS = 4
/**
 * A big entity's page (Nov 21, 2026, 3:55 PM: Russia's, Donald Trump's and the United States', of 12,000 to 34,000
 * reports, still answered 500 after the first fix): looking up every one of its reports by id to sort them took
 * past the 5-second limit. From BIG_ENTITY reports up, the page reads the reports of the RECENT_DAYS up to its last
 * mention, newest first, keeping its own (the newest hundred of Russia's are in the last hours); only a page reaching
 * further back looks its reports up by id, under PAGE_SECONDS, and a page that gives up answers what it has.
 */
export const BIG_ENTITY = 2_000
export const RECENT_DAYS = 30
export const PAGE_SECONDS = 10
const PAGE_COLUMNS = 'id, title, category, severity, location_name, reliability_score, source_count, published_at, created_at'

type Row = Record<string, any>

/** A page of the entity's reports, newest first, and whether it is the whole of the page asked for */
export async function reportPage(ids: string[], lastSeen: unknown, limit: number, offset: number): Promise<{ rows: Row[]; partial: boolean }> {
  const byId = (trx: { raw: (sql: string, b: unknown[]) => Promise<unknown> }) => trx.raw(`
    SELECT ${PAGE_COLUMNS}
      FROM signals
     WHERE id = ANY(?::uuid[])
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?
  `, [ids, limit, offset]) as Promise<{ rows?: Row[] }>
  const last = lastSeen ? new Date(lastSeen as string) : null
  if (ids.length < BIG_ENTITY || !last || Number.isNaN(last.getTime())) {
    return { rows: (await longQuery(PAGE_SECONDS, byId)).rows ?? [], partial: false }
  }
  // the window's reports streamed newest first from the created_at index (OFFSET 0 keeps the planner from looking
  // every id up first), its own kept until the page is full
  const recent = await longQuery(PAGE_SECONDS, trx => trx.raw(`
    SELECT r.*
      FROM (
        SELECT ${PAGE_COLUMNS}
          FROM signals
         WHERE created_at <= ?::timestamptz + interval '1 day'
           AND created_at > ?::timestamptz - interval '${RECENT_DAYS} days'
         ORDER BY created_at DESC
        OFFSET 0
      ) r
     WHERE r.id = ANY(?::uuid[])
     LIMIT ? OFFSET ?
  `, [last.toISOString(), last.toISOString(), ids, limit, offset])) as { rows?: Row[] }
  const rows = recent.rows ?? []
  if (rows.length >= limit) return { rows, partial: false }
  // the page reaches past the window: its reports looked up by id, or what the window had
  try {
    return { rows: (await longQuery(PAGE_SECONDS, byId)).rows ?? [], partial: false }
  } catch (err) {
    logger.warn({ err, reports: ids.length, offset }, 'Entity timeline: the reports before the window gave up, page shown with the window\'s')
    return { rows, partial: true }
  }
}

type CoEntity = { id: string; name: string; type: string }

/**
 * The other entities naming each of a page's reports (Nov 21, 2026): one query for the page, the most-named first,
 * at most CO_ENTITIES_SHOWN a report. It was one query a report, each reading every entity's report list as text
 * (signal_ids::text LIKE), so a big entity's page of 100 (Tokyo's, of 772 reports) ran past the 5-second limit and
 * answered 500. Null when it gives up.
 */
export async function coEntitiesOf(entityId: string, reportIds: string[], oldest: Date | null): Promise<Map<string, CoEntity[]> | null> {
  const out = new Map<string, CoEntity[]>()
  if (reportIds.length === 0) return out
  try {
    const result = await longQuery(CO_ENTITY_SECONDS, trx => trx.raw(`
      SELECT lower(u.sid) AS sid, n.id, n.canonical_name AS name, n.type
        FROM entity_nodes n
        CROSS JOIN LATERAL unnest(n.signal_ids) AS u(sid)
       WHERE n.id <> ?
         AND n.signal_ids && ?::text[]
         AND lower(u.sid) = ANY(?::text[])
         AND (?::timestamptz IS NULL OR n.last_seen >= ?::timestamptz - interval '3 days')
       ORDER BY n.mention_count DESC, n.canonical_name
    `, [entityId, reportIds, reportIds, oldest, oldest])) as { rows?: Array<{ sid: string; id: string; name: string; type: string }> }
    for (const r of result.rows ?? []) {
      const list = out.get(r.sid) ?? []
      if (list.length < CO_ENTITIES_SHOWN && !list.some(e => e.id === r.id)) list.push({ id: r.id, name: r.name, type: r.type })
      out.set(r.sid, list)
    }
    return out
  } catch (err) {
    logger.warn({ err, entity: entityId, reports: reportIds.length }, 'Entity timeline: co-entities gave up, page shown without them')
    return null
  }
}

export const registerEntityRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['entities']
  })

  // ─── Entity detail ───────────────────────────────────────────
  app.get('/:id', {
    schema: {
      summary: 'Entity Detail',
      description: 'Entity with edges, metadata, importance score, and trend',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const entity = await db('entity_nodes').where('id', id).first()
    if (!entity) {
      return reply.status(404).send({ success: false, error: 'Entity not found' })
    }

    // Get edges (both directions)
    const edges = await db('entity_edges')
      .where('source_entity_id', id)
      .orWhere('target_entity_id', id)
      .select('id', 'source_entity_id', 'target_entity_id', 'predicate', 'weight', 'first_seen', 'last_seen')
      .orderBy('weight', 'desc')
      .limit(50)

    // Enrich edges with entity names
    const entityIds = new Set<string>()
    for (const e of edges) {
      entityIds.add(e.source_entity_id)
      entityIds.add(e.target_entity_id)
    }
    entityIds.delete(id)

    const relatedEntities = entityIds.size > 0
      ? await db('entity_nodes')
          .whereIn('id', [...entityIds])
          .select('id', 'canonical_name', 'type', 'mention_count')
      : []

    const entityMap = new Map(relatedEntities.map((e: any) => [e.id, e]))

    const enrichedEdges = edges.map((e: any) => {
      const otherId = e.source_entity_id === id ? e.target_entity_id : e.source_entity_id
      const other = entityMap.get(otherId)
      return {
        ...e,
        direction: e.source_entity_id === id ? 'outgoing' : 'incoming',
        related_entity: other ? {
          id: other.id,
          name: other.canonical_name,
          type: other.type,
          mention_count: other.mention_count,
        } : null,
      }
    })

    const metadata = typeof entity.metadata === 'string'
      ? JSON.parse(entity.metadata) : entity.metadata ?? {}
    const aliases = Array.isArray(entity.aliases)
      ? entity.aliases : JSON.parse(entity.aliases ?? '[]')

    return reply.send({
      success: true,
      entity: {
        id: entity.id,
        canonical_name: entity.canonical_name,
        type: entity.type,
        aliases,
        mention_count: entity.mention_count,
        first_seen: entity.first_seen,
        last_seen: entity.last_seen,
        importance_score: metadata.importance_score ?? null,
        trend: metadata.trend ?? null,
        recent_7d: metadata.recent_7d ?? null,
        previous_7d: metadata.previous_7d ?? null,
        weighted_degree: metadata.weighted_degree ?? null,
        edge_count: metadata.edge_count ?? null,
      },
      edges: enrichedEdges,
    })
  })

  // ─── Entity timeline ─────────────────────────────────────────
  app.get('/:id/timeline', {
    schema: {
      summary: 'Entity Timeline',
      description: 'Chronological signal appearances, co-occurrence events, and trend data',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const query = req.query as { limit?: number; offset?: number }
    const limit = Math.min(Math.max(Math.trunc(Number(query.limit) || 50), 1), TIMELINE_MAX)
    const offset = Math.max(Math.trunc(Number(query.offset) || 0), 0)

    const cacheKey = `entity:timeline:${id}:${limit}:${offset}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const entity = await db('entity_nodes').where('id', id).first()
    if (!entity) {
      return reply.status(404).send({ success: false, error: 'Entity not found' })
    }

    // The entity's report ids, well-formed only: a malformed one failed the whole query as a uuid
    const signalIds = mentionIds(Array.isArray(entity.signal_ids) ? entity.signal_ids : JSON.parse(entity.signal_ids ?? '[]'))

    if (signalIds.length === 0) {
      return reply.send({
        success: true,
        entity: { id: entity.id, name: entity.canonical_name, type: entity.type },
        timeline: [],
        total: 0,
        trend: null,
      })
    }

    // The page of its reports, newest first (one array parameter however many ids: Russia's are over 11,000)
    let page: { rows: Row[]; partial: boolean }
    try {
      page = await reportPage(signalIds, entity.last_seen, limit, offset)
    } catch (err) {
      logger.warn({ err, entity: id, reports: signalIds.length }, 'Entity timeline: the reports could not be read in time')
      return reply.status(503).send({ success: false, error: 'The timeline could not be read in time; try again in a minute' })
    }
    const signals = page.rows

    // The other entities naming each, in one query; the page still answers when it gives up
    const times = signals.map(s => new Date(s.published_at ?? s.created_at).getTime()).filter(Number.isFinite)
    const oldest = times.length ? new Date(Math.min(...times)) : null
    const coEntities = await coEntitiesOf(id, signals.map(s => String(s.id).toLowerCase()), oldest)

    const timelineEntries = signals.map(signal => ({
      signal_id: signal.id,
      title: signal.title,
      category: signal.category,
      severity: signal.severity,
      location: signal.location_name,
      reliability: signal.reliability_score,
      source_count: signal.source_count,
      published_at: signal.published_at,
      co_entities: coEntities?.get(String(signal.id).toLowerCase()) ?? [],
    }))

    // Trend data from metadata
    const metadata = typeof entity.metadata === 'string'
      ? JSON.parse(entity.metadata) : entity.metadata ?? {}

    const result = {
      success: true,
      entity: {
        id: entity.id,
        name: entity.canonical_name,
        type: entity.type,
        mention_count: entity.mention_count,
        first_seen: entity.first_seen,
        last_seen: entity.last_seen,
      },
      timeline: timelineEntries,
      total: signalIds.length,
      trend: metadata.trend ?? null,
      importance_score: metadata.importance_score ?? null,
      ...(coEntities ? {} : { co_entities_unavailable: true }),
      ...(page.partial ? { partial: true } : {}),
    }

    // (a page without its co-entities, or cut short, is kept a shorter while: the next one may be whole)
    await redis.setex(cacheKey, coEntities && !page.partial ? CACHE_TTL : 30, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })
}
