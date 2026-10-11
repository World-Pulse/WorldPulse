/**
 * The email briefing's subscription routes (plan G4): sign-up sends a
 * confirmation and nothing else, confirm and unsubscribe links must be
 * signed, and Settings only sees and changes the signed-in reader's own
 * subscription.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

process.env.JWT_SECRET = 'test-secret-for-email-links'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = { digest_subscriptions: [], users: [] }

// A small in-memory stand-in for the knex calls the routes make
vi.mock('../db/postgres', () => {
  type Cond = (r: Row) => boolean
  const builder = (table: string) => {
    const conds: Cond[] = []
    const api: Record<string, unknown> = {}
    const matchGroup = (fn: (q: Record<string, unknown>) => void): Cond => {
      const ors: Cond[][] = [[]]
      const q: Record<string, unknown> = {}
      q.where = (f: string, v: unknown) => { ors[ors.length - 1].push(r => r[f] === v); return q }
      q.orWhere = (f: string, v: unknown) => { ors.push([r => r[f] === v]); return q }
      fn(q)
      return r => ors.some(group => group.length > 0 && group.every(c => c(r)))
    }
    api.where = (f: unknown, v?: unknown) => {
      conds.push(typeof f === 'function' ? matchGroup(f as never) : (r => r[f as string] === v))
      return api
    }
    api.whereNotNull = (f: string) => { conds.push(r => r[f] !== null && r[f] !== undefined); return api }
    api.orderBy = () => api
    api.select = () => api
    const rows = () => tables[table].filter(r => conds.every(c => c(r)))
    api.first = async () => rows()[0]
    api.update = async (data: Row) => {
      const hit = rows()
      hit.forEach(r => Object.assign(r, data))
      return hit.length
    }
    api.insert = async (data: Row) => { tables[table].push({ id: `id-${tables[table].length + 1}`, ...data }); return [data] }
    api.then = (res: (v: Row[]) => unknown) => Promise.resolve(rows()).then(res)
    return api
  }
  const db = (table: string) => builder(table)
  db.fn = { now: () => new Date() }
  db.raw = async () => ({ rows: [] })
  return { db }
})

vi.mock('../lib/email', () => ({ EMAIL_CONFIGURED: true }))
const sendConfirmEmail = vi.fn(async () => true)
vi.mock('../lib/briefing-email', () => ({ sendConfirmEmail: (...a: unknown[]) => sendConfirmEmail(...(a as [])) }))
vi.mock('../lib/email-digest', () => ({ sendDigestEmail: vi.fn(), filterBySeverity: vi.fn((s: unknown) => s) }))
vi.mock('../middleware/auth', () => ({
  optionalAuth: async (req: { headers: Record<string, string>; user?: unknown }) => {
    if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }
  },
  authenticate: async (req: { headers: Record<string, string>; user?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!req.headers['x-test-user']) return reply.code(401).send({ success: false, error: 'Unauthorized' })
    req.user = { id: req.headers['x-test-user'] }
  },
}))

let app: Awaited<ReturnType<typeof makeApp>>
async function makeApp() {
  const subs = await import('../lib/subscribers')
  vi.spyOn(subs, 'subscribersReady').mockReturnValue(true)
  const { registerDigestRoutes } = await import('../routes/digest')
  const Fastify = (await import('fastify')).default
  const a = Fastify()
  await a.register(registerDigestRoutes, { prefix: '/api/v1/digest' })
  return a
}

beforeAll(async () => { app = await makeApp() })
beforeEach(() => {
  tables.digest_subscriptions = []
  tables.users = [{ id: 'user-1', email: 'Owner@Example.com' }]
  sendConfirmEmail.mockClear()
})

describe('sign-up and confirmation', () => {
  it('a new address is stored unconfirmed and gets a confirmation email', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/digest/subscribe', payload: { email: '  New@Example.com ', source: '/briefing' } })
    expect(res.statusCode).toBe(201)
    expect(tables.digest_subscriptions).toHaveLength(1)
    expect(tables.digest_subscriptions[0]).toMatchObject({ email: 'new@example.com', frequency: 'daily', confirmed_at: null, is_active: true, source: '/briefing' })
    expect(sendConfirmEmail).toHaveBeenCalledWith('new@example.com')
  })

  it('answers the same for an address already on the list, without emailing it', async () => {
    tables.digest_subscriptions = [{ id: 's1', email: 'old@example.com', is_active: true, confirmed_at: new Date() }]
    const res = await app.inject({ method: 'POST', url: '/api/v1/digest/subscribe', payload: { email: 'old@example.com' } })
    expect(res.statusCode).toBe(201)
    expect(sendConfirmEmail).not.toHaveBeenCalled()
  })

  it('rejects an invalid address', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/digest/subscribe', payload: { email: 'nope' } })
    expect(res.statusCode).toBe(400)
  })

  it('confirms with a signed link and refuses a forged one', async () => {
    tables.digest_subscriptions = [{ id: 's1', email: 'new@example.com', is_active: true, confirmed_at: null }]
    const { emailToken } = await import('../lib/subscribers')
    const forged = await app.inject({ method: 'GET', url: `/api/v1/digest/confirm?e=new%40example.com&t=${'x'.repeat(32)}` })
    expect(forged.headers.location).toContain('subscribed=invalid')
    expect(tables.digest_subscriptions[0].confirmed_at).toBeNull()
    const ok = await app.inject({ method: 'GET', url: `/api/v1/digest/confirm?e=new%40example.com&t=${emailToken('new@example.com', 'confirm')}` })
    expect(ok.statusCode).toBe(302)
    expect(ok.headers.location).toContain('subscribed=1')
    expect(tables.digest_subscriptions[0].confirmed_at).not.toBeNull()
  })

  it("an unsubscribe signature doesn't confirm", async () => {
    tables.digest_subscriptions = [{ id: 's1', email: 'new@example.com', is_active: true, confirmed_at: null }]
    const { emailToken } = await import('../lib/subscribers')
    const res = await app.inject({ method: 'GET', url: `/api/v1/digest/confirm?e=new%40example.com&t=${emailToken('new@example.com', 'unsubscribe')}` })
    expect(res.headers.location).toContain('subscribed=invalid')
  })
})

describe('unsubscribe links', () => {
  beforeEach(() => {
    tables.digest_subscriptions = [{ id: 's1', email: 'reader@example.com', is_active: true, confirmed_at: new Date() }]
  })

  it('one-click (POST) unsubscribes with a signed link', async () => {
    const { emailToken } = await import('../lib/subscribers')
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/digest/unsubscribe?e=reader%40example.com&t=${emailToken('reader@example.com', 'unsubscribe')}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    })
    expect(res.statusCode).toBe(200)
    expect(tables.digest_subscriptions[0].is_active).toBe(false)
  })

  it('refuses a forged link', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/digest/unsubscribe?e=reader%40example.com&t=${'y'.repeat(32)}` })
    expect(res.headers.location).toContain('unsubscribed=invalid')
    expect(tables.digest_subscriptions[0].is_active).toBe(true)
  })
})

describe('your own subscription (Settings)', () => {
  it('status needs sign-in and shows only your own', async () => {
    tables.digest_subscriptions = [
      { id: 's1', email: 'owner@example.com', is_active: true, confirmed_at: new Date(), frequency: 'daily' },
      { id: 's2', email: 'someone@example.com', is_active: true, confirmed_at: new Date(), frequency: 'weekly' },
    ]
    const anon = await app.inject({ method: 'GET', url: '/api/v1/digest/status?email=someone@example.com' })
    expect(anon.statusCode).toBe(401)
    const mine = await app.inject({ method: 'GET', url: '/api/v1/digest/status?email=someone@example.com', headers: { 'x-test-user': 'user-1' } })
    expect(JSON.parse(mine.body).data).toMatchObject({ subscribed: true, email: 'owner@example.com', frequency: 'daily' })
  })

  it('DELETE removes only your own subscription', async () => {
    tables.digest_subscriptions = [
      { id: 's1', email: 'owner@example.com', is_active: true, confirmed_at: new Date() },
      { id: 's2', email: 'someone@example.com', is_active: true, confirmed_at: new Date() },
    ]
    const anon = await app.inject({ method: 'DELETE', url: '/api/v1/digest/unsubscribe?email=someone@example.com' })
    expect(anon.statusCode).toBe(401)
    const mine = await app.inject({ method: 'DELETE', url: '/api/v1/digest/unsubscribe', headers: { 'x-test-user': 'user-1' } })
    expect(mine.statusCode).toBe(200)
    expect(tables.digest_subscriptions.map(r => r.is_active)).toEqual([false, true])
  })
})

describe('config', () => {
  it('says whether the sign-up box should show', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/digest/config' })
    expect(JSON.parse(res.body).data.enabled).toBe(true)
  })
})
