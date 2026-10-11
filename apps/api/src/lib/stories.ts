/**
 * Stories: signals the scraper's same-story rule grouped share signals.story_id
 * (the id of the story's first signal); a signal no story has claimed has
 * story_id NULL and is its own story. Plan item 12b
 * (.hq/departments/product/story-view-plan.md): the feed can return one row
 * per story, with how many signals and which outlets it has.
 */

import { db } from '../db/postgres'

/** How long a "the column isn't there yet" answer is trusted before checking again */
const RECHECK_MS = 5 * 60_000

let storyColumn: { ok: boolean; at: number } | null = null

/**
 * Whether signals.story_id exists. The scraper adds it at start-up, so the API
 * may briefly run without it; a missing column is checked again after 5 minutes.
 */
export async function signalsHaveStoryIds(): Promise<boolean> {
  if (storyColumn && (storyColumn.ok || Date.now() - storyColumn.at < RECHECK_MS)) return storyColumn.ok
  try {
    const ok = await db.schema.hasColumn('signals', 'story_id')
    storyColumn = { ok, at: Date.now() }
    return ok
  } catch {
    return false
  }
}

/** The story a signal row belongs to: its story_id, or its own id */
export function storyKeyOf(row: { id?: unknown; story_id?: unknown }): string {
  return String(row.story_id ?? row.id ?? '')
}

const STATUS_RANK: Record<string, number> = { verified: 2, pending: 1 }

/** How to read a row: its story key, and the status and reliability that pick the row shown */
export interface StoryRowReader<T> {
  key(row: T): string
  status(row: T): unknown
  reliability(row: T): unknown
}

/** Signal rows: story_id (or their own id), status, reliability_score */
const SIGNAL_ROWS: StoryRowReader<{ id?: unknown; story_id?: unknown; status?: unknown; reliability_score?: unknown }> = {
  key: storyKeyOf,
  status: row => row.status,
  reliability: row => row.reliability_score,
}

/**
 * Collapses rows (newest first) into one entry per story, in order of each
 * story's newest row. The row shown for a story is its best member in the
 * batch: verified before pending, then the most reliable, then the newest.
 * `lastIndex` is the index of the last row that belongs to the stories kept,
 * so the next page can start after it. Signal rows by default; pass a reader
 * for other rows (feed posts carry their signal's story).
 */
export function collapseStories<T>(
  rows: T[],
  max: number,
  reader: StoryRowReader<T> = SIGNAL_ROWS as unknown as StoryRowReader<T>,
): { stories: Array<{ key: string; row: T }>; lastIndex: number; more: boolean } {
  const order: string[] = []
  const best = new Map<string, T>()
  let lastIndex = -1
  let more = false
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const key = reader.key(row)
    if (!key) continue
    const held = best.get(key)
    if (held === undefined) {
      if (order.length >= max) { more = true; break }
      order.push(key)
      best.set(key, row)
    } else if (better(reader, row, held)) {
      best.set(key, row)
    }
    lastIndex = i
  }
  return { stories: order.map(key => ({ key, row: best.get(key)! })), lastIndex, more }
}

function better<T>(reader: StoryRowReader<T>, a: T, b: T): boolean {
  const sa = STATUS_RANK[String(reader.status(a))] ?? 0
  const sb = STATUS_RANK[String(reader.status(b))] ?? 0
  if (sa !== sb) return sa > sb
  return Number(reader.reliability(a) ?? 0) > Number(reader.reliability(b) ?? 0)
}

/** Prefix of the key of a feed post that isn't an automated signal post: never grouped */
export const OWN_POST_KEY = 'post:'

/**
 * Feed posts (GET /feed/global rows): an automated signal post belongs to its
 * signal's story; any other post (people's posts, threads, polls) is its own.
 */
export const FEED_POST_ROWS: StoryRowReader<Record<string, unknown>> = {
  key: row => (row.post_type === 'signal' && row.signal_id
    ? String(row.story_id ?? row.signal_id)
    : `${OWN_POST_KEY}${String(row.id ?? '')}`),
  status: row => row.signal_status,
  reliability: row => row.signal_reliability,
}

/** A website from an article address, without "www." ("" when it isn't one) */
export function hostOf(url: unknown): string {
  if (typeof url !== 'string') return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Distinct websites across a story's article links, in the order first seen, at most `max` */
export function outletsOf(urls: unknown[], max = 12): string[] {
  const seen = new Set<string>()
  for (const u of urls) {
    const host = hostOf(u)
    if (host) seen.add(host)
    if (seen.size >= max) break
  }
  return [...seen]
}

export interface StoryFacts {
  /** Signals in the story */
  size: number
  /** Websites that reported it, from every member's links */
  outlets: string[]
  /** When the story first turned verified */
  verifiedAt: Date | null
  /** Its newest signal */
  newest: Date | null
}

/** Size, outlets and first verification for each story key, over all of its signals */
export async function storyFacts(keys: string[]): Promise<Map<string, StoryFacts>> {
  const facts = new Map<string, StoryFacts>()
  const unique = [...new Set(keys.filter(Boolean))]
  if (unique.length === 0) return facts
  const result = await db.raw(
    `SELECT COALESCE(s.story_id, s.id)::text AS story_key,
            count(DISTINCT s.id)::int AS size,
            min(s.verified_at) AS verified_at,
            max(s.created_at) AS newest,
            array_remove(array_agg(u.url ORDER BY s.created_at, u.ord), NULL) AS urls
       FROM signals s
       LEFT JOIN LATERAL unnest(s.original_urls) WITH ORDINALITY AS u(url, ord) ON true
      WHERE s.story_id = ANY(?::uuid[]) OR s.id = ANY(?::uuid[])
      GROUP BY 1`,
    [unique, unique],
  )
  for (const r of (result as { rows?: Array<Record<string, unknown>> }).rows ?? []) {
    facts.set(String(r.story_key), {
      size: Number(r.size) || 1,
      outlets: outletsOf(Array.isArray(r.urls) ? r.urls : []),
      verifiedAt: r.verified_at ? new Date(r.verified_at as string) : null,
      newest: r.newest ? new Date(r.newest as string) : null,
    })
  }
  return facts
}
