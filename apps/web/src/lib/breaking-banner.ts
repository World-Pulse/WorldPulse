/**
 * What the breaking banner shows (Nov 9, 2026; Devon: "Yes the banner should always be accurate", and yes to turning
 * it back on). The API's list (GET /api/v1/breaking/alerts) holds news only, each story once with its outlet count;
 * the banner shows the last few hours of it, with that count, newest first.
 */

/** An alert's story, as the API counts it */
export interface BannerStory { id: string; outlets: number; verified: boolean; countries: number; page: string }

export interface BannerAlert {
  alertId: string
  signalId: string
  title: string
  severity: string
  category?: string
  locationName?: string
  timestamp: string
  expiresAt: string
  story?: BannerStory | null
}

/** Breaking means the last few hours: an older alert stays on the API's list (6 hours) but leaves the banner */
export const BANNER_HOURS = 3

/**
 * A story on the banner has at least two outlets (Nov 9, 2026). On its first morning back, the list's one-outlet
 * stories were mostly not breaking news at all ("Traffic is normal at all Bulgarian border crossings"); a second
 * outlet usually follows real news within minutes. The AI assistants' breaking tool still shows them, labelled.
 */
export const BANNER_MIN_OUTLETS = 2

/** The alerts to show: two outlets or more, not expired, from the last BANNER_HOURS, not closed here, newest first */
export function bannerAlerts(alerts: BannerAlert[], now: number, closed: ReadonlySet<string>): BannerAlert[] {
  return alerts
    .filter(a => a && typeof a.title === 'string' && a.title.trim() !== '' && typeof a.alertId === 'string')
    .filter(a => (Number(a.story?.outlets) || 0) >= BANNER_MIN_OUTLETS)
    .filter(a => !closed.has(a.alertId))
    .filter(a => (Date.parse(a.expiresAt) || 0) > now)
    .filter(a => now - (Date.parse(a.timestamp) || 0) <= BANNER_HOURS * 3_600_000)
    .sort((x, y) => (Date.parse(y.timestamp) || 0) - (Date.parse(x.timestamp) || 0))
}

/** "Verified · 14 outlets in 13 countries", "3 outlets so far, not verified yet" ("1 outlet so far · unconfirmed" never shows) */
export function proofText(story?: BannerStory | null): string {
  if (!story) return ''
  const n = Math.max(1, Math.round(Number(story.outlets) || 1))
  const where = story.countries >= 2 ? ` in ${story.countries} countries` : ''
  if (story.verified) return `Verified · ${n} outlet${n === 1 ? '' : 's'}${where}`
  return n >= 2 ? `${n} outlets so far${where}, not verified yet` : '1 outlet so far · unconfirmed'
}

/** Where the banner never shows: embedded widgets, and the full-screen map, whose top controls it would cover */
export function bannerHiddenOn(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname === '/embed' || pathname.startsWith('/embed/') || pathname === '/map' || pathname.startsWith('/map/')
}

/** The story page an alert opens: the story's own page when the API gives it */
export function alertHref(a: Pick<BannerAlert, 'signalId' | 'story'>): string {
  return `/signals/${a.story?.page || a.signalId}`
}

/** "just now", "12m ago", "2h ago" */
export function timeAgo(iso: string, now: number): string {
  const ms = now - (Date.parse(iso) || now)
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}
