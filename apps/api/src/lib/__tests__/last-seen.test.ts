import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── A query-builder stand-in that records what was asked (plan N9, Oct 30, 2026) ───

const calls: Array<[string, unknown[]]> = []
let fail = false

function query() {
  const q: Record<string, unknown> = {}
  for (const m of ['where', 'whereNull', 'orWhere']) {
    q[m] = (...args: unknown[]) => {
      calls.push([m, args])
      if (m === 'where' && typeof args[0] === 'function') (args[0] as (b: unknown) => void)(q)
      return q
    }
  }
  q.update = (...args: unknown[]) => { calls.push(['update', args]); return fail ? Promise.reject(new Error('db down')) : Promise.resolve(1) }
  return q
}

const dbFn = vi.fn((table: string) => { calls.push(['table', [table]]); return query() })
vi.mock('../../db/postgres', () => ({ get db() { return dbFn } }))
vi.mock('../logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { markSeen, SEEN_EVERY_MS } from '../last-seen'

beforeEach(() => { calls.length = 0; fail = false; dbFn.mockClear() })

describe('markSeen', () => {
  it("marks the account seen now, only when it wasn't in the last hour", async () => {
    const now = new Date('2026-10-30T04:30:00Z')
    await markSeen('u-1', now)
    expect(calls[0]).toEqual(['table', ['users']])
    expect(calls).toContainEqual(['where', ['id', 'u-1']])
    expect(calls).toContainEqual(['whereNull', ['last_seen_at']])
    expect(calls).toContainEqual(['orWhere', ['last_seen_at', '<', new Date(now.getTime() - SEEN_EVERY_MS)]])
    expect(calls).toContainEqual(['update', [{ last_seen_at: now }]])
    expect(SEEN_EVERY_MS).toBe(3_600_000)
  })

  it('never throws, and asks nothing without an account', async () => {
    fail = true
    await expect(markSeen('u-2')).resolves.toBeUndefined()
    calls.length = 0
    await markSeen('')
    expect(calls).toEqual([])
  })
})
