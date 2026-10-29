/**
 * The Knowledge Graph routes as registered (Oct 11, 2026): trending spikes
 * measured over the window, and an entity's recent signals found through its
 * text signal ids.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  raws: [] as Array<{ sql: string; params?: unknown[] }>,
  answers: [] as Array<{ rows: unknown[] }>,
  /** statement time limits set for one transaction (lib/long-query.ts) */
  limits: [] as string[],
  kept: new Map<string, string>(),
}))

vi.mock('../../db/postgres', () => {
  const raw = vi.fn(async (sql: string, params?: unknown[]) => {
    if (/^SET LOCAL statement_timeout/.test(sql)) { h.limits.push(sql); return { rows: [] } }
    h.raws.push({ sql, params })
    return h.answers.shift() ?? { rows: [] }
  })
  return { db: Object.assign(vi.fn(), { raw, transaction: vi.fn(async (fn: (trx: { raw: typeof raw }) => unknown) => fn({ raw })) }) }
})

vi.mock('../../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => h.kept.get(k) ?? null),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { h.kept.set(k, v); return 'OK' }),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
}))

import knowledgeGraphRoutes, { signalIdsOf, trendScores } from '../knowledge-graph'

const S1 = '6f1c2a3b-0000-4000-8000-000000000001'
const S2 = '6f1c2a3b-0000-4000-8000-000000000002'
const S3 = '6F1C2A3B-0000-4000-8000-000000000003'

async function app() {
  const server = Fastify()
  await server.register(knowledgeGraphRoutes, { prefix: '/api/v1/knowledge-graph' })
  return server
}

const node = (id: string, name: string, mentions: number, signalIds: string[], dailyAvg: number) => ({
  id, type: 'person', canonical_name: name, aliases: [], first_seen: '2026-04-01T00:00:00Z',
  last_seen: '2026-10-11T00:00:00Z', mention_count: mentions, signal_ids: signalIds, metadata: {},
  daily_avg: dailyAvg,
})

describe('signalIdsOf', () => {
  it('keeps well-formed signal ids, lowercase and once each', () => {
    expect(signalIdsOf([{ signal_ids: [S1, 'not-an-id', S3] }, { signal_ids: [S1] }, { signal_ids: null }]))
      .toEqual([S1, S3.toLowerCase()])
  })
})

describe('trendScores', () => {
  it("compares each entity's reports with the window before, scaled by the whole graph's growth", () => {
    const out = trendScores([
      { id: 'us', recent: 340, previous: 300 },     // a big, steady entity
      { id: 'djibouti', recent: 40, previous: 3 },  // a sudden story
      { id: 'quiet', recent: 0, previous: 9 },      // nothing now: left out
      { id: 'newcomer', recent: 6, previous: 0 },
    ])
    expect(out.map(t => t.id)).toEqual(['us', 'djibouti', 'newcomer'])
    // the graph grew 386/312 ≈ 1.24x, so the steady entity is about flat
    expect(out[0]!.change).toBe(0.9)
    expect(out[1]!.change).toBeGreaterThan(5)
    expect(out[2]).toMatchObject({ change: null, isNew: true })
  })

  it("doesn't call everything a spike after a quiet day in the pipeline", () => {
    // Every entity doubled because the day before had an outage
    const out = trendScores([{ id: 'a', recent: 20, previous: 10 }, { id: 'b', recent: 40, previous: 20 }])
    for (const t of out) expect(t.change!).toBeGreaterThanOrEqual(0.9), expect(t.change!).toBeLessThanOrEqual(1.1)   // about flat, not 2x
  })
})

