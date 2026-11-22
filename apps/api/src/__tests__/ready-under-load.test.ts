/**
 * Pages and AI tools that failed on the busy server (Nov 22, 2026, a sweep of 46 pages and a test of all 100 tools):
 * a country's page (the United States' showed "Something went wrong"), the Claims page's numbers and the home page's
 * escalation score went past the pool's 5 seconds and answered 500. They are now kept in Redis and remade in the
 * background with more time (lib/swr-cache.ts, lib/long-query.ts), answering 503 with a message, not 500, when
 * nothing is kept and the database is too slow. The slowest tools' default answers are kept from going cold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ fail: false, seconds: [] as number[], keys: [] as string[], opts: [] as unknown[], ages: {} as Record<string, number | null>, remade: [] as string[] }))

/** A query builder that answers like knex: every call chains, awaiting it gives the rows for its table */
function builder(rows: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['where', 'whereIn', 'whereNot', 'whereNotIn', 'whereNotNull', 'orWhereRaw', 'whereRaw', 'select', 'count', 'groupBy', 'groupByRaw', 'orderBy', 'orderByRaw', 'limit', 'first']) {
    b[m] = (...a: unknown[]) => { if (typeof a[0] === 'function') (a[0] as (x: unknown) => void)(b); return b }
  }
  b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => (h.fail ? Promise.reject(new Error('canceling statement due to statement timeout')) : Promise.resolve(rows)).then(ok, bad)
  return b
}
const COUNTRY_ROWS = [{ category: 'conflict', count: '40', max_sev: 3, avg_rel: 0.8 }]
const trx = Object.assign((table: string) => builder(table === 'signals' ? COUNTRY_ROWS : []), { raw: (s: string) => s })

vi.mock('../db/postgres', () => ({ db: Object.assign((t: string) => builder(t === 'sources' ? [{ trust_bucket: 'high_trust', count: '30' }] : [{ count: '7' }]), { raw: (s: string) => s }) }))
vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } }))
vi.mock('../lib/long-query', () => ({ longQuery: vi.fn(async (seconds: number, run: (t: unknown) => Promise<unknown>) => { h.seconds.push(seconds); return run(trx) }) }))
vi.mock('../lib/swr-cache', () => ({
  staleWhileRevalidate: vi.fn(async (key: string, opts: unknown, make: () => Promise<unknown>) => { h.keys.push(key); h.opts.push(opts); return make() }),
  keptAge: vi.fn(async (key: string) => h.ages[key] ?? null),
  remakeNow: vi.fn(async (key: string, _opts: unknown, make: () => Promise<unknown>) => { await make(); h.remade.push(key); return true }),
}))
vi.mock('../middleware/auth', () => ({ optionalAuth: (_r: unknown, _p: unknown, done: () => void) => done(), authenticate: (_r: unknown, _p: unknown, done: () => void) => done() }))
vi.mock('../lib/engine-loader', () => ({ loadEngine: async () => null }))

beforeEach(() => { h.fail = false; h.seconds = []; h.keys = []; h.opts = []; h.ages = {}; h.remade = [] })

describe("a country's page", () => {
  async function get(url: string) {
    const { registerCountryRoutes } = await import('../routes/countries')
    const app = Fastify({ logger: false })
    await app.register(registerCountryRoutes, { prefix: '/api/v1/countries' })
    return app.inject({ method: 'GET', url })
  }

  it('is kept 2 minutes and served up to 6 hours while remade, with 30 seconds for its queries', async () => {
    const res = await get('/api/v1/countries/us?window=7d&limit=10')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ code: 'US', total_signals: 40, category_breakdown: [{ category: 'conflict', count: 40, max_severity: 'high' }] })
    expect(h.keys).toEqual(['countries:detail:v2:US:7d:10'])
    expect(h.opts[0]).toEqual({ freshSeconds: 120, staleSeconds: 6 * 3_600, lockSeconds: 60 })
    expect(h.seconds).toEqual([30])
  })

  it('a database too slow answers 503 with a message, not 500', async () => {
    h.fail = true
    const res = await get('/api/v1/countries/US?window=7d&limit=10')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' })
  })
})

describe("the Claims page's numbers and the home page's escalation score", () => {
  it('claims/stats: kept and remade, both counts in one transaction with 30 seconds', async () => {
    const { registerClaimsRoutes } = await import('../routes/claims')
    const app = Fastify({ logger: false })
    await app.register(registerClaimsRoutes, { prefix: '/api/v1/claims' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/claims/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ signalsLast24h: 40, totalSignals: 40 })
    expect(h.keys[0]).toMatch(/stats:v2$/)
    expect(h.seconds).toEqual([30])
    h.fail = true
    expect((await app.inject({ method: 'GET', url: '/api/v1/claims/stats' })).statusCode).toBe(503)
  })

  it('analytics/escalation-index: kept and remade, its four counts with 30 seconds', async () => {
    const { registerAnalyticsRoutes } = await import('../routes/analytics')
    const app = Fastify({ logger: false })
    await app.register(registerAnalyticsRoutes, { prefix: '/api/v1/analytics' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/escalation-index' })
    expect(res.statusCode).toBe(200)
    expect(h.keys).toEqual(['analytics:escalation:v2:24h'])
    expect(h.seconds).toEqual([30])
    h.fail = true
    expect((await app.inject({ method: 'GET', url: '/api/v1/analytics/escalation-index?window=7d' })).statusCode).toBe(503)
  })
})

describe('the slowest AI tools', () => {
  it('get more time and are kept a day', async () => {
    const m = await import('../routes/public-insights')
    expect(m.SLOW_SCAN_SECONDS).toBe(120)
    expect(m.TOOL_QUERY_SECONDS).toBe(45)
    expect(m.WARM_TOOL_ANSWERS.map(j => j.key)).toEqual(['public:chokepoints:v1:7', 'public:news-watch:v1:cyber:7', 'public:feed-reports:v1:us-weather:7'])
    for (const j of m.WARM_TOOL_ANSWERS) expect(j.opts.staleSeconds).toBe(86_400)
  })

  it('their default answers are remade when missing or older than 12 hours, and left alone when warm', async () => {
    const m = await import('../routes/public-insights')
    const made: string[] = []
    const jobs = [
      { key: 'a', opts: { freshSeconds: 600, staleSeconds: 86_400 }, make: async () => { made.push('a') } },
      { key: 'b', opts: { freshSeconds: 600, staleSeconds: 86_400 }, make: async () => { made.push('b') } },
      { key: 'c', opts: { freshSeconds: 600, staleSeconds: 86_400 }, make: async () => { made.push('c') } },
    ]
    h.ages = { a: null, b: 3_600, c: 13 * 3_600 }
    expect(await m.warmToolAnswers(jobs)).toEqual(['a', 'c'])
    expect(made).toEqual(['a', 'c'])
  })
})
