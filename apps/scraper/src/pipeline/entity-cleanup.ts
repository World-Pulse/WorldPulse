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
import { cleanStoredEntity, listedPlace } from './entity-rules'
import { placesInText } from './geo'

/** What the plan reads of each entity */
interface NameRow {
  id: string
  type: string
  canonical_name: string
  mention_count: number
}

interface NodeRow extends NameRow {
  aliases: string[] | null
  signal_ids: string[] | null
  first_seen: Date | string
  last_seen: Date | string
  metadata: unknown
}

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
 * since the old rule stored any capitalised words after "in". The cities and
 * states of the newer list (world-places.ts, Oct 22) are known places too
 * (Nov 20, 2026): this repair runs at every start, and it deleted the 635 of
 * the list's 2,080 places the gazetteer doesn't know ("Naucalpan de Juárez",
 * "São Bernardo do Campo") whenever they had fewer than 20 mentions, so their
 * reports lost the link after every update of the site.
 */
export function refinePlace(name: string, mentions: number): { type: string; name: string } | null {
  const places = placesInText(name)
  if (places.length === 1) return { type: 'location', name: places[0]! }
  const listed = listedPlace(name)
  if (listed) return { type: 'location', name: listed }
  if (places.length === 0 && mentions < KEEP_UNKNOWN_PLACE) return null
  return { type: 'location', name }
}

/** The plan for the stored entities: what to write and what to delete */
export function planEntityCleanup<R extends NameRow>(rows: R[]): {
  upserts: Array<{ id: string; type: string; name: string; members: R[] }>
  deletes: string[]
  totals: EntityCleanup
} {
  const groups = new Map<string, { id: string; type: string; name: string; members: R[] }>()
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
  const upserts: Array<{ id: string; type: string; name: string; members: R[] }> = []
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

/**
 * Every report of the entities folded into one (Nov 20, 2026). Only 100 were kept, the first 100 in id order: the
 * repair runs at every start, so a name with a variant to fold in lost the rest of its reports after every update of
 * the site (Mexico, named in 2,867 reports, kept 101; "Mexico Beach" had been folded in), and the share of the week's
 * reports linked to a named person, place or organisation fell with it.
 */
export function mergedSignalIds(members: ReadonlyArray<Pick<NodeRow, 'signal_ids'>>): string[] {
  return [...new Set(members.flatMap(m => m.signal_ids ?? []))]
}

/** The full rows of the entities to fold together, read for those alone, 500 at a time */
async function fullRows(ids: string[]): Promise<Map<string, NodeRow>> {
  const out = new Map<string, NodeRow>()
  for (let i = 0; i < ids.length; i += 500) {
    const { rows } = await db.query(
      `SELECT id, type, canonical_name, aliases, mention_count, signal_ids, first_seen, last_seen, metadata
         FROM entity_nodes WHERE id = ANY($1::text[])`,
      [ids.slice(i, i + 500)],
    )
    for (const row of rows as NodeRow[]) out.set(row.id, row)
  }
  return out
}

export async function cleanEntityGraph(): Promise<EntityCleanup> {
  // Names first, and the report ids only of the entities to fold together (Nov 20, 2026): every start read every
  // entity's list of reports (the United States alone holds 30,898) to change a handful
  const { rows } = await db.query('SELECT id, type, canonical_name, mention_count FROM entity_nodes')
  const { upserts, deletes, totals } = planEntityCleanup(rows as NameRow[])
  const full = await fullRows(upserts.flatMap(group => group.members.map(m => m.id)))

  for (const group of upserts) {
    const members = group.members.map(m => full.get(m.id)).filter((m): m is NodeRow => m !== undefined)
      .sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0))
    if (!members.length) continue
    const signalIds = mergedSignalIds(members)
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
         mention_count = EXCLUDED.mention_count, metadata = EXCLUDED.metadata,
         -- and the reports linked to it since it was read
         signal_ids = (SELECT array_agg(DISTINCT s) FROM unnest(entity_nodes.signal_ids || EXCLUDED.signal_ids) AS u(s))`,
      [group.id, group.type, group.name, aliases, firstSeen, lastSeen, mentions, signalIds, JSON.stringify(members[0]?.metadata ?? {})],
    )
  }

  // Their edges go with them (ON DELETE CASCADE)
  for (let i = 0; i < deletes.length; i += 1000) {
    await db.query('DELETE FROM entity_nodes WHERE id = ANY($1::text[])', [deletes.slice(i, i + 1000)])
  }
  return totals
}
