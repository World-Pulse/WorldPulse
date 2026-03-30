/**
 * Finance Intelligence API
 *
 * Surfaces financial signals (category = 'finance') from the signals table.
 *
 * GET /api/v1/finance/summary
 *   - Total finance signal counts (24h and 6h windows)
 *   - Subcategory breakdown (market_move / central_bank / sanctions / corporate / crypto)
 *   - Top-5 most recent signals per subcategory
 *   - Trend direction (escalating / stable / de-escalating)
 *   - Redis-cached for 5 minutes (key: 'finance:summary')
 *   - Rate limited to 60 req/min
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import type { FinanceSubcategory } from '@worldpulse/types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for finance summary cache: 5 minutes */
export const FINANCE_CACHE_TTL = 300

/** Rate limit for finance endpoints: requests per minute */
export const FINANCE_RATE_LIMIT = 60

/** Redis key for the finance summary cache */
export const FINANCE_CACHE_KEY = 'finance:summary'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FinanceSignalEntry {
  id:                string
  title:             string
  subcategory:       FinanceSubcategory | null
  severity:          string
  reliability_score: number
  location_name:     string | null
  country_code:      string | null
  created_at:        string
}

export interface SubcategoryBreakdown {
  market_move:  number
  central_bank: number
  sanctions:    number
  corporate:    number
  crypto:       number
  unclassified: number
}

export interface FinanceSummary {
  period_hours:         number
  total_signals_24h:    number
  total_signals_6h:     number
  trend_direction:      'escalating' | 'stable' | 'de-escalating'
  subcategory_breakdown: SubcategoryBreakdown
  top_signals:          FinanceSignalEntry[]
  generated_at:         string
}

// ─── Helpers (exported for unit tests) ───────────────────────────────────────

/**
 * Derive trend direction by comparing 6h count to the 24h hourly average.
 * escalating    = 6h rate > 2× hourly average
 * de-escalating = 6h rate < 0.5× hourly average AND count6h < count24h / 4
 * stable        = otherwise
 */
export function deriveFinanceTrend(
  count24h: number,
  count6h:  number,
): 'escalating' | 'stable' | 'de-escalating' {
  if (count24h === 0) return 'stable'
  const hourlyAvg   = count24h / 24
  const recent6hRate = count6h / 6
  if (recent6hRate > hourlyAvg * 2) return 'escalating'
  if (recent6hRate < hourlyAvg * 0.5 && count6h < count24h / 4) return 'de-escalating'
  return 'stable'
}

/**
 * Map signal tags/title to a FinanceSubcategory.
 * Checks tags array first, then falls back to title keyword matching.
 */
export function inferSubcategory(
  title: string,
  tags:  string[],
): FinanceSubcategory | null {
  const tagSet = new Set(tags.map(t => t.toLowerCase()))

  if (tagSet.has('central_bank') || tagSet.has('central-bank')) return 'central_bank'
  if (tagSet.has('crypto') || tagSet.has('bitcoin') || tagSet.has('blockchain')) return 'crypto'
  if (tagSet.has('sanctions') || tagSet.has('sanction')) return 'sanctions'
  if (tagSet.has('market_move') || tagSet.has('markets')) return 'market_move'
  if (tagSet.has('corporate') || tagSet.has('earnings')) return 'corporate'

  // title fallback
  const lower = title.toLowerCase()
  if (/\b(federal reserve|ecb|fomc|rate hike|rate cut|central bank|bps|basis points)\b/.test(lower)) return 'central_bank'
  if (/\b(bitcoin|btc|ethereum|eth|crypto|blockchain|defi|stablecoin)\b/.test(lower)) return 'crypto'
  if (/\b(sanctions|ofac|asset freeze|blacklist|sdn)\b/.test(lower)) return 'sanctions'
  if (/\b(s&p|dow jones|ftse|nasdaq|dax|nikkei|yield|bond|rally|sell.off|correction)\b/.test(lower)) return 'market_move'
  if (/\b(earnings|ipo|merger|acquisition|bankruptcy|revenue|profit)\b/.test(lower)) return 'corporate'

  return null
}

/**
 * Build subcategory breakdown counts from a list of raw rows.
 */
