/**
 * An index on the reports linked into story threads, by report (Nov 15, 2026). The status file's database
 * readout showed that table read end to end 3.8 million times (about 1.1 trillion rows), a hundred times
 * more than any other table: every lookup by report ("is this report in a thread yet?") read the whole
 * table. With the index it reads only the rows it needs.
 *
 * Built when the API starts, CONCURRENTLY, so reports keep being written while it builds (a few minutes),
 * on one connection without the pool's 5-second limit, as ensureEntitySignalsIndex does. When any index
 * already leads with the report's id, nothing is done. A build cut off before (a restart leaves an
 * unfinished index Postgres marks invalid) is dropped and built again. No data is changed.
 */

import { db } from '../db/postgres'
import { logger } from './logger'

export const THREAD_SIGNAL_INDEX = 'idx_ets_signal_id'

/** The pool's own limit, put back on the connection before it goes back to the pool (db/postgres.ts) */
const POOL_STATEMENT_TIMEOUT = 'SET statement_timeout = 5000'

type Conn = { query: (sql: string) => Promise<{ rows?: Array<Record<string, unknown>> }> }

/** Whether an index on the table already leads with signal_id ("CREATE INDEX ... (signal_id)" or "(signal_id, ...)") */
export function leadsWithSignalId(indexdef: string): boolean {
  return /\(\s*"?signal_id"?\s*[,)]/i.test(indexdef)
}

/** 'ready' (one was there), 'built' (made now), 'no table' or 'failed' (the API runs on without it) */
export async function ensureThreadSignalIndex(): Promise<'ready' | 'built' | 'no table' | 'failed'> {
  let conn: Conn | null = null
  try {
    conn = await db.client.acquireConnection() as Conn
    const table = await conn.query(`SELECT to_regclass('public.event_thread_signals') IS NOT NULL AS ok`)
    if ((table.rows ?? [])[0]?.ok !== true) return 'no table'
    const found = await conn.query(
      `SELECT c.relname AS name, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = 'public.event_thread_signals'::regclass`)
    const rows = found.rows ?? []
    if (rows.some(r => r.valid === true && leadsWithSignalId(String(r.def ?? '')))) return 'ready'
    await conn.query('SET statement_timeout = 0')
    if (rows.some(r => r.name === THREAD_SIGNAL_INDEX)) await conn.query(`DROP INDEX CONCURRENTLY IF EXISTS ${THREAD_SIGNAL_INDEX}`)
    const started = Date.now()
    await conn.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${THREAD_SIGNAL_INDEX} ON event_thread_signals (signal_id)`)
    await conn.query('ANALYZE event_thread_signals')
    logger.info({ index: THREAD_SIGNAL_INDEX, seconds: Math.round((Date.now() - started) / 1000) }, 'Thread report index built')
    return 'built'
  } catch (err) {
    logger.warn({ err, index: THREAD_SIGNAL_INDEX }, 'Thread report index not built (threads work without it, more slowly)')
    return 'failed'
  } finally {
    if (conn) {
      await conn.query(POOL_STATEMENT_TIMEOUT).catch(() => {})
      await Promise.resolve(db.client.releaseConnection(conn)).catch(() => {})
    }
  }
}
