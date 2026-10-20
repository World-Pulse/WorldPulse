/**
 * Search autocomplete (plan V3g, Oct 20, 2026): tags come from a kept list
 * of the last 7 days' tags, read off the request path, instead of a scan of
 * the whole signals table that took 5.4 s; Meilisearch gets a bounded wait.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  kept: new Map<string, string>(),
  rows: [] as Array<{ tag: string; n: number }>,
  raw: [] as string[],
  meiliDelayMs: 0,
}))

vi.mock('../../db/postgres', () => {
  const raw = vi.fn(async (sql: string) => {
    h.raw.push(sql)
    if (/^SET LOCAL/.test(sql)) return { rows: [] }
    return { rows: h.rows }
  })
  return { db: Object.assign(vi.fn(), { raw, transaction: vi.fn(async (fn: (trx: { raw: typeof raw }) => unknown) => fn({ raw })) }) }
})

vi.mock('../../db/redis', () => ({
  redis: {
    get:    vi.fn(async (k: string) => h.kept.get(k) ?? null),
    setex:  vi.fn(async (k: string, _t: number, v: string) => { h.kept.set(k, v); return 'OK' }),
    set:    vi.fn(async (k: string) => (h.kept.has(k) ? null : (h.kept.set(k, '1'), 'OK'))),
    del:    vi.fn(async (k: string) => { h.kept.delete(k); return 1 }),
    unlink: vi.fn().mockResolvedValue(1),
    scan:   vi.fn().mockResolvedValue(['0', []]),
  },
}))

vi.mock('../../lib/search', () => ({
  meili: {
    index: vi.fn(() => ({
      search: vi.fn(() => new Promise(r => setTimeout(() => r({ hits: [{ id: 's1', title: 'Earthquake off Chile', category: 'disaster' }] }), h.meiliDelayMs))),
    })),
  },
  setupSearchIndexes: vi.fn(),
  indexSignal:      vi.fn(),
  indexPost:        vi.fn(),
  removeSignal:     vi.fn(),
}))
vi.mock('../../lib/search-analytics', () => ({ logSearchQuery: vi.fn() }))
vi.mock('../../lib/opensanctions',    () => ({ searchEntities: vi.fn() }))
vi.mock('../../lib/search-latency',   () => ({ recordSearchLatency: vi.fn(), maybeLogPercentiles: vi.fn() }))
vi.mock('../../lib/fingerprint-search', () => ({ searchByMeaning: vi.fn().mockResolvedValue(null), similarReports: vi.fn().mockResolvedValue([]) }))
vi.mock('../../middleware/auth', () => ({
  optionalAuth: vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
  authenticate: vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
}))

import { registerSearchRoutes, matchTags } from '../search'

const flush = () => new Promise(r => setTimeout(r, 0))

async function build() {
  const app = Fastify({ logger: false })
  await app.register(registerSearchRoutes, { prefix: '/api/v1/search' })
  return app
}

describe('matchTags', () => {
  const tags = [{ tag: 'news', n: 900 }, { tag: 'earthquake', n: 40 }, { tag: 'chile', n: 30 }, { tag: 'earth-observation', n: 5 }, { tag: 'quake-earth', n: 2 }]
  it('gives tags that start with the query first, then ones that contain it, most used first', () => {
    expect(matchTags(tags, 'earth')).toEqual(['earthquake', 'earth-observation', 'quake-earth'])
    expect(matchTags(tags, 'EARTH', 1)).toEqual(['earthquake'])
  })
  it('gives nothing for an empty query or no match', () => {
    expect(matchTags(tags, '  ')).toEqual([])
    expect(matchTags(tags, 'zzz')).toEqual([])
  })
})

describe('GET /api/v1/search/autocomplete', () => {
  beforeEach(() => {
    h.kept.clear()
    h.raw.length = 0
    h.rows = [{ tag: 'earthquake', n: 40 }, { tag: 'chile', n: 30 }]
    h.meiliDelayMs = 0
  })

  it('answers at once with no tags while the list is first made, then from the kept list', async () => {
    const app = await build()
    const first = (await app.inject({ method: 'GET', url: '/api/v1/search/autocomplete?q=earth' })).json()
    expect(first.data.tags).toEqual([])
    await flush(); await flush(); await flush()
    // made off the request path, under its own time limit, never the old whole-table scan
    expect(h.raw.some(s => /unnest\(tags\) AS tag/.test(s) && /interval '7 days'/.test(s))).toBe(true)
    expect(h.raw.some(s => /SET LOCAL statement_timeout = '30s'/.test(s))).toBe(true)
    expect(h.raw.some(s => /ILIKE/.test(s))).toBe(false)
    const second = (await app.inject({ method: 'GET', url: '/api/v1/search/autocomplete?q=earth' })).json()
    expect(second.data.tags).toEqual(['earthquake'])
    expect(second.data.signals).toHaveLength(1)
  })

  it("doesn't wait more than a second for Meilisearch", async () => {
    h.meiliDelayMs = 3_000
    const app = await build()
    const started = Date.now()
    const res = (await app.inject({ method: 'GET', url: '/api/v1/search/autocomplete?q=earth' })).json()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(res.data.signals).toEqual([])
  })
})
