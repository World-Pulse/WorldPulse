/**
 * Unit tests for apps/scraper/src/pipeline/verify.ts
 *
 * Mocks the database, Redis, and logger so verifySignal can be exercised
 * in isolation across a range of article-group configurations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── DB mock ────────────────────────────────────────────────────────────────────

const dbInsertMock = vi.fn().mockResolvedValue([])
const dbTableMock  = vi.fn(() => ({ insert: dbInsertMock }))

vi.mock('../lib/postgres.js', () => ({ db: dbTableMock }))

// ── Redis mock ─────────────────────────────────────────────────────────────────

vi.mock('../lib/redis.js', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
  },
}))

// ── Logger mock ────────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { verifySignal } = await import('../pipeline/verify.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeArticle(overrides: {
  sourceId?:    string
  sourceTrust?: number
  sourceTier?:  string
  title?:       string
  url?:         string
} = {}) {
  return {
    sourceId:    overrides.sourceId    ?? 'src-1',
    sourceTrust: overrides.sourceTrust ?? 0.85,
    sourceTier:  overrides.sourceTier  ?? 'mainstream',
    title:       overrides.title       ?? 'Breaking news headline',
    url:         overrides.url         ?? 'https://example.com/article',
  }
}

const signal = { id: 'sig-test-1', severity: 'high', category: 'conflict' }

// ── verifySignal — status determination ───────────────────────────────────────

describe('verifySignal — status from score', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns status=verified for 3 high-trust wire sources (score >= 0.75)', async () => {
    const articles = [
      makeArticle({ sourceId: 'ap',      sourceTrust: 0.97, sourceTier: 'wire' }),
      makeArticle({ sourceId: 'reuters', sourceTrust: 0.96, sourceTier: 'wire' }),
      makeArticle({ sourceId: 'afp',     sourceTrust: 0.95, sourceTier: 'wire' }),
    ]
    const result = await verifySignal(signal, articles)
    expect(result.status).toBe('verified')
    expect(result.score).toBeGreaterThanOrEqual(0.75)
  })

  it('returns status=pending for a single mid-trust mainstream source (score in 0.30–0.74)', async () => {
    const articles = [
      makeArticle({ sourceId: 'blog-1', sourceTrust: 0.55, sourceTier: 'mainstream' }),
    ]
    const result = await verifySignal(signal, articles)
    expect(result.status).toBe('pending')
    expect(result.score).toBeGreaterThanOrEqual(0.30)
    expect(result.score).toBeLessThan(0.75)
  })

  it('returns status=pending for single low-trust community source (minimum score ~0.32)', async () => {
    // With 1 source: cross_source=0.333, temporal=0.5 (single ts), diversity=low, wire=0.3
    // The minimum weighted score is ~0.32, so single-source always yields 'pending'
    const articles = [
      makeArticle({ sourceId: 'anon-1', sourceTrust: 0.10, sourceTier: 'community' }),
    ]
    const result = await verifySignal(signal, articles)
    expect(result.status).toBe('pending')
    expect(result.score).toBeGreaterThanOrEqual(0.30)
    expect(result.score).toBeLessThan(0.75)
  })

  it('returns status=disputed when articles span >26h and come from a single low-trust source', async () => {
    // temporal score collapses to ~0 when spread > 26h, pushing total below 0.30
    const now = Date.now()
    const fiftyHoursAgo = new Date(now - 50 * 60 * 60 * 1000).toISOString()
    const articles = [
      { ...makeArticle({ sourceId: 'anon-2', sourceTrust: 0.10, sourceTier: 'community' }), publishedAt: fiftyHoursAgo },
      { ...makeArticle({ sourceId: 'anon-2', sourceTrust: 0.10, sourceTier: 'community' }), publishedAt: new Date(now).toISOString() },
    ]
    const result = await verifySignal(signal, articles)
    expect(result.status).toBe('disputed')
    expect(result.score).toBeLessThan(0.30)
  })

  it('score is always in the [0, 1] range', async () => {
    const articles = [
      makeArticle({ sourceId: 'a', sourceTrust: 1.0, sourceTier: 'wire' }),
      makeArticle({ sourceId: 'b', sourceTrust: 1.0, sourceTier: 'wire' }),
      makeArticle({ sourceId: 'c', sourceTrust: 1.0, sourceTier: 'wire' }),
    ]
    const result = await verifySignal(signal, articles)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})

// ── verifySignal — cross-source scoring ───────────────────────────────────────

describe('verifySignal — cross-source check', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('score improves as the number of unique sources increases', async () => {
    const oneSrc = [makeArticle({ sourceId: 'only-1' })]
    const threeSrc = [
      makeArticle({ sourceId: 'src-a' }),
      makeArticle({ sourceId: 'src-b' }),
      makeArticle({ sourceId: 'src-c' }),
    ]

    const single = await verifySignal(signal, oneSrc)
    const triple = await verifySignal(signal, threeSrc)

    expect(triple.score).toBeGreaterThan(single.score)
  })

  it('returns checkTypes array that includes cross_source', async () => {
    const articles = [makeArticle()]
    const result = await verifySignal(signal, articles)
    expect(result.checkTypes).toContain('cross_source')
  })

  it('returns a non-empty reasons array', async () => {
    const result = await verifySignal(signal, [makeArticle()])
    expect(result.reasons.length).toBeGreaterThan(0)
  })
})

// ── verifySignal — wire presence ──────────────────────────────────────────────

describe('verifySignal — wire presence bonus', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('score is higher when wire sources are present vs only mainstream', async () => {
    const wireArticles = [
      makeArticle({ sourceId: 'ap',  sourceTier: 'wire',       sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'reu', sourceTier: 'wire',       sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'ms',  sourceTier: 'mainstream', sourceTrust: 0.9 }),
    ]
    const mainstreamOnly = [
      makeArticle({ sourceId: 'ms-1', sourceTier: 'mainstream', sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'ms-2', sourceTier: 'mainstream', sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'ms-3', sourceTier: 'mainstream', sourceTrust: 0.9 }),
    ]

    const wireResult       = await verifySignal(signal, wireArticles)
    const mainstreamResult = await verifySignal(signal, mainstreamOnly)

    expect(wireResult.score).toBeGreaterThan(mainstreamResult.score)
  })

  it('checkTypes includes wire_presence', async () => {
    const result = await verifySignal(signal, [makeArticle({ sourceTier: 'wire' })])
    expect(result.checkTypes).toContain('wire_presence')
  })
})

// ── verifySignal — source diversity ──────────────────────────────────────────

describe('verifySignal — source diversity', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('mixed tiers score higher than single-tier sources', async () => {
    const mixedTier = [
      makeArticle({ sourceId: 'w1', sourceTier: 'wire',       sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'm1', sourceTier: 'mainstream', sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'c1', sourceTier: 'community',  sourceTrust: 0.9 }),
    ]
    const singleTier = [
      makeArticle({ sourceId: 'c1', sourceTier: 'community', sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'c2', sourceTier: 'community', sourceTrust: 0.9 }),
      makeArticle({ sourceId: 'c3', sourceTier: 'community', sourceTrust: 0.9 }),
    ]

    const mixed  = await verifySignal(signal, mixedTier)
    const single = await verifySignal(signal, singleTier)

    expect(mixed.score).toBeGreaterThan(single.score)
  })

  it('checkTypes includes source_diversity', async () => {
    const result = await verifySignal(signal, [makeArticle()])
    expect(result.checkTypes).toContain('source_diversity')
  })
})

// ── verifySignal — DB logging ─────────────────────────────────────────────────

describe('verifySignal — persistence', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls db("verification_log").insert() once per verification run', async () => {
    await verifySignal(signal, [makeArticle()])
    expect(dbTableMock).toHaveBeenCalledWith('verification_log')
    expect(dbInsertMock).toHaveBeenCalledOnce()
  })

  it('logs each check type as a separate row', async () => {
    await verifySignal(signal, [makeArticle()])
    const [rows] = dbInsertMock.mock.calls[0] as [Array<Record<string, unknown>>]
    // At minimum: cross_source, temporal, source_diversity, wire_presence
    expect(rows.length).toBeGreaterThanOrEqual(4)
  })

  it('each logged row contains signal_id, check_type, result, and confidence', async () => {
    await verifySignal(signal, [makeArticle()])
    const [rows] = dbInsertMock.mock.calls[0] as [Array<Record<string, unknown>>]
    for (const row of rows) {
      expect(row).toHaveProperty('signal_id', signal.id)
      expect(row).toHaveProperty('check_type')
      expect(row).toHaveProperty('result')
      expect(row).toHaveProperty('confidence')
    }
  })
})
