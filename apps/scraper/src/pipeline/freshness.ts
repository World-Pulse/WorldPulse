/**
 * How old an article may be and still become news.
 *
 * Without a limit, old articles turn into "new" signals: a feed that starts
 * working again posts its whole backlog (on Oct 11, 2026 CNN's world feed
 * gave 2021–2023 stories, Xinhua's 2017 ones and WHO's 2024 ones), and raw
 * articles saved while the pipeline was down (May 2026) became signals when
 * it came back on Oct 7.
 */
export const MAX_ITEM_AGE_MS = 3 * 24 * 3_600_000

/** Whether an article's publish date is older than MAX_ITEM_AGE_MS (no or unreadable date: no) */
export function isStaleItem(pubDate: string | Date | null | undefined, now = Date.now()): boolean {
  if (!pubDate) return false
  const t = new Date(pubDate).getTime()
  return Number.isFinite(t) && now - t > MAX_ITEM_AGE_MS
}
