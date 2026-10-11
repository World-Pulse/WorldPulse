/**
 * One-off start-up repair of the Knowledge Graph's entities (plan item 0s,
 * Oct 11, 2026). The first rule-based extraction stored 21,100 "places"
 * (among them "April", "Petroleum Products", "County" and "Trump"), people
 * with their titles ("President Donald Trump", "Minister Keir Starmer"), cut
 * names ("President Bola Ahmed") and job titles as people ("Chief Executive
 * Officer"). Each entity is now cleaned with the new rules
 * (entity-rules.ts): junk is deleted (its edges go with it, ON DELETE
 * CASCADE), commodities typed as places are retyped, and the entities that
 * become the same one are merged (mentions added up, signals, aliases and
 * dates combined). The co-occurrence builder re-links merged entities on its
 * next run. Idempotent: clean entities come out unchanged.
 */

import { pgPool as db } from '../lib/postgres'
import { entityId, type EntityType } from './entity-graph'
import { cleanStoredEntity } from './entity-rules'
import { placesInText } from './geo'

interface NodeRow {
  id: string
  type: string
  canonical_name: string
  aliases: string[] | null
  mention_count: number
  signal_ids: string[] | null
  first_seen: Date | string
  last_seen: Date | string
  metadata: unknown
}

/** Signal ids kept per entity (as upsertEntityNode does) */
const MAX_SIGNAL_IDS = 100

export interface EntityCleanup {
  /** Entities folded into another */
  merged: number
  /** Junk entities deleted */
  removed: number
  /** Entities given another type (commodities stored as places) */
  retyped: number
  /** Entities renamed in place (a title dropped) */
  renamed: number
}

/** Unknown places with fewer mentions than this are dropped; more, and they're kept as they are */
const KEEP_UNKNOWN_PLACE = 20

/**
 * A stored place against the places the rules know: one known place inside
 * the name becomes that place ("France Consultation" and "United Kingdom
 * Public", from GDELT's event labels, become France and United Kingdom);
 * an unknown name is kept only if it was mentioned often (Topeka, Kerala),
 * since the old rule stored any capitalised words after "in".
 */
export function refinePlace(name: string, mentions: number): { type: string; name: string } | null {
  const places = placesInText(name)
  if (places.length === 1) return { type: 'location', name: places[0]! }
  if (places.length === 0 && mentions < KEEP_UNKNOWN_PLACE) return null
  return { type: 'location', name }
}

/** The plan for the stored entities: what to write and what to delete */
export function planEntityCleanup(rows: NodeRow[]): {
  upserts: Array<{ id: string; type: string; name: string; members: NodeRow[] }>
  deletes: string[]
  totals: EntityCleanup
} {
  const groups = new Map<string, { id: string; type: string; name: string; members: NodeRow[] }>()
  const deletes: string[] = []
  const totals: EntityCleanup = { merged: 0, removed: 0, retyped: 0, renamed: 0 }
  for (const row of rows) {
    let cleaned = cleanStoredEntity(row.type, row.canonical_name)
    if (cleaned?.type === 'location') cleaned = refinePlace(cleaned.name, Number(row.mention_count) || 0)
    if (!cleaned) { deletes.push(row.id); totals.removed++; continue }
    const id = entityId(cleaned.type as EntityType, cleaned.name)
    const group = groups.get(id) ?? { id, type: cleaned.type, name: cleaned.name, members: [] }
    group.members.push(row)
    groups.set(id, group)
  }
  const upserts: Array<{ id: string; type: string; name: string; members: NodeRow[] }> = []
  for (const group of groups.values()) {
    const [only] = group.members
    if (group.members.length === 1 && only!.id === group.id && only!.canonical_name === group.name && only!.type === group.type) continue
    upserts.push(group)
    for (const member of group.members) {
      if (member.id !== group.id) deletes.push(member.id)
    }
    if (group.members.length > 1) totals.merged += group.members.length - 1
    if (group.members.some(m => m.type !== group.type)) totals.retyped++
    else if (group.members.length === 1) totals.renamed++
  }
  return { upserts, deletes, totals }
}

const time = (v: Date | string): number => new Date(v).getTime()

export async function cleanEntityGraph(): Promise<EntityCleanup> {
  const { rows } = await db.query(
    `SELECT id, type, canonical_name, aliases, mention_count, signal_ids, first_seen, last_seen, metadata
       FROM entity_nodes`,
  )
  const { upserts, deletes, totals } = planEntityCleanup(rows as NodeRow[])

  for (const group of upserts) {
    const members = [...group.members].sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0))
    const signalIds = [...new Set(members.flatMap(m => m.signal_ids ?? []))].slice(0, MAX_SIGNAL_IDS)
    const aliases = [...new Set(members.flatMap(m => [...(m.aliases ?? []), m.canonical_name]))]
    const firstSeen = new Date(Math.min(...members.map(m => time(m.first_seen)))).toISOString()
    const lastSeen = new Date(Math.max(...members.map(m => time(m.last_seen)))).toISOString()
    const mentions = members.reduce((sum, m) => sum + (Number(m.mention_count) || 0), 0)
    await db.query(
      `INSERT INTO entity_nodes (id, type, canonical_name, aliases, first_seen, last_seen, mention_count, signal_ids, metadata)
       VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8::text[], $9)
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type, canonical_name = EXCLUDED.canonical_name, aliases = EXCLUDED.aliases,
         first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
         mention_count = EXCLUDED.mention_count, signal_ids = EXCLUDED.signal_ids, metadata = EXCLUDED.metadata`,
      [group.id, group.type, group.name, aliases, firstSeen, lastSeen, mentions, signalIds, JSON.stringify(members[0]?.metadata ?? {})],
    )
  }

  // Their edges go with them (ON DELETE CASCADE)
  for (let i = 0; i < deletes.length; i += 1000) {
    await db.query('DELETE FROM entity_nodes WHERE id = ANY($1::text[])', [deletes.slice(i, i + 1000)])
  }
  return totals
}
