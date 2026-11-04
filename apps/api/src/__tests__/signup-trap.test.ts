/**
 * The sign-up bot trap (lib/signup-guard.ts and the website's lib/signup-trap.ts, Nov 3, 2026): a form a
 * script filled in makes no account, a person's form does, and one address makes at most
 * SIGNUPS_PER_HOUR.account accounts in an hour. A direct call to the API, which sends neither of the form's
 * fields, still works.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-secret-for-the-signup-trap'

type Row = Record<string, unknown>
const users: Row[] = []

vi.mock('../db/postgres', () => {
  const builder = () => {
    const conds: Array<(r: Row) => boolean> = []
    const api: Record<string, unknown> = {}
    api.where = (f: string, v: unknown) => { conds.push(r => r[f] === v); return api }
    api.orWhere = (f: string, v: unknown) => {
      const before = conds.splice(0)
      conds.push(r => before.every(c => c(r)) || r[f] === v)
      return api
    }
    api.first = async () => users.find(r => conds.every(c => c(r)))
    api.insert = (data: Row) => ({
      returning: async () => {
        const row = { id: `u-${users.length + 1}`, account_type: 'free', trust_score: 0.5, verified: false,
          onboarded: false, created_at: new Date('2026-11-03T22:00:00Z'), ...data }
        users.push(row)
        return [row]
      },
    })
    return api
  }
  const db = () => builder()
  db.schema = { hasColumn: async () => true }
  db.fn = { now: () => new Date() }
  return { db }
})

const store = new Map<string, string>()
const hashes = new Map<string, Record<string, number>>()
vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    incr: vi.fn(async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n }),
    expire: vi.fn(async () => 1),
    setex: vi.fn(async (k: string, _s: number, v: string) => { store.set(k, v); return 'OK' }),
    hincrby: vi.fn(async (k: string, f: string, by: number) => {
      const h = hashes.get(k) ?? {}; h[f] = (h[f] ?? 0) + by; hashes.set(k, h); return h[f]
    }),
  },
}))
vi.mock('../lib/search', () => ({ indexUser: vi.fn(async () => {}) }))

import { signupTrap, SIGNUP_MIN_FORM_MS, SIGNUPS_PER_HOUR } from '../lib/signup-guard'

let app: Awaited<ReturnType<typeof makeApp>>
async function makeApp() {
  const Fastify = (await import('fastify')).default
  const jwt = (await import('@fastify/jwt')).default
  const { registerAuthRoutes } = await import('../routes/auth')
  const a = Fastify()
  await a.register(jwt, { secret: process.env.JWT_SECRET! })
  await a.register(registerAuthRoutes, { prefix: '/api/v1/auth' })
  return a
}

let n = 0
const person = () => {
  n += 1
  return { handle: `reader_${n}`, displayName: `Reader ${n}`, email: `reader${n}@example.com`, password: 'a-long-password' }
}
const register = (payload: Row, ip = '203.0.113.7') =>
  app.inject({ method: 'POST', url: '/api/v1/auth/register', payload, remoteAddress: ip })

beforeAll(async () => { app = await makeApp() })
beforeEach(() => { users.length = 0; store.clear(); hashes.clear() })

describe('what the form says about who filled it in', () => {
  it('stops a filled-in hidden box and a form sent at once, and nothing else', () => {
    expect(signupTrap({ extra: 'http://spam.example' })).toBe('filled-hidden-box')
    expect(signupTrap({ extra: '', formMs: 120 })).toBe('too-fast')
    expect(signupTrap({ extra: '   ', formMs: SIGNUP_MIN_FORM_MS })).toBeNull()
    expect(signupTrap({ handle: 'direct_caller' })).toBeNull()   // a direct API call sends neither field
    expect(signupTrap(null)).toBeNull()
  })
})

describe('POST /api/v1/auth/register with the trap', () => {
  it("makes a person's account from the website's form", async () => {
    const res = await register({ ...person(), extra: '', formMs: 14_000 })
    expect(res.statusCode).toBe(201)
    expect(users).toHaveLength(1)
  })

  it('makes no account when a script filled in the hidden box, and counts it', async () => {
    const res = await register({ ...person(), extra: 'https://cheap-pills.example', formMs: 9_000 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Invalid input')
    expect(users).toHaveLength(0)
    await new Promise(r => setTimeout(r, 0))
    expect([...hashes.values()][0]).toEqual({ 'filled-hidden-box': 1 })
  })

  it('asks a form sent at once to try again, and makes no account', async () => {
    const res = await register({ ...person(), extra: '', formMs: 300 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('try again')
    expect(users).toHaveLength(0)
  })

  it('still takes a direct API call that sends neither field', async () => {
    expect((await register(person())).statusCode).toBe(201)
  })

  it(`makes at most ${SIGNUPS_PER_HOUR.account} accounts from one address in an hour; other addresses carry on`, async () => {
    for (let i = 0; i < SIGNUPS_PER_HOUR.account; i++) {
      expect((await register({ ...person(), extra: '', formMs: 5_000 })).statusCode).toBe(201)
    }
    const over = await register({ ...person(), extra: '', formMs: 5_000 })
    expect(over.statusCode).toBe(429)
    expect(over.json().error).toContain('in an hour')
    expect(users).toHaveLength(SIGNUPS_PER_HOUR.account)
    expect((await register({ ...person(), extra: '', formMs: 5_000 }, '198.51.100.20')).statusCode).toBe(201)
  })
})
