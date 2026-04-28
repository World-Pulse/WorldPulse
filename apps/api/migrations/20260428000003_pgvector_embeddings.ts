import type { Knex } from 'knex'

/**
 * Phase 1.6.4 — Semantic Similarity via pgvector
 *
 * Adds vector embedding column to signals table and creates HNSW index
 * for fast cosine similarity search.
 */
export async function up(knex: Knex): Promise<void> {
  // Enable pgvector extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector')

  // Add embedding column to signals table
  // text-embedding-3-small produces 1536-dimension vectors
  await knex.raw(`
    ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS embedding vector(1536)
  `)

  // HNSW index for fast cosine similarity search
  // m=16 and ef_construction=64 balance speed vs recall for ~100K-500K vectors
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_signals_embedding_hnsw
    ON signals USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_signals_embedding_hnsw')
  await knex.raw('ALTER TABLE signals DROP COLUMN IF EXISTS embedding')
  // Don't drop the extension — other things might use it
}
