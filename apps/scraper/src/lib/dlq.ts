/**
 * Dead-letter queue backed by the Redis list `scraper:dlq`.
 *
 * Failed feed fetches that exhaust all retries are pushed here for later
 * inspection or reprocessing.
 */

import { redis } from './redis.js'

const DLQ_KEY = 'scraper:dlq'

export interface DLQEntry {
  feedUrl:    string
  sourceId:   string
  sourceName: string
  error:      string
  attempts:   number
  failedAt:   string   // ISO 8601
}

/** Push a failed item onto the dead-letter queue (LPUSH). */
export async function pushDLQ(entry: DLQEntry): Promise<void> {
  await redis.lpush(DLQ_KEY, JSON.stringify(entry))
}

/** Pop the oldest item from the dead-letter queue (RPOP). Returns null when empty. */
export async function popDLQ(): Promise<DLQEntry | null> {
  const raw = await redis.rpop(DLQ_KEY)
  if (!raw) return null
  return JSON.parse(raw) as DLQEntry
}

/** Number of items currently in the dead-letter queue. */
export async function dlqLength(): Promise<number> {
  return redis.llen(DLQ_KEY)
}
