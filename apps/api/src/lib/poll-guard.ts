/**
 * A daily cap on polls per account (H-0056 part 4, Nov 2026).
 * Creating polls had no limit, so one account could fill the polls table.
 * Counted in Redis per UTC day; if Redis is down creating is allowed.
 */
import { redis } from '../db/redis'

export const POLLS_PER_DAY = 10

export const pollKey = (userId: string, now = new Date()) => `poll:count:${userId}:${now.toISOString().slice(0, 10)}`

/** True while the account is under today's cap. */
export async function pollAllowed(userId: string): Promise<boolean> {
  try {
    return Number((await redis.get(pollKey(userId))) || 0) < POLLS_PER_DAY
  } catch {
    return true
  }
}

/** Count one stored poll against the account's day. */
export async function countPoll(userId: string): Promise<void> {
  try {
    const k = pollKey(userId)
    await redis.incr(k)
    await redis.expire(k, 26 * 3600)
  } catch {
    // counting is best effort
  }
}
