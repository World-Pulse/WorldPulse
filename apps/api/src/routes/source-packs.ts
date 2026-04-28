/**
 * source-packs.ts — /api/v1/source-packs
 *
 * Cryptographically signed signal bundles for AI agent pipelines.
 * Ed25519 signatures allow any consumer to verify bundle integrity
 * against WorldPulse's public key.
 *
 * Routes:
 *   GET /latest              — most recent signed pack (all categories), Redis-cached 60s
 *   GET /category/:slug      — signed pack for a specific category, Redis-cached 60s
 *   GET /public-key          — returns { public_key_pem, algorithm: 'Ed25519' }
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from '../lib/logger'
import {
  getOrCreateKeypair,
  buildSignedPack,
  type PackSignalInput,
} from '../lib/source-packs'

// ─── Constants ─────────────────────────────────────────────────────────────

const CACHE_TTL     = 60   // seconds
const SIGNAL_LIMIT  = 50
const RATE_LIMIT    = 60   // req/min
const SITE_URL      = process.env.SITE_URL ?? 'https://worldpulse.io'

const VALID_CATEGORIES = new Set([
  'conflict', 'climate', 'politics', 'health', 'technology', 'economics',
  'disaster', 'security', 'environment', 'military', 'humanitarian',
  'infrastructure', 'space', 'maritime', 'aviation', 'cyber', 'nuclear',
  'geopolitics', 'breaking', 'economy', 'science', 'elections', 'culture',
  'sports', 'other',
])

// ─── DB helpers ─────────────────────────────────────────────────────────────

interface DbSignalRow {
  id:                string
  title:             string
  summary:           string | null
  severity:          string
  category:          string
  reliability_score: number | null
  location_name:     string | null
  country_code:      string | null
  created_at:        Date | string
  source_url:        string | null
}

async function fetchVerifiedSignals(category?: string): Promise<PackSignalInput[]> {
  let query = db('signals')
    .select(
      'id', 'title', 'summary', 'category', 'severity',
      'reliability_score', 'location_name', 'country_code',
      'created_at', 'source_url',
    )
    .where('status', 'verified')
    .orderBy('created_at', 'desc')
    .limit(SIGNAL_LIMIT)

  if (category) {
    query = query.where('category', category)
  }

  const rows = await query as DbSignalRow[]

  return rows.map(r => ({
    ...r,
    reliability_score: r.reliability_score ?? 0,
    url: r.source_url ?? `${SITE_URL}/signals/${r.id}`,
  }))
}

// ─── Cache helpers ──────────────────────────────────────────────────────────

async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key)
  } catch {
    return null
  }
}

async function cacheSet(key: string, value: string, ttl: number): Promise<void> {
  try {
    await redis.set(key, value, 'EX', ttl)
  } catch (err) {
    logger.warn({ err, key }, 'source-packs cache set failed')
  }
}

// ─── Route plugin ───────────────────────────────────────────────────────────

export const registerSourcePacksRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /latest ───────────────────────────────────────────────────────────
  fastify.get(
    '/latest',
    {
      config: { rateLimit: { max: RATE_LIMIT, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      reply.header('Access-Control-Allow-Origin', '*')
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS')

      const cacheKey = 'source-packs:latest'
      const cached   = await cacheGet(cacheKey)
      if (cached) {
        reply.header('X-Cache-Hit', 'true')
        return reply.type('application/json').send(cached)
      }

      const signals = await fetchVerifiedSignals()
      const pack    = buildSignedPack(signals)
      const body    = JSON.stringify({ success: true, data: pack })

      await cacheSet(cacheKey, body, CACHE_TTL)
      reply.header('X-Cache-Hit', 'false')
      return reply.type('application/json').send(body)
    },
  )

  // ── GET /category/:slug ───────────────────────────────────────────────────
  fastify.get<{ Params: { slug: string } }>(
    '/category/:slug',
    {
      config: { rateLimit: { max: RATE_LIMIT, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      reply.header('Access-Control-Allow-Origin', '*')
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS')

      const { slug } = request.params
      if (!VALID_CATEGORIES.has(slug)) {
        return reply.status(400).send({
          success: false,
          error:   `Unknown category '${slug}'`,
          valid_categories: [...VALID_CATEGORIES],
        })
      }

      const cacheKey = `source-packs:category:${slug}`
      const cached   = await cacheGet(cacheKey)
      if (cached) {
        reply.header('X-Cache-Hit', 'true')
        return reply.type('application/json').send(cached)
      }

      const signals = await fetchVerifiedSignals(slug)
      const pack    = buildSignedPack(signals, slug)
      const body    = JSON.stringify({ success: true, data: pack })

      await cacheSet(cacheKey, body, CACHE_TTL)
      reply.header('X-Cache-Hit', 'false')
      return reply.type('application/json').send(body)
    },
  )

  // ── GET /public-key ───────────────────────────────────────────────────────
  fastify.get(
    '/public-key',
    {
      config: { rateLimit: { max: RATE_LIMIT, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      reply.header('Access-Control-Allow-Origin', '*')
      const { publicKeyPem } = getOrCreateKeypair()
      return reply.send({
        success:        true,
        public_key_pem: publicKeyPem,
        algorithm:      'Ed25519',
      })
    },
  )
}
