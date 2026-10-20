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
 * no new tables. Each answer is fresh for 10 minutes and then served while
 * one process remakes it (lib/swr-cache.ts), for up to 6 hours.
 *
 * Oct 20, 2026: /entities/anwar-ibrahim-… and /entities/african-union-…
 * answered 500. Their "named with" list compares every entity in the graph
 * with the entity's own reports (entity_nodes.signal_ids has no index), and as
 * the graph grew that passed the pool's 5 seconds. That list now reads the
 * entity's newest 100 reports of the 30 days and only entities seen since
 * then, under its own 7-second limit (lib/long-query.ts); if it still fails,
 * the page shows everything else.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'
import { longQuery } from './long-query'
import { staleWhileRevalidate } from './swr-cache'
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
/** "Named with" reads at most this many of the entity's newest reports (its cost grows with them) */
export const CONNECTION_REPORTS = 100
/**
 * …and may take this long (the pool's limit is 5 seconds). The website gives
 * the whole profile 10 seconds (lib/server-fetch.ts), so on a first view the
 * list gives up in time for the page to show without it, instead of failing.
 */
export const CONNECTION_SECONDS = 7
/** A profile is served while one process remakes it for this long after its 10 minutes */
const PROFILE_STALE_S = 6 * 3_600

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

/**
 * The entities named in the same reports as this one in the last 30 days,
 * most shared reports first. Only the entity's newest CONNECTION_REPORTS
 * reports count, and only entities seen since the oldest of them (with 3 days
 * to spare: an entity's last_seen is its newest report's own time, which can
 * be a little before the report reached us). On a timeout or any failure, an
 * empty list: the rest of the page still shows.
 */
export async function connectionsOf(id: string, ids: string[], since: Date): Promise<Row[]> {
  if (ids.length === 0) return []
  try {
    return rowsOf(await longQuery(CONNECTION_SECONDS, trx => trx.raw(`
      WITH mine AS (
        SELECT id::text AS sid, created_at
          FROM signals
         WHERE id = ANY(?::uuid[]) AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT ?
      )
      SELECT n.id, n.type, n.canonical_name AS name, count(*)::int AS shared
        FROM entity_nodes n
        CROSS JOIN LATERAL unnest(n.signal_ids) AS u(sid)
        JOIN mine m ON m.sid = lower(u.sid)
       WHERE n.id <> ?
         AND n.last_seen >= (SELECT min(created_at) FROM mine) - interval '3 days'
         AND n.signal_ids && (SELECT array_agg(sid) FROM mine)
       GROUP BY n.id, n.type, n.canonical_name
       ORDER BY shared DESC, n.canonical_name
       LIMIT ?
    `, [ids, since, CONNECTION_REPORTS, id, CONNECTIONS_SHOWN])))
  } catch (err) {
    logger.warn({ err, entity: id, reports: ids.length }, 'Entity profile: "named with" list failed, page shown without it')
    return []
  }
}

/** Everything the entity's page shows, or null when there is no such entity */
export async function entityProfile(id: string): Promise<EntityProfile | null> {
  return staleWhileRevalidate(`kg:profile:v2:${id}`, { freshSeconds: PROFILE_TTL, staleSeconds: PROFILE_STALE_S, lockSeconds: 60 }, async () => {
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
          connectionsOf(id, ids, since),
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
