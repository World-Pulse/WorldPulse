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
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for threat missile cache: 3 minutes */
export const THREATS_CACHE_TTL = 180

/** Rate limit for threat endpoints: requests per minute */
export const THREATS_RATE_LIMIT = 30

/** Redis key for the missile/drone threat cache */
export const THREATS_CACHE_KEY = 'threats:missiles'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThreatType = 'ballistic' | 'cruise' | 'drone' | 'hypersonic' | 'rocket' | 'unknown'

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

// ─── Keyword banks ────────────────────────────────────────────────────────────

const BALLISTIC_KW  = ['icbm', 'ballistic missile', 'shahab', 'hwasong', 'df-41', 'df-5']
const CRUISE_KW     = ['tomahawk', 'kalibr', 'scalp', 'storm shadow', 'cruise missile']
const DRONE_KW      = ['drone', 'uav', 'shahed', 'bayraktar', 'ucav', 'kamikaze drone']
const HYPERSONIC_KW = ['hypersonic', 'zircon', 'kinzhal', 'df-17', 'avangard']
const ROCKET_KW     = ['rocket', 'qassam', 'katyusha', 'grad', 'rpg', 'mortar']

// ─── Helpers (exported for unit tests) ───────────────────────────────────────

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
}
