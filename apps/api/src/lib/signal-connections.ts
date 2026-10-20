/**
 * The story page's "Intelligence web" (GET /signals/:id/connections): other
 * recent stories that name the same people, places or organisations as this
 * one.
 *
 * Until Oct 12, 2026 this went two steps out: this signal's entities, then
 * any entity they had ever appeared next to, then every signal of that
 * entity, of any age. The Djibouti boat wreck listed "Singapore → Country 0
 * Radioactive Materials Exports: $34M 2024" from five months earlier "via UN".
 * Now it lists signals that name one of this signal's own entities:
 *   - from the last CONNECTION_DAYS days;
 *   - not other reports of the same story (the story timeline lists those);
 *   - not trade-data rows whose country never resolved ("Country 554").
 * The more of this signal's entities a signal names, the higher it ranks.
 *
 * Oct 20, 2026: the biggest stories answered 500 (the Zelensky and Witkoff
 * story after 5.3 s), so their pages lost "In this story" and their links to
 * the people and places they name. The search read every report of each of
 * the signal's 20 most-mentioned entities, and "United States" or "Donald
 * Trump" are named in thousands (entity_nodes.signal_ids has no index and no
 * cap). Now it skips entities named in more than BROAD_ENTITY_REPORTS reports
 * (nearly every report shares them, so they connect nothing), searches at most
 * SEARCHED_ENTITIES, and gives up after CONNECTION_SECONDS with the entities
 * still answered. signalEntities alone is what the story page needs.
 */

import { db } from '../db/postgres'
import { longQuery } from './long-query'
import { logger } from './logger'
import { signalsHaveStoryIds } from './stories'
import { staleWhileRevalidate } from './swr-cache'

export const CONNECTION_DAYS = 14
/** Entities named in more reports than this are not searched for connections */
export const BROAD_ENTITY_REPORTS = 2_000
/** At most this many of the signal's entities are searched */
export const SEARCHED_ENTITIES = 8
/** The search for connections gives up after this long; the entities are still answered */
export const CONNECTION_SECONDS = 3
/** Trade figures whose partner country code never resolved: "Australia → Country 554 Wheat Exports" */
export const UNRESOLVED_COUNTRY_SQL = '\\mCountry [0-9]+\\M'
const UUID_SQL = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

export interface SignalEntity { id: string; name: string; type: string; mentionCount: number }

export interface Connection {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  status: string
  reliabilityScore: number
  locationName: string | null
  countryCode: string | null
  tags: string[]
  createdAt: string | null
  alertTier: string | null
  /** The entities this signal shares with the one on the page, most-mentioned first */
  connectedVia: Array<{ id: string; name: string; type: string }>
  /** Share of the page signal's entities this one names (0–1) */
  connectionStrength: number
  sharedEntityCount: number
}

type Row = Record<string, unknown>
const rowsOf = (result: unknown): Row[] => ((result as { rows?: Row[] } | undefined)?.rows ?? [])

/** A signal's entity, with how many reports name it */
interface NamedEntity extends SignalEntity { reports: number }

async function namedEntities(id: string): Promise<NamedEntity[]> {
  const entityRows = rowsOf(await db.raw(`
    SELECT id, type, canonical_name, mention_count, cardinality(signal_ids) AS reports
      FROM entity_nodes
     WHERE ? = ANY(signal_ids)
     ORDER BY mention_count DESC
     LIMIT 20
  `, [id]))
  return entityRows.map(e => ({
    id: String(e.id),
    name: String(e.canonical_name),
    type: String(e.type),
    mentionCount: Number(e.mention_count) || 0,
    reports: Number(e.reports) || 0,
  }))
}

const publicEntity = ({ reports: _reports, ...e }: NamedEntity): SignalEntity => e

/** The people, places and organisations a signal names, most-mentioned first (at most 20) */
export async function signalEntities(id: string): Promise<SignalEntity[]> {
  return (await namedEntities(id)).map(publicEntity)
}

/**
 * The entities to search for connections: the signal's own, without the broad
 * ones; when all are broad, its two narrowest. Most-mentioned first.
 */
export function searchedEntities<T extends { reports: number }>(entities: T[]): T[] {
  const narrow = entities.filter(e => e.reports <= BROAD_ENTITY_REPORTS)
  if (narrow.length > 0) return narrow.slice(0, SEARCHED_ENTITIES)
  const narrowest = new Set([...entities].sort((a, b) => a.reports - b.reports).slice(0, 2))
  return entities.filter(e => narrowest.has(e))
}

