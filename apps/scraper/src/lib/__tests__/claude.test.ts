/**
 * Claude under one spending cap (lib/claude.ts, Oct 11, 2026).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  calls: [] as Array<[string, ...unknown[]]>,
}))

vi.mock('../redis', () => {
  const multi = () => {
    const chain: Record<string, unknown> = {}
    for (const op of ['incrby', 'expire', 'hincrby', 'hset', 'hsetnx', 'hdel']) {
      chain[op] = (...args: unknown[]) => {
        h.calls.push([op, ...args])
        if (op === 'incrby') h.store.set(String(args[0]), String(Number(h.store.get(String(args[0])) ?? 0) + Number(args[1])))
        return chain
      }
    }
    chain.exec = async () => []
    return chain
  }
  return { redis: { mget: vi.fn(async (...keys: string[]) => keys.map(k => h.store.get(k) ?? null)), multi } }
})
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { askClaude, claudeBudgetLeft, costMicros, spendKeys, monthlyCapUsd, wellFormed, thinkingOff, failureReason, HEALTH_KEY } from '../claude'

const realFetch = globalThis.fetch
const OCT_11 = new Date('2026-10-11T14:00:00Z')

describe('costMicros', () => {
  it('prices tokens in millionths of a dollar', () => {
    // Haiku 5.5: $0.10 in and $0.50 out per million tokens
    expect(costMicros('claude-haiku-5-5', 3_000, 200)).toBe(400)
    expect(costMicros('claude-sonnet-5-5', 1_000, 1_000)).toBe(12_000)
    // An unknown model is counted at the dearest price
    expect(costMicros('claude-future', 1_000, 1_000)).toBe(12_000)
  })
})

describe('wellFormed', () => {
  it('drops half an emoji (a summary cut short), and keeps whole ones', () => {
    const half = '🔴'.slice(0, 1)
    expect(wellFormed(`${half} Trump says`)).toBe(' Trump says')
    expect(wellFormed(`Riyadh${'🔴'.slice(1)}`)).toBe('Riyadh')
    expect(wellFormed('🔴 Live: Riyadh')).toBe('🔴 Live: Riyadh')
  })
})

describe('claudeBudgetLeft ($20 a month, spread over the days)', () => {
  beforeEach(() => { h.store.clear(); delete process.env.AI_MONTHLY_CAP_USD })

  it("allows today's share of the month", async () => {
    expect(monthlyCapUsd()).toBe(20)
    const keys = spendKeys(OCT_11)
    h.store.set(keys.day, String(600_000))   // $0.60 of October's $0.645 a day
    expect(await claudeBudgetLeft(OCT_11)).toBe(true)
    h.store.set(keys.day, String(650_000))
    expect(await claudeBudgetLeft(OCT_11)).toBe(false)
  })

  it('stops for the month at the cap, and follows AI_MONTHLY_CAP_USD', async () => {
    const keys = spendKeys(OCT_11)
    h.store.set(keys.month, String(20_000_000))
    expect(await claudeBudgetLeft(OCT_11)).toBe(false)
    process.env.AI_MONTHLY_CAP_USD = '40'
    expect(await claudeBudgetLeft(OCT_11)).toBe(true)
  })
})

describe('askClaude', () => {
  beforeEach(() => { h.store.clear(); h.calls.length = 0; delete process.env.AI_MONTHLY_CAP_USD })
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY })

  it('does nothing without a key', async () => {
    globalThis.fetch = vi.fn() as never
    expect(await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 10 })).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('makes no call once the cap is reached', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    h.store.set(spendKeys().month, String(25_000_000))
    globalThis.fetch = vi.fn() as never
    expect(await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 10 })).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns the text and counts what the reply cost', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: '1 conflict\n2 health' }],
      usage:   { input_tokens: 3_000, output_tokens: 200 },
    }), { status: 200 })) as never
    const reply = await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 100 })
    expect(reply).toEqual({ text: '1 conflict\n2 health', inputTokens: 3_000, outputTokens: 200, costMicros: 400 })
    const [, init] = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]!
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body).not.toHaveProperty('temperature')
    expect(h.store.get(spendKeys().day)).toBe('400')
    expect(h.calls.some(c => c[0] === 'hincrby' && c[2] === 'editor')).toBe(true)
  })

  it('sends no half emoji (the API refuses such a request as invalid JSON)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 })) as never
    await askClaude({ purpose: 'editor', system: 's', prompt: `1. Live ${'🔴'.slice(0, 1)}`, maxTokens: 10 })
    const [, init] = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]!
    expect(JSON.parse(String(init.body)).messages[0].content).toBe('1. Live ')
  })

  it('turns thinking off: it counts toward max_tokens and left replies empty', async () => {
    expect(thinkingOff('claude-haiku-5-5')).toEqual({ type: 'disabled' })
    expect(thinkingOff('claude-sonnet-5-5')).toEqual({ type: 'between_tools' })
    expect(thinkingOff('claude-haiku-4-5-20251001')).toBeUndefined()
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: '1 conflict' }], usage: { input_tokens: 10, output_tokens: 3 }, stop_reason: 'end_turn',
    }), { status: 200 })) as never
    const reply = await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 50 })
    expect(reply).toMatchObject({ text: '1 conflict', stopReason: 'end_turn' })
    const [, init] = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]!
    expect(JSON.parse(String(init.body))).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 50 })
  })

  it('asks again with the default thinking when a model refuses the setting', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    const replies = [
      new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'thinking.type: disabled is not supported' } }), { status: 400 }),
      new Response(JSON.stringify({ content: [{ type: 'thinking' }, { type: 'text', text: '1 sports' }], usage: { input_tokens: 10, output_tokens: 300 } }), { status: 200 }),
    ]
    globalThis.fetch = vi.fn(async () => replies.shift()!) as never
    const reply = await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 50 })
    expect(reply?.text).toBe('1 sports')
    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls
    const second = JSON.parse(String(calls[1]![1].body))
    expect(second).not.toHaveProperty('thinking')
    expect(second.max_tokens).toBe(50 + 2_048)
  })

  it('gives no text for a refusal', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'I can’t help with that.' }], usage: { input_tokens: 10, output_tokens: 8 }, stop_reason: 'refusal',
    }), { status: 200 })) as never
    expect(await askClaude({ purpose: 'factcheck', system: 's', prompt: 'p', maxTokens: 50 })).toMatchObject({ text: '', stopReason: 'refusal' })
  })

  it('gives null on an error reply, spending nothing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response('overloaded', { status: 529 })) as never
    expect(await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 10 })).toBeNull()
    expect(h.store.size).toBe(0)
  })
  it('records why calls fail, and since when, until one works (Oct 14: the spend limit)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    const limit = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error',
      message: 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.' } })
    globalThis.fetch = vi.fn(async () => new Response(limit, { status: 400 })) as never
    expect(await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 10 })).toBeNull()
    const failed = h.calls.find(c => c[0] === 'hset' && c[1] === HEALTH_KEY && c[2] === 'error_at')!
    expect(JSON.parse(String(failed[5]))).toEqual({ app: 'scraper', purpose: 'editor', model: 'claude-haiku-5-5', status: 400, reason: 'spend limit reached' })
    expect(h.calls).toContainEqual(['hsetnx', HEALTH_KEY, 'failing_since', failed[3]])
    expect(h.calls).toContainEqual(['hincrby', HEALTH_KEY, 'failing_calls', 1])
    expect(h.calls.some(c => c[0] === 'hdel')).toBe(false)

    h.calls.length = 0
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: '1 conflict' }], usage: { input_tokens: 10, output_tokens: 3 },
    }), { status: 200 })) as never
    expect(await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 10 })).not.toBeNull()
    expect(h.calls.some(c => c[0] === 'hset' && c[1] === HEALTH_KEY && c[2] === 'ok_at')).toBe(true)
    expect(h.calls).toContainEqual(['hdel', HEALTH_KEY, 'failing_since', 'failing_calls'])
  })

  it('records a call that never got an answer', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') }) }) as never
    expect(await askClaude({ purpose: 'crosscheck', system: 's', prompt: 'p', maxTokens: 10 })).toBeNull()
    const failed = h.calls.find(c => c[0] === 'hset' && c[2] === 'error_at')!
    expect(JSON.parse(String(failed[5]))).toMatchObject({ purpose: 'crosscheck', status: null, reason: 'cannot connect' })
  })
})

describe('failureReason', () => {
  it('names the spend limit and the credit balance from the reply', () => {
    expect(failureReason(400, '{"error":{"message":"You have reached your specified workspace API usage limits."}}')).toBe('spend limit reached')
    expect(failureReason(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')).toBe('out of credit')
  })

  it('names the rest by status', () => {
    expect(failureReason(401)).toBe('key rejected')
    expect(failureReason(403)).toBe('not allowed')
    expect(failureReason(404)).toBe('model not found')
    expect(failureReason(429)).toBe('rate limited')
    expect(failureReason(529)).toBe('overloaded')
    expect(failureReason(500)).toBe('server error')
    expect(failureReason(400, '{"error":{"message":"max_tokens: too large"}}')).toBe('request refused')
  })

  it('names a call that never got an answer', () => {
    expect(failureReason(null, '', new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('timed out')
    expect(failureReason(null, '', new TypeError('fetch failed'))).toBe('cannot connect')
    expect(failureReason(null, '', new SyntaxError('Unexpected token < in JSON'))).toBe('unreadable reply')
    expect(failureReason(null, '', new Error('something else'))).toBe('other')
  })
})
