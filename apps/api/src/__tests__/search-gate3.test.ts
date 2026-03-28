/**
 * search-gate3.test.ts — Gate 3 Search Latency Hardening tests
 *
 * Covers:
 *  1. Cache hit returns immediately WITHOUT calling Meilisearch
 *  2. Meilisearch timeout returns partial:true + falls back to Postgres FTS
 *  3. Autocomplete returns ≤ 5 results per type (signals, users, tags)
 *  4. Search latency tracker: recordSearchLatency / getSearchAvgLatencyMs / getSearchPercentiles
 *  5. maybeLogPercentiles fires every 100 requests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock Redis ───────────────────────────────────────────────────────────────
const redisMock = {
  get:      vi.fn(),
  set:      vi.fn(),
  setex:    vi.fn(),
  rpush:    vi.fn(),
  ltrim:    vi.fn(),
  lrange:   vi.fn(),
  incr:     vi.fn(),
  pipeline: vi.fn(),
  ping:     vi.fn(),
}

redisMock.pipeline.mockReturnValue({
  rpush:  vi.fn().mockReturnThis(),
  ltrim:  vi.fn().mockReturnThis(),
  incr:   vi.fn().mockReturnThis(),
  exec:   vi.fn().mockResolvedValue([]),
})

vi.mock('../db/redis', () => ({ redis: redisMock }))

// ─── Mock Meilisearch ─────────────────────────────────────────────────────────
const meiliSearchMock = vi.fn()
const meiliMock = {
  index: vi.fn(() => ({ search: meiliSearchMock })),
}
vi.mock('../lib/search', () => ({
  meili:              meiliMock,
  setupSearchIndexes: vi.fn(),
  indexSignal:        vi.fn(),
  indexPost:          vi.fn(),
}))

// ─── Mock DB (Postgres fallback) ──────────────────────────────────────────────
const dbMock = vi.fn()
vi.mock('../db/postgres', () => {
  const qb: Record<string, unknown> = {}
  const chainable = () => qb
  qb.whereRaw   = chainable
  qb.where      = chainable
  qb.modify     = (fn: (q: typeof qb) => void) => { fn(qb); return qb }
  qb.whereIn    = chainable
  qb.select     = chainable
  qb.orderBy    = chainable
  qb.limit      = chainable
  qb.offset     = vi.fn().mockResolvedValue([
    { id: 'fallback-1', title: 'FTS Result', category: 'conflict', severity: 'high', status: 'verified', reliabilityScore: 0.8 },
  ])
  qb.raw = vi.fn().mockResolvedValue({ rows: [] })
  const db = Object.assign(dbMock, qb)
  db.raw = vi.fn().mockResolvedValue({ rows: [] })
  return { db }
})

// ─── Mock other deps ──────────────────────────────────────────────────────────
vi.mock('../lib/search-analytics', () => ({ logSearchQuery: vi.fn() }))
vi.mock('../lib/opensanctions',    () => ({ searchEntities: vi.fn() }))
vi.mock('../utils/sanitize',       () => ({ sanitizeString: (s: string) => s }))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  // Import inline to get a fresh module after mocks are set up
  const fastify = require('fastify').default ?? require('fastify')
  const app = fastify({ logger: false })

  const { registerSearchRoutes } = require('../routes/search')
  app.register(registerSearchRoutes, { prefix: '/' })
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Gate 3 — Search Latency Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. Cache hit ────────────────────────────────────────────────────────────
  describe('cache hit', () => {
    it('returns cached response without calling Meilisearch', async () => {
      const cachedBody = JSON.stringify({
        success: true,
        data: { query: 'ukraine', type: 'all', results: { signals: [] }, total: 0 },
      })
      redisMock.get.mockResolvedValueOnce(cachedBody)

      const app = makeApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url:    '/?q=ukraine&type=all',
      })

      expect(res.statusCode).toBe(200)
      expect(meiliSearchMock).not.toHaveBeenCalled()
      expect(res.headers['x-cache-hit']).toBe('true')
      // Latency header must be present (gate 3 requirement)
      expect(res.headers['x-search-latency-ms']).toBeDefined()

      await app.close()
    })

    it('cache hit response includes the cached data intact', async () => {
      const payload = {
        success: true,
        data: {
          query: 'fire', type: 'signals',
          results: { signals: [{ id: 's1', title: 'Fire in X' }] },
          total: 1,
        },
      }
      redisMock.get.mockResolvedValueOnce(JSON.stringify(payload))

      const app = makeApp()
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/?q=fire&type=signals' })
      const body = res.json()

      expect(body.data.results.signals).toHaveLength(1)
      expect(body.data.results.signals[0].id).toBe('s1')

      await app.close()
    })
  })

  // ── 2. Meilisearch timeout → partial fallback ───────────────────────────────
  describe('timeout fallback', () => {
    it('returns partial:true when Meilisearch exceeds 150ms timeout', async () => {
      // No cache
      redisMock.get.mockResolvedValue(null)

      // Meilisearch takes longer than the 150ms timeout
      meiliSearchMock.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ hits: [] }), 200)),
      )

      // DB mock returns fallback results
      dbMock.mockReturnValue({
        whereRaw: vi.fn().mockReturnThis(),
        where:    vi.fn().mockReturnThis(),
        modify:   vi.fn((fn: (q: object) => void) => { fn({}); return { select: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), offset: vi.fn().mockResolvedValue([{ id: 'fb-1', title: 'Fallback' }]) } }),
      })

      const app = makeApp()
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/?q=conflict&type=signals' })
      const body = res.json()

      expect(res.statusCode).toBe(200)
      expect(body.data.partial).toBe(true)
      expect(body.data.partial_reason).toBe('meilisearch_timeout')

      await app.close()
    }, 2000)

    it('partial results are NOT cached to Redis', async () => {
      redisMock.get.mockResolvedValue(null)

      // Meilisearch times out
      meiliSearchMock.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ hits: [{ id: 'm1' }] }), 200)),
      )

      const app = makeApp()
      await app.ready()

      await app.inject({ method: 'GET', url: '/?q=partial&type=signals' })

      // setex should NOT have been called with a partial result
      const setexCalls = redisMock.setex.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).startsWith('search:'),
      )
      expect(setexCalls).toHaveLength(0)

      await app.close()
    }, 2000)
  })

  // ── 3. Autocomplete ─────────────────────────────────────────────────────────
  describe('autocomplete endpoint', () => {
    it('returns ≤ 5 signals', async () => {
      const hits = Array.from({ length: 3 }, (_, i) => ({
        id: `s${i}`, title: `Signal ${i}`, category: 'conflict',
      }))
      meiliSearchMock.mockResolvedValue({ hits })
      redisMock.get.mockResolvedValue(null)

      const app = makeApp()
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/autocomplete?q=war' })
      const body = res.json()

      expect(res.statusCode).toBe(200)
      expect(body.data.signals.length).toBeLessThanOrEqual(5)

      await app.close()
    })

    it('returns ≤ 5 users', async () => {
      const userHits = Array.from({ length: 2 }, (_, i) => ({
        id: `u${i}`, handle: `user_${i}`, displayName: `User ${i}`,
      }))
      meiliSearchMock.mockResolvedValue({ hits: userHits })
      redisMock.get.mockResolvedValue(null)

      const app = makeApp()
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/autocomplete?q=analyst' })
      const body = res.json()

      expect(res.statusCode).toBe(200)
      expect(body.data.users.length).toBeLessThanOrEqual(5)

      await app.close()
    })

    it('returns empty data gracefully for single-character query', async () => {
      const app = makeApp()
      await app.ready()

      // Single char is valid (min 1)
      const res = await app.inject({ method: 'GET', url: '/autocomplete?q=a' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.success).toBe(true)

      await app.close()
    })

    it('handles Meilisearch error gracefully with empty arrays', async () => {
      meiliSearchMock.mockRejectedValue(new Error('Meilisearch unavailable'))
      redisMock.get.mockResolvedValue(null)

      const app = makeApp()
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/autocomplete?q=crisis' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data.signals).toEqual([])
      expect(body.data.users).toEqual([])

      await app.close()
    })
  })

  // ── 4. Latency tracker unit tests ───────────────────────────────────────────
  describe('search-latency module', () => {
    it('getSearchAvgLatencyMs returns null when Redis key is absent', async () => {
      redisMock.get.mockResolvedValueOnce(null)

      const { getSearchAvgLatencyMs } = await import('../lib/search-latency')
      const avg = await getSearchAvgLatencyMs()

      expect(avg).toBeNull()
    })

    it('getSearchAvgLatencyMs returns parsed number from Redis', async () => {
      redisMock.get.mockResolvedValueOnce('87.34')

      const { getSearchAvgLatencyMs } = await import('../lib/search-latency')
      const avg = await getSearchAvgLatencyMs()

      expect(avg).toBe(87)
    })

    it('getSearchPercentiles returns null when no samples exist', async () => {
      redisMock.lrange.mockResolvedValueOnce([])

      const { getSearchPercentiles } = await import('../lib/search-latency')
      const result = await getSearchPercentiles()

      expect(result).toBeNull()
    })

    it('getSearchPercentiles computes correct p50/p95/p99 for known dataset', async () => {
      // 100 samples: 1–100ms (sorted ascending for predictable percentiles)
      const samples = Array.from({ length: 100 }, (_, i) => String(i + 1))
      redisMock.lrange.mockResolvedValueOnce(samples)

      const { getSearchPercentiles } = await import('../lib/search-latency')
      const result = await getSearchPercentiles()

      expect(result).not.toBeNull()
      expect(result!.sampleCount).toBe(100)
      // p50 of 1–100 = value at index 49 = 50
      expect(result!.p50).toBe(50)
      // p95 of 1–100 = value at index 94 = 95
      expect(result!.p95).toBe(95)
      // p99 of 1–100 = value at index 98 = 99
      expect(result!.p99).toBe(99)
    })

    it('getSearchPercentiles filters out NaN values', async () => {
      redisMock.lrange.mockResolvedValueOnce(['50', 'NaN', '100', 'invalid', '75'])

      const { getSearchPercentiles } = await import('../lib/search-latency')
      const result = await getSearchPercentiles()

      expect(result).not.toBeNull()
      expect(result!.sampleCount).toBe(3) // only valid numbers
    })

    it('recordSearchLatency calls Redis pipeline without throwing', async () => {
      const pipelineMock = {
        rpush: vi.fn().mockReturnThis(),
        ltrim: vi.fn().mockReturnThis(),
        incr:  vi.fn().mockReturnThis(),
        exec:  vi.fn().mockResolvedValue([null, null, 42]),
      }
      redisMock.pipeline.mockReturnValue(pipelineMock)
      redisMock.get.mockResolvedValue('100.00')
      redisMock.setex.mockResolvedValue('OK')

      const { recordSearchLatency } = await import('../lib/search-latency')

      // Should not throw
      expect(() => recordSearchLatency(85)).not.toThrow()

      // Give the async fire-and-forget time to run
      await new Promise(r => setTimeout(r, 10))

      expect(pipelineMock.rpush).toHaveBeenCalledWith('search:latency:samples', '85')
      expect(pipelineMock.ltrim).toHaveBeenCalledWith('search:latency:samples', -200, -1)
    })
  })

  // ── 5. maybeLogPercentiles fires every 100 requests ─────────────────────────
  describe('maybeLogPercentiles', () => {
    it('logs on exactly the 100th request', async () => {
      // req_count = 100 → should log
      redisMock.get.mockResolvedValueOnce('100')
      const samples = Array.from({ length: 100 }, (_, i) => String(i + 1))
      redisMock.lrange.mockResolvedValueOnce(samples)

      const infoSpy = vi.fn()
      const { maybeLogPercentiles } = await import('../lib/search-latency')
      await maybeLogPercentiles({ info: infoSpy })

      expect(infoSpy).toHaveBeenCalledTimes(1)
      const [obj, msg] = infoSpy.mock.calls[0]
      expect(obj.metric).toBe('search_latency_percentiles')
      expect(obj.gate3_target).toBe('p95 < 200ms')
      expect(typeof obj.p95_ms).toBe('number')
      expect(msg).toMatch(/p50=/)
    })

    it('does NOT log on non-100 request counts', async () => {
      redisMock.get.mockResolvedValueOnce('73')

      const infoSpy = vi.fn()
      const { maybeLogPercentiles } = await import('../lib/search-latency')
      await maybeLogPercentiles({ info: infoSpy })

      expect(infoSpy).not.toHaveBeenCalled()
    })

    it('logs gate3_pass:true when p95 < 200ms', async () => {
      redisMock.get.mockResolvedValueOnce('200')
      // All samples at 50ms → p95=50ms < 200ms
      redisMock.lrange.mockResolvedValueOnce(Array(100).fill('50'))

      const infoSpy = vi.fn()
      const { maybeLogPercentiles } = await import('../lib/search-latency')
      await maybeLogPercentiles({ info: infoSpy })

      expect(infoSpy.mock.calls[0][0].gate3_pass).toBe(true)
    })

    it('logs gate3_pass:false when p95 ≥ 200ms', async () => {
      redisMock.get.mockResolvedValueOnce('300')
      // All samples at 250ms → p95=250ms ≥ 200ms
      redisMock.lrange.mockResolvedValueOnce(Array(100).fill('250'))

      const infoSpy = vi.fn()
      const { maybeLogPercentiles } = await import('../lib/search-latency')
      await maybeLogPercentiles({ info: infoSpy })

      expect(infoSpy.mock.calls[0][0].gate3_pass).toBe(false)
    })
  })

  // ── 6. Health endpoint includes search_avg_latency_ms ──────────────────────
  describe('health endpoint integration', () => {
    it('search_avg_latency_ms is present and numeric when data exists', async () => {
      // Redis returns a latency value
      redisMock.get.mockImplementation((key: string) => {
        if (key === 'search:latency:5min:avg') return Promise.resolve('123.45')
        if (key === 'signals:map:health:24h')  return Promise.resolve(null)
        return Promise.resolve(null)
      })
      redisMock.ping.mockResolvedValue('PONG')

      const fastify = require('fastify').default ?? require('fastify')
      const healthApp = fastify({ logger: false })
      const { registerHealthRoutes } = require('../routes/health')
      healthApp.register(registerHealthRoutes, { prefix: '/' })
      await healthApp.ready()

      const res = await healthApp.inject({ method: 'GET', url: '/' })
      const body = res.json()

      expect(body.search_avg_latency_ms).toBe(123)

      await healthApp.close()
    })

    it('search_avg_latency_ms is null when no recent searches', async () => {
      redisMock.get.mockResolvedValue(null)
      redisMock.ping.mockResolvedValue('PONG')

      const fastify = require('fastify').default ?? require('fastify')
      const healthApp = fastify({ logger: false })
      const { registerHealthRoutes } = require('../routes/health')
      healthApp.register(registerHealthRoutes, { prefix: '/' })
      await healthApp.ready()

      const res = await healthApp.inject({ method: 'GET', url: '/' })
      const body = res.json()

      expect(body.search_avg_latency_ms).toBeNull()

      await healthApp.close()
    })
  })
})
