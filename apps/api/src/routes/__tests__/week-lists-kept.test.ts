/**
 * Two lists that read a week of reports crossed the pool's 5 seconds on Oct 26,
 * 2026 and answered 500 every time: the 7-day count behind the HUD's sparkline
 * (GET /api/v1/analytics/signal-volume) and the maritime feed (GET
 * /api/v1/maritime/signals). Both are now kept in Redis and remade off the
 * request path with their own time limit (lib/swr-cache.ts, lib/long-query.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => {
  const state = { keys: [] as string[], limits: [] as number[], rows: [] as unknown[], calls: [] as string[] }
  // A stand-in transaction: any chain of query-builder calls, which reads as the rows when awaited
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(state.rows)
      if (prop === 'toJSON') return () => '<query>'
      return (...args: unknown[]) => { state.calls.push(`${String(prop)}(${args.map(a => JSON.stringify(a)).join(',')})`); return chain }
    },
  })
  const trx = Object.assign((_table: string) => chain, { raw: (sql: string) => sql, queryBuilder: () => chain })
  return { state, trx }
})

vi.mock('../../db/redis', () => ({ redis: { get: async () => null, setex: async () => 'OK', set: async () => 'OK', del: async () => 1 } }))
vi.mock('../../db/postgres', () => ({ db: {} }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../lib/swr-cache', () => ({
  staleWhileRevalidate: async (key: string, _opts: unknown, make: () => Promise<unknown>) => { h.state.keys.push(key); return make() },
}))
vi.mock('../../lib/long-query', () => ({
  longQuery: async (seconds: number, run: (trx: unknown) => Promise<unknown>) => { h.state.limits.push(seconds); return run(h.trx) },
}))

import knexLib from 'knex'
import { SEA_SIGNALS_QUERY_SECONDS, SEA_SIGNALS_KEEP, SEA_OVERVIEW_KEEP, SEA_LIST_READ, nearKey, registerMaritimeRoutes, seaSignalsRead, seaRecentRead } from '../maritime'
import { dailyVolume } from '../analytics'

async function maritimeApp() {
  const app = Fastify({ logger: false })
  await app.register(registerMaritimeRoutes, { prefix: '/api/v1/maritime' })
  return app
}

const row = (o: Record<string, unknown> = {}) => ({
  id: 'a1', title: 'Tanker attacked off Yemen, UKMTO says', category: 'maritime', severity: 'high', reliability_score: '0.8',
  location_name: 'Red Sea', source_url: 'https://example.com/a', created_at: '2026-10-26T10:00:00.000Z', lng: 42.5, lat: 14.8, ...o,
})

describe('the 7-day count (GET /analytics/signal-volume)', () => {
  it('fills the days with no reports with 0, oldest first', () => {
    const now = new Date('2026-10-26T15:00:00Z')
    expect(dailyVolume([{ date: '2026-10-24', count: '9100' }, { date: new Date('2026-10-26T00:00:00Z'), count: 8674 }], 3, now)).toEqual([
      { date: '2026-10-24', count: 9100 },
      { date: '2026-10-25', count: 0 },
      { date: '2026-10-26', count: 8674 },
    ])
  })
})

describe('the maritime feed (GET /maritime/signals)', () => {
  beforeEach(() => { h.state.keys = []; h.state.limits = []; h.state.calls = []; h.state.rows = [] })

  // Nov 22, 2026: after a quiet 8 to 10 hours nothing was kept, and the first ask gave up waiting for the week's read
  it('keeps the last list and the last overview across a quiet night of 10 hours', () => {
    expect(SEA_SIGNALS_KEEP.freshSeconds + SEA_SIGNALS_KEEP.staleSeconds).toBeGreaterThanOrEqual(10 * 3600)
    expect(SEA_OVERVIEW_KEEP.freshSeconds + SEA_OVERVIEW_KEEP.staleSeconds).toBeGreaterThanOrEqual(10 * 3600)
  })

  // Nov 23, 2026: the overview's newest reports read the way the feed does
  it("reads the overview's newest sea reports as a set first, the sort and limit outside", () => {
    const k = knexLib({ client: 'pg' })
    const { sql, bindings } = seaRecentRead(k).toSQL()
    expect(sql).toMatch(/^with "sea" as materialized \(select .+ from "signals" where .+\) select \* from "sea" order by "created_at" desc limit \?$/)
    const inner = sql.slice(0, sql.indexOf(') select * from "sea"'))
    expect(inner).toContain("interval '48 hours'")
    expect(inner).not.toContain('order by')
    expect(bindings).toEqual(['verified', 'pending', SEA_LIST_READ])
  })

  it('keeps one copy per filter, and rounds a place to about a kilometre', () => {
    expect(nearKey('26.512345,56.345678')).toBe('26.51,56.35')
    expect(nearKey('not a place')).toBe('')
    expect(nearKey(undefined)).toBe('')
  })

  it('reads with its own time limit, keyed by type, place and radius', async () => {
    h.state.rows = [row(), row({ id: 'a2', title: 'Central bank holds rates' })]
    const app = await maritimeApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/maritime/signals?type=piracy&near=12.6,43.3&radius=300&limit=5' })
    expect(res.statusCode).toBe(200)
    expect(h.state.limits).toEqual([SEA_SIGNALS_QUERY_SECONDS])
    expect(h.state.keys).toEqual(['maritime:signals:v2:piracy:12.60,43.30:300'])
    expect(h.state.calls.some(c => c.startsWith('whereRaw("location IS NOT NULL'))).toBe(true)
    const body = res.json() as { data: Array<{ id: string; lat: number }>; total: number }
    // the headline check still drops a report that isn't about the sea
    expect(body.data.map(d => d.id)).toEqual(['a1'])
    expect(body.data[0]!.lat).toBe(14.8)
  })

  it('a feed without a place has no place filter and one shared copy', async () => {
    h.state.rows = [row()]
    const res = await (await maritimeApp()).inject({ method: 'GET', url: '/api/v1/maritime/signals?limit=8' })
    expect(res.statusCode).toBe(200)
    expect(h.state.keys).toEqual(['maritime:signals:v2:all::'])
    expect(h.state.calls.some(c => c.includes('ST_DWithin'))).toBe(false)
  })

  // Nov 22, 2026: asked for the newest 400 directly, the read ran past its 25 seconds and answered 500
  it('reads the week\'s sea reports as a set first, then takes the newest of them', async () => {
    h.state.rows = [row()]
    await (await maritimeApp()).inject({ method: 'GET', url: '/api/v1/maritime/signals?limit=8' })
    const at = (p: string) => h.state.calls.findIndex(c => c.startsWith(p))
    expect(at('withMaterialized("sea"')).toBeGreaterThan(-1)
    expect(h.state.calls.filter(c => c.startsWith('orderBy('))).toEqual(['orderBy("created_at","desc")'])
    expect(at('orderBy(')).toBeGreaterThan(at('withMaterialized('))   // the sort is the outer query's, not the set's
    expect(h.state.calls).toContain(`limit(${SEA_LIST_READ})`)
  })

  it('makes one WITH ... AS MATERIALIZED, its filters inside and the sort and limit outside', () => {
    const k = knexLib({ client: 'pg' })
    const { sql, bindings } = seaSignalsRead(k, { type: 'piracy', place: '12.60,43.30', radius: 300 }).toSQL()
    expect(sql).toMatch(/^with "sea" as materialized \(select .+ from "signals" where .+\) select \* from "sea" order by "created_at" desc limit \?$/)
    const inner = sql.slice(0, sql.indexOf(') select * from "sea"'))
    expect(inner).toContain("interval '7 days'")
    expect(inner).toContain("tags @> ARRAY['piracy']::text[]")
    expect(inner).toContain('ST_DWithin(')
    expect(inner).not.toContain('order by')
    expect(bindings).toEqual(['verified', 'pending', 43.3, 12.6, 300000, SEA_LIST_READ])
  })
})
