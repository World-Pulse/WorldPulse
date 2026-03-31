/**
 * Cyber Threat Intelligence API
 *
 * Exposes CISA Known Exploited Vulnerabilities (cisa-kev) and AlienVault OTX
 * threat pulses (otx-threats) as structured intelligence endpoints.
 *
 * Endpoints:
 *   GET /api/v1/cyber/recent   — recent cyber threat signals (last 24h/48h/7d)
 *   GET /api/v1/cyber/summary  — severity breakdown + per-source counts (last 24h)
 *
 * Sources:
 *   - CISA KEV (source_id='cisa-kev'):   Known Exploited Vulnerabilities, reliability=0.95
 *   - AlienVault OTX (source_id='otx-threats'): Threat pulses, reliability=0.82
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for recent events cache: 3 minutes */
const CYBER_CACHE_TTL      = 180

/** Redis TTL for summary cache: 3 minutes */
const SUMMARY_CACHE_TTL    = 180

/** Rate limit: requests per minute */
const CYBER_RATE_LIMIT     = 60

/** Default result limit */
const CYBER_DEFAULT_LIMIT  = 100

/** Category used to find cyber signals */
const CYBER_CATEGORY       = 'security'

/** Source slugs for cyber threat data */
const CISA_KEV_SOURCE      = 'cisa-kev'
const OTX_SOURCE           = 'otx-threats'

/** Redis cache key prefix for recent events */
const CACHE_KEY_RECENT     = 'cyber:recent'

/** Redis cache key for summary */
const CACHE_KEY_SUMMARY    = 'cyber:summary'

/** Accepted time window values and their hour equivalents */
const WINDOW_HOURS: Record<string, number> = {
  '24h': 24,
  '48h': 48,
  '7d':  168,
}

/** Ordered severity levels (highest → lowest) */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CyberThreatSignal {
  id:                string
  title:             string
  summary:           string
  severity:          string
  reliability_score: number
  source_url:        string | null
  published_at:      string
  source_slug:       string
}

export interface CyberThreatSummary {
  total_24h:       number
  cisa_kev_count:  number
  otx_count:       number
  critical_count:  number
  high_count:      number
  medium_count:    number
  low_count:       number
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerCyberRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['cyber']
  })

  // ── GET /recent ────────────────────────────────────────────────────────────

  app.get('/recent', {
    config: {
      rateLimit: { max: CYBER_RATE_LIMIT, timeWindow: '1 minute' },
    },
    schema: {
      tags:    ['cyber'],
      summary: 'Recent cyber threat signals — CISA KEV vulnerabilities + AlienVault OTX pulses',
      querystring: {
        type: 'object',
        properties: {
          window: { type: 'string', description: 'Time window: 24h | 48h | 7d (default 24h)' },
        },
      },
    },
  }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>

    // ── Parse window ─────────────────────────────────────────────────────────
    const windowParam = typeof q.window === 'string' ? q.window : '24h'
    if (!(windowParam in WINDOW_HOURS)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'window must be one of: 24h, 48h, 7d')
    }
    const hours = WINDOW_HOURS[windowParam] as number

    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = `${CACHE_KEY_RECENT}:${windowParam}`
    const cachedRaw = await redis.get(cacheKey)
    if (cachedRaw) {
      const signals = JSON.parse(cachedRaw) as CyberThreatSignal[]
      return reply.send({
        success: true,
        cached:  true,
        data:    { signals, count: signals.length, window: windowParam },
      })
    }

    // ── DB query ─────────────────────────────────────────────────────────────
    try {
      const rows = await db('signals')
        .select(
          'id',
          'title',
          'summary',
          'severity',
          'source_url',
          'reliability_score',
          'published_at',
          'source_id as source_slug',
        )
        .where('category', CYBER_CATEGORY)
        .whereRaw(`published_at > now() - interval '${hours} hours'`)
        .orderBy('published_at', 'desc')
        .limit(CYBER_DEFAULT_LIMIT) as Array<{
          id:                string
          title:             string
          summary:           string | null
          severity:          string
          source_url:        string | null
          source_slug:       string
          reliability_score: number
          published_at:      string | Date
        }>

      const signals: CyberThreatSignal[] = rows.map(r => ({
        id:                r.id,
        title:             r.title,
        summary:           r.summary ?? '',
        severity:          r.severity,
        source_slug:       r.source_slug,
        source_url:        r.source_url,
        published_at:      typeof r.published_at === 'string'
          ? r.published_at
          : (r.published_at as Date).toISOString(),
        reliability_score: r.reliability_score,
      }))

      await redis.setex(cacheKey, CYBER_CACHE_TTL, JSON.stringify(signals))

      return reply.send({
        success: true,
        cached:  false,
        data:    { signals, count: signals.length, window: windowParam },
      })
    } catch (err) {
      console.error('[cyber] DB error (recent):', err)
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Database error')
    }
  })

  // ── GET /summary ───────────────────────────────────────────────────────────

  app.get('/summary', {
    config: {
      rateLimit: { max: CYBER_RATE_LIMIT, timeWindow: '1 minute' },
    },
    schema: {
      tags:    ['cyber'],
      summary: 'Cyber threat summary — severity breakdown + per-source counts for last 24h',
    },
  }, async (_req, reply) => {

    // ── Cache check ──────────────────────────────────────────────────────────
    const cachedRaw = await redis.get(CACHE_KEY_SUMMARY)
    if (cachedRaw) {
      const summary = JSON.parse(cachedRaw) as CyberThreatSummary
      return reply.send({ success: true, cached: true, data: summary })
    }

    // ── DB query ─────────────────────────────────────────────────────────────
    try {
      const rows = await db('signals')
        .select('severity', 'source_id')
        .where('category', CYBER_CATEGORY)
        .whereRaw("published_at > now() - interval '24 hours'")
        .limit(1000) as Array<{
          severity:  string
          source_id: string
        }>

      let total_24h      = 0
      let cisa_kev_count = 0
      let otx_count      = 0
      let critical_count = 0
      let high_count     = 0
      let medium_count   = 0
      let low_count      = 0

      for (const row of rows) {
        total_24h++

        if (row.source_id === CISA_KEV_SOURCE) cisa_kev_count++
        else if (row.source_id === OTX_SOURCE)  otx_count++

        const sev = SEVERITY_ORDER.includes(row.severity) ? row.severity : 'low'
        if (sev === 'critical')      critical_count++
        else if (sev === 'high')     high_count++
        else if (sev === 'medium')   medium_count++
        else                         low_count++
      }

      const summary: CyberThreatSummary = {
        total_24h,
        cisa_kev_count,
        otx_count,
        critical_count,
        high_count,
        medium_count,
        low_count,
      }

      await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(summary))

      return reply.send({ success: true, cached: false, data: summary })
    } catch (err) {
      console.error('[cyber] DB error (summary):', err)
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Database error')
    }
  })
}
