/**
 * slop.ts — Public AI Content Farm Detection API
 *
 * WorldPulse's open-source alternative to NewsGuard's AI Content Farm Datastream.
 * Exposes slop-detector.ts heuristics as a developer API (API key required for
 * write/check endpoints; public endpoints for farm list + stats).
 *
 * Endpoints:
 *   GET  /api/v1/slop/farms   — public blocklist of known AI content farm domains
 *   GET  /api/v1/slop/stats   — global slop detection statistics
 *   POST /api/v1/slop/check   — check a URL/article for slop (API key required)
 *   POST /api/v1/slop/batch   — batch check up to 20 URLs (Pro+ tier)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { hashKey } from '../lib/api-keys'
import { slopDetector } from '../lib/slop-detector'
import { KNOWN_AI_CONTENT_FARMS } from '../lib/ai-content-farms'

// ─── API Key Auth ─────────────────────────────────────────────────────────────

interface ApiKeyContext {
  apiKeyId: string
  userId:   string
  tier:     string
  rpmLimit: number
  rpdLimit: number
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyCtx?: ApiKeyContext
  }
}

async function authenticateApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Accept X-API-Key header OR Authorization: Bearer wp_live_...
  const rawKey =
    (req.headers['x-api-key'] as string | undefined) ??
    (() => {
      const auth = req.headers['authorization']
      return auth?.startsWith('Bearer wp_live_') ? auth.slice(7) : undefined
    })()

  if (!rawKey) {
    void reply.status(401).send({
      success: false,
      error:   'API key required. Use X-API-Key header or Authorization: Bearer <key>',
      code:    'UNAUTHORIZED',
      docs:    'https://world-pulse.io/docs/api/authentication',
    })
    return
  }

  const keyHash = hashKey(rawKey)
  const keyRow = await db('api_keys')
    .where('key_hash', keyHash)
    .where('is_active', true)
    .first(['id', 'user_id', 'tier', 'rate_limit_per_min', 'rate_limit_per_day'])
    .catch(() => null)

  if (!keyRow) {
    void reply.status(401).send({
      success: false,
      error:   'Invalid or inactive API key',
      code:    'UNAUTHORIZED',
    })
    return
  }

  // Fire-and-forget — update last_used_at
  db('api_keys')
    .where('id', keyRow.id)
    .update({ last_used_at: new Date() })
    .catch(() => { /* non-fatal */ })

  req.apiKeyCtx = {
    apiKeyId: String(keyRow.id),
    userId:   String(keyRow.user_id),
    tier:     String(keyRow.tier),
    rpmLimit: Number(keyRow.rate_limit_per_min),
    rpdLimit: Number(keyRow.rate_limit_per_day),
  }
}

async function requireProTier(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const tier = req.apiKeyCtx?.tier
  if (tier !== 'pro' && tier !== 'enterprise') {
    void reply.status(403).send({
      success:     false,
      error:       'Batch slop detection requires a Pro or Enterprise API key',
      code:        'TIER_REQUIRED',
      upgrade_url: 'https://world-pulse.io/developer',
    })
  }
}

// ─── Validation Schemas ───────────────────────────────────────────────────────

const CheckSchema = z.object({
  url:     z.string().url().max(2048),
  title:   z.string().max(500).optional(),
  content: z.string().max(10_000).optional(),
  author:  z.string().max(200).optional(),
})