export function buildSubcategoryBreakdown(
  rows: Array<{ title: string; tags: string[] }>,
): SubcategoryBreakdown {
  const bd: SubcategoryBreakdown = {
    market_move: 0, central_bank: 0, sanctions: 0, corporate: 0, crypto: 0, unclassified: 0,
  }
  for (const row of rows) {
    const sub = inferSubcategory(row.title, row.tags)
    if (sub) bd[sub]++
    else bd.unclassified++
  }
  return bd
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerFinanceRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['finance']
  })

  // ── GET /summary ───────────────────────────────────────────────────────────

  app.get('/summary', {
    config: {
      rateLimit: {
        max:        FINANCE_RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags:    ['finance'],
      summary: 'Finance intelligence summary — signal counts, subcategory breakdown, trend',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cached:  { type: 'boolean' },
            data: {
              type: 'object',
              required: [
                'period_hours', 'total_signals_24h', 'total_signals_6h',
                'trend_direction', 'subcategory_breakdown', 'top_signals', 'generated_at',
              ],
              properties: {
                period_hours:      { type: 'number' },
                total_signals_24h: { type: 'number' },
                total_signals_6h:  { type: 'number' },
                trend_direction:   { type: 'string', enum: ['escalating', 'stable', 'de-escalating'] },
                subcategory_breakdown: {
                  type: 'object',
                  properties: {
                    market_move:  { type: 'number' },
                    central_bank: { type: 'number' },
                    sanctions:    { type: 'number' },
                    corporate:    { type: 'number' },
                    crypto:       { type: 'number' },
                    unclassified: { type: 'number' },
                  },
                },
                top_signals: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id:                { type: 'string' },
                      title:             { type: 'string' },
                      subcategory:       { type: ['string', 'null'] },
                      severity:          { type: 'string' },
                      reliability_score: { type: 'number' },
                      location_name:     { type: ['string', 'null'] },
                      country_code:      { type: ['string', 'null'] },
                      created_at:        { type: 'string' },
                    },
                  },
                },
                generated_at: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    // ── Cache check ──────────────────────────────────────────────────────────
    const cached = await redis.get(FINANCE_CACHE_KEY)
    if (cached) {
      const summary = JSON.parse(cached) as FinanceSummary
      return reply.send({ success: true, cached: true, data: summary })
    }

    // ── Query DB ─────────────────────────────────────────────────────────────
    const now   = new Date()
    const ago24 = new Date(now.getTime() - 24 * 60 * 60 * 1_000)
    const ago6  = new Date(now.getTime() -  6 * 60 * 60 * 1_000)

    const [rows24h, rows6h, topRows] = await Promise.all([
      db('signals')
        .where('category', 'finance')
        .where('created_at', '>=', ago24.toISOString())
        .select('title', 'tags'),
      db('signals')
        .where('category', 'finance')
        .where('created_at', '>=', ago6.toISOString())
        .select('title', 'tags'),
      db('signals')
        .where('category', 'finance')
        .where('created_at', '>=', ago24.toISOString())
        .orderBy('reliability_score', 'desc')
        .orderBy('created_at', 'desc')
        .limit(20)
        .select(
          'id', 'title', 'tags', 'severity',
          'reliability_score', 'location_name', 'country_code', 'created_at',
        ),
    ])

    const subcategory_breakdown = buildSubcategoryBreakdown(rows24h)
    const trend_direction       = deriveFinanceTrend(rows24h.length, rows6h.length)

    const top_signals: FinanceSignalEntry[] = topRows.map((r) => ({
      id:                r.id as string,
      title:             r.title as string,
      subcategory:       inferSubcategory(r.title as string, (r.tags as string[] | null) ?? []),
      severity:          r.severity as string,
      reliability_score: Number(r.reliability_score),
      location_name:     (r.location_name as string | null) ?? null,
      country_code:      (r.country_code  as string | null) ?? null,
      created_at:        r.created_at as string,
    }))

    const summary: FinanceSummary = {
      period_hours:          24,
      total_signals_24h:     rows24h.length,
      total_signals_6h:      rows6h.length,
      trend_direction,
      subcategory_breakdown,
      top_signals,
      generated_at:          now.toISOString(),
    }

    await redis.setex(FINANCE_CACHE_KEY, FINANCE_CACHE_TTL, JSON.stringify(summary))

    return reply.send({ success: true, cached: false, data: summary })
  })
}
