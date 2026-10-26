import Knex from 'knex'
import { Pool } from 'pg'

/**
 * Every statement the scraper sends gets a time limit (Oct 26, 2026). The
 * API's pool has had one since April (5 s, apps/api/src/db/postgres.ts); the
 * scraper's had none. On Oct 26 the server read a load of 54 on its 2 CPUs
 * with about 50 queries running at once, the oldest for over 3 hours: a query
 * without a limit keeps running in the database after the scraper stops
 * waiting for it, even after the scraper restarts (each deploy, each crash),
 * and the next run starts another beside it. With a limit, the database ends
 * it itself. 2 minutes is far above what any of the scraper's statements takes
 * on a healthy server; a job that needs more says so with SET LOCAL in a
 * transaction.
 */
export const SCRAPER_STATEMENT_TIMEOUT_MS = 120_000

export const db = Knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
    statement_timeout: SCRAPER_STATEMENT_TIMEOUT_MS,
  },
  pool: { min: 2, max: 10 },
})

// Raw pg Pool for modules that use db.query() directly (e.g. entity-graph.ts)
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  statement_timeout: SCRAPER_STATEMENT_TIMEOUT_MS,
})
