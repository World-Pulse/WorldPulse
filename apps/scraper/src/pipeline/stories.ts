/**
 * Story ids: signals the same-story rule grouped are one story (plan item 12a,
 * .hq/departments/product/story-view-plan.md). A story's id is the id of its
 * first signal; a signal no story has claimed has story_id NULL and is its own
 * story, so readers use COALESCE(story_id, id).
 *
 * Only applyCorroborationBoost (correlate.ts) joins signals into a story: it is
 * the one place two signals are found to report the same story. The duplicate
 * and topic-merge paths add outlets to a single signal.
 */

import { db } from '../lib/postgres'
import { logger } from '../lib/logger'

let storyIdColumn: Promise<boolean> | null = null

/** After a failure, how long to wait before trying to add the column again */
const RETRY_MS = 60 * 60_000

/**
 * Make sure signals.story_id and its index exist (production doesn't run knex
 * migrations on deploy). Cached; after a failure it answers false for an hour,
 * then tries again.
 */
export function ensureStoryIdColumn(): Promise<boolean> {
  if (!storyIdColumn) {
    storyIdColumn = Promise.resolve()
      .then(() => db.raw(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'signals' AND column_name = 'story_id' LIMIT 1`))
      .then(found => {
        if (((found as { rows?: unknown[] } | undefined)?.rows ?? []).length > 0) return
        // Adding a nullable column is instant, but it needs a moment's exclusive
        // lock: give up after 5 s rather than queue inserts behind a long query
        return db.transaction(async trx => {
          await trx.raw(`SET LOCAL lock_timeout = '5s'`)
          await trx.raw('ALTER TABLE signals ADD COLUMN IF NOT EXISTS story_id uuid')
        })
      })
      // CONCURRENTLY: building the index must not block inserts on a big table
      .then(() => db.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_story_created ON signals (story_id, created_at DESC)'))
      .then(() => true)
      .catch(err => {
        logger.warn({ err }, 'Could not add signals.story_id (stories stay ungrouped for now)')
        setTimeout(() => { storyIdColumn = null }, RETRY_MS).unref?.()
        return false
      })
  }
  return storyIdColumn
}

/**
 * Put signals the same-story rule grouped into one story. Every member, and
 * every signal already in a story with one of them, gets the id of the oldest
 * of them, so two stories that meet become one under the older id.
 * Returns how many signals changed story.
 */
export async function joinStory(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length < 2 || !(await ensureStoryIdColumn())) return 0
  const result = await db.raw(
    `WITH members AS (
        SELECT id, created_at FROM signals WHERE id = ANY(?::uuid[])
        UNION
        SELECT s.id, s.created_at FROM signals s
         WHERE s.story_id IN (SELECT story_id FROM signals WHERE id = ANY(?::uuid[]) AND story_id IS NOT NULL)
      ),
      root AS (SELECT id FROM members ORDER BY created_at ASC, id ASC LIMIT 1)
      UPDATE signals SET story_id = (SELECT id FROM root)
       WHERE id IN (SELECT id FROM members)
         AND story_id IS DISTINCT FROM (SELECT id FROM root)`,
    [unique, unique],
  )
  return Number((result as { rowCount?: number } | undefined)?.rowCount ?? 0)
}