describe('GET /api/v1/knowledge-graph/trending', () => {
  beforeEach(() => { h.raws.length = 0; h.answers.length = 0; h.limits.length = 0; h.kept.clear() })

  it('ranks by reports in the window against the window before, from the reports\' own times', async () => {
    h.answers.push(
      // Reports per entity: in the window and in the 24 hours before it
      { rows: [{ id: 'a1', recent: 30, previous: 30 }, { id: 'b2', recent: 12, previous: 0 }, { id: 'c3', recent: 0, previous: 4 }] },
      // The entities themselves
      { rows: [node('a1', 'Steady Org', 5000, [S1], 25), node('b2', 'Sudden Person', 40, [S2, S3], 0.2)] },
    )
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/knowledge-graph/trending?window_hours=24' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { trending: Array<{ entity: { canonical_name: string }; recent_mentions: number; previous_mentions: number; spike_ratio: number | null; is_new: boolean }> }
    expect(body.trending.map(t => t.entity.canonical_name)).toEqual(['Sudden Person', 'Steady Org'])
    expect(body.trending[0]).toMatchObject({ recent_mentions: 12, previous_mentions: 0, spike_ratio: null, is_new: true })
    expect(body.trending[1]).toMatchObject({ recent_mentions: 30, previous_mentions: 30, is_new: false })
    // counted from the reports' times, text ids matched in lowercase
    expect(h.raws[0].sql).toMatch(/JOIN signals s ON s.id::text = lower\(u.sid\)/)
    expect(h.raws[0].sql).not.toMatch(/first_seen/)
    expect(h.raws[1].params?.[0]).toEqual(['b2', 'a1'])
  })

  it('may take a minute, and is kept and served from Redis after that (Oct 15, 2026: it passed 5 s)', async () => {
    h.answers.push({ rows: [{ id: 'b2', recent: 12, previous: 0 }] }, { rows: [node('b2', 'Sudden Person', 40, [S2], 0.2)] })
    const server = await app()
    const first = await server.inject({ method: 'GET', url: '/api/v1/knowledge-graph/trending?limit=10&window_hours=24&lean=1' })
    expect(h.limits.map(s => s.split(';')[0])).toEqual(["SET LOCAL statement_timeout = '60s'"])
    expect([...h.kept.keys()]).toEqual(['kg:api:trending:v2:all:24:10:lean'])
    // the next request is answered from what was kept, without asking the database
    h.raws.length = 0
    const again = await server.inject({ method: 'GET', url: '/api/v1/knowledge-graph/trending?limit=10&window_hours=24&lean=1' })
    expect(h.raws).toEqual([])
    expect(again.json()).toEqual(first.json())
    expect(again.json().trending[0].entity.signal_ids).toEqual([])   // lean: names, not ids
  })
})

describe('GET /api/v1/knowledge-graph/sitemap', () => {
  beforeEach(() => { h.raws.length = 0; h.answers.length = 0; h.limits.length = 0; h.kept.clear() })

  it('lists entities named in 3+ reports, kept and remade with its own time limit', async () => {
    h.answers.push({ rows: [{ id: 'a1', name: ' Steady Org ', last_report: '2026-10-15T10:00:00Z', reports: 40 }, { id: 'x', name: '', last_report: '2026-10-15T10:00:00Z', reports: 9 }] })
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/knowledge-graph/sitemap' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.entities).toEqual([{ id: 'a1', name: 'Steady Org', lastReport: '2026-10-15T10:00:00.000Z', reports: 40 }])
    expect(h.limits.map(s => s.split(';')[0])).toEqual(["SET LOCAL statement_timeout = '60s'"])
    expect([...h.kept.keys()]).toEqual(['kg:api:sitemap:v2'])
  })
})

describe('GET /api/v1/knowledge-graph/entities/:id', () => {
  beforeEach(() => { h.raws.length = 0; h.answers.length = 0 })

  it("lists the entity's recent signals", async () => {
    h.answers.push(
      { rows: [node('a1', 'Steady Org', 5000, [S1, S2], 25)] },        // the entity
      { rows: [{ signal_ids: [S1, S2] }] },                            // its signal ids
      { rows: [{ id: S2, title: 'Newer' }, { id: S1, title: 'Older' }] },
    )
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/knowledge-graph/entities/a1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().recent_signals.map((s: { title: string }) => s.title)).toEqual(['Newer', 'Older'])
    expect(h.raws[2].sql).toMatch(/s\.id = ANY\(\?::uuid\[\]\)/)
    expect(h.raws[2].sql).not.toMatch(/source_id/)
  })
})
