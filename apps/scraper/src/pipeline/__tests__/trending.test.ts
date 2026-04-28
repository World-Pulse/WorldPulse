/**
 * Unit tests for apps/scraper/src/pipeline/trending.ts
 *
 * Mocks the database and exercises the momentum classification logic,
 * delta computation, score calculation, and top-15 slice behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── DB mock ──────────────────────────────────────────────────────────────────

type MockRow = { tag: string; count: string; category?: string | null; engagement?: string }

let currentRows: MockRow[]  = []
let previousRows: MockRow[] = []
let engagementRows: MockRow[] = []

const dbRawMock = vi.fn()

vi.mock('../../lib/postgres.js', () => ({
  db: { raw: dbRawMock },
}))

// ─── Helper ───────────────────────────────────────────────────────────────────

function seedDb(
  curr:     MockRow[],
  prev:     MockRow[],
  eng:      MockRow[] = [],
) {
  currentRows    = curr
  previousRows   = prev
  engagementRows = eng

  dbRawMock.mockImplementation((sql: string) => {
    if (sql.includes('MODE()')) {
      return Promise.resolve({ rows: currentRows })
    }
    if (sql.includes('BETWEEN')) {
      return Promise.resolve({ rows: previousRows })
    }
    // Engagement query
    return Promise.resolve({ rows: engagementRows })
  })
}

const { computeTrending } = await import('../trending.js')

// ─── computeTrending ──────────────────────────────────────────────────────────

describe('computeTrending', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns an empty array when there are no current signals', async () => {
    seedDb([], [], [])
    const results = await computeTrending('1h')
    expect(results).toEqual([])
  })

  it('assigns momentum=surging when delta > 100%', async () => {
    seedDb(
      [{ tag: 'earthquake', count: '10', category: 'disaster' }],
      [{ tag: 'earthquake', count: '4' }], // delta = (10-4)/4 * 100 = 150%
    )
    const [result] = await computeTrending('1h')
    expect(result.momentum).toBe('surging')
    expect(result.delta).toBeGreaterThan(100)
  })

  it('assigns momentum=rising when delta is between 30% and 100%', async () => {
    seedDb(
      [{ tag: 'flood', count: '10', category: 'disaster' }],
      [{ tag: 'flood', count: '7' }], // delta = (10-7)/7 * 100 ≈ 43%
    )
    const [result] = await computeTrending('6h')
    expect(result.momentum).toBe('rising')
    expect(result.delta).toBeGreaterThan(30)
    expect(result.delta).toBeLessThanOrEqual(100)
  })

  it('assigns momentum=steady when delta is between -20% and 30%', async () => {
    seedDb(
      [{ tag: 'politics', count: '10', category: 'politics' }],
      [{ tag: 'politics', count: '9' }], // delta ≈ 11%
    )
    const [result] = await computeTrending('24h')
    expect(result.momentum).toBe('steady')
  })

  it('assigns momentum=cooling when delta < -20%', async () => {
    seedDb(
      [{ tag: 'old-event', count: '5', category: 'politics' }],
      [{ tag: 'old-event', count: '10' }], // delta = -50%
    )
    const [result] = await computeTrending('6h')
    expect(result.momentum).toBe('cooling')
    expect(result.delta).toBeLessThan(-20)
  })

  it('assigns momentum=rising when there is no previous count (new tag, delta=100)', async () => {
    seedDb(
      [{ tag: 'new-topic', count: '5', category: null }],
      [], // no previous data — delta defaults to exactly 100
    )
    const [result] = await computeTrending('1h')
    // delta=100 is not > 100, so momentum is 'rising' (30 < 100 <= 100)
    expect(result.momentum).toBe('rising')
    expect(result.delta).toBe(100)
  })

  it('returns at most 15 results', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      tag:      `tag-${i}`,
      count:    String(10 + i),
      category: 'general',
    }))
    seedDb(many, [])
    const results = await computeTrending('24h')
    expect(results).toHaveLength(15)
  })

  it('sorts results by score descending', async () => {
    seedDb(
      [
        { tag: 'low',  count: '2',  category: null },
        { tag: 'high', count: '20', category: null },
        { tag: 'mid',  count: '10', category: null },
      ],
      [],
    )
    const results = await computeTrending('1h')
    expect(results[0].tag).toBe('high')
    expect(results[results.length - 1].tag).toBe('low')
  })

  it('includes engagement bonus in the score', async () => {
    seedDb(
      [
        { tag: 'viral',  count: '5', category: 'tech' },
        { tag: 'boring', count: '5', category: 'tech' },
      ],
      [],
      [
        { tag: 'viral',  engagement: '1000' },
        { tag: 'boring', engagement: '0'    },
      ],
    )
    const results = await computeTrending('1h')
    const viral  = results.find(r => r.tag === 'viral')!
    const boring = results.find(r => r.tag === 'boring')!
    expect(viral.score).toBeGreaterThan(boring.score)
  })

  it('rounds score and delta to one decimal place', async () => {
    seedDb(
      [{ tag: 'test', count: '7', category: null }],
      [{ tag: 'test', count: '3' }],
    )
    const [result] = await computeTrending('1h')
    expect(result.score).toBe(Math.round(result.score * 10) / 10)
    expect(result.delta).toBe(Math.round(result.delta * 10) / 10)
  })
})
