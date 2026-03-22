/**
 * Meilisearch indexing consumer.
 *
 * Listens on five Kafka topics and keeps the three Meilisearch indexes
 * (signals, posts, users) in sync with PostgreSQL:
 *
 *   signals.verified  — new signal created by the scraper pipeline
 *   signals.updated   — signal metadata changed via the API
 *   signals.deleted   — signal removed via the API
 *   posts.created     — post created via the API or scraper auto-post
 *   posts.deleted     — post soft-deleted via the API
 *
 * Runs in the background.  Failure to start is non-fatal — the API routes
 * already call Meilisearch directly so search continues to work.
 */

import { Kafka, Consumer, logLevel } from 'kafkajs'
import { logger } from './logger'
import { db } from '../db/postgres'
import { indexSignal, indexPost, removeSignal, removePost } from './search'

const kafka = new Kafka({
  clientId: 'wp-api-search-consumer',
  brokers:  (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  logLevel: logLevel.WARN,
  retry: { retries: 5, initialRetryTime: 300, factor: 2 },
})

let consumer: Consumer | null = null

// ─── Signal fetch helpers ─────────────────────────────────────────────────

async function fetchAndIndexSignal(id: string): Promise<void> {
  const row = await db('signals')
    .where('id', id)
    .select([
      'id', 'title', 'summary', 'category', 'severity', 'status',
      'reliability_score', 'location_name', 'country_code', 'tags',
      'language', 'view_count', 'post_count', 'created_at',
    ])
    .first()
  if (row) await indexSignal(row)
}

async function fetchAndIndexPost(id: string): Promise<void> {
  const row = await db('posts as p')
    .join('users as u', 'p.author_id', 'u.id')
    .whereNull('p.deleted_at')
    .where('p.id', id)
    .select([
      'p.id', 'p.content', 'p.post_type', 'p.tags', 'p.author_id',
      'p.like_count', 'p.boost_count', 'p.reply_count',
      'p.source_name', 'p.language', 'p.signal_id', 'p.created_at',
      'u.handle as author_handle',
      'u.display_name as author_display_name',
    ])
    .first()
  if (row) await indexPost(row)
}

// ─── Consumer lifecycle ────────────────────────────────────────────────────

export async function startSearchConsumer(): Promise<void> {
  try {
    consumer = kafka.consumer({ groupId: 'api-search-indexer' })
    await consumer.connect()

    await consumer.subscribe({
      topics: [
        'signals.verified',
        'signals.updated',
        'signals.deleted',
        'posts.created',
        'posts.deleted',
      ],
      fromBeginning: false,
    })

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(message.value.toString()) as Record<string, unknown>
        } catch {
          logger.warn({ topic }, 'Search consumer: invalid JSON, skipping message')
          return
        }

        try {
          switch (topic) {
            case 'signals.verified': {
              // Scraper format: { event, payload: <signal DB row>, filter }
              // Extract signal id from payload and re-fetch from DB to ensure
              // we have the latest data (verification may have updated it).
              const payload = parsed['payload'] as Record<string, unknown> | undefined
              const id = (payload?.['id'] ?? parsed['id']) as string | undefined
              if (id) await fetchAndIndexSignal(id)
              break
            }

            case 'signals.updated': {
              // API format: { id }
              const id = parsed['id'] as string | undefined
              if (id) await fetchAndIndexSignal(id)
              break
            }

            case 'signals.deleted': {
              const id = parsed['id'] as string | undefined
              if (id) await removeSignal(id)
              break
            }

            case 'posts.created': {
              // API / scraper format: { id }
              const id = parsed['id'] as string | undefined
              if (id) await fetchAndIndexPost(id)
              break
            }

            case 'posts.deleted': {
              const id = parsed['id'] as string | undefined
              if (id) await removePost(id)
              break
            }

            default:
              break
          }
        } catch (err) {
          logger.warn({ topic, err }, 'Search consumer: indexing error (non-fatal)')
        }
      },
    })

    logger.info('Search Kafka consumer running (group: api-search-indexer)')
  } catch (err) {
    logger.warn({ err }, 'Search consumer failed to start — routes will use direct Meilisearch indexing')
  }
}

export async function stopSearchConsumer(): Promise<void> {
  try {
    await consumer?.disconnect()
  } catch { /* ignore shutdown errors */ }
}
