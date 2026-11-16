/**
 * Limits on signal disputes (H-0056 part 3, Nov 2026).
 * A dispute had no limit per account, accepted any text of any length, and
 * three accounts suggesting the same value rewrote a story's category or
 * severity, whatever the value was. Now: a daily cap per account (counted in
 * Redis per UTC day; if Redis is down disputes are allowed), text caps, and an
 * automatic correction only to a category or severity that exists.
 */
import { redis } from '../db/redis'

export const DISPUTES_PER_DAY = 30
export const DISPUTE_REASON_MAX = 1000
export const DISPUTE_VALUE_MAX = 200

export const DISPUTE_TYPES = [
  'wrong_category', 'wrong_severity', 'wrong_location',
  'duplicate', 'spam', 'misleading', 'outdated',
] as const

export const DISPUTE_CATEGORIES = new Set([
  'breaking', 'conflict', 'geopolitics', 'climate', 'health', 'economy', 'technology',
  'science', 'elections', 'culture', 'disaster', 'security', 'sports', 'space', 'other',
  'weather', 'finance', 'humanitarian', 'infrastructure', 'military', 'aviation',
  'maritime', 'electronic_warfare', 'politics',
])
export const DISPUTE_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export const disputeKey = (userId: string, now = new Date()) => `dispute:count:${userId}:${now.toISOString().slice(0, 10)}`

/** True while the account is under today's cap. */
export async function disputeAllowed(userId: string): Promise<boolean> {
  try {
    return Number((await redis.get(disputeKey(userId))) || 0) < DISPUTES_PER_DAY
  } catch {
    return true
  }
}

/** Count one stored dispute against the account's day. */
export async function countDispute(userId: string): Promise<void> {
  try {
    const k = disputeKey(userId)
    await redis.incr(k)
    await redis.expire(k, 26 * 3600)
  } catch {
    // counting is best effort
  }
}

/** The value an automatic correction may write, or null when it must not be applied. */
export function correctableValue(type: string, value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (type === 'wrong_category') return DISPUTE_CATEGORIES.has(v) ? v : null
  if (type === 'wrong_severity') return DISPUTE_SEVERITIES.has(v) ? v : null
  return null
}
