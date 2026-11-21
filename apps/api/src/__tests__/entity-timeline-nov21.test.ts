/**
 * GET /api/v1/entities/:id/timeline (Nov 21, 2026): a big entity's page (Tokyo's, of 772 reports) answered 500. Each
 * of its 100 reports had its own query for the other entities naming it, reading every entity's report list as text,
 * and they ran past the 5-second limit. Now the page's reports are read with one array parameter, its co-entities in
 * one query under its own limit, and the page still answers when that query gives up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const ENTITY = {
  id: 'tokyo1', canonical_name: 'Tokyo', type: 'location', mention_count: 772,
  first_seen: '2026-04-01T00:00:00Z', last_seen: '2026-11-21T19:00:00Z', metadata: { trend: 'rising' },
  signal_ids: [] as unknown[],
}
const first = vi.fn(async () => ENTITY as Record<string, unknown> | undefined)
const raw = vi.fn()
vi.mock('../db/postgres', () => ({ db: Object.assign(vi.fn(() => ({ where: vi.fn(() => ({ first })) })), { raw: (...a: unknown[]) => raw(...a) }) }))
vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
const coRaw = vi.fn()
vi.mock('../lib/long-query', () => ({ longQuery: vi.fn(async (_s: number, run: (trx: unknown) => unknown) => run({ raw: coRaw })) }))
vi.mock('../lib/entity-profile', () => ({
  mentionIds: (ids: unknown) => Array.isArray(ids)
    ? [...new Set(ids.filter((v): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)).map(v => v.toLowerCase()))]
    : [],
}))

import { registerEntityRoutes, CO_ENTITY_SECONDS, CO_ENTITIES_SHOWN, TIMELINE_MAX } from '../routes/entities'
import { longQuery } from '../lib/long-query'
import { redis } from '../db/redis'

const uuid = (n: number) => `6f1c2a3b-0000-4000-8000-${String(n).padStart(12, '0')}`
const report = (n: number, at: string) => ({
  id: uuid(n), title: `Report ${n}`, category: 'geopolitics', severity: 'low', location_name: 'Tokyo',
  reliability_score: 0.7, source_count: 1, published_at: at, created_at: at,
})

async function app() {
  const a = Fastify()
  await a.register(registerEntityRoutes, { prefix: '/api/v1/entities' })
  return a
}

beforeEach(() => {
  raw.mockReset(); coRaw.mockReset(); first.mockClear(); vi.mocked(redis.setex).mockClear()
  ENTITY.signal_ids = [...Array.from({ length: 800 }, (_, i) => uuid(i)), '1', 'pending', uuid(3).toUpperCase()]
})

describe("a big entity's timeline", () => {
  it('reads the page with one array of well-formed ids, and the co-entities in one query, at most 5 a report', async () => {
    raw.mockResolvedValueOnce({ rows: [report(2, '2026-11-21T18:00:00Z'), report(1, '2026-11-21T17:00:00Z')] })
    coRaw.mockResolvedValueOnce({
      rows: [
        ...Array.from({ length: 7 }, (_, i) => ({ sid: uuid(2), id: `e${i}`, name: `Entity ${i}`, type: 'person' })),
        { sid: uuid(1), id: 'japan', name: 'Japan', type: 'location' },
        { sid: uuid(1), id: 'japan', name: 'Japan', type: 'location' },
      ],
    })
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/entities/tokyo1/timeline?limit=2' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(800)
    expect(body.timeline.map((t: { signal_id: string }) => t.signal_id)).toEqual([uuid(2), uuid(1)])
    expect(body.timeline[0].co_entities).toHaveLength(CO_ENTITIES_SHOWN)
    expect(body.timeline[1].co_entities).toEqual([{ id: 'japan', name: 'Japan', type: 'location' }])
    expect(body.co_entities_unavailable).toBeUndefined()
    // one query for the page, its ids in one parameter: no bind parameter a report id
    expect(raw).toHaveBeenCalledTimes(1)
    const [sql, params] = raw.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/WHERE id = ANY\(\?::uuid\[\]\)/)
    expect(sql).toMatch(/ORDER BY COALESCE\(published_at, created_at\) DESC, id DESC\s+LIMIT \? OFFSET \?/)
    expect((params[0] as string[]).length).toBe(800)
    expect(params.slice(1)).toEqual([2, 0])
    // the co-entities: one query, under its own limit, the entity itself left out
    expect(coRaw).toHaveBeenCalledTimes(1)
    expect(vi.mocked(longQuery).mock.calls.at(-1)?.[0]).toBe(CO_ENTITY_SECONDS)
    const [coSql, coParams] = coRaw.mock.calls[0] as [string, unknown[]]
    expect(coSql).toMatch(/n\.signal_ids && \?::text\[\]/)
    expect(coSql).not.toMatch(/LIKE/)
    expect(coParams[0]).toBe('tokyo1')
    expect(coParams[1]).toEqual([uuid(2), uuid(1)])
  })

  it('still answers, without co-entities, when their query gives up, and keeps that page a shorter while', async () => {
    raw.mockResolvedValueOnce({ rows: [report(5, '2026-11-21T18:00:00Z')] })
    coRaw.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/entities/tokyo1/timeline' })
    expect(res.statusCode).toBe(200)
    expect(res.json().timeline[0].co_entities).toEqual([])
    expect(res.json().co_entities_unavailable).toBe(true)
    expect(vi.mocked(redis.setex).mock.calls.at(-1)?.[1]).toBe(30)
  })

  it('keeps the page within bounds: at most 100 reports, no negative offset', async () => {
    raw.mockResolvedValue({ rows: [] })
    await (await app()).inject({ method: 'GET', url: '/api/v1/entities/tokyo1/timeline?limit=5000&offset=-20' })
    expect((raw.mock.calls[0] as [string, unknown[]])[1].slice(1)).toEqual([TIMELINE_MAX, 0])
    expect(coRaw).not.toHaveBeenCalled()
  })

  it('answers an entity without well-formed report ids with an empty timeline, and an unknown one 404', async () => {
    ENTITY.signal_ids = ['1', 'pending']
    const empty = await (await app()).inject({ method: 'GET', url: '/api/v1/entities/tokyo1/timeline' })
    expect(empty.statusCode).toBe(200)
    expect(empty.json()).toMatchObject({ timeline: [], total: 0 })
    expect(raw).not.toHaveBeenCalled()
    first.mockResolvedValueOnce(undefined)
    expect((await (await app()).inject({ method: 'GET', url: '/api/v1/entities/nope/timeline' })).statusCode).toBe(404)
  })
})
