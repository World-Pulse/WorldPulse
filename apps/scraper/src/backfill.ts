/**
 * Backfill: process raw_articles that were scraped but never turned into signals.
 *
 * This happens when:
 *  - The scraper crashed mid-pipeline (e.g. NaN reliability bug)
 *  - Kafka was unavailable and direct mode also failed
 *
 * Called once at scraper startup if unprocessed articles exist.
 */

import { db } from './lib/postgres'
import { logger } from './lib/logger'

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
  const count = await db('raw_articles').where('processed', false).count('id as n').first()
  const total = Number(count?.n ?? 0)

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
      .where('a.processed', false)
      .whereNotNull('a.title')
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
      .limit(BATCH)
      .offset(offset)

    if (rows.length === 0) break

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
