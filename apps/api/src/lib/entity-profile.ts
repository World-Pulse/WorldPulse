/**
 * One page per person, place or organisation in the knowledge graph (Devon,
 * Oct 12, 2026: "the knowledge tree brings in a lot of value, how can we
 * enhance that?"). GET /api/v1/knowledge-graph/entities/:id/profile answers
 * what the page at world-pulse.io/entities/<name>-<id> shows:
 *
 *   - the entity: its name and kind (not its stored aliases: the old rules
 *     saved fragments like "After Iran Rejects" as names for Iran);
 *   - activity: reports naming it in the last 24 hours and 7 days, and per day
 *     for 30 days (UTC), from the reports' own times;
 *   - stories: the stories naming it in the last 14 days that two or more
 *     outlets reported, ranked as the home page ranks stories;
 *   - latest: its newest reports, for entities few outlets cover;
 *   - connections: the entities named in the same reports in the last 30
 *     days, most shared reports first.
 *
 * GET .../entities/:id/with/:other answers the stories naming both, so a
 * reader can see why two entities are connected.
 *
 * Reads entity_nodes.signal_ids (the reports naming each entity) and signals;
 * no new tables. Each answer is kept for 10 minutes.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { storiesOfSignals } from '../routes/stories'
import { signalsHaveStoryIds } from './stories'
import type { ListedStory } from './story-list'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 86_400_000
export const PROFILE_TTL = 600
export const ACTIVITY_DAYS = 30
export const STORY_DAYS = 14
const STORIES_SHOWN = 10
const LATEST_SHOWN = 8
const CONNECTIONS_SHOWN = 12

export interface EntityProfile {
  entity: {
    id: string
    type: string
    name: string
    firstSeen: string | null
    lastSeen: string | null
  }
  activity: {
    last24h: number
    previous24h: number
    last7d: number
    /** One entry per UTC day, oldest first, ACTIVITY_DAYS of them (zero days included) */
    daily: Array<{ day: string; n: number }>
  }
  stories: ListedStory[]
  /** Newest reports naming it that aren't part of a story listed above */
  latest: Array<{ id: string; title: string; category: string | null; severity: string | null; place: string | null; verified: boolean; createdAt: string }>
  connections: Array<{ id: string; type: string; name: string; shared: number }>
}

type Row = Record<string, unknown>
const rowsOf = (result: unknown): Row[] => ((result as { rows?: Row[] } | undefined)?.rows ?? [])
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = new Date(v as string | Date)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** The report ids an entity row points at: well-formed, lowercase, each once */
export function mentionIds(signalIds: unknown): string[] {
  if (!Array.isArray(signalIds)) return []
  return [...new Set(signalIds.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)).map(v => v.toLowerCase()))]
}

/** ACTIVITY_DAYS UTC days ending today, each with its count (missing days are 0) */
export function dailySeries(counts: Map<string, number>, now = Date.now()): Array<{ day: string; n: number }> {
  const out: Array<{ day: string; n: number }> = []
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const day = new Date(today - i * DAY_MS).toISOString().slice(0, 10)
    out.push({ day, n: counts.get(day) ?? 0 })
  }
  return out
}

async function cached<T>(key: string, build: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key).catch(() => null)
  if (hit) {
    try { return JSON.parse(hit) as T } catch { /* rebuild */ }
  }
  const value = await build()
  redis.setex(key, PROFILE_TTL, JSON.stringify(value)).catch(() => {})
  return value
}

/** The newest reports among `ids`, leaving out those of the stories already listed (`skipStories`: story keys) */
async function latestReports(ids: string[], skipStories: Set<string> = new Set()): Promise<EntityProfile['latest']> {
  if (ids.length === 0) return []
  const storyKey = await signalsHaveStoryIds() ? 'COALESCE(story_id, id)::text' : 'id::text'
  const rows = rowsOf(await db.raw(`
    SELECT id::text AS id, ${storyKey} AS story_key, title, category::text AS category, severity::text AS severity,
           location_name, status::text AS status, created_at
      FROM signals
     WHERE id = ANY(?::uuid[]) AND status IN ('verified', 'pending')
     ORDER BY created_at DESC
     LIMIT ?
  `, [ids, LATEST_SHOWN + 12]))
  return rows.flatMap(r => {
    const createdAt = iso(r.created_at)
    if (!createdAt || typeof r.title !== 'string' || r.title.trim() === '') return []
    if (skipStories.has(String(r.story_key))) return []
    return [{
      id: String(r.id),
      title: r.title.trim(),
      category: (r.category as string | null) ?? null,
      severity: (r.severity as string | null) ?? null,
      place: typeof r.location_name === 'string' && r.location_name.trim() ? r.location_name.trim() : null,
      verified: r.status === 'verified',
      createdAt,
    }]
  }).slice(0, LATEST_SHOWN)
}

