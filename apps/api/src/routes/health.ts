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
              status:    { type: 'string', enum: ['ok', 'degraded', 'down'] },
              version:   { type: 'string' },
              uptime_s:  { type: 'number' },
              timestamp: { type: 'string', format: 'date-time' },
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
      const [dbCheck, redisCheck, kafkaCheck] = await Promise.all([
        checkDb(),
        checkRedis(),
        checkKafka(),
      ])

      const services = { db: dbCheck, redis: redisCheck, kafka: kafkaCheck }
      const overall  = deriveOverallStatus(services)

      const body: HealthResponse = {
        status:    overall,
        version:   process.env.npm_package_version ?? '0.1.0',
        uptime_s:  Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        services,
      }

      // Return 503 if any critical service (db) is down
      const httpStatus = dbCheck.status === 'down' ? 503 : 200
      return reply.status(httpStatus).send(body)
    },
  )
}
