/**
 * The push alert routes (routes/push.ts, Oct 31, 2026): a browser turns
 * alerts on with no account, changes what it gets and turns them off, by its
 * push address, which must be a real push service's.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createECDH } from 'node:crypto'

process.env.JWT_SECRET = 'test-secret-for-push'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = { web_push_subscriptions: [] }

vi.mock('../db/postgres', () => {
  const builder = (table: string) => {
    const conds: Array<(r: Row) => boolean> = []
    const api: Record<string, unknown> = {}
    api.where = (f: string, v: unknown) => { conds.push(r => r[f] === v); return api }
    api.select = () => api
    const rows = () => tables[table]!.filter(r => conds.every(c => c(r)))
    api.first = async () => rows()[0]
    api.update = async (data: Row) => { const hit = rows(); hit.forEach(r => Object.assign(r, data)); return hit.length }
    api.insert = async (data: Row) => { tables[table]!.push({ id: `id-${tables[table]!.length + 1}`, ...data }); return [data] }
    api.delete = async () => { const keep = tables[table]!.filter(r => !conds.every(c => c(r))); const n = tables[table]!.length - keep.length; tables[table] = keep; return n }
    return api
  }
  const db = (t: string) => builder(t)
  db.fn = { now: () => new Date() }
  db.raw = async () => ({ rows: [] })
  return { db }
})
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../db/redis', () => ({ redis: {} }))

const welcomes: Array<Record<string, unknown>> = []
vi.mock('../lib/web-push', async (orig) => {
  const real = await orig<typeof import('../lib/web-push')>()
  return { ...real, sendPush: vi.fn(async (_t: unknown, m: Record<string, unknown>) => { welcomes.push(m); return { result: 'sent', status: 201 } }) }
})

const ua = createECDH('prime256v1')
ua.generateKeys()
const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') }
const endpoint = 'https://fcm.googleapis.com/fcm/send/abc:APA91bXYZ'

let app: Awaited<ReturnType<typeof makeApp>>
async function makeApp() {
  const { registerPushRoutes } = await import('../routes/push')
  const Fastify = (await import('fastify')).default
  const a = Fastify()
  await a.register(registerPushRoutes, { prefix: '/api/v1/push' })
  return a
}
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1/push/${url}`, payload: payload as Record<string, unknown> })

beforeAll(async () => { app = await makeApp() })

describe('before the table is known to exist', () => {
  it('asks the browser to try again in a minute rather than failing', async () => {
    const res = await post('status', { endpoint })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toContain('try again in a minute')
    const { ensurePushTable } = await import('../lib/push-scan')
    expect(await ensurePushTable()).toBe(true)
  })
})
beforeEach(() => { tables.web_push_subscriptions = []; welcomes.length = 0 })

describe('push routes', () => {
  it("gives the server's public key", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/push/key' })
    expect(res.statusCode).toBe(200)
    const key = res.json().data.publicKey as string
    expect(Buffer.from(key, 'base64url')).toHaveLength(65)
    expect(res.headers['cache-control']).toContain('max-age=3600')
  })

  it('turns alerts on with no account, says hello once, and changes what a browser gets', async () => {
    let res = await post('subscribe', { subscription: { endpoint, keys }, breaking: true, countries: ['ir'] })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toEqual({ subscribed: true, breaking: true, countries: ['IR'] })
    expect(tables.web_push_subscriptions).toHaveLength(1)
    await new Promise(r => setTimeout(r, 0))
    expect(welcomes).toHaveLength(1)
    expect(String(welcomes[0]!.body)).toContain('major stories in Iran')

    res = await post('subscribe', { subscription: { endpoint, keys }, breaking: false, countries: ['IR', 'QA', 'IR'] })
    expect(res.statusCode).toBe(200)
    expect(tables.web_push_subscriptions).toHaveLength(1)
    expect(tables.web_push_subscriptions[0]).toMatchObject({ breaking: false, countries: ['IR', 'QA'] })
    expect(welcomes).toHaveLength(1)

    res = await post('status', { endpoint })
    expect(res.json().data).toEqual({ subscribed: true, breaking: false, countries: ['IR', 'QA'] })
  })

  it('turns alerts off: by unsubscribing, or by asking for nothing', async () => {
    await post('subscribe', { subscription: { endpoint, keys } })
    expect((await post('unsubscribe', { endpoint })).statusCode).toBe(200)
    expect(tables.web_push_subscriptions).toHaveLength(0)
    expect((await post('status', { endpoint })).json().data.subscribed).toBe(false)

    await post('subscribe', { subscription: { endpoint, keys } })
    const res = await post('subscribe', { subscription: { endpoint, keys }, breaking: false, countries: [] })
    expect(res.json().data.subscribed).toBe(false)
    expect(tables.web_push_subscriptions).toHaveLength(0)
  })

  it('refuses an address that is not a push service, and keys that are not a browser’s', async () => {
    for (const bad of ['https://example.com/hook', 'http://fcm.googleapis.com/fcm/send/x', 'https://127.0.0.1/x']) {
      const res = await post('subscribe', { subscription: { endpoint: bad, keys } })
      expect(res.statusCode, bad).toBe(400)
    }
    const res = await post('subscribe', { subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: 'short' } } })
    expect(res.statusCode).toBe(400)
    expect((await post('subscribe', { subscription: { endpoint, keys }, countries: ['IRN'] })).statusCode).toBe(400)
    expect(tables.web_push_subscriptions).toHaveLength(0)
    expect(welcomes).toHaveLength(0)
  })
})
