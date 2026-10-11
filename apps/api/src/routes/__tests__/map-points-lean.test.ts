/**
 * GET /api/v1/signals/map/points with lean=1 (plan M15, Oct 11, 2026): the
 * World Map's points. With 500 newest-first points, "24 hours" showed about
 * 3 hours; lean points are lighter, up to 3,000, important ones first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  rows: [] as unknown[],
}))

vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../db/postgres', () => {
  function builder() {
    const b: Record<string, unknown> = {}
    for (const m of ['whereNotNull', 'whereIn', 'where', 'whereRaw', 'select', 'orderBy', 'orderByRaw', 'limit']) {
      b[m] = (...args: unknown[]) => { h.calls.push({ method: m, args }); return b }
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(h.rows).then(res, rej)
    return b
  }
  const db = Object.assign(vi.fn(() => builder()), {
    raw: vi.fn((sql: string) => ({ toString: () => sql, sql })),
  })
  return { db }
})

import { registerSignalRoutes } from '../signals'

async function app() {
  const server = Fastify({ logger: false })
  await server.register(registerSignalRoutes, { prefix: '/api/v1/signals' })
  return server
}

const selected = () => {
  const select = h.calls.find(c => c.method === 'select')
  return (select?.args[0] as unknown[]).map(c => (typeof c === 'string' ? c : String((c as { sql: string }).sql)))
}

describe('GET /api/v1/signals/map/points', () => {
  beforeEach(() => { h.calls.length = 0; h.rows = [{ id: 'a', lat: 1, lng: 2 }] })

  it('lean: up to 3,000 light points, critical/high/verified first', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/points?hours=24&limit=3000&lean=1' })
    expect(res.statusCode).toBe(200)
    const cols = selected()
    expect(cols).not.toContain('summary')
    expect(cols).toContain('original_urls[1:1] AS original_urls')
    const ordering = h.calls.filter(c => c.method === 'orderByRaw' || c.method === 'orderBy')
    expect(String(ordering[0].args[0])).toMatch(/severity IN \('critical', 'high'\) OR status = 'verified'/)
    expect(ordering[1].args).toEqual(['created_at', 'desc'])
    expect(h.calls.find(c => c.method === 'limit')?.args[0]).toBe(3000)
  })

  it('without lean: as before (summary, all links, 500 newest)', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/points?hours=24' })
    expect(res.statusCode).toBe(200)
    expect(selected()).toContain('summary')
    expect(h.calls.some(c => c.method === 'orderByRaw')).toBe(false)
    expect(h.calls.find(c => c.method === 'limit')?.args[0]).toBe(500)
  })

  it("leaves out GDELT events titled only with the event label and place (\"Consultation in Moscow\")", async () => {
    await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/points?hours=24&limit=3000&lean=1' })
    const raw = h.calls.find(c => c.method === 'whereRaw' && /gdelt/.test(String(c.args[0])))
    expect(String(raw?.args[0])).toBe("NOT (tags @> ARRAY['gdelt']::text[] AND title ~ ?)")
    const re = new RegExp(String((raw?.args[1] as string[])[0]))
    expect(re.test('Consultation in Moscow, Moskva, Russia')).toBe(true)
    expect(re.test('Armed conflict in Khartoum, Sudan')).toBe(true)
    expect(re.test('Riyadh airport attacked again, evacuated as explosions rock Saudi capital')).toBe(false)
  })

  it('refuses more than 3,000', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/points?limit=5000&lean=1' })
    expect(res.statusCode).toBe(400)
  })
})
