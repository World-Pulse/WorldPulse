/**
 * When a signed-in reader was last here (plan N9, Oct 30, 2026: returning
 * readers, privacy first).
 *
 * Readers stay signed in for 30 days by refreshing their tokens, so
 * users.last_seen_at, set only at a password sign-in, never showed a reader
 * coming back. A token refresh (POST /api/v1/auth/refresh) now marks it too,
 * at most once an hour per account. No new cookie and no new identifier: the
 * account and its column were already there, and /ops-status.json counts the
 * accounts seen and returning (scripts/ops-status.sh), never which ones.
 */
import { db } from '../db/postgres'
import { logger } from './logger'

/** One mark an hour per account at most: a refresh every few minutes costs no write */
export const SEEN_EVERY_MS = 60 * 60_000

/** Mark the account seen now, unless it was in the last hour; never throws */
export async function markSeen(userId: string, now: Date = new Date()): Promise<void> {
  if (!userId) return
  try {
    const since = new Date(now.getTime() - SEEN_EVERY_MS)
    await db('users')
      .where('id', userId)
      .where(q => { q.whereNull('last_seen_at').orWhere('last_seen_at', '<', since) })
      .update({ last_seen_at: now })
  } catch (err) {
    logger.debug({ err }, 'last seen not marked')
  }
}