export async function signalConnections(id: string, limit: number): Promise<{ connections: Connection[]; entities: SignalEntity[] }> {
  const named = await namedEntities(id)
  const entities = named.map(publicEntity)
  if (entities.length === 0) return { connections: [], entities }
  const searched = searchedEntities(named)

  // Other reports of this story don't count as connections
  const sameStory = await signalsHaveStoryIds()
    ? `AND COALESCE(s.story_id, s.id) IS DISTINCT FROM (SELECT COALESCE(story_id, id) FROM signals WHERE id = ?::uuid)`
    : ''
  const sql = `
    SELECT s.id, s.title, s.summary, s.category, s.severity, s.status,
           s.reliability_score, s.location_name, s.country_code, s.tags,
           s.created_at, s.alert_tier, m.ids, m.names, m.types, m.shared
      FROM (
        SELECT sid,
               array_agg(n.id ORDER BY n.mention_count DESC) AS ids,
               array_agg(n.canonical_name ORDER BY n.mention_count DESC) AS names,
               array_agg(n.type ORDER BY n.mention_count DESC) AS types,
               count(*)::int AS shared
          FROM entity_nodes n
          CROSS JOIN LATERAL unnest(n.signal_ids) AS sid
         WHERE n.id = ANY(?) AND sid <> ? AND sid ~ ?
         GROUP BY sid
      ) m
      JOIN signals s ON s.id = m.sid::uuid
     WHERE s.created_at > now() - make_interval(days => ?)
       AND s.title !~ ?
       ${sameStory}
     ORDER BY m.shared DESC, s.created_at DESC
     LIMIT ?
  `
  const bindings = [
    searched.map(e => e.id), id, UUID_SQL,
    CONNECTION_DAYS, UNRESOLVED_COUNTRY_SQL,
    ...(sameStory ? [id] : []),
    limit,
  ]
  let rows: Row[] = []
  try {
    rows = rowsOf(await longQuery(CONNECTION_SECONDS, trx => trx.raw(sql, bindings)))
  } catch (err) {
    // Too slow (or failed): no connections this time, the entities stand
    logger.warn({ err, signalId: id }, 'signal connections search gave up')
  }

  const connections = rows.map((s): Connection => {
    const ids = Array.isArray(s.ids) ? s.ids.map(String) : []
    const names = Array.isArray(s.names) ? s.names.map(String) : []
    const types = Array.isArray(s.types) ? s.types.map(String) : []
    const shared = Number(s.shared) || names.length
    return {
      id: String(s.id),
      title: String(s.title ?? ''),
      summary: (s.summary as string | null) ?? null,
      category: String(s.category ?? 'other'),
      severity: String(s.severity ?? 'low'),
      status: String(s.status ?? ''),
      reliabilityScore: Number(s.reliability_score) || 0,
      locationName: (s.location_name as string | null) ?? null,
      countryCode: (s.country_code as string | null) ?? null,
      tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
      createdAt: s.created_at ? new Date(s.created_at as string | Date).toISOString() : null,
      alertTier: (s.alert_tier as string | null) ?? null,
      connectedVia: names.slice(0, 5).map((name, i) => ({ id: ids[i] ?? '', name, type: types[i] ?? 'other' })),
      connectionStrength: Math.min(1, shared / searched.length),
      sharedEntityCount: shared,
    }
  })
  return { connections, entities }
}

/** A signal's connections and entities: fresh 10 minutes, then served 6 hours while remade */
export const CONNECTIONS_KEEP = { freshSeconds: 600, staleSeconds: 6 * 3_600 }

/**
 * What GET /api/v1/signals/:id/connections answers, kept (lib/swr-cache.ts).
 * only = 'entities' answers the entities alone, without the search.
 */
export async function connectionsAnswer(id: string, limit: number, only?: string): Promise<{ connections: Connection[]; entities: SignalEntity[]; count: number }> {
  if (only === 'entities') {
    const entities = await staleWhileRevalidate(`signals:entities:v1:${id}`, CONNECTIONS_KEEP, () => signalEntities(id))
    return { connections: [], entities, count: 0 }
  }
  const { connections, entities } = await staleWhileRevalidate(
    `signals:connections:v1:${id}:${limit}`, CONNECTIONS_KEEP, () => signalConnections(id, limit),
  )
  return { connections, entities, count: connections.length }
}
