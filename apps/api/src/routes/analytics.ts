import type { FastifyPluginAsync } from 'fastify'
import https from 'node:https'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate } from '../middleware/auth'

const THREAT_INDEX_TTL      = 120  // 2 min cache
const MARKETS_CACHE_TTL     = 300  // 5 min cache — respects Yahoo Finance rate limits
const ESCALATION_CACHE_TTL  = 300  // 5 min cache

// ─── ESCALATION INDEX HELPERS ─────────────────────────────────────────────
// Exported for unit-testing in escalation-index.test.ts

export type EscalationLevel = 'Critical' | 'High' | 'Elevated' | 'Moderate' | 'Calm'

export interface SeverityCounts {
  critical: number
  high:     number
  medium:   number
  low:      number
  info:     number
}

/**
 * Compute a 0-100 escalation score from signal counts.
 * volumeRatio  — ratio of current-window signal count vs previous same-length window (capped at 3)
 * severityCounts — breakdown by severity level in the current window
 */
export function computeEscalationScore(
  currentCount: number,
  previousCount: number,
  severityCounts: SeverityCounts,
): number {
  const total = currentCount
  if (total === 0) return 0

  // Volume score: ratio capped at 3x → maps to 0-40 points
  const safePrev     = previousCount > 0 ? previousCount : 1
  const volumeRatio  = Math.min(3, currentCount / safePrev)
  const volumePoints = (volumeRatio / 3) * 40

  // Severity score: weighted average → maps to 0-60 points
  const weighted =
    (severityCounts.critical ?? 0) * 4 +
    (severityCounts.high     ?? 0) * 3 +
    (severityCounts.medium   ?? 0) * 2 +
    (severityCounts.low      ?? 0) * 1
  const maxPossible  = total * 4
  const severityScore = maxPossible > 0 ? weighted / maxPossible : 0
  const severityPoints = severityScore * 60

  return Math.min(100, Math.max(0, Math.round(volumePoints + severityPoints)))
}

export function escalationLevel(score: number): EscalationLevel {
  if (score >= 80) return 'Critical'
  if (score >= 60) return 'High'
  if (score >= 40) return 'Elevated'
  if (score >= 20) return 'Moderate'
  return 'Calm'
}

export function escalationColor(level: EscalationLevel): string {
  const map: Record<EscalationLevel, string> = {
    Critical: '#ff3b5c',
    High:     '#ff6b35',
    Elevated: '#f5a623',
    Moderate: '#00d4ff',
    Calm:     '#00e676',
  }
  return map[level]
}

export function escalationTrend(
  currentScore: number,
  previousScore: number,
): 'rising' | 'stable' | 'falling' {
  if (currentScore > previousScore + 5) return 'rising'
  if (currentScore < previousScore - 5) return 'falling'
  return 'stable'
}

export function parseWindowHours(window: string): number {
  if (window === '48h') return 48
  if (window === '7d')  return 168
  return 24  // default: 24h
}

