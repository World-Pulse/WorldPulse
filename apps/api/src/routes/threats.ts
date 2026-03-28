/**
 * Missile & Drone Threat Intelligence API
 *
 * Returns missile, drone, and ballistic/hypersonic/rocket threat signals
 * from the last 48 hours, sourced from the signals table.
 *
 * GET /api/v1/threats/missiles
 *   - category IN ('military','conflict','security') with threat keywords in title
 *   - Classifies each signal as 'ballistic' | 'cruise' | 'drone' | 'hypersonic' | 'rocket' | 'unknown'
 *   - Redis-cached for 3 minutes (key: 'threats:missiles')
 *   - Rate limited to 30 req/min
 *
 * GET /api/v1/threats/summary
 *   - AI-style threat digest: severity distribution, type breakdown, top origins/regions
 *   - 6h and 48h windows for trend comparison
 *   - Redis-cached for 5 minutes (key: 'threats:summary')
 *   - Rate limited to 30 req/min
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for threat missile cache: 3 minutes */
export const THREATS_CACHE_TTL = 180

/** Redis TTL for threat summary cache: 5 minutes */
export const THREATS_SUMMARY_CACHE_TTL = 300

/** Rate limit for threat endpoints: requests per minute */
export const THREATS_RATE_LIMIT = 30

/** Redis key for the missile/drone threat cache */
export const THREATS_CACHE_KEY = 'threats:missiles'

/** Redis key for the threat intelligence summary cache */
export const THREATS_SUMMARY_CACHE_KEY = 'threats:summary'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThreatType = 'ballistic' | 'cruise' | 'drone' | 'hypersonic' | 'rocket' | 'unknown'

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'unknown'

export interface MissileThreat {
  id:                string
  title:             string
  lat:               number
  lng:               number
  threat_type:       ThreatType
  origin_country:    string | null
  target_region:     string | null
  severity:          string
  reliability_score: number
  created_at:        string
}

export interface ThreatSummaryEntry {
  id:                string
  title:             string
  threat_type:       ThreatType
  origin_country:    string | null
  severity:          string
  reliability_score: number
  created_at:        string
}

export interface SeverityDistribution {
  critical: number
  high:     number
  medium:   number
  low:      number
  unknown:  number
}

export interface ThreatTypeBreakdown {
  hypersonic: number
  ballistic:  number
  cruise:     number
  drone:      number
  rocket:     number
  unknown:    number
}

export interface CountryCount {
  country: string
  count:   number
}

export interface RegionCount {
  region: string
  count:  number
}

export interface ThreatSummary {
  period_hours:          number
  total_threats_48h:     number
  total_threats_6h:      number
  trend_direction:       'escalating' | 'stable' | 'de-escalating'
  severity_distribution: SeverityDistribution
  threat_type_breakdown: ThreatTypeBreakdown
  top_origin_countries:  CountryCount[]
  top_target_regions:    RegionCount[]
  highest_severity:      ThreatSummaryEntry[]
  active_digest:         string
  generated_at:          string
}

// ─── Keyword banks ────────────────────────────────────────────────────────────

const BALLISTIC_KW  = ['icbm', 'ballistic missile', 'shahab', 'hwasong', 'df-41', 'df-5']
const CRUISE_KW     = ['tomahawk', 'kalibr', 'scalp', 'storm shadow', 'cruise missile']
const DRONE_KW      = ['drone', 'uav', 'shahed', 'bayraktar', 'ucav', 'kamikaze drone']
const HYPERSONIC_KW = ['hypersonic', 'zircon', 'kinzhal', 'df-17', 'avangard']
const ROCKET_KW     = ['rocket', 'qassam', 'katyusha', 'grad', 'rpg', 'mortar']

// ─── Summary helpers (exported for unit tests) ────────────────────────────────

/**
 * Build severity distribution counts from a list of severity strings.
 * Maps 'critical'|'high'|'medium'|'low' to SeverityDistribution.
 */
export function buildSeverityDistribution(severities: string[]): SeverityDistribution {
  const dist: SeverityDistribution = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }
  for (const s of severities) {
    const key = s.toLowerCase() as SeverityLevel
    if (key === 'critical' || key === 'high' || key === 'medium' || key === 'low') {
      dist[key]++
    } else {
      dist.unknown++
    }
  }
  return dist
}

/**
 * Build threat type breakdown counts from a list of ThreatType values.
 */
