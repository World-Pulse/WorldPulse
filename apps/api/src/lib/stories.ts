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

/**
 * Collapses rows (newest first) into one entry per story, in order of each
 * story's newest row. The row shown for a story is its best member in the
 * batch: verified before pending, then the most reliable, then the newest.
 * `lastIndex` is the index of the last row that belongs to the stories kept,
 * so the next page can start after it.
 */
export function collapseStories<T extends { id?: unknown; story_id?: unknown; status?: unknown; reliability_score?: unknown }>(
  rows: T[],
  max: number,
): { stories: Array<{ key: string; row: T }>; lastIndex: number; more: boolean } {
  const order: string[] = []
  const best = new Map<string, T>()
  let lastIndex = -1
  let more = false
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const key = storyKeyOf(row)
    if (!key) continue
    const held = best.get(key)
    if (!held) {
      if (order.length >= max) { more = true; break }
      order.push(key)
      best.set(key, row)
    } else if (better(row, held)) {
      best.set(key, row)
    }
    lastIndex = i
  }
  return { stories: order.map(key => ({ key, row: best.get(key)! })), lastIndex, more }
}

function better(a: { status?: unknown; reliability_score?: unknown }, b: { status?: unknown; reliability_score?: unknown }): boolean {
  const sa = STATUS_RANK[String(a.status)] ?? 0
  const sb = STATUS_RANK[String(b.status)] ?? 0
  if (sa !== sb) return sa > sb
  return Number(a.reliability_score ?? 0) > Number(b.reliability_score ?? 0)
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
            array_remove(array_agg(DISTINCT u.url), NULL) AS urls
       FROM signals s
       LEFT JOIN LATERAL unnest(s.original_urls) AS u(url) ON true
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
