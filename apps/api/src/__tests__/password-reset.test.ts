/**
 * Forgot password (plan G13, Oct 21, 2026): a signed link by email that
 * works once, for 1 hour (lib/password-reset.ts), and the two routes,
 * POST /api/v1/auth/forgot-password and /reset-password.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import bcrypt from 'bcryptjs'

process.env.JWT_SECRET = 'test-secret-for-reset-links'

const USER = '3f2b8c1e-5d4a-4c3b-9a8e-7f6d5c4b3a21'
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const h = vi.hoisted(() => ({
  emailOn: true,
  sent: [] as Array<{ to: string; subject: string; text: string }>,
  users: new Map<string, Record<string, unknown>>(),
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  redis: new Map<string, string>(),
  counts: new Map<string, number>(),
  cleared: [] as string[],
}))

vi.mock('../lib/email', () => ({
  get EMAIL_CONFIGURED() { return h.emailOn },
  sendEmail: vi.fn(async (to: string, msg: { subject: string; text: string }) => { h.sent.push({ to, subject: msg.subject, text: msg.text }); return true }),
}))
vi.mock('../lib/search', () => ({ indexUser: vi.fn() }))
vi.mock('../lib/security', () => ({
  checkLoginAttempt: vi.fn(async () => ({ allowed: true })),
  recordFailedLogin: vi.fn(),
  clearLoginAttempts: vi.fn(async (email: string) => { h.cleared.push(email) }),
}))
vi.mock('../db/redis', () => ({
  redis: {
    incr: vi.fn(async (k: string) => { const n = (h.counts.get(k) ?? 0) + 1; h.counts.set(k, n); return n }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (k: string) => h.redis.get(k) ?? null),
    setex: vi.fn(async (k: string, _s: number, v: string) => { h.redis.set(k, v); return 'OK' }),
    del: vi.fn(async (...keys: string[]) => keys.filter(k => h.redis.delete(k)).length),
    mget: vi.fn(async (...keys: string[]) => keys.map(k => h.redis.get(k) ?? null)),
    scan: vi.fn(async (_cursor: string, _m: string, pattern: string) => {
      const prefix = pattern.replace(/\*$/, '')
      return ['0', [...h.redis.keys()].filter(k => k.startsWith(prefix))]
    }),
  },
}))
vi.mock('../db/postgres', () => {
  const byEmail = (email: string) => [...h.users.values()].find(u => String(u.email).toLowerCase() === email)
  const table = () => {
    let found: Record<string, unknown> | undefined
    let id: string | undefined
    const q = {
      whereRaw: (_sql: string, [email]: [string]) => { found = byEmail(email); return q },
      where: (_col: string, v: string) => { id = v; found = h.users.get(v); return q },
      first: async () => (found ? { ...found } : undefined),
      update: async (patch: Record<string, unknown>) => {
        h.updates.push({ id: id!, patch })
        const u = h.users.get(id!)
        if (u) Object.assign(u, patch)
        return 1
      },
    }
    return q
  }
  return { db: Object.assign(vi.fn(table), { schema: { hasColumn: vi.fn(async () => true) } }) }
})

const lib = await import('../lib/password-reset')
const { registerAuthRoutes } = await import('../routes/auth')

async function app() {
  const a = Fastify({ logger: false })
  await a.register((await import('@fastify/jwt')).default, { secret: 'x' })
  await a.register(registerAuthRoutes, { prefix: '/api/v1/auth' })
  return a
}

const HASH = '$2a$12$abcdefghijklmnopqrstuuOldHashOfTheCurrentPasswordXXXXXXXXXX'

beforeEach(() => {
  h.emailOn = true
  h.sent = []; h.updates = []; h.cleared = []
  h.redis.clear(); h.counts.clear(); h.users.clear()
  h.users.set(USER, { id: USER, email: 'Reader@Example.com', handle: 'reader', password_hash: HASH, suspended: false })
  h.users.set(OTHER, { id: OTHER, email: 'github@example.com', handle: 'gh', password_hash: null, suspended: false })
})

describe('the reset link', () => {
  it('opens its account for an hour', () => {
    const now = Date.parse('2026-10-21T20:00:00Z')
    const t = lib.parseResetToken(lib.resetToken(USER, HASH, now))!
    expect(t.userId).toBe(USER)
    expect(lib.checkResetToken(t, HASH, now + 59 * 60_000)).toBe('ok')
    expect(lib.checkResetToken(t, HASH, now + 61 * 60_000)).toBe('expired')
  })

  it('works once: a new password makes it invalid', () => {
    const t = lib.parseResetToken(lib.resetToken(USER, HASH))!
    expect(lib.checkResetToken(t, '$2a$12$theNewHash')).toBe('invalid')
  })

  it("can't be changed: another account, a later end, a guessed signature", () => {
    const token = lib.resetToken(USER, HASH)
    const [, exp, sig] = token.split('.')
    expect(lib.checkResetToken(lib.parseResetToken(`${OTHER}.${exp}.${sig}`)!, HASH)).toBe('invalid')
    expect(lib.checkResetToken(lib.parseResetToken(`${USER}.${Number(exp) + 86400}.${sig}`)!, HASH)).toBe('invalid')
    expect(lib.checkResetToken(lib.parseResetToken(`${USER}.${exp}.${'A'.repeat(43)}`)!, HASH)).toBe('invalid')
    expect(lib.parseResetToken('not-a-token')).toBeNull()
    expect(lib.parseResetToken(42)).toBeNull()
  })

  it('travels in the #fragment, and the count of links keeps no address', () => {
    expect(lib.resetLink('abc')).toBe('https://world-pulse.io/auth/reset-password#token=abc')
    expect(lib.resetCountKey(' Reader@Example.com ')).toBe(lib.resetCountKey('reader@example.com'))
    expect(lib.resetCountKey('reader@example.com')).not.toMatch(/reader|example/)
  })

  it('the email says how long it works and what to do if it was not you', () => {
    const m = lib.resetEmail('https://world-pulse.io/auth/reset-password#token=abc', 'reader')
    expect(m.subject).toBe('Choose a new WorldPulse password')
    expect(m.text).toContain('https://world-pulse.io/auth/reset-password#token=abc')
    expect(m.text).toContain('works once, for 1 hour')
    expect(m.text).toContain("If it wasn't you, ignore this email")
    expect(m.html).toContain('@reader')
  })
})

describe('POST /api/v1/auth/forgot-password', () => {
  const ask = async (a: Awaited<ReturnType<typeof app>>, email: string) =>
    a.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email } })

  it('the same answer for an account and for no account; the email only to the account', async () => {
    const a = await app()
    const known = await ask(a, 'reader@example.com')
    const unknown = await ask(a, 'nobody@example.com')
    expect(known.statusCode).toBe(200)
    expect(unknown.statusCode).toBe(200)
    expect(known.json()).toEqual(unknown.json())
    await new Promise(r => setTimeout(r, 0))
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]!.to).toBe('Reader@Example.com')
    expect(h.sent[0]!.text).toMatch(/reset-password#token=[0-9a-f-]{36}\.\d+\./)
  })

  it('nothing for an account that signs in with GitHub, and 3 links an hour per address', async () => {
    const a = await app()
    await ask(a, 'github@example.com')
    for (let i = 0; i < 5; i++) await ask(a, 'READER@example.com')
    await new Promise(r => setTimeout(r, 0))
    expect(h.sent.map(s => s.to)).toEqual(['Reader@Example.com', 'Reader@Example.com', 'Reader@Example.com'])
  })

  it('says so, and where to write, while the server has no email key', async () => {
    h.emailOn = false
    const res = await ask(await app(), 'reader@example.com')
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toContain('support@world-pulse.io')
    expect(h.sent).toHaveLength(0)
  })

  it('refuses what is not an address', async () => {
    expect((await ask(await app(), 'not an email')).statusCode).toBe(400)
  })
})

describe('POST /api/v1/auth/reset-password', () => {
  const reset = async (a: Awaited<ReturnType<typeof app>>, token: string, password = 'a new password') =>
    a.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password } })

  it('sets the new password, signs the account out everywhere, and the link then stops working', async () => {
    h.redis.set('refresh:r1', USER)
    h.redis.set('refresh:r2', OTHER)
    h.redis.set('refresh:r3', USER)
    const a = await app()
    const token = lib.resetToken(USER, HASH)
    const res = await reset(a, token)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toBe(lib.RESET_DONE_TEXT)
    const saved = String(h.users.get(USER)!.password_hash)
    expect(await bcrypt.compare('a new password', saved)).toBe(true)
    expect([...h.redis.keys()]).toEqual(['refresh:r2'])
    expect(h.cleared).toEqual(['Reader@Example.com'])
    const again = await reset(a, token, 'another password')
    expect(again.statusCode).toBe(400)
    expect(again.json().error).toBe(lib.RESET_INVALID_TEXT)
  })

  it('an expired link says so; a short password and a broken link are refused', async () => {
    const a = await app()
    const old = lib.resetToken(USER, HASH, Date.now() - 2 * 3600_000)
    expect((await reset(a, old)).json().error).toBe(lib.RESET_EXPIRED_TEXT)
    expect((await reset(a, lib.resetToken(USER, HASH), 'short')).json().error).toBe('password: 8 to 128 characters')
    expect((await reset(a, 'garbage')).json().error).toBe(lib.RESET_INVALID_TEXT)
    expect(h.updates).toHaveLength(0)
  })
})
