/**
 * An index on the reports each entity is named in (Devon's OK, Oct 20, 2026,
 * 8:38 AM). An entity page's "named with" list finds the entities named in the
 * same reports with `entity_nodes.signal_ids && …`; with no index that reads
 * the whole knowledge graph, which took 6–12 s for the busiest names
 * (lib/entity-profile.ts). A GIN index answers it at once.
 *
 * Built when the API starts, CONCURRENTLY, so the scraper keeps writing
 * entities while it builds (a few minutes on a large table), on one connection
 * without the pool's 5-second limit. It only adds: when a build was cut off
 * before (a restart leaves an unfinished index Postgres marks invalid), that
 * unfinished index is dropped and built again. No data is changed.
 */

import { db } from '../db/postgres'
import { logger } from './logger'

export const ENTITY_SIGNALS_INDEX = 'idx_entity_nodes_signal_ids'

/** The pool's own limit, put back on the connection before it goes back to the pool (db/postgres.ts) */
const POOL_STATEMENT_TIMEOUT = 'SET statement_timeout = 5000'

type Conn = { query: (sql: string) => Promise<{ rows?: Array<Record<string, unknown>> }> }

/** 'ready' (it was there), 'built' (made now) or 'failed' (the API runs on without it) */
export async function ensureEntitySignalsIndex(): Promise<'ready' | 'built' | 'failed'> {
  let conn: Conn | null = null
  try {
    conn = await db.client.acquireConnection() as Conn
    const found = await conn.query(
      `SELECT i.indisvalid AS valid
         FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = '${ENTITY_SIGNALS_INDEX}'`)
    const row = (found.rows ?? [])[0]
    if (row && row.valid === true) return 'ready'
    await conn.query('SET statement_timeout = 0')
    if (row) await conn.query(`DROP INDEX CONCURRENTLY IF EXISTS ${ENTITY_SIGNALS_INDEX}`)
    const started = Date.now()
    await conn.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${ENTITY_SIGNALS_INDEX} ON entity_nodes USING gin (signal_ids)`)
    logger.info({ index: ENTITY_SIGNALS_INDEX, seconds: Math.round((Date.now() - started) / 1000) }, 'Entity report index built')
    return 'built'
  } catch (err) {
    logger.warn({ err, index: ENTITY_SIGNALS_INDEX }, 'Entity report index not built (entity pages work without it, more slowly)')
    return 'failed'
  } finally {
    if (conn) {
      await conn.query(POOL_STATEMENT_TIMEOUT).catch(() => {})
      await Promise.resolve(db.client.releaseConnection(conn)).catch(() => {})
    }
  }
}
