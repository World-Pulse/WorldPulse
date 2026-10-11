/**
 * The AI Digest writes on Claude, within the spending cap (pulse/publisher.ts
 * generateContent, in-house plan, Oct 11, 2026).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ asked: [] as Array<{ purpose: string; model?: string; maxTokens: number }>, reply: null as null | { text: string } }))

vi.mock('../../claude', () => ({
  CLAUDE_SMALL:  'claude-haiku-5-5',
  CLAUDE_WRITER: 'claude-sonnet-5-5',
  askClaude: vi.fn(async (opts: { purpose: string; model?: string; maxTokens: number }) => {
    h.asked.push(opts)
    return h.reply && { ...h.reply, model: opts.model ?? 'claude-haiku-5-5', inputTokens: 900, outputTokens: 150, costMicros: 165 }
  }),
}))
vi.mock('../../../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../../../db/redis', () => ({ redis: { get: vi.fn(), setex: vi.fn() } }))
vi.mock('../../../ws/handler', () => ({ broadcast: vi.fn() }))

import { generateContent } from '../publisher'

const realFetch = globalThis.fetch

describe('generateContent', () => {
  beforeEach(() => {
    h.asked.length = 0
    h.reply = { text: 'A flash brief.' }
    process.env.ANTHROPIC_API_KEY = 'test'
    process.env.OPENAI_API_KEY = 'out-of-credit'
    globalThis.fetch = vi.fn() as never
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    globalThis.fetch = realFetch
  })

  it('writes short pieces on the small model and analysis on the writer, never on OpenAI', async () => {
    const brief = await generateContent('prompt', 200, 'fast')
    const analysis = await generateContent('prompt', 600, 'deep')
    expect(h.asked.map(a => [a.purpose, a.model])).toEqual([['digest', 'claude-haiku-5-5'], ['digest', 'claude-sonnet-5-5']])
    expect(brief).toMatchObject({ text: 'A flash brief.', provider: 'anthropic', tokens: 1050 })
    expect(analysis.model).toBe('claude-sonnet-5-5')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns empty text when Claude gives no answer (the cap), with no other provider tried', async () => {
    h.reply = null
    const result = await generateContent('prompt', 200, 'fast')
    expect(result.text).toBe('')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
