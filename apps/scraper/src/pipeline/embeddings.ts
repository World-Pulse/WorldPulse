/**
 * Embeddings Pipeline — Vector embeddings for semantic search & similarity
 *
 * Primary:  OpenAI text-embedding-3-small (1536 dims, ~$0.02/1M tokens)
 * Fallback: TF-IDF sparse vectors stored as dense 1536-dim approximation
 *
 * Two modes:
 *   1. On-insert:  Embed each new signal as it arrives (non-blocking)
 *   2. Batch:      Backfill signals missing embeddings (scheduled every 30 min)
 *
 * @module pipeline/embeddings
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'

// ─── Config ─────────────────────────────────────────────────────────────────

const OPENAI_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIM = 1536
const BATCH_SIZE = 50                     // Signals per batch cycle
const MAX_TEXT_LENGTH = 8000              // Truncate text to ~2K tokens
const RATE_LIMIT_DELAY_MS = 200           // Delay between API calls to avoid 429s
const CACHE_TTL = 3600                    // Cache embedding status for 1 hour

// ─── OpenAI Client ──────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  usage: { prompt_tokens: number; total_tokens: number }
}

/**
 * Call OpenAI embeddings API for a batch of texts.
 * Returns array of 1536-dim vectors.
 */
async function openaiEmbed(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: texts.map(t => t.substring(0, MAX_TEXT_LENGTH)),
    }),
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`OpenAI API ${response.status}: ${errBody.substring(0, 200)}`)
  }

  const json = (await response.json()) as EmbeddingResponse
  return json.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}

// ─── TF-IDF Fallback ────────────────────────────────────────────────────────

/**
 * Simple TF-IDF-based embedding fallback when OpenAI is not available.
 * Creates a deterministic sparse-to-dense projection using term hashing.
 * Not as good as neural embeddings but sufficient for basic clustering.
 */
function tfidfEmbed(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIM)
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && w.length < 30)

  if (words.length === 0) return Array.from(vec)

  // Term frequency with position decay
  const tf: Record<string, number> = {}
  for (let i = 0; i < words.length; i++) {
    const decay = 1 + (i < 20 ? 1 : 0) // Boost title-position words
    tf[words[i]] = (tf[words[i]] ?? 0) + decay
  }

  // Hash each term into multiple dimensions (simulated dense projection)
  for (const [term, freq] of Object.entries(tf)) {
    const hash1 = simpleHash(term)
    const hash2 = simpleHash(term + '_2')
    const hash3 = simpleHash(term + '_3')

    const weight = Math.log1p(freq) / Math.log1p(words.length) // normalized TF
    vec[hash1 % EMBEDDING_DIM] += weight
    vec[hash2 % EMBEDDING_DIM] -= weight * 0.5
    vec[hash3 % EMBEDDING_DIM] += weight * 0.3
  }

  // L2 normalize
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm

  return Array.from(vec)
}

function simpleHash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Embed a single signal (called on-insert, non-blocking).
 * Tries OpenAI first, falls back to TF-IDF.
 */
export async function embedSignal(signalId: string, title: string, summary: string): Promise<void> {
  try {
    const text = `${title}\n${summary ?? ''}`.trim()
    if (!text || text.length < 10) return

    let embedding: number[]

    if (OPENAI_API_KEY) {
      try {
        const [vec] = await openaiEmbed([text])
        embedding = vec
      } catch (err) {
        logger.debug({ err, signalId }, '[EMBED] OpenAI failed, using TF-IDF fallback')
        embedding = tfidfEmbed(text)
      }
    } else {
      embedding = tfidfEmbed(text)
    }

    // Store as pgvector — format: [0.1, 0.2, ...]
    const vectorStr = `[${embedding.join(',')}]`
    await db.raw(
      `UPDATE signals SET embedding = ?::vector WHERE id = ? AND embedding IS NULL`,
      [vectorStr, signalId]
    )
  } catch (err) {
    logger.debug({ err, signalId }, '[EMBED] Signal embedding failed (non-fatal)')
  }
}

/**
 * Batch backfill — find signals without embeddings and generate them.
 * Called every 30 minutes.
 */
