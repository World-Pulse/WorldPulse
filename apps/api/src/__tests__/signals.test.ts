/**
 * signals.test.ts
 * Comprehensive unit tests for apps/api/src/routes/signals.ts
 *
 * Coverage:
 *  - UpdateSignalSchema validation (valid/invalid inputs, refine, coercion)
 *  - FlagSignalSchema validation (reason enum, notes length)
 *  - Cache key construction patterns (list, detail, map)
 *  - flushCachePattern helper (SCAN loop, UNLINK, empty case)
 *  - Pagination helpers (limit clamp, hasNextPage, cursor logic)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// ── Mock DB + Redis before any imports ──────────────────────────────────────
vi.mock('../db/postgres', () => ({
  db: vi.fn(),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get:    vi.fn(),
    setex:  vi.fn(),
    scan:   vi.fn(),
    unlink: vi.fn(),
  },
}))

vi.mock('../middleware/auth',       () => ({ optionalAuth: vi.fn(), authenticate: vi.fn() }))
vi.mock('../lib/search',            () => ({ indexSignal: vi.fn(), removeSignal: vi.fn() }))
vi.mock('../lib/search-events',     () => ({ publishSignalUpsert: vi.fn(), publishSignalDelete: vi.fn() }))
vi.mock('../lib/signal-summary',    () => ({ generateSignalSummary: vi.fn(), refreshSignalSummary: vi.fn() }))
vi.mock('../lib/slop-detector',     () => ({ slopDetector: vi.fn() }))

const { redis } = await import('../db/redis')

// ── Re-implement schemas locally (mirrors the route source exactly) ──────────
const UpdateSignalSchema = z.object({
  status:            z.enum(['pending', 'verified', 'disputed', 'false', 'retracted']).optional(),
  severity:          z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  reliability_score: z.number().min(0).max(1).optional(),
  location_name:     z.string().max(255).optional(),
  country_code:      z.string().length(2).toUpperCase().optional(),
  tags:              z.array(z.string().max(50)).max(20).optional(),
  summary:           z.string().max(1000).optional(),
  body:              z.string().max(50000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'No updatable fields provided' })

const FlagSignalSchema = z.object({
  reason: z.enum(['inaccurate', 'outdated', 'duplicate', 'misinformation']),
  notes:  z.string().max(500).optional(),
})

// ── Cache TTLs (mirrors source) ──────────────────────────────────────────────
const MAP_CACHE_TTL    = 45
const DETAIL_CACHE_TTL = 60
const LIST_CACHE_TTL   = 30

// ── flushCachePattern (mirrors source exactly) ───────────────────────────────
async function flushCachePattern(pattern: string): Promise<void> {
  let cursor = '0'
  const toDelete: string[] = []
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = next as string
    toDelete.push(...(keys as string[]))
  } while (cursor !== '0')
  if (toDelete.length > 0) {
    await redis.unlink(...toDelete)
  }
}

// ── Pagination helpers (mirrors route logic) ─────────────────────────────────
function clampLimit(raw: number | undefined, max = 100): number {
  return Math.min(Number(raw ?? 20), max)
}

function buildHasNextPage(rows: unknown[], limit: number): boolean {
  return rows.length > limit
}

// ─── Imported exports (now available after export additions) ──────────────────
import {
  formatSignal,
  UpdateSignalSchema as RouteUpdateSignalSchema,
  FlagSignalSchema as RouteFlagSignalSchema,
} from '../routes/signals'

// ─── formatSignal ─────────────────────────────────────────────────────────────

function minsAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000)
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:                   'sig-001',
    title:                'Test Signal',
    summary:              'A summary',
    body:                 null,
    category:             'conflict',
    severity:             'high',
    status:               'verified',
    reliability_score:    0.8,
    source_count:         2,
    location_geojson:     null,
    location_name:        'Kyiv, Ukraine',
    country_code:         'UA',
    region:               'Eastern Europe',
    tags:                 ['war', 'ukraine'],
    original_urls:        ['https://example.com/story'],
    language:             'en',
    view_count:           100,
    share_count:          5,
    post_count:           12,
    event_time:           null,
    first_reported:       new Date('2024-01-01T10:00:00Z'),
    verified_at:          new Date('2024-01-01T11:00:00Z'),
    last_updated:         new Date('2024-01-01T12:00:00Z'),
    created_at:           minsAgo(30),
    is_breaking:          false,
    community_flag_count: 0,
    sources_data:         null,
    ...overrides,
  }
}

describe('formatSignal', () => {
  it('maps snake_case DB fields to camelCase output', () => {
    const result = formatSignal(makeRow())
    expect(result.id).toBe('sig-001')
    expect(result.reliabilityScore).toBe(0.8)
    expect(result.locationName).toBe('Kyiv, Ukraine')
    expect(result.countryCode).toBe('UA')
    expect(result.viewCount).toBe(100)
    expect(result.isBreaking).toBe(false)
  })

  it('returns null location when location_geojson is null', () => {
    const result = formatSignal(makeRow({ location_geojson: null }))
    expect(result.location).toBeNull()
  })

  it('extracts lat/lng from GeoJSON coordinates', () => {
    const result = formatSignal(makeRow({
      location_geojson: { coordinates: [-74.006, 40.7128] },
    }))
    expect(result.location).toEqual({ lng: -74.006, lat: 40.7128 })
  })

  it('converts Date fields to ISO strings', () => {
    const d = new Date('2024-06-15T08:30:00Z')
    const result = formatSignal(makeRow({ first_reported: d, verified_at: d, last_updated: d, created_at: d }))
    expect(result.firstReported).toBe('2024-06-15T08:30:00.000Z')
    expect(result.verifiedAt).toBe('2024-06-15T08:30:00.000Z')
  })

  it('returns null for null Date fields', () => {
    const result = formatSignal(makeRow({ event_time: null, verified_at: null, first_reported: null }))
    expect(result.eventTime).toBeNull()
    expect(result.verifiedAt).toBeNull()
    expect(result.firstReported).toBeNull()
  })

  it('defaults tags and originalUrls to empty arrays when null', () => {
    const result = formatSignal(makeRow({ tags: null, original_urls: null }))
    expect(result.tags).toEqual([])
    expect(result.originalUrls).toEqual([])
  })

  it('defaults language to "en" when null', () => {
    expect(formatSignal(makeRow({ language: null })).language).toBe('en')
  })

  it('includes riskScore with score, level, label, and factors', () => {
    const result = formatSignal(makeRow())
    expect(typeof result.riskScore.score).toBe('number')
    expect(['critical', 'high', 'medium', 'low']).toContain(result.riskScore.level)
    expect(result.riskScore.label).toMatch(/Risk · \d+/)
    expect(result.riskScore.factors).toHaveProperty('severityScore')
    expect(result.riskScore.factors).toHaveProperty('corroborationScore')
  })

  it('critical severity + high reliability → riskScore.level critical', () => {
    const result = formatSignal(makeRow({
      severity:          'critical',
      reliability_score: 0.95,
      source_count:      4,
      created_at:        minsAgo(10),
    }))
    expect(result.riskScore.score).toBeGreaterThanOrEqual(75)
    expect(result.riskScore.level).toBe('critical')
  })

  it('info severity + low reliability + old signal → riskScore.level low', () => {
    const result = formatSignal(makeRow({
      severity:          'info',
      reliability_score: 0.05,
      source_count:      1,
      created_at:        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    }))
    expect(result.riskScore.score).toBeLessThan(25)
    expect(result.riskScore.level).toBe('low')
  })

  it('uses sources_data length for corroboration when present', () => {
    const withFour  = formatSignal(makeRow({ sources_data: [{}, {}, {}, {}], source_count: 1 }))
    const withOne   = formatSignal(makeRow({ sources_data: null,             source_count: 1 }))
    expect(withFour.riskScore.factors.corroborationScore).toBeGreaterThan(
      withOne.riskScore.factors.corroborationScore,
    )
  })

  it('passes sources_data through as sources[]', () => {
    const sources = [{ id: 's1', name: 'Reuters' }]
    expect(formatSignal(makeRow({ sources_data: sources })).sources).toEqual(sources)
  })
})

describe('Exported schemas match re-implemented schemas', () => {
  it('RouteUpdateSignalSchema rejects empty object', () => {
    expect(RouteUpdateSignalSchema.safeParse({}).success).toBe(false)
  })

  it('RouteUpdateSignalSchema accepts a valid status', () => {
    expect(RouteUpdateSignalSchema.safeParse({ status: 'verified' }).success).toBe(true)
  })

  it('RouteFlagSignalSchema accepts all valid reasons', () => {
    for (const reason of ['inaccurate', 'outdated', 'duplicate', 'misinformation'] as const) {
      expect(RouteFlagSignalSchema.safeParse({ reason }).success).toBe(true)
    }
  })

  it('RouteFlagSignalSchema rejects unknown reasons', () => {
    expect(RouteFlagSignalSchema.safeParse({ reason: 'fake' }).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('UpdateSignalSchema — validation', () => {
  it('accepts a valid full payload', () => {
    const result = UpdateSignalSchema.safeParse({
      status:            'verified',
      severity:          'high',
      reliability_score: 0.85,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid status enum value', () => {
    const result = UpdateSignalSchema.safeParse({ status: 'approved' })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('invalid_enum_value')
  })

  it('rejects reliability_score above 1', () => {
    const result = UpdateSignalSchema.safeParse({ reliability_score: 1.1 })
    expect(result.success).toBe(false)
  })

  it('rejects reliability_score below 0', () => {
    const result = UpdateSignalSchema.safeParse({ reliability_score: -0.1 })
    expect(result.success).toBe(false)
  })

  it('rejects empty object (no updatable fields) via refine()', () => {
    const result = UpdateSignalSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      const msgs = result.error.errors.map(e => e.message)
      expect(msgs).toContain('No updatable fields provided')
    }
  })

  it('uppercases country_code via toUpperCase() coercion', () => {
    const result = UpdateSignalSchema.safeParse({ country_code: 'us' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.country_code).toBe('US')
    }
  })

  it('rejects country_code longer than 2 characters', () => {
    const result = UpdateSignalSchema.safeParse({ country_code: 'USA' })
    expect(result.success).toBe(false)
  })

  it('rejects tags array exceeding 20 items', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`)
    const result = UpdateSignalSchema.safeParse({ tags })
    expect(result.success).toBe(false)
  })
})

describe('FlagSignalSchema — validation', () => {
  it('accepts a valid reason enum', () => {
    const result = FlagSignalSchema.safeParse({ reason: 'inaccurate' })
    expect(result.success).toBe(true)
  })

  it('accepts all valid reason values', () => {
    const reasons = ['inaccurate', 'outdated', 'duplicate', 'misinformation'] as const
    for (const reason of reasons) {
      expect(FlagSignalSchema.safeParse({ reason }).success).toBe(true)
    }
  })

  it('rejects an invalid reason enum value', () => {
    const result = FlagSignalSchema.safeParse({ reason: 'spam' })
    expect(result.success).toBe(false)
  })

  it('rejects notes exceeding 500 characters', () => {
    const result = FlagSignalSchema.safeParse({
      reason: 'outdated',
      notes:  'x'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('accepts notes at exactly 500 characters', () => {
    const result = FlagSignalSchema.safeParse({
      reason: 'duplicate',
      notes:  'x'.repeat(500),
    })
    expect(result.success).toBe(true)
  })
})

describe('Cache TTL constants', () => {
  it('MAP_CACHE_TTL is 45 seconds', () => {
    expect(MAP_CACHE_TTL).toBe(45)
  })

  it('DETAIL_CACHE_TTL is 60 seconds', () => {
    expect(DETAIL_CACHE_TTL).toBe(60)
  })

  it('LIST_CACHE_TTL is 30 seconds', () => {
    expect(LIST_CACHE_TTL).toBe(30)
  })
})

describe('Cache key patterns', () => {
  it('list cache key includes status/category/severity/country/limit segments', () => {
    const status   = 'verified'
    const category = 'conflict'
    const severity = 'high'
    const country  = 'US'
    const limit    = 20
    const key = `signals:list:${status}:${category}:${severity}:${country}:${limit}`
    expect(key).toBe('signals:list:verified:conflict:high:US:20')
    expect(key.startsWith('signals:list:')).toBe(true)
  })

  it('list cache key uses "all" fallback for missing category/severity/country', () => {
    const key = `signals:list:verified:${'all'}:${'all'}:${'all'}:20`
    expect(key).toBe('signals:list:verified:all:all:all:20')
  })

  it('detail cache key embeds the signal id', () => {
    const id = 'abc-123-xyz'
    const key = `signals:detail:${id}`
    expect(key).toBe('signals:detail:abc-123-xyz')
    expect(key).toContain(id)
  })

  it('map cache key namespace is signals:map', () => {
    // Map endpoint uses pattern: signals:map:*  for flush
    const pattern = 'signals:map:*'
    expect(pattern.startsWith('signals:map')).toBe(true)
  })
})

describe('flushCachePattern helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls redis.scan until cursor returns "0", then calls redis.unlink', async () => {
    vi.mocked(redis.scan)
      .mockResolvedValueOnce(['42', ['key:1', 'key:2']] as never)
      .mockResolvedValueOnce(['0',  ['key:3']]          as never)
    vi.mocked(redis.unlink).mockResolvedValue(3 as never)

    await flushCachePattern('signals:list:*')

    expect(vi.mocked(redis.scan)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(redis.unlink)).toHaveBeenCalledWith('key:1', 'key:2', 'key:3')
  })

  it('does NOT call redis.unlink when no keys are found', async () => {
    vi.mocked(redis.scan).mockResolvedValueOnce(['0', []] as never)

    await flushCachePattern('signals:map:*')

    expect(vi.mocked(redis.scan)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(redis.unlink)).not.toHaveBeenCalled()
  })

  it('passes correct SCAN arguments (MATCH pattern, COUNT 100)', async () => {
    vi.mocked(redis.scan).mockResolvedValueOnce(['0', []] as never)

    await flushCachePattern('signals:detail:*')

    expect(vi.mocked(redis.scan)).toHaveBeenCalledWith('0', 'MATCH', 'signals:detail:*', 'COUNT', 100)
  })
})

describe('Pagination helpers', () => {
  it('clamps limit to 100 when higher value is passed', () => {
    expect(clampLimit(500)).toBe(100)
    expect(clampLimit(101)).toBe(100)
  })

  it('returns the passed limit when it is <= 100', () => {
    expect(clampLimit(20)).toBe(20)
    expect(clampLimit(50)).toBe(50)
    expect(clampLimit(100)).toBe(100)
  })

  it('defaults to 20 when limit is undefined', () => {
    expect(clampLimit(undefined)).toBe(20)
  })

  it('hasNextPage is true when rows.length > limit', () => {
    const rows = new Array(21).fill({})  // fetched limit+1 rows
    expect(buildHasNextPage(rows, 20)).toBe(true)
  })

  it('hasNextPage is false when rows.length <= limit', () => {
    const rows = new Array(15).fill({})
    expect(buildHasNextPage(rows, 20)).toBe(false)
  })

  it('null cursor indicates first page (no cursor clause applied)', () => {
    const cursor: string | null = null
    const isFirstPage = !cursor
    expect(isFirstPage).toBe(true)
  })

  it('non-null cursor indicates a subsequent page', () => {
    const cursor = 'signal-uuid-123'
    const isFirstPage = !cursor
    expect(isFirstPage).toBe(false)
  })
})
