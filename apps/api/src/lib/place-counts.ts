/**
 * How many reports name a place, for the reference pages' "related reports"
 * counts (/food-security, /ai-infrastructure). Those lists ran one
 * `location_name ILIKE '%<place>%'` count per row, up to 200 a request, each
 * reading the whole signals table: a page that wasn't cached waited 6–10 s
 * (page audit, Oct 13, 2026). Now one grouped query per kind of count, kept
 * for 10 minutes, and the matching is done here.
 */

import { db } from '../db/postgres'

export type PlaceCounts = Array<[name: string, reports: number]>

const TTL_MS = 10 * 60_000
const cache = new Map<string, { at: number; counts: PlaceCounts }>()

/** Reports per place name (lowercase): in the last `days` days if given, of `categories` if given */
export async function placeCounts(opts: { days?: number; categories?: string[] } = {}): Promise<PlaceCounts> {
  const key = `${opts.days ?? 'all'}:${(opts.categories ?? []).join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.counts
  let q = db('signals').whereNotNull('location_name').select('location_name').count('id as n').groupBy('location_name')
  if (opts.days) q = q.where('created_at', '>', new Date(Date.now() - opts.days * 86_400_000).toISOString())
  if (opts.categories?.length) q = q.whereIn('category', opts.categories)
  const rows = await q as Array<{ location_name: unknown; n: unknown }>
  const counts: PlaceCounts = rows.map(r => [String(r.location_name).toLowerCase(), Number(r.n) || 0])
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
