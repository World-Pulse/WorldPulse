/**
 * Closing an account instead of deleting it (Devon, Nov 11, 2026: "Don't fully delete accounts"):
 * lib/account-close.ts, POST /api/v1/users/me/close, and sign-in refusing a closed account
 * (password, GitHub, the sign-up form's taken email, /auth/me).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import bcrypt from 'bcryptjs'

const OWNER = '3f2b8c1e-5d4a-4c3b-9a8e-7f6d5c4b3a21'
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

type Row = Record<string, unknown>
type Filter = Row | { or: Row } | { orRaw: string; binds: unknown[] } | { group: Filter[] }

const h = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  subs: new Map<string, Record<string, unknown>>(),
  tables: {} as Record<string, boolean>,
  updates: [] as Array<{ table: string; where: unknown[]; patch: Record<string, unknown>; inTrx: boolean }>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  changed: {} as Record<string, number>,
  failIn: null as string | null,
  redis: new Map<string, string>(),
}))

vi.mock('../lib/search', () => ({ indexUser: vi.fn(async () => {}) }))
vi.mock('../lib/email', () => ({ EMAIL_CONFIGURED: false, sendEmail: vi.fn(async () => true) }))
vi.mock('../lib/last-seen', () => ({ markSeen: vi.fn(async () => {}) }))
vi.mock('../lib/security', () => ({
  checkLoginAttempt: vi.fn(async () => ({ allowed: true })),
  recordFailedLogin: vi.fn(async () => {}),
  clearLoginAttempts: vi.fn(async () => {}),
}))
vi.mock('../lib/signup-guard', () => ({
  signupTrap: () => null,
  signupAllowed: async () => true,
  countSignup: async () => {},
  noteTrapped: async () => {},
}))
// The user routes' sign-in check: x-test-user names the signed-in account
vi.mock('../middleware/auth', () => ({
  optionalAuth: vi.fn(async () => {}),
  authenticate: vi.fn(async (req: { headers: Record<string, unknown>; user?: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
    const id = req.headers['x-test-user']
    if (typeof id !== 'string') return reply.status(401).send({ success: false, code: 'UNAUTHORIZED', error: 'Sign-in required' })
    req.user = { id, handle: 'reader', accountType: 'community', trustScore: 0.5 }
  }),
}))
vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => h.redis.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { h.redis.set(k, v); return 'OK' }),
    setex: vi.fn(async (k: string, _s: number, v: string) => { h.redis.set(k, v); return 'OK' }),
    del: vi.fn(async (...keys: string[]) => keys.filter(k => h.redis.delete(k)).length),
    mget: vi.fn(async (...keys: string[]) => keys.map(k => h.redis.get(k) ?? null)),
    scan: vi.fn(async (_cursor: string, _m: string, pattern: string) => {
      const prefix = pattern.replace(/\*$/, '')
      return ['0', [...h.redis.keys()].filter(k => k.startsWith(prefix))]
    }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}))
vi.mock('../db/postgres', () => {
  const eq = (row: Record<string, unknown>, f: Record<string, unknown>) => Object.entries(f).every(([k, v]) => row[k] === v)
  const holds = (row: Record<string, unknown>, where: Filter[]): boolean => {
    let ok = true
    where.forEach((f, i) => {
      if ('or' in f) ok = ok || eq(row, f.or as Row)
      else if ('orRaw' in f) ok = ok || String(row.email ?? '').toLowerCase() === (f as { binds: unknown[] }).binds[0]
      else if ('group' in f) ok = (i === 0 ? true : ok) && holds(row, (f as { group: Filter[] }).group)
      else ok = (i === 0 ? true : ok) && eq(row, f as Row)
    })
    return ok
  }
  const rowsOf = (table: string) => (table === 'users' ? [...h.users.values()] : table === 'subscriptions' ? [...h.subs.values()] : [])
  const builder = (table: string, inTrx: boolean) => {
    const where: Filter[] = []
    const q: Record<string, unknown> = {
      _where: where,
      where: (a: unknown, b?: unknown) => {
        if (typeof a === 'function') { const sub = builder(table, inTrx); (a as (s: unknown) => void)(sub); where.push({ group: sub._where as Filter[] }) }
        else where.push(b === undefined ? a as Row : { [a as string]: b })
        return q
      },
      orWhere: (a: string, b: unknown) => { where.push({ or: { [a]: b } }); return q },
      orWhereRaw: (sql: string, binds: unknown[]) => { where.push({ orRaw: sql, binds }); return q },
      select: () => q,
      first: async () => { const r = rowsOf(table).find(row => holds(row, where)); return r ? { ...r } : undefined },
      update: async (patch: Record<string, unknown>) => {
        if (h.failIn === table) throw new Error('db down')
        h.updates.push({ table, where: [...where], patch, inTrx })
        if (table === 'users') for (const row of rowsOf('users').filter(r => holds(r, where))) Object.assign(row, patch)
        return h.changed[table] ?? 1
      },
      insert: (row: Record<string, unknown>) => {
        h.inserts.push({ table, row })
        return { returning: async () => [{ id: 'new-user', ...row }] }
      },
    }
    return q
  }
  const db = Object.assign(vi.fn((table: string) => builder(table, false)), {
    raw: vi.fn(async () => ({ rows: [{ ...h.tables }] })),
    schema: { hasColumn: vi.fn(async () => true) },
    transaction: vi.fn(async (work: (trx: unknown) => Promise<unknown>) => {
      const saved = new Map([...h.users].map(([k, v]) => [k, { ...v }]))
      try {
        return await work((table: string) => builder(table, true))
      } catch (err) {
        h.users.clear()
        for (const [k, v] of saved) h.users.set(k, v)   // rolled back
        throw err
      }
    }),
  })
  return { db }
})

const lib = await import('../lib/account-close')
const { registerUserRoutes } = await import('../routes/users')
const { registerAuthRoutes } = await import('../routes/auth')

async function app() {
  const a = Fastify({ logger: false })
  await a.register((await import('@fastify/jwt')).default, { secret: 'x' })
  await a.register(registerUserRoutes, { prefix: '/api/v1/users' })
  await a.register(registerAuthRoutes, { prefix: '/api/v1/auth' })
  return a
}

let HASH = ''
beforeEach(async () => {
  HASH ||= await bcrypt.hash('right-password', 4)
  h.users.clear(); h.subs.clear(); h.redis.clear()
  h.updates = []; h.inserts = []; h.changed = {}; h.failIn = null
  h.tables = { api_keys: true, alert_subscriptions: true, alert_rules: true, digest_subscriptions: true, developer_webhooks: true, device_push_tokens: true }
  h.users.set(OWNER, { id: OWNER, email: 'Reader@Example.com', handle: 'reader', display_name: 'Reader', password_hash: HASH, github_id: 4242, suspended: false, suspension_reason: null, created_at: new Date('2026-10-01T00:00:00Z') })
  h.users.set(OTHER, { id: OTHER, email: 'other@example.com', handle: 'other', display_name: 'Other', password_hash: HASH, github_id: null, suspended: false, suspension_reason: null, created_at: new Date('2026-10-01T00:00:00Z') })
})
afterEach(() => { vi.unstubAllGlobals() })

const closed = (id: string) => Object.assign(h.users.get(id)!, { suspended: true, suspended_at: new Date(), suspension_reason: lib.CLOSED_REASON })

describe('which accounts are closed, and which plans must be cancelled first', () => {
  it('a closed account is one its owner closed, not one an admin suspended', () => {
    expect(lib.isClosed({ suspended: true, suspension_reason: lib.CLOSED_REASON })).toBe(true)
    expect(lib.isClosed({ suspended: true, suspension_reason: 'Replaced by @pulse' })).toBe(false)
    expect(lib.isClosed({ suspended: false, suspension_reason: lib.CLOSED_REASON })).toBe(false)
    expect(lib.isClosed(undefined)).toBe(false)
  })

  it('a Pro plan still charging must be cancelled first; a cancelled or ending one needn\'t', () => {
    expect(lib.proStillRunning({ plan: 'pro', status: 'active', cancel_at_period_end: false })).toBe(true)
    expect(lib.proStillRunning({ plan: 'pro', status: 'past_due', cancel_at_period_end: null })).toBe(true)
    expect(lib.proStillRunning({ plan: 'pro', status: 'active', cancel_at_period_end: true })).toBe(false)
    expect(lib.proStillRunning({ plan: 'pro', status: 'canceled', cancel_at_period_end: false })).toBe(false)
    expect(lib.proStillRunning({ plan: 'free', status: 'active' })).toBe(false)
    expect(lib.proStillRunning(undefined)).toBe(false)
  })
})

describe('closeAccount', () => {
  it('marks the account closed and stops what acts for it, in one transaction; nothing is deleted', async () => {
    h.changed = { api_keys: 2, alert_subscriptions: 3, alert_rules: 1, digest_subscriptions: 1, developer_webhooks: 1, device_push_tokens: 0 }
    const now = new Date('2026-11-11T17:00:00Z')
    const r = await lib.closeAccount(OWNER, 'Reader@Example.com', now)

    expect(h.users.get(OWNER)).toMatchObject({ suspended: true, suspended_at: now, suspension_reason: lib.CLOSED_REASON })
    expect(h.users.get(OTHER)).toMatchObject({ suspended: false })
    expect(h.updates.every(u => u.inTrx)).toBe(true)
    const by = (t: string) => h.updates.find(u => u.table === t)!
    expect(by('api_keys')).toMatchObject({ where: [{ user_id: OWNER, is_active: true }], patch: { is_active: false } })
    expect(by('alert_subscriptions')).toMatchObject({ where: [{ user_id: OWNER, active: true }], patch: { active: false } })
    expect(by('alert_rules')).toMatchObject({ where: [{ user_id: OWNER, enabled: true }], patch: { enabled: false } })
    expect(by('developer_webhooks')).toMatchObject({ where: [{ user_id: OWNER, is_active: true }], patch: { is_active: false } })
    expect(by('device_push_tokens')).toMatchObject({ where: [{ user_id: OWNER, active: true }], patch: { active: false } })
    // the digest to the account, or to its address (any case)
    expect(by('digest_subscriptions')).toMatchObject({
      where: [{ is_active: true }, { group: [{ user_id: OWNER }, { orRaw: 'lower(email) = ?', binds: ['reader@example.com'] }] }],
      patch: { is_active: false },
    })
    expect(r).toMatchObject({ apiKeys: 2, alerts: 3, alertRules: 1, digests: 1, webhooks: 1, pushTokens: 0 })
    expect(h.inserts).toEqual([])
  })

  it('leaves alone a table that is not there', async () => {
    h.tables.developer_webhooks = false
    h.tables.alert_rules = false
    const r = await lib.closeAccount(OWNER, null)
    expect(h.updates.map(u => u.table)).not.toContain('developer_webhooks')
    expect(h.updates.map(u => u.table)).not.toContain('alert_rules')
    expect(r.webhooks).toBe(0)
    // with no address, only the account's own digest
    expect(h.updates.find(u => u.table === 'digest_subscriptions')!.where).toEqual([{ is_active: true }, { group: [{ user_id: OWNER }] }])
  })

  it('turns off its alert channels, keeping what was set, and signs it out everywhere', async () => {
    h.redis.set(`notif:${OWNER}:settings`, JSON.stringify({ enabled: true, telegram_chat_id: '123', min_severity: 'high', categories: [] }))
    h.redis.set(`notif:${OTHER}:settings`, JSON.stringify({ enabled: true, min_severity: 'high', categories: [] }))
    h.redis.set('refresh:a', OWNER); h.redis.set('refresh:b', OWNER); h.redis.set('refresh:c', OTHER)
    const r = await lib.closeAccount(OWNER, 'Reader@Example.com')
    expect(JSON.parse(h.redis.get(`notif:${OWNER}:settings`)!)).toEqual({ enabled: false, telegram_chat_id: '123', min_severity: 'high', categories: [] })
    expect(JSON.parse(h.redis.get(`notif:${OTHER}:settings`)!).enabled).toBe(true)
    expect([...h.redis.keys()].filter(k => k.startsWith('refresh:'))).toEqual(['refresh:c'])
    expect(r).toMatchObject({ channels: true, sessions: 2 })
  })

  it('is all or nothing: if a step fails, the account stays open and signed in', async () => {
    h.failIn = 'digest_subscriptions'
    h.redis.set('refresh:a', OWNER)
    await expect(lib.closeAccount(OWNER, 'Reader@Example.com')).rejects.toThrow('db down')
    expect(h.users.get(OWNER)).toMatchObject({ suspended: false })
    expect(h.redis.get('refresh:a')).toBe(OWNER)
  })
})

describe('POST /api/v1/users/me/close', () => {
  const close = async (a: Awaited<ReturnType<typeof app>>, who?: string) =>
    a.inject({ method: 'POST', url: '/api/v1/users/me/close', headers: who ? { 'x-test-user': who } : {} })

  it('closes the signed-in account and says so', async () => {
    const a = await app()
    const res = await close(a, OWNER)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: { closed: true, message: lib.CLOSED_DONE_TEXT } })
    expect(lib.isClosed(h.users.get(OWNER))).toBe(true)
  })

  it('needs a sign-in', async () => {
    const a = await app()
    expect((await close(a)).statusCode).toBe(401)
    expect(h.updates).toEqual([])
  })

  it('asks to cancel a running Pro plan first, and changes nothing', async () => {
    h.subs.set(OWNER, { user_id: OWNER, plan: 'pro', status: 'active', cancel_at_period_end: false })
    const a = await app()
    const res = await close(a, OWNER)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe(lib.CLOSE_PRO_FIRST_TEXT)
    expect(h.updates).toEqual([])
    // once it is set to end, the account can close
    h.subs.set(OWNER, { user_id: OWNER, plan: 'pro', status: 'active', cancel_at_period_end: true })
    expect((await close(a, OWNER)).statusCode).toBe(200)
  })
})

describe('signing in to a closed account', () => {
  const login = async (a: Awaited<ReturnType<typeof app>>, email: string, password: string) =>
    a.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })

  it('with the right password: says it was closed and how to open it again', async () => {
    closed(OWNER)
    const a = await app()
    const res = await login(a, 'Reader@Example.com', 'right-password')
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe(lib.CLOSED_SIGN_IN_TEXT)
    expect([...h.redis.keys()].filter(k => k.startsWith('refresh:'))).toEqual([])
  })

  it('with a wrong password: the same answer as any wrong password, so nobody learns it was closed', async () => {
    closed(OWNER)
    const a = await app()
    const res = await login(a, 'Reader@Example.com', 'wrong-password')
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid credentials')
  })

  it("an admin's suspension still says suspended; an open account still signs in", async () => {
    Object.assign(h.users.get(OTHER)!, { suspended: true, suspension_reason: 'spam' })
    const a = await app()
    const suspended = await login(a, 'other@example.com', 'right-password')
    expect(suspended.statusCode).toBe(403)
    expect(suspended.json().error).toBe('Account suspended')
    const open = await login(a, 'Reader@Example.com', 'right-password')
    expect(open.statusCode).toBe(200)
    expect(open.json().data.accessToken).toBeTruthy()
  })

  it("the sign-up form says a closed account's email is taken by a closed account", async () => {
    closed(OWNER)
    const a = await app()
    const signUp = (email: string) => a.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { handle: 'newreader', displayName: 'New', email, password: 'a-good-password' } })
    const res = await signUp('Reader@Example.com')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe(lib.CLOSED_EMAIL_TAKEN_TEXT)
    const taken = await signUp('other@example.com')
    expect(taken.json().error).toBe('That email is already taken')
    expect(h.inserts).toEqual([])
  })

  it('/auth/me no longer shows a closed account signed in, even with a token from before', async () => {
    const a = await app()
    const token = a.jwt.sign({ id: OWNER })
    const me = () => a.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect((await me()).statusCode).toBe(200)
    closed(OWNER)
    expect((await me()).statusCode).toBe(404)
  })

  describe('with GitHub', () => {
    const github = (id: number, email: string) => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const body = url.includes('access_token') ? { access_token: 'gh-token' }
          : url.endsWith('/user/emails') ? [{ email, primary: true, verified: true }]
          : { id, login: 'reader', name: 'Reader', avatar_url: 'https://avatars.example/1' }
        return new Response(JSON.stringify(body), { status: 200 })
      }))
    }
    const callback = async (a: Awaited<ReturnType<typeof app>>) => {
      h.redis.set('oauth:state:s1', 'new')
      return a.inject({ method: 'GET', url: '/api/v1/auth/github/callback?code=c1&state=s1' })
    }

    beforeEach(() => { process.env.FRONTEND_URL = 'https://world-pulse.io' })
    afterEach(() => { delete process.env.FRONTEND_URL })

    it('a closed account found by its GitHub id is sent back to sign-in with account_closed, and gets no sign-in', async () => {
      closed(OWNER)
      github(4242, 'reader@example.com')
      const res = await callback(await app())
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('https://world-pulse.io/auth/login?error=account_closed')
      expect([...h.redis.keys()].filter(k => k.startsWith('refresh:'))).toEqual([])
    })

    it('a closed account found by its email is not linked to GitHub', async () => {
      closed(OTHER)
      github(777, 'other@example.com')
      const res = await callback(await app())
      expect(res.headers.location).toBe('https://world-pulse.io/auth/login?error=account_closed')
      expect(h.updates.filter(u => u.table === 'users' && 'github_id' in u.patch)).toEqual([])
    })

    it("an admin's suspension is sent back with account_suspended; an open account still signs in", async () => {
      Object.assign(h.users.get(OWNER)!, { suspended: true, suspension_reason: 'spam' })
      github(4242, 'reader@example.com')
      const a = await app()
      expect((await callback(a)).headers.location).toBe('https://world-pulse.io/auth/login?error=account_suspended')
      Object.assign(h.users.get(OWNER)!, { suspended: false, suspension_reason: null })
      const ok = await callback(a)
      expect(String(ok.headers.location)).toMatch(/^https:\/\/world-pulse\.io\/auth\/github\/callback\?accessToken=/)
    })
  })
})