export function buildThreatTypeBreakdown(types: ThreatType[]): ThreatTypeBreakdown {
  const bd: ThreatTypeBreakdown = { hypersonic: 0, ballistic: 0, cruise: 0, drone: 0, rocket: 0, unknown: 0 }
  for (const t of types) {
    bd[t]++
  }
  return bd
}

/**
 * Derive trend direction by comparing 6h count to the 48h hourly average.
 * escalating  = 6h rate > 2× average
 * de-escalating = 6h rate < 0.5× average
 * stable      = otherwise
 */
export function deriveTrendDirection(
  count48h: number,
  count6h:  number,
): 'escalating' | 'stable' | 'de-escalating' {
  if (count48h === 0) return 'stable'
  const hourlyAvg = count48h / 48
  const recent6hRate = count6h / 6
  if (recent6hRate > hourlyAvg * 2) return 'escalating'
  if (recent6hRate < hourlyAvg * 0.5 && count6h < count48h / 8) return 'de-escalating'
  return 'stable'
}

/**
 * Build a plain-English active digest from summary stats.
 * Used in the summary payload to give analysts a quick sentence.
 */
export function buildActiveDigest(summary: {
  total_threats_48h:     number
  total_threats_6h:      number
  trend_direction:       string
  threat_type_breakdown: ThreatTypeBreakdown
  top_origin_countries:  CountryCount[]
}): string {
  const { total_threats_48h, total_threats_6h, trend_direction, threat_type_breakdown, top_origin_countries } = summary

  if (total_threats_48h === 0) {
    return 'No threat signals detected in the last 48 hours.'
  }

  // dominant threat type
  const dominantType = (Object.entries(threat_type_breakdown) as [ThreatType, number][])
    .filter(([k]) => k !== 'unknown')
    .sort(([, a], [, b]) => b - a)[0]

  const typeLabel = dominantType ? `${dominantType[1]} ${dominantType[0]} signals` : `${total_threats_48h} signals`
  const topCountry = top_origin_countries[0]?.country ?? null
  const originClause = topCountry ? ` primarily attributed to ${topCountry}` : ''
  const trendClause = trend_direction === 'escalating'
    ? ` (⬆ escalating — ${total_threats_6h} signals in last 6h)`
    : trend_direction === 'de-escalating'
      ? ` (⬇ de-escalating — ${total_threats_6h} signals in last 6h)`
      : ` (stable — ${total_threats_6h} signals in last 6h)`

  return `${typeLabel} detected in 48h${originClause}${trendClause}. Total signals: ${total_threats_48h}.`
}

// ─── Threat classification helpers (exported for unit tests) ──────────────────

/**
 * Classify a signal title into a specific missile/drone threat type.
 * Precedence: hypersonic > ballistic > cruise > drone > rocket > unknown
 */
export function classifyThreatType(title: string): ThreatType {
  const lower = title.toLowerCase()

  if (HYPERSONIC_KW.some(kw => lower.includes(kw))) return 'hypersonic'
  if (BALLISTIC_KW.some(kw  => lower.includes(kw))) return 'ballistic'
  if (CRUISE_KW.some(kw     => lower.includes(kw))) return 'cruise'
  if (DRONE_KW.some(kw      => lower.includes(kw))) return 'drone'
  if (ROCKET_KW.some(kw     => lower.includes(kw))) return 'rocket'

  return 'unknown'
}

/**
 * Attempt to parse the origin country from the signal title using common
 * state actor and proxy names. Returns null when no known origin is detected.
 */
