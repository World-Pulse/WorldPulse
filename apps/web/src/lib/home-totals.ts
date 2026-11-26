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
export function totalsOf(status: unknown, now = Date.now()): HomeTotals {
  if (!status || typeof status !== 'object') return NONE
  const pipeline = (status as { pipeline?: unknown }).pipeline
  if (!pipeline || typeof pipeline !== 'object') return NONE
  const { db, sources, sources_last } = pipeline as { db?: unknown; sources?: unknown; sources_last?: unknown }
  const answers: unknown[] = Array.isArray(db) ? db : []
  const stories = answers.find((x): x is { stories_verified_24h?: unknown } => !!x && typeof x === 'object' && 'stories_verified_24h' in x)
  const tracked = sources && typeof sources === 'object' ? (sources as { tracked?: unknown }).tracked : undefined
  return { verified24h: countOf(stories?.stories_verified_24h), sources: countOf(tracked) ?? lastTracked(sources_last, now) }
}

/**
 * The status file's own copy of the last sources count it read (pipeline.sources_last, kept on the server across
 * restarts), used for a day when this pass could not count them; null when it is older or has no time
 */
function lastTracked(last: unknown, now: number): number | null {
  if (!last || typeof last !== 'object') return null
  const { tracked, at } = last as { tracked?: unknown; at?: unknown }
  const when = typeof at === 'string' ? Date.parse(at) : NaN
  if (!Number.isFinite(when) || now - when >= SOURCES_KEEP_MS || when - now > 3_600_000) return null
  return countOf(tracked)
}

/** How long the totals are kept, and how long a failed read is not retried */
const KEEP_MS = 600_000
/** One read of the status file waits at most this long: the page never hangs on it */
const WAIT_MS = 3_000
let failedAt = 0

/**
 * The last sources count read, and when, used for a day when a read of the status file has none (Nov 25, 2026:
 * from about 7 PM the server's status pass didn't finish its count of the sources under launch week's load,
 * "Not read this time: sources", and the Sources page, the home page and How we count lost their "1,442 sources
 * read"). The count moves slowly, so the last one read stays right; never a guess when none was read.
 */
const SOURCES_KEEP_MS = 24 * 3_600_000
let lastSources: { n: number; at: number } | null = null

function withLastSources(totals: HomeTotals, now: number): HomeTotals {
  if (totals.sources) {
    lastSources = { n: totals.sources, at: now }
    return totals
  }
  if (lastSources && now - lastSources.at < SOURCES_KEEP_MS) return { ...totals, sources: lastSources.n }
  return totals
}

/**
 * The day's totals, kept 10 minutes; nulls when the status file doesn't
 * answer, and then for 10 minutes without asking again (the page shows the
 * stories list's own count meanwhile)
 */
export async function fetchHomeTotals(now = Date.now()): Promise<HomeTotals> {
  if (failedAt && now - failedAt < KEEP_MS) return withLastSources(NONE, now)
  try {
    const res = await cachedFetch(`${SITE_URL}/ops-status.json`, KEEP_MS, WAIT_MS)
    if (!res.ok) { failedAt = now; return withLastSources(NONE, now) }
    return withLastSources(totalsOf(await res.json(), now), now)
  } catch {
    failedAt = now
    return withLastSources(NONE, now)
  }
}

/** (tests) forget a failed read and the last sources count */
export function resetHomeTotals(): void {
  failedAt = 0
  lastSources = null
}
