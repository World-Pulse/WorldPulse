/**
 * GET /api/v1/polymarket/markets — Polymarket Prediction Market Odds Proxy
 *
 * Proxies the Polymarket Gamma API (gamma-api.polymarket.com) and returns
 * geopolitics-relevant prediction market odds.  Responses are Redis-cached
 * for 5 minutes (odds change slowly).
 *
 * Rate limit: 60 rpm (external Gamma API allows 4000 req/10 s).
 * Auth: none (Gamma API is fully public).
 *
 * Counters WorldMonitor's "Polymarket prediction odds" feature (uncountered
 * through Cycle 44).
 */

import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

export const POLYMARKET_CACHE_TTL     = 300  // 5 minutes
export const POLYMARKET_RATE_LIMIT    = 60   // rpm
export const POLYMARKET_MAX_LIMIT     = 20
export const POLYMARKET_DEFAULT_LIMIT = 5
export const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com'

// Categories that map to geopolitical prediction markets
export const GEO_TAGS = [
  'geopolitics', 'elections', 'war', 'conflict', 'politics',
  'international', 'sanctions', 'military', 'economy', 'trade',
] as const

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PolymarketOutcome {
  name:        string
  probability: number   // 0–1
  price:       number   // USDC cents equivalent
}

export interface PolymarketMarket {
  id:          string
  question:    string
  description: string
  outcomes:    PolymarketOutcome[]
  volume:      number   // USD
  liquidity:   number   // USD
  endDate:     string | null
  url:         string
  active:      boolean
}

export interface PolymarketResponse {
  success:  boolean
  data: {
    markets: PolymarketMarket[]
    query:   string
    total:   number
    cached:  boolean
  }
}

interface PolymarketQuery {
  query?:    string
  limit?:    number
  tag?:      string
  signal_id?: string
}

// ─── Gamma API response shapes ────────────────────────────────────────────────

interface GammaToken {
  outcome:  string
  price:    string   // decimal string, e.g. "0.72"
}

interface GammaEvent {
  id:          string
  title:       string
  description: string
  markets:     GammaMarket[]
  startDate:   string | null
  endDate:     string | null
  volume:      string
  liquidity:   string
  active:      boolean
  slug:        string
}

interface GammaMarket {
  id:              string
  question:        string
  description:     string
  tokens:          GammaToken[]
  volume:          string
  liquidity:       string
  endDate:         string | null
  active:          boolean
  conditionId:     string
  slug:            string
  groupItemTitle?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMarketUrl(slug: string): string {
  return `https://polymarket.com/event/${slug}`
}

function normaliseMarket(m: GammaMarket, eventSlug: string): PolymarketMarket {
  const outcomes: PolymarketOutcome[] = (m.tokens ?? []).map(t => ({
    name:        t.outcome ?? 'Unknown',
    probability: Math.min(1, Math.max(0, parseFloat(t.price) || 0)),
    price:       Math.round((parseFloat(t.price) || 0) * 100),
  }))

  return {
    id:          m.conditionId ?? m.id,
    question:    m.question ?? m.groupItemTitle ?? '',
    description: m.description ?? '',
    outcomes,
    volume:      parseFloat(m.volume) || 0,
    liquidity:   parseFloat(m.liquidity) || 0,
    endDate:     m.endDate ?? null,
    url:         buildMarketUrl(eventSlug || m.slug),
    active:      m.active ?? true,
  }
}

/**
 * Fetch geopolitics-relevant prediction markets from Polymarket Gamma API.
 * Queries the /events endpoint with tag=geopolitics, then optionally
 * filters by a free-text query string.
 */
export async function fetchPolymarketMarkets(
  query: string,
  limit: number,
  tag: string = 'geopolitics',
): Promise<{ markets: PolymarketMarket[]; total: number }> {
  const params = new URLSearchParams({
    limit:  String(Math.min(50, limit * 4)),  // fetch extra, we'll filter
    active: 'true',
    tag,
  })
  if (query) params.set('q', query)

  const url = `${GAMMA_BASE_URL}/events?${params.toString()}`

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'WorldPulse/1.0 (+https://worldpulse.news)',
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    throw new Error(`Gamma API responded ${res.status}: ${res.statusText}`)
  }

  const events: GammaEvent[] = await res.json()

  // Flatten events → markets, take first market per event (most liquid)
  const markets: PolymarketMarket[] = []
  for (const event of events) {
    if (!Array.isArray(event.markets) || event.markets.length === 0) continue
    // Pick the market with the most volume from this event
    const best = [...event.markets].sort(
      (a, b) => (parseFloat(b.volume) || 0) - (parseFloat(a.volume) || 0),
    )[0]
    if (!best) continue
    markets.push(normaliseMarket(best, event.slug))
    if (markets.length >= limit) break
  }

