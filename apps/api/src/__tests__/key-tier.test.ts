/**
 * API key tiers follow the account, not the request (plan G0, Oct 11, 2026).
 *
 * POST /api/v1/developer/keys took "tier" from the request body, so any
 * signed-in user could create an Enterprise key; Pro-only endpoints trusted
 * the key's stored tier.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'

// users table: id → row; a missing column throws like Postgres would
const users: Record<string, Record<string, unknown>> = {}
let hasPlanColumn = true
const inserted: Array<Record<string, unknown>> = []

vi.mock('../db/postgres', () => {
  const db = vi.fn((table: string) => {
    let id = ''
    const q = {
      where: vi.fn((col: string | Record<string, unknown>, val?: unknown) => {
        if (col === 'id') id = String(val)
        if (typeof col === 'object' && col.key_hash) id = String(col.key_hash)
        if (col === 'key_hash') id = String(val)
        return q
      }),
      first: vi.fn(async (cols: string[]) => {
        if (table === 'api_keys') {
          return id === 'hash_wp_live_selfmade' ? { id: 'k1', user_id: 'free-user', tier: 'pro', rate_limit_per_min: 300, rate_limit_per_day: 10_000 }
            : id === 'hash_wp_live_paid' ? { id: 'k2', user_id: 'pro-user', tier: 'pro', rate_limit_per_min: 300, rate_limit_per_day: 10_000 }
            : undefined
        }
        if (cols.includes('subscription_plan') && !hasPlanColumn) throw new Error('column "subscription_plan" does not exist')
        const row = users[id]
        return row ? Object.fromEntries(cols.map(c => [c, row[c]])) : undefined
      }),
      insert: vi.fn((row: Record<string, unknown>) => {
        inserted.push(row)
        return { returning: vi.fn(async () => [{ id: 'new', ...row }]) }
      }),
      update: vi.fn(async () => 1),
    }
    return q
  })
  return { db }
})

vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), setex: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), del: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../lib/api-keys', () => ({
  hashKey: (k: string) => `hash_${k}`,
  generateApiKey: () => ({ key: 'wp_live_new', hash: 'hash_new' }),
  TIER_LIMITS: { free: { rpm: 60, rpd: 1_000 }, pro: { rpm: 300, rpd: 10_000 }, enterprise: { rpm: 9999, rpd: 999_999 } },
}))

let signedIn: { id: string; accountType: string } = { id: 'free-user', accountType: 'user' }
vi.mock('../middleware/auth', () => ({
  authenticate: async (req: FastifyRequest) => { (req as unknown as { user: unknown }).user = { ...signedIn, handle: 'h', trustScore: 0.5 } },
}))

const { maxKeyTier } = await import('../lib/key-tier')
const { registerDeveloperRoutes } = await import('../routes/developer')
const { registerSlopRoutes } = await import('../routes/slop')

async function app() {
  const a = Fastify({ logger: false })
  await a.register(registerDeveloperRoutes, { prefix: '/keys' })
  await a.register(registerSlopRoutes, { prefix: '/slop' })
  await a.ready()
  return a
}

beforeEach(() => {
  hasPlanColumn = true
  inserted.length = 0
  for (const k of Object.keys(users)) delete users[k]
  users['free-user'] = { account_type: 'user', subscription_plan: 'free' }
  users['pro-user'] = { account_type: 'user', subscription_plan: 'pro' }
  users['devon'] = { account_type: 'admin', subscription_plan: 'free' }
  signedIn = { id: 'free-user', accountType: 'user' }
})

describe('maxKeyTier', () => {
  it('follows the plan, and admins may hold any tier', async () => {
    expect(await maxKeyTier('free-user')).toBe('free')
    expect(await maxKeyTier('pro-user')).toBe('pro')
    expect(await maxKeyTier('devon')).toBe('enterprise')
    expect(await maxKeyTier('nobody')).toBe('free')
  })

  it('answers "free" when the database has no plan column', async () => {
    hasPlanColumn = false
    expect(await maxKeyTier('pro-user')).toBe('free')
    expect(await maxKeyTier('devon')).toBe('enterprise')
  })
})

describe('POST /api/v1/developer/keys', () => {
  it("won't make an Enterprise or Pro key for a free account", async () => {
    const a = await app()
    for (const tier of ['enterprise', 'pro']) {
      const res = await a.inject({ method: 'POST', url: '/keys', payload: { name: 'mine', tier } })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('FORBIDDEN')
    }
    expect(inserted).toHaveLength(0)
    const ok = await a.inject({ method: 'POST', url: '/keys', payload: { name: 'mine', tier: 'free' } })
    expect(ok.statusCode).toBe(201)
    expect(inserted[0]).toMatchObject({ tier: 'free', rate_limit_per_min: 60 })
  })

  it('makes Pro keys for Pro subscribers and any key for an admin', async () => {
    signedIn = { id: 'pro-user', accountType: 'user' }
    const a = await app()
    expect((await a.inject({ method: 'POST', url: '/keys', payload: { name: 'p', tier: 'pro' } })).statusCode).toBe(201)
    expect((await a.inject({ method: 'POST', url: '/keys', payload: { name: 'e', tier: 'enterprise' } })).statusCode).toBe(403)
    signedIn = { id: 'devon', accountType: 'admin' }
    expect((await a.inject({ method: 'POST', url: '/keys', payload: { name: 'partner', tier: 'enterprise' } })).statusCode).toBe(201)
    expect(inserted.map(r => r.tier)).toEqual(['pro', 'enterprise'])
  })
})

describe('POST /api/v1/slop/batch (Pro only)', () => {
  const body = { items: [{ url: 'https://example.com/a' }] }

  it('turns away a "pro" key whose owner has no Pro plan', async () => {
    const a = await app()
    const res = await a.inject({ method: 'POST', url: '/slop/batch', headers: { 'x-api-key': 'wp_live_selfmade' }, payload: body })
    expect(res.statusCode).toBe(403)
  })

  it("lets a Pro subscriber's key through", async () => {
    const a = await app()
    const res = await a.inject({ method: 'POST', url: '/slop/batch', headers: { 'x-api-key': 'wp_live_paid' }, payload: body })
    expect(res.statusCode).not.toBe(403)
    expect(res.statusCode).not.toBe(401)
  })
})
