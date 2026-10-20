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
}

/** One story's counts from GET /api/v1/stories/outlets, or null when it gives none */
export function storyCountsOf(v: unknown): StoryOutletCounts | null {
  const o = (v ?? {}) as { outlets?: unknown; outletsAll?: unknown; firstReportAt?: unknown }
  const outlets = Number(o.outlets)
  if (!Number.isFinite(outlets) || outlets <= 0) return null
  const all = Number(o.outletsAll)
  const first = typeof o.firstReportAt === 'string' && Number.isFinite(Date.parse(o.firstReportAt)) ? o.firstReportAt : null
  return { outlets, outletsAll: Number.isFinite(all) && all > outlets ? all : outlets, firstReportAt: first }
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

/** "48 outlets", or for a story that has run longer "48 outlets in its last 2 days · 143 since Oct 10" */
export function storyCountText(outlets: number, outletsAll: number, firstReportAt: string | null | undefined): string {
  const n = `${outlets} outlet${outlets === 1 ? '' : 's'}`
  const since = sinceText(outlets, outletsAll, firstReportAt)
  return since ? `${n} in its last ${STORY_COUNT_DAYS} days · ${since}` : n
}
