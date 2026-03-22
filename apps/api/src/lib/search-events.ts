/**
 * Search event publisher.
 *
 * Publishes signal / post lifecycle events to Kafka so the
 * api-search-indexer consumer can pick them up and index them
 * in Meilisearch asynchronously.
 *
 * If Kafka is unavailable the publish functions are silent no-ops —
 * the routes already call Meilisearch directly as a synchronous fallback.
 */

import { Kafka, Producer, logLevel } from 'kafkajs'
import { logger } from './logger'

// ─── Topics ───────────────────────────────────────────────────────────────

export const TOPIC_SIGNAL_UPDATED = 'signals.updated'
export const TOPIC_SIGNAL_DELETED = 'signals.deleted'
export const TOPIC_POST_CREATED   = 'posts.created'
export const TOPIC_POST_DELETED   = 'posts.deleted'

// ─── Kafka producer ───────────────────────────────────────────────────────

const kafka = new Kafka({
  clientId: 'wp-api-search-producer',
  brokers:  (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  logLevel: logLevel.WARN,
  retry: { retries: 2, initialRetryTime: 100 },
})

let producer: Producer | null = null
let connected = false

export async function connectSearchProducer(): Promise<void> {
  try {
    const admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({
      waitForLeaders: true,
      topics: [
        { topic: TOPIC_SIGNAL_UPDATED, numPartitions: 4, replicationFactor: 1 },
        { topic: TOPIC_SIGNAL_DELETED, numPartitions: 1, replicationFactor: 1 },
        { topic: TOPIC_POST_CREATED,   numPartitions: 4, replicationFactor: 1 },
        { topic: TOPIC_POST_DELETED,   numPartitions: 1, replicationFactor: 1 },
      ],
    })
    await admin.disconnect()

    producer = kafka.producer({ allowAutoTopicCreation: false })
    await producer.connect()
    connected = true
    logger.info('Search event producer connected')
  } catch (err) {
    logger.warn({ err }, 'Search event producer failed to connect — routes will use direct Meilisearch indexing')
  }
}

export async function disconnectSearchProducer(): Promise<void> {
  try {
    await producer?.disconnect()
  } catch { /* ignore */ }
}

// ─── Publish helpers (fire-and-forget, never throw) ───────────────────────

async function publish(topic: string, value: unknown): Promise<void> {
  if (!connected || !producer) return
  try {
    await producer.send({ topic, messages: [{ value: JSON.stringify(value) }] })
  } catch (err) {
    logger.warn({ topic, err }, 'Search event publish failed (non-fatal)')
  }
}

/** Call after a signal is inserted or updated in PostgreSQL. */
export function publishSignalUpsert(id: string): void {
  publish(TOPIC_SIGNAL_UPDATED, { id }).catch(() => {})
}

/** Call after a signal is hard-deleted from PostgreSQL. */
export function publishSignalDelete(id: string): void {
  publish(TOPIC_SIGNAL_DELETED, { id }).catch(() => {})
}

/** Call after a post is inserted in PostgreSQL. */
export function publishPostCreated(id: string): void {
  publish(TOPIC_POST_CREATED, { id }).catch(() => {})
}

/** Call after a post is soft-deleted in PostgreSQL. */
export function publishPostDeleted(id: string): void {
  publish(TOPIC_POST_DELETED, { id }).catch(() => {})
}
