/**
 * Per-domain rate limiter — sliding-window token bucket.
 *
 * Uses a Redis sorted-set per domain. Each request timestamp is stored as a
 * member; we count members in the last `windowMs` to determine current rate.
 * This is more accurate than a fixed 1-second bucket because it smooths bursts
 * across the window boundary.
 *
 * Configuration (env vars):
 *   SCRAPER_RATE_LIMIT_RPS   — default RPS for all domains (default: 1)
 *   SCRAPER_RATE_LIMIT_BURST — burst allowance above RPS (default: 3)
 *   SCRAPER_DOMAIN_LIMITS    — JSON map of hostname → RPS overrides
 *                              e.g. '{"feeds.reuters.com":5,"rss.ap.org":4}'
 */

import { redis } from './redis.js'

const DEFAULT_RPS   = Math.max(1, parseInt(process.env['SCRAPER_RATE_LIMIT_RPS']   ?? '1',  10))
const DEFAULT_BURST = Math.max(1, parseInt(process.env['SCRAPER_RATE_LIMIT_BURST'] ?? '3',  10))
const WINDOW_MS     = 1_000   // sliding window size

/** Per-domain RPS overrides loaded once at startup. */
const DOMAIN_LIMITS: Record<string, number> = (() => {
  try {
    const raw = process.env['SCRAPER_DOMAIN_LIMITS']
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
})()

function domainOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function rlKey(domain: string): string {
  return `scraper:rl2:${domain}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Acquires a rate-limit slot for the given URL's domain using a sliding-window
 * sorted-set approach. Waits if the domain is currently at its RPS limit.
 */
export async function acquireRateLimit(url: string): Promise<void> {
  const domain  = domainOf(url)
  const rps     = DOMAIN_LIMITS[domain] ?? DEFAULT_RPS
  const limit   = rps + DEFAULT_BURST   // allow burst above steady-state RPS
  const key     = rlKey(domain)

  for (;;) {
    const now       = Date.now()
    const windowStart = now - WINDOW_MS

    // Remove timestamps older than the window, count current, conditionally add
    const pipe = redis.pipeline()
    pipe.zremrangebyscore(key, '-inf', windowStart)
    pipe.zcard(key)
    const results = await pipe.exec()

    const currentCount = (results?.[1]?.[1] as number | null) ?? 0

    if (currentCount < limit) {
      // Slot available — record this request with a unique member (ts + random)
      const member = `${now}:${Math.random().toString(36).slice(2)}`
      await redis.zadd(key, now, member)
      // Set TTL so Redis auto-cleans idle domain keys
      await redis.pexpire(key, WINDOW_MS * 10)
      return
    }

    // Over limit — compute how long until the oldest slot in the window expires
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES')
    const oldestTs = oldest[1] ? parseInt(oldest[1], 10) : now
    const waitMs   = Math.max(1, oldestTs + WINDOW_MS - now + 5) // +5 ms safety margin
    await sleep(waitMs)
  }
}

/** Returns the current request count within the sliding window for a domain. */
export async function getRateLimitState(url: string): Promise<{ count: number; limit: number; domain: string }> {
  const domain = domainOf(url)
  const rps    = DOMAIN_LIMITS[domain] ?? DEFAULT_RPS
  const limit  = rps + DEFAULT_BURST
  const key    = rlKey(domain)

  const now = Date.now()
  await redis.zremrangebyscore(key, '-inf', now - WINDOW_MS)
  const count = await redis.zcard(key)

  return { count, limit, domain }
}
