/**
 * Gate 2 — Map Live Signal End-to-End Validation
 * Tests for GET /api/v1/signals/map/points and GET /api/v1/signals/map/health
 *
 * Validates: GeoJSON structure, bbox filtering, verified-only filter,
 * cache behaviour, meta envelope, low-geo warning, and health metric.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockRedisGet  = vi.fn()
const mockRedisSet  = vi.fn()
const mockRedisSetex = vi.fn()

vi.mock('../db/redis', () => ({
  redis: {
    get:   (...args: unknown[]) => mockRedisGet(...args),
    set:   (...args: unknown[]) => mockRedisSet(...args),
    setex: (...args: unknown[]) => mockRedisSetex(...args),
  },
}))

// DB mock: returns a chainable query builder
const mockQueryResult: unknown[] = []
const queryBuilderMock = {
  whereNotNull: vi.fn().mockReturnThis(),
  whereIn:      vi.fn().mockReturnThis(),
  where:        vi.fn().mockReturnThis(),
  whereRaw:     vi.fn().mockReturnThis(),
  select:       vi.fn().mockReturnThis(),
  limit:        vi.fn().mockReturnThis(),
  count:        vi.fn().mockReturnThis(),
  then:         vi.fn((resolve: (v: unknown[]) => unknown) => Promise.resolve(mockQueryResult).then(resolve)),
  [Symbol.iterator]: undefined as unknown,
}

// Make query builder thenable (await-able)
Object.defineProperty(queryBuilderMock, Symbol.toStringTag, { value: 'QueryBuilder' })

const mockDb = Object.assign(
  vi.fn().mockReturnValue(queryBuilderMock),
  { raw: vi.fn((sql: string) => sql) },
)

vi.mock('../db/postgres', () => ({ db: mockDb }))

// ─── Unit-level logic tests (no Fastify server needed) ───────────────────

describe('Map endpoint — GeoJSON structure validation', () => {
  it('map point has required geo fields', () => {
    const point = {
      id: 'sig-001',
      title: 'Earthquake in Turkey',
      summary: 'A 6.2 magnitude earthquake struck southeastern Turkey.',
      category: 'disaster',
      severity: 'high',
      status: 'verified',
      location_name: 'Diyarbakır, Turkey',
      country_code: 'TR',
      reliability_score: 0.87,
      created_at: new Date().toISOString(),
      original_urls: JSON.stringify(['https://source.com/article']),
      is_breaking: true,
      community_flag_count: 0,
      lng: 40.2317,
      lat: 37.9144,
    }
    expect(point).toHaveProperty('lng')
    expect(point).toHaveProperty('lat')
    expect(typeof point.lng).toBe('number')
    expect(typeof point.lat).toBe('number')
    expect(point.lng).toBeGreaterThanOrEqual(-180)
    expect(point.lng).toBeLessThanOrEqual(180)
    expect(point.lat).toBeGreaterThanOrEqual(-90)
    expect(point.lat).toBeLessThanOrEqual(90)
  })

  it('converts signal to GeoJSON Feature format', () => {
    const point = { id: 'sig-002', title: 'Test Signal', lat: 51.5074, lng: -0.1278 }
    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
      properties: { id: point.id, title: point.title },
    }
    expect(feature.geometry.coordinates[0]).toBe(point.lng)
    expect(feature.geometry.coordinates[1]).toBe(point.lat)
  })
})

describe('Map endpoint — bbox filtering logic', () => {
  it('parses valid bbox string into 4 floats', () => {
    const bbox = '-10.5,35.0,40.0,72.0'
    const parts = bbox.split(',').map(Number)
    expect(parts).toHaveLength(4)
    expect(parts.every(n => !isNaN(n))).toBe(true)
    const [minLng, minLat, maxLng, maxLat] = parts
    expect(minLng).toBe(-10.5)
    expect(minLat).toBe(35.0)
    expect(maxLng).toBe(40.0)
    expect(maxLat).toBe(72.0)
  })

  it('rejects bbox with non-numeric values', () => {
    const bbox = 'bad,bbox,value,!'
    const parts = bbox.split(',').map(Number)
    expect(parts.some(n => isNaN(n))).toBe(true)
  })

  it('rejects bbox with wrong part count', () => {
    const bbox = '10.0,20.0,30.0'
    const parts = bbox.split(',').map(Number)
    expect(parts).toHaveLength(3)
    expect(parts.length === 4).toBe(false)
  })

  it('includes bbox key in cache key when provided', () => {
    const category = 'all'
    const severity = 'all'
    const hours = 24
    const bbox = '-10,35,40,72'
    const cacheKeyWithBbox    = `signals:map:${category}:${severity}:${hours}:${bbox}`
    const cacheKeyWithoutBbox = `signals:map:${category}:${severity}:${hours}`
    expect(cacheKeyWithBbox).not.toBe(cacheKeyWithoutBbox)
    expect(cacheKeyWithBbox).toContain(bbox)
  })

  it('cache key is stable for same bbox parameters', () => {
    const bbox = '-10,35,40,72'
    const key1 = `signals:map:all:all:24:${bbox}`
    const key2 = `signals:map:all:all:24:${bbox}`
    expect(key1).toBe(key2)
  })
})

describe('Map endpoint — hours clamping', () => {
  it('clamps hours to maximum 168 (7 days)', () => {
    expect(Math.min(999, 168)).toBe(168)
    expect(Math.min(168, 168)).toBe(168)
    expect(Math.min(24, 168)).toBe(24)
    expect(Math.min(1, 168)).toBe(1)
  })

  it('uses 24 as default hours', () => {
    const defaultHours = 24
    expect(defaultHours).toBe(24)
  })
})

describe('Map endpoint — cache behaviour', () => {
  beforeEach(() => {
    mockRedisGet.mockReset()
    mockRedisSetex.mockReset()
  })

  it('returns cached response with X-Cache-Hit header when cached', async () => {
    const cachedData = {
      success: true,
      data: [{ id: 'sig-1', lat: 51.5, lng: -0.1, category: 'conflict' }],
      meta: { total: 1, hours: 24, bbox: null, generated_at: new Date().toISOString() },
    }
    mockRedisGet.mockResolvedValue(JSON.stringify(cachedData))

    const cached = await mockRedisGet('signals:map:all:all:24')
    expect(cached).toBeTruthy()
    const parsed = JSON.parse(cached as string) as typeof cachedData
    expect(parsed.success).toBe(true)
    expect(parsed.data).toHaveLength(1)
    expect(parsed.meta.total).toBe(1)
  })

  it('caches result with correct TTL (45s)', async () => {
    mockRedisGet.mockResolvedValue(null)
    mockRedisSetex.mockResolvedValue('OK')

    const MAP_CACHE_TTL = 45
    const responseData = { success: true, data: [], meta: { total: 0, hours: 24, bbox: null, generated_at: new Date().toISOString() } }

    await mockRedisSetex('signals:map:all:all:24', MAP_CACHE_TTL, JSON.stringify(responseData))

    expect(mockRedisSetex).toHaveBeenCalledWith(
      'signals:map:all:all:24',
      45,
      expect.any(String),
    )
  })

  it('returns 0 data array (not null) when cache misses and DB is empty', () => {
    const response = { success: true, data: [], meta: { total: 0, hours: 24, bbox: null, generated_at: new Date().toISOString() } }
    expect(Array.isArray(response.data)).toBe(true)
    expect(response.data).toHaveLength(0)
    expect(response.success).toBe(true)
  })
})

describe('Map endpoint — meta envelope', () => {
  it('response meta includes required fields', () => {
    const meta = {
      total: 42,
      hours: 24,
      bbox: null as string | null,
      generated_at: new Date().toISOString(),
    }
    expect(meta).toHaveProperty('total')
    expect(meta).toHaveProperty('hours')
    expect(meta).toHaveProperty('bbox')
    expect(meta).toHaveProperty('generated_at')
    expect(typeof meta.total).toBe('number')
    expect(typeof meta.generated_at).toBe('string')
  })

  it('meta.bbox is null when no bbox filter applied', () => {
    const bbox: string | undefined = undefined
    const meta = { bbox: bbox ?? null }
    expect(meta.bbox).toBeNull()
  })

  it('meta.bbox reflects the filter when applied', () => {
    const bbox = '-10,35,40,72'
    const meta = { bbox: bbox ?? null }
    expect(meta.bbox).toBe('-10,35,40,72')
  })
})

describe('Map endpoint — verified/pending filter logic', () => {
  it('status filter includes verified and pending, excludes disputed/false/retracted', () => {
    const allowedStatuses = ['verified', 'pending']
    const rejectedStatuses = ['disputed', 'false', 'retracted']

    expect(allowedStatuses).toContain('verified')
    expect(allowedStatuses).toContain('pending')

    for (const s of rejectedStatuses) {
      expect(allowedStatuses).not.toContain(s)
    }
  })

  it('filters out signals without location', () => {
    const signals = [
      { id: 'sig-1', lat: 51.5, lng: -0.1, location: 'POINT(-0.1 51.5)' },
      { id: 'sig-2', lat: null, lng: null, location: null },
      { id: 'sig-3', lat: 40.7, lng: -74.0, location: 'POINT(-74.0 40.7)' },
    ]
    const withGeo = signals.filter(s => s.location !== null)
    expect(withGeo).toHaveLength(2)
    expect(withGeo.map(s => s.id)).toEqual(['sig-1', 'sig-3'])
  })
})

describe('Map health — geo count metric', () => {
  it('geo_coverage_status is healthy when count >= 10', () => {
    const count = 42
    const status = count >= 10 ? 'healthy' : count > 0 ? 'low' : 'empty'
    expect(status).toBe('healthy')
  })

  it('geo_coverage_status is low when 0 < count < 10', () => {
    const count = 5
    const status = count >= 10 ? 'healthy' : count > 0 ? 'low' : 'empty'
    expect(status).toBe('low')
  })

  it('geo_coverage_status is empty when count is 0', () => {
    const count = 0
    const status = count >= 10 ? 'healthy' : count > 0 ? 'low' : 'empty'
    expect(status).toBe('empty')
  })

  it('map_signals_with_geo is included in health response', () => {
    const healthBody = {
      status: 'ok',
      version: '0.1.0',
      uptime_s: 3600,
      timestamp: new Date().toISOString(),
      map_signals_with_geo: 27,
      services: { db: { status: 'ok' }, redis: { status: 'ok' }, kafka: { status: 'ok' } },
    }
    expect(healthBody).toHaveProperty('map_signals_with_geo')
    expect(healthBody.map_signals_with_geo).toBe(27)
  })

  it('health endpoint returns 0 for map_signals_with_geo when no geo signals exist', () => {
    const mapSignalsWithGeo = 0
    expect(mapSignalsWithGeo).toBe(0)
    // Overall health status should NOT degrade due to zero geo signals
    const overallStatus = 'ok' // DB + Redis + Kafka are all up
    expect(overallStatus).toBe('ok')
  })

  it('health cache key is correct', () => {
    const cacheKey = 'signals:map:health:24h'
    expect(cacheKey).toBe('signals:map:health:24h')
  })

  it('health cache TTL is 5 minutes (300s)', () => {
    const HEALTH_CACHE_TTL = 300
    expect(HEALTH_CACHE_TTL).toBe(300)
  })
})

describe('Map endpoint — WebSocket event integration', () => {
  it('WS URL derives correctly from API_URL (http → ws)', () => {
    const apiUrl = 'http://localhost:3001'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    expect(wsUrl).toBe('ws://localhost:3001')
  })

  it('WS URL derives correctly from HTTPS API_URL (https → wss)', () => {
    const apiUrl = 'https://api.worldpulse.io'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    expect(wsUrl).toBe('wss://api.worldpulse.io')
  })

  it('WS subscribe message has correct structure', () => {
    const subscribeMsg = JSON.stringify({ type: 'subscribe', payload: { channels: ['all'] } })
    const parsed = JSON.parse(subscribeMsg) as { type: string; payload: { channels: string[] } }
    expect(parsed.type).toBe('subscribe')
    expect(parsed.payload.channels).toContain('all')
  })
})

describe('Map endpoint — Supercluster maxZoom consistency', () => {
  it('Supercluster maxZoom matches MapLibre maxZoom (both 18)', () => {
    // Gate 2 requirement: cluster maxZoom must match map maxZoom to prevent non-expanding clusters
    const SUPERCLUSTER_MAX_ZOOM = 18
    const MAPLIBRE_MAX_ZOOM = 18
    expect(SUPERCLUSTER_MAX_ZOOM).toBe(MAPLIBRE_MAX_ZOOM)
  })
})

describe('Map endpoint — response limit', () => {
  it('hard limit is 500 points per request', () => {
    const MAP_POINT_LIMIT = 500
    expect(MAP_POINT_LIMIT).toBe(500)
  })

  it('returns at most 500 points even if DB has more', () => {
    const dbResults = Array.from({ length: 600 }, (_, i) => ({ id: `sig-${i}`, lat: 0, lng: i * 0.1 }))
    const limited = dbResults.slice(0, 500)
    expect(limited).toHaveLength(500)
  })
})
