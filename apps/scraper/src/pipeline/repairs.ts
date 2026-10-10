/**
 * One-off data repairs that run when the scraper starts. Each one is bounded
 * and idempotent, so running it again on a later start changes nothing.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'

/** f05342d went live at 15:35 UTC on Oct 10, 2026 */
const LOOSE_FROM = '2026-10-10T15:30:00Z'
/** Hard stop: nothing after this is ever touched, whatever Redis says */
const LOOSE_HARD_STOP = '2026-10-10T17:00:00Z'
const LOOSE_KEY = 'repair:loose-corroboration:2026-10-10'

/**
 * Undo the over-eager corroboration of Oct 10, 2026.
 *
 * From 15:35 UTC until the same-story rule shipped, the correlation engine
 * treated any cluster of *related* signals (same hour, linked categories) as
 * corroboration. It raised their reliability, copied the cluster's source
 * count onto them and marked them verified, so unrelated single-source stories
 * showed as verified. This puts them back:
 *  - verified in that window → pending again (no verified_at)
 *  - corroborated in that window → source_count recounted from the sources the
 *    signal itself stores, and eligible for re-checking under the strict rule
 *  - any recent signal whose source_count is below its own stored sources (the
 *    re-scorer could overwrite it with a smaller cluster count) → recounted
 * Reliability scores raised in that window can't be restored exactly and stay.
 *
 * The window ends at the first start of this version, saved in Redis, so a
 * later restart never undoes verifications made by the strict rule.
 */
export async function undoLooseCorroboration(): Promise<{ reverted: number; recounted: number; fixedCounts: number }> {
  const now = new Date().toISOString()
  let saved: string | null = null
  try {
    await redis.set(LOOSE_KEY, now, 'NX')
    saved = await redis.get(LOOSE_KEY)
  } catch { /* Redis down: use now (still bounded by the hard stop) */ }
  const savedMs = saved ? Date.parse(saved) : NaN
  const untilMs = Math.min(Number.isNaN(savedMs) ? Date.parse(now) : savedMs, Date.parse(LOOSE_HARD_STOP))
  if (untilMs <= Date.parse(LOOSE_FROM)) return { reverted: 0, recounted: 0, fixedCounts: 0 }
  const until = new Date(untilMs).toISOString()

  const reverted = await db.raw(
    `UPDATE signals
        SET status = 'pending', verified_at = NULL
      WHERE status = 'verified'
        AND verified_at >= ? AND verified_at < ?`,
    [LOOSE_FROM, until],
  )
  const recounted = await db.raw(
    `UPDATE signals
        SET source_count = GREATEST(1, COALESCE(array_length(source_ids, 1), 0)),
            last_corroborated_at = NULL
      WHERE last_corroborated_at >= ? AND last_corroborated_at < ?`,
    [LOOSE_FROM, until],
  )
  const fixedCounts = await db.raw(
    `UPDATE signals
        SET source_count = GREATEST(1, COALESCE(array_length(source_ids, 1), 0))
      WHERE created_at > NOW() - INTERVAL '3 days'
        AND COALESCE(source_count, 0) < GREATEST(1, COALESCE(array_length(source_ids, 1), 0))`,
  )
  const count = (r: unknown) => Number((r as { rowCount?: number })?.rowCount ?? 0)
  return { reverted: count(reverted), recounted: count(recounted), fixedCounts: count(fixedCounts) }
}
