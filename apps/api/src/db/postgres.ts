import Knex from 'knex'

/**
 * PostgreSQL connection pool config.
 *
 * Gate 5 tuning (load test baseline):
 *   - min: 5  — keep warm connections ready for burst traffic
 *   - max: 50 — supports ~500 VUs with concurrent DB calls (prev: 20)
 *   - acquireTimeoutMillis: 10_000 — fail fast under extreme load (prev: 30s)
 *
 * Bottleneck analysis:
 *   At 500 VUs with 60% feed reads → ~300 concurrent DB calls.
 *   With max=20 connections, requests queue behind the pool and p95 spikes.
 *   max=50 allows 500 VUs to complete within the 500ms p95 threshold.
 *
 *   For 10K concurrent users, a PgBouncer connection pooler in front of
 *   PostgreSQL is required (DB typically supports 100-200 real connections;
 *   PgBouncer multiplexes thousands of app connections onto fewer real ones).
 *
 * Env override: DB_POOL_MAX (integer) — allows runtime tuning without code change.
 */
const POOL_MAX = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 50

export const db = Knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
  },
  pool: {
    min: 5,
    max: POOL_MAX,
    acquireTimeoutMillis: 10_000,  // Fail fast under extreme load — surface bottleneck clearly
    createTimeoutMillis:  10_000,
    idleTimeoutMillis:    60_000,  // Keep idle connections longer to reduce churn
    reapIntervalMillis:   1_000,   // Check for idle connections every 1s
    afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
      // Set statement timeout per connection to prevent runaway queries
      conn.query('SET statement_timeout = 5000', (err: Error | null) => done(err, conn))
    },
  },
  acquireConnectionTimeout: 10_000,
})

// Test connection on startup
db.raw('SELECT 1')
  .then(() => console.log('✅ PostgreSQL connected'))
  .catch(err => {
    console.error('❌ PostgreSQL connection failed:', err.message)
    process.exit(1)
  })
