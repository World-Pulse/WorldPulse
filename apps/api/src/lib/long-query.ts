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
 */

import type { Knex } from 'knex'
import { db } from '../db/postgres'

export function longQuery<T>(seconds: number, run: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const limit = Math.max(1, Math.round(seconds))
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL statement_timeout = '${limit}s'`)
    return run(trx)
  })
}
