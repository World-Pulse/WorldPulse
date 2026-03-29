/**
 * Sanctions & Watchlist Intelligence API
 *
 * GET /api/v1/sanctions/featured
 *   - Returns top 20 high-priority sanctioned entities (mix of Persons, Organizations, Vessels)
 *   - Fetches known high-profile entities from OpenSanctions in parallel
 *   - Deduplicates by entity ID, sorts by threat level
 *   - Redis-cached for 10 minutes (key: 'sanctions:featured')
 *   - Rate limited to 30 req/min
 *   - No auth required
 */

import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import {
  searchEntities,
  entityThreatLevel,
  datasetLabel,
  schemaLabel,
  type OSEntity,
} from '../lib/opensanctions'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for featured sanctions cache: 10 minutes */
const CACHE_TTL = 600

/** Redis key for the featured sanctions cache */
const CACHE_KEY = 'sanctions:featured'

/** Rate limit for sanctions endpoints: requests per minute */
const RATE_LIMIT = 30

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeaturedEntity {
  id:           string
  caption:      string
  schema:       string
  schemaLabel:  string
  datasets:     string[]
  datasetLabels: string[]
  threatLevel:  'critical' | 'high' | 'medium' | 'low'
  primaryAlias: string | null
  aliases:      string[]
  countries:    string[]
  topics:       string[]
  score:        number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const THREAT_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function toFeaturedEntity(e: OSEntity): FeaturedEntity {
  const aliases = e.properties.alias ?? []
  const countries = [
    ...(e.properties.nationality ?? []),
    ...(e.properties.country ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i)

  return {
    id:           e.id,
    caption:      e.caption,
    schema:       e.schema,
    schemaLabel:  schemaLabel(e.schema),
    datasets:     e.datasets,
    datasetLabels: e.datasets.map(datasetLabel),
    threatLevel:  entityThreatLevel(e.datasets),
    primaryAlias: aliases[0] ?? null,
    aliases:      aliases.slice(0, 5),
    countries,
    topics:       e.properties.topics ?? [],
    score:        e.score,
  }
}

/**
 * High-profile entity search queries covering persons, organizations, and vessels.
 * Each entry: [query, optional schema filter]
 */
const FEATURED_QUERIES: Array<[string, string | undefined]> = [
  // Heads of state / political figures
  ['Vladimir Putin',        'Person'],
  ['Kim Jong',              'Person'],
  ['Alexander Lukashenko',  'Person'],
  ['Bashar al-Assad',       'Person'],
  ['Ramzan Kadyrov',        'Person'],
  ['Ali Khamenei',          'Person'],
  // Organisations
  ['IRGC',                  'Organization'],
  ['Wagner Group',          'Organization'],
  ['Hezbollah',             'Organization'],
  ['Hamas',                 'Organization'],
  ['Islamic State',         'Organization'],
  ['Al-Qaida',              'Organization'],
  // Vessels (sanctioned Russian/Iranian ships)
  ['NS Captain',            'Vessel'],
  ['SUN SYMBOL',            'Vessel'],
]

async function fetchFeaturedEntities(): Promise<FeaturedEntity[]> {
  const results = await Promise.allSettled(
    FEATURED_QUERIES.map(([q, schema]) => searchEntities(q, 5, schema)),
  )

  const seen = new Set<string>()
  const entities: FeaturedEntity[] = []

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const e of result.value.entities) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      entities.push(toFeaturedEntity(e))
    }
  }

  // Sort: critical → high → medium → low, then by score descending
  entities.sort((a, b) => {
    const rankDiff = (THREAT_RANK[b.threatLevel] ?? 0) - (THREAT_RANK[a.threatLevel] ?? 0)
    return rankDiff !== 0 ? rankDiff : b.score - a.score
  })

  return entities.slice(0, 20)
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerSanctionsRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['sanctions']
  })

  // ── GET /featured ──────────────────────────────────────────────────────────

  app.get('/featured', {
    config: {
      rateLimit: {
        max:        RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags:    ['sanctions'],
      summary: 'Top 20 high-profile sanctioned entities from global watchlists',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cached:  { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:            { type: 'string' },
                  caption:       { type: 'string' },
                  schema:        { type: 'string' },
                  schemaLabel:   { type: 'string' },
                  datasets:      { type: 'array', items: { type: 'string' } },
                  datasetLabels: { type: 'array', items: { type: 'string' } },
                  threatLevel:   { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                  primaryAlias:  { type: ['string', 'null'] },
                  aliases:       { type: 'array', items: { type: 'string' } },
                  countries:     { type: 'array', items: { type: 'string' } },
                  topics:        { type: 'array', items: { type: 'string' } },
                  score:         { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    // ── Cache hit ──────────────────────────────────────────
    try {
      const cached = await redis.get(CACHE_KEY)
      if (cached) {
        return reply.send({ success: true, cached: true, data: JSON.parse(cached) as FeaturedEntity[] })
      }
    } catch { /* Redis miss — proceed */ }

    // ── Fetch & assemble ───────────────────────────────────
    const entities = await fetchFeaturedEntities()

    // ── Cache result ───────────────────────────────────────
    redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(entities)).catch(() => {})

    return reply.send({ success: true, cached: false, data: entities })
  })
}
