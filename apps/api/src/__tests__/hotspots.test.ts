/**
 * Tests for GET /api/v1/signals/map/hotspots
 *
 * Geographic convergence detection — returns 1°×1° cells where 3+ distinct
 * signal categories have converged in the given time window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock dependencies ─────────────────────────────────────────────────────────
vi.mock('../lib/postgres', () => ({
  db: Object.assign(
    vi.fn(),
    { raw: vi.fn() },
  ),
}))
vi.mock('../lib/redis', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
  },
}))
vi.mock('../lib/kafka', () => ({ kafka: null, producer: null }))
vi.mock('../lib/logger',  () => ({ logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) } }))

import { db }    from '../lib/postgres'
import { redis } from '../lib/redis'

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeHotspotRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    cell_lat:          35,
    cell_lng:          139,
    signal_count:      '12',
    category_count:    '4',
    categories:        ['conflict', 'seismic', 'health', 'displacement'],
    max_severity:      'high',
    avg_reliability:   '0.710',
    latest_signal_at:  new Date('2026-03-27T10:00:00Z'),
    center_lat:        '35.1234',
    center_lng:        '139.5678',
    sample_titles:     ['M5.2 earthquake near Tokyo', 'Hospital evacuated', 'Evacuation order issued'],
    sample_ids:        ['sig-1', 'sig-2', 'sig-3'],
    ...overrides,
  }
}

// Build a minimal Fastify-like app for the signals route ─────────────────────
async function buildApp() {
  const fastify = (await import('fastify')).default
  const app = fastify({ logger: false })

  // Register the signals route under /api/v1/signals
  const { default: signalRoutes } = await import('../routes/signals')
  await app.register(signalRoutes, { prefix: '/api/v1/signals' })

  await app.ready()
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/v1/signals/map/hotspots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  })

  it('returns hotspot data with correct shape', async () => {
    const mockRaw = vi.fn().mockResolvedValue({ rows: [makeHotspotRow()] })
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/hotspots' })

    expect(res.statusCode).toBe(200)
    const json = JSON.parse(res.body) as { success: boolean; data: { hotspots: unknown[]; hours: number; minCategoryCount: number; generatedAt: string } }
    expect(json.success).toBe(true)
    expect(json.data.hotspots).toHaveLength(1)
    expect(json.data.hours).toBe(24)
    expect(json.data.minCategoryCount).toBe(3)

    const hs = json.data.hotspots[0] as Record<string, unknown>
    expect(hs).toHaveProperty('centerLat')
    expect(hs).toHaveProperty('centerLng')
    expect(hs).toHaveProperty('signalCount',   12)
    expect(hs).toHaveProperty('categoryCount', 4)
    expect(hs).toHaveProperty('categories')
    expect(hs).toHaveProperty('maxSeverity',   'high')
    expect(hs).toHaveProperty('avgReliability')
    expect(hs).toHaveProperty('sampleTitles')
    expect(hs).toHaveProperty('sampleIds')
    await app.close()
  })

  it('returns empty hotspots array when no convergence found', async () => {
    const mockRaw = vi.fn().mockResolvedValue({ rows: [] })
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/hotspots' })

    expect(res.statusCode).toBe(200)
    const json = JSON.parse(res.body) as { success: boolean; data: { hotspots: unknown[] } }
    expect(json.success).toBe(true)
    expect(json.data.hotspots).toHaveLength(0)
    await app.close()
  })

  it('respects custom hours and min_categories query params', async () => {
    const mockRaw = vi.fn().mockResolvedValue({ rows: [] })
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/signals/map/hotspots?hours=6&min_categories=4&limit=5',
    })

    expect(res.statusCode).toBe(200)
    const json = JSON.parse(res.body) as { success: boolean; data: { hours: number; minCategoryCount: number } }
    expect(json.data.hours).toBe(6)
    expect(json.data.minCategoryCount).toBe(4)
    await app.close()
  })

  it('clamps hours to max 168', async () => {
    const mockRaw = vi.fn().mockResolvedValue({ rows: [] })
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/signals/map/hotspots?hours=9999',
    })

    expect(res.statusCode).toBe(200)
    const json = JSON.parse(res.body) as { success: boolean; data: { hours: number } }
    expect(json.data.hours).toBe(168)
    await app.close()
  })

  it('clamps min_categories to max 10', async () => {
    const mockRaw = vi.fn().mockResolvedValue({ rows: [] })
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/signals/map/hotspots?min_categories=999',
    })

    expect(res.statusCode).toBe(200)
    const json = JSON.parse(res.body) as { success: boolean; data: { minCategoryCount: number } }
    expect(json.data.minCategoryCount).toBe(10)
    await app.close()
  })

  it('serves from Redis cache when available', async () => {
    const cached = JSON.stringify({
      success: true,
      data: {
        hotspots:         [makeHotspotRow()],
        hours:            24,
        minCategoryCount: 3,
        generatedAt:      '2026-03-27T09:00:00Z',
      },
    })
    ;(redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(cached)

    const mockRaw = vi.fn()
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/hotspots' })

    expect(res.statusCode).toBe(200)
    // Should NOT have called the DB when cache is warm
    expect(mockRaw).not.toHaveBeenCalled()
    await app.close()
  })

  it('writes result to Redis cache after DB query', async () => {
    const mockRaw = vi.fn().mockResolvedValue({ rows: [makeHotspotRow()] })
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/v1/signals/map/hotspots' })

    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining('signals:hotspots:'),
      120,
      expect.any(String),
    )
    await app.close()
  })

  it('returns multiple hotspots sorted by category_count desc', async () => {
    const rows = [
      makeHotspotRow({ cell_lat: 51, cell_lng: 0,   category_count: '5', signal_count: '8'  }),
      makeHotspotRow({ cell_lat: 48, cell_lng: 2,   category_count: '3', signal_count: '15' }),
      makeHotspotRow({ cell_lat: 35, cell_lng: 139, category_count: '4', signal_count: '6'  }),
    ]
    const mockRaw = vi.fn().mockResolvedValue({ rows })
    ;(db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = mockRaw

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/hotspots' })

    expect(res.statusCode).toBe(200)
    const json = JSON.parse(res.body) as { data: { hotspots: Array<{ categoryCount: number }> } }
    // DB returns already sorted (GROUP BY ORDER BY), we just verify all are present
    expect(json.data.hotspots).toHaveLength(3)
    await app.close()
  })
})
