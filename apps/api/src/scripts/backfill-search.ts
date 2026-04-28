/**
 * Backfill Meilisearch indexes from PostgreSQL.
 *
 * Usage:
 *   pnpm --filter @worldpulse/api search:backfill
 *
 * Reads DATABASE_URL and MEILI_HOST / MEILI_KEY from the environment.
 * Safe to re-run — addDocuments is idempotent (upsert by id).
 */

import 'dotenv/config'
import Knex from 'knex'
import { setupSearchIndexes, indexSignals, indexPosts, indexUsers } from '../lib/search.js'

const BATCH = 500

const db = Knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  },
})

// ─── Helpers ──────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`[backfill] ${msg}\n`)
}

async function backfillSignals(): Promise<number> {
  let offset = 0
  let total = 0

  log('Indexing signals…')
  for (;;) {
    const rows = await db('signals')
      .select([
        'id', 'title', 'summary', 'category', 'severity', 'status',
        'reliability_score', 'location_name', 'country_code', 'tags',
        'language', 'view_count', 'post_count', 'created_at',
      ])
      .orderBy('created_at', 'asc')
      .limit(BATCH)
      .offset(offset)

    if (rows.length === 0) break

    await indexSignals(rows)
    total += rows.length
    log(`  signals: ${total} indexed`)
    offset += BATCH
  }

  return total
}

async function backfillPosts(): Promise<number> {
  let offset = 0
  let total = 0

  log('Indexing posts…')
  for (;;) {
    // Join with users to get author handle / display_name
    const rows = await db('posts as p')
      .join('users as u', 'p.author_id', 'u.id')
      .whereNull('p.deleted_at')
      .select([
        'p.id', 'p.content', 'p.post_type', 'p.tags', 'p.author_id',
        'p.like_count', 'p.boost_count', 'p.reply_count',
        'p.source_name', 'p.language', 'p.signal_id', 'p.created_at',
        'u.handle as author_handle',
        'u.display_name as author_display_name',
      ])
      .orderBy('p.created_at', 'asc')
      .limit(BATCH)
      .offset(offset)

    if (rows.length === 0) break

    await indexPosts(rows)
    total += rows.length
    log(`  posts: ${total} indexed`)
    offset += BATCH
  }

  return total
}

async function backfillUsers(): Promise<number> {
  let offset = 0
  let total = 0

  log('Indexing users…')
  for (;;) {
    const rows = await db('users')
      .where('suspended', false)
      .select([
        'id', 'handle', 'display_name', 'bio',
        'account_type', 'verified', 'follower_count', 'trust_score',
      ])
      .orderBy('created_at', 'asc')
      .limit(BATCH)
      .offset(offset)

    if (rows.length === 0) break

    await indexUsers(rows)
    total += rows.length
    log(`  users: ${total} indexed`)
    offset += BATCH
  }

  return total
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  log('Setting up Meilisearch indexes…')
  await setupSearchIndexes()
  log('Index settings applied.')

  const [signals, posts, users] = await Promise.all([
    backfillSignals(),
    backfillPosts(),
    backfillUsers(),
  ])

  log('─'.repeat(40))
  log(`Done. signals=${signals}  posts=${posts}  users=${users}`)
}

main()
  .catch(err => {
    process.stderr.write(`[backfill] FATAL: ${(err as Error).message}\n`)
    process.exit(1)
  })
  .finally(() => db.destroy())
