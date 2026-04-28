/**
 * Embedding Pipeline — Phase 1.6.4
 *
 * Generates vector embeddings for signals using OpenAI's text-embedding-3-small
 * and stores them in PostgreSQL via pgvector for semantic similarity search.
 *
 * Features:
 *   - On-insert embedding generation (called from scraper pipeline)
 *   - Semantic similarity search (cosine distance)
 *   - Semantic dedup detection (cosine > 0.92 within 6h = same event)
 *   - Batch backfill for existing signals
 *
 * @module cortex/embeddings
 */

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmbeddingResult {
  embedding: number[]
  tokens_used: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMS = 1536
const SEMANTIC_DEDUP_THRESHOLD = 0.92   // Cosine similarity above this = same event
const SEMANTIC_DEDUP_WINDOW_HOURS = 6
const BACKFILL_BATCH_SIZE = 100
const BACKFILL_DELAY_MS = 500           // Rate limit: ~200/min
const SIMILAR_SIGNAL_LIMIT = 10

// ─── Generate embedding ──────────────────────────────────────────────────────

/**
 * Generate an embedding for a signal's text content.
 * Uses title + first 200 chars of content for optimal cost/quality.
 */
export async function generateEmbedding(
  text: string,
): Promise<EmbeddingResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return null // Graceful degradation — no embeddings without key
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 500), // Cap input for cost control
        dimensions: EMBEDDING_DIMS,
      }),
    })

    if (!response.ok) {
      console.error(`[CORTEX] Embedding API error: ${response.status}`)
      return null
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>
      usage: { total_tokens: number }
    }

    return {
      embedding: data.data[0]!.embedding,
      tokens_used: data.usage.total_tokens,
    }
  } catch (err) {
    console.error('[CORTEX] Embedding generation failed:', err)
    return null
  }
}

// ─── Embed and store for a signal ────────────────────────────────────────────

/**
 * Generate and store embedding for a signal.
 * Called on signal insert or during backfill.
 */
export async function embedSignal(signalId: string): Promise<boolean> {
  const signal = await db('signals')
    .where('id', signalId)
    .select('id', 'title', 'content')
    .first()

  if (!signal) return false

  // Combine title + content snippet for embedding
  const text = `${signal.title}. ${(signal.content ?? '').slice(0, 200)}`
  const result = await generateEmbedding(text)

  if (!result) return false

  // Store as pgvector format: [0.1, 0.2, ...]
  const vectorStr = `[${result.embedding.join(',')}]`
  await db.raw(
    'UPDATE signals SET embedding = ?::vector WHERE id = ?',
    [vectorStr, signalId],
  )

  return true
}

// ─── Semantic similarity search ──────────────────────────────────────────────

/**
 * Find signals semantically similar to a given signal.
 */
export async function findSimilarSignals(
  signalId: string,
  limit: number = SIMILAR_SIGNAL_LIMIT,
): Promise<Array<{
  id: string
  title: string
  category: string
  severity: string
  similarity: number
  published_at: string
}>> {
  // Get the source signal's embedding
  const source = await db.raw(
    'SELECT embedding FROM signals WHERE id = ? AND embedding IS NOT NULL',
    [signalId],
  )

  if (!source.rows?.[0]?.embedding) return []

  // Find nearest neighbors via cosine similarity
  const results = await db.raw(`
    SELECT
      id, title, category, severity, published_at,
      1 - (embedding <=> (SELECT embedding FROM signals WHERE id = ?)) as similarity
    FROM signals
    WHERE id != ?
      AND embedding IS NOT NULL
    ORDER BY embedding <=> (SELECT embedding FROM signals WHERE id = ?)
    LIMIT ?
  `, [signalId, signalId, signalId, limit])

  return (results.rows ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    severity: r.severity,
    similarity: Math.round(Number(r.similarity) * 1000) / 1000,
    published_at: r.published_at,
  }))
}

// ─── Semantic dedup ──────────────────────────────────────────────────────────

/**
 * Check if a signal is a semantic duplicate of a recent signal.
 * Returns the duplicate signal ID if found, null otherwise.
 */
