/**
 * The Pro waitlist's one email, "Pro is open" (plan 13a, Oct 21, 2026):
 * once per address, never twice, one run at a time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as Array<{ email: string }> }))
vi.mock('../db/postgres', () => ({ db: { raw: vi.fn(async (sql: string) => ({ rows: /count/.test(sql) ? [{ n: h.rows.length }] : h.rows })) } }))

const { announceProOpen, proOpenEmail, waitlistCounts, ANNOUNCED_SET } = await import('../lib/pro-waitlist')

function fakeRedis() {
  const sets = new Map<string, Set<string>>()
  const strings = new Map<string, string>()
  const set = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!
  return {
    sets, strings,
    sismember: vi.fn(async (k: string, m: string) => (set(k).has(m) ? 1 : 0)),
    sadd: vi.fn(async (k: string, m: string) => { const had = set(k).has(m); set(k).add(m); return had ? 0 : 1 }),
    scard: vi.fn(async (k: string) => set(k).size),
    set: vi.fn(async (k: string, v: string) => (strings.has(k) ? null : (strings.set(k, v), 'OK'))),
    del: vi.fn(async (k: string) => (strings.delete(k) ? 1 : 0)),
  }
}

beforeEach(() => { h.rows = [{ email: 'A@example.com' }, { email: 'b@example.com' }, { email: 'c@example.com' }] })

describe('the "Pro is open" email', () => {
  it('says the price, what Pro adds, and that it is the one email', () => {
    const m = proOpenEmail()
    expect(m.subject).toBe('WorldPulse Pro is open')
    expect(m.text).toContain('$12 a month')
    expect(m.text).toContain('600 requests a minute and 50,000 a day')
    expect(m.text).toContain('https://world-pulse.io/pricing?utm_source=waitlist&utm_medium=email')
    expect(m.text).toContain("Your address won't be used again")
  })

  it('goes once to each address; a second press sends nothing; a failure is tried again next time', async () => {
    const redis = fakeRedis()
    const sent: string[] = []
    let fail = 'c@example.com'
    const send = vi.fn(async (to: string) => { if (to === fail) return false; sent.push(to); return true })
    expect(await announceProOpen(redis as never, send)).toEqual({ sent: 2, skipped: 0, failed: 1 })
    expect(sent).toEqual(['a@example.com', 'b@example.com'])
    fail = ''
    expect(await announceProOpen(redis as never, send)).toEqual({ sent: 1, skipped: 2, failed: 0 })
    expect(await announceProOpen(redis as never, send)).toEqual({ sent: 0, skipped: 3, failed: 0 })
    expect(redis.sets.get(ANNOUNCED_SET)!.size).toBe(3)
    expect(await waitlistCounts(redis as never)).toEqual({ waiting: 3, announced: 3 })
  })

  it('one run at a time', async () => {
    const redis = fakeRedis()
    redis.strings.set('pro:waitlist:announcing', '1')
    expect(await announceProOpen(redis as never, vi.fn(async () => true))).toEqual({ sent: 0, skipped: 0, failed: 0, busy: true })
  })
})
