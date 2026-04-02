/**
 * pinecone.ts — Pinecone vector database client
 *
 * Uses native fetch only (no npm packages).
 * All calls are wrapped in try/catch — NEVER throws, NEVER fails signal ingestion.
 * Init is conditional: if PINECONE_API_KEY or PINECONE_HOST is unset, all ops are no-ops.
 *
 * Embedding caches in Redis 24h: embed:{sha256(text)}
 */

import { createHash } from 'crypto'
import { redis } from './redis'

// ─── Config ──────────────────────────────────────────────────────────────────

const PINECONE_API_KEY = process.env.PINECONE_API_KEY
const PINECONE_INDEX   = process.env.PINECONE_INDEX ?? 'worldpulse-signals'
const PINECONE_HOST    = process.env.PINECONE_HOST  ?? '' // e.g. https://worldpulse-signals-xxxx.svc.pinecone.io

const OPENAI_API_KEY       = process.env.OPENAI_API_KEY
const EMBEDDING_MODEL      = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const EMBED_CACHE_TTL      = 60 * 60 * 24  // 24h in seconds

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PineconeMetadata {
  title:            string
  category:         string
  severity:         string
  reliability_score: number
  published_at:     string
}

export interface SimilarResult {
  id:    string
  score: number
}

// ─── isPineconeEnabled ────────────────────────────────────────────────────────

export function isPineconeEnabled(): boolean {
  return Boolean(PINECONE_API_KEY && PINECONE_HOST)
}

// ─── generateEmbedding ───────────────────────────────────────────────────────

/**
 * Generates an OpenAI text-embedding-3-small embedding for the given text.
 * Returns null if OPENAI_API_KEY is not set or the call fails.
 * Caches result in Redis for 24h using sha256(text) as key.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null

  const hash     = createHash('sha256').update(text).digest('hex')
  const cacheKey = `embed:${hash}`

  // Check Redis cache first
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as number[]
      if (Array.isArray(parsed) && parsed.length === EMBEDDING_DIMENSIONS) {
        return parsed
      }
    }
  } catch {
    // Cache miss — proceed to API call
  }

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8191), // OpenAI token limit guard
      }),
    })

    if (!res.ok) return null

    const json = await res.json() as {
      data?: Array<{ embedding: number[] }>
    }

    const embedding = json.data?.[0]?.embedding
    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) return null

    // Cache in Redis
    redis.setex(cacheKey, EMBED_CACHE_TTL, JSON.stringify(embedding)).catch(() => {})

    return embedding
  } catch {
    return null
  }
}

// ─── upsertSignalVector ───────────────────────────────────────────────────────

/**
 * Upserts a signal vector into the Pinecone index.
 * No-op if Pinecone is not configured.
 */
export async function upsertSignalVector(
  signalId:  string,
  embedding: number[],
  metadata:  PineconeMetadata,
): Promise<void> {
  if (!isPineconeEnabled()) return

  try {
    const res = await fetch(`${PINECONE_HOST}/vectors/upsert`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key':      PINECONE_API_KEY!,
      },
      body: JSON.stringify({
        vectors: [{
          id:       signalId,
          values:   embedding,
          metadata: {
            title:            metadata.title,
            category:         metadata.category,
            severity:         metadata.severity,
            reliability_score: metadata.reliability_score,
            published_at:     metadata.published_at,
            index:            PINECONE_INDEX,
          },
        }],
        namespace: '',
      }),
    })

    if (!res.ok) {
      // Non-throwing — Pinecone failures must never break ingestion
      return
    }
  } catch {
    // Swallow — never propagate Pinecone errors
  }
}

// ─── querySimilar ─────────────────────────────────────────────────────────────

/**
 * Queries Pinecone for the topK most similar vectors.
 * Returns [] if Pinecone is not configured or the call fails.
 */
export async function querySimilar(
  embedding: number[],
  topK:      number,
  filter?:   { category?: string },
): Promise<SimilarResult[]> {
  if (!isPineconeEnabled()) return []

  try {
    const body: Record<string, unknown> = {
      vector:          embedding,
      topK,
      includeValues:   false,
      includeMetadata: false,
      namespace:       '',
    }

    if (filter?.category) {
      body.filter = { category: { '$eq': filter.category } }
    }

    const res = await fetch(`${PINECONE_HOST}/query`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key':      PINECONE_API_KEY!,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) return []

    const json = await res.json() as {
      matches?: Array<{ id: string; score: number }>
    }

    return (json.matches ?? []).map(m => ({ id: m.id, score: m.score }))
  } catch {
    return []
  }
}
