/**
 * Tests for GET /api/v1/public/signals
 *
 * Uses mocked DB and Redis; spins up a scoped Fastify app via inject()
 * so we can assert status codes, headers, and response shapes without
 * hitting real infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../db/postgres', () => {
  const mockSelect  = vi.fn()
  const mockWhere   = vi.fn()
  const mockOrderBy = vi.fn()
  const mockLimit   = vi.fn()
  const mockOffset  = vi.fn()
  const mockCount   = vi.fn()
  const mockRaw     = vi.fn((expr: string) => expr)

  // Fluent chain that always terminates in a thenable resolving to rows
  const chain = {
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    offset:  vi.fn().mockReturnThis(),
    select:  vi.fn().mockReturnThis(),
    count:   vi.fn().mockReturnThis(),
    then:    (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
  }

  const db = vi.fn(() => chain) as unknown as ((...args: unknown[]) => typeof chain) & {
    raw: typeof mockRaw
    _chain: typeof chain
    _select: typeof mockSelect
    _where: typeof mockWhere
    _orderBy: typeof mockOrderBy
    _limit: typeof mockLimit
    _offset: typeof mockOffset
    _count: typeof mockCount
  }
  db.raw   = mockRaw
  db._chain    = chain
  db._select   = mockSelect
  db._where    = mockWhere
  db._orderBy  = mockOrderBy
  db._limit    = mockLimit
  db._offset   = mockOffset
  db._count    = mockCount

  return { db }
})

vi.mock('../db/redis', () => ({
  redis: {
    get:   vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────

const { db }    = await import('../db/postgres')
const { redis } = await import('../db/redis')
import { registerPublicRoutes } from '../routes/public'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSignalRow(overrides: Record<string, unknown> = {}) {
  return {
    id:                'sig-001',
    title:             'Test Signal',
    category:          'conflict',
    severity:          'high',
    reliability_score: 0.85,
    location_name:     'Kyiv, Ukraine',
    published_at:      new Date('2024-06-01T12:00:00Z'),
    source_url:        'https://reuters.com/article-1',
    status:            'verified',
    ...overrides,
  }
}

// ─── App factory ─────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false })

  // Register rate-limit plugin (required by the route config)
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis: redis as never,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({ success: false, error: 'rate limited' }),
  })

  await app.register(registerPublicRoutes, { prefix: '/api/v1/public' })
  await app.ready()
  return app
}

// ─── Helper: mock db to return specific rows + count ─────────────────────────

function mockDbResult(rows: ReturnType<typeof makeSignalRow>[], total = rows.length) {
  const chain = (db as unknown as { _chain: Record<string, unknown> })._chain as {
    then: (resolve: (v: unknown) => unknown) => Promise<unknown>
    count: ReturnType<typeof vi.fn>
  }

  let callCount = 0
  chain.then = (resolve) => {
    callCount++
    if (callCount % 2 === 1) {
      // odd calls → row data
      return Promise.resolve(rows).then(resolve)
    }
    // even calls → count result
    return Promise.resolve([{ count: String(total) }]).then(resolve)
  }

  // Promise.all calls both queries; mock count separately
  chain.count = vi.fn().mockReturnValue({
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve([{ count: String(total) }]).then(resolve),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/v1/public/signals', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(redis.setex).mockResolvedValue('OK')
    app = await buildApp()
  })

  // 1 ── Returns 200 + data array ─────────────────────────────────────────────
  it('returns 200 with success:true and a data array', async () => {
    const rows = [makeSignalRow(), makeSignalRow({ id: 'sig-002', title: 'Second' })]
    mockDbResult(rows)

    const res = await app.inject({ method: 'GET', url: '/api/v1/public/signals' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ success: boolean; data: unknown[] }>()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  // 2 ── Filters by category ──────────────────────────────────────────────────
  it('passes category filter to the DB query', async () => {
    mockDbResult([makeSignalRow({ category: 'climate' })])

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/public/signals?category=climate',
    })

    expect(res.statusCode).toBe(200)
    // Verify the chain's where() was called (category filter applied)
    const chain = (db as unknown as { _chain: { where: ReturnType<typeof vi.fn> } })._chain
    expect(chain.where).toHaveBeenCalledWith('category', 'climate')
  })

  // 3 ── Filters by severity ──────────────────────────────────────────────────
  it('passes severity filter to the DB query', async () => {
    mockDbResult([makeSignalRow({ severity: 'critical' })])

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/public/signals?severity=critical',
    })

    expect(res.statusCode).toBe(200)
    const chain = (db as unknown as { _chain: { where: ReturnType<typeof vi.fn> } })._chain
    expect(chain.where).toHaveBeenCalledWith('severity', 'critical')
  })

  // 4 ── Respects limit param (max 100) ──────────────────────────────────────
  it('clamps limit to 100 and reflects it in the response', async () => {
    mockDbResult([makeSignalRow()])

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/public/signals?limit=200',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ limit: number }>()
    expect(body.limit).toBe(100)

    const chain = (db as unknown as { _chain: { limit: ReturnType<typeof vi.fn> } })._chain
    expect(chain.limit).toHaveBeenCalledWith(100)
  })

  // 5 ── CORS headers present ────────────────────────────────────────────────
  it('includes Access-Control-Allow-Origin: * header', async () => {
    mockDbResult([])

    const res = await app.inject({ method: 'GET', url: '/api/v1/public/signals' })

    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  // 6 ── Returns only verified signals ──────────────────────────────────────
  it('queries only status=verified signals', async () => {
    mockDbResult([makeSignalRow()])

    await app.inject({ method: 'GET', url: '/api/v1/public/signals' })

    const chain = (db as unknown as { _chain: { where: ReturnType<typeof vi.fn> } })._chain
    expect(chain.where).toHaveBeenCalledWith('status', 'verified')
  })

  // 7 ── Rate-limit header present ────────────────────────────────────────────
  it('includes X-RateLimit-Limit header in response', async () => {
    mockDbResult([])

    const res = await app.inject({ method: 'GET', url: '/api/v1/public/signals' })

    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    expect(Number(res.headers['x-ratelimit-limit'])).toBe(60)
  })

  // 8 ── Redis cache: returns cached response on second call ──────────────────
  it('returns cached response when Redis has a hit', async () => {
    const cachedBody = {
      success: true,
      data:    [makeSignalRow()],
      total:   1,
      limit:   50,
      offset:  0,
    }
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cachedBody))

    const res = await app.inject({ method: 'GET', url: '/api/v1/public/signals' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache-hit']).toBe('true')
    // DB should NOT have been queried
    expect(db).not.toHaveBeenCalled()
  })

  // 9 ── Response shape matches spec ─────────────────────────────────────────
  it('response includes total, limit, and offset fields', async () => {
    mockDbResult([makeSignalRow(), makeSignalRow({ id: 'sig-003' })], 42)

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/public/signals?limit=10&offset=5',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ total: number; limit: number; offset: number }>()
    expect(body.limit).toBe(10)
    expect(body.offset).toBe(5)
    expect(typeof body.total).toBe('number')
  })

  // 10 ── OPTIONS preflight returns 204 ──────────────────────────────────────
  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/api/v1/public/signals' })

    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-methods']).toContain('GET')
  })
})
