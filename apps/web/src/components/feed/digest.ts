/**
 * The AI Digest tab: what is current, and when it last published (plan P5).
 *
 * The digest wrote nothing from May 13 to Oct 11, 2026, so the tab showed
 * five-month-old briefings as if they were news. Items older than two weeks
 * are left out (an empty tab says more than stale briefings), and a line
 * above the list says when the AI Bureau last published.
 */

/** Digest items older than this aren't shown */
export const DIGEST_FRESH_MS = 14 * 86_400_000

/**
 * The digest items still current, and whether older ones were left out (the
 * feed shouldn't page on into them then)
 */
export function freshDigest<T extends { createdAt?: string }>(items: T[], now = Date.now()): { fresh: T[]; droppedOld: boolean } {
  const fresh = items.filter(item => {
    const at = Date.parse(item.createdAt ?? '')
    return !Number.isFinite(at) || now - at < DIGEST_FRESH_MS
  })
  return { fresh, droppedOld: fresh.length < items.length }
}

/** The newest item's time (the feed is ranked by importance, not by time) */
export function lastDigestUpdate(items: Array<{ createdAt?: string }>): string | null {
  const times = items.map(item => Date.parse(item.createdAt ?? '')).filter(Number.isFinite)
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
}

/** "just now", "12 minutes ago", "3 hours ago", "2 days ago" */
export function updatedAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
