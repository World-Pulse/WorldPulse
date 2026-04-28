/**
 * Governance & Democracy Intelligence API
 *
 * Tracks global governance indicators and democracy metrics — democracy index,
 * freedom scores, corruption perception, press freedom. Monitors regime types and
 * governance trends across all regions.
 *
 * Endpoints:
 *   GET /api/v1/governance/countries          — list all countries with governance indicators
 *   GET /api/v1/governance/countries/:code    — single country detail
 *   GET /api/v1/governance/summary            — aggregate stats & regime breakdown
 *   GET /api/v1/governance/map/points         — GeoJSON PointCollection for map layer
 *
 * Data source: Seeded registry of 50+ countries with governance indicators from:
 * - Economist Intelligence Unit (Democracy Index: 0-10)
 * - Freedom House (Freedom Score: 0-100)
 * - Transparency International (Corruption Perception Index: 0-100)
 * - Reporters Sans Frontières (Press Freedom Rank: 1-180)
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for countries list cache: 1 hour */
export const LIST_CACHE_TTL     = 3600

/** Redis TTL for summary cache: 1 hour */
export const SUMMARY_CACHE_TTL  = 3600

/** Redis TTL for map points cache: 30 minutes */
export const MAP_CACHE_TTL      = 1800

/** Rate limit: requests per minute */
export const RATE_LIMIT_RPM     = 60

/** Default result limit */
export const DEFAULT_LIMIT      = 50

/** Maximum result limit */
export const MAX_LIMIT          = 100

/** Cache key prefixes */
export const CACHE_KEY_LIST     = 'governance:countries'
export const CACHE_KEY_SUMMARY  = 'governance:summary'
export const CACHE_KEY_MAP      = 'governance:map'
export const CACHE_KEY_DETAIL   = 'governance:country'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GovernanceIndicators {
  democracy_index:           number    // 0-10 scale
  freedom_score:             number    // 0-100
  corruption_perception:     number    // 0-100
  press_freedom_rank:        number    // 1-180 (lower is better)
}

export interface Country {
  code:                  string
  name:                  string
  region:                string
  regime_type:           'full_democracy' | 'flawed_democracy' | 'hybrid_regime' | 'authoritarian'
  indicators:            GovernanceIndicators
  trend:                 'improving' | 'declining' | 'stable'
  trend_magnitude:       number         // -10 to +10, change in democracy index
  related_signals:       number
}

export interface GovernanceSummary {
  total_countries:       number
  full_democracy:        number
  flawed_democracy:      number
  hybrid_regime:         number
  authoritarian:         number
  avg_democracy_index:   number
  avg_freedom_score:     number
  avg_corruption_index:  number
  most_improved:         { name: string; code: string; change: number }[]
  most_declined:         { name: string; code: string; change: number }[]
  regional_breakdown:    { region: string; count: number; avg_democracy: number }[]
  recent_signals:        number
}

// ─── Country Registry (50+ countries with diverse global coverage) ─────────────

