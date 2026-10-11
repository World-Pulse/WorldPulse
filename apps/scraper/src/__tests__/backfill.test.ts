/**
 * The startup backfill turns raw articles saved while the pipeline was down
 * into signals, but only recent ones: on Oct 7, 2026 articles saved in May
 * came back as new signals (plan 0j b).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  pending: [] as string[],
  rowsFor: (ids: string[]) => ids.map(id => ({
    id, source_id: 'src', url: `https://example.com/${id}`, title: `Story ${id}`, body: '',
    published_at: new Date('2026-10-10T12:00:00Z'), tier: 'tier2', trust_score: '0.7',
  })),
}))

vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

vi.mock('../lib/postgres', () => {
  function builder(table: string) {
    let ids: string[] = []
    const b: Record<string, unknown> = {}
    const record = (method: string) => (...args: unknown[]) => {
      h.calls.push({ table, method, args })
      if (method === 'whereIn') ids = args[1] as string[]
      if (method === 'where' && typeof args[0] === 'function') {
        // the where(q => ...) group: record what it builds
        const inner: Record<string, unknown> = {}
        for (const m of ['where', 'orWhere']) inner[m] = (...a: unknown[]) => { h.calls.push({ table, method: `group.${m}`, args: a }); return inner }
        ;(args[0] as (q: unknown) => void)(inner)
      }
      return b
    }
    for (const m of ['where', 'whereNotNull', 'orderBy', 'join', 'whereIn', 'select']) b[m] = record(m)
    b.update = (data: unknown) => { h.calls.push({ table, method: 'update', args: [data] }); return Promise.resolve(7) }
    b.pluck = (col: string) => { h.calls.push({ table, method: 'pluck', args: [col] }); return Promise.resolve(h.pending) }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(h.rowsFor(ids)).then(res, rej)
    return b
  }
  return { db: vi.fn((table: string) => builder(table)) }
})

import { backfillUnprocessed } from '../backfill'
import { isStaleItem, MAX_ITEM_AGE_MS } from '../pipeline/freshness'

describe('backfillUnprocessed', () => {
  beforeEach(() => { h.calls.length = 0; h.pending = [] })

  it('marks raw articles saved or published more than 3 days ago processed, without a signal', async () => {
    const before = Date.now()
    await backfillUnprocessed(vi.fn(async () => {}))
    const update = h.calls.find(c => c.method === 'update')
    expect(update?.args[0]).toEqual({ processed: true })
    const fetched = h.calls.find(c => c.method === 'group.where')
    const published = h.calls.find(c => c.method === 'group.orWhere')
    expect(fetched?.args.slice(0, 2)).toEqual(['fetched_at', '<'])
    expect(published?.args.slice(0, 2)).toEqual(['published_at', '<'])
    const cutoff = (fetched?.args[2] as Date).getTime()
    expect(Math.abs(before - MAX_ITEM_AGE_MS - cutoff)).toBeLessThan(5_000)
  })

  it('processes every recent unprocessed article, in batches of 50', async () => {
    h.pending = Array.from({ length: 120 }, (_, i) => `a${i}`)
    const processGroup = vi.fn(async () => {})
    await backfillUnprocessed(processGroup)
    const seen = (processGroup.mock.calls as unknown as Array<[string, Array<{ articleId: string }>]>)
      .flatMap(([, group]) => group.map(a => a.articleId))
    expect(new Set(seen).size).toBe(120)    // none skipped (an offset over "unprocessed" skipped every other batch)
    expect(h.calls.filter(c => c.method === 'whereIn').map(c => (c.args[1] as string[]).length)).toEqual([50, 50, 20])
  }, 10_000)
})

describe('isStaleItem', () => {
  it('takes strings and dates; no date counts as fresh', () => {
    const now = Date.parse('2026-10-11T05:00:00Z')
    expect(isStaleItem('2026-10-07T04:00:00Z', now)).toBe(true)
    expect(isStaleItem(new Date('2026-10-09T05:00:00Z'), now)).toBe(false)
    expect(isStaleItem(null, now)).toBe(false)
    expect(isStaleItem('not a date', now)).toBe(false)
  })
})
