/**
 * Unit tests for search-analytics.ts
 *
 * Exercises logSearchQuery's fire-and-forget dual-write behaviour
 * (ClickHouse HTTP + PostgreSQL) without hitting real services.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock PostgreSQL ──────────────────────────────────────────────────────────

const insertMock = vi.fn().mockResolvedValue([])
const catchMock  = vi.fn()

const dbMock = vi.fn(() => ({
  insert: vi.fn(() => ({ catch: catchMock })),
}))

vi.mock('../../../db/postgres.js', () => ({ db: dbMock }))

// ─── Import after mocks ───────────────────────────────────────────────────────

const { logSearchQuery, initClickHouse } = await import('../search-analytics.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetchMock(ok = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500 })
}

// ─── logSearchQuery ───────────────────────────────────────────────────────────

describe('logSearchQuery', () => {
  let fetchSpy: ReturnType<typeof makeFetchMock>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = makeFetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls fetch for ClickHouse and db.insert for PostgreSQL', async () => {
    logSearchQuery({
      query:       'earthquake turkey',
      searchType:  'signals',
      resultCount: 42,
      zeroResults: false,
    })

    // Allow microtasks to flush
    await Promise.resolve()

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(dbMock).toHaveBeenCalledOnce()
  })

  it('includes the query string in the ClickHouse request body', async () => {
    logSearchQuery({
      query:       'flood germany',
      searchType:  'posts',
      resultCount: 7,
      zeroResults: false,
    })

    await Promise.resolve()

    const [, fetchOptions] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = fetchOptions.body as string
    expect(body).toContain('flood germany')
    expect(body).toContain('posts')
  })

  it('sets zero_results=1 when zeroResults is true', async () => {
    logSearchQuery({
      query:       'nonexistent query',
      searchType:  'signals',
      resultCount: 0,
      zeroResults: true,
    })

    await Promise.resolve()

    const [, fetchOptions] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = fetchOptions.body as string
    const parsed = JSON.parse(body)
    expect(parsed.zero_results).toBe(1)
  })

  it('sets zero_results=0 when zeroResults is false', async () => {
    logSearchQuery({
      query:       'ukraine news',
      searchType:  'signals',
      resultCount: 25,
      zeroResults: false,
    })

    await Promise.resolve()

    const [, fetchOptions] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = fetchOptions.body as string
    const parsed = JSON.parse(body)
    expect(parsed.zero_results).toBe(0)
  })

  it('does not throw when fetch rejects (fire-and-forget)', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    expect(() => logSearchQuery({
      query:       'test',
      searchType:  'signals',
      resultCount: 0,
      zeroResults: true,
    })).not.toThrow()
  })

  it('sends result_count correctly', async () => {
    logSearchQuery({
      query:       'climate',
      searchType:  'posts',
      resultCount: 100,
      zeroResults: false,
    })

    await Promise.resolve()

    const [, fetchOptions] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = fetchOptions.body as string
    const parsed = JSON.parse(body)
    expect(parsed.result_count).toBe(100)
  })
})

// ─── initClickHouse ───────────────────────────────────────────────────────────

describe('initClickHouse', () => {
  let fetchSpy: ReturnType<typeof makeFetchMock>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = makeFetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes at least two fetch calls (CREATE DATABASE + CREATE TABLE)', async () => {
    await initClickHouse()
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('sends GET requests (no body) for DDL statements', async () => {
    await initClickHouse()
    for (const [, opts] of fetchSpy.mock.calls as [string, RequestInit][]) {
      // DDL queries use GET (no body)
      if (!opts) continue
      const method = (opts.method ?? 'GET').toUpperCase()
      expect(['GET', undefined]).toContain(opts.method ? method : undefined)
    }
  })
})
