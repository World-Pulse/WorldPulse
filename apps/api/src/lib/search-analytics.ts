/**
 * Search analytics — logs every search query to ClickHouse and PostgreSQL.
 * Uses the ClickHouse HTTP interface so no extra npm dependency is required.
 * All operations are fire-and-forget; errors are swallowed to keep the
 * search route latency unaffected.
 */
import { db } from '../db/postgres'

const CLICKHOUSE_URL      = process.env.CLICKHOUSE_URL      ?? 'http://localhost:8123'
const CLICKHOUSE_DB       = process.env.CLICKHOUSE_DB       ?? 'worldpulse'
const CLICKHOUSE_USER     = process.env.CLICKHOUSE_USER     ?? 'default'
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? ''

// ─── Helpers ──────────────────────────────────────────────────────────────

function chUrl(query: string): string {
  const u = new URL(CLICKHOUSE_URL)
  u.searchParams.set('query', query)
  u.searchParams.set('user', CLICKHOUSE_USER)
  if (CLICKHOUSE_PASSWORD) u.searchParams.set('password', CLICKHOUSE_PASSWORD)
  return u.toString()
}

async function chExec(query: string, body?: string): Promise<void> {
  await fetch(chUrl(query), {
    method: body !== undefined ? 'POST' : 'GET',
    ...(body !== undefined ? { body, headers: { 'Content-Type': 'text/plain' } } : {}),
  })
}

// ─── Table initialisation ─────────────────────────────────────────────────

/** Creates the worldpulse database and search_analytics table if missing.
 *  Safe to call on every startup — uses IF NOT EXISTS. */
export async function initClickHouse(): Promise<void> {
  await chExec(`CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DB}`)

  await chExec(`
    CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DB}.search_analytics
    (
      ts           DateTime     DEFAULT now(),
      query        String,
      search_type  LowCardinality(String),
      result_count UInt32,
      zero_results UInt8
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(ts)
    ORDER BY (ts, search_type)
    TTL ts + INTERVAL 90 DAY
  `)
}

// ─── Log a query ──────────────────────────────────────────────────────────

export interface SearchAnalyticsEvent {
  query:       string
  searchType:  string
  resultCount: number
  zeroResults: boolean
}

/** Fire-and-forget. Never throws. */
export function logSearchQuery(event: SearchAnalyticsEvent): void {
  const row = JSON.stringify({
    query:        event.query,
    search_type:  event.searchType,
    result_count: event.resultCount,
    zero_results: event.zeroResults ? 1 : 0,
  })

  // Log to ClickHouse (long-term analytics with TTL)
  chExec(
    `INSERT INTO ${CLICKHOUSE_DB}.search_analytics FORMAT JSONEachRow`,
    row,
  ).catch(() => { /* non-fatal */ })

  // Log to PostgreSQL (structured, queryable via existing DB)
  db('search_analytics')
    .insert({
      query:        event.query,
      search_type:  event.searchType,
      result_count: event.resultCount,
      zero_results: event.zeroResults,
    })
    .catch(() => { /* non-fatal — table may not exist on older deploys */ })
}
