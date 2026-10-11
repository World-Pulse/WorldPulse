/**
 * Ledger's cross-check of verifications (pipeline/crosscheck.ts, Oct 11, 2026):
 * Claude reads the reports of a story that just turned verified and records
 * whether they're one event. Shadow mode: it never changes the story.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ title: string; summary: string | null }>,
  reply: null as string | null,
  ops: [] as Array<[string, ...unknown[]]>,
  asked: [] as Array<{ purpose: string; prompt: string }>,
}))

vi.mock('../../lib/postgres', () => ({ db: { raw: vi.fn(async () => ({ rows: h.rows })) } }))
vi.mock('../../lib/redis', () => {
  const multi = () => {
    const chain: Record<string, unknown> = {}
    for (const op of ['hincrby', 'expire', 'lpush', 'ltrim']) chain[op] = (...args: unknown[]) => { h.ops.push([op, ...args]); return chain }
    chain.exec = async () => []
    return chain
  }
  return { redis: { multi } }
})
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../lib/claude', () => ({
  claudeConfigured: () => true,
  askClaude: vi.fn(async (opts: { purpose: string; prompt: string }) => {
    h.asked.push(opts)
    return h.reply == null ? null : { text: h.reply, inputTokens: 300, outputTokens: 40, costMicros: 50 }
  }),
}))

import { crossCheckPrompt, readVerdict, crossCheckVerification } from '../crosscheck'

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

describe('crossCheckVerification', () => {
  beforeEach(() => { h.ops.length = 0; h.asked.length = 0 })

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
    expect(JSON.parse(String(pushed[2]))).toMatchObject({ id: 'a', verdict: 'different', titles: ['Two killed in Kozhikode gas leak', 'Two killed in Kozhikode road crash'] })
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