export const COUNTRY_REGISTRY: Country[] = [
  // ─── Nordic & Western Europe (Full Democracies) ────────────────────────
  {
    code: 'NO', name: 'Norway', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.75, freedom_score: 100, corruption_perception: 84, press_freedom_rank: 1
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'SE', name: 'Sweden', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.50, freedom_score: 100, corruption_perception: 82, press_freedom_rank: 3
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'DK', name: 'Denmark', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.50, freedom_score: 100, corruption_perception: 90, press_freedom_rank: 2
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'FI', name: 'Finland', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.27, freedom_score: 100, corruption_perception: 87, press_freedom_rank: 4
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'DE', name: 'Germany', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.67, freedom_score: 98, corruption_perception: 78, press_freedom_rank: 21
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'NL', name: 'Netherlands', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.37, freedom_score: 99, corruption_perception: 84, press_freedom_rank: 5
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  // ─── Western Europe (Full Democracies) ─────────────────────────────────
  {
    code: 'FR', name: 'France', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.16, freedom_score: 96, corruption_perception: 73, press_freedom_rank: 32
    },
    trend: 'declining', trend_magnitude: -0.3, related_signals: 0
  },
  {
    code: 'GB', name: 'United Kingdom', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.18, freedom_score: 97, corruption_perception: 75, press_freedom_rank: 26
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'IE', name: 'Ireland', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.27, freedom_score: 99, corruption_perception: 76, press_freedom_rank: 14
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'ES', name: 'Spain', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.10, freedom_score: 96, corruption_perception: 62, press_freedom_rank: 36
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'IT', name: 'Italy', region: 'Europe',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 7.70, freedom_score: 94, corruption_perception: 56, press_freedom_rank: 46
    },
    trend: 'declining', trend_magnitude: -0.2, related_signals: 0
  },
  {
    code: 'PT', name: 'Portugal', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.39, freedom_score: 97, corruption_perception: 64, press_freedom_rank: 18
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  // ─── Eastern Europe (Flawed Democracy / Hybrid) ────────────────────────
  {
    code: 'PL', name: 'Poland', region: 'Europe',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.98, freedom_score: 80, corruption_perception: 56, press_freedom_rank: 60
    },
    trend: 'declining', trend_magnitude: -1.5, related_signals: 0
  },
  {
    code: 'CZ', name: 'Czech Republic', region: 'Europe',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 7.97, freedom_score: 95, corruption_perception: 67, press_freedom_rank: 34
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'HU', name: 'Hungary', region: 'Europe',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 5.55, freedom_score: 70, corruption_perception: 43, press_freedom_rank: 73
    },
    trend: 'declining', trend_magnitude: -0.8, related_signals: 0
  },
  {
    code: 'RO', name: 'Romania', region: 'Europe',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.69, freedom_score: 88, corruption_perception: 46, press_freedom_rank: 48
    },
    trend: 'improving', trend_magnitude: 0.5, related_signals: 0
  },
  {
    code: 'UA', name: 'Ukraine', region: 'Europe',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.36, freedom_score: 71, corruption_perception: 32, press_freedom_rank: 79
    },
    trend: 'declining', trend_magnitude: -0.4, related_signals: 0
  },
  {
    code: 'RU', name: 'Russia', region: 'Europe',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 2.41, freedom_score: 20, corruption_perception: 36, press_freedom_rank: 164
    },
    trend: 'declining', trend_magnitude: -0.9, related_signals: 0
  },
  // ─── Americas (North & South) ──────────────────────────────────────────
  {
    code: 'US', name: 'United States', region: 'Americas',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 7.85, freedom_score: 94, corruption_perception: 67, press_freedom_rank: 31
    },
    trend: 'declining', trend_magnitude: -0.7, related_signals: 0
  },
  {
    code: 'CA', name: 'Canada', region: 'Americas',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.15, freedom_score: 99, corruption_perception: 74, press_freedom_rank: 16
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'MX', name: 'Mexico', region: 'Americas',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 5.28, freedom_score: 68, corruption_perception: 31, press_freedom_rank: 108
    },
    trend: 'declining', trend_magnitude: -0.6, related_signals: 0
  },
  {
    code: 'BR', name: 'Brazil', region: 'Americas',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.94, freedom_score: 80, corruption_perception: 38, press_freedom_rank: 102
    },
    trend: 'improving', trend_magnitude: 0.3, related_signals: 0
  },
  {
    code: 'AR', name: 'Argentina', region: 'Americas',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.97, freedom_score: 89, corruption_perception: 36, press_freedom_rank: 58
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'CL', name: 'Chile', region: 'Americas',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.32, freedom_score: 94, corruption_perception: 67, press_freedom_rank: 35
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'CO', name: 'Colombia', region: 'Americas',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.46, freedom_score: 75, corruption_perception: 39, press_freedom_rank: 128
    },
    trend: 'improving', trend_magnitude: 0.4, related_signals: 0
  },
  {
    code: 'VE', name: 'Venezuela', region: 'Americas',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 2.80, freedom_score: 14, corruption_perception: 15, press_freedom_rank: 176
    },
    trend: 'declining', trend_magnitude: -1.2, related_signals: 0
  },
  // ─── Africa ────────────────────────────────────────────────────────────
  {
    code: 'ZA', name: 'South Africa', region: 'Africa',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.94, freedom_score: 82, corruption_perception: 43, press_freedom_rank: 28
    },
    trend: 'declining', trend_magnitude: -0.5, related_signals: 0
  },
  {
    code: 'NG', name: 'Nigeria', region: 'Africa',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 4.40, freedom_score: 52, corruption_perception: 25, press_freedom_rank: 134
    },
    trend: 'declining', trend_magnitude: -0.3, related_signals: 0
  },
  {
    code: 'KE', name: 'Kenya', region: 'Africa',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 5.58, freedom_score: 67, corruption_perception: 33, press_freedom_rank: 99
    },
    trend: 'improving', trend_magnitude: 0.6, related_signals: 0
  },
  {
    code: 'EG', name: 'Egypt', region: 'Africa',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 2.52, freedom_score: 28, corruption_perception: 33, press_freedom_rank: 168
    },
    trend: 'declining', trend_magnitude: -0.4, related_signals: 0
  },
  {
    code: 'ET', name: 'Ethiopia', region: 'Africa',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 3.29, freedom_score: 39, corruption_perception: 37, press_freedom_rank: 171
    },
    trend: 'declining', trend_magnitude: -0.2, related_signals: 0
  },
  {
    code: 'GH', name: 'Ghana', region: 'Africa',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.62, freedom_score: 81, corruption_perception: 43, press_freedom_rank: 26
    },
    trend: 'improving', trend_magnitude: 0.2, related_signals: 0
  },
  // ─── Middle East & North Africa ────────────────────────────────────────
  {
    code: 'IL', name: 'Israel', region: 'Middle East',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 7.51, freedom_score: 80, corruption_perception: 57, press_freedom_rank: 101
    },
    trend: 'declining', trend_magnitude: -1.1, related_signals: 0
  },
  {
    code: 'TR', name: 'Turkey', region: 'Middle East',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 4.09, freedom_score: 55, corruption_perception: 41, press_freedom_rank: 149
    },
    trend: 'declining', trend_magnitude: -0.7, related_signals: 0
  },
  {
    code: 'SA', name: 'Saudi Arabia', region: 'Middle East',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 1.93, freedom_score: 15, corruption_perception: 52, press_freedom_rank: 172
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'AE', name: 'United Arab Emirates', region: 'Middle East',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 1.61, freedom_score: 26, corruption_perception: 66, press_freedom_rank: 139
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'IR', name: 'Iran', region: 'Middle East',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 2.42, freedom_score: 16, corruption_perception: 28, press_freedom_rank: 178
    },
    trend: 'declining', trend_magnitude: -0.3, related_signals: 0
  },
  // ─── Asia-Pacific ──────────────────────────────────────────────────────
  {
    code: 'JP', name: 'Japan', region: 'Asia',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.13, freedom_score: 96, corruption_perception: 75, press_freedom_rank: 68
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'KR', name: 'South Korea', region: 'Asia',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.22, freedom_score: 84, corruption_perception: 68, press_freedom_rank: 50
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'KP', name: 'North Korea', region: 'Asia',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 1.08, freedom_score: 5, corruption_perception: 18, press_freedom_rank: 180
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'IN', name: 'India', region: 'Asia',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.61, freedom_score: 69, corruption_perception: 41, press_freedom_rank: 116
    },
    trend: 'declining', trend_magnitude: -0.5, related_signals: 0
  },
  {
    code: 'PK', name: 'Pakistan', region: 'Asia',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 4.68, freedom_score: 58, corruption_perception: 27, press_freedom_rank: 145
    },
    trend: 'declining', trend_magnitude: -0.2, related_signals: 0
  },
  {
    code: 'BD', name: 'Bangladesh', region: 'Asia',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 4.99, freedom_score: 51, corruption_perception: 26, press_freedom_rank: 162
    },
    trend: 'improving', trend_magnitude: 0.8, related_signals: 0
  },
  {
    code: 'TH', name: 'Thailand', region: 'Asia',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 4.42, freedom_score: 53, corruption_perception: 34, press_freedom_rank: 136
    },
    trend: 'declining', trend_magnitude: -0.4, related_signals: 0
  },
  {
    code: 'ID', name: 'Indonesia', region: 'Asia',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.97, freedom_score: 79, corruption_perception: 34, press_freedom_rank: 55
    },
    trend: 'improving', trend_magnitude: 0.3, related_signals: 0
  },
  {
    code: 'PH', name: 'Philippines', region: 'Asia',
    regime_type: 'flawed_democracy',
    indicators: {
      democracy_index: 6.02, freedom_score: 67, corruption_perception: 33, press_freedom_rank: 138
    },
    trend: 'declining', trend_magnitude: -0.4, related_signals: 0
  },
  {
    code: 'MY', name: 'Malaysia', region: 'Asia',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 5.45, freedom_score: 60, corruption_perception: 43, press_freedom_rank: 119
    },
    trend: 'improving', trend_magnitude: 0.1, related_signals: 0
  },
  {
    code: 'SG', name: 'Singapore', region: 'Asia',
    regime_type: 'hybrid_regime',
    indicators: {
      democracy_index: 5.89, freedom_score: 60, corruption_perception: 83, press_freedom_rank: 159
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'TW', name: 'Taiwan', region: 'Asia',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.99, freedom_score: 93, corruption_perception: 68, press_freedom_rank: 38
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'CN', name: 'China', region: 'Asia',
    regime_type: 'authoritarian',
    indicators: {
      democracy_index: 2.27, freedom_score: 14, corruption_perception: 78, press_freedom_rank: 175
    },
    trend: 'declining', trend_magnitude: -0.6, related_signals: 0
  },
  // ─── Oceania ──────────────────────────────────────────────────────────
  {
    code: 'AU', name: 'Australia', region: 'Oceania',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 8.60, freedom_score: 98, corruption_perception: 73, press_freedom_rank: 37
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
  {
    code: 'NZ', name: 'New Zealand', region: 'Oceania',
    regime_type: 'full_democracy',
    indicators: {
      democracy_index: 9.37, freedom_score: 100, corruption_perception: 88, press_freedom_rank: 8
    },
    trend: 'stable', trend_magnitude: 0, related_signals: 0
  },
]

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function filterCountries(
  countries: Country[],
  opts: {
    region?:               string
    regime_type?:          string
    min_democracy_score?:  number
    q?:                    string
    sortBy?:               'name' | 'democracy_index' | 'freedom_score' | 'corruption_perception'
    limit?:                number
  }
): Country[] {
  let filtered = [...countries]

  if (opts.region) {
    const regionLower = opts.region.toLowerCase()
    filtered = filtered.filter(c => c.region.toLowerCase() === regionLower)
  }

  if (opts.regime_type) {
    filtered = filtered.filter(c => c.regime_type === opts.regime_type)
  }

  if (opts.min_democracy_score !== undefined) {
    filtered = filtered.filter(c => c.indicators.democracy_index >= opts.min_democracy_score!)
  }

  if (opts.q) {
    const qLower = opts.q.toLowerCase()
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(qLower) ||
      c.code.toLowerCase().includes(qLower) ||
      c.regime_type.toLowerCase().includes(qLower)
    )
  }

  // Sort
  const sortKey = opts.sortBy ?? 'name'
  if (sortKey === 'name') {
    filtered.sort((a, b) => a.name.localeCompare(b.name))
  } else if (sortKey === 'democracy_index') {
    filtered.sort((a, b) => b.indicators.democracy_index - a.indicators.democracy_index)
  } else if (sortKey === 'freedom_score') {
    filtered.sort((a, b) => b.indicators.freedom_score - a.indicators.freedom_score)
  } else if (sortKey === 'corruption_perception') {
    filtered.sort((a, b) => b.indicators.corruption_perception - a.indicators.corruption_perception)
  }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return filtered.slice(0, limit)
}

