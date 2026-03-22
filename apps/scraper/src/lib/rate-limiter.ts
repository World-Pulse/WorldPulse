/**
 * Per-domain rate limiter.
 *
 * Reads SCRAPER_RATE_LIMIT_RPS (default 1) and enforces that limit using
 * a Redis counter keyed to the current 1-second bucket.
 *
 * If the domain has already hit its per-second quota the call sleeps until
 * the bucket rolls over, then acquires a slot in the new bucket.
 */

import { redis } from './redis.js'

const RATE_LIMIT_RPS = Math.max(1, parseInt(process.env['SCRAPER_RATE_LIMIT_RPS'] ?? '1', 10))

function domainOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function currentBucketKey(domain: string): string {
  const bucket = Math.floor(Date.now() / 1_000)
  return `scraper:rl:${domain}:${bucket}`
}

function msUntilNextBucket(): number {
  return 1_000 - (Date.now() % 1_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Acquires a rate-limit slot for the given URL's domain.
 * Waits until the current per-second quota resets if needed.
 */
export async function acquireRateLimit(url: string): Promise<void> {
  const domain = domainOf(url)

  // Loop until we get a slot (handles pathological clock edge cases).
  for (;;) {
    const key   = currentBucketKey(domain)
    const count = await redis.incr(key)

    if (count === 1) {
      // First request in this bucket; set expiry so Redis cleans itself up.
      await redis.expire(key, 2)
    }

    if (count <= RATE_LIMIT_RPS) {
      // Slot acquired.
      return
    }

    // Over quota — wait for the next bucket.
    await sleep(msUntilNextBucket() + 10) // +10 ms safety margin
  }
}
