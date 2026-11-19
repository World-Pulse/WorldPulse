/**
 * The same-story search's title index (Nov 19, 2026; Devon, 3:39 PM: "Yes"): story-matching took 9.3 s of the news
 * reader's 9.9 s per item, reading every title of the last day or two; the index matches the search's expression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const raw = vi.fn()
const query = vi.fn(async () => ({}))
const release = vi.fn()
vi.mock('../../lib/postgres', () => ({
  db: Object.assign(vi.fn(), { raw: (...a: unknown[]) => raw(...a) }),
  pgPool: { query: vi.fn(), connect: vi.fn(async () => ({ query: (...a: unknown[]) => query(...a), release })) },
}))
vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { ensureTitleSearchIndex, TITLE_SEARCH_INDEX_SQL } = await import('../correlate')
const { readFileSync } = await import('node:fs')

describe('the title search index', () => {
  beforeEach(() => { raw.mockReset(); query.mockClear(); release.mockClear() })

  it("indexes the very expression the same-story search asks, without blocking inserts", () => {
    const src = readFileSync(new URL('../correlate.ts', import.meta.url), 'utf8')
    expect(src).toContain("to_tsvector('simple', title) @@ to_tsquery('simple', ?)")
    expect(TITLE_SEARCH_INDEX_SQL).toContain("USING gin (to_tsvector('simple', title))")
    expect(TITLE_SEARCH_INDEX_SQL).toMatch(/CONCURRENTLY IF NOT EXISTS/)
  })

  it('leaves a valid index alone, builds a missing one, and rebuilds an invalid one', async () => {
    raw.mockResolvedValueOnce({ rows: [{ indisvalid: true }] })
    expect(await ensureTitleSearchIndex()).toBe('ready')
    expect(raw).toHaveBeenCalledTimes(1)

    raw.mockReset().mockResolvedValueOnce({ rows: [] })
    expect(await ensureTitleSearchIndex()).toBe('built')
    // on its own connection, with room past the scraper's 2-minute limit, and handed back
    expect(query.mock.calls.map(c => String(c[0]))).toEqual([`SET statement_timeout = '30min'`, TITLE_SEARCH_INDEX_SQL])
    expect(release).toHaveBeenCalledTimes(1)

    query.mockClear()
    raw.mockReset().mockResolvedValueOnce({ rows: [{ indisvalid: false }] })
    expect(await ensureTitleSearchIndex()).toBe('built')
    expect(String(query.mock.calls[1][0])).toMatch(/DROP INDEX CONCURRENTLY IF EXISTS idx_signals_title_simple/)
  })

  it('reports a failure without throwing', async () => {
    raw.mockRejectedValueOnce(new Error('canceling statement due to lock timeout'))
    expect(await ensureTitleSearchIndex()).toBe('failed')
  })
})
