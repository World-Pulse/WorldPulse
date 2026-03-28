/**
 * Search index backfill — keeps Meilisearch in sync with PostgreSQL.
 *
 * Three modes:
 *  1. Startup: backfill each index only when it is empty (safe to call every boot).
 *  2. Incremental: index signals inserted after a given timestamp — used to catch
 *     up signals that were written by the scraper while the API was down.
 *  3. Full reindex: admin-triggered wipe + rebuild of all three indexes.
 *
 * All batch operations use a configurable BATCH_SIZE to avoid OOM and keep
 * Meilisearch task queue shallow.
 */

import { db } from '../db/postgres'
import { meili, indexSignals, indexPosts, indexUsers } from './search'
import { logger } from './logger'

const BATCH_SIZE = 500

// ─── Helpers ──────────────────────────────────────────────────────────────

async function batchSignals(where?: () => void): Promise<number> {
  let offset = 0
  let total  = 0

  for (;;) {
    const rows = await db('signals')
      .select('*')
      .modify(qb => { if (where) where.call(qb) })
      .orderBy('created_at', 'asc')
      .limit(BATCH_SIZE)
      .offset(offset)

    if (rows.length === 0) break
    await indexSignals(rows as Record<string, unknown>[])
    total  += rows.length
    offset += rows.length
    if (rows.length < BATCH_SIZE) break
  }

  return total
}

async function batchPosts(): Promise<number> {
  let offset = 0
  let total  = 0

  for (;;) {
    const rows = await db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .select([
        'p.*',
        'u.handle      as author_handle',
        'u.display_name as author_display_name',
      ])
      .orderBy('p.created_at', 'asc')
      .limit(BATCH_SIZE)
      .offset(offset)

    if (rows.length === 0) break
    await indexPosts(rows as Record<string, unknown>[])
    total  += rows.length
    offset += rows.length
    if (rows.length < BATCH_SIZE) break
  }

  return total
}

async function batchUsers(): Promise<number> {
  let offset = 0
  let total  = 0

  for (;;) {
    const rows = await db('users')
      .select('*')
      .orderBy('created_at', 'asc')
      .limit(BATCH_SIZE)
      .offset(offset)

    if (rows.length === 0) break
    await indexUsers(rows as Record<string, unknown>[])
    total  += rows.length
    offset += rows.length
    if (rows.length < BATCH_SIZE) break
  }

  return total
}

// ─── Public types ─────────────────────────────────────────────────────────

export interface BackfillResult {
  signals: number
  posts:   number
  users:   number
  /** Names of indexes that were already populated and therefore skipped. */
  skipped: string[]
}

// ─── Startup backfill ─────────────────────────────────────────────────────

/**
 * Startup backfill: only populates indexes that are empty (count === 0).
 * Safe to call on every API boot — no-ops for already-populated indexes.
 * Runs all three indexes in parallel and swallows errors so a Meilisearch
 * outage never prevents the API from starting.
 */
export async function runStartupBackfill(): Promise<BackfillResult> {
  const result: BackfillResult = { signals: 0, posts: 0, users: 0, skipped: [] }

  await Promise.allSettled([

    // ── Signals ───────────────────────────────────────────────
    (async () => {
      try {
        const stats = await meili.index('signals').getStats()
        if (stats.numberOfDocuments > 0) {
          result.skipped.push('signals')
          return
        }
        logger.info('Meilisearch signals index empty — running startup backfill')
        result.signals = await batchSignals()
        logger.info({ count: result.signals }, 'Signals startup backfill complete')
      } catch (err) {
        logger.warn({ err }, 'Signals startup backfill failed — search may return empty results')
      }
    })(),

    // ── Posts ─────────────────────────────────────────────────
    (async () => {
      try {
        const stats = await meili.index('posts').getStats()
        if (stats.numberOfDocuments > 0) {
          result.skipped.push('posts')
          return
        }
        logger.info('Meilisearch posts index empty — running startup backfill')
        result.posts = await batchPosts()
        logger.info({ count: result.posts }, 'Posts startup backfill complete')
      } catch (err) {
        logger.warn({ err }, 'Posts startup backfill failed — post search may be degraded')
      }
    })(),

    // ── Users ─────────────────────────────────────────────────
    (async () => {
      try {
        const stats = await meili.index('users').getStats()
        if (stats.numberOfDocuments > 0) {
          result.skipped.push('users')
          return
        }
        logger.info('Meilisearch users index empty — running startup backfill')
        result.users = await batchUsers()
        logger.info({ count: result.users }, 'Users startup backfill complete')
      } catch (err) {
        logger.warn({ err }, 'Users startup backfill failed — people search may be degraded')
      }
    })(),

  ])

  return result
}

// ─── Incremental sync ─────────────────────────────────────────────────────

/**
 * Index any signals inserted after `since` that may have been missed
 * (e.g. scraper wrote to DB while the API's Redis subscriber was down).
 * Safe to call at any time — Meilisearch `addDocuments` is idempotent.
 *
 * @returns Number of signals synced.
 */
export async function syncSignalsSince(since: Date): Promise<number> {
  let count = 0
  try {
    count = await batchSignals(function (this: ReturnType<typeof db>) {
      this.where('created_at', '>', since)
    })
    if (count > 0) {
      logger.info({ count, since: since.toISOString() }, 'Incremental signal sync complete')
    }
  } catch (err) {
    logger.warn({ err }, 'Incremental signal sync failed')
  }
  return count
}

// ─── Startup incremental sync ─────────────────────────────────────────────

/**
 * Incremental startup sync — always runs on boot regardless of index state.
 * Indexes signals created in the last `lookbackHours` hours to catch up any
 * signals inserted while the API was down (the startup backfill skips this
 * when the index is already populated).
 *
 * @param lookbackHours Number of hours to look back (default: 24)
 * @returns Number of signals synced.
 */
export async function syncRecentSignalsOnStartup(lookbackHours = 24): Promise<number> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1_000)
  return syncSignalsSince(since)
}

// ─── Full reindex ─────────────────────────────────────────────────────────

/**
 * Wipe all three Meilisearch indexes and rebuild them from PostgreSQL.
 * Admin-triggered only. Each index is cleared then repopulated in parallel;
 * failures are logged but do not abort the other indexes.
 */
export async function runFullReindex(): Promise<BackfillResult> {
  const result: BackfillResult = { signals: 0, posts: 0, users: 0, skipped: [] }

  logger.info('Full Meilisearch reindex started')

  await Promise.allSettled([

    (async () => {
      try {
        await meili.index('signals').deleteAllDocuments()
        result.signals = await batchSignals()
        logger.info({ count: result.signals }, 'Signals full reindex complete')
      } catch (err) {
        logger.error({ err }, 'Signals full reindex failed')
      }
    })(),

    (async () => {
      try {
        await meili.index('posts').deleteAllDocuments()
        result.posts = await batchPosts()
        logger.info({ count: result.posts }, 'Posts full reindex complete')
      } catch (err) {
        logger.error({ err }, 'Posts full reindex failed')
      }
    })(),

    (async () => {
      try {
        await meili.index('users').deleteAllDocuments()
        result.users = await batchUsers()
        logger.info({ count: result.users }, 'Users full reindex complete')
      } catch (err) {
        logger.error({ err }, 'Users full reindex failed')
      }
    })(),

  ])

  logger.info(result, 'Full Meilisearch reindex complete')
  return result
}
