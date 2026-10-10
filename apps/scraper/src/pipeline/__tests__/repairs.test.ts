import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  raws: [] as Array<{ sql: string; params?: unknown[] }>,
  store: new Map<string, string>(),
}))

vi.mock('../../lib/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string, params?: unknown[]) => { h.raws.push({ sql, params }); return { rowCount: 2 } }),
  }),
}))
vi.mock('../../lib/redis', () => ({
  redis: {
    set: vi.fn(async (k: string, v: string, mode: string) => {
      if (mode === 'NX' && h.store.has(k)) return null
      h.store.set(k, v); return 'OK'
    }),
    get: vi.fn(async (k: string) => h.store.get(k) ?? null),
  },
}))

import { undoLooseCorroboration } from '../repairs'

const KEY = 'repair:loose-corroboration:2026-10-10'

describe('undoLooseCorroboration', () => {
  beforeEach(() => { h.raws.length = 0; h.store.clear(); vi.useRealTimers() })

  it('on first start, reverts the window from 15:30 UTC up to now and saves that end', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-10T16:20:00Z'), toFake: ['Date'] })
    const r = await undoLooseCorroboration()
    expect(r).toEqual({ reverted: 2, recounted: 2, fixedCounts: 2 })
    expect(h.store.get(KEY)).toBe('2026-10-10T16:20:00.000Z')
    expect(h.raws[0].sql).toMatch(/SET status = 'pending', verified_at = NULL/)
    expect(h.raws[0].params).toEqual(['2026-10-10T15:30:00Z', '2026-10-10T16:20:00.000Z'])
    expect(h.raws[1].params).toEqual(['2026-10-10T15:30:00Z', '2026-10-10T16:20:00.000Z'])
  })

  it('on a later start, keeps the first end so newer verifications are never touched', async () => {
    h.store.set(KEY, '2026-10-10T16:20:00.000Z')
    vi.useFakeTimers({ now: new Date('2026-10-10T16:50:00Z'), toFake: ['Date'] })
    await undoLooseCorroboration()
    expect(h.raws[0].params).toEqual(['2026-10-10T15:30:00Z', '2026-10-10T16:20:00.000Z'])
  })

  it('never reaches past the hard stop, even if Redis lost the saved end', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-12T09:00:00Z'), toFake: ['Date'] })
    await undoLooseCorroboration()
    expect(h.raws[0].params).toEqual(['2026-10-10T15:30:00Z', '2026-10-10T17:00:00.000Z'])
  })
})
