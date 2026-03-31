/**
 * public.test.ts
 *
 * Test suite for the WorldPulse Public API routes:
 *   GET     /api/v1/public/signals
 *   OPTIONS /api/v1/public/signals
 *
 * This endpoint is WorldPulse's core open-source differentiator:
 * no auth required, rate-limited at 60 req/min per IP, returns verified
 * signals with id, title, category, severity, reliability_score,
 * location_name, published_at, source_url.
 *
 * All DB queries and Redis calls are mocked so the suite runs in CI
 * without a real database or cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerPublicRoutes } from '../public'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRedis = {
  get:   vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
}

vi.mock('../../db/redis', () => ({
  redis: mockRedis,
}))

// Default mock rows returned by db('signals').select(...)
const MOCK_SIGNAL_ROWS = [
  {
    id:                'sig-uuid-1',
    title:             'Earthquake hits coastal region',
    category:          'climate',
    severity:          'high',
    reliability_score: 0.87,
    location_name:     'Chile',
    published_at:      new Date('2026-03-15T10:00:00Z'),
    source_url:        'https://reuters.com/eq1',
  },
  {
    id:                'sig-uuid-2',
    title:             'Cybersecurity breach at major bank',
    category:          'cyber',
    severity:          'critical',
    reliability_score: 0.93,
    location_name:     null,
    published_at:      new Date('2026-03-15T11:00:00Z'),
    source_url:        null,
  },
]

const MOCK_COUNT_ROWS = [{ count: '42' }]

// Chainable mock builder for knex-style queries
function buildQueryChain(resolveWith: unknown[]) {
  const chain: Record<string, unknown> = {}
  const methods = ['where', 'orderBy', 'limit', 'offset', 'select', 'count']
  methods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  // Final await returns the resolveWith value
  ;(chain as unknown as Promise<unknown[]>)[Symbol.iterator] = undefined
  Object.defineProperty(chain, 'then', {
    get: () => (resolve: (v: unknown[]) => void) => resolve(resolveWith),
  })
  return chain
}

const mockDbFn = vi.fn()

vi.mock('../../db/postgres', () => ({
  db: new Proxy(
    function dbProxy(..._args: unknown[]) {
      return mockDbFn(..._args)
    } as unknown as { raw: (...args: unknown[]) => unknown },
    {
      get(_target, prop) {
        if (prop === 'raw') {
          return vi.fn((_sql: string, _bindings: unknown[]) => ({
            __raw: true,
            sql: _sql,
            bindings: _bindings,
          }))
        }
        return undefined
      },
      apply(_target, _this, args) {
        return mockDbFn(...args)
      },
    },
  ),
}))

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

const mockDb   = db as unknown as ReturnType<typeof vi.fn>
const mockR    = redis as typeof mockRedis

// ─── App factory ─────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(registerPublicRoutes, { prefix: '/public' })
  await app.ready()
  return app
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Default: cache miss
  mockR.get.mockResolvedValue(null)
  mockR.setex.mockResolvedValue('OK')

  // Default: db('signals') returns signal rows for select, count rows for count
  mockDb.mockImplementation((_table: string) => {
    const selectChain = {
      where:   vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit:   vi.fn().mockReturnThis(),
      offset:  vi.fn().mockReturnThis(),
      select:  vi.fn().mockResolvedValue(MOCK_SIGNAL_ROWS),
      count:   vi.fn().mockResolvedValue(MOCK_COUNT_ROWS),
    }
    return selectChain
  })
})

// ─── GET /public/signals ──────────────────────────────────────────────────────

describe('GET /public/signals', () => {

  it('returns 200 with success: true', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.success).toBe(true)
  })

  it('returns correct response shape: { success, data, total, limit, offset }', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    expect(body).toHaveProperty('success', true)
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('limit')
    expect(body).toHaveProperty('offset')
  })

  it('returns correct default limit=50 and offset=0', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
  })

  it('returns total count from DB', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    expect(body.total).toBe(42)
  })

  it('returns data with correct signal field shape', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    const sig = body.data[0]
    expect(sig).toHaveProperty('id', 'sig-uuid-1')
    expect(sig).toHaveProperty('title', 'Earthquake hits coastal region')
    expect(sig).toHaveProperty('category', 'climate')
    expect(sig).toHaveProperty('severity', 'high')
    expect(sig).toHaveProperty('reliability_score')
    expect(sig).toHaveProperty('location_name')
    expect(sig).toHaveProperty('published_at')
    expect(sig).toHaveProperty('source_url')
  })

  it('serialises reliability_score as a number', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    expect(typeof body.data[0].reliability_score).toBe('number')
    expect(body.data[0].reliability_score).toBeCloseTo(0.87)
  })

  it('returns null for location_name when DB value is null', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    const nullSig = body.data.find((s: { id: string }) => s.id === 'sig-uuid-2')
    expect(nullSig?.location_name).toBeNull()
  })

  it('returns null for source_url when DB value is null', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    const nullSig = body.data.find((s: { id: string }) => s.id === 'sig-uuid-2')
    expect(nullSig?.source_url).toBeNull()
  })

  it('serialises published_at as ISO string when value is a Date object', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    const body = JSON.parse(res.payload)
    expect(body.data[0].published_at).toBe('2026-03-15T10:00:00.000Z')
  })

  it('accepts ?limit query param and respects it', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals?limit=10' })
    const body = JSON.parse(res.payload)
    expect(body.limit).toBe(10)
  })

  it('accepts ?offset query param and respects it', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals?offset=20' })
    const body = JSON.parse(res.payload)
    expect(body.offset).toBe(20)
  })

  it('clamps limit to 100 maximum', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals?limit=500' })
    // Either schema rejects with 400, or route caps to 100
    if (res.statusCode === 200) {
      const body = JSON.parse(res.payload)
      expect(body.limit).toBeLessThanOrEqual(100)
    } else {
      expect([400, 422]).toContain(res.statusCode)
    }
  })

  it('always includes Access-Control-Allow-Origin: * header', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('always includes Access-Control-Allow-Methods header', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    expect(res.headers['access-control-allow-methods']).toMatch(/GET/)
  })

  it('works without Authorization header (no auth required)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/public/signals',
      // Deliberately no Authorization header
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns cached response with X-Cache-Hit: true on cache hit', async () => {
    const cachedPayload = JSON.stringify({
      success: true,
      data:    [{ id: 'cached-sig', title: 'Cached signal', category: 'conflict', severity: 'high', reliability_score: 0.9, location_name: 'Ukraine', published_at: '2026-03-15T09:00:00.000Z', source_url: null }],
      total:   1,
      limit:   50,
      offset:  0,
    })
    mockR.get.mockResolvedValue(cachedPayload)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache-hit']).toBe('true')
    const body = JSON.parse(res.payload)
    expect(body.data[0].id).toBe('cached-sig')
  })

  it('does NOT include X-Cache-Hit header on cache miss', async () => {
    mockR.get.mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    expect(res.headers['x-cache-hit']).toBeUndefined()
  })

  it('stores response in Redis cache after DB fetch', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/public/signals' })
    expect(mockR.setex).toHaveBeenCalledOnce()
    // TTL = 30 seconds
    expect(mockR.setex).toHaveBeenCalledWith(
      expect.stringContaining('public:signals:'),
      30,
      expect.any(String),
    )
  })

  it('cache key encodes category param', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/public/signals?category=conflict' })
    expect(mockR.setex).toHaveBeenCalledWith(
      expect.stringContaining('conflict'),
      expect.any(Number),
      expect.any(String),
    )
  })

  it('returns 200 even when Redis is unavailable (cache miss swallowed)', async () => {
    mockR.get.mockRejectedValue(new Error('Redis connection refused'))
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    expect(res.statusCode).toBe(200)
  })

  it('correctly combines category + severity filters in the same request', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals?category=conflict&severity=critical' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.success).toBe(true)
  })

  it('returns empty data array when DB returns no rows', async () => {
    mockDb.mockImplementation((_table: string) => ({
      where:   vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit:   vi.fn().mockReturnThis(),
      offset:  vi.fn().mockReturnThis(),
      select:  vi.fn().mockResolvedValue([]),
      count:   vi.fn().mockResolvedValue([{ count: '0' }]),
    }))

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.data).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('rejects unknown query params (additionalProperties: false)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals?foo=bar' })
    // schema has additionalProperties: false — Fastify returns 400
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid severity enum value', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/public/signals?severity=INVALID' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 200 for all valid severity enum values', async () => {
    const app = await buildApp()
    for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
      const res = await app.inject({ method: 'GET', url: `/public/signals?severity=${sev}` })
      expect(res.statusCode).toBe(200)
    }
  })

})

// ─── OPTIONS /public/signals (CORS preflight) ─────────────────────────────────

describe('OPTIONS /public/signals', () => {

  it('returns 204 No Content for OPTIONS preflight', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'OPTIONS', url: '/public/signals' })
    expect(res.statusCode).toBe(204)
  })

  it('OPTIONS response includes Access-Control-Allow-Origin: *', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'OPTIONS', url: '/public/signals' })
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('OPTIONS response includes Access-Control-Allow-Methods with GET and OPTIONS', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'OPTIONS', url: '/public/signals' })
    expect(res.headers['access-control-allow-methods']).toMatch(/GET/)
    expect(res.headers['access-control-allow-methods']).toMatch(/OPTIONS/)
  })

  it('OPTIONS response includes Access-Control-Max-Age: 86400', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'OPTIONS', url: '/public/signals' })
    expect(res.headers['access-control-max-age']).toBe('86400')
  })

  it('OPTIONS response includes Access-Control-Allow-Headers: Content-Type', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'OPTIONS', url: '/public/signals' })
    expect(res.headers['access-control-allow-headers']).toMatch(/Content-Type/)
  })

})
