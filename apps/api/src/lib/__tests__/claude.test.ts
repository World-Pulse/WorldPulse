/**
 * The API's Claude calls under the cap it shares with the scraper
 * (lib/claude.ts, Oct 11, 2026).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('../../db/redis', () => {
  const chain: Record<string, unknown> = {}
  chain.incrby = (key: string, by: number) => { h.store.set(key, String(Number(h.store.get(key) ?? 0) + by)); return chain }
  chain.expire = () => chain
  chain.hincrby = () => chain
  chain.exec = async () => []
  return { redis: { mget: vi.fn(async (...keys: string[]) => keys.map(k => h.store.get(k) ?? null)), multi: () => chain } }
})
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { askClaude, claudeBudgetLeft, costMicros, spendKeys, wellFormed, thinkingOff } from '../claude'

const realFetch = globalThis.fetch

describe('the shared cap', () => {
  beforeEach(() => { h.store.clear(); delete process.env.AI_MONTHLY_CAP_USD })
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY })

  it('uses the same Redis keys as the scraper', () => {
    expect(spendKeys(new Date('2026-10-11T14:00:00Z'))).toEqual({
      day: 'ai:claude:spend:2026-10-11', month: 'ai:claude:spend:2026-10', calls: 'ai:claude:calls:2026-10-11',
    })
  })

  it('prices Sonnet 5.5 for the writer and Haiku 5.5 for the rest', () => {
    expect(costMicros('claude-sonnet-5-5', 3_000, 600)).toBe(12_000)
    expect(costMicros('claude-haiku-5-5', 3_000, 600)).toBe(600)
  })

  it("stops at today's share", async () => {
    const now = new Date('2026-10-11T14:00:00Z')
    h.store.set(spendKeys(now).day, '700000')
    expect(await claudeBudgetLeft(now)).toBe(false)
  })

  it('counts what a reply cost', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Summary.' }], usage: { input_tokens: 1_000, output_tokens: 100 },
    }), { status: 200 })) as never
    const reply = await askClaude({ purpose: 'summary', prompt: 'p', maxTokens: 200 })
    expect(reply).toMatchObject({ text: 'Summary.', model: 'claude-haiku-5-5', costMicros: 150 })
    expect(h.store.get(spendKeys().month)).toBe('150')
  })

  it('turns thinking off for the writer and the small model', async () => {
    expect(thinkingOff('claude-sonnet-5-5')).toEqual({ type: 'between_tools' })
    expect(thinkingOff('claude-haiku-5-5')).toEqual({ type: 'disabled' })
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Analysis.' }], usage: { input_tokens: 100, output_tokens: 10 }, stop_reason: 'end_turn',
    }), { status: 200 })) as never
    const reply = await askClaude({ purpose: 'digest', prompt: 'p', maxTokens: 600, model: 'claude-sonnet-5-5' })
    expect(reply).toMatchObject({ text: 'Analysis.', stopReason: 'end_turn' })
    const [, init] = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]!
    expect(JSON.parse(String(init.body))).toMatchObject({ thinking: { type: 'between_tools' }, max_tokens: 600 })
  })

  it('asks again with the default thinking when a model refuses the setting', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    const replies = [
      new Response(JSON.stringify({ type: 'error', error: { message: 'thinking.type: between_tools is not supported' } }), { status: 400 }),
      new Response(JSON.stringify({ content: [{ type: 'thinking' }, { type: 'text', text: 'Brief.' }], usage: { input_tokens: 10, output_tokens: 900 } }), { status: 200 }),
    ]
    globalThis.fetch = vi.fn(async () => replies.shift()!) as never
    expect((await askClaude({ purpose: 'digest', prompt: 'p', maxTokens: 200, model: 'claude-sonnet-5-5' }))?.text).toBe('Brief.')
    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls
    expect(JSON.parse(String(calls[1]![1].body))).toMatchObject({ max_tokens: 2_248 })
    expect(JSON.parse(String(calls[1]![1].body))).not.toHaveProperty('thinking')
  })

  it('sends no half emoji (the API refuses such a request as invalid JSON)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 })) as never
    await askClaude({ purpose: 'digest', system: `Brief ${'🔴'.slice(1)}`, prompt: `Riyadh ${'🔴'.slice(0, 1)}`, maxTokens: 10 })
    const [, init] = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]!
    const body = JSON.parse(String(init.body))
    expect([body.system, body.messages[0].content]).toEqual(['Brief ', 'Riyadh '])
    expect(wellFormed('🔴 Live')).toBe('🔴 Live')
  })
})
