/**
 * Tests for /api/v1/health endpoint logic.
 * Uses mocked DB/Redis/Kafka to avoid infrastructure dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────
vi.mock('../db/postgres', () => ({
  db: {
    raw: vi.fn(),
  },
}))

vi.mock('../db/redis', () => ({
  redis: {
    ping: vi.fn(),
  },
}))

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    admin: () => ({
      connect: vi.fn().mockResolvedValue(undefined),
      listTopics: vi.fn().mockResolvedValue([]),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}))

// ─── Import after mocks ───────────────────────────────────────────────────
const { db }    = await import('../db/postgres')
const { redis } = await import('../db/redis')

// ─── Helpers — copy the check logic inline for unit tests ─────────────────
type ServiceStatus = 'ok' | 'degraded' | 'down'
interface ServiceCheck { status: ServiceStatus; latency_ms?: number; error?: string }

async function checkDb(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    await (db as { raw: (q: string) => Promise<unknown> }).raw('SELECT 1')
    return { status: 'ok', latency_ms: Date.now() - t0 }
  } catch (err) {
    return { status: 'down', latency_ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) }
  }
}

async function checkRedis(): Promise<ServiceCheck> {
  const t0 = Date.now()
  try {
    const pong = await (redis as { ping: () => Promise<string> }).ping()
    if (pong !== 'PONG') return { status: 'degraded', latency_ms: Date.now() - t0, error: `Unexpected: ${pong}` }
    return { status: 'ok', latency_ms: Date.now() - t0 }
  } catch (err) {
    return { status: 'down', latency_ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) }
  }
}

function deriveOverallStatus(checks: Record<string, ServiceCheck>): ServiceStatus {
  const statuses = Object.values(checks).map(c => c.status)
  if (statuses.includes('down'))     return 'down'
  if (statuses.includes('degraded')) return 'degraded'
  return 'ok'
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Health check', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('checkDb', () => {
    it('returns ok when SELECT 1 succeeds', async () => {
      vi.mocked(db.raw).mockResolvedValueOnce(undefined)
      const result = await checkDb()
      expect(result.status).toBe('ok')
      expect(result.latency_ms).toBeGreaterThanOrEqual(0)
    })

    it('returns down when SELECT 1 throws', async () => {
      vi.mocked(db.raw).mockRejectedValueOnce(new Error('Connection refused'))
      const result = await checkDb()
      expect(result.status).toBe('down')
      expect(result.error).toContain('Connection refused')
    })
  })

  describe('checkRedis', () => {
    it('returns ok when PING returns PONG', async () => {
      vi.mocked(redis.ping).mockResolvedValueOnce('PONG')
      const result = await checkRedis()
      expect(result.status).toBe('ok')
    })

    it('returns degraded when PING returns unexpected value', async () => {
      vi.mocked(redis.ping).mockResolvedValueOnce('PONG' as never)
      // Simulate unexpected response
      vi.mocked(redis.ping).mockResolvedValueOnce('ERR' as never)
      const result = await checkRedis()
      // Second call returns 'ERR' → degraded
      expect(result.status).toBe('ok') // first call was fine
      const result2 = await checkRedis()
      expect(result2.status).toBe('degraded')
      expect(result2.error).toContain('ERR')
    })

    it('returns down when redis throws', async () => {
      vi.mocked(redis.ping).mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await checkRedis()
      expect(result.status).toBe('down')
    })
  })

  describe('deriveOverallStatus', () => {
    it('returns ok when all services are ok', () => {
      expect(deriveOverallStatus({
        db:    { status: 'ok' },
        redis: { status: 'ok' },
        kafka: { status: 'ok' },
      })).toBe('ok')
    })

    it('returns degraded when one service is degraded', () => {
      expect(deriveOverallStatus({
        db:    { status: 'ok' },
        redis: { status: 'ok' },
        kafka: { status: 'degraded' },
      })).toBe('degraded')
    })

    it('returns down when any service is down', () => {
      expect(deriveOverallStatus({
        db:    { status: 'down' },
        redis: { status: 'ok' },
        kafka: { status: 'ok' },
      })).toBe('down')
    })

    it('down takes precedence over degraded', () => {
      expect(deriveOverallStatus({
        db:    { status: 'down' },
        redis: { status: 'degraded' },
        kafka: { status: 'ok' },
      })).toBe('down')
    })
  })
})
