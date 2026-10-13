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
 */

import { db } from '../db/postgres'
import { signalsHaveStoryIds } from './stories'

export const CONNECTION_DAYS = 14
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

export async function signalConnections(id: string, limit: number): Promise<{ connections: Connection[]; entities: SignalEntity[] }> {
  const entityRows = rowsOf(await db.raw(`
    SELECT id, type, canonical_name, mention_count
      FROM entity_nodes
     WHERE ? = ANY(signal_ids)
     ORDER BY mention_count DESC
     LIMIT 20
  `, [id]))
  const entities: SignalEntity[] = entityRows.map(e => ({
    id: String(e.id),
    name: String(e.canonical_name),
    type: String(e.type),
    mentionCount: Number(e.mention_count) || 0,
  }))
  if (entities.length === 0) return { connections: [], entities }

  // Other reports of this story don't count as connections
  const sameStory = await signalsHaveStoryIds()
    ? `AND COALESCE(s.story_id, s.id) IS DISTINCT FROM (SELECT COALESCE(story_id, id) FROM signals WHERE id = ?::uuid)`
    : ''
  const rows = rowsOf(await db.raw(`
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
  `, [
    entities.map(e => e.id), id, UUID_SQL,
    CONNECTION_DAYS, UNRESOLVED_COUNTRY_SQL,
    ...(sameStory ? [id] : []),
    limit,
  ]))

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
      connectionStrength: Math.min(1, shared / entities.length),
      sharedEntityCount: shared,
    }
  })
  return { connections, entities }
}
