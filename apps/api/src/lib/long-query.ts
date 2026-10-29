/**
 * Queries allowed more than the pool's 5 seconds (Oct 15, 2026).
 *
 * Every connection runs with statement_timeout = 5000 (db/postgres.ts), so a
 * slow page can't hold the database. A few lists read a whole day or week of
 * reports at once, and as the tables grew they crossed 5 seconds and answered
 * 500 every time: the story counts on Oct 15 morning (bb9ee33), then the
 * stories list, who's in the news, trending names and the entity sitemap.
 * Those are kept in Redis and remade off the request path by one process at
 * a time (lib/swr-cache.ts), so they may take longer: SET LOCAL gives this one
 * transaction its own limit, and the connection's own comes back after it.
 * The same works the other way: the search's tag count gets 2 seconds, so a
 * slow one can't hold the page (routes/search.ts, Oct 21, 2026).
 *
 * A statement still running well past its own limit is ended from outside
 * (Oct 29, 2026). statement_timeout can't stop a query whose answer is waiting
 * for the API to read it: Postgres doesn't act on a cancel while it is blocked
 * sending to the client. On Oct 28, with the server out of memory, three of
 * the stories list's queries sat like that (Client:ClientWrite) for 3 to 5
 * minutes, past their 60 seconds, holding memory in both the database and the
 * API. So once a transaction has been open for its limit plus
 * OVERRUN_GRACE_SECONDS, it is looked at every CHECK_EVERY_SECONDS: if its
 * statement has been running longer than that, or it has sat idle between
 * statements that long, its connection is ended (pg_terminate_backend) and the
 * caller gets an error, as for a timeout. A transaction of several statements,
 * each within its limit, is never touched; and only this transaction can be
 * ended, since its process id and its start time to the microsecond must both
 * still match.
 */

import type { Knex } from 'knex'
import { db } from '../db/postgres'
import { logger } from './logger'

export const OVERRUN_GRACE_SECONDS = 15
export const CHECK_EVERY_SECONDS = 15

interface Me { pid: number; since: string }

export function longQuery<T>(seconds: number, run: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const limit = Math.max(1, Math.round(seconds))
  return db.transaction(async (trx) => {
    // One round trip: the limit, then which connection and transaction this is
    const set = await trx.raw(`SET LOCAL statement_timeout = '${limit}s'; SELECT pg_backend_pid() AS pid, now()::text AS since`)
    const me = whoAmI(set)
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const later = (s: number) => {
      timer = setTimeout(look, s * 1000)
      timer.unref?.()
    }
    const look = () => {
      timer = null
      if (done || !me) return
      void endIfOverrun(me, limit + OVERRUN_GRACE_SECONDS).then(ended => {
        if (!done && !ended) later(CHECK_EVERY_SECONDS)
      })
    }
    if (me) later(limit + OVERRUN_GRACE_SECONDS)
    try {
      return await run(trx)
    } finally {
      done = true
      if (timer) clearTimeout(timer)
    }
  })
}

/** The process id and transaction start from the SET LOCAL round trip (the second of its two answers) */
function whoAmI(res: unknown): Me | null {
  const last = Array.isArray(res) ? res[res.length - 1] : res
  const row = (last as { rows?: Array<Record<string, unknown>> } | null | undefined)?.rows?.[0]
  return row && typeof row.pid === 'number' && typeof row.since === 'string' ? { pid: row.pid, since: row.since } : null
}

/** Ends this transaction's connection if its statement, or its wait between statements, is past `overSeconds`; whether it did */
export async function endIfOverrun(me: Me, overSeconds: number): Promise<boolean> {
  try {
    const r = await db.raw(
      `SELECT pg_terminate_backend(pid) AS ended, state,
              round(extract(epoch FROM now() - CASE WHEN state = 'active' THEN query_start ELSE state_change END))::int AS running_s
         FROM pg_stat_activity
        WHERE pid = ? AND xact_start = ?::timestamptz
          AND ((state = 'active' AND query_start < now() - make_interval(secs => ?))
            OR (state = 'idle in transaction' AND state_change < now() - make_interval(secs => ?)))`,
      [me.pid, me.since, overSeconds, overSeconds],
    )
    const row = (r as { rows?: Array<{ ended?: boolean; state?: string; running_s?: number }> })?.rows?.[0]
    if (row?.ended) {
      logger.warn({ pid: me.pid, state: row.state, runningS: row.running_s, overSeconds },
        'long query ended: still running past its own time limit (blocked sending its answer, or its caller stalled)')
      return true
    }
  } catch { /* the next look tries again */ }
  return false
}
