/**
 * A story's outlet count covers its last two days (Devon, Oct 20, 2026,
 * option 1). A new report joins a story when it matches any of its reports,
 * so a story can run on for days: Oct 20's biggest said 143 outlets and went
 * back to an attack ten days before. So the number shown with a story counts
 * the websites that reported it in the two days up to its newest report, and
 * a story that has run longer also says how many have reported it since it
 * began: "48 outlets in its last 2 days · 143 since Oct 10". The API sets the
 * window (apps/api/src/lib/story-window.ts).
 */

export const STORY_COUNT_DAYS = 2

export interface StoryOutletCounts {
  /** Websites that reported it in its last two days */
  outlets: number
  /** Websites that have reported it since it began, never fewer */
  outletsAll: number
  /** When its first report came in (ISO), when known */
  firstReportAt: string | null
  /** Whether any of its reports is verified, when the API says */
  verified?: boolean
  /** The story's id (its first report's, or the story id its reports share), when the API says */
  storyId?: string
  /** How many countries its last two days' outlets are from, when the API says (lib/story-reach.ts) */
  countries?: number
  /** The story's one page for search engines (its first verified report with a real headline), when it has one */
  canonicalId?: string
}

/** One story's counts from GET /api/v1/stories/outlets, or null when it gives none */
export function storyCountsOf(v: unknown): StoryOutletCounts | null {
  const o = (v ?? {}) as { outlets?: unknown; outletsAll?: unknown; firstReportAt?: unknown; verified?: unknown; storyId?: unknown; countries?: unknown; canonicalId?: unknown }
  const outlets = Number(o.outlets)
  if (!Number.isFinite(outlets) || outlets <= 0) return null
  const all = Number(o.outletsAll)
  const first = typeof o.firstReportAt === 'string' && Number.isFinite(Date.parse(o.firstReportAt)) ? o.firstReportAt : null
  return {
    outlets,
    outletsAll: Number.isFinite(all) && all > outlets ? all : outlets,
    firstReportAt: first,
    ...(typeof o.verified === 'boolean' ? { verified: o.verified } : {}),
    ...(typeof o.storyId === 'string' && o.storyId ? { storyId: o.storyId } : {}),
    ...(Number.isInteger(o.countries) && Number(o.countries) >= 2 ? { countries: Number(o.countries) } : {}),
    ...(typeof o.canonicalId === 'string' && UUID.test(o.canonicalId) ? { canonicalId: o.canonicalId } : {}),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether search engines should index a report's page (Nov 8, 2026; Devon: "Do it now" to winning Google, which
 * read 5 to 20 of our pages a day among some 11,000 new ones, most of them one outlet's unconfirmed report): only
 * a verified story's. An unconfirmed report's page stays readable and its links followed, out of search results
 * until its story is verified.
 */
export function storyIndexable(status: string | null | undefined, counts: StoryOutletCounts | null): boolean {
  return status === 'verified' || counts?.verified === true
}

/**
 * The address search engines should read for a report: its story's one page (its first verified report with a
 * real headline, as the sitemap lists it) when the API names it, else its own. A story of 134 reports was 134
 * pages, each its own canonical.
 */
export function storyCanonicalPath(signalId: string, counts: StoryOutletCounts | null): string {
  return `/signals/${counts?.canonicalId ?? signalId}`
}

/**
 * The story's facts in one sentence, first on its page and in its search-result description, so readers,
 * search engines and AI assistants that quote the page get them before anything else (Nov 8, 2026):
 * "Verified: 81 outlets in 36 countries have reported this story since Nov 7."
 */
export function storyFactLine(f: { verified: boolean; outlets: number; countries?: number; firstReportAt?: string | null }): string {
  const n = Math.max(0, Math.floor(f.outlets))
  if (n <= 0) return ''
  const since = f.firstReportAt && Number.isFinite(Date.parse(f.firstReportAt)) ? ` since ${storyDay(f.firstReportAt)}` : ''
  if (n === 1) return f.verified ? 'Verified.' : 'Only one outlet has reported this so far: treat it as unconfirmed.'
  const where = f.countries && f.countries >= 2 ? ` in ${f.countries} countries` : ''
  return f.verified
    ? `Verified: ${n} outlets${where} have reported this story${since}.`
    : `${n} outlets${where} have reported this story so far; it is not verified yet.`
}

/** "Oct 10" (in UTC, so the server's page and the browser's agree) */
export function storyDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "143 since Oct 10" when more have reported it since it began, else '' */
export function sinceText(outlets: number, outletsAll: number, firstReportAt: string | null | undefined): string {
  if (!(outletsAll > outlets)) return ''
  const day = firstReportAt && Number.isFinite(Date.parse(firstReportAt)) ? storyDay(firstReportAt) : null
  return `${outletsAll} since ${day ?? 'it began'}`
}

/**
 * The story page's browser-tab and search-result title (plan N8): the
 * headline, then "verified by N outlets" when the story is verified and two or
 * more outlets carried it in its last two days: the same count the page shows
 * as "Verified · N outlets", and "in M countries" from two on, as the badge
 * says "Verified · 81 outlets · 36 countries" (Nov 8, 2026, plan G25). Without counts, or when it isn't verified, the
 * headline alone (nothing is claimed that the page doesn't show).
 */
export function storyPageTitle(headline: string, counts: StoryOutletCounts | null): string {
  if (!counts || counts.verified !== true || counts.outlets < 2) return headline
  const where = counts.countries && counts.countries >= 2 ? ` in ${counts.countries} countries` : ''
  return `${headline} · verified by ${counts.outlets} outlets${where}`
}
