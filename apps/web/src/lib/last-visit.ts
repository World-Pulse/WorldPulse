/**
 * "Since you last looked" (plan M8): when the reader was last on the World
 * Map, and what has come in since. Kept in this browser only (localStorage),
 * a per-reader convenience; nothing is sent anywhere.
 */

export const LAST_VISIT_KEY = 'wp_map_last_seen'

/** Visits closer together than this aren't "coming back" */
export const MIN_AWAY_MS = 15 * 60_000

/** How often an open map notes that it's still being looked at */
export const SEEN_EVERY_MS = 5 * 60_000

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The stored time of the last look (ms), or null if none or unreadable */
export function readLastVisit(storage: StorageLike | null | undefined): number | null {
  try {
    const raw = storage?.getItem(LAST_VISIT_KEY)
    const t = raw ? Number(raw) : NaN
    return Number.isFinite(t) && t > 0 ? t : null
  } catch {
    return null
  }
}

export function writeLastVisit(storage: StorageLike | null | undefined, now = Date.now()): void {
  try { storage?.setItem(LAST_VISIT_KEY, String(now)) } catch { /* private mode, blocked storage */ }
}

/** "3h ago", "2 days ago", "45 min ago" */
export function awayLabel(lastVisit: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - lastVisit) / 60_000))
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)} days ago`
}

export interface SinceVisit<T> {
  /** Signals created after the last look (within what the map has loaded) */
  fresh: T[]
  /** Of those: critical or high */
  serious: number
  verified: number
  /** The last look was before the map's time window, so the count is only the window's */
  capped: boolean
}

/**
 * What came in since the last look, among the loaded signals. null when
 * there's nothing to say: a first visit, or back within MIN_AWAY_MS.
 */
export function sinceLastVisit<T extends { created_at: string; severity: string; status: string }>(
  signals: T[],
  lastVisit: number | null,
  windowStart: number | null,
  now = Date.now(),
): SinceVisit<T> | null {
  if (lastVisit === null || now - lastVisit < MIN_AWAY_MS) return null
  const since = windowStart !== null ? Math.max(lastVisit, windowStart) : lastVisit
  const fresh = signals.filter(s => (Date.parse(s.created_at) || 0) > since)
  return {
    fresh,
    serious: fresh.filter(s => s.severity === 'critical' || s.severity === 'high').length,
    verified: fresh.filter(s => s.status === 'verified').length,
    capped: windowStart !== null && lastVisit < windowStart,
  }
}
