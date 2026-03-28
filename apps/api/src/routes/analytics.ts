import type { FastifyPluginAsync } from 'fastify'
import https from 'node:https'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate } from '../middleware/auth'

const THREAT_INDEX_TTL  = 120  // 2 min cache
const MARKETS_CACHE_TTL = 300  // 5 min cache — respects Yahoo Finance rate limits

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
}
