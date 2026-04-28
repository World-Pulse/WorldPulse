/**
 * Search event publisher.
 *
 * Designed for Kafka-based async indexing, but falls back to silent no-ops
 * when Kafka is unavailable — the routes call Meilisearch directly as a
 * synchronous fallback, so search always works without this layer.
 *
 * Kafka integration is deferred until kafkajs ships ESM-compatible types
 * compatible with the project's NodeNext moduleResolution.
 */

// ─── Topics ───────────────────────────────────────────────────────────────

export const TOPIC_SIGNAL_UPDATED = 'signals.updated'
export const TOPIC_SIGNAL_DELETED = 'signals.deleted'
export const TOPIC_POST_CREATED   = 'posts.created'
export const TOPIC_POST_DELETED   = 'posts.deleted'

// ─── Lifecycle (no-ops until Kafka integration is enabled) ────────────────

export async function connectSearchProducer(): Promise<void> {
  // Kafka integration pending — routes use direct Meilisearch indexing
}

export async function disconnectSearchProducer(): Promise<void> {
  // no-op
}

// ─── Publish helpers (always no-ops in this stub) ─────────────────────────

/** Call after a signal is inserted or updated in PostgreSQL. */
export function publishSignalUpsert(_id: string): void {
  // no-op: direct Meilisearch indexing is handled in the signals route
}

/** Call after a signal is hard-deleted from PostgreSQL. */
export function publishSignalDelete(_id: string): void {
  // no-op: direct Meilisearch removal is handled in the signals route
}

/** Call after a post is inserted in PostgreSQL. */
export function publishPostCreated(_id: string): void {
  // no-op
}

/** Call after a post is soft-deleted in PostgreSQL. */
export function publishPostDeleted(_id: string): void {
  // no-op
}
