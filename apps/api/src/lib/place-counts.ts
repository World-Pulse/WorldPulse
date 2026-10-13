/**
 * How many reports name a place, for the reference pages' "related reports"
 * counts (/food-security, /ai-infrastructure). Those lists ran one
 * `location_name ILIKE '%<place>%'` count per row, up to 200 a request, each
 * reading the whole signals table: a page that wasn't cached waited 6–10 s
 * (page audit, Oct 13, 2026). Now one grouped query per kind of count, kept
 * for 10 minutes, and the matching is done here.
 *
 * The counts are also kept in Redis, shared by the API's processes, and
 * served while a fresh count is made in the background: the count over all
 * reports takes about 5 s, and each process used to make it every 10 minutes
 * while a visitor waited (lib/swr-cache.ts).
 */

import { db } from '../db/postgres'
import { staleWhileRevalidate } from './swr-cache'

export type PlaceCounts = Array<[name: string, reports: number]>

const TTL_MS = 10 * 60_000
const cache = new Map<string, { at: number; counts: PlaceCounts }>()

/** Reports per place name (lowercase): in the last `days` days if given, of `categories` if given */
export async function placeCounts(opts: { days?: number; categories?: string[] } = {}): Promise<PlaceCounts> {
  const key = `${opts.days ?? 'all'}:${(opts.categories ?? []).join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.counts
  const counts = await staleWhileRevalidate(`places:counts:v1:${key}`, { freshSeconds: TTL_MS / 1000, staleSeconds: 3_600 }, async () => {
    let q = db('signals').whereNotNull('location_name').select('location_name').count('id as n').groupBy('location_name')
    if (opts.days) q = q.where('created_at', '>', new Date(Date.now() - opts.days * 86_400_000).toISOString())
    if (opts.categories?.length) q = q.whereIn('category', opts.categories)
    const rows = await q as Array<{ location_name: unknown; n: unknown }>
    return rows.map((r): [string, number] => [String(r.location_name).toLowerCase(), Number(r.n) || 0])
  })
  cache.set(key, { at: Date.now(), counts })
  return counts
}

/** Reports whose place name contains `place`, ignoring case: what ILIKE '%place%' counted */
export function countFor(counts: PlaceCounts, place: string): number {
  const p = place.trim().toLowerCase()
  if (!p) return 0
  let n = 0
  for (const [name, c] of counts) if (name.includes(p)) n += c
  return n
}

/** (tests) forget what's kept */
export function clearPlaceCounts(): void { cache.clear() }
