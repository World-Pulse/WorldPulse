/**
 * Helpers that keep new signals visible to the rest of the pipeline.
 *
 * Why this exists (Oct 2026): from April 2026 on, almost no signal reached
 * "verified". Two gaps caused it:
 *
 *  1. `signals.published_at` was added by hand during the April 2026 database
 *     recovery (it is not in the base schema) and back-filled once. Nothing has
 *     written it since, so every newer row has it NULL. Delayed re-scoring, geo
 *     validation, source reputation and entity trends all filter on it, so they
 *     never saw a new signal.
 *  2. RSS and OSINT signals are stored with an empty `source_ids`, so the
 *     correlation engine saw them all as coming from the same nameless source
 *     and could not count independent sources.
 *
 * These helpers fill `published_at` on insert (only where the column exists)
 * and give every signal a stable source key for correlation.
 */

import { db } from '../lib/postgres'

let publishedAtColumn: Promise<boolean> | null = null

/** Whether this database's signals table has a published_at column (cached). */
export function signalsHavePublishedAt(): Promise<boolean> {
  if (!publishedAtColumn) {
    publishedAtColumn = Promise.resolve()
      .then(() => db.raw(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'signals' AND column_name = 'published_at' LIMIT 1`,
      ))
      .then((r: { rows?: unknown[] }) => Array.isArray(r?.rows) && r.rows.length > 0)
      .catch(() => {
        publishedAtColumn = null // ask again next time (e.g. the database was still starting)
        return false
      })
  }
  return publishedAtColumn
}

/** The time a new signal is published at: its event time when valid, else now. */
export function publishedAtFor(eventTime: unknown): Date {
  const t = eventTime instanceof Date ? eventTime : new Date(String(eventTime ?? ''))
  return isNaN(t.getTime()) ? new Date() : t
}

/**
 * Fill published_at for recent rows that were inserted without it. Bounded to
 * the last few days and idempotent (only touches NULLs), so it is safe to run
 * at every start.
 */
export async function backfillRecentPublishedAt(days = 3): Promise<number> {
  if (!(await signalsHavePublishedAt())) return 0
  const result = await db.raw(
    `UPDATE signals
        SET published_at = COALESCE(event_time, first_reported, created_at)
      WHERE published_at IS NULL
        AND created_at > NOW() - make_interval(days => ?)`,
    [days],
  )
  return Number((result as { rowCount?: number })?.rowCount ?? 0)
}

/**
 * A stable "who reported this" key for correlation: the first stored source id;
 * otherwise the host of the first original URL (www. removed), which is how RSS
 * and OSINT signals are told apart; otherwise the fallback.
 */
export function sourceKey(sourceIds: unknown, urls: unknown, fallback = ''): string {
  const firstId = Array.isArray(sourceIds) ? sourceIds[0] : sourceIds
  if (typeof firstId === 'string' && firstId.trim()) return firstId.trim()
  const firstUrl = Array.isArray(urls) ? urls[0] : urls
  if (typeof firstUrl === 'string' && firstUrl) {
    try {
      const host = new URL(firstUrl).hostname.toLowerCase().replace(/^www\./, '')
      if (host) return host
    } catch { /* not a URL */ }
  }
  return fallback
}
