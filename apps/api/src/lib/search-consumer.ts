/**
 * Meilisearch indexing consumer.
 *
 * Intended to listen on Kafka topics and keep Meilisearch indexes in sync.
 * Currently a no-op stub — the API routes call Meilisearch directly so search
 * works without this background consumer.
 *
 * Kafka integration is deferred until kafkajs ships ESM-compatible types
 * compatible with the project's NodeNext moduleResolution.
 */

export async function startSearchConsumer(): Promise<void> {
  // no-op: routes use direct Meilisearch indexing
}

export async function stopSearchConsumer(): Promise<void> {
  // no-op
}