export async function batchEmbedSignals(): Promise<{
  processed: number
  openai: number
  tfidf: number
  errors: number
}> {
  const start = Date.now()
  let processed = 0, openaiCount = 0, tfidfCount = 0, errors = 0

  try {
    // Find signals without embeddings (prioritize recent, high-reliability)
    const missing = await db.raw(`
      SELECT id, title, summary
      FROM signals
      WHERE embedding IS NULL
        AND status IN ('verified', 'pending')
        AND title IS NOT NULL
        AND length(title) > 10
      ORDER BY created_at DESC
      LIMIT ${BATCH_SIZE}
    `)

    const signals = missing.rows ?? []
    if (signals.length === 0) {
      return { processed: 0, openai: 0, tfidf: 0, errors: 0 }
    }

    if (OPENAI_API_KEY) {
      // Batch OpenAI embeddings (process in groups of 20)
      const chunkSize = 20
      for (let i = 0; i < signals.length; i += chunkSize) {
        const chunk = signals.slice(i, i + chunkSize)
        const texts = chunk.map((s: any) => `${s.title}\n${s.summary ?? ''}`.trim())

        try {
          const embeddings = await openaiEmbed(texts)

          // Bulk update with pgvector
          for (let j = 0; j < chunk.length; j++) {
            const vectorStr = `[${embeddings[j].join(',')}]`
            await db.raw(
              `UPDATE signals SET embedding = ?::vector WHERE id = ? AND embedding IS NULL`,
              [vectorStr, chunk[j].id]
            )
            processed++
            openaiCount++
          }

          // Rate limit delay between chunks
          if (i + chunkSize < signals.length) {
            await sleep(RATE_LIMIT_DELAY_MS)
          }
        } catch (err) {
          logger.warn({ err, chunkStart: i }, '[EMBED] OpenAI batch failed, falling back to TF-IDF for chunk')
          // Fallback to TF-IDF for this chunk
          for (const signal of chunk) {
            try {
              const text = `${signal.title}\n${signal.summary ?? ''}`.trim()
              const embedding = tfidfEmbed(text)
              const vectorStr = `[${embedding.join(',')}]`
              await db.raw(
                `UPDATE signals SET embedding = ?::vector WHERE id = ? AND embedding IS NULL`,
                [vectorStr, signal.id]
              )
              processed++
              tfidfCount++
            } catch (e) {
              errors++
            }
          }
        }
      }
    } else {
      // TF-IDF only mode
      for (const signal of signals) {
        try {
          const text = `${signal.title}\n${signal.summary ?? ''}`.trim()
          const embedding = tfidfEmbed(text)
          const vectorStr = `[${embedding.join(',')}]`
          await db.raw(
            `UPDATE signals SET embedding = ?::vector WHERE id = ? AND embedding IS NULL`,
            [vectorStr, signal.id]
          )
          processed++
          tfidfCount++
        } catch (err) {
          errors++
        }
      }
    }

    const durationMs = Date.now() - start
    const mode = OPENAI_API_KEY ? 'openai' : 'tfidf'
    logger.info(
      { processed, openai: openaiCount, tfidf: tfidfCount, errors, durationMs, mode },
      `[EMBED] Batch embedding complete`
    )

    // Cache coverage stats
    const coverageResult = await db.raw(`
      SELECT COUNT(*) as total, COUNT(embedding) as embedded
      FROM signals
    `)
    const cRow = coverageResult.rows?.[0] ?? {}
    await redis.setex('cortex:embeddings:stats', CACHE_TTL, JSON.stringify({
      total: Number(cRow.total ?? 0),
      embedded: Number(cRow.embedded ?? 0),
      coverage_pct: Number(cRow.total) > 0
        ? Math.round((Number(cRow.embedded) / Number(cRow.total)) * 1000) / 10
        : 0,
      mode,
      generated_at: new Date().toISOString(),
    })).catch(() => {})

    return { processed, openai: openaiCount, tfidf: tfidfCount, errors }
  } catch (err) {
    logger.error({ err }, '[EMBED] Batch embedding failed')
    return { processed, openai: openaiCount, tfidf: tfidfCount, errors }
  }
}

/**
 * Find similar signals using pgvector cosine similarity.
 * Returns the N most similar signals to the given signal.
 */
export async function findSimilarSignals(
  signalId: string,
  limit = 5,
  minSimilarity = 0.7
): Promise<Array<{ id: string; title: string; similarity: number }>> {
  try {
    const result = await db.raw(`
      SELECT s2.id, s2.title,
             1 - (s1.embedding <=> s2.embedding) as similarity
      FROM signals s1, signals s2
      WHERE s1.id = ?
        AND s2.id != s1.id
        AND s1.embedding IS NOT NULL
        AND s2.embedding IS NOT NULL
        AND 1 - (s1.embedding <=> s2.embedding) >= ?
      ORDER BY s1.embedding <=> s2.embedding
      LIMIT ?
    `, [signalId, minSimilarity, limit])

    return result.rows ?? []
  } catch (err) {
    logger.debug({ err, signalId }, '[EMBED] Similar signal search failed')
    return []
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
