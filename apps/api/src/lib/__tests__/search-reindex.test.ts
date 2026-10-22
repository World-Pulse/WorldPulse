/**
 * Reports the search index has with an old status (Oct 22, 2026), sent to it
 * again from the queue the scraper fills.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../../db/redis', () => ({ redis: { spop: vi.fn(), sadd: vi.fn() } }))
vi.mock('../search', () => ({ indexSignals: vi.fn() }))
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))

import { drainReindex, type ReindexDeps } from '../search-reindex'

function queue(ids: string[], over: Partial<ReindexDeps> = {}) {
  const left = [...ids]
  const sent: string[][] = []
  const back: string[] = []
  const deps: ReindexDeps = {
    pop: async (n) => left.splice(0, n),
    putBack: async (x) => { back.push(...x) },
    rows: async (x) => x.map(id => ({ id, status: 'verified' })),
    index: async (rows) => { sent.push(rows.map(r => String(r.id))) },
    ...over,
  }
  return { deps, left, sent, back }
}

describe('the search re-index', () => {
  it('sends the queued reports in batches, read fresh from the database', async () => {
    const q = queue(['a', 'b', 'c', 'd', 'e'])
    expect(await drainReindex(q.deps, { batch: 2, batches: 4 })).toBe(5)
    expect(q.sent).toEqual([['a', 'b'], ['c', 'd'], ['e']])
    expect(q.left).toEqual([])
  })

  it('sends at most its batches in one look, and leaves the rest queued', async () => {
    const q = queue(['a', 'b', 'c', 'd', 'e'])
    expect(await drainReindex(q.deps, { batch: 2, batches: 1 })).toBe(2)
    expect(q.left).toEqual(['c', 'd', 'e'])
  })

  it('puts the ids back when the index refuses them', async () => {
    const q = queue(['a', 'b'], { index: async () => { throw new Error('meilisearch down') } })
    await expect(drainReindex(q.deps)).rejects.toThrow('meilisearch down')
    expect(q.back).toEqual(['a', 'b'])
  })

  it('does nothing with an empty queue', async () => {
    const q = queue([])
    expect(await drainReindex(q.deps)).toBe(0)
    expect(q.sent).toEqual([])
  })
})
