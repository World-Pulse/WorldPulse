/**
 * Where a pass's time goes (Nov 19, 2026; Devon, 1:12 PM: "How fast can we test this and figure it out? This is a
 * major bottle neck in our growth"): reading six feeds at once instead of two left the reader at about two feeds a
 * minute, so the timing of each step goes to /ops-status.json.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { noteFeedRead, readerTiming, readerTimingSummary } = await import('../news-rss')

describe('the reader timing', () => {
  it('averages fetching and processing per feed, and keeps the five slowest', () => {
    for (let i = 0; i < 7; i++) noteFeedRead(`f${i}`, 1000, 1000 * i, 20, i)
    noteFeedRead('f6', 500, 100, 20, 0)   // a feed read again replaces its entry
    expect(readerTiming.feeds).toBe(8)
    const s = readerTimingSummary({ inserts: 4, insertMs: 400, correlations: 4, correlateMs: 8000, dedupMs: 40 })
    expect(s).toMatchObject({ feeds_read: 8, avg_insert_ms: 100, avg_correlate_ms: 2000, avg_dedup_ms: 10, stored: 4, new_items: 21 })
    expect((s.slowest as Array<{ id: string }>).map(x => x.id)).toEqual(['f5', 'f4', 'f3', 'f2', 'f6'])
  })
})