const BatchSchema = z.object({
  items: z
    .array(
      z.object({
        id:      z.string().max(100).optional(),
        url:     z.string().url().max(2048),
        title:   z.string().max(500).optional(),
        content: z.string().max(10_000).optional(),
        author:  z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(20),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Verdict = 'clean' | 'suspicious' | 'likely_slop' | 'confirmed_farm'

function scoreToVerdict(score: number): Verdict {
  if (score >= 0.70) return 'confirmed_farm'
  if (score >= 0.50) return 'likely_slop'
  if (score >= 0.25) return 'suspicious'
  return 'clean'
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function urlToId(url: string, prefix = 'api-check'): string {
  return `${prefix}:${Buffer.from(url).toString('base64').slice(0, 32)}`
}

function flagsToBreakdown(flags: string[]) {
  return {
    domain_blocklist: flags.some(f => f.startsWith('domain_blocklist')) ? 0.40 : 0,
    missing_byline:   flags.includes('missing_byline')                  ? 0.15 : 0,
    clickbait_title:  flags.includes('clickbait_title')                 ? 0.10 : 0,
    thin_content:     flags.some(f => f.startsWith('thin_content'))     ? 0.10 : 0,
    high_cadence:     flags.some(f => f.startsWith('high_cadence'))     ? 0.10 : 0,
    bare_url_path:    flags.includes('bare_url_path')                   ? 0.05 : 0,
  }
}

// Cache TTLs
const TTL_FARMS = 300       // 5 min — farm list rarely changes
const TTL_STATS = 60        // 1 min — rolling stats

// ─── Routes ───────────────────────────────────────────────────────────────────

export const registerSlopRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRoute', routeOptions => {
    routeOptions.schema       ??= {}
    routeOptions.schema.tags  ??= ['slop']
  })

  // ─── GET /farms ─────────────────────────────────────────────────────────────
  /**
   * Public, no-auth list of known AI content farm domains.
   * WorldPulse's open-source equivalent of NewsGuard's AI Content Farm Datastream.
   */
  app.get('/farms', {
    schema: {
      summary:     'List known AI content farm domains (public, open-source)',
      description: 'WorldPulse open-source blocklist of AI-generated content farm domains. Seeded from NewsGuard public reports, CCDH research, and community contributions. Updated monthly.',
      querystring: {
        type:       'object',
        properties: {
          limit:  { type: 'number', default: 100, minimum: 1,  maximum: 1000 },
          offset: { type: 'number', default: 0,   minimum: 0 },
          search: { type: 'string', description: 'Filter domains containing this substring' },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type:       'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type:       'object',
              properties: {
                domains:    { type: 'array', items: { type: 'string' } },
                total:      { type: 'number' },
                limit:      { type: 'number' },
                offset:     { type: 'number' },
                updated_at: { type: 'string' },
                source:     { type: 'string' },
              },
            },
          },
        },
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')

    const { limit = 100, offset = 0, search } = req.query as {
      limit?:  number
      offset?: number
      search?: string
    }

    const safeLimit  = Math.min(Math.max(Number(limit),  1), 1000)
    const safeOffset = Math.max(Number(offset), 0)
    const cacheKey   = `slop:farms:${safeLimit}:${safeOffset}:${search ?? ''}`

    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached) as object)
    }

    let domains: string[] = KNOWN_AI_CONTENT_FARMS as string[]
    if (search) {
      domains = domains.filter(d => d.includes(search.toLowerCase()))
    }

    const total  = domains.length
    const sliced = domains.slice(safeOffset, safeOffset + safeLimit)

    const body = {
      success: true,
      data: {
        domains:    sliced,
        total,
        limit:      safeLimit,
        offset:     safeOffset,
        updated_at: '2026-03-26T00:00:00Z',
        source:     'WorldPulse AI Content Farm Blocklist — github.com/worldpulse/worldpulse',
      },
    }

    await redis.setex(cacheKey, TTL_FARMS, JSON.stringify(body)).catch(() => {})
    return reply.send(body)
  })

  // ─── GET /stats ──────────────────────────────────────────────────────────────
  /**
   * Global slop detection statistics.
   */
  app.get('/stats', {
    schema: {
      summary:     'Global AI slop detection statistics',
      description: 'Returns statistics about AI content farm detection in the WorldPulse signal pipeline. Compares WorldPulse blocklist coverage to NewsGuard\'s commercial dataset.',
      response: {
        200: {
          type:       'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type:       'object',
              properties: {
                known_farm_domains:         { type: 'number' },
                total_signals_analyzed:     { type: 'number' },
                signals_flagged_as_slop:    { type: 'number' },
                slop_rate_percent:          { type: 'number' },
                detection_threshold:        { type: 'number' },
                heuristics_count:           { type: 'number' },
                last_blocklist_update:      { type: 'string' },
                blocklist_growth_rate:      { type: 'string' },
                open_source:                { type: 'boolean' },
                compare_to_newsguard_farms: { type: 'number' },
                worldpulse_farm_coverage:   { type: 'number' },
              },
            },
          },
        },
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')

    const cacheKey = 'slop:stats:v1'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached) as object)
    }

    // Gather stats — defensive, slop_score column may not exist on all deployments
    const [totalRow, slopRow] = await Promise.all([
      db('signals').count('id as count').first().catch(() => ({ count: 0 })),
      db('signals')
        .whereNotNull('slop_score')
        .where('slop_score', '>=', 0.7)
        .count('id as count')
        .first()
        .catch(() => ({ count: 0 })),
    ])

    const total    = Number(totalRow?.count    ?? 0)
    const slop     = Number(slopRow?.count     ?? 0)
    const slopRate = total > 0 ? Math.round((slop / total) * 10_000) / 100 : 0
    const farmCount = KNOWN_AI_CONTENT_FARMS.length
    const newsguardFarmCount = 3_006

    const body = {
      success: true,
      data: {
        known_farm_domains:         farmCount,
        total_signals_analyzed:     total,
        signals_flagged_as_slop:    slop,
        slop_rate_percent:          slopRate,
        detection_threshold:        0.70,
        heuristics_count:           6,
        last_blocklist_update:      '2026-03-26',
        blocklist_growth_rate:      '300-500 new domains/month (industry estimate, NewsGuard 2026)',
        open_source:                true,
        compare_to_newsguard_farms: newsguardFarmCount,
        worldpulse_farm_coverage:   Math.round((farmCount / newsguardFarmCount) * 100),
      },
    }

    await redis.setex(cacheKey, TTL_STATS, JSON.stringify(body)).catch(() => {})
    return reply.send(body)
  })

  // ─── POST /check ─────────────────────────────────────────────────────────────
  /**
   * Check a single URL / article for AI-generated slop.
   * Requires a WorldPulse API key (any tier).
   */
  app.post('/check', {
    preHandler: [authenticateApiKey],
    schema: {
      summary:     'Check a URL or article for AI-generated slop content',
      description: 'Analyzes a URL (and optionally title, content, author) for AI content farm slop. Returns a score [0.0–1.0], a verdict, and per-heuristic flags. Requires a WorldPulse API key.',
      body: {
        type:       'object',
        required:   ['url'],
        properties: {
          url:     { type: 'string', description: 'URL of the article to check (required)' },
          title:   { type: 'string', description: 'Article title (optional — improves clickbait detection)' },
          content: { type: 'string', description: 'Article body text (optional — improves thin-content detection, max 10,000 chars)' },
          author:  { type: 'string', description: 'Author name or byline (optional — improves missing-byline detection)' },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type:       'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type:       'object',
              properties: {
                url:     { type: 'string' },
                domain:  { type: 'string', nullable: true },
                score:   { type: 'number', description: 'Slop probability [0.0–1.0] — 0.7+ = confirmed_farm' },
                verdict: { type: 'string', enum: ['clean', 'suspicious', 'likely_slop', 'confirmed_farm'] },
                flags:   { type: 'array', items: { type: 'string' }, description: 'Triggered heuristic flags' },
                cached:  { type: 'boolean', description: 'True if result was served from 24h Redis cache' },
                score_breakdown: {
                  type:       'object',
                  properties: {
                    domain_blocklist: { type: 'number' },
                    missing_byline:   { type: 'number' },
                    clickbait_title:  { type: 'number' },
                    thin_content:     { type: 'number' },
                    high_cadence:     { type: 'number' },
                    bare_url_path:    { type: 'number' },
                  },
                },
              },
            },
            meta: {
              type:       'object',
              properties: {
                tier:       { type: 'string' },
                checked_at: { type: 'string' },
              },
            },
          },
        },
        400: {
          type:       'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
          },
        },
        401: {
          type:       'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
            docs:    { type: 'string' },
          },
        },
      },
    },
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = CheckSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error:   'Invalid request body',
        details: parsed.error.flatten(),
        code:    'VALIDATION_ERROR',
      })
    }

    const { url, title, content, author } = parsed.data

    const result = await slopDetector.scoreSignal({
      id:         urlToId(url),
      source_url: url,
      title:      title      ?? null,
      content:    content    ?? null,
      author:     author     ?? null,
    })

    return reply.send({
      success: true,
      data: {
        url,
        domain:          extractDomain(url),
        score:           result.score,
        verdict:         scoreToVerdict(result.score),
        flags:           result.flags,
        cached:          result.cached,
        score_breakdown: flagsToBreakdown(result.flags),
      },
      meta: {
        tier:       req.apiKeyCtx?.tier ?? 'unknown',
        checked_at: new Date().toISOString(),
      },
    })
  })

  // ─── POST /batch ─────────────────────────────────────────────────────────────
  /**
   * Batch check up to 20 URLs. Requires Pro or Enterprise API key.
   */
  app.post('/batch', {
    preHandler: [authenticateApiKey, requireProTier],
    schema: {
      summary:     'Batch check up to 20 URLs for AI slop (Pro+ tier)',
      description: 'Check multiple URLs in a single request. Each item can include optional title/content/author for higher accuracy. Requires a Pro or Enterprise API key.',
      body: {
        type:       'object',
        required:   ['items'],
        properties: {
          items: {
            type:     'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type:       'object',
              required:   ['url'],
              properties: {
                id:      { type: 'string', description: 'Optional client-side ID for correlation' },
                url:     { type: 'string' },
                title:   { type: 'string' },
                content: { type: 'string' },
                author:  { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type:       'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type:       'object',
              properties: {
                results: {
                  type:  'array',
                  items: {
                    type:       'object',
                    properties: {
                      index:   { type: 'number' },
                      id:      { type: 'string', nullable: true },
                      url:     { type: 'string' },
                      domain:  { type: 'string', nullable: true },
                      score:   { type: 'number' },
                      verdict: { type: 'string' },
                      flags:   { type: 'array', items: { type: 'string' } },
                      cached:  { type: 'boolean' },
                    },
                  },
                },
                metadata: {
                  type:       'object',
                  properties: {
                    checked:           { type: 'number' },
                    flagged_as_slop:   { type: 'number' },
                    clean:             { type: 'number' },
                    avg_score:         { type: 'number' },
                    slop_rate_percent: { type: 'number' },
                  },
                },
              },
            },
            meta: {
              type:       'object',
              properties: {
                tier:       { type: 'string' },
                checked_at: { type: 'string' },
              },
            },
          },
        },
        400: {
          type:       'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
            details: { type: 'object' },
          },
        },
        403: {
          type:       'object',
          properties: {
            success:     { type: 'boolean' },
            error:       { type: 'string' },
            code:        { type: 'string' },
            upgrade_url: { type: 'string' },
          },
        },
      },
    },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = BatchSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error:   'Invalid request body',
        details: parsed.error.flatten(),
        code:    'VALIDATION_ERROR',
      })
    }

    const { items } = parsed.data

    // Process all items concurrently
    const results = await Promise.all(
      items.map(async (item, idx) => {
        const urlId  = item.id ?? urlToId(item.url, 'batch')
        const result = await slopDetector.scoreSignal({
          id:         urlId,
          source_url: item.url,
          title:      item.title   ?? null,
          content:    item.content ?? null,
          author:     item.author  ?? null,
        })

        return {
          index:   idx,
          id:      item.id ?? null,
          url:     item.url,
          domain:  extractDomain(item.url),
          score:   result.score,
          verdict: scoreToVerdict(result.score),
          flags:   result.flags,
          cached:  result.cached,
        }
      }),
    )

    const flaggedCount = results.filter(r => r.score >= 0.70).length
    const avgScore     = results.reduce((sum, r) => sum + r.score, 0) / results.length

    return reply.send({
      success: true,
      data: {
        results,
        metadata: {
          checked:           results.length,
          flagged_as_slop:   flaggedCount,
          clean:             results.length - flaggedCount,
          avg_score:         Math.round(avgScore * 100) / 100,
          slop_rate_percent: Math.round((flaggedCount / results.length) * 100),
        },
      },
      meta: {
        tier:       req.apiKeyCtx?.tier ?? 'unknown',
        checked_at: new Date().toISOString(),
      },
    })
  })
}
