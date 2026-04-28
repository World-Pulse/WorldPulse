/**
 * GET /api/v1/health
 *
 * Enhanced health endpoint returning per-service status.
 * Format: { status, version, uptime_s, timestamp, services: { db, redis, kafka } }
 * Each service: { status: 'ok' | 'degraded' | 'down', latency_ms?: number, error?: string }
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { Kafka } from 'kafkajs'
import { getSearchAvgLatencyMs } from '../lib/search-latency'
import { getSecurityMetrics, type SecurityMetrics } from '../lib/security'
import { getLagSummary, type LagSummary } from '../lib/kafka-lag'

type ServiceStatus = 'ok' | 'degraded' | 'down'

interface ServiceCheck {
  status: ServiceStatus
  latency_ms?: number
  error?: string
}

interface HealthResponse {
  status: ServiceStatus
  version: string
  uptime_s: number
  timestamp: string
  map_signals_with_geo: number
  /** Gate 3: 5-minute exponential moving average of search endpoint latency (ms).
   *  Null when no searches have been made recently. */
  search_avg_latency_ms: number | null
  /** Gate 6: Security event counters and lockout status. */
  security: SecurityMetrics | null
  /** Kafka consumer group lag summary. */
  kafka_consumer_lag: {
    total_lag:      number
    overall_status: LagSummary['overall_status']
    groups: Array<{
      groupId:  string
      totalLag: number
      status:   'healthy' | 'warning' | 'critical'
    }>
  } | null
  services: {
    db: ServiceCheck
    redis: ServiceCheck
    kafka: ServiceCheck
  }
}

// Lazy Kafka admin for health checks (reuse client config)
let _kafkaAdmin: ReturnType<InstanceType<typeof Kafka>['admin']> | null = null

function getKafkaAdmin() {
  if (!_kafkaAdmin) {
    const kafka = new Kafka({
      clientId: 'wp-api-health',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
      retry: { retries: 0, initialRetryTime: 100 },
    })
    _kafkaAdmin = kafka.admin()
  }
  return _kafkaAdmin
}

async function checkDb(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    await db.raw('SELECT 1')
    return { status: 'ok', latency_ms: Date.now() - t0 }
  } catch (err) {
    return {
      status: 'down',
      latency_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkRedis(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    const pong = await redis.ping()
    if (pong !== 'PONG') return { status: 'degraded', latency_ms: Date.now() - t0, error: `Unexpected PING response: ${pong}` }
    return { status: 'ok', latency_ms: Date.now() - t0 }
  } catch (err) {
    return {
      status: 'down',
      latency_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkKafka(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    const admin = getKafkaAdmin()
    // connect() is idempotent — reuses the connection if already open
    await Promise.race([
      admin.connect().then(() => admin.listTopics()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Kafka health check timeout (2s)')), 2000),
      ),
    ])
    return { status: 'ok', latency_ms: Date.now() - t0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Kafka being down is degraded (not critical), since the API runs without it
    return { status: 'degraded', latency_ms: Date.now() - t0, error: msg }
  }
}

function deriveOverallStatus(checks: Record<string, ServiceCheck>): ServiceStatus {
  const statuses = Object.values(checks).map(c => c.status)
  if (statuses.includes('down')) return 'down'
  if (statuses.includes('degraded')) return 'degraded'
  return 'ok'
}

export const registerHealthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: HealthResponse }>(
    '/',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['health'],
        summary: 'Service health check',
        description: 'Returns per-service health status for DB, Redis, and Kafka. Does NOT require auth.',
        response: {
          200: {
            type: 'object',
            properties: {
              status:                { type: 'string', enum: ['ok', 'degraded', 'down'] },
              version:               { type: 'string' },
              uptime_s:              { type: 'number' },
              timestamp:             { type: 'string', format: 'date-time' },
              map_signals_with_geo:    { type: 'number', description: 'Count of geo-located verified signals in last 24h' },
              search_avg_latency_ms:  { type: ['number', 'null'], description: 'Gate 3: 5-min rolling avg search latency (ms). Null = no recent searches.' },
              services: {
                type: 'object',
                properties: {
                  db:    { type: 'object' },
                  redis: { type: 'object' },
                  kafka: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      // Run all checks in parallel (timeout guarded internally)
      // Also fetch map geo count and search latency from cache (non-blocking, best-effort)
      const [dbCheck, redisCheck, kafkaCheck, searchAvgLatencyMs, securityMetrics, lagSummary] = await Promise.all([
        checkDb(),
        checkRedis(),
        checkKafka(),
        getSearchAvgLatencyMs(),
        getSecurityMetrics().catch(() => null),
        getLagSummary().catch(() => null),
      ])

      const services = { db: dbCheck, redis: redisCheck, kafka: kafkaCheck }
      const overall  = deriveOverallStatus(services)

      // Gate 2: include map_signals_with_geo metric (cached, best-effort)
      let mapSignalsWithGeo = 0
      try {
        const cached = await redis.get('signals:map:health:24h')
        if (cached) {
          const parsed = JSON.parse(cached) as { map_signals_with_geo_24h?: number }
          mapSignalsWithGeo = parsed.map_signals_with_geo_24h ?? 0
        } else if (dbCheck.status === 'ok') {
          // Compute fresh if not cached (lightweight query)
          const [row] = await db('signals')
            .whereNotNull('location')
            .whereIn('status', ['verified', 'pending'])
            .where('created_at', '>', db.raw(`NOW() - INTERVAL '24 hours'`))
            .count('id as count')
          mapSignalsWithGeo = Number((row as { count: string | number } | undefined)?.count ?? 0)
          redis.setex('signals:map:health:24h', 300, JSON.stringify({
            map_signals_with_geo_24h: mapSignalsWithGeo,
            geo_coverage_status: mapSignalsWithGeo >= 10 ? 'healthy' : mapSignalsWithGeo > 0 ? 'low' : 'empty',
            checked_at: new Date().toISOString(),
          })).catch(() => {})
        }
      } catch {
        // Best-effort — don't fail health check due to map count
      }

      if (mapSignalsWithGeo < 10 && dbCheck.status === 'ok') {
        // Log warning but don't degrade overall health status
        console.warn(`[HEALTH] map_signals_with_geo=${mapSignalsWithGeo} — below 10 threshold. Check scraper location enrichment.`)
      }

      const kafkaLag = lagSummary
        ? {
            total_lag:      lagSummary.total_lag,
            overall_status: lagSummary.overall_status,
            groups: lagSummary.groups.map(g => ({
              groupId:  g.groupId,
              totalLag: g.totalLag,
              status:   g.status,
            })),
          }
        : null

      const body: HealthResponse = {
        status:                overall,
        version:               process.env.npm_package_version ?? '0.1.0',
        uptime_s:              Math.floor(process.uptime()),
        timestamp:             new Date().toISOString(),
        map_signals_with_geo:  mapSignalsWithGeo,
        search_avg_latency_ms: searchAvgLatencyMs,
        security:              securityMetrics,
        kafka_consumer_lag:    kafkaLag,
        services,
      }

      // Return 503 if any critical service (db) is down
      const httpStatus = dbCheck.status === 'down' ? 503 : 200
      return reply.status(httpStatus).send(body)
    },
  )
}
