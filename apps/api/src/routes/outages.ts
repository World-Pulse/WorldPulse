/**
 * Internet Outage Intelligence API
 *
 * Exposes IODA (Internet Outage Detection and Analysis) signals ingested by
 * the scraper as structured intelligence endpoints.
 *
 * Endpoints:
 *   GET /api/v1/outages/recent   — recent internet outage events (last N hours)
 *   GET /api/v1/outages/summary  — country-level connectivity summary (active outages)
 *
 * IODA source: Georgia Tech IODA API (api.ioda.caida.org)
 * Reliability: 0.87 (BGP + active probing + telescope signals)
 *
 * Counters OpenClaw's internet outage monitoring feature (terminal-only) with
 * a full web UI. Unique among news intelligence platforms — Ground News, GDELT,
 * Reuters Connect, AP Wire, and NewsGuard have no internet connectivity monitoring.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'

// ─── Constants ────────────────────────────────────────────────────────────────

const OUTAGES_CACHE_TTL         = 120          // 2 min cache (IODA updates every 10 min)
const SUMMARY_CACHE_TTL         = 300          // 5 min cache for summary
const OUTAGES_RATE_LIMIT        = 60
const OUTAGES_DEFAULT_HOURS     = 48
const OUTAGES_MAX_HOURS         = 720
const IODA_SOURCE_ID            = 'ioda'
const CACHE_KEY_RECENT          = 'outages:recent'
const CACHE_KEY_SUMMARY         = 'outages:summary'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutageEvent {
  id:                string
  title:             string
  summary:           string
  severity:          string
  location_name:     string
  country_code:      string | null
  lat:               number | null
  lng:               number | null
  published_at:      string
  reliability_score: number
  source_url:        string | null
}

export interface CountryOutageStatus {
  location_name:  string
  country_code:   string | null
  severity:       string         // worst active severity
  event_count:    number
  latest_at:      string
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerOutagesRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['outages']
  })

  // ── GET /recent ────────────────────────────────────────────────────────────

  app.get('/recent', {
    config: {
      rateLimit: { max: OUTAGES_RATE_LIMIT, timeWindow: '1 minute' },
    },
    schema: {
      tags:    ['outages'],
      summary: 'Recent internet outage events (IODA-sourced)',
      querystring: {
        type: 'object',
        properties: {
          hours:    { type: 'number', description: 'Hours to look back (1-720, default 48)' },
          severity: { type: 'string', description: 'Filter by minimum severity: critical|high|medium|low' },
          limit:    { type: 'number', description: 'Max results (1-200, default 100)' },
        },
      },
    },
  }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>

    // Parse hours
    let hours = OUTAGES_DEFAULT_HOURS
    if (q.hours !== undefined) {
      const h = Number(q.hours)
      if (!isFinite(h) || h < 1 || h > OUTAGES_MAX_HOURS) {
        return reply.status(400).send({ success: false, error: `hours must be 1-${OUTAGES_MAX_HOURS}`, code: 'INVALID_HOURS' })
      }
      hours = h
    }

    // Parse limit
    let limit = 100
    if (q.limit !== undefined) {
      const l = Number(q.limit)
      if (!isFinite(l) || l < 1 || l > 200) {
        return reply.status(400).send({ success: false, error: 'limit must be 1-200', code: 'INVALID_LIMIT' })
      }
      limit = l
    }

    const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']
    const minSeverity: string | null = typeof q.severity === 'string' && SEVERITY_ORDER.includes(q.severity)
      ? q.severity
      : null

    const cacheKey = `${CACHE_KEY_RECENT}:${hours}:${minSeverity ?? 'all'}:${limit}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      const events = JSON.parse(cached) as OutageEvent[]
      return reply.send({ success: true, cached: true, data: { events, count: events.length, hours } })
    }

    try {
      let query = db('signals')
        .select(
          'id', 'title', 'summary', 'severity', 'location_name', 'source_url',
          'reliability_score', 'published_at',
          db.raw('ST_X(location::geometry) as lng'),
          db.raw('ST_Y(location::geometry) as lat'),
        )
        .where('source_id', IODA_SOURCE_ID)
        .whereRaw(`published_at > now() - interval '${hours} hours'`)
        .orderBy('published_at', 'desc')
        .limit(limit)

      if (minSeverity) {
        const minIdx = SEVERITY_ORDER.indexOf(minSeverity)
        const allowed = SEVERITY_ORDER.slice(0, minIdx + 1)
        query = query.whereIn('severity', allowed)
      }

      const rows = await query as Array<{
        id: string; title: string; summary: string; severity: string
        location_name: string | null; source_url: string | null
        reliability_score: number; published_at: string | Date
        lat: number | null; lng: number | null
      }>

      const events: OutageEvent[] = rows.map(r => ({
        id:                r.id,
        title:             r.title,
        summary:           r.summary ?? '',
        severity:          r.severity,
        location_name:     r.location_name ?? 'Unknown region',
        country_code:      extractCountryCode(r.location_name ?? ''),
        lat:               typeof r.lat === 'number' && isFinite(r.lat) ? r.lat : null,
        lng:               typeof r.lng === 'number' && isFinite(r.lng) ? r.lng : null,
        published_at:      typeof r.published_at === 'string' ? r.published_at : (r.published_at as Date).toISOString(),
        reliability_score: r.reliability_score,
        source_url:        r.source_url,
      }))

      await redis.setex(cacheKey, OUTAGES_CACHE_TTL, JSON.stringify(events))

      return reply.send({ success: true, cached: false, data: { events, count: events.length, hours } })
    } catch (err) {
      console.error('[outages] DB error (recent):', err)
      return reply.status(500).send({ success: false, error: 'Database error', code: 'DB_ERROR' })
    }
  })

  // ── GET /summary ──────────────────────────────────────────────────────────

  app.get('/summary', {
    config: {
      rateLimit: { max: OUTAGES_RATE_LIMIT, timeWindow: '1 minute' },
    },
    schema: {
      tags:    ['outages'],
      summary: 'Country-level internet connectivity summary (active outages in last 24h)',
    },
  }, async (_req, reply) => {
    const cached = await redis.get(CACHE_KEY_SUMMARY)
    if (cached) {
      const countries = JSON.parse(cached) as CountryOutageStatus[]
      return reply.send({ success: true, cached: true, data: { countries, count: countries.length } })
    }

    try {
      const rows = await db('signals')
        .select(
          db.raw('location_name'),
          db.raw(`
            CASE
              WHEN bool_or(severity = 'critical') THEN 'critical'
              WHEN bool_or(severity = 'high')     THEN 'high'
              WHEN bool_or(severity = 'medium')   THEN 'medium'
              ELSE 'low'
            END as worst_severity
          `),
          db.raw('count(*) as event_count'),
          db.raw('max(published_at) as latest_at'),
        )
        .where('source_id', IODA_SOURCE_ID)
        .whereNotNull('location_name')
        .whereRaw("published_at > now() - interval '24 hours'")
        .groupBy('location_name')
        .orderByRaw(`
          CASE
            WHEN bool_or(severity = 'critical') THEN 1
            WHEN bool_or(severity = 'high')     THEN 2
            WHEN bool_or(severity = 'medium')   THEN 3
            ELSE 4
          END ASC
        `)
        .limit(50) as Array<{
          location_name: string
          worst_severity: string
          event_count: string | number
          latest_at: string | Date
        }>

      const countries: CountryOutageStatus[] = rows.map(r => ({
        location_name: r.location_name,
        country_code:  extractCountryCode(r.location_name),
        severity:      r.worst_severity,
        event_count:   typeof r.event_count === 'number' ? r.event_count : parseInt(String(r.event_count), 10),
        latest_at:     typeof r.latest_at === 'string' ? r.latest_at : (r.latest_at as Date).toISOString(),
      }))

      await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(countries))

      return reply.send({ success: true, cached: false, data: { countries, count: countries.length } })
    } catch (err) {
      console.error('[outages] DB error (summary):', err)
      return reply.status(500).send({ success: false, error: 'Database error', code: 'DB_ERROR' })
    }
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Attempts to extract a 2-letter ISO country code from a location_name string
 * like "Iran" → "IR", "Russia" → "RU".
 * Returns null if not recognized.
 */
