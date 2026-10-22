import { describe, it, expect, vi } from 'vitest'

vi.mock('../../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('../search', () => ({ meili: {}, indexSignals: vi.fn(), indexPosts: vi.fn(), indexUsers: vi.fn() }))

import { catchUpVerifiedSignals, CATCHUP_DONE, CATCHUP_CURSOR, type CatchUpDeps, type CatchUpCursor } from '../search-backfill'

/** A fake database of verified reports in time order, and a fake Redis */
function fake(total: number, opts: { done?: boolean; cursor?: CatchUpCursor; locked?: boolean } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `r${String(i).padStart(4, '0')}`, at_text: `2026-04-${String(5 + Math.floor(i / 10)).padStart(2, '0')} 00:00:${String(i % 10).padStart(2, '0')}+00` }))
  const kv = new Map<string, string>()
  if (opts.done) kv.set(CATCHUP_DONE, 'yes')
  if (opts.cursor) kv.set(CATCHUP_CURSOR, JSON.stringify(opts.cursor))
  const indexed: string[] = []
  let unlocked = 0
  const deps: CatchUpDeps = {
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => { kv.set(k, v) },
    lock: async () => !opts.locked,
    unlock: async () => { unlocked++ },
    batch: async (after, size) => rows.filter((r) => !after || r.at_text > after.at || (r.at_text === after.at && r.id > after.id)).slice(0, size),
    index: async (batch) => { indexed.push(...batch.map((r) => String(r.id))) },
    pause: async () => {},
  }
  return { deps, kv, indexed, unlocked: () => unlocked }
}

describe('search catch-up of verified reports (Oct 22, 2026)', () => {
  it('sends every verified report once, oldest first, then marks itself done', async () => {
    const f = fake(23)
    expect(await catchUpVerifiedSignals({ size: 10 }, f.deps)).toBe(23)
    expect(f.indexed).toHaveLength(23)
    expect(new Set(f.indexed).size).toBe(23)
    expect(f.kv.get(CATCHUP_DONE)).toBeTruthy()
    expect(JSON.parse(f.kv.get(CATCHUP_CURSOR)!).id).toBe('r0022')
    expect(f.unlocked()).toBe(1)
  })

  it('resumes after the kept cursor (a restart mid-way)', async () => {
    const f = fake(23, { cursor: { at: '2026-04-06 00:00:04+00', id: 'r0014' } })
    expect(await catchUpVerifiedSignals({ size: 10 }, f.deps)).toBe(8)
    expect(f.indexed[0]).toBe('r0015')
  })

  it('does nothing when done before, or while another process runs it', async () => {
    const done = fake(5, { done: true })
    expect(await catchUpVerifiedSignals({}, done.deps)).toBeNull()
    expect(done.indexed).toHaveLength(0)
    const busy = fake(5, { locked: true })
    expect(await catchUpVerifiedSignals({}, busy.deps)).toBeNull()
    expect(busy.indexed).toHaveLength(0)
    expect(busy.unlocked()).toBe(0)
  })

  it('lets go of the lock when the index fails, and keeps the cursor for the next start', async () => {
    const f = fake(23)
    let calls = 0
    f.deps.index = async () => { calls++; if (calls === 2) throw new Error('meili down') }
    await expect(catchUpVerifiedSignals({ size: 10 }, f.deps)).rejects.toThrow('meili down')
    expect(f.unlocked()).toBe(1)
    expect(f.kv.get(CATCHUP_DONE)).toBeUndefined()
    expect(JSON.parse(f.kv.get(CATCHUP_CURSOR)!).id).toBe('r0009')
  })
})