  return { markets, total: events.length }
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const registerPolymarketRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/v1/polymarket/markets ────────────────────────────────────────
  app.get<{ Querystring: PolymarketQuery }>('/markets', {
    config: {
      rateLimit: {
        max: POLYMARKET_RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags: ['polymarket'],
      summary: 'Fetch prediction market odds (Polymarket Gamma API proxy)',
      description: [
        'Returns prediction market odds for geopolitical events from Polymarket.',
        'Gamma API is queried and results are cached for 5 minutes.',
        'No authentication required — Gamma API is public.',
        'Filter by ?query= to match markets relevant to a specific signal.',
      ].join('\n'),
      querystring: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            maxLength: 200,
            description: 'Free-text keyword filter (e.g. "Russia Ukraine" or "US election").',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: POLYMARKET_MAX_LIMIT,
            default: POLYMARKET_DEFAULT_LIMIT,
            description: 'Number of markets to return.',
          },
          tag: {
            type: 'string',
            enum: ['geopolitics', 'elections', 'politics', 'economy', 'world'],
            default: 'geopolitics',
            description: 'Polymarket topic tag filter.',
          },
          signal_id: {
            type: 'string',
            description: 'Optional signal UUID — used for cache key scoping.',
          },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const rawLimit = Number(req.query.limit ?? POLYMARKET_DEFAULT_LIMIT)
    const limit    = Math.min(Math.max(1, rawLimit), POLYMARKET_MAX_LIMIT)
    const query    = (req.query.query ?? '').trim().slice(0, 200)
    const tag      = req.query.tag ?? 'geopolitics'
    const signalId = req.query.signal_id ?? ''

    // ── Redis cache check ─────────────────────────────────────────────────
    const cacheKey = `polymarket:v1:${tag}:${limit}:${Buffer.from(query + signalId).toString('base64').slice(0, 32)}`
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as PolymarketResponse['data']
        return reply
          .header('X-Cache-Hit', 'true')
          .header('Cache-Control', `public, max-age=${POLYMARKET_CACHE_TTL}`)
          .send({ success: true, data: { ...parsed, cached: true } })
      }
    } catch { /* Redis unavailable — continue to live fetch */ }

    // ── Live fetch from Gamma API ─────────────────────────────────────────
    try {
      const { markets, total } = await fetchPolymarketMarkets(query, limit, tag)

      const payload: PolymarketResponse['data'] = {
        markets,
        query,
        total,
        cached: false,
      }

      // Cache result
      try {
        await redis.set(cacheKey, JSON.stringify(payload), 'EX', POLYMARKET_CACHE_TTL)
      } catch { /* non-fatal */ }

      return reply
        .header('Cache-Control', `public, max-age=${POLYMARKET_CACHE_TTL}`)
        .send({ success: true, data: payload })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gamma API unavailable'
      return sendError(reply, 502, 'UPSTREAM_ERROR', `Polymarket Gamma API error: ${message}`)
    }
  })

  // ── GET /api/v1/polymarket/markets/:conditionId ────────────────────────────
  app.get<{ Params: { conditionId: string } }>('/markets/:conditionId', {
    config: {
      rateLimit: { max: POLYMARKET_RATE_LIMIT, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['polymarket'],
      summary: 'Fetch a single prediction market by condition ID',
      params: {
        type: 'object',
        required: ['conditionId'],
        properties: {
          conditionId: { type: 'string', description: 'Polymarket condition ID' },
        },
      },
    },
  }, async (req, reply) => {
    const { conditionId } = req.params
    const cacheKey = `polymarket:market:${conditionId}`

    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        return reply
          .header('X-Cache-Hit', 'true')
          .send({ success: true, data: { market: JSON.parse(cached), cached: true } })
      }
    } catch { /* non-fatal */ }

    try {
      const res = await fetch(`${GAMMA_BASE_URL}/markets/${conditionId}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'WorldPulse/1.0 (+https://worldpulse.news)',
        },
        signal: AbortSignal.timeout(6000),
      })

      if (!res.ok) {
        if (res.status === 404) return sendError(reply, 404, 'NOT_FOUND', 'Market not found')
        return sendError(reply, 502, 'UPSTREAM_ERROR', `Gamma API responded ${res.status}`)
      }

      const raw: GammaMarket = await res.json()
      const market = normaliseMarket(raw, raw.slug ?? conditionId)

      try {
        await redis.set(cacheKey, JSON.stringify(market), 'EX', POLYMARKET_CACHE_TTL)
      } catch { /* non-fatal */ }

      return reply.send({ success: true, data: { market, cached: false } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gamma API unavailable'
      return sendError(reply, 502, 'UPSTREAM_ERROR', `Gamma API error: ${message}`)
    }
  })
}
