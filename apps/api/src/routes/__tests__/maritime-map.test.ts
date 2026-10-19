/**
 * maritime-map.test.ts
 *
 * Test suite for the Maritime AIS signals map overlay endpoint:
 *   GET /api/v1/signals/map/maritime
 *
 * The endpoint returns a GeoJSON FeatureCollection of the last 72 hours'
 * ship, port and strait stories, found by their headlines (the map's Ships
 * layer; lib/sea-headlines.ts). Redis is used for 120s caching.
 *
 * All DB and Redis calls are mocked so the suite runs in CI without
 * a real database or cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerSignalRoutes } from '../signals'
import { MARITIME_CANDIDATE } from '../../lib/sea-headlines'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRedis = {
  get:   vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
}
// (a getter: the module under test is imported, hoisted, before this file's consts exist; reading one in the factory threw and none of these tests ran. Oct 13, 2026)
vi.mock('../../db/redis', () => ({ get redis() { return mockRedis } }))

// Mock rows returned from db.raw()
const MOCK_MARITIME_ROWS = [
  {
    id:                'mar-1',
    title:             'MV Ever Given — Suez Canal transit',
    severity:          'medium',
    reliability_score: 0.75,
    published_at:      new Date('2026-03-30T12:00:00Z'),
    lat:               30.5841,
    lng:               32.2654,
  },
  {
    id:                'mar-2',
    title:             'Bulk carrier AIS gap — Red Sea',
    severity:          'high',
    reliability_score: 0.82,
    published_at:      new Date('2026-03-30T11:30:00Z'),
    lat:               15.1234,
    lng:               42.5678,
  },
  {
    id:                'mar-3',
    title:             'Container vessel rerouting — Cape of Good Hope',
    severity:          'low',
    reliability_score: 0.60,
    published_at:      new Date('2026-03-30T10:00:00Z'),
    lat:               -34.357,
    lng:               18.473,
  },
]

const mockDb = {
  raw: vi.fn().mockResolvedValue({ rows: MOCK_MARITIME_ROWS }),
  // longQuery (lib/long-query.ts) runs the query in a transaction with its own time limit
  transaction: vi.fn(async (run: (trx: unknown) => Promise<unknown>) => run({ raw: (...args: unknown[]) => mockDb.raw(...args) })),
}

/** What lib/swr-cache.ts keeps in Redis: the value and when it was made */
const kept = (payload: string) => JSON.stringify({ at: Date.now(), value: JSON.parse(payload) })
vi.mock('../../db/postgres', () => ({ get db() { return mockDb } }))

