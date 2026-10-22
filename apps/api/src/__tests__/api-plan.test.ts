/**
 * Pro API keys (plan V3d; Devon, Oct 21, 2026: "A Pro key gets its own
 * budget: 600 a minute and 50,000 a day; free stays as today"), checked with
 * the real rate-limit plugin (its in-memory store) and the API's own options.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'

const h = vi.hoisted(() => ({
  keys: new Map<string, Record<string, unknown>>(),
  users: new Map<string, Record<string, unknown>>(),
  lookups: 0,
  day: new Map<string, number>(),
}))

vi.mock('../db/postgres', () => {
  const table = (name: string) => {
    let found: Record<string, unknown> | undefined
    const q = {
      where: (a: unknown, b?: unknown) => {
        if (name === 'api_keys') { h.lookups += 1; found = h.keys.get((a as { key_hash: string }).key_hash) }
        else found = h.users.get(String(b))
        return q
      },
      first: async () => found,
    }
    return q
  }
  return { db: vi.fn(table) }
})

const { hashKey } = await import('../lib/api-keys')
const plan = await import('../lib/api-plan')
const { rateLimitOptions } = await import('../lib/rate-limit-options')

const redis = {
  incr: vi.fn(async (k: string) => { const n = (h.day.get(k) ?? 0) + 1; h.day.set(k, n); return n }),
  expire: vi.fn(async () => 1),
}

async function app() {
  const a = Fastify({ logger: false, trustProxy: ['loopback'] })
  plan.registerApiPlans(a, redis as never)
  const { redis: _r, ...opts } = rateLimitOptions(redis as never)
  await a.register(rateLimit, opts)
  a.get('/open', async () => ({ ok: true }))
  a.get('/story', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  a.post('/form', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  return a
}

const PRO = 'wp_live_' + 'a'.repeat(32)
const FREE = 'wp_live_' + 'b'.repeat(32)
const LAPSED = 'wp_live_' + 'c'.repeat(32)
const from = (ip: string) => ({ remoteAddress: ip })

beforeEach(() => {
  plan.forgetApiPlans()
  h.keys.clear(); h.users.clear(); h.day.clear(); h.lookups = 0
  h.users.set('u-pro', { account_type: 'community', subscription_plan: 'pro' })
  h.users.set('u-free', { account_type: 'community', subscription_plan: 'free' })
  h.keys.set(hashKey(PRO), { id: 'k-pro', user_id: 'u-pro', tier: 'free', rate_limit_per_min: 60, rate_limit_per_day: 1000 })
  h.keys.set(hashKey(FREE), { id: 'k-free', user_id: 'u-free', tier: 'free', rate_limit_per_min: 60, rate_limit_per_day: 1000 })
  h.keys.set(hashKey(LAPSED), { id: 'k-lapsed', user_id: 'u-free', tier: 'pro', rate_limit_per_min: 600, rate_limit_per_day: 50000 })
})

describe('lib/api-plan', () => {
  it('reads the key from X-Api-Key or a wp_live_ bearer token, nothing else', () => {
    expect(plan.sentKey({ 'x-api-key': ' wp_live_x ' })).toBe('wp_live_x')
    expect(plan.sentKey({ authorization: 'Bearer wp_live_y' })).toBe('wp_live_y')
    expect(plan.sentKey({ authorization: 'Bearer eyJhbGciOi.sign-in-token' })).toBeNull()
    expect(plan.sentKey({})).toBeNull()
  })

  it("the account's plan decides: a Pro account's keys are Pro, none once it lapses; enterprise needs both", () => {
    expect(plan.effectiveTier('free', 'pro')).toBe('pro')
    expect(plan.effectiveTier('pro', 'free')).toBe('free')
    expect(plan.effectiveTier('enterprise', 'enterprise')).toBe('enterprise')
    expect(plan.effectiveTier('free', 'enterprise')).toBe('pro')
    expect(plan.keyLimits('pro')).toEqual({ perMinute: 600, perDay: 50_000 })
    expect(plan.keyLimits('free')).toBeNull()
    expect(plan.keyLimits('enterprise', { perMinute: 9999, perDay: 999_999 })).toEqual({ perMinute: 9999, perDay: 999_999 })
  })

  it("a read endpoint's own limit: ten times for a Pro key, up to its 600", () => {
    const pro = { keyId: 'k', tier: 'pro' as const, perMinute: 600, perDay: 50_000 }
    expect(plan.routeMaxFor(pro, 60)).toBe(600)
    expect(plan.routeMaxFor(pro, 30)).toBe(300)
    expect(plan.routeMaxFor(pro, 5)).toBe(50)
    expect(plan.routeMaxFor(null, 60)).toBe(60)
  })

  it('looks a key up once a minute', async () => {
    await plan.resolveApiPlan({ 'x-api-key': PRO }, 1_000)
    await plan.resolveApiPlan({ 'x-api-key': PRO }, 30_000)
    expect(h.lookups).toBe(1)
    await plan.resolveApiPlan({ 'x-api-key': PRO }, 70_000)
    expect(h.lookups).toBe(2)
  })

  it('midnight UTC', () => {
    expect(plan.secondsToMidnightUtc(new Date('2026-10-21T23:59:00Z'))).toBe(60)
    expect(plan.dayKey('k1', new Date('2026-10-21T23:59:00Z'))).toBe('apikey:day:k1:2026-10-21')
  })
})

describe('the API with Pro keys', () => {
  const get = (a: Awaited<ReturnType<typeof app>>, url: string, ip: string, key?: string) =>
    a.inject({ method: 'GET', url, ...from(ip), headers: key ? { 'x-api-key': key } : {} })

  it('across the API: 600 a minute for a Pro key, 200 for everyone else', async () => {
    const a = await app()
    expect((await get(a, '/open', '203.0.113.1')).headers['x-ratelimit-limit']).toBe('200')
    expect((await get(a, '/open', '203.0.113.1', PRO)).headers['x-ratelimit-limit']).toBe('600')
    expect((await get(a, '/open', '203.0.113.1', FREE)).headers['x-ratelimit-limit']).toBe('200')
    expect((await get(a, '/open', '203.0.113.1', LAPSED)).headers['x-ratelimit-limit']).toBe('200')
  })

  it("a read endpoint's own limit: 30 for a Pro key where it is 3, in the key's own budget", async () => {
    const a = await app()
    for (let i = 0; i < 3; i++) expect((await get(a, '/story', '203.0.113.2')).statusCode).toBe(200)
    expect((await get(a, '/story', '203.0.113.2')).statusCode).toBe(429)
    // a free key at the same address shares the address's budget: used up
    expect((await get(a, '/story', '203.0.113.2', FREE)).statusCode).toBe(429)
    // the Pro key, from that same address, has its own
    for (let i = 0; i < 30; i++) expect((await get(a, '/story', '203.0.113.2', PRO)).statusCode).toBe(200)
    expect((await get(a, '/story', '203.0.113.2', PRO)).statusCode).toBe(429)
  })

  it('endpoints that change things keep their limits for a Pro key', async () => {
    const a = await app()
    const post = () => a.inject({ method: 'POST', url: '/form', ...from('203.0.113.3'), headers: { 'x-api-key': PRO } })
    expect((await post()).statusCode).toBe(200)
    expect((await post()).statusCode).toBe(200)
    expect((await post()).statusCode).toBe(429)
  })

  it('50,000 a day per Pro key, then 429 until midnight UTC', async () => {
    const a = await app()
    h.day.set(plan.dayKey('k-pro'), 50_000)
    const res = await get(a, '/open', '203.0.113.4', PRO)
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' })
    expect(res.json().error).toMatch(/50,000 requests for today are used up/)
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
    // no key: no daily count
    expect((await get(a, '/open', '203.0.113.4')).statusCode).toBe(200)
    expect([...h.day.keys()].filter(k => !k.includes('k-pro'))).toEqual([])
  })
})
