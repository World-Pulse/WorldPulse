/**
 * Reports the search index has with an old status (Oct 22, 2026). The index
 * takes a report when it is new (ws/handler.ts, on wp:signal.new) and keeps
 * the status it had then; the public search shows verified reports only. A
 * report that turned verified later (another outlet's article joined it, the
 * second outlet found one, the April–May repair) or went back to pending (the
 * cross-check) stayed as it was in the index until an API restart re-sent the
 * last 24 hours (syncRecentSignalsOnStartup), and one older than that never.
 * The scraper puts their ids in the set search:reindex
 * (apps/scraper/src/pipeline/reindex.ts); every minute this sends up to 2,000
 * of them again, 500 at a time, read fresh from the database.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { indexSignals } from './search'
import { logger } from './logger'

export const REINDEX_KEY = 'search:reindex'
const BATCH = 500
const BATCHES_A_MINUTE = 4

export interface ReindexDeps {
  /** Up to n ids, taken out of the set */
  pop(n: number): Promise<string[]>
  /** Ids back into the set, when sending them failed */
  putBack(ids: string[]): Promise<void>
  rows(ids: string[]): Promise<Record<string, unknown>[]>
  index(rows: Record<string, unknown>[]): Promise<void>
}

export const liveReindexDeps: ReindexDeps = {
  async pop(n) {
    const got = await redis.spop(REINDEX_KEY, n)
    return Array.isArray(got) ? got : got ? [got] : []
  },
  async putBack(ids) {
    if (ids.length) await redis.sadd(REINDEX_KEY, ...ids)
  },
  async rows(ids) {
    return await db('signals').whereIn('id', ids).select('*') as Record<string, unknown>[]
  },
  index: indexSignals,
}

/** One look: the queued reports sent to the index again. Returns how many were sent */
export async function drainReindex(
  deps: ReindexDeps = liveReindexDeps,
  opts: { batch?: number; batches?: number } = {},
): Promise<number> {
  const batch = opts.batch ?? BATCH
  let sent = 0
  for (let i = 0; i < (opts.batches ?? BATCHES_A_MINUTE); i++) {
    const ids = await deps.pop(batch)
    if (ids.length === 0) break
    try {
      const rows = await deps.rows(ids)
      if (rows.length) await deps.index(rows)
      sent += rows.length
    } catch (err) {
      await deps.putBack(ids).catch(() => {})
      throw err
    }
    if (ids.length < batch) break
  }
  return sent
}

let timer: ReturnType<typeof setInterval> | null = null
let busy = false

/** Every minute, one look at a time */
export function startReindexDrain(): void {
  if (timer) return
  timer = setInterval(() => {
    if (busy) return
    busy = true
    drainReindex()
      .then(n => { if (n > 0) logger.info({ sent: n }, 'Search: reports whose status changed sent to the index again') })
      .catch(err => logger.warn({ err }, 'Search re-index failed (non-fatal; the ids stay queued)'))
      .finally(() => { busy = false })
  }, 60_000)
  timer.unref?.()
}
