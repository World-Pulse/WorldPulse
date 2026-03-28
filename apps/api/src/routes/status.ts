/**
 * GET /api/v1/status
 *
 * Public-facing system status endpoint. No auth required.
 * Returns per-service operational health and overall system status.
 * Cached in Redis for 30 seconds when all services are operational.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { getWsClientCount } from '../ws/handler'

export type ServiceStatus = 'operational' | 'degraded' | 'outage'

export interface ServiceCheck {
  status: ServiceStatus
  latency_ms?: number
  message?: string
}

export interface StatusResponse {
  overall: ServiceStatus
  checked_at: string
  version: string
  uptime_seconds: number
  services: {
    api:       ServiceCheck
    database:  ServiceCheck
    redis:     ServiceCheck
    search:    ServiceCheck
    scraper:   ServiceCheck
    websocket: ServiceCheck
  }
}

const STATUS_CACHE_KEY = 'status:page:cache'
const CACHE_TTL        = 30  // seconds

// ─── Service checks ──────────────────────────────────────────────────────────

export async function checkDatabase(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    await db.raw('SELECT 1')
    const latency_ms = Date.now() - t0
    return {
      status:     latency_ms > 500 ? 'degraded' : 'operational',
      latency_ms,
      ...(latency_ms > 500 ? { message: 'High database latency' } : {}),
    }
  } catch (err) {
    return {
      status:     'outage',
      latency_ms: Date.now() - t0,
      message:    err instanceof Error ? err.message : String(err),
    }
  }
}

export async function checkRedis(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    const pong = await redis.ping()
    const latency_ms = Date.now() - t0
    if (pong !== 'PONG') {
      return { status: 'degraded', latency_ms, message: `Unexpected PING response: ${pong}` }
    }
    return { status: 'operational', latency_ms }
  } catch (err) {
    return {
      status:     'degraded',
      latency_ms: Date.now() - t0,
      message:    err instanceof Error ? err.message : String(err),
    }
  }
}

export async function checkSearch(): Promise<ServiceCheck> {
  const t0 = Date.now()
  const meiliHost = process.env.MEILI_HOST ?? 'http://localhost:7700'
  try {
    const res = await Promise.race([
      fetch(`${meiliHost}/health`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Meilisearch health check timeout (3s)')), 3000),
      ),
    ])
    const latency_ms = Date.now() - t0
    if (!res.ok) {
      return { status: 'degraded', latency_ms, message: `HTTP ${res.status}` }
    }
    const body = await res.json() as { status?: string }
    if (body.status !== 'available') {
      return { status: 'degraded', latency_ms, message: `Meilisearch status: ${body.status ?? 'unknown'}` }
    }
    return { status: 'operational', latency_ms }
  } catch (err) {
    return {
      status:     'degraded',
      latency_ms: Date.now() - t0,
      message:    err instanceof Error ? err.message : String(err),
    }
  }
}

export async function checkScraper(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    // Primary: read scraper stability status key
    const stability = await redis.get('scraper:stability:status')
    if (stability) {
      const parsed = JSON.parse(stability) as { status?: string; message?: string }
      const latency_ms = Date.now() - t0
      const status: ServiceStatus =
        parsed.status === 'healthy'  ? 'operational' :
        parsed.status === 'degraded' ? 'degraded'    : 'outage'
      return { status, latency_ms, ...(parsed.message ? { message: parsed.message } : {}) }
    }

    // Fallback: check scraper health keys
    const keys = await redis.keys('scraper:health:*')
    const latency_ms = Date.now() - t0
    if (keys.length === 0) {
      return { status: 'degraded', latency_ms, message: 'No scraper health data available' }
    }
    return { status: 'operational', latency_ms }
  } catch (err) {
    return {
      status:     'degraded',
      latency_ms: Date.now() - t0,
      message:    err instanceof Error ? err.message : String(err),
    }
  }
}

export function checkWebSocket(): ServiceCheck {
  try {
    // getWsClientCount() is synchronous — throws only if handler isn't initialized
    const count = getWsClientCount()
    return {
      status:  'operational',
      message: `${count} active connection${count !== 1 ? 's' : ''}`,
    }
  } catch {
    return { status: 'degraded', message: 'WebSocket handler not initialized' }
  }
}

// ─── Overall status derivation ───────────────────────────────────────────────

export function deriveOverallStatus(services: Record<string, ServiceCheck>): ServiceStatus {
  const statuses = Object.values(services).map(s => s.status)
  if (statuses.includes('outage'))    return 'outage'
  if (statuses.includes('degraded'))  return 'degraded'
  return 'operational'
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const registerStatusRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: StatusResponse }>(
    '/',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags:        ['status'],
        summary:     'Public system status',
        description: 'Returns real-time operational health of all WorldPulse services. No auth required.',
        response: {
          200: {
            type: 'object',
            properties: {
              overall:        { type: 'string', enum: ['operational', 'degraded', 'outage'] },
              checked_at:     { type: 'string', format: 'date-time' },
              version:        { type: 'string' },
              uptime_seconds: { type: 'number' },
              services: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    status:     { type: 'string' },
                    latency_ms: { type: 'number' },
                    message:    { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      // ── Cache check ────────────────────────────────────────────
      const cached = await redis.get(STATUS_CACHE_KEY).catch(() => null)
      if (cached) {
        return reply
          .header('X-Cache-Hit', 'true')
          .send(JSON.parse(cached) as StatusResponse)
      }

      // ── Run all checks in parallel ─────────────────────────────
      const [dbCheck, redisCheck, searchCheck, scraperCheck] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkSearch(),
        checkScraper(),
      ])
      const wsCheck = checkWebSocket()

      const services: StatusResponse['services'] = {
        api:       { status: 'operational' },
        database:  dbCheck,
        redis:     redisCheck,
        search:    searchCheck,
        scraper:   scraperCheck,
        websocket: wsCheck,
      }

      const overall = deriveOverallStatus(services)

      const body: StatusResponse = {
        overall,
        checked_at:     new Date().toISOString(),
        version:        '1.0.0',
        uptime_seconds: Math.floor(process.uptime()),
        services,
      }

      // ── Cache only when fully operational ─────────────────────
      if (overall === 'operational') {
        redis.setex(STATUS_CACHE_KEY, CACHE_TTL, JSON.stringify(body)).catch(() => {})
      }

      return reply.send(body)
    },
  )
}