// Stub auth middleware (not used for this public-ish endpoint)
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(registerSignalRoutes, { prefix: '/api/v1/signals' })
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/signals/map/maritime', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRedis.get.mockResolvedValue(null)
    mockDb.raw.mockResolvedValue({ rows: MOCK_MARITIME_ROWS })
    app = await buildApp()
  })

  // ── 1. Successful response ─────────────────────────────────────────────────
  it('returns 200 with GeoJSON FeatureCollection', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ type: string; features: unknown[] }>()
    expect(body.type).toBe('FeatureCollection')
    expect(Array.isArray(body.features)).toBe(true)
  })

  // ── 2. Feature count ───────────────────────────────────────────────────────
  it('returns the correct number of features', async () => {
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ features: unknown[] }>()
    expect(body.features).toHaveLength(MOCK_MARITIME_ROWS.length)
  })

  // ── 3. Feature geometry ────────────────────────────────────────────────────
  it('each feature has Point geometry with [lng, lat] coordinates', async () => {
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ features: Array<{ geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> }> }>()
    for (const f of body.features) {
      expect(f.geometry.type).toBe('Point')
      expect(f.geometry.coordinates).toHaveLength(2)
      const [lng, lat] = f.geometry.coordinates
      expect(typeof lng).toBe('number')
      expect(typeof lat).toBe('number')
    }
  })

  // ── 4. Feature properties schema ──────────────────────────────────────────
  it('each feature has required properties: id, title, severity, reliability_score, published_at', async () => {
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ features: Array<{ properties: Record<string, unknown> }> }>()
    for (const f of body.features) {
      expect(f.properties).toHaveProperty('id')
      expect(f.properties).toHaveProperty('title')
      expect(f.properties).toHaveProperty('severity')
      expect(f.properties).toHaveProperty('reliability_score')
      expect(f.properties).toHaveProperty('published_at')
    }
  })

  // ── 5. Coordinates match mock data ─────────────────────────────────────────
  it('coordinates match the lat/lng from the DB rows', async () => {
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ features: Array<{ geometry: { coordinates: number[] }; properties: { id: string } }> }>()
    const first = body.features.find(f => f.properties.id === 'mar-1')
    expect(first).toBeDefined()
    expect(first!.geometry.coordinates[0]).toBeCloseTo(MOCK_MARITIME_ROWS[0].lng, 3)
    expect(first!.geometry.coordinates[1]).toBeCloseTo(MOCK_MARITIME_ROWS[0].lat, 3)
  })

  // ── 6. published_at is ISO string ─────────────────────────────────────────
  it('published_at is serialised as an ISO string', async () => {
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ features: Array<{ properties: { published_at: string } }> }>()
    for (const f of body.features) {
      expect(typeof f.properties.published_at).toBe('string')
      expect(() => new Date(f.properties.published_at)).not.toThrow()
    }
  })

  // ── 7. Cache miss — Redis setex called ────────────────────────────────────
  it('caches result in Redis on cache miss', async () => {
    mockRedis.get.mockResolvedValue(null)
    await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'signals:map:maritime:v3',
      120 + 6 * 3600,
      expect.any(String),
    )
  })

  // ── 8. Cache hit — DB not queried ─────────────────────────────────────────
  it('returns cached result without hitting DB on cache hit', async () => {
    const cachedPayload = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [32.2654, 30.5841] },
          properties: { id: 'cached-1', title: 'Cached vessel', severity: 'low', reliability_score: 0.5, published_at: '2026-03-30T12:00:00.000Z' },
        },
      ],
    })
    mockRedis.get.mockResolvedValue(kept(cachedPayload))
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    expect(res.statusCode).toBe(200)
    expect(mockDb.raw).not.toHaveBeenCalled()
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  // ── 9. Cache hit — correct feature count ──────────────────────────────────
  it('returns cached features correctly from cache', async () => {
    const cachedPayload = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [32.0, 31.0] },
          properties: { id: 'c-1', title: 'Cache test', severity: 'medium', reliability_score: 0.7, published_at: '2026-03-30T10:00:00.000Z' },
        },
      ],
    })
    mockRedis.get.mockResolvedValue(kept(cachedPayload))
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ features: unknown[] }>()
    expect(body.features).toHaveLength(1)
  })

  // ── 10. Empty DB — returns empty FeatureCollection ─────────────────────────
  it('returns empty FeatureCollection when DB returns no rows', async () => {
    mockDb.raw.mockResolvedValue({ rows: [] })
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ type: string; features: unknown[] }>()
    expect(body.type).toBe('FeatureCollection')
    expect(body.features).toHaveLength(0)
  })

  // ── 11. DB SQL finds the candidates with ONE headline pattern ─────────────
  it('asks the database with one headline pattern (more took past its 5-second limit)', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    expect(mockDb.raw).toHaveBeenCalledWith(expect.stringContaining('AND title ~* ?'), [MARITIME_CANDIDATE])
    const sql = String(mockDb.raw.mock.calls.find(c => String(c[0]).includes('FROM signals'))?.[0])
    expect(sql.match(/~\*/g)).toHaveLength(1)
  })

  // ── 11b. The finer checks run on the candidates ───────────────────────────
  it('leaves out a road tanker the database found', async () => {
    mockDb.raw.mockResolvedValue({ rows: [...MOCK_MARITIME_ROWS, { ...MOCK_MARITIME_ROWS[0], id: 'road-1', title: 'Tanker explosion claims two lives under Otedola Bridge' }] })
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const ids  = res.json<{ features: Array<{ properties: { id: string } }> }>().features.map(f => f.properties.id)
    expect(ids).toEqual(['mar-1', 'mar-2', 'mar-3'])
  })

  // ── 12. DB SQL targets the last 72 hours ──────────────────────────────────
  it('queries DB with a 72-hour time window', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    expect(mockDb.raw).toHaveBeenCalledWith(
      expect.stringContaining('72 hours'),
      expect.any(Array),
    )
  })

  // ── 13. Cache TTL is 120 seconds ──────────────────────────────────────────
  it('keeps the result 2 minutes fresh, and up to 6 hours more while the next is made', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const call = mockRedis.setex.mock.calls[0] as [string, number, string]
    expect(call[1]).toBe(120 + 6 * 3600)
  })

  // ── 14. Redis error is swallowed — response still succeeds ────────────────
  it('responds successfully even if Redis setex throws', async () => {
    mockRedis.setex.mockRejectedValue(new Error('Redis connection lost'))
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    expect(res.statusCode).toBe(200)
  })

  // ── 15. DB query limit is 500 ─────────────────────────────────────────────
  it('queries DB with LIMIT 500', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    expect(mockDb.raw).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT 500'),
      expect.any(Array),
    )
  })

  // ── 16. The same headline twice shows once ────────────────────────────────
  it('shows a headline once, the newest (rows come newest first)', async () => {
    mockDb.raw.mockResolvedValue({ rows: [MOCK_MARITIME_ROWS[0], { ...MOCK_MARITIME_ROWS[0], id: 'mar-1b' }, MOCK_MARITIME_ROWS[1]] })
    const res  = await app.inject({ method: 'GET', url: '/api/v1/signals/map/maritime' })
    const body = res.json<{ features: Array<{ properties: { id: string } }> }>()
    expect(body.features.map(f => f.properties.id)).toEqual(['mar-1', 'mar-2'])
  })
})