export function buildSummary(countries: Country[]): GovernanceSummary {
  const full_democracy = countries.filter(c => c.regime_type === 'full_democracy').length
  const flawed_democracy = countries.filter(c => c.regime_type === 'flawed_democracy').length
  const hybrid_regime = countries.filter(c => c.regime_type === 'hybrid_regime').length
  const authoritarian = countries.filter(c => c.regime_type === 'authoritarian').length

  const avg_democracy = countries.reduce((sum, c) => sum + c.indicators.democracy_index, 0) / countries.length
  const avg_freedom = countries.reduce((sum, c) => sum + c.indicators.freedom_score, 0) / countries.length
  const avg_corruption = countries.reduce((sum, c) => sum + c.indicators.corruption_perception, 0) / countries.length

  // Most improved/declined
  const byChange = [...countries]
    .filter(c => c.trend_magnitude !== 0)
    .sort((a, b) => Math.abs(b.trend_magnitude) - Math.abs(a.trend_magnitude))

  const most_improved = byChange
    .filter(c => c.trend_magnitude > 0)
    .slice(0, 5)
    .map(c => ({ name: c.name, code: c.code, change: c.trend_magnitude }))

  const most_declined = byChange
    .filter(c => c.trend_magnitude < 0)
    .slice(0, 5)
    .map(c => ({ name: c.name, code: c.code, change: c.trend_magnitude }))

  // Regional breakdown
  const regionMap = new Map<string, { region: string; count: number; sum_democracy: number }>()
  for (const country of countries) {
    if (!regionMap.has(country.region)) {
      regionMap.set(country.region, { region: country.region, count: 0, sum_democracy: 0 })
    }
    const entry = regionMap.get(country.region)!
    entry.count++
    entry.sum_democracy += country.indicators.democracy_index
  }

  const regional_breakdown = [...regionMap.values()]
    .map(r => ({
      region: r.region,
      count: r.count,
      avg_democracy: r.sum_democracy / r.count
    }))
    .sort((a, b) => b.avg_democracy - a.avg_democracy)

  return {
    total_countries: countries.length,
    full_democracy,
    flawed_democracy,
    hybrid_regime,
    authoritarian,
    avg_democracy_index: avg_democracy,
    avg_freedom_score: avg_freedom,
    avg_corruption_index: avg_corruption,
    most_improved,
    most_declined,
    regional_breakdown,
    recent_signals: 0
  }
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

const governancePlugin: FastifyPluginAsync = async (app) => {

  // GET /countries — list all countries with governance indicators
  app.get('/countries', async (req, reply) => {
    try {
      const query = req.query as Record<string, string | undefined>
      const cacheKey = `${CACHE_KEY_LIST}:${JSON.stringify(query)}`

      // Check cache
      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      // Enrich with signal counts
      const enriched = [...COUNTRY_REGISTRY]
      try {
        for (const country of enriched) {
          const countRows = await db('signals')
            .where('category', 'governance')
            .where(function () {
              this.where('title', 'ilike', `%${country.name}%`)
                .orWhere('title', 'ilike', `%${country.code}%`)
            })
            .where('published_at', '>', db.raw("NOW() - INTERVAL '30 days'"))
            .count('id as count')
          country.related_signals = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)
        }
      } catch { /* DB error — use defaults */ }

      const filtered = filterCountries(enriched, {
        region: query.region,
        regime_type: query.regime_type,
        min_democracy_score: query.min_democracy_score ? parseFloat(query.min_democracy_score) : undefined,
        q: query.q,
        sortBy: (query.sortBy as any) ?? 'name',
        limit: query.limit ? parseInt(query.limit, 10) : undefined
      })

      const response = {
        success: true,
        data: filtered,
        total: filtered.length,
        registry_total: COUNTRY_REGISTRY.length
      }

      // Cache
      try {
        await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch governance data')
    }
  })

  // GET /countries/:code — single country detail
  app.get('/countries/:code', async (req, reply) => {
    try {
      const { code } = req.params as { code: string }
      const cacheKey = `${CACHE_KEY_DETAIL}:${code}`

      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const country = COUNTRY_REGISTRY.find(c => c.code === code.toUpperCase())
      if (!country) {
        return sendError(reply, 404, 'NOT_FOUND', `Country "${code}" not found`)
      }

      // Enrich with recent related signals
      let recentSignals: unknown[] = []
      try {
        recentSignals = await db('signals')
          .select('id', 'title', 'severity', 'published_at', 'category')
          .where('category', 'governance')
          .where(function () {
            this.where('title', 'ilike', `%${country.name}%`)
              .orWhere('title', 'ilike', `%${country.code}%`)
          })
          .where('published_at', '>', db.raw("NOW() - INTERVAL '7 days'"))
          .orderBy('published_at', 'desc')
          .limit(10)
      } catch { /* DB error — non-fatal */ }

      const response = {
        success: true,
        data: { ...country, recent_signals: recentSignals }
      }

      try {
        await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch country detail')
    }
  })

  // GET /summary — aggregate stats & regime breakdown
  app.get('/summary', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_SUMMARY)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const summary = buildSummary(COUNTRY_REGISTRY)

      // Get recent governance signal count
      try {
        const countRows = await db('signals')
          .where('category', 'governance')
          .where('published_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
          .count('id as count')
        summary.recent_signals = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)
      } catch { /* DB error — non-fatal */ }

      const response = { success: true, data: summary }

      try {
        await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to build governance summary')
    }
  })

  // GET /map/points — GeoJSON PointCollection for map layer
  app.get('/map/points', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_MAP)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      // For governance, we use country centroids (simplified approach)
      // In production, this would use actual country capital coordinates from a geo database
      const countryCoords: Record<string, [number, number]> = {
        'NO': [8.47, 60.47], 'SE': [18.64, 60.13], 'DK': [9.50, 56.26], 'FI': [25.75, 61.92],
        'DE': [10.45, 51.17], 'NL': [5.29, 52.13], 'FR': [2.21, 46.23], 'GB': [-2.24, 55.38],
        'IE': [-8.24, 53.41], 'ES': [-3.74, 40.46], 'IT': [12.57, 41.87], 'PT': [-8.22, 39.40],
        'PL': [19.15, 51.92], 'CZ': [15.47, 49.82], 'HU': [19.50, 47.16], 'RO': [24.97, 45.94],
        'UA': [31.29, 48.38], 'RU': [105.32, 61.52], 'US': [-95.71, 37.09], 'CA': [-106.35, 56.13],
        'MX': [-102.55, 23.63], 'BR': [-51.93, -14.24], 'AR': [-63.62, -38.42], 'CL': [-71.54, -35.68],
        'CO': [-74.30, 4.57], 'VE': [-66.59, 6.42], 'ZA': [24.00, -29.61], 'NG': [8.68, 9.08],
        'KE': [37.91, -0.02], 'EG': [30.80, 26.82], 'ET': [38.75, 9.15], 'GH': [-2.00, 7.37],
        'IL': [35.23, 31.95], 'TR': [35.24, 38.96], 'SA': [45.08, 23.89], 'AE': [53.85, 23.42],
        'IR': [53.69, 32.43], 'JP': [138.25, 36.20], 'KR': [127.01, 37.27], 'KP': [127.11, 40.34],
        'IN': [78.96, 20.59], 'PK': [69.35, 30.19], 'BD': [90.36, 23.68], 'TH': [100.99, 15.87],
        'ID': [113.92, -2.17], 'PH': [121.77, 12.88], 'MY': [102.69, 4.21], 'SG': [103.85, 1.35],
        'TW': [120.96, 23.70], 'CN': [104.07, 35.86], 'AU': [133.78, -25.29], 'NZ': [174.89, -40.90],
      }

      const features = COUNTRY_REGISTRY
        .map(country => {
          const coords = countryCoords[country.code]
          if (!coords) return null

          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: coords
            },
            properties: {
              code: country.code,
              name: country.name,
              region: country.region,
              regime_type: country.regime_type,
              democracy_index: country.indicators.democracy_index,
              freedom_score: country.indicators.freedom_score,
              corruption_perception: country.indicators.corruption_perception,
              press_freedom_rank: country.indicators.press_freedom_rank,
              trend: country.trend,
              trend_magnitude: country.trend_magnitude
            }
          }
        })
        .filter((f): f is typeof f & {} => f !== null)

      const geojson = {
        type: 'FeatureCollection' as const,
        features
      }

      try {
        await redis.setex(CACHE_KEY_MAP, MAP_CACHE_TTL, JSON.stringify(geojson))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(geojson)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to build governance map data')
    }
  })
}

export default governancePlugin