export async function checkSemanticDuplicate(
  signalId: string,
): Promise<string | null> {
  const windowStart = new Date(
    Date.now() - SEMANTIC_DEDUP_WINDOW_HOURS * 3600 * 1000,
  ).toISOString()

  const results = await db.raw(`
    SELECT
      s2.id,
      1 - (s1.embedding <=> s2.embedding) as similarity
    FROM signals s1
    JOIN signals s2
      ON s2.id != s1.id
      AND s2.embedding IS NOT NULL
      AND s2.published_at >= ?
    WHERE s1.id = ?
      AND s1.embedding IS NOT NULL
      AND 1 - (s1.embedding <=> s2.embedding) > ?
    ORDER BY s1.embedding <=> s2.embedding
    LIMIT 1
  `, [windowStart, signalId, SEMANTIC_DEDUP_THRESHOLD])

  const match = results.rows?.[0]
  return match ? match.id : null
}

// ─── Semantic search ─────────────────────────────────────────────────────────

/**
 * Natural language search — embed the query and find nearest signals.
 */
export async function semanticSearch(
  query: string,
  options: {
    limit?: number
    category?: string
    minSimilarity?: number
  } = {},
): Promise<Array<{
  id: string
  title: string
  category: string
  severity: string
  similarity: number
  published_at: string
}>> {
  const { limit = 20, category, minSimilarity = 0.3 } = options

  const result = await generateEmbedding(query)
  if (!result) return []

  const vectorStr = `[${result.embedding.join(',')}]`

  let sql = `
    SELECT
      id, title, category, severity, published_at,
      1 - (embedding <=> ?::vector) as similarity
    FROM signals
    WHERE embedding IS NOT NULL
  `
  const params: any[] = [vectorStr]

  if (category) {
    sql += ' AND category = ?'
    params.push(category)
  }

  sql += ` HAVING 1 - (embedding <=> ?::vector) > ?`
  params.push(vectorStr, minSimilarity)

  sql += ' ORDER BY embedding <=> ?::vector LIMIT ?'
  params.push(vectorStr, limit)

  // Wrap in subquery to use HAVING correctly
  const results = await db.raw(`
    SELECT * FROM (
      SELECT
        id, title, category, severity, published_at,
        1 - (embedding <=> ?::vector) as similarity
      FROM signals
      WHERE embedding IS NOT NULL
        ${category ? 'AND category = ?' : ''}
    ) sub
    WHERE similarity > ?
    ORDER BY similarity DESC
    LIMIT ?
  `, [vectorStr, ...(category ? [category] : []), minSimilarity, limit])

  return (results.rows ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    severity: r.severity,
    similarity: Math.round(Number(r.similarity) * 1000) / 1000,
    published_at: r.published_at,
  }))
}

// ─── Backfill ────────────────────────────────────────────────────────────────

/**
 * Backfill embeddings for existing signals that don't have them.
 * Runs in batches with rate limiting.
 */
export async function backfillEmbeddings(
  batchSize: number = BACKFILL_BATCH_SIZE,
): Promise<{ processed: number; embedded: number; failed: number }> {
  console.log('[CORTEX] Starting embedding backfill...')

  const signals = await db('signals')
    .whereNull('embedding')
    .select('id', 'title', 'content')
    .orderBy('created_at', 'desc')
    .limit(batchSize)

  let embedded = 0
  let failed = 0

  for (const signal of signals) {
    const text = `${signal.title}. ${(signal.content ?? '').slice(0, 200)}`
    const result = await generateEmbedding(text)

    if (result) {
      const vectorStr = `[${result.embedding.join(',')}]`
      await db.raw(
        'UPDATE signals SET embedding = ?::vector WHERE id = ?',
        [vectorStr, signal.id],
      )
      embedded++
    } else {
      failed++
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, BACKFILL_DELAY_MS))
  }

  console.log(`[CORTEX] Embedding backfill: ${embedded} embedded, ${failed} failed out of ${signals.length}`)
  return { processed: signals.length, embedded, failed }
}

/**
 * Get embedding coverage stats.
 */
export async function getEmbeddingStats(): Promise<{
  total_signals: number
  with_embedding: number
  without_embedding: number
  coverage_pct: number
}> {
  const stats = await db.raw(`
    SELECT
      COUNT(*) as total,
      COUNT(embedding) as with_embedding,
      COUNT(*) - COUNT(embedding) as without_embedding
    FROM signals
  `)

  const row = stats.rows?.[0] ?? {}
  const total = Number(row.total ?? 0)
  const withEmb = Number(row.with_embedding ?? 0)

  return {
    total_signals: total,
    with_embedding: withEmb,
    without_embedding: total - withEmb,
    coverage_pct: total > 0 ? Math.round((withEmb / total) * 10000) / 100 : 0,
  }
}
