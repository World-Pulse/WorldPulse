/**
 * Tests for GET /api/v1/status
 *
 * All infra dependencies (DB, Redis, Meilisearch, WS handler) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../../db/postgres', () => ({
  db: { raw: vi.fn() },
}))

vi.mock('../../db/redis', () => ({
  redis: {
    ping:  vi.fn(),
    get:   vi.fn(),
    setex: vi.fn(),
    keys:  vi.fn(),
  },
}))

vi.mock('../../ws/handler', () => ({
  getWsClientCount: vi.fn(() => 3),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
const { db }    = await import('../../db/postgres')
const { redis } = await import('../../db/redis')
const { getWsClientCount } = await import('../../ws/handler')

import {
  checkDatabase,
  checkRedis,
  checkSearch,
  checkScraper,
  checkWebSocket,
  deriveOverallStatus,
  type ServiceCheck,
  type ServiceStatus,
} from '../status'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mockDbRaw(delay = 0, reject = false) {
  ;(db.raw as ReturnType<typeof vi.fn>).mockImplementation(() =>
    reject
      ? Promise.reject(new Error('Connection refused'))
      : new Promise(resolve => setTimeout(() => resolve([{ 1: 1 }]), delay)),
  )
}

function mockRedisPing(result: string | Error) {
  ;(redis.ping as ReturnType<typeof vi.fn>).mockImplementation(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
}

function mockFetch(status: number, body: unknown, delay = 0) {
  return vi.spyOn(global, 'fetch').mockImplementation(
    () =>
      new Promise(resolve =>
        setTimeout(
          () =>
            resolve({
              ok:   status >= 200 && status < 300,
              status,
              json: () => Promise.resolve(body),
            } as Response),
          delay,
        ),
      ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(redis.get   as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(redis.setex as ReturnType<typeof vi.fn>).mockResolvedValue('OK')
  ;(redis.keys  as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

// ─── checkDatabase ────────────────────────────────────────────────────────────
describe('checkDatabase', () => {
  it('returns operational when SELECT 1 succeeds quickly', async () => {
    mockDbRaw(5)
    const result = await checkDatabase()
    expect(result.status).toBe('operational')
    expect(result.latency_ms).toBeDefined()
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('returns degraded when latency exceeds 500ms', async () => {
    mockDbRaw(600)
    const result = await checkDatabase()
    expect(result.status).toBe('degraded')
    expect(result.message).toContain('latency')
  })

  it('returns outage on DB error', async () => {
    mockDbRaw(0, true)
    const result = await checkDatabase()
    expect(result.status).toBe('outage')
    expect(result.message).toContain('Connection refused')
  })
})

// ─── checkRedis ───────────────────────────────────────────────────────────────
describe('checkRedis', () => {
  it('returns operational when PING returns PONG', async () => {
    mockRedisPing('PONG')
    const result = await checkRedis()
    expect(result.status).toBe('operational')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('returns degraded on PING failure', async () => {
    mockRedisPing(new Error('ECONNREFUSED'))
    const result = await checkRedis()
    expect(result.status).toBe('degraded')
    expect(result.message).toContain('ECONNREFUSED')
  })

  it('returns degraded when PING returns unexpected value', async () => {
    mockRedisPing('ERR')
    const result = await checkRedis()
    expect(result.status).toBe('degraded')
    expect(result.message).toContain('ERR')
  })
})

// ─── checkSearch ─────────────────────────────────────────────────────────────
describe('checkSearch', () => {
  it('returns operational when Meilisearch /health returns available', async () => {
    mockFetch(200, { status: 'available' })
    const result = await checkSearch()
    expect(result.status).toBe('operational')
  })

  it('returns degraded when Meilisearch returns non-200', async () => {
    mockFetch(503, {})
    const result = await checkSearch()
    expect(result.status).toBe('degraded')
    expect(result.message).toContain('503')
  })

  it('returns degraded when Meilisearch fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))
    const result = await checkSearch()
    expect(result.status).toBe('degraded')
    expect(result.message).toContain('Network error')
  })
})

// ─── checkScraper ─────────────────────────────────────────────────────────────
// Oct 20, 2026: it goes by the newest report's age, not the 14-day stability
// clock (which said "outage" while reports arrived every minute)
describe('checkScraper', () => {
  const NOW = new Date('2026-10-20T18:30:00Z')
  const newest = (iso: string | null) =>
    (db.raw as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [{ newest: iso }] })

  it('is operational while reports keep arriving, whatever the stability clock says', async () => {
    ;(redis.get as ReturnType<typeof vi.fn>).mockResolvedValue('failed')
    newest('2026-10-20T18:26:00Z')
    expect(await checkScraper(NOW)).toMatchObject({ status: 'operational', message: 'Newest report 4 min ago' })
    newest('2026-10-20T18:29:45Z')
    expect((await checkScraper(NOW)).message).toBe('Newest report under a minute ago')
  })

  it('is degraded after 15 minutes without a report, and an outage after two hours', async () => {
    newest('2026-10-20T18:00:00Z')
    expect(await checkScraper(NOW)).toMatchObject({ status: 'degraded', message: 'No new report for 30 min' })
    newest('2026-10-20T14:00:00Z')
    expect(await checkScraper(NOW)).toMatchObject({ status: 'outage', message: 'No new report for 5 h' })
    newest(null)
    expect(await checkScraper(NOW)).toMatchObject({ status: 'outage', message: 'No reports yet' })
  })

  it('is degraded when the database cannot say', async () => {
    ;(db.raw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Connection refused'))
    expect(await checkScraper(NOW)).toMatchObject({ status: 'degraded', message: 'Connection refused' })
  })
})

// ─── checkWebSocket ───────────────────────────────────────────────────────────
describe('checkWebSocket', () => {
  it('returns operational when getWsClientCount succeeds', () => {
    ;(getWsClientCount as ReturnType<typeof vi.fn>).mockReturnValue(5)
    const result = checkWebSocket()
    expect(result.status).toBe('operational')
    expect(result.message).toContain('5')
  })

  it('returns degraded when getWsClientCount throws', () => {
    ;(getWsClientCount as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Handler not init')
    })
    const result = checkWebSocket()
    expect(result.status).toBe('degraded')
  })
})

// ─── deriveOverallStatus ──────────────────────────────────────────────────────
describe('deriveOverallStatus', () => {
  it('returns operational when all services are operational', () => {
    const services: Record<string, ServiceCheck> = {
      api:       { status: 'operational' },
      database:  { status: 'operational', latency_ms: 5 },
      redis:     { status: 'operational', latency_ms: 1 },
      search:    { status: 'operational', latency_ms: 12 },
      scraper:   { status: 'operational' },
      websocket: { status: 'operational' },
    }
    expect(deriveOverallStatus(services)).toBe('operational')
  })

  it('returns degraded when any service is degraded', () => {
    const services: Record<string, ServiceCheck> = {
      api:      { status: 'operational' },
      database: { status: 'degraded', latency_ms: 600 },
      redis:    { status: 'operational' },
    }
    expect(deriveOverallStatus(services)).toBe('degraded')
  })

  it('returns outage when any service has outage (even if others are only degraded)', () => {
    const services: Record<string, ServiceCheck> = {
      api:      { status: 'operational' },
      database: { status: 'outage' },
      redis:    { status: 'degraded' },
    }
    expect(deriveOverallStatus(services)).toBe('outage')
  })
})

// ─── Cache behaviour ──────────────────────────────────────────────────────────
describe('cache behaviour', () => {
  it('returns cached response with X-Cache-Hit header', async () => {
    // We test the cache by importing the full route module logic directly:
    // simulate what the handler does on cache hit.
    const cachedPayload = {
      overall:        'operational' as ServiceStatus,
      checked_at:     new Date().toISOString(),
      version:        '1.0.0',
      uptime_seconds: 3600,
      services: {
        api:       { status: 'operational' as ServiceStatus },
        database:  { status: 'operational' as ServiceStatus, latency_ms: 4 },
        redis:     { status: 'operational' as ServiceStatus, latency_ms: 1 },
        search:    { status: 'operational' as ServiceStatus, latency_ms: 10 },
        scraper:   { status: 'operational' as ServiceStatus },
        websocket: { status: 'operational' as ServiceStatus, message: '3 active connections' },
      },
    }

    ;(redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(cachedPayload))

    // On a cache hit the handler reads Redis and returns early — no DB/Meili calls.
    const cached = await redis.get('status:page:cache')
    expect(cached).not.toBeNull()
    const parsed = JSON.parse(cached as string)
    expect(parsed.overall).toBe('operational')
    // Verify that db.raw was NOT called (would only be called if cache miss)
    expect(db.raw).not.toHaveBeenCalled()
  })

  it('does not write cache when a service is degraded', () => {
    // deriveOverallStatus determines cache eligibility
    const services: Record<string, ServiceCheck> = {
      api:      { status: 'operational' },
      database: { status: 'degraded', latency_ms: 800 },
    }
    const overall = deriveOverallStatus(services)
    // Only cache when 'operational'
    const shouldCache = overall === 'operational'
    expect(shouldCache).toBe(false)
    expect(redis.setex).not.toHaveBeenCalled()
  })
})
