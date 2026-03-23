/**
 * Tests for the GraphQL API layer (/api/graphql).
 * Uses mocked DB/Redis to avoid infrastructure dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../db/postgres', () => ({
  db: Object.assign(
    vi.fn(),
    {
      raw: vi.fn(),
    },
  ),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get:   vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}))

// ─── Import resolvers after mocks ─────────────────────────────────────────

const { resolvers } = await import('../graphql/resolvers')
const { db }        = await import('../db/postgres')
const { redis }     = await import('../db/redis')

// ─── Fixtures ──────────────────────────────────────────────────────────────

const makeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id:               'signal-1',
  title:            'Test Signal',
  summary:          'A test signal summary',
  category:         'breaking',
  severity:         'high',
  reliability_score: 0.9,
  original_urls:    ['https://example.com/article'],
  created_at:       new Date('2026-01-01T00:00:00Z'),
  location_geojson: { coordinates: [10.5, 51.2] as [number, number] },
  view_count:       100,
  post_count:       20,
  ...overrides,
})

// ─── Shared query chain builder ───────────────────────────────────────────

function makeChain(resolveWith: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['where', 'whereRaw', 'select', 'orderBy', 'orderByRaw', 'limit', 'offset', 'count', 'first']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  ;(chain as { then: (resolve: (v: unknown) => void) => unknown }).then = (resolve) => Promise.resolve(resolveWith).then(resolve)
  ;(chain as { catch: (reject: (e: unknown) => void) => unknown }).catch = (_reject) => Promise.resolve(resolveWith)
  return chain
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('GraphQL resolvers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redis.get).mockResolvedValue(null)
  })

  // 1. signals query returns array of signals
  it('signals query returns array', async () => {
    const rows = [makeRow(), makeRow({ id: 'signal-2', title: 'Second Signal' })]
    const chain = makeChain(rows)
    const countChain = makeChain([{ total: '2' }])
    countChain.first = vi.fn().mockResolvedValue({ total: '2' })

    vi.mocked(db).mockImplementation((table: unknown) => {
      if (typeof table === 'string' && table.startsWith('signals as s')) {
        return chain as ReturnType<typeof db>
      }
      return countChain as ReturnType<typeof db>
    })

    const result = await resolvers.Query.signals(undefined, { limit: 20, offset: 0 })

    expect(Array.isArray(result.nodes)).toBe(true)
    expect(result.nodes.length).toBe(2)
    expect(result.nodes[0]).toMatchObject({ id: 'signal-1', title: 'Test Signal' })
    expect(typeof result.totalCount).toBe('number')
    expect(result.pageInfo).toBeDefined()
  })

  // 2. signal(id) returns single item
  it('signal(id) returns single item', async () => {
    const row = makeRow()
    const chain = makeChain(row)
    chain.first = vi.fn().mockResolvedValue(row)

    vi.mocked(db).mockReturnValue(chain as ReturnType<typeof db>)

    const result = await resolvers.Query.signal(undefined, { id: 'signal-1' })

    expect(result).not.toBeNull()
    expect(result?.id).toBe('signal-1')
    expect(result?.title).toBe('Test Signal')
    expect(result?.lat).toBe(51.2)
    expect(result?.lng).toBe(10.5)
    expect(result?.sourceUrl).toBe('https://example.com/article')
  })

  // 3. category filter works
  it('signals category filter applies where clause', async () => {
    const rows = [makeRow({ category: 'conflict' })]
    const chain = makeChain(rows)
    const countChain = makeChain([{ total: '1' }])
    countChain.first = vi.fn().mockResolvedValue({ total: '1' })

    vi.mocked(db).mockImplementation((table: unknown) => {
      if (typeof table === 'string' && table.startsWith('signals as s')) {
        return chain as ReturnType<typeof db>
      }
      return countChain as ReturnType<typeof db>
    })

    const result = await resolvers.Query.signals(undefined, { category: 'conflict' })

    expect(result.nodes[0].category).toBe('conflict')
    // Verify where was called — chain records all method calls
    const whereCalls = vi.mocked(chain.where as ReturnType<typeof vi.fn>).mock.calls
    expect(whereCalls.some((args: unknown[]) => args[0] === 's.category')).toBe(true)
  })

  // 4. limit/offset pagination
  it('signals pagination sets correct limit and offset', async () => {
    const rows = [makeRow()]
    const chain = makeChain(rows)
    const countChain = makeChain([{ total: '50' }])
    countChain.first = vi.fn().mockResolvedValue({ total: '50' })

    vi.mocked(db).mockImplementation((table: unknown) => {
      if (typeof table === 'string' && table.startsWith('signals as s')) {
        return chain as ReturnType<typeof db>
      }
      return countChain as ReturnType<typeof db>
    })

    const result = await resolvers.Query.signals(undefined, { limit: 5, offset: 10 })

    expect(result.pageInfo.hasPreviousPage).toBe(true)
    // offset=10, limit=5, totalCount=50 → 10+5<50 → hasNextPage=true
    expect(result.pageInfo.hasNextPage).toBe(true)
  })

  // 5. search query returns filtered results
  it('search query returns array of signals matching query', async () => {
    const rows = [makeRow({ title: 'Climate Crisis Update' })]
    const chain = makeChain(rows)

    vi.mocked(db).mockReturnValue(chain as ReturnType<typeof db>)

    const result = await resolvers.Query.search(undefined, { q: 'climate', limit: 5 })

    expect(Array.isArray(result)).toBe(true)
    expect(result[0].title).toBe('Climate Crisis Update')
    // whereRaw should have been called for full-text search
    const whereRawCalls = vi.mocked(chain.whereRaw as ReturnType<typeof vi.fn>).mock.calls
    expect(whereRawCalls.length).toBeGreaterThan(0)
  })

  // 6. invalid ID returns null
  it('signal(id) returns null for unknown ID', async () => {
    const chain = makeChain(undefined)
    chain.first = vi.fn().mockResolvedValue(undefined)

    vi.mocked(db).mockReturnValue(chain as ReturnType<typeof db>)

    const result = await resolvers.Query.signal(undefined, { id: 'nonexistent-id' })

    expect(result).toBeNull()
  })
})
