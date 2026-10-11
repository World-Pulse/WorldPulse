/**
 * Backfill: process raw_articles that were scraped but never turned into signals.
 *
 * This happens when:
 *  - The scraper crashed mid-pipeline (e.g. NaN reliability bug)
 *  - Kafka was unavailable and direct mode also failed
 *
 * Called once at scraper startup if unprocessed articles exist. Only articles
 * from the last 3 days become signals (pipeline/freshness.ts): when the
 * pipeline came back on Oct 7, 2026, articles saved in May were published as
 * new signals. Older ones are marked processed without a signal.
 */

import { db } from './lib/postgres'
import { logger } from './lib/logger'
import { MAX_ITEM_AGE_MS } from './pipeline/freshness'

type ArticleRow = {
  id: string
  source_id: string
  url: string
  title: string | null
  body: string | null
  published_at: Date | null
  tier: string
  trust_score: string | number
}

export async function backfillUnprocessed(
  processGroup: (
    topicHash: string,
    articles: Array<{
      articleId: string
      sourceId: string
      url: string
      title: string
      body: string
      publishedAt: string
      sourceTier: string
      sourceTrust: number
    }>
  ) => Promise<void>
): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_ITEM_AGE_MS)

  // Saved, or published, more than 3 days ago: old news, never a new signal
  const skipped = await db('raw_articles')
    .where('processed', false)
    .where(q => q.where('fetched_at', '<', cutoff).orWhere('published_at', '<', cutoff))
    .update({ processed: true })
  if (Number(skipped) > 0) {
    logger.info({ skipped: Number(skipped) }, 'Backfill: raw articles older than 3 days left out')
  }

  // The ones to process, listed up front: processing marks a row processed,
  // so paging through "unprocessed" with an offset skipped every other batch
  const pending = await db('raw_articles')
    .where('processed', false)
    .whereNotNull('title')
    .orderBy('published_at', 'desc')
    .pluck('id') as string[]
  const total = pending.length

  if (total === 0) {
    logger.info('Backfill: no unprocessed articles')
    return
  }

  logger.info({ total }, 'Backfill: processing unprocessed raw_articles')

  // Fetch in batches to avoid loading everything into memory
  const BATCH = 50
  let offset = 0
  let processed = 0

  while (offset < total) {
    const rows = await db<ArticleRow>('raw_articles as a')
      .join('sources as s', 's.id', 'a.source_id')
      .whereIn('a.id', pending.slice(offset, offset + BATCH))
      .where('a.processed', false)
      .select(
        'a.id',
        'a.source_id',
        'a.url',
        'a.title',
        'a.body',
        'a.published_at',
        's.tier',
        's.trust_score',
      )
      .orderBy('a.published_at', 'desc')

    if (rows.length === 0) { offset += BATCH; continue }

    // Group by a simple topic hash so corroborating articles can merge
    const groups = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = topicHash(row.title ?? '')
      const g = groups.get(key) ?? []
      g.push(row)
      groups.set(key, g)
    }

    for (const [hash, group] of groups) {
      try {
        await processGroup(
          hash,
          group.map(r => ({
            articleId:   r.id,
            sourceId:    r.source_id,
            url:         r.url,
            title:       r.title ?? '',
            body:        r.body ?? '',
            publishedAt: r.published_at ? r.published_at.toISOString() : new Date().toISOString(),
            sourceTier:  r.tier,
            sourceTrust: Number(r.trust_score) || 0.5,
          }))
        )
        processed += group.length
      } catch (err) {
        logger.warn({ err, hash }, 'Backfill: group processing failed (skipping)')
      }
    }

    offset += BATCH
    logger.info({ processed, total }, 'Backfill progress')

    // Small pause between batches to avoid hammering the DB + LLM
    await new Promise(r => setTimeout(r, 500))
  }

  logger.info({ processed }, 'Backfill complete')
}

function topicHash(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5)
    .sort()
    .join('_')
}
