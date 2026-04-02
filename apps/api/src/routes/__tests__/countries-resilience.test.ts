/**
 * countries-resilience.test.ts
 *
 * Tests for GET /api/v1/countries/:code/resilience
 *      and GET /api/v1/countries/resilience/rankings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

// ─── DB Mock ─────────────────────────────────────────────────────────────────

const mockSelect  = vi.fn().mockReturnThis()
const mockWhere   = vi.fn().mockReturnThis()
const mockAndWhere = vi.fn().mockReturnThis()
const mockWhereNotNull = vi.fn().mockReturnThis()
const mockGroupBy = vi.fn().mockReturnThis()
const mockOrderByRaw = vi.fn().mockReturnThis()
const mockHaving  = vi.fn().mockReturnThis()
const mockLimit   = vi.fn()
const mockRaw     = vi.fn((s: string) => s)

const mockDb = vi.fn(() => ({
  select:       mockSelect,
  where:        mockWhere,
  andWhere:     mockAndWhere,
  whereNotNull: mockWhereNotNull,
  groupBy:      mockGroupBy,
  orderByRaw:   mockOrderByRaw,
  having:       mockHaving,
  limit:        mockLimit,
}))
;(mockDb as Record<string, unknown>).raw = mockRaw

vi.mock('../../db/postgres', () => ({ db: mockDb }))

// ─── Redis Mock ───────────────────────────────────────────────────────────────

const mockRedisGet   = vi.fn()
const mockRedisSetex = vi.fn()

vi.mock('../../db/redis', () => ({
  redis: {
    get:   mockRedisGet,
    setex: mockRedisSetex,
  },
}))

// ─── Helpers Mock ─────────────────────────────────────────────────────────────

vi.mock('../../lib/errors', () => ({
  sendError: vi.fn((reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, _code: string, msg: string) =>
    reply.code(status).send({ success: false, error: msg }),
  ),
}))
vi.mock('../../lib/query-schemas', () => ({
  parseQuery: vi.fn((schema: unknown, data: unknown) => data),
  CountryIndexQuerySchema: {},
  CountryDetailQuerySchema: {},
}))

// ─── Fixture data ─────────────────────────────────────────────────────────────

const SIGNAL_ROWS = [
  { category: 'conflict',  severity: 'high',     signal_count: '5' },
  { category: 'political', severity: 'medium',   signal_count: '3' },
  { category: 'economic',  severity: 'low',      signal_count: '8' },
  { category: 'climate',   severity: 'critical', signal_count: '2' },
  { category: 'cyber',     severity: 'high',     signal_count: '4' },
]

const RANKING_ROWS = [
  { country_code: 'US', signal_count: '22', ...Object.fromEntries(SIGNAL_ROWS.map((r, i) => [`c${i}`, r])) },
]

// ─── Setup ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const { registerCountryRoutes } = await import('../../routes/countries')
  const app = Fastify({ logger: false })
  await app.register(registerCountryRoutes, { prefix: '/countries' })
  await app.ready()
  return app
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /countries/:code/resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisGet.mockResolvedValue(null)
    mockRedisSetex.mockResolvedValue('OK')
    // Mock current-period signals
    mockLimit.mockResolvedValueOnce(SIGNAL_ROWS)
    // Mock prev-period signals (for trend)
    mockLimit.mockResolvedValueOnce(SIGNAL_ROWS)
  })

  it('returns HTTP 200 for a valid country code', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('response body has success:true', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    const body = JSON.parse(res.body) as { success: boolean }
    expect(body.success).toBe(true)
    await app.close()
  })

  it('composite_score is a number between 0 and 100', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    const body = JSON.parse(res.body) as { data: { composite_score: number } }
    expect(typeof body.data.composite_score).toBe('number')
    expect(body.data.composite_score).toBeGreaterThanOrEqual(0)
    expect(body.data.composite_score).toBeLessThanOrEqual(100)
    await app.close()
  })

  it('dimensions object contains all 6 required keys', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    const body = JSON.parse(res.body) as { data: { dimensions: Record<string, unknown> } }
    const dims = body.data.dimensions
    expect(dims).toHaveProperty('security')
    expect(dims).toHaveProperty('political')
    expect(dims).toHaveProperty('economic')
    expect(dims).toHaveProperty('environmental')
    expect(dims).toHaveProperty('infrastructure')
    expect(dims).toHaveProperty('cyber')
    await app.close()
  })

  it('each dimension has score, weight, and signal_count', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    const body = JSON.parse(res.body) as { data: { dimensions: Record<string, { score: unknown; weight: unknown; signal_count: unknown }> } }
    for (const dim of Object.values(body.data.dimensions)) {
      expect(typeof dim.score).toBe('number')
      expect(typeof dim.weight).toBe('number')
      expect(typeof dim.signal_count).toBe('number')
    }
    await app.close()
  })

  it('risk_level is one of the expected values', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    const body = JSON.parse(res.body) as { data: { risk_level: string } }
    expect(['Low', 'Moderate', 'Elevated', 'High', 'Critical']).toContain(body.data.risk_level)
    await app.close()
  })

  it('trend is one of improving / stable / deteriorating', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    const body = JSON.parse(res.body) as { data: { trend: string } }
    expect(['improving', 'stable', 'deteriorating']).toContain(body.data.trend)
    await app.close()
  })

  it('serves from Redis cache when available', async () => {
    const cached = JSON.stringify({
      country_code: 'US', country_name: 'United States',
      composite_score: 72, risk_level: 'Moderate', risk_color: '#ffd700',
      trend: 'stable', trend_delta: 0, dimensions: {},
      signals_analyzed: 10, period_days: 30, computed_at: new Date().toISOString(),
    })
    mockRedisGet.mockResolvedValueOnce(cached)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/US/resilience' })
    expect(res.statusCode).toBe(200)
    // DB should NOT have been called
    expect(mockDb).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('GET /countries/resilience/rankings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisGet.mockResolvedValue(null)
    mockRedisSetex.mockResolvedValue('OK')
    // Rankings query returns array of country rows
    mockHaving.mockResolvedValue([
      {
        country_code: 'JP', signal_count: '12',
        sec_count: '1', sec_sev: '40',
        pol_count: '2', pol_sev: '40',
        eco_count: '3', eco_sev: '15',
        env_count: '1', env_sev: '40',
        inf_count: '1', inf_sev: '15',
        cyb_count: '0', cyb_sev: null,
      },
      {
        country_code: 'SY', signal_count: '30',
        sec_count: '10', sec_sev: '90',
        pol_count: '8',  pol_sev: '80',
        eco_count: '5',  eco_sev: '70',
        env_count: '4',  env_sev: '60',
        inf_count: '3',  inf_sev: '50',
        cyb_count: '2',  cyb_sev: '70',
      },
    ])
  })

  it('returns HTTP 200', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/resilience/rankings' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('returns success:true with a rankings array', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/resilience/rankings' })
    const body = JSON.parse(res.body) as { success: boolean; data: { rankings: unknown[] } }
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.rankings)).toBe(true)
    await app.close()
  })

  it('each ranking entry has required fields', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/resilience/rankings' })
    const body = JSON.parse(res.body) as { data: { rankings: Array<Record<string, unknown>> } }
    for (const entry of body.data.rankings) {
      expect(entry).toHaveProperty('country_code')
      expect(entry).toHaveProperty('composite_score')
      expect(entry).toHaveProperty('risk_level')
      expect(entry).toHaveProperty('risk_color')
      expect(entry).toHaveProperty('trend')
      expect(entry).toHaveProperty('signal_count')
    }
    await app.close()
  })

  it('composite scores are in 0-100 range', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/resilience/rankings' })
    const body = JSON.parse(res.body) as { data: { rankings: Array<{ composite_score: number }> } }
    for (const entry of body.data.rankings) {
      expect(entry.composite_score).toBeGreaterThanOrEqual(0)
      expect(entry.composite_score).toBeLessThanOrEqual(100)
    }
    await app.close()
  })

  it('accepts ?limit query parameter', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/countries/resilience/rankings?limit=10' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
