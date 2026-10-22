/**
 * Reports to send to the search index again (Oct 22, 2026). The index takes a
 * report when it is new (the API, on wp:signal.new) and keeps the status it
 * had then: a report that turned verified later (another outlet's article
 * joined it, the second outlet found one, the April–May repair) or went back
 * to pending (the cross-check) kept its first status there, and the public
 * search shows verified reports only, so it missed them until an API restart
 * re-sent the last 24 hours. Their ids go into the set search:reindex, and the
 * API sends them again every minute (apps/api/src/lib/search-reindex.ts).
 */

import { redis } from '../lib/redis'
import { logger } from '../lib/logger'

export const REINDEX_KEY = 'search:reindex'
/** Ids the API hasn't taken after a week are dropped with the set (its restarts re-send the last 24 hours anyway) */
const KEEP_S = 7 * 86_400

/** Queue reports for the search index */
export async function queueReindex(ids: Array<string | null | undefined>): Promise<number> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  for (let i = 0; i < unique.length; i += 500) await redis.sadd(REINDEX_KEY, ...unique.slice(i, i + 500))
  if (unique.length) await redis.expire(REINDEX_KEY, KEEP_S)
  return unique.length
}

/** The same, without waiting: a lost one is caught by the API's next restart (the last 24 hours) */
export function reindexLater(ids: Array<string | null | undefined>): void {
  queueReindex(ids).catch(err => logger.debug({ err }, 'Search re-index not queued (non-fatal)'))
}
