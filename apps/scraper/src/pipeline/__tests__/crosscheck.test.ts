/**
 * Ledger's cross-check of verifications (pipeline/crosscheck.ts, Oct 11, 2026):
 * Claude reads the reports of a story that just turned verified and records
 * whether they're one event. Shadow mode: it never changes the story.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id?: string; title: string; summary: string | null }>,
  reply: null as string | null,
  ops: [] as Array<[string, ...unknown[]]>,
  asked: [] as Array<{ purpose: string; prompt: string }>,
  logged: [] as Array<Record<string, unknown>>,
  keys: new Set<string>(),
}))

vi.mock('../../lib/postgres', () => ({
  db: Object.assign(
    vi.fn((table: string) => ({ insert: vi.fn(async (rows: Array<Record<string, unknown>>) => { if (table === 'verification_log') h.logged.push(...rows) }) })),
    { raw: vi.fn(async () => ({ rows: h.rows })) },
  ),
}))
vi.mock('../../lib/redis', () => {
  const multi = () => {
    const chain: Record<string, unknown> = {}
    for (const op of ['hincrby', 'expire', 'lpush', 'ltrim']) chain[op] = (...args: unknown[]) => { h.ops.push([op, ...args]); return chain }
    chain.exec = async () => []
    return chain
  }
  const set = vi.fn(async (key: string, ..._rest: unknown[]) => { if (h.keys.has(key)) return null; h.keys.add(key); return 'OK' })
  return { redis: { multi, set } }
})
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../lib/claude', () => ({
  claudeConfigured: () => true,
  askClaude: vi.fn(async (opts: { purpose: string; prompt: string }) => {
    h.asked.push(opts)
    return h.reply == null ? null : { text: h.reply, inputTokens: 300, outputTokens: 40, costMicros: 50 }
  }),
}))

import { crossCheckPrompt, readVerdict, crossCheckVerification, timelineEntry, CROSSCHECK_SYSTEM, CROSSCHECK_PROMPT_VERSION } from '../crosscheck'

const NOW = new Date('2026-10-11T16:40:00Z')

describe('crossCheckPrompt and readVerdict', () => {
  it('numbers the reports, with a summary only when it says more', () => {
    expect(crossCheckPrompt([
      { title: 'Children among 109 dead after boat capsizes off Djibouti, UN says', summary: 'Children among 109 dead after boat capsizes off Djibouti.' },
      { title: 'Djibouti shipwreck kills at least 109', summary: 'The boat sank on Saturday with about 200 migrants on board.' },
    ])).toBe('Report 1: Children among 109 dead after boat capsizes off Djibouti, UN says\nReport 2: Djibouti shipwreck kills at least 109 — The boat sank on Saturday with about 200 migrants on board.')
  })

  it('reads the verdict, fenced or not', () => {
    expect(readVerdict('{"same_event": true, "agree": true, "note": "Both report the shipwreck."}')).toEqual({ verdict: 'same', note: 'Both report the shipwreck.' })
    expect(readVerdict('```json\n{"same_event": true, "agree": false, "note": "109 dead vs 62 dead."}\n```')?.verdict).toBe('conflicting')
    expect(readVerdict('{"same_event": false, "agree": false, "note": "Two different strikes."}')?.verdict).toBe('different')
    expect(readVerdict('They seem to match.')).toBeNull()
  })
})

describe('what Claude is asked (version 2, Oct 13, 2026)', () => {
  it('compares the report that just verified the story with the ones it had', () => {
    expect(CROSSCHECK_SYSTEM).toContain('Report 1 is the report that just verified this story')
  })

  it('says what is still one event, and what is a separate one', () => {
    // version 1 called these different events: one IMF release, a toll that rose, a live blog and its recap, an explainer, one column
    for (const same of ['updated figures', 'figures from one announcement or release', 'a live blog and a recap of the same day', 'an explainer or analysis of it', 'the same article or column under another headline']) {
      expect(CROSSCHECK_SYSTEM).toContain(same)
    }
    for (const separate of ['another incident of the same kind', 'other people doing a similar thing', 'a roundup, digest or photo gallery naming no specific event']) {
      expect(CROSSCHECK_SYSTEM).toContain(separate)
    }
  })

  it('does not count a later development as disagreement', () => {
    expect(CROSSCHECK_SYSTEM).toContain('A later report adding news or updated figures is not disagreement')
  })

  it('keeps every headline it read with a verdict worth reading', async () => {
    h.ops.length = 0
    h.rows = [{ title: 'Police arrest six suspected robbers in Oyo', summary: null }, { title: 'Kano police recover three stolen vehicles', summary: null }, { title: 'Kano police arrest four suspects', summary: null }]
    h.reply = '{"same_event": false, "agree": false, "note": "Arrests in two different states."}'
    await crossCheckVerification(['a', 'b', 'c'], [], NOW)
    const entry = JSON.parse(String(h.ops.find(op => op[0] === 'lpush')![2]))
    expect(entry.titles).toHaveLength(3)
    expect(entry.prompt).toBe(2)
  })
})

describe('crossCheckVerification', () => {
  beforeEach(() => { h.ops.length = 0; h.asked.length = 0; h.logged.length = 0; h.keys.clear() })

  it('counts a same-event verdict and keeps no example', async () => {
    h.rows = [{ title: 'Strike hits Riyadh airport', summary: null }, { title: 'Riyadh airport struck again', summary: null }]
    h.reply = '{"same_event": true, "agree": true, "note": "Same attack."}'
    expect(await crossCheckVerification(['a', 'b'], [], NOW)).toBe('same')
    expect(h.asked[0]!.purpose).toBe('crosscheck')
    expect(h.ops).toContainEqual(['hincrby', 'ai:verify:counts:2026-10-11', 'same', 1])
    expect(h.ops.some(op => op[0] === 'lpush')).toBe(false)
  })

  it('keeps the doubtful ones, with an article merged into the story', async () => {
    h.rows = [{ title: 'Two killed in Kozhikode gas leak', summary: null }]
    h.reply = '{"same_event": false, "agree": false, "note": "A gas leak and a road crash."}'
    expect(await crossCheckVerification(['a'], [{ title: 'Two killed in Kozhikode road crash' }], NOW)).toBe('different')
    const pushed = h.ops.find(op => op[0] === 'lpush')!
    expect(JSON.parse(String(pushed[2]))).toMatchObject({ id: 'a', verdict: 'different', titles: ['Two killed in Kozhikode gas leak', 'Two killed in Kozhikode road crash'], prompt: CROSSCHECK_PROMPT_VERSION })
    // "different event" verdicts are also kept on their own list (the newest 30), to be read before they may hold a story
    const lists = h.ops.filter(op => op[0] === 'lpush').map(op => op[1])
    expect(lists).toEqual(['ai:verify:recent', 'ai:verify:different'])
    expect(h.ops).toContainEqual(['ltrim', 'ai:verify:different', 0, 29])
  })

  it('keeps a conflicting verdict among the doubts but not on the "different" list', async () => {
    h.rows = [{ title: 'Strike hits Riyadh airport', summary: null }, { title: 'Riyadh airport struck again', summary: null }]
    h.reply = '{"same_event": true, "agree": false, "note": "13 dead in one, 12 in the other."}'
    expect(await crossCheckVerification(['a', 'b'], [], NOW)).toBe('conflicting')
    expect(h.ops.filter(op => op[0] === 'lpush').map(op => op[1])).toEqual(['ai:verify:recent'])
  })

  it('asks nothing about a single report, and counts an unreadable answer', async () => {
    h.rows = [{ title: 'Only one', summary: null }]
    expect(await crossCheckVerification(['a'], [], NOW)).toBeNull()
    expect(h.asked).toHaveLength(0)
    h.rows = [{ title: 'One', summary: null }, { title: 'Two', summary: null }]
    h.reply = 'Hard to say.'
    expect(await crossCheckVerification(['a', 'b'], [], NOW)).toBeNull()
    expect(h.ops).toContainEqual(['hincrby', 'ai:verify:counts:2026-10-11', 'unread', 1])
  })
})

describe("the verdict on each report's page", () => {
  beforeEach(() => { h.ops.length = 0; h.asked.length = 0; h.logged.length = 0; h.keys.clear() })

  it('writes a line in each report\'s verification timeline, once per report', async () => {
    h.rows = [{ id: 'a', title: 'Strike hits Riyadh airport', summary: null }, { id: 'b', title: 'Riyadh airport struck again', summary: null }]
    h.reply = '{"same_event": true, "agree": false, "note": "13 dead in one report, 12 in the other."}'
    await crossCheckVerification(['a', 'b'], [], NOW)
    expect(h.logged).toEqual([
      { signal_id: 'a', check_type: 'cross_check', result: 'warning', confidence: 0.6, notes: '[Claude] The outlets differ: 13 dead in one report, 12 in the other.' },
      { signal_id: 'b', check_type: 'cross_check', result: 'warning', confidence: 0.6, notes: '[Claude] The outlets differ: 13 dead in one report, 12 in the other.' },
    ])
    // a new outlet's report joins: only it gets a line
    h.rows = [{ id: 'c', title: 'Riyadh airport hit a second day', summary: null }, { id: 'a', title: 'Strike hits Riyadh airport', summary: null }]
    h.reply = '{"same_event": true, "agree": true, "note": "All describe the same strike."}'
    await crossCheckVerification(['c', 'a', 'b'], [], NOW)
    expect(h.logged.slice(2).map(r => [r.signal_id, r.result])).toEqual([['c', 'confirmed']])
  })

  it('reads the report that just turned verified first, and writes only on the pages it read', async () => {
    h.rows = [{ id: 'new', title: 'Indian dies after Riyadh airport attack', summary: null }, { id: 'old1', title: 'Strike hits Riyadh airport', summary: null }]
    h.reply = '{"same_event": true, "agree": true, "note": "Same attack."}'
    await crossCheckVerification(['new', 'old1', 'old2', 'old3', 'old4', 'old5'], [], NOW)
    expect(h.logged.map(r => r.signal_id)).toEqual(['new', 'old1'])
  })

  it('shows no "different event" line while it can\'t hold a story back', () => {
    expect(timelineEntry({ verdict: 'different', note: 'Two floods.' })).toBeNull()
    expect(timelineEntry({ verdict: 'same', note: 'Same flood.' })).toEqual({ result: 'confirmed', confidence: 0.9, notes: '[Claude] Same flood.' })
  })
})