/** Everything the entity's page shows, or null when there is no such entity */
export async function entityProfile(id: string): Promise<EntityProfile | null> {
  return cached(`kg:profile:v1:${id}`, async () => {
    const row = rowsOf(await db.raw(`
      SELECT id, type, canonical_name, first_seen, last_seen, signal_ids
        FROM entity_nodes WHERE id = ?
    `, [id]))[0]
    if (!row) return null
    const name = String(row.canonical_name ?? '').trim()
    const ids = mentionIds(row.signal_ids)
    const now = Date.now()
    const since = new Date(now - ACTIVITY_DAYS * DAY_MS)

    // The stories naming it, then its newest reports outside those stories
    const storiesAndLatest = async (): Promise<[ListedStory[], EntityProfile['latest']]> => {
      const stories = await storiesOfSignals(ids, STORY_DAYS * 24, STORIES_SHOWN)
      return [stories, await latestReports(ids, new Set(stories.map(st => st.id)))]
    }
    const [activityRows, [stories, latest], connectionRows] = ids.length === 0
      ? [[], [[], []], []] as [Row[], [ListedStory[], EntityProfile['latest']], Row[]]
      : await Promise.all([
          db.raw(`
            SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                   count(*)::int AS n,
                   count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS last24,
                   count(*) FILTER (WHERE created_at >= now() - interval '48 hours'
                                      AND created_at <  now() - interval '24 hours')::int AS prev24,
                   count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7
              FROM signals
             WHERE id = ANY(?::uuid[]) AND created_at >= ?
             GROUP BY 1
          `, [ids, since]).then(rowsOf),
          storiesAndLatest(),
          db.raw(`
            WITH mine AS (
              SELECT id::text AS sid FROM signals WHERE id = ANY(?::uuid[]) AND created_at >= ?
            )
            SELECT n.id, n.type, n.canonical_name AS name, count(*)::int AS shared
              FROM entity_nodes n
              CROSS JOIN LATERAL unnest(n.signal_ids) AS u(sid)
              JOIN mine m ON m.sid = lower(u.sid)
             WHERE n.id <> ? AND n.signal_ids && (SELECT array_agg(sid) FROM mine)
             GROUP BY n.id, n.type, n.canonical_name
             ORDER BY shared DESC, n.canonical_name
             LIMIT ?
          `, [ids, since, id, CONNECTIONS_SHOWN]).then(rowsOf),
        ])

    const perDay = new Map<string, number>()
    let last24h = 0, previous24h = 0, last7d = 0
    for (const r of activityRows) {
      perDay.set(String(r.day), Number(r.n) || 0)
      last24h += Number(r.last24) || 0
      previous24h += Number(r.prev24) || 0
      last7d += Number(r.last7) || 0
    }

    const profile: EntityProfile = {
      entity: {
        id: String(row.id),
        type: String(row.type ?? 'other'),
        name,
        firstSeen: iso(row.first_seen),
        lastSeen: iso(row.last_seen),
      },
      activity: { last24h, previous24h, last7d, daily: dailySeries(perDay, now) },
      stories,
      latest,
      connections: connectionRows.map(r => ({
        id: String(r.id), type: String(r.type ?? 'other'), name: String(r.name ?? ''), shared: Number(r.shared) || 0,
      })).filter(c => c.name !== ''),
    }
    return profile
  })
}

/** The stories naming both entities (last 30 days), or null when either is unknown */
export async function sharedStories(id: string, other: string): Promise<{ stories: ListedStory[]; latest: EntityProfile['latest'] } | null> {
  const [a, b] = [id, other].sort()
  return cached(`kg:with:v1:${a}:${b}`, async () => {
    const rows = rowsOf(await db.raw(`SELECT id, signal_ids FROM entity_nodes WHERE id = ANY(?)`, [[id, other]]))
    if (rows.length < 2) return null
    const sets = rows.map(r => new Set(mentionIds(r.signal_ids)))
    const both = [...sets[0]!].filter(s => sets[1]!.has(s))
    const stories = await storiesOfSignals(both, ACTIVITY_DAYS * 24, 8)
    const latest = await latestReports(both, new Set(stories.map(st => st.id)))
    return { stories, latest }
  })
}
