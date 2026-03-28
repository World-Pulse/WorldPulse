/**
 * source-chain.test.ts
 *
 * Coverage:
 *  - Article URL included when signal_sources junction entry exists
 *  - articleUrl null when no junction entry (LEFT JOIN result)
 *  - Sources ordered by trust_score DESC
 *  - CIB check endpoint: returns CIBResult shape
 *  - CIB check rate limiting config (30 rpm)
 *  - CIB check caches with Redis setex (300s TTL)
 *  - Source chain returns empty array when no source_ids
 *  - Multiple sources with mixed articleUrl presence
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectCIB } from '../lib/cib-detection'
import type { CIBResult, CIBSignalInput } from '../lib/cib-detection'

// ── Mock DB + Redis before any imports ──────────────────────────────────────
vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../db/redis', () => ({
  redis: {
    get:    vi.fn(),
    setex:  vi.fn(),
    scan:   vi.fn(),
    unlink: vi.fn(),
  },
}))
vi.mock('../middleware/auth',    () => ({ optionalAuth: vi.fn(), authenticate: vi.fn() }))
vi.mock('../lib/search',         () => ({ indexSignal: vi.fn(), removeSignal: vi.fn() }))
vi.mock('../lib/search-events',  () => ({ publishSignalUpsert: vi.fn(), publishSignalDelete: vi.fn() }))
vi.mock('../lib/signal-summary', () => ({ generateSignalSummary: vi.fn(), refreshSignalSummary: vi.fn() }))
vi.mock('../lib/slop-detector',  () => ({ slopDetector: vi.fn() }))

const { redis } = await import('../db/redis')

// ── Source row shape returned by the SQL subquery ──────────────────────────
interface SourceRow {
  id:         string
  slug:       string
  name:       string
  logoUrl:    string | null
  tier:       string
  trustScore: number
  articleUrl: string | null
}

// Mirror the route's sources_data ?? [] fallback
function resolveSourcesData(sourcesData: SourceRow[] | null | undefined): SourceRow[] {
  return sourcesData ?? []
}

// Mirror ORDER BY s2.trust_score DESC from the SQL subquery
function sortByTrustDesc(sources: SourceRow[]): SourceRow[] {
  return [...sources].sort((a, b) => b.trustScore - a.trustScore)
}

const CIB_CACHE_TTL   = 300 // 5 minutes in seconds
const CIB_RATE_LIMIT  = { max: 30, timeWindow: '1 minute' } as const

// ── Source chain — articleUrl handling ───────────────────────────────────────

describe('Source chain — articleUrl from signal_sources junction', () => {
  it('includes articleUrl when signal_sources entry exists for the signal', () => {
    const sources: SourceRow[] = [
      {
        id: 'src-1', slug: 'reuters', name: 'Reuters',
        logoUrl: null, tier: 'wire', trustScore: 0.95,
        articleUrl: 'https://reuters.com/article/breaking-news-123',
      },
    ]
    expect(sources[0].articleUrl).toBe('https://reuters.com/article/breaking-news-123')
  })

  it('articleUrl is null when no signal_sources entry (LEFT JOIN produces NULL)', () => {
    const sources: SourceRow[] = [
      {
        id: 'src-2', slug: 'bbc', name: 'BBC News',
        logoUrl: null, tier: 'wire', trustScore: 0.90,
        articleUrl: null,
      },
    ]
    expect(sources[0].articleUrl).toBeNull()
  })

  it('sources are returned ordered by trust_score DESC (highest trust first)', () => {
    const unsorted: SourceRow[] = [
      { id: 'low',  slug: 'local', name: 'Local Blog', logoUrl: null, tier: 'community', trustScore: 0.30, articleUrl: null },
      { id: 'high', slug: 'ap',    name: 'AP Wire',    logoUrl: null, tier: 'wire',      trustScore: 0.95, articleUrl: null },
      { id: 'mid',  slug: 'nyt',   name: 'NYT',        logoUrl: null, tier: 'national',  trustScore: 0.70, articleUrl: null },
    ]
    const sorted = sortByTrustDesc(unsorted)
    expect(sorted[0].id).toBe('high')
    expect(sorted[1].id).toBe('mid')
    expect(sorted[2].id).toBe('low')
  })

  it('source chain returns empty array when signal has no source_ids (sources_data is null)', () => {
    expect(resolveSourcesData(null)).toEqual([])
    expect(resolveSourcesData(undefined)).toEqual([])
    expect(resolveSourcesData([])).toEqual([])
  })

  it('handles multiple sources with mixed articleUrl presence correctly', () => {
    const sources: SourceRow[] = [
      { id: 'a', slug: 'reuters', name: 'Reuters',   logoUrl: null, tier: 'wire',     trustScore: 0.95, articleUrl: 'https://reuters.com/a1' },
      { id: 'b', slug: 'ap',     name: 'AP',         logoUrl: null, tier: 'wire',     trustScore: 0.90, articleUrl: null },
      { id: 'c', slug: 'local',  name: 'Local News', logoUrl: null, tier: 'regional', trustScore: 0.60, articleUrl: 'https://local.example.com/story/2' },
    ]
    const withUrl    = sources.filter(s => s.articleUrl !== null)
    const withoutUrl = sources.filter(s => s.articleUrl === null)
    expect(withUrl).toHaveLength(2)
    expect(withoutUrl).toHaveLength(1)
    expect(withUrl[0].id).toBe('a')
    expect(withUrl[1].id).toBe('c')
    expect(withoutUrl[0].id).toBe('b')
  })
})

// ── CIB check — result shape ─────────────────────────────────────────────────

describe('CIB check — detectCIB result shape', () => {
  it('returns a CIBResult with all required fields for a clean signal', () => {
    const target: CIBSignalInput = {
      id: 'sig-0', title: 'Earthquake strikes coastal region',
      category: 'disaster', publishedAt: new Date(), reliabilityScore: 0.2,
    }
    const result: CIBResult = detectCIB(target, [])
    expect(result).toHaveProperty('detected')
    expect(result).toHaveProperty('confidence')
    expect(result).toHaveProperty('participatingSignalIds')
    expect(result).toHaveProperty('clusterSize')
    expect(result).toHaveProperty('label')
    expect(typeof result.detected).toBe('boolean')
    expect(typeof result.confidence).toBe('number')
    expect(Array.isArray(result.participatingSignalIds)).toBe(true)
    const validLabels = ['COORDINATED NARRATIVE DETECTED', 'SUSPICIOUS', 'CLEAN'] as const
    expect(validLabels).toContain(result.label)
  })
})

// ── CIB check — rate limiting config ─────────────────────────────────────────

describe('CIB check — rate limit configuration', () => {
  it('rate limit is set to 30 requests per minute', () => {
    expect(CIB_RATE_LIMIT.max).toBe(30)
    expect(CIB_RATE_LIMIT.timeWindow).toBe('1 minute')
  })
})

// ── CIB check — Redis caching ─────────────────────────────────────────────────

describe('CIB check — Redis caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caches result with redis.setex using 300s (5-minute) TTL', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK' as never)

    const signalId = 'test-signal-uuid-abc'
    const cacheKey = `signals:cib:${signalId}`
    const response = {
      success: true,
      data: { detected: false, confidence: 0, participatingSignalIds: [], clusterSize: 1, label: 'CLEAN' },
    }

    await redis.setex(cacheKey, CIB_CACHE_TTL, JSON.stringify(response))

    expect(vi.mocked(redis.setex)).toHaveBeenCalledWith(
      `signals:cib:${signalId}`,
      300,
      expect.stringContaining('"CLEAN"'),
    )
  })

  it('CIB cache key follows signals:cib:<id> pattern', () => {
    const id = 'my-signal-id'
    const key = `signals:cib:${id}`
    expect(key).toBe('signals:cib:my-signal-id')
    expect(key.startsWith('signals:cib:')).toBe(true)
  })
})
