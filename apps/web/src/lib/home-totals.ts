/**
 * The home page's day totals (plan N1, fixed Oct 23, 2026), from the server's
 * status file, ops-status.json, remade every half hour: the stories that
 * reached verified in the last 24 hours and the sources the scraper reads.
 * The first version of the line counted one page of the stories list ("20+",
 * against about 800 a day) and the sources API's database table (19 of the
 * 651 sources read: the news feeds aren't in that table).
 */
import { cachedFetch } from '@/lib/server-fetch'
import { SITE_URL } from '@/lib/page-metadata'

export interface HomeTotals { verified24h: number | null; sources: number | null }

const NONE: HomeTotals = { verified24h: null, sources: null }

/** A count, or null for anything that isn't a positive number */
const countOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * The totals in a status file: pipeline.db is the database's answers in a
 * fixed order (each null when it failed or ran out of time), one of them
 * holding stories_verified_24h; pipeline.sources.tracked is the sources read.
 */
export function totalsOf(status: unknown): HomeTotals {
  if (!status || typeof status !== 'object') return NONE
  const pipeline = (status as { pipeline?: unknown }).pipeline
  if (!pipeline || typeof pipeline !== 'object') return NONE
  const { db, sources } = pipeline as { db?: unknown; sources?: unknown }
  const answers: unknown[] = Array.isArray(db) ? db : []
  const stories = answers.find((x): x is { stories_verified_24h?: unknown } => !!x && typeof x === 'object' && 'stories_verified_24h' in x)
  const tracked = sources && typeof sources === 'object' ? (sources as { tracked?: unknown }).tracked : undefined
  return { verified24h: countOf(stories?.stories_verified_24h), sources: countOf(tracked) }
}

/** How long the totals are kept, and how long a failed read is not retried */
const KEEP_MS = 600_000
/** One read of the status file waits at most this long: the page never hangs on it */
const WAIT_MS = 3_000
let failedAt = 0

/**
 * The day's totals, kept 10 minutes; nulls when the status file doesn't
 * answer, and then for 10 minutes without asking again (the page shows the
 * stories list's own count meanwhile)
 */
export async function fetchHomeTotals(now = Date.now()): Promise<HomeTotals> {
  if (failedAt && now - failedAt < KEEP_MS) return NONE
  try {
    const res = await cachedFetch(`${SITE_URL}/ops-status.json`, KEEP_MS, WAIT_MS)
    if (!res.ok) { failedAt = now; return NONE }
    return totalsOf(await res.json())
  } catch {
    failedAt = now
    return NONE
  }
}

/** (tests) forget a failed read */
export function resetHomeTotals(): void {
  failedAt = 0
}
