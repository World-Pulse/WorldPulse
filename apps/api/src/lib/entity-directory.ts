/**
 * Who's in the news (Oct 13, 2026): the people, places and organisations
 * named in the most reports in the last 7 days, for world-pulse.io/entities,
 * the index of the entity pages (lib/entity-profile.ts). One pass over the
 * last 14 days of reports naming each entity, kept for 30 minutes.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'

export interface DirectoryEntity {
  id: string
  type: string
  name: string
  last24h: number
  last7d: number
  previous7d: number
  /** how many times more than the 7 days before; null with fewer than 3 reports before */
  change: number | null
}

export interface DirectoryGroup {
  key: 'people' | 'places' | 'organisations' | 'more'
  label: string
  entities: DirectoryEntity[]
}

export interface EntityDirectory {
  groups: DirectoryGroup[]
  /** entities named in 3 or more reports in the last 7 days */
  total: number
  generatedAt: string
}

/** Entities listed per group */
export const PER_GROUP = 30
/** Reports in 7 days to be listed at all (as the sitemap: a page worth reading) */
export const MIN_REPORTS = 3

const CACHE_KEY = 'kg:api:directory:v1'
const CACHE_TTL = 1_800

const GROUPS: Array<{ key: DirectoryGroup['key']; label: string; types: string[] | null }> = [
  { key: 'people', label: 'People', types: ['person'] },
  { key: 'places', label: 'Places', types: ['location'] },
  { key: 'organisations', label: 'Organizations', types: ['organisation'] },
  { key: 'more', label: 'Events, laws, commodities and technology', types: null },
]

/** Rows of counts → the page's groups, most named first */
export function directoryGroups(rows: Array<Omit<DirectoryEntity, 'change'>>, perGroup = PER_GROUP): DirectoryGroup[] {
  const listed = rows
    .filter(r => r.last7d >= MIN_REPORTS && r.name.trim() !== '')
    .map(r => ({
      ...r,
      name: r.name.trim(),
      change: r.previous7d >= 3 ? Math.round((r.last7d / r.previous7d) * 10) / 10 : null,
    }))
    .sort((a, b) => b.last7d - a.last7d || b.last24h - a.last24h || a.name.localeCompare(b.name))
  const typed = new Set(GROUPS.flatMap(g => g.types ?? []))
  return GROUPS.map(g => ({
    key: g.key,
    label: g.label,
    entities: listed.filter(r => (g.types ? g.types.includes(r.type) : !typed.has(r.type))).slice(0, perGroup),
  }))
}

/** The directory, from the cache when it's there */
export async function entityDirectory(): Promise<EntityDirectory> {
  const cached = await redis.get(CACHE_KEY).catch(() => null)
  if (cached) return JSON.parse(cached) as EntityDirectory

  const now = Date.now()
  const day = new Date(now - 86_400_000).toISOString()
  const week = new Date(now - 7 * 86_400_000).toISOString()
  const fortnight = new Date(now - 14 * 86_400_000).toISOString()
  // (signal ids are text in entity rows, as in GET /trending and /sitemap)
  const result = await db.raw(
    `SELECT n.id, n.type, n.canonical_name AS name,
            count(*) FILTER (WHERE s.created_at >= ?)::int AS last24h,
            count(*) FILTER (WHERE s.created_at >= ?)::int AS last7d,
            count(*) FILTER (WHERE s.created_at <  ?)::int AS previous7d
       FROM entity_nodes n
       CROSS JOIN LATERAL unnest(n.signal_ids) AS u(sid)
       JOIN signals s ON s.id::text = lower(u.sid)
      WHERE n.last_seen >= ? AND s.created_at >= ?
      GROUP BY n.id, n.type, n.canonical_name
     HAVING count(*) FILTER (WHERE s.created_at >= ?) >= ?`,
    [day, week, week, week, fortnight, week, MIN_REPORTS],
  )
  const rows = ((result.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: String(r.id),
    type: String(r.type ?? ''),
    name: String(r.name ?? ''),
    last24h: Number(r.last24h) || 0,
    last7d: Number(r.last7d) || 0,
    previous7d: Number(r.previous7d) || 0,
  }))
  const directory: EntityDirectory = {
    groups: directoryGroups(rows),
    total: rows.filter(r => r.last7d >= MIN_REPORTS).length,
    generatedAt: new Date(now).toISOString(),
  }
  redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(directory)).catch(() => {})
  return directory
}
