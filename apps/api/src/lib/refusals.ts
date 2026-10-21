/**
 * How often the API turns a request away as too many (429), by route, a UTC
 * day at a time (plan D3, Oct 21, 2026: "measure 429s"). The plan's first
 * step was to measure; nothing counted them. Kept in Redis as a hash per day
 * (api:429:<YYYY-MM-DD>: "<METHOD> <route>" → count, and "total"), for 3
 * days; /ops-status.json shows today's and yesterday's (pipeline.api_limits).
 * Counts only: no addresses or keys.
 */
import type Redis from 'ioredis'

export const REFUSALS_KEEP_S = 3 * 24 * 3600

export function refusalsKey(now = new Date()): string {
  return `api:429:${now.toISOString().slice(0, 10)}`
}

/** "GET /api/v1/signals/:id": the route's pattern, never the address asked for (ids would make the hash grow without end) */
export function refusalField(method: string, routeUrl: string | undefined): string {
  return `${method} ${routeUrl || '(no route)'}`
}

/** Count one refusal; never fails the request (a Redis error is ignored) */
export async function countRefusal(redis: Pick<Redis, 'multi'>, method: string, routeUrl: string | undefined, now = new Date()): Promise<void> {
  try {
    const key = refusalsKey(now)
    await redis.multi()
      .hincrby(key, refusalField(method, routeUrl), 1)
      .hincrby(key, 'total', 1)
      .expire(key, REFUSALS_KEEP_S)
      .exec()
  } catch {
    // a refusal we can't count is still a refusal; the request was answered
  }
}
