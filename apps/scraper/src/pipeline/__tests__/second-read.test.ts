/**
 * The second read (plan 11; Devon, Oct 21, 2026: "Yes, with Claude Haiku"):
 * Claude reads the newest high and critical reports with fewer than 3
 * outlets, on the rules' scale, and each verdict goes on the report's page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; title: string; summary: string | null; severity: string }>,
  raw: [] as Array<{ sql: string; params: unknown[] }>,
  replies: [] as Array<string | null>,
  asked: [] as Array<{ purpose: string; prompt: string; maxTokens: number }>,
  logged: [] as Array<Record<string, unknown>>,
  keys: new Map<string, string>(),
  counts: new Map<string, number>(),
}))

vi.mock('../../lib/postgres', () => ({
  db: Object.assign(
    vi.fn((table: string) => {
      if (table !== 'verification_log') throw new Error(`unexpected table ${table}`)
      return { insert: vi.fn(async (rows: Array<Record<string, unknown>>) => { h.logged.push(...rows) }) }
    }),
    { raw: vi.fn(async (sql: string, params: unknown[]) => { h.raw.push({ sql, params }); return { rows: h.rows } }) },
  ),
}))
vi.mock('../../lib/redis', () => {
  const multi = () => {
    const chain: Record<string, unknown> = {}
    chain.hincrby = (key: string, field: string, n: number) => { h.counts.set(`${key}|${field}`, (h.counts.get(`${key}|${field}`) ?? 0) + n); return chain }
    chain.expire = () => chain
    chain.exec = async () => []
    return chain
  }
  return {
    redis: {
      multi,
      set: vi.fn(async (key: string, value: string) => { if (h.keys.has(key)) return null; h.keys.set(key, value); return 'OK' }),
      del: vi.fn(async (key: string) => { h.keys.delete(key); return 1 }),
      hget: vi.fn(async (key: string, field: string) => { const n = h.counts.get(`${key}|${field}`); return n == null ? null : String(n) }),
    },
  }
})
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../lib/claude', () => ({
  claudeConfigured: () => true,
  askClaude: vi.fn(async (opts: { purpose: string; prompt: string; maxTokens: number }) => {
    h.asked.push(opts)
    const text = h.replies.shift()
    return text == null ? null : { text, inputTokens: 500, outputTokens: 90, costMicros: 95 }
  }),
}))

import { readSecondReads, verdictOf, timelineNote, secondReadPrompt, runSecondReads, SECOND_READ_SYSTEM, DAILY_MAX } from '../second-read'

const NOW = new Date('2026-10-21T16:00:00Z')
const row = (n: number, severity = 'high', title = `Report number ${n}`) => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`, title, summary: null, severity })

beforeEach(() => {
  h.rows = []; h.raw = []; h.replies = []; h.asked = []; h.logged = []; h.keys.clear(); h.counts.clear()
})

describe('reading the answer', () => {
  it('one read per report, in order, however it is fenced', () => {
    const text = '```json\n{"reports": [{"report": 1, "kind": "event", "severity": "high", "note": "Five killed in a strike"}, {"report": 2, "kind": "analysis", "severity": "medium", "note": "An explainer"}]}\n```'
    expect(readSecondReads(text, 2)).toEqual([
      { kind: 'event', severity: 'high', note: 'Five killed in a strike' },
      { kind: 'analysis', severity: 'medium', note: 'An explainer' },
    ])
  })
  it('nothing usable where an entry is missing or odd', () => {
    expect(readSecondReads('{"reports": [{"report": 2, "kind": "event", "severity": "low"}]}', 2)).toEqual([null, { kind: 'event', severity: 'low', note: '' }])
    expect(readSecondReads('{"reports": [{"report": 1, "kind": "rumour", "severity": "high"}, {"report": 2, "kind": "event", "severity": "extreme"}]}', 2)).toEqual([null, null])
    expect(readSecondReads('no JSON here', 1)).toEqual([null])
  })
})

describe('the verdict and the page\'s line', () => {
  it('against the rules\' severity', () => {
    expect(verdictOf('high', { kind: 'event', severity: 'high', note: '' })).toBe('agree')
    expect(verdictOf('critical', { kind: 'event', severity: 'medium', note: '' })).toBe('lower')
    expect(verdictOf('high', { kind: 'event', severity: 'critical', note: '' })).toBe('higher')
    expect(verdictOf('high', { kind: 'roundup', severity: 'high', note: '' })).toBe('not_event')
  })
  it('says what the second read found', () => {
    expect(timelineNote('high', { kind: 'event', severity: 'high', note: 'Five killed in a strike.' }, 'agree')).toBe('[Claude, second read] Agrees: HIGH, a new event. Five killed in a strike.')
    expect(timelineNote('critical', { kind: 'event', severity: 'medium', note: 'Two injured' }, 'lower')).toBe('[Claude, second read] Rates it MEDIUM, not CRITICAL. Two injured.')
    expect(timelineNote('high', { kind: 'analysis', severity: 'medium', note: '' }, 'not_event')).toBe('[Claude, second read] Reads as analysis, not a new event.')
  })
  it('the prompt numbers the reports and uses the rules\' scale', () => {
    expect(secondReadPrompt([row(1), { ...row(2), summary: 'The strike hit a market in the north.' }])).toBe('Report 1: Report number 1\nReport 2: Report number 2 — The strike hit a market in the north.')
    expect(SECOND_READ_SYSTEM).toMatch(/5 or more dead or 100 or more injured/)
  })
})

describe('a pass', () => {
  it('reads the newest high and critical reports with fewer than 3 outlets, each once, and logs each verdict', async () => {
    h.rows = [row(1, 'high'), row(2, 'critical'), row(3, 'high')]
    h.replies = ['{"reports": [{"report": 1, "kind": "event", "severity": "high", "note": "A strike"}, {"report": 2, "kind": "event", "severity": "medium", "note": "Two injured"}, {"report": 3, "kind": "analysis", "severity": "medium", "note": "A preview"}]}']
    const stats = await runSecondReads(NOW)
    expect(stats).toMatchObject({ read: 3, agree: 1, lower: 1, not_event: 1, calls: 1 })
    const sql = h.raw[0]!.sql
    expect(sql).toMatch(/severity IN \('high', 'critical'\)/)
    expect(sql).toMatch(/source_count, 1\) < 3/)
    expect(sql).toMatch(/check_type = 'second_read'/)
    expect(h.asked[0]).toMatchObject({ purpose: 'second_read' })
    expect(h.logged.map(r => [r.verdict, r.result, r.check_type])).toEqual([
      ['agree', 'confirmed', 'second_read'], ['lower', 'warning', 'second_read'], ['not_event', 'warning', 'second_read'],
    ])
    expect(h.counts.get('ai:second:counts:2026-10-21|read')).toBe(3)
    // the same reports again: already read
    h.replies = ['{"reports": []}']
    expect((await runSecondReads(NOW)).read).toBe(0)
    expect(h.asked).toHaveLength(1)
  })

  it('eight to a call, three calls a pass', async () => {
    h.rows = Array.from({ length: 40 }, (_, i) => row(i + 1))
    const answer = (n: number) => JSON.stringify({ reports: Array.from({ length: n }, (_, i) => ({ report: i + 1, kind: 'event', severity: 'high', note: '' })) })
    h.replies = [answer(8), answer(8), answer(8)]
    const stats = await runSecondReads(NOW)
    expect(stats.calls).toBe(3)
    expect(stats.read).toBe(24)
    expect(h.asked.map(a => a.prompt.split('\n').length)).toEqual([8, 8, 8])
  })

  it('without an answer (the cap, an error) the reports wait for a later pass, the ones not yet asked too', async () => {
    h.rows = Array.from({ length: 12 }, (_, i) => row(i + 1))
    h.replies = [JSON.stringify({ reports: Array.from({ length: 8 }, (_, i) => ({ report: i + 1, kind: 'event', severity: 'high', note: '' })) }), null]
    const stats = await runSecondReads(NOW)
    expect(stats).toMatchObject({ read: 8, calls: 2 })
    expect(h.logged).toHaveLength(8)
    // the first eight are read; the other four can be read by the next pass
    expect([...h.keys.keys()].filter(k => k.startsWith('ai:second:done:'))).toHaveLength(8)
  })

  it('stops at the day\'s limit', async () => {
    h.counts.set('ai:second:counts:2026-10-21|read', DAILY_MAX)
    h.rows = [row(1)]
    expect((await runSecondReads(NOW)).read).toBe(0)
    expect(h.raw).toHaveLength(0)
  })
})
