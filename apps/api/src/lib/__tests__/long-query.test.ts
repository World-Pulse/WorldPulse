/**
 * A long query still running well past its own limit is ended from outside
 * (lib/long-query.ts, Oct 29, 2026): statement_timeout can't stop a query
 * blocked sending its answer, and on Oct 28 three of the stories list's sat
 * like that for 3 to 5 minutes on a server out of memory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  trxSql: [] as string[],
  ends: [] as Array<{ sql: string; bindings: unknown[] }>,
  endAnswer: { rows: [{ ended: true, state: 'active', running_s: 80 }] } as unknown,
  me: { pid: 4242, since: '2026-10-29 11:00:00.123456+00' } as Record<string, unknown> | null,
}))

vi.mock('../../db/postgres', () => {
  const trx = {
    raw: vi.fn(async (sql: string) => {
      h.trxSql.push(sql)
      // node-postgres answers a two-statement string with one result per statement
      if (/^SET LOCAL statement_timeout/.test(sql)) return [{ rows: [] }, { rows: h.me ? [h.me] : [] }]
      return { rows: [{ n: 1 }] }
    }),
  }
  const db = {
    raw: vi.fn(async (sql: string, bindings: unknown[]) => { h.ends.push({ sql, bindings }); return h.endAnswer }),
    transaction: vi.fn(async (fn: (t: typeof trx) => Promise<unknown>) => fn(trx)),
  }
  return { db }
})
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { longQuery, OVERRUN_GRACE_SECONDS, CHECK_EVERY_SECONDS } from '../long-query'

const hang = () => {
  let finish: (v: string) => void = () => {}
  let fail: (e: Error) => void = () => {}
  const p = new Promise<string>((res, rej) => { finish = res; fail = rej })
  return { p, finish, fail }
}

describe('longQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.trxSql = []
    h.ends = []
    h.endAnswer = { rows: [{ ended: true, state: 'active', running_s: 80 }] }
    h.me = { pid: 4242, since: '2026-10-29 11:00:00.123456+00' }
  })
  afterEach(() => { vi.useRealTimers() })

  it('gives the transaction its own limit and learns its connection in the same round trip', async () => {
    expect(await longQuery(59.6, async trx => (await trx.raw('SELECT 1')).rows[0].n)).toBe(1)
    expect(h.trxSql[0]).toMatch(/^SET LOCAL statement_timeout = '60s'; SELECT pg_backend_pid\(\) AS pid, now\(\)::text AS since$/)
    expect(await longQuery(0.2, async () => 'x')).toBe('x')
    expect(h.trxSql.at(-1)).toMatch(/statement_timeout = '1s'/)
  })

  it('never looks at a query that finishes in time', async () => {
    expect(await longQuery(60, async () => 'done')).toBe('done')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.ends).toHaveLength(0)
  })

  it('ends a statement stuck past its limit plus the grace, then stops looking', async () => {
    const q = hang()
    const result = longQuery(60, () => q.p)
    await vi.advanceTimersByTimeAsync((60 + OVERRUN_GRACE_SECONDS) * 1000 - 1)
    expect(h.ends).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.ends).toHaveLength(1)
    const { sql, bindings } = h.ends[0]
    expect(sql).toMatch(/pg_terminate_backend\(pid\)/)
    // only this transaction: its process id and its start time must both match
    expect(sql).toMatch(/pid = \? AND xact_start = \?::timestamptz/)
    expect(bindings).toEqual([4242, '2026-10-29 11:00:00.123456+00', 75, 75])
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(h.ends).toHaveLength(1)
    q.fail(new Error('terminating connection due to administrator command'))
    await expect(result).rejects.toThrow('administrator command')
  })

  it('keeps looking while a long transaction of several statements is within its limits, and stops when it ends', async () => {
    h.endAnswer = { rows: [] }   // nothing past its limit: nothing ended
    const q = hang()
    const result = longQuery(30, () => q.p)
    await vi.advanceTimersByTimeAsync((30 + OVERRUN_GRACE_SECONDS) * 1000)
    expect(h.ends).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_SECONDS * 1000)
    expect(h.ends).toHaveLength(2)
    q.finish('all done')
    expect(await result).toBe('all done')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.ends).toHaveLength(2)
  })

  it("doesn't look at all when it can't tell which connection it has", async () => {
    h.me = null
    const q = hang()
    const result = longQuery(5, () => q.p)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.ends).toHaveLength(0)
    q.finish('ok')
    expect(await result).toBe('ok')
  })
})
