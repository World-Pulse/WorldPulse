/**
 * Tests for GET /api/v1/admin/scraper/health
 *
 * Covers: auth enforcement, empty-source response, mixed-status summary,
 *         correct sort order (stale → failed → unknown → healthy),
 *         overallSuccessRate computation, and generatedAt timestamp.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify'

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockSmembers = vi.fn()
const mockHgetall  = vi.fn()

vi.mock('../db/redis', () => ({
  redis: {
    smembers: mockSmembers,
    hgetall:  mockHgetall,
    get:      vi.fn().mockResolvedValue(null),
    setex:    vi.fn().mockResolvedValue('OK'),
    set:      vi.fn().mockResolvedValue('OK'),
  },
}))

vi.mock('../db/postgres', () => ({
  db: { raw: vi.fn(), count: vi.fn(), select: vi.fn() },
}))

const mockAuthenticate = vi.fn()
vi.mock('../middleware/auth', () => ({
  authenticate: mockAuthenticate,
}))

vi.mock('../lib/security', () => ({
  getSecurityMetrics: vi.fn().mockResolvedValue(null),
}))

vi.mock('../lib/search-backfill', () => ({
  runFullReindex:             vi.fn(),
  syncRecentSignalsOnStartup: vi.fn(),
}))

// ─── Import under test ────────────────────────────────────────────────────────
const { registerAdminRoutes } = await import('../routes/admin')

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function recentIso() { return new Date(Date.now() - 60_000).toISOString()       } // 1 min  → healthy
function staleIso()  { return new Date(Date.now() - 35 * 60_000).toISOString()  } // 35 min → stale

const ADMIN_USER   = { id: 'u1', accountType: 'admin',  email: 'admin@test.com' }
const REGULAR_USER = { id: 'u2', accountType: 'user',   email: 'user@test.com'  }

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(registerAdminRoutes, { prefix: '/admin' })
  await app.ready()
  return app
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('GET /admin/scraper/health', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    // Default: simulate an authenticated admin request
    mockAuthenticate.mockImplementation(
      async (req: FastifyRequest) => { (req as unknown as { user: typeof ADMIN_USER }).user = ADMIN_USER },
    )
    mockSmembers.mockResolvedValue([])
    mockHgetall.mockResolvedValue({})
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  // ── Auth enforcement ───────────────────────────────────────────────────────
  it('returns 403 when authenticate does not set req.user', async () => {
    mockAuthenticate.mockImplementation(async (_req: FastifyRequest, _reply: FastifyReply) => {
      // deliberate no-op — req.user stays undefined
    })
    const res = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toMatchObject({ success: false, code: 'FORBIDDEN' })
  })

  it('returns 403 when user accountType is not admin', async () => {
    mockAuthenticate.mockImplementation(
      async (req: FastifyRequest) => { (req as unknown as { user: typeof REGULAR_USER }).user = REGULAR_USER },
    )
    const res = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    expect(res.statusCode).toBe(403)
  })

  // ── Empty sources ──────────────────────────────────────────────────────────
  it('returns 200 with zero-count summary when no sources are tracked', async () => {
    mockSmembers.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.data.summary).toMatchObject({
      total: 0, healthy: 0, stale: 0, failed: 0, unknown: 0,
    })
    expect(body.data.sources).toEqual([])
  })

  // ── Mixed-status summary ───────────────────────────────────────────────────
  it('returns correct counts for healthy, stale, failed, and unknown sources', async () => {
    mockSmembers.mockResolvedValue(['src-h', 'src-s', 'src-f', 'src-u'])
    mockHgetall.mockImplementation(async (key: string) => {
      if (key.includes('src-h')) {
        return { source_name: 'Healthy', last_seen: recentIso(), last_attempt: new Date().toISOString(), success_count: '10', error_count: '1' }
      }
      if (key.includes('src-s')) {
        return { source_name: 'Stale',   last_seen: staleIso(), last_attempt: new Date().toISOString(), success_count: '5', error_count: '0' }
      }
      if (key.includes('src-f')) {
        return { source_name: 'Failed',  last_seen: recentIso(), last_attempt: new Date().toISOString(), success_count: '1', error_count: '9' }
      }
      if (key.includes('src-u')) {
        return {} // no last_attempt → unknown
      }
      return {}
    })

    const res = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    expect(res.statusCode).toBe(200)
    const { data } = JSON.parse(res.body)
    expect(data.summary).toMatchObject({
      total: 4, healthy: 1, stale: 1, failed: 1, unknown: 1,
    })
  })

  // ── Sort order ─────────────────────────────────────────────────────────────
  it('sorts sources: stale → failed → unknown → healthy', async () => {
    mockSmembers.mockResolvedValue(['src-h', 'src-s', 'src-u', 'src-f'])
    mockHgetall.mockImplementation(async (key: string) => {
      if (key.includes('src-h')) return { source_name: 'H', last_seen: recentIso(), last_attempt: new Date().toISOString(), success_count: '5', error_count: '0' }
      if (key.includes('src-s')) return { source_name: 'S', last_seen: staleIso(), last_attempt: new Date().toISOString() }
      if (key.includes('src-u')) return {}  // unknown
      if (key.includes('src-f')) return { source_name: 'F', last_seen: recentIso(), last_attempt: new Date().toISOString(), success_count: '1', error_count: '9' }
      return {}
    })

    const res = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    const { data } = JSON.parse(res.body)
    const statuses = (data.sources as Array<{ status: string }>).map(s => s.status)
    expect(statuses.indexOf('stale')).toBeLessThan(statuses.indexOf('failed'))
    expect(statuses.indexOf('failed')).toBeLessThan(statuses.indexOf('unknown'))
    expect(statuses.indexOf('unknown')).toBeLessThan(statuses.indexOf('healthy'))
  })

  // ── overallSuccessRate ─────────────────────────────────────────────────────
  it('computes overallSuccessRate across all sources', async () => {
    mockSmembers.mockResolvedValue(['src-a', 'src-b'])
    mockHgetall.mockImplementation(async (key: string) => {
      if (key.includes('src-a')) return { source_name: 'A', last_seen: recentIso(), last_attempt: new Date().toISOString(), success_count: '6', error_count: '2' }
      if (key.includes('src-b')) return { source_name: 'B', last_seen: recentIso(), last_attempt: new Date().toISOString(), success_count: '4', error_count: '8' }
      return {}
    })

    const res = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    const { data } = JSON.parse(res.body)
    // 10 successes / 20 total = 0.5
    expect(data.summary.overallSuccessRate).toBeCloseTo(0.5, 2)
    expect(data.summary.totalSuccesses).toBe(10)
    expect(data.summary.totalErrors).toBe(10)
  })

  // ── generatedAt ─────────────────────────────────────────────────────────────
  it('includes a valid generatedAt ISO timestamp', async () => {
    const before = Date.now()
    const res    = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    const after  = Date.now()
    const { data } = JSON.parse(res.body)
    const ts = new Date(data.generatedAt as string).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  // ── Source fields ──────────────────────────────────────────────────────────
  it('returns per-source fields including sourceId, status, successRate, latencyMs', async () => {
    mockSmembers.mockResolvedValue(['src-x'])
    mockHgetall.mockResolvedValue({
      source_name:   'X',
      source_slug:   'x-slug',
      last_seen:     recentIso(),
      last_attempt:  new Date().toISOString(),
      success_count: '7',
      error_count:   '3',
      latency_ms:    '320',
    })

    const res = await app.inject({ method: 'GET', url: '/admin/scraper/health' })
    const { data } = JSON.parse(res.body)
    const src = data.sources[0] as Record<string, unknown>
    expect(src['sourceId']).toBe('src-x')
    expect(src['sourceName']).toBe('X')
    expect(src['sourceSlug']).toBe('x-slug')
    expect(src['status']).toBe('healthy')
    expect(src['latencyMs']).toBe(320)
    expect(src['successRate']).toBeCloseTo(0.7, 2)
  })
})