// Market instruments tracked
const MARKET_TICKERS = [
  { symbol: '^VIX',    name: 'VIX',    type: 'volatility' },
  { symbol: '^GSPC',   name: 'S&P 500', type: 'equity'    },
  { symbol: '^IXIC',   name: 'NASDAQ',  type: 'equity'    },
  { symbol: '^FTSE',   name: 'FTSE 100', type: 'equity'   },
  { symbol: '^N225',   name: 'Nikkei',  type: 'equity'    },
  { symbol: 'BTC-USD', name: 'BTC',     type: 'crypto'    },
  { symbol: 'GC=F',    name: 'Gold',    type: 'commodity' },
  { symbol: 'CL=F',    name: 'WTI Oil', type: 'commodity' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', type: 'fx'       },
]

function fetchYahooQuote(symbol: string): Promise<{ price: number; changePercent: number; prevClose: number } | null> {
  return new Promise(resolve => {
    const encoded = encodeURIComponent(symbol)
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path:     `/v8/finance/chart/${encoded}?interval=1d&range=1d`,
      headers:  { 'User-Agent': 'Mozilla/5.0 WorldPulse/1.0' },
      timeout:  5000,
    }
    const req = https.get(opts, res => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          const meta = json?.chart?.result?.[0]?.meta
          if (!meta) return resolve(null)
          const price   = meta.regularMarketPrice ?? meta.previousClose
          const prev    = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice
          const change  = prev && price ? ((price - prev) / prev) * 100 : 0
          resolve({ price: Number(price.toFixed(4)), changePercent: Number(change.toFixed(2)), prevClose: Number(prev?.toFixed(4) ?? 0) })
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

export const registerAnalyticsRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['analytics']
  })

  // ─── GLOBAL THREAT INDEX ─────────────────────────────────
  // GET /api/v1/analytics/threat-index
  // Computes live global threat level from recent signal severity distribution.
  app.get('/threat-index', {
    schema: {
      summary: 'Global Threat Index',
      description: 'Live composite threat level based on recent signal severity distribution',
      querystring: {
        type: 'object',
        properties: {
          window: { type: 'string', enum: ['1h', '6h', '24h'], default: '6h' },
        },
      },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { window = '6h' } = req.query as { window?: string }
    const cacheKey = `analytics:threat-index:${window}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const hours = window === '1h' ? 1 : window === '24h' ? 24 : 6
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()

    const rows = await db('signals')
      .where('status', 'verified')
      .where('created_at', '>=', since)
      .select('severity')
      .count('* as count')
      .groupBy('severity')

    const counts: Record<string, number> = {}
    let total = 0
    for (const r of rows as Array<{ severity: string; count: string }>) {
      counts[r.severity] = Number(r.count)
      total += Number(r.count)
    }

    if (total === 0) {
      const empty = { level: 1, label: 'Minimal', description: 'No recent verified signals', color: '#00e676', total_signals: 0, window, distribution: {}, generated_at: new Date().toISOString() }
      await redis.setex(cacheKey, THREAT_INDEX_TTL, JSON.stringify(empty)).catch(() => {})
      return reply.send(empty)
    }

    // Weighted score: critical×5 + high×3 + medium×1.5 + low×0.5
    const weighted =
      (counts.critical ?? 0) * 5 +
      (counts.high     ?? 0) * 3 +
      (counts.medium   ?? 0) * 1.5 +
      (counts.low      ?? 0) * 0.5 +
      (counts.info     ?? 0) * 0.1

    // Normalise to a 1–5 threat level
    // Anchor: 100 weighted score = level 5, 0 = level 1
    const maxExpected = total * 5  // if all signals were critical
    const ratio = weighted / maxExpected
    const rawLevel = 1 + ratio * 4  // 1.0 – 5.0
    const level = Math.min(5, Math.max(1, Math.round(rawLevel)))

    const LEVEL_META: Record<number, { label: string; color: string; description: string }> = {
      1: { label: 'Minimal',  color: '#00e676', description: 'Low global activity — no significant emerging threats' },
      2: { label: 'Elevated', color: '#ffd700', description: 'Moderate signal activity — some elevated events detected' },
      3: { label: 'High',     color: '#f5a623', description: 'Elevated global threat — multiple high-severity events active' },
      4: { label: 'Severe',   color: '#ff6b35', description: 'Severe threat environment — critical events detected in multiple regions' },
      5: { label: 'Critical', color: '#ff3b5c', description: 'Critical global situation — multiple ongoing critical-severity events' },
    }

    const meta = LEVEL_META[level]!
    const result = {
      level,
      label:       meta.label,
      description: meta.description,
      color:       meta.color,
      total_signals: total,
      window,
      distribution: {
        critical: counts.critical ?? 0,
        high:     counts.high     ?? 0,
        medium:   counts.medium   ?? 0,
        low:      counts.low      ?? 0,
        info:     counts.info     ?? 0,
      },
      weighted_score:    Math.round(weighted),
      generated_at: new Date().toISOString(),
    }

    await redis.setex(cacheKey, THREAT_INDEX_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── MARKET TICKER ────────────────────────────────────────
  // GET /api/v1/analytics/markets
  // Returns live prices for key market indicators (equities, crypto, commodities, FX).
  app.get('/markets', {
    schema: {
      summary: 'Market Ticker',
      description: 'Live prices for VIX, S&P 500, NASDAQ, FTSE 100, Nikkei, Bitcoin, Gold, WTI Oil, EUR/USD from Yahoo Finance',
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const cacheKey = 'analytics:markets'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    // Fetch all quotes in parallel — tolerate partial failures
    const results = await Promise.allSettled(
      MARKET_TICKERS.map(async t => {
        const quote = await fetchYahooQuote(t.symbol)
        return { ...t, ...(quote ?? { price: null, changePercent: null, prevClose: null }) }
      })
    )

    const tickers = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      return { ...MARKET_TICKERS[i]!, price: null, changePercent: null, prevClose: null }
    })

    const result = { tickers, generated_at: new Date().toISOString() }
    await redis.setex(cacheKey, MARKETS_CACHE_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── GDELT ESCALATION INDEX ──────────────────────────────
  // GET /api/v1/analytics/escalation-index
  // Computes a 0-100 conflict escalation score from GDELT/conflict signals.
  // Directly counters WorldMonitor's GDELT tone/volume timeline feature (PR Mar 22 2026).
  app.get('/escalation-index', {
    schema: {
      summary: 'GDELT Escalation Index',
      description: 'Composite 0-100 conflict escalation score derived from GDELT/conflict signal volume and severity trends',
      querystring: {
        type: 'object',
        properties: {
          window: { type: 'string', enum: ['24h', '48h', '7d'], default: '24h' },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { window: rawWindow = '24h' } = req.query as { window?: string }
    // Validate and normalise window param
    const windowParam = (['24h', '48h', '7d'] as const).includes(rawWindow as '24h' | '48h' | '7d')
      ? (rawWindow as '24h' | '48h' | '7d')
      : '24h'

    const cacheKey = `analytics:escalation:${windowParam}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const hours = parseWindowHours(windowParam)
    const nowMs = Date.now()
    const windowStart  = new Date(nowMs - hours * 3600 * 1000).toISOString()
    const prevStart    = new Date(nowMs - hours * 2 * 3600 * 1000).toISOString()

    // Query current window: conflict/gdelt signals with severity breakdown
    const [currentRows, prevCountRows, topRegionRows, prevScoreRows] = await Promise.all([
      // Current window: severity breakdown
      db('signals')
        .where('created_at', '>=', windowStart)
        .where(builder => {
          builder
            .where('category', 'conflict')
            .orWhereRaw("tags @> ARRAY['gdelt']::text[]")
        })
        .select('severity')
        .count('* as count')
        .groupBy('severity') as Promise<Array<{ severity: string; count: string }>>,

      // Previous same-length window: total count only
      db('signals')
        .where('created_at', '>=', prevStart)
        .where('created_at', '<', windowStart)
        .where(builder => {
          builder
            .where('category', 'conflict')
            .orWhereRaw("tags @> ARRAY['gdelt']::text[]")
        })
        .count('* as count')
        .first() as Promise<{ count: string } | undefined>,

      // Top regions by signal count in current window
      db('signals')
        .where('created_at', '>=', windowStart)
        .whereNotNull('location_name')
        .where(builder => {
          builder
            .where('category', 'conflict')
            .orWhereRaw("tags @> ARRAY['gdelt']::text[]")
        })
        .select('location_name')
        .count('* as count')
        .groupBy('location_name')
        .orderByRaw('count DESC')
        .limit(5) as unknown as Promise<Array<{ location_name: string; count: string }>>,

      // Previous 6h window for trend comparison (always 6h lookback)
      db('signals')
        .where('created_at', '>=', new Date(nowMs - 12 * 3600 * 1000).toISOString())
        .where('created_at', '<', new Date(nowMs - 6 * 3600 * 1000).toISOString())
        .where(builder => {
          builder
            .where('category', 'conflict')
            .orWhereRaw("tags @> ARRAY['gdelt']::text[]")
        })
        .select('severity')
        .count('* as count')
        .groupBy('severity') as Promise<Array<{ severity: string; count: string }>>,
    ])

    // Assemble severity counts for current window
    const severityCounts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    let currentTotal = 0
    for (const r of currentRows) {
      const sev = r.severity as keyof SeverityCounts
      if (sev in severityCounts) severityCounts[sev] = Number(r.count)
      currentTotal += Number(r.count)
    }

    const previousTotal = Number((prevCountRows as { count: string } | undefined)?.count ?? 0)

    // Compute current score
    const score = computeEscalationScore(currentTotal, previousTotal, severityCounts)
    const level = escalationLevel(score)
    const color = escalationColor(level)

    // Compute previous 6h score for trend
    const prev6hCounts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    let prev6hTotal = 0
    for (const r of prevScoreRows) {
      const sev = r.severity as keyof SeverityCounts
      if (sev in prev6hCounts) prev6hCounts[sev] = Number(r.count)
      prev6hTotal += Number(r.count)
    }
    // Prev6h score: use half the previous total as "previous" for that 6h window
    const prev6hScore = computeEscalationScore(prev6hTotal, Math.floor(prev6hTotal / 2), prev6hCounts)
    const trend = escalationTrend(score, prev6hScore)

    const top_regions = topRegionRows
      .map(r => ({ name: r.location_name, count: Number(r.count) }))

    const result = {
      score,
      level,
      level_color:    color,
      trend,
      window:         windowParam,
      current_count:  currentTotal,
      previous_count: previousTotal,
      severity_breakdown: severityCounts,
      top_regions,
      generated_at: new Date().toISOString(),
    }

    await redis.setex(cacheKey, ESCALATION_CACHE_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── PERSONAL ANALYTICS ──────────────────────────────────
  // GET /api/v1/analytics/me
  app.get('/me', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user!.id

    const [
      postStats,
      signalStats,
      followStats,
      postsByDay,
      topPosts,
    ] = await Promise.all([
      // Total posts, total likes/boosts/replies received
      db('posts as p')
        .where('p.author_id', userId)
        .whereNull('p.deleted_at')
        .select(
          db.raw('COUNT(*) as total_posts'),
          db.raw('COALESCE(SUM(p.like_count), 0) as total_likes_received'),
          db.raw('COALESCE(SUM(p.boost_count), 0) as total_boosts_received'),
          db.raw('COALESCE(SUM(p.reply_count), 0) as total_replies_received'),
          db.raw('COALESCE(SUM(p.view_count), 0) as total_views'),
        )
        .first(),

      // Signal contributions
      db.raw(`
        SELECT
          COUNT(DISTINCT vl.signal_id) FILTER (
            WHERE EXISTS (SELECT 1 FROM signals s WHERE s.id = vl.signal_id AND s.id IN (
              SELECT signal_id FROM posts WHERE author_id = ? AND signal_id IS NOT NULL
            ))
          ) as signals_submitted,
          COUNT(DISTINCT vl.signal_id) FILTER (
            WHERE vl.actor_id = ? AND vl.result = 'confirmed'
          ) as signals_verified
        FROM verification_log vl
        WHERE vl.actor_id = ?
      `, [userId, userId, userId]).then(r => r.rows[0]),

      // Follow counts from users table
      db('users')
        .where('id', userId)
        .select('follower_count', 'following_count', 'signal_count')
        .first(),

      // Posts per day for last 30 days
      db.raw(`
        SELECT
          DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') as day,
          COUNT(*) as count
        FROM posts
        WHERE author_id = ?
          AND deleted_at IS NULL
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day ASC
      `, [userId]).then(r => r.rows),

      // Top 5 posts by engagement (likes + boosts + replies)
      db('posts as p')
        .where('p.author_id', userId)
        .whereNull('p.deleted_at')
        .whereNull('p.parent_id')
        .select([
          'p.id',
          'p.content',
          'p.post_type',
          'p.like_count',
          'p.boost_count',
          'p.reply_count',
          'p.view_count',
          'p.created_at',
          db.raw('(p.like_count + p.boost_count + p.reply_count) as engagement_total'),
        ])
        .orderByRaw('(p.like_count + p.boost_count + p.reply_count) DESC')
        .limit(5),
    ])

    // Build posts-per-day map filling in zeroes for missing days
    const dayMap = new Map<string, number>()
    for (const row of postsByDay as Array<{ day: Date; count: string }>) {
      dayMap.set(row.day.toISOString().slice(0, 10), Number(row.count))
    }
    const postsPerDay: Array<{ date: string; count: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      const key = d.toISOString().slice(0, 10)
      postsPerDay.push({ date: key, count: dayMap.get(key) ?? 0 })
    }

    const ps = postStats as Record<string, string>
    const ss = signalStats as Record<string, string>
    const fs = followStats as Record<string, number>

    const totalLikes    = Number(ps?.total_likes_received ?? 0)
    const totalBoosts   = Number(ps?.total_boosts_received ?? 0)
    const totalViews    = Number(ps?.total_views ?? 0)
    const engagementRate = totalViews > 0
      ? ((totalLikes + totalBoosts) / totalViews)
      : 0

    const signalsSubmitted = Number(ss?.signals_submitted ?? 0)
    const signalsVerified  = Number(ss?.signals_verified  ?? 0)
    const verificationRate = signalsSubmitted > 0
      ? (signalsVerified / signalsSubmitted)
      : 0

    return reply.send({
      success: true,
      data: {
        overview: {
          totalPosts:           Number(ps?.total_posts ?? 0),
          totalLikesReceived:   totalLikes,
          totalBoostsReceived:  totalBoosts,
          totalRepliesReceived: Number(ps?.total_replies_received ?? 0),
          totalViews,
          followerCount:        Number(fs?.follower_count  ?? 0),
          followingCount:       Number(fs?.following_count ?? 0),
          signalCount:          Number(fs?.signal_count    ?? 0),
          engagementRate:       parseFloat(engagementRate.toFixed(4)),
        },
        signals: {
          submitted:        signalsSubmitted,
          verified:         signalsVerified,
          verificationRate: parseFloat(verificationRate.toFixed(4)),
        },
        postsPerDay,
        topPosts: (topPosts as Array<{
          id: string
          content: string
          post_type: string
          like_count: number
          boost_count: number
          reply_count: number
          view_count: number
          created_at: Date
          engagement_total: number
        }>).map(p => ({
          id:              p.id,
          content:         p.content.slice(0, 200),
          postType:        p.post_type,
          likeCount:       Number(p.like_count),
          boostCount:      Number(p.boost_count),
          replyCount:      Number(p.reply_count),
          viewCount:       Number(p.view_count),
          engagementTotal: Number(p.engagement_total),
          createdAt:       p.created_at.toISOString(),
        })),
      },
    })
  })

  // ─── TRENDING ENTITIES ────────────────────────────────────────────────────
  // GET /api/v1/analytics/trending-entities
  // Extracts the most-mentioned entities (countries, orgs, topics) from
  // recent signal titles + tags and returns frequency + severity breakdown.
  // Competitive with GDELT entity tracking and WorldMonitor geopolitical intel.
  app.get('/trending-entities', {
    schema: {
      summary: 'Trending entities across recent signals',
      description: 'Top entities (countries, organisations, topics, actors) extracted from signal titles and tags within the chosen time window, ranked by frequency with severity breakdown.',
      querystring: {
        type: 'object',
        properties: {
          window: { type: 'string', enum: ['1h', '6h', '24h', '48h', '7d'], default: '24h' },
          limit:  { type: 'integer', minimum: 5, maximum: 50, default: 20 },
          type:   { type: 'string', enum: ['all', 'country', 'org', 'topic', 'actor'], default: 'all' },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { window = '24h', limit = 20, type = 'all' } = req.query as {
      window?: string
      limit?:  number
      type?:   string
    }
    const safeLimit = Math.min(50, Math.max(5, Number(limit)))

    const cacheKey = `analytics:trending-entities:${window}:${safeLimit}:${type}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const hours =
      window === '1h'  ? 1  :
      window === '6h'  ? 6  :
      window === '48h' ? 48 :
      window === '7d'  ? 168 :
      24

    const since = new Date(Date.now() - hours * 3600_000)

    // ── Fetch recent signals with their tags + severity + country ────────────
    const rows = await db('signals')
      .select('title', 'severity', 'country_code', 'tags', 'category')
      .where('created_at', '>=', since)
      .whereIn('status', ['verified', 'pending'])
      .orderBy('created_at', 'desc')
      .limit(2000)  // cap raw input to avoid large scans

    // ── Entity extraction ───────────────────────────────────────────────────
    // We use a simple but effective frequency-based NLP approach:
    // 1. From tags array (already structured)
    // 2. From title noun-chunks via a curated entity pattern list

    interface EntityBucket {
      entity:    string
      type:      'country' | 'org' | 'topic' | 'actor'
      count:     number
      severity:  { critical: number; high: number; medium: number; low: number; info: number }
      categories: Record<string, number>
      countries:  Record<string, number>
    }

    const entityMap = new Map<string, EntityBucket>()

    function bump(
      raw:      string,
      eType:    EntityBucket['type'],
      severity: string,
      category: string | null,
      country:  string | null,
    ): void {
      const key = raw.toLowerCase().trim()
      if (key.length < 2) return
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          entity:     raw.trim(),
          type:       eType,
          count:      0,
          severity:   { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          categories: {},
          countries:  {},
        })
      }
      const b = entityMap.get(key)!
      b.count++
      const sev = (severity ?? 'info') as keyof EntityBucket['severity']
      if (sev in b.severity) b.severity[sev]++
      if (category) b.categories[category] = (b.categories[category] ?? 0) + 1
      if (country)  b.countries[country]   = (b.countries[country]  ?? 0) + 1
    }

    // Known country name/code lookup table for title extraction
    const COUNTRY_PATTERNS: Array<[RegExp, string]> = [
      [/\brussia\b|\brussian\b/i,          'Russia'      ],
      [/\bukraine\b|\bukrainian\b/i,        'Ukraine'     ],
      [/\bchina\b|\bchinese\b/i,            'China'       ],
      [/\bunited states\b|\busa\b|\bus\b/i, 'United States'],
      [/\bisrael\b|\bisraeli\b/i,           'Israel'      ],
      [/\biran\b|\biranian\b/i,             'Iran'        ],
      [/\bnorth korea\b/i,                  'North Korea' ],
      [/\bsouth korea\b/i,                  'South Korea' ],
      [/\bgaza\b/i,                         'Gaza'        ],
      [/\bwashington\b/i,                   'United States'],
      [/\bbeijing\b/i,                      'China'       ],
      [/\bkremlin\b|\bmoscow\b/i,           'Russia'      ],
      [/\bkyiv\b|\bkiev\b/i,               'Ukraine'      ],
      [/\btehran\b/i,                       'Iran'        ],
      [/\bpyongyang\b/i,                    'North Korea' ],
      [/\bindian?\b/i,                      'India'       ],
      [/\bpakistan\b|\bpakistani\b/i,       'Pakistan'    ],
      [/\bsyria\b|\bsyrian\b/i,             'Syria'       ],
      [/\bifran\b|\bafghan\b/i,             'Afghanistan' ],
      [/\bturkey\b|\bturkish\b/i,           'Turkey'      ],
      [/\bsaudi\b/i,                        'Saudi Arabia'],
      [/\bmyanmar\b|\bburma\b/i,            'Myanmar'     ],
    ]

    // Org / actor patterns
    const ORG_PATTERNS: Array<[RegExp, string]> = [
      [/\bnato\b/i,      'NATO'   ],
      [/\bun\b|\bunited nations\b/i, 'UN'],
      [/\bwho\b|\bworld health org\b/i, 'WHO'],
      [/\bimf\b/i,       'IMF'    ],
      [/\bworld bank\b/i,'World Bank'],
      [/\bfbi\b/i,       'FBI'    ],
      [/\bcia\b/i,       'CIA'    ],
      [/\bopec\b/i,      'OPEC'   ],
      [/\bwto\b/i,       'WTO'    ],
      [/\bcdc\b/i,       'CDC'    ],
      [/\bfda\b/i,       'FDA'    ],
      [/\bgoogle\b/i,    'Google' ],
      [/\bmeta\b/i,      'Meta'   ],
      [/\bapple\b/i,     'Apple'  ],
      [/\bmicrosoft\b/i, 'Microsoft'],
      [/\bopenai\b/i,    'OpenAI' ],
      [/\banth?ropic\b/i,'Anthropic'],
    ]

    for (const row of rows) {
      const sev  = (row.severity as string) ?? 'info'
      const cat  = (row.category as string | null) ?? null
      const cc   = (row.country_code as string | null) ?? null
      const title = (row.title as string) ?? ''

      // 1. Tags (already structured, highest signal quality)
      const tags = Array.isArray(row.tags) ? row.tags as string[] : []
      for (const tag of tags) {
        if (typeof tag === 'string' && tag.length >= 2) {
          bump(tag, 'topic', sev, cat, cc)
        }
      }

      // 2. Country extraction from title
      for (const [pattern, name] of COUNTRY_PATTERNS) {
        if (pattern.test(title)) bump(name, 'country', sev, cat, cc)
      }

      // 3. Org / actor extraction from title
      for (const [pattern, name] of ORG_PATTERNS) {
        if (pattern.test(title)) bump(name, 'org', sev, cat, cc)
      }

      // 4. Country-code field itself (highest-confidence geo signal)
      if (cc && cc.length === 2) bump(cc.toUpperCase(), 'country', sev, cat, cc)
    }

    // ── Filter by requested type ──────────────────────────────────────────────
    let entities = [...entityMap.values()]
    if (type !== 'all') entities = entities.filter(e => e.type === type)

    // ── Sort by count DESC, take top N ───────────────────────────────────────
    entities.sort((a, b) => b.count - a.count)
    const topEntities = entities.slice(0, safeLimit).map(e => ({
      entity:     e.entity,
      type:       e.type,
      count:      e.count,
      severity:   e.severity,
      // Top 3 categories this entity appears in
      top_categories: Object.entries(e.categories)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([name, count]) => ({ name, count })),
      // Top 5 countries this entity co-occurs with
      top_countries: Object.entries(e.countries)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([code, count]) => ({ code, count })),
    }))

    const result = {
      success:     true,
      window,
      total_signals_analyzed: rows.length,
      unique_entities:        entities.length,
      entities:               topEntities,
      generated_at:           new Date().toISOString(),
    }

    await redis.setex(cacheKey, 300, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })
}