function extractCountryCode(locationName: string): string | null {
  const s = locationName.toLowerCase().trim()
  const MAP: Record<string, string> = {
    'afghanistan': 'AF', 'albania': 'AL', 'algeria': 'DZ', 'angola': 'AO',
    'argentina': 'AR', 'armenia': 'AM', 'australia': 'AU', 'austria': 'AT',
    'azerbaijan': 'AZ', 'bangladesh': 'BD', 'belarus': 'BY', 'belgium': 'BE',
    'bolivia': 'BO', 'bosnia': 'BA', 'brazil': 'BR', 'bulgaria': 'BG',
    'cambodia': 'KH', 'cameroon': 'CM', 'canada': 'CA', 'chad': 'TD',
    'chile': 'CL', 'china': 'CN', 'colombia': 'CO', 'congo': 'CD',
    'croatia': 'HR', 'cuba': 'CU', 'czech': 'CZ', 'denmark': 'DK',
    'ecuador': 'EC', 'egypt': 'EG', 'eritrea': 'ER', 'ethiopia': 'ET',
    'finland': 'FI', 'france': 'FR', 'georgia': 'GE', 'germany': 'DE',
    'ghana': 'GH', 'greece': 'GR', 'guatemala': 'GT', 'guinea': 'GN',
    'haiti': 'HT', 'honduras': 'HN', 'hungary': 'HU', 'india': 'IN',
    'indonesia': 'ID', 'iran': 'IR', 'iraq': 'IQ', 'ireland': 'IE',
    'israel': 'IL', 'italy': 'IT', 'ivory coast': 'CI', 'jamaica': 'JM',
    'japan': 'JP', 'jordan': 'JO', 'kazakhstan': 'KZ', 'kenya': 'KE',
    'kosovo': 'XK', 'kyrgyzstan': 'KG', 'laos': 'LA', 'latvia': 'LV',
    'lebanon': 'LB', 'libya': 'LY', 'lithuania': 'LT', 'malaysia': 'MY',
    'mali': 'ML', 'mexico': 'MX', 'moldova': 'MD', 'mongolia': 'MN',
    'morocco': 'MA', 'mozambique': 'MZ', 'myanmar': 'MM', 'nepal': 'NP',
    'netherlands': 'NL', 'nicaragua': 'NI', 'nigeria': 'NG', 'north korea': 'KP',
    'norway': 'NO', 'pakistan': 'PK', 'palestine': 'PS', 'panama': 'PA',
    'peru': 'PE', 'philippines': 'PH', 'poland': 'PL', 'portugal': 'PT',
    'romania': 'RO', 'russia': 'RU', 'rwanda': 'RW', 'saudi arabia': 'SA',
    'senegal': 'SN', 'serbia': 'RS', 'sierra leone': 'SL', 'somalia': 'SO',
    'south africa': 'ZA', 'south korea': 'KR', 'south sudan': 'SS', 'spain': 'ES',
    'sri lanka': 'LK', 'sudan': 'SD', 'sweden': 'SE', 'switzerland': 'CH',
    'syria': 'SY', 'taiwan': 'TW', 'tajikistan': 'TJ', 'tanzania': 'TZ',
    'thailand': 'TH', 'togo': 'TG', 'tunisia': 'TN', 'turkey': 'TR',
    'turkmenistan': 'TM', 'uganda': 'UG', 'ukraine': 'UA', 'united arab emirates': 'AE',
    'united kingdom': 'GB', 'united states': 'US', 'uruguay': 'UY',
    'uzbekistan': 'UZ', 'venezuela': 'VE', 'vietnam': 'VN', 'yemen': 'YE',
    'zambia': 'ZM', 'zimbabwe': 'ZW',
  }
  for (const [key, code] of Object.entries(MAP)) {
    if (s.includes(key)) return code
  }
  return null
}
