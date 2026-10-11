/**
 * The fact-check on Claude (pipeline/verify.ts, in-house plan, Oct 11, 2026):
 * only for stories that matter, within the spending cap, never OpenAI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ replies: [] as Array<string | null>, asked: [] as Array<{ purpose: string; prompt: string }> }))

vi.mock('../lib/postgres.js', () => ({ db: vi.fn(() => ({ insert: vi.fn().mockResolvedValue([]) })) }))
vi.mock('../lib/redis.js', () => ({ redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') } }))
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/claude.js', () => ({
  claudeConfigured: () => true,
  askClaude: vi.fn(async (opts: { purpose: string; prompt: string }) => {
    h.asked.push({ purpose: opts.purpose, prompt: opts.prompt })
    const text = h.replies.shift()
    return text == null ? null : { text, inputTokens: 700, outputTokens: 80, costMicros: 110 }
  }),
}))

const { verifySignal, worthAFactCheck, jsonIn } = await import('../pipeline/verify.js')

const article = (sourceId: string, title: string) => ({
  sourceId, sourceTrust: 0.85, sourceTier: 'mainstream', title, url: `https://${sourceId}.example/a`,
})
const realFetch = globalThis.fetch

describe('the fact-check on Claude', () => {
  beforeEach(() => {
    h.replies.length = 0
    h.asked.length = 0
    process.env.OPENAI_API_KEY = 'out-of-credit'
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 429 })) as never
  })
  afterEach(() => { delete process.env.OPENAI_API_KEY; globalThis.fetch = realFetch })

  it('cross-checks a story with two reports, and never calls OpenAI', async () => {
    h.replies.push('```json\n{"consistent": true, "confidence": 0.9, "problems": [], "summary": "Both reports agree: 109 dead off Djibouti."}\n```')
    const result = await verifySignal(
      { id: 's1', severity: 'critical', category: 'disaster' },
      [article('aljazeera', '109 dead as migrant boat capsizes off Djibouti'), article('bbc', 'Djibouti shipwreck kills at least 109')],
    )
    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]!.purpose).toBe('factcheck')
    expect(h.asked[0]!.prompt).toContain('Report 2 [source trust 0.85]: Djibouti shipwreck kills at least 109')
    expect(result.checkTypes).toContain('llm_fact_check')
    expect(result.reasons).toContain('[Claude] Both reports agree: 109 dead off Djibouti.')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('leaves out a single low-key report', async () => {
    await verifySignal({ id: 's2', severity: 'low', category: 'culture' }, [article('nst', 'Festival opens in Penang')])
    expect(h.asked).toHaveLength(0)
  })

  it('counts for nothing when Claude gives no answer (the cap)', async () => {
    h.replies.push(null)
    const result = await verifySignal({ id: 's3', severity: 'high', category: 'conflict' }, [article('a', 'Strike hits port'), article('b', 'Port struck')])
    expect(result.reasons).toContain('AI fact-check unavailable')
  })
})

describe('worthAFactCheck and jsonIn', () => {
  it('picks stories with two reports, or high and critical ones', () => {
    expect(worthAFactCheck({ severity: 'medium' }, [article('a', 'x'), article('b', 'y')])).toBe(true)
    expect(worthAFactCheck({ severity: 'high' }, [article('a', 'x')])).toBe(true)
    expect(worthAFactCheck({ severity: 'medium' }, [article('a', 'x')])).toBe(false)
  })

  it('finds the JSON in a fenced answer', () => {
    expect(jsonIn('Here:\n```json\n{"consistent": false}\n```')).toBe('{"consistent": false}')
    expect(jsonIn('no json')).toBeNull()
  })
})
