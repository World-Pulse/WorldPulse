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
}))

vi.mock('../../db/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string, params?: unknown[]) => {
      h.raws.push({ sql, params })
      return h.answers.shift() ?? { rows: [] }
    }),
  }),
}))

vi.mock('../../db/redis', () => ({
  redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') },
}))

import knowledgeGraphRoutes, { signalIdsOf, spikeRatio } from '../knowledge-graph'

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

describe('spikeRatio', () => {
  it('compares mentions in the window with the usual rate for a window that long', () => {
    expect(spikeRatio(30, 1, 168)).toBe(4.3)   // 30 this week, usually 7
    expect(spikeRatio(7, 1, 168)).toBe(1)      // a normal week
    expect(spikeRatio(2, 0.1, 24)).toBe(2)     // expectation never below 1
  })
})

describe('GET /api/v1/knowledge-graph/trending', () => {
  beforeEach(() => { h.raws.length = 0; h.answers.length = 0 })

  it('ranks by mentions inside the window, not by how long an entity has existed', async () => {
    h.answers.push(
      // Candidates: an old, steady entity and a new one with a burst
      { rows: [node('a1', 'Steady Org', 5000, [S1], 25), node('b2', 'Sudden Person', 40, [S2, S3], 0.2)] },
      // Which of their signals are inside the window
      { rows: [{ id: S2 }, { id: S3.toLowerCase() }] },
    )
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/knowledge-graph/trending?window_hours=24' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { trending: Array<{ entity: { canonical_name: string }; recent_mentions: number; spike_ratio: number }> }
    expect(body.trending.map(t => t.entity.canonical_name)).toEqual(['Sudden Person', 'Steady Org'])
    expect(body.trending[0]).toMatchObject({ recent_mentions: 2, spike_ratio: 2 })
    expect(body.trending[1]).toMatchObject({ recent_mentions: 0, spike_ratio: 0 })
    // signal ids are text in entity rows: compared as uuid[]
    expect(h.raws[1].sql).toMatch(/id = ANY\(\?::uuid\[\]\)/)
    expect(h.raws[1].params?.[0]).toEqual([S1, S2, S3.toLowerCase()])
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
