/**
 * The AI companies' servers (Devon, Nov 21, 2026: "Proceed with all 3"): everyone using WorldPulse in Claude or
 * ChatGPT asks from the few addresses Anthropic and OpenAI publish, so those addresses get 600 a minute (a Pro key's
 * budget), each in its own count, on the AI tools and the routes they ask. Checked with the real rate-limit plugin
 * (its in-memory store) and the API's own options, like the Pro keys (api-plan.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'

vi.mock('../db/postgres', () => ({ db: vi.fn(() => ({ where: () => ({ first: async () => undefined }) })) }))

const ai = await import('../lib/ai-platforms')
const plan = await import('../lib/api-plan')
const { rateLimitOptions } = await import('../lib/rate-limit-options')
const { internalCallHeaders } = await import('../lib/internal-call')

const redis = { incr: vi.fn(async () => 1), expire: vi.fn(async () => 1) }

async function app() {
  const a = Fastify({ logger: false, trustProxy: ['loopback'] })
  plan.registerApiPlans(a, redis as never)
  const { redis: _r, ...opts } = rateLimitOptions(redis as never)
  await a.register(rateLimit, opts)
  a.get('/open', async () => ({ ok: true }))
  a.get('/story', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  a.post('/form', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  // the AI tools' own limit, as routes/mcp.ts sets it (lib/api-plan.ts raises it for their servers)
  a.post('/mcp', { config: { rateLimit: { max: 60, timeWindow: '1 minute' }, aiPlatforms: true } }, async () => ({ ok: true }))
  return a
}

const CLAUDE = '160.79.105.20'      // in Anthropic's 160.79.104.0/21
const CLAUDE_2 = '153.61.223.255'   // the last address of 153.61.208.0/20
const CHATGPT = '23.102.140.117'    // in the made-up OpenAI list below
const ANYONE = '203.0.113.7'
const OPENAI_LIST = { creationTime: '2026-11-20T00:00:00.000000', prefixes: [{ ipv4Prefix: '23.102.140.112/28' }, { ipv6Prefix: '2603:1030::/32' }, { ipv4Prefix: 'not a range' }] }

beforeEach(() => {
  plan.forgetApiPlans()
  ai.setOpenAiRanges([], null)
})

describe('the published addresses', () => {
  it("Anthropic's outbound ranges, edges included, and nothing next to them", () => {
    expect(ai.ANTHROPIC_OUTBOUND).toEqual(['160.79.104.0/21', '153.61.208.0/20'])
    for (const ip of ['160.79.104.0', CLAUDE, '160.79.111.255', '153.61.208.0', CLAUDE_2, '::ffff:160.79.104.9']) expect(ai.aiPlatformOfIp(ip), ip).toBe('anthropic')
    for (const ip of ['160.79.103.255', '160.79.112.0', '153.61.207.255', '153.61.224.0', ANYONE, '::1', 'nonsense', '']) expect(ai.aiPlatformOfIp(ip), ip).toBeNull()
  })

  it("OpenAI's list: its IPv4 ranges (an IPv6 one and a broken one are skipped)", () => {
    const ranges = ai.openAiRanges(OPENAI_LIST)
    expect(ranges).toHaveLength(1)
    ai.setOpenAiRanges(ranges)
    expect(ai.aiPlatformOfIp(CHATGPT)).toBe('openai')
    expect(ai.aiPlatformOfIp('23.102.140.128')).toBeNull()
    expect(ai.openAiRanges(null)).toEqual([])
    expect(ai.openAiRanges({ prefixes: 'x' })).toEqual([])
  })

  it('a rate-limit key: an address is checked, a signed-in user is nobody\'s server', () => {
    expect(ai.aiPlatformOfKey(`ip:${CLAUDE}`)).toBe('anthropic')
    expect(ai.aiPlatformOfKey('user:160.79.105.20')).toBeNull()
    expect(ai.parseCidr('160.79.104.0/21')).toEqual([2689558528, 2689558528 + 2047])
    expect(ai.parseCidr('160.79.104.0/33')).toBeNull()
  })

  it("reads OpenAI's list, and keeps the last one when a read fails or comes back empty", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(OPENAI_LIST), { status: 200 }))
    expect(await ai.refreshOpenAiRanges(ok as unknown as typeof fetch)).toBe(1)
    expect((ok.mock.calls[0] as unknown[])[0]).toBe('https://openai.com/chatgpt-connectors.json')
    expect(ai.aiPlatformStatus()).toMatchObject({ perMinute: 600, anthropic: { ranges: 2 }, openai: { ranges: 1 } })
    const down = vi.fn(async () => new Response('busy', { status: 503 }))
    await expect(ai.refreshOpenAiRanges(down as unknown as typeof fetch)).rejects.toThrow('HTTP 503')
    const empty = vi.fn(async () => new Response(JSON.stringify({ prefixes: [] }), { status: 200 }))
    await expect(ai.refreshOpenAiRanges(empty as unknown as typeof fetch)).rejects.toThrow('no IPv4 ranges')
    expect(ai.aiPlatformOfIp(CHATGPT)).toBe('openai')
  })
})

describe('the API with the AI companies\' servers', () => {
  const get = (a: Awaited<ReturnType<typeof app>>, url: string, ip: string, headers: Record<string, string> = {}) =>
    a.inject({ method: 'GET', url, remoteAddress: ip, headers })

  it('across the API: 600 a minute for their addresses, 200 for everyone else', async () => {
    ai.setOpenAiRanges(ai.openAiRanges(OPENAI_LIST))
    const a = await app()
    expect((await get(a, '/open', CLAUDE)).headers['x-ratelimit-limit']).toBe('600')
    expect((await get(a, '/open', CLAUDE_2)).headers['x-ratelimit-limit']).toBe('600')
    expect((await get(a, '/open', CHATGPT)).headers['x-ratelimit-limit']).toBe('600')
    expect((await get(a, '/open', ANYONE)).headers['x-ratelimit-limit']).toBe('200')
  })

  it("the AI tools: 600 a minute for Claude's servers, 60 for everyone else", async () => {
    const a = await app()
    const post = (ip: string) => a.inject({ method: 'POST', url: '/mcp', remoteAddress: ip, payload: {} })
    expect((await post(CLAUDE)).headers['x-ratelimit-limit']).toBe('600')
    expect((await post(ANYONE)).headers['x-ratelimit-limit']).toBe('60')
  })

  it("a read endpoint's own limit: ten times for their addresses (30 where it is 3), each address in its own count", async () => {
    const a = await app()
    for (let i = 0; i < 30; i++) expect((await get(a, '/story', CLAUDE)).statusCode).toBe(200)
    expect((await get(a, '/story', CLAUDE)).statusCode).toBe(429)
    // another of Anthropic's addresses has its own count
    expect((await get(a, '/story', CLAUDE_2)).statusCode).toBe(200)
    for (let i = 0; i < 3; i++) expect((await get(a, '/story', ANYONE)).statusCode).toBe(200)
    expect((await get(a, '/story', ANYONE)).statusCode).toBe(429)
  })

  it("a tool's call to a route on a Claude user's behalf counts as Claude's address, with its allowance", async () => {
    const a = await app()
    const res = await get(a, '/story', '127.0.0.1', internalCallHeaders(`ip:${CLAUDE}`))
    expect(res.headers['x-ratelimit-limit']).toBe('30')
    expect((await get(a, '/story', '127.0.0.1', internalCallHeaders(`ip:${ANYONE}`))).headers['x-ratelimit-limit']).toBe('3')
  })

  it('endpoints that change things keep their limits', async () => {
    const a = await app()
    const post = () => a.inject({ method: 'POST', url: '/form', remoteAddress: CLAUDE })
    expect((await post()).statusCode).toBe(200)
    expect((await post()).statusCode).toBe(200)
    expect((await post()).statusCode).toBe(429)
  })
})
