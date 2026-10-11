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
    for (const op of ['incrby', 'expire', 'hincrby']) {
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

import { askClaude, claudeBudgetLeft, costMicros, spendKeys, monthlyCapUsd } from '../claude'

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

  it('gives null on an error reply, spending nothing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response('overloaded', { status: 529 })) as never
    expect(await askClaude({ purpose: 'editor', system: 's', prompt: 'p', maxTokens: 10 })).toBeNull()
    expect(h.store.size).toBe(0)
  })
})