export function parseThreatOrigin(title: string): string | null {
  const lower = title.toLowerCase()

  if (lower.includes('russia') || lower.includes('russian') || lower.includes('kremlin')) return 'Russia'
  if (lower.includes('iran') || lower.includes('iranian') || lower.includes('irgc'))      return 'Iran'
  if (
    lower.includes('north korea') ||
    lower.includes('dprk') ||
    lower.includes('pyongyang') ||
    lower.includes('kim jong')
  ) return 'North Korea'
  if (lower.includes('china') || lower.includes('chinese') || lower.includes('pla'))      return 'China'
  if (lower.includes('ukraine') || lower.includes('ukrainian'))                            return 'Ukraine'
  if (lower.includes('israel') || lower.includes('idf'))                                   return 'Israel'
  if (lower.includes('hamas') || lower.includes('hezbollah') || lower.includes('houthi')) return 'Non-State Actor'

  return null
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerThreatsRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['threats']
  })

  // ── GET /missiles ──────────────────────────────────────────────────────────

  app.get('/missiles', {
    config: {
      rateLimit: {
        max:        THREATS_RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags:    ['threats'],
      summary: 'Missile and drone threat signals from the last 48 hours',
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
                required: ['id', 'title', 'lat', 'lng', 'threat_type', 'severity', 'created_at'],
                properties: {
                  id:                { type: 'string' },
                  title:             { type: 'string' },
                  lat:               { type: 'number' },
                  lng:               { type: 'number' },
                  threat_type:       { type: 'string', enum: ['ballistic', 'cruise', 'drone', 'hypersonic', 'rocket', 'unknown'] },
                  origin_country:    { type: ['string', 'null'] },
                  target_region:     { type: ['string', 'null'] },
                  severity:          { type: 'string' },
                  reliability_score: { type: 'number' },
                  created_at:        { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    // ── Cache check ────────────────────────────────────────────────────────
    const cached = await redis.get(THREATS_CACHE_KEY)
    if (cached) {
      const threats = JSON.parse(cached) as MissileThreat[]
      return reply.send({ success: true, cached: true, data: threats })
    }

    // ── DB query ───────────────────────────────────────────────────────────
    const rows = await db('signals')
      .select(
        'id',
        'title',
        'severity',
        'reliability_score',
        'location_name',
        'created_at',
        db.raw('ST_X(location::geometry) as lng'),
        db.raw('ST_Y(location::geometry) as lat'),
      )
      .whereIn('category', ['military', 'conflict', 'security'])
      .whereRaw(`(
        title ILIKE '%missile%'
        OR title ILIKE '%drone%'
        OR title ILIKE '%UAV%'
        OR title ILIKE '%ICBM%'
        OR title ILIKE '%rocket%'
        OR title ILIKE '%ballistic%'
        OR title ILIKE '%hypersonic%'
      )`)
      .whereRaw("created_at > NOW() - INTERVAL '48 hours'")
      .orderBy('created_at', 'desc')
      .limit(300) as Array<{
        id:                string
        title:             string
        severity:          string
        reliability_score: number | null
        location_name:     string | null
        created_at:        string | Date
        lat:               number | null
        lng:               number | null
      }>

    const threats: MissileThreat[] = rows
      .filter(row => row.lat != null && row.lng != null)
      .map(row => ({
        id:                row.id,
        title:             row.title,
        lat:               row.lat!,
        lng:               row.lng!,
        threat_type:       classifyThreatType(row.title),
        origin_country:    parseThreatOrigin(row.title),
        target_region:     row.location_name ?? null,
        severity:          row.severity,
        reliability_score: row.reliability_score ?? 0,
        created_at:        typeof row.created_at === 'string'
          ? row.created_at
          : (row.created_at as Date).toISOString(),
      }))

    // ── Cache and respond ──────────────────────────────────────────────────
    await redis.setex(THREATS_CACHE_KEY, THREATS_CACHE_TTL, JSON.stringify(threats))

    return reply.send({ success: true, cached: false, data: threats })
  })

  // ── GET /summary ───────────────────────────────────────────────────────────

  app.get('/summary', {
    config: {
      rateLimit: {
        max:        THREATS_RATE_LIMIT,
        timeWindow: '1 minute',
      },
    },
    schema: {
      tags:    ['threats'],
      summary: 'AI-style threat intelligence digest — severity, type breakdown, top origins, trend direction',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cached:  { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                period_hours:      { type: 'number' },
                total_threats_48h: { type: 'number' },
                total_threats_6h:  { type: 'number' },
                trend_direction:   { type: 'string', enum: ['escalating', 'stable', 'de-escalating'] },
                severity_distribution: {
                  type: 'object',
                  properties: {
                    critical: { type: 'number' },
                    high:     { type: 'number' },
                    medium:   { type: 'number' },
                    low:      { type: 'number' },
                    unknown:  { type: 'number' },
                  },
                },
                threat_type_breakdown: {
                  type: 'object',
                  properties: {
                    hypersonic: { type: 'number' },
                    ballistic:  { type: 'number' },
                    cruise:     { type: 'number' },
                    drone:      { type: 'number' },
                    rocket:     { type: 'number' },
                    unknown:    { type: 'number' },
                  },
                },
                top_origin_countries: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      country: { type: 'string' },
                      count:   { type: 'number' },
                    },
                  },
                },
                top_target_regions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      region: { type: 'string' },
                      count:  { type: 'number' },
                    },
                  },
                },
                highest_severity: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id:                { type: 'string' },
                      title:             { type: 'string' },
                      threat_type:       { type: 'string' },
                      origin_country:    { type: ['string', 'null'] },
                      severity:          { type: 'string' },
                      reliability_score: { type: 'number' },
                      created_at:        { type: 'string' },
                    },
                  },
                },
                active_digest:  { type: 'string' },
                generated_at:   { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    // ── Cache check ────────────────────────────────────────────────────────
    const cached = await redis.get(THREATS_SUMMARY_CACHE_KEY)
    if (cached) {
      const summary = JSON.parse(cached) as ThreatSummary
      return reply.send({ success: true, cached: true, data: summary })
    }

    // ── DB: fetch 48h threat signals ───────────────────────────────────────
    const rows = await db('signals')
      .select('id', 'title', 'severity', 'reliability_score', 'location_name', 'created_at')
      .whereIn('category', ['military', 'conflict', 'security'])
      .whereRaw(`(
        title ILIKE '%missile%'
        OR title ILIKE '%drone%'
        OR title ILIKE '%UAV%'
        OR title ILIKE '%ICBM%'
        OR title ILIKE '%rocket%'
        OR title ILIKE '%ballistic%'
        OR title ILIKE '%hypersonic%'
      )`)
      .whereRaw("created_at > NOW() - INTERVAL '48 hours'")
      .orderBy('created_at', 'desc')
      .limit(500) as Array<{
        id:                string
        title:             string
        severity:          string
        reliability_score: number | null
        location_name:     string | null
        created_at:        string | Date
      }>

    const cutoff6h = new Date(Date.now() - 6 * 60 * 60 * 1000)

    // ── Classify and aggregate ─────────────────────────────────────────────
    const threats6h: typeof rows = []
    const severities: string[]  = []
    const types: ThreatType[]   = []
    const originCounts: Record<string, number> = {}
    const regionCounts: Record<string, number> = {}

    for (const row of rows) {
      const ts = typeof row.created_at === 'string' ? new Date(row.created_at) : row.created_at
      if (ts >= cutoff6h) threats6h.push(row)

      severities.push(row.severity)
      types.push(classifyThreatType(row.title))

      const origin = parseThreatOrigin(row.title)
      if (origin) originCounts[origin] = (originCounts[origin] ?? 0) + 1

      const region = row.location_name
      if (region) regionCounts[region] = (regionCounts[region] ?? 0) + 1
    }

    const severityDist = buildSeverityDistribution(severities)
    const typeBreakdown = buildThreatTypeBreakdown(types)
    const trendDir = deriveTrendDirection(rows.length, threats6h.length)

    const topOrigins: CountryCount[] = Object.entries(originCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([country, count]) => ({ country, count }))

    const topRegions: RegionCount[] = Object.entries(regionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([region, count]) => ({ region, count }))

    // Top 5 highest-severity threats (critical → high → medium → ...)
    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const highestSeverity: ThreatSummaryEntry[] = rows
      .slice()
      .sort((a, b) => {
        const ra = severityRank[a.severity?.toLowerCase() ?? ''] ?? 99
        const rb = severityRank[b.severity?.toLowerCase() ?? ''] ?? 99
        return ra - rb
      })
      .slice(0, 5)
      .map(row => ({
        id:                row.id,
        title:             row.title,
        threat_type:       classifyThreatType(row.title),
        origin_country:    parseThreatOrigin(row.title),
        severity:          row.severity,
        reliability_score: row.reliability_score ?? 0,
        created_at:        typeof row.created_at === 'string'
          ? row.created_at
          : (row.created_at as Date).toISOString(),
      }))

    const activeDigest = buildActiveDigest({
      total_threats_48h:     rows.length,
      total_threats_6h:      threats6h.length,
      trend_direction:       trendDir,
      threat_type_breakdown: typeBreakdown,
      top_origin_countries:  topOrigins,
    })

    const summary: ThreatSummary = {
      period_hours:          48,
      total_threats_48h:     rows.length,
      total_threats_6h:      threats6h.length,
      trend_direction:       trendDir,
      severity_distribution: severityDist,
      threat_type_breakdown: typeBreakdown,
      top_origin_countries:  topOrigins,
      top_target_regions:    topRegions,
      highest_severity:      highestSeverity,
      active_digest:         activeDigest,
      generated_at:          new Date().toISOString(),
    }

    // ── Cache and respond ──────────────────────────────────────────────────
    await redis.setex(THREATS_SUMMARY_CACHE_KEY, THREATS_SUMMARY_CACHE_TTL, JSON.stringify(summary))

    return reply.send({ success: true, cached: false, data: summary })
  })
}
