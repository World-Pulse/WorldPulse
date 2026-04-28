/**
 * Dead-letter queue backed by the Redis list `scraper:dlq`.
 *
 * Failed feed fetches that exhaust all retries are pushed here for later
 * inspection or reprocessing.
 *
 * Production features:
 *  - Size cap: LTRIM keeps the list bounded to MAX_DLQ_SIZE (newest entries survive)
 *  - peekDLQ(n): inspect top entries without removing
 *  - drainDLQ(n): pop up to n entries in one call (for batch retry workers)
 *  - dlqLength: expose queue depth for monitoring/alerting
 */

import { redis } from './redis.js'
import { logger } from './logger.js'

const DLQ_KEY      = 'scraper:dlq'
const MAX_DLQ_SIZE = 1_000   // trim to this after each push

export interface DLQEntry {
  feedUrl:    string
  sourceId:   string
  sourceName: string
  error:      string
  attempts:   number
  failedAt:   string   // ISO 8601
}

/** Push a failed item onto the dead-letter queue. Trims to MAX_DLQ_SIZE. */
export async function pushDLQ(entry: DLQEntry): Promise<void> {
  const length = await redis.lpush(DLQ_KEY, JSON.stringify(entry))

  // Keep queue bounded — trim off the tail (oldest entries) if over limit
  if (length > MAX_DLQ_SIZE) {
    await redis.ltrim(DLQ_KEY, 0, MAX_DLQ_SIZE - 1)
  }

  // Warn when DLQ crosses notable thresholds
  if (length === 50 || length === 200 || length % 500 === 0) {
    logger.warn({ dlqLength: length, maxSize: MAX_DLQ_SIZE, feedUrl: entry.feedUrl }, 'DLQ depth warning')
  }
}

/** Pop the oldest item from the dead-letter queue (RPOP). Returns null when empty. */
export async function popDLQ(): Promise<DLQEntry | null> {
  const raw = await redis.rpop(DLQ_KEY)
  if (!raw) return null
  return JSON.parse(raw) as DLQEntry
}

/**
 * Drain up to `limit` items from the tail of the queue (oldest-first).
 * Useful for batch retry workers.
 */
export async function drainDLQ(limit = 100): Promise<DLQEntry[]> {
  const pipeline = redis.pipeline()
  for (let i = 0; i < limit; i++) {
    pipeline.rpop(DLQ_KEY)
  }
  const results = await pipeline.exec()
  if (!results) return []

  const entries: DLQEntry[] = []
  for (const [err, raw] of results) {
    if (err || !raw) continue
    try {
      entries.push(JSON.parse(raw as string) as DLQEntry)
    } catch {
      // Skip malformed entries
    }
  }
  return entries
}

/**
 * Peek at the top `n` entries (newest-first) without removing them.
 * Useful for health dashboards.
 */
export async function peekDLQ(n = 10): Promise<DLQEntry[]> {
  const raws = await redis.lrange(DLQ_KEY, 0, n - 1)
  return raws.map(raw => {
    try {
      return JSON.parse(raw) as DLQEntry
    } catch {
      return null
    }
  }).filter((e): e is DLQEntry => e !== null)
}

/** Number of items currently in the dead-letter queue. */
export async function dlqLength(): Promise<number> {
  return redis.llen(DLQ_KEY)
}
