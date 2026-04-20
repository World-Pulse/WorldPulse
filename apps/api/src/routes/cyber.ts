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
          'original_urls',
          'reliability_score',
          'created_at',
          'tags',
        )
        .where('category', CYBER_CATEGORY)
        .whereRaw(`created_at > now() - interval '${hours} hours'`)
        .orderBy('created_at', 'desc')
        .limit(CYBER_DEFAULT_LIMIT) as Array<{
          id:                string
          title:             string
          summary:           string | null
          severity:          string
          original_urls:     string[] | null
          tags:              string[] | null
          reliability_score: number
          created_at:        string | Date
        }>

      const signals: CyberThreatSignal[] = rows.map(r => {
        const tags = r.tags ?? []
        const slug = tags.includes('cisa') ? 'cisa-kev'
          : tags.includes('otx') ? 'otx-threats'
          : 'unknown'
        return {
        id:                r.id,
        title:             r.title,
        summary:           r.summary ?? '',
        severity:          r.severity,
        source_slug:       slug,
        source_url:        (r.original_urls ?? [])[0] ?? null,
        published_at:      typeof r.created_at === 'string'
          ? r.created_at
          : (r.created_at as Date).toISOString(),
        reliability_score: r.reliability_score,
      }})

      await redis.setex(cacheKey, CYBER_CACHE_TTL, JSON.stringify(signals))

      return reply.send({
        success: true,
        cached:  false,
        data:    { signals, count: signals.length, window: windowParam },
      })
    } catch (err) {
      req.log.error({ err }, '[cyber] DB error (recent)')
      return reply.send({
        success: true,
        cached:  false,
        data:    { signals: [], count: 0, window: windowParam },
      })
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
        .select('severity', 'tags')
        .where('category', CYBER_CATEGORY)
        .whereRaw("created_at > now() - interval '24 hours'")
        .limit(1000) as Array<{
          severity: string
          tags:     string[] | null
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

        const tags = row.tags ?? []
        if (tags.includes('cisa') || tags.includes('kev')) cisa_kev_count++
        else if (tags.includes('otx') || tags.includes('alienvault')) otx_count++

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
      _req.log.error({ err }, '[cyber] DB error (summary)')
      const emptySummary: CyberThreatSummary = {
        total_24h: 0,
        cisa_kev_count: 0,
        otx_count: 0,
        critical_count: 0,
        high_count: 0,
        medium_count: 0,
        low_count: 0,
      }
      return reply.send({ success: true, cached: false, data: emptySummary })
    }
  })
}
