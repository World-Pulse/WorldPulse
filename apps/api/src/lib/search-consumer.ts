/**
 * Meilisearch indexing consumer.
 *
 * Runs a periodic incremental sync to catch up any signals that were
 * inserted into PostgreSQL but not indexed in Meilisearch — for example,
 * signals published to Redis while the API's subscriber was briefly down,
 * or direct indexing calls that failed transiently.
 *
 * The Kafka-based variant is deferred until kafkajs ships ESM-compatible
 * types for the project's NodeNext moduleResolution; this Redis-backed
 * catch-up covers the same reliability guarantee at lower complexity cost.
 */

import { syncSignalsSince } from './search-backfill'
import { logger } from './logger'

// Sync window: look back slightly more than the interval to avoid gaps
const SYNC_INTERVAL_MS  = 5 * 60 * 1_000   // every 5 minutes
const SYNC_LOOKBACK_MS  = 7 * 60 * 1_000   // look back 7 minutes per tick

let consumerTimer: ReturnType<typeof setInterval> | null = null

export async function startSearchConsumer(): Promise<void> {
  if (consumerTimer) return // already running

  consumerTimer = setInterval(() => {
    const since = new Date(Date.now() - SYNC_LOOKBACK_MS)
    syncSignalsSince(since).then(count => {
      if (count > 0) {
        logger.info({ count, lookbackMs: SYNC_LOOKBACK_MS }, 'Search consumer: incremental sync indexed new signals')
      }
    }).catch(err => {
      logger.warn({ err }, 'Search consumer: incremental sync failed (non-fatal)')
    })
  }, SYNC_INTERVAL_MS)

  logger.info({ intervalMs: SYNC_INTERVAL_MS, lookbackMs: SYNC_LOOKBACK_MS }, 'Search consumer started')
}

export async function stopSearchConsumer(): Promise<void> {
  if (consumerTimer) {
    clearInterval(consumerTimer)
    consumerTimer = null
    logger.info('Search consumer stopped')
  }
}
