/**
 * GET /api/v1/signals/map/timeline (Nov 21, 2026): "the last 24 hours" were the last 13. The route read the newest
 * 10,000 reports and bucketed them itself, and from Nov 20 a day held some 24,000 located reports; the morning video
 * (map ?play=24h) played half the day, and on Nov 20 and 21 at 5:30 AM it wasn't made at all. A day or less is now
 * bucketed in the database: every report counted in its bucket, the newest 50 of each kept, under 15 seconds; when
 * that gives up, the last answer that worked (marked stale), else 503.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const store = new Map<string, string>()
vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK' }),
  },
}))
vi.mock('../lib/stories', () => ({ signalsHaveStoryIds: vi.fn(async () => true) }))

// the week's and the month's query (the older way): a chain that answers `oldRows`
let oldRows: Record<string, unknown>[] = []
const chainCalls: string[] = []
function chain(): unknown {
  const c: Record<string, unknown> = {}
  for (const m of ['whereNotNull', 'whereIn', 'where', 'select', 'orderBy', 'whereRaw', 'limit']) {
    c[m] = (...a: unknown[]) => { chainCalls.push(m + (m === 'limit' ? `(${String(a[0])})` : '')); return c }
  }
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(oldRows).then(ok, bad)
  return c
}
vi.mock('../db/postgres', () => ({ db: Object.assign(vi.fn(() => chain()), { raw: vi.fn((s: string) => s) }) }))

const raw = vi.fn()
const seconds: number[] = []
vi.mock('../lib/long-query', () => ({
  longQuery: vi.fn(async (s: number, run: (trx: unknown) => unknown) => {
    seconds.push(s)
    return run({ raw: (sql: string, b: unknown[]) => raw(sql, b) })
  }),
}))

import {
  registerTimelineRoutes, bucketedTimelineSql, bucketsFromRows, MAX_SIGNALS_PER_BUCKET, TIMELINE_QUERY_SECONDS,
  LAST_GOOD_TTL, type TimelineRow,
} from '../routes/timeline'
import { redis } from '../db/redis'

async function app() {
  const a = Fastify()
  await a.register(registerTimelineRoutes, { prefix: '/api/v1/signals' })
  return a
}

/** `n` rows of one hour, as the bucketed query answers them (the hour's whole count on each) */
function hour(at: string, n: number, count: number, from = 0): TimelineRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r-${at}-${from + i}`, title: `Report ${from + i}`, category: 'geopolitics', severity: 'low', status: 'pending',
    is_breaking: false, story_key: i === 0 ? 'story-1' : `r-${at}-${from + i}`, lng: '10.5', lat: '-3.25',
    bucket_time: new Date(at), bucket_count: String(count),
  }))
}

beforeEach(() => {
  store.clear(); raw.mockReset(); seconds.length = 0; chainCalls.length = 0; oldRows = []
  vi.mocked(redis.setex).mockClear()
})

describe('the map timeline of a day', () => {
  it('counts every report of each hour and keeps the newest 50, all 24 hours, under its own limit', async () => {
    const rows: TimelineRow[] = []
    for (let h = 0; h < 24; h++) rows.push(...hour(`2026-11-21T${String(h).padStart(2, '0')}:00:00.000Z`, 50, 1000 + h))
    raw.mockResolvedValueOnce({ rows })
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/timeline?range=24h' })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.buckets).toHaveLength(24)
    expect(data.buckets[0].t).toBe('2026-11-21T00:00:00.000Z')
    expect(data.buckets[23].t).toBe('2026-11-21T23:00:00.000Z')
    expect(data.buckets[5].count).toBe(1005)
    expect(data.buckets[5].signals).toHaveLength(MAX_SIGNALS_PER_BUCKET)
    expect(data.total_signals).toBe(24 * 1000 + (23 * 24) / 2)
    // a report's story only when it isn't the report itself
    expect(data.buckets[0].signals[0].story).toBe('story-1')
    expect(data.buckets[0].signals[1].story).toBeUndefined()
    expect(data.buckets[0].signals[0]).toMatchObject({ lat: -3.25, lng: 10.5, is_breaking: false })
    // one query, ranked and counted in the database, under its own limit
    expect(seconds).toEqual([TIMELINE_QUERY_SECONDS])
    const [sql, bindings] = raw.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/row_number\(\) OVER \(PARTITION BY date_trunc\('hour', created_at\) ORDER BY created_at DESC, id DESC\) AS rn/)
    expect(sql).toMatch(/count\(\*\) OVER \(PARTITION BY date_trunc\('hour', created_at\)\) AS bucket_count/)
    expect(sql).toMatch(/created_at > NOW\(\) - INTERVAL '24 hours'/)
    expect(sql).toMatch(/WHERE r\.rn <= \?/)
    expect(sql).toMatch(/COALESCE\(s\.story_id, s\.id\)::text AS story_key/)
    expect(sql).not.toMatch(/summary/)
    expect(bindings).toEqual([MAX_SIGNALS_PER_BUCKET])
    // kept a minute, and as the last answer that worked for 6 hours
    expect(vi.mocked(redis.setex).mock.calls.map(c => [c[0], c[1]])).toEqual([
      ['signals:timeline:24h:all:all', 60],
      ['signals:timeline:last:24h:all:all', LAST_GOOD_TTL],
    ])
  })

  it('binds the topic, the severity and the box in order, and turns a bad box away before any query', async () => {
    raw.mockResolvedValueOnce({ rows: hour('2026-11-21T10:00:00.000Z', 2, 2) })
    const res = await (await app()).inject({
      method: 'GET', url: '/api/v1/signals/map/timeline?range=6h&category=conflict&severity=high&bbox=-10,20,30,50',
    })
    expect(res.statusCode).toBe(200)
    const [sql, bindings] = raw.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/floor\(extract\(epoch from created_at\) \/ 900\) \* 900/)
    expect(sql).toMatch(/category = \?[\s\S]*severity = \?[\s\S]*ST_MakeEnvelope\(\?, \?, \?, \?, 4326\)/)
    expect(bindings).toEqual(['conflict', 'high', -10, 20, 30, 50, MAX_SIGNALS_PER_BUCKET])

    const bad = await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/timeline?range=24h&bbox=1,2,3' })
    expect(bad.statusCode).toBe(400)
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('answers the last day that worked when the query gives up, marked stale; 503 when there is none', async () => {
    raw.mockResolvedValueOnce({ rows: hour('2026-11-21T04:00:00.000Z', 3, 3) })
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/v1/signals/map/timeline?range=24h' })).statusCode).toBe(200)
    store.delete('signals:timeline:24h:all:all')   // the minute's copy has gone
    raw.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
    const stale = await a.inject({ method: 'GET', url: '/api/v1/signals/map/timeline?range=24h' })
    expect(stale.statusCode).toBe(200)
    expect(stale.headers['x-cache-stale']).toBe('true')
    expect(stale.json().data.stale).toBe(true)
    expect(stale.json().data.buckets[0].count).toBe(3)

    raw.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
    const none = await a.inject({ method: 'GET', url: '/api/v1/signals/map/timeline?range=1h' })
    expect(none.statusCode).toBe(503)
    expect(none.json().code).toBe('SERVICE_UNAVAILABLE')
  })

  it('a minute-old copy is answered as it is, without a query', async () => {
    store.set('signals:timeline:24h:all:all', JSON.stringify({ success: true, data: { range: '24h', buckets: [] } }))
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/timeline' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache-hit']).toBe('true')
    expect(raw).not.toHaveBeenCalled()
  })

  it('the week keeps the older way: the newest 10,000 reports, bucketed here', async () => {
    oldRows = [
      { id: 'a', title: 'A', category: 'disaster', severity: 'high', status: 'verified', is_breaking: true, story_key: 'a', lng: 1, lat: 2, bucket_time: '2026-11-20T10:00:00.000Z' },
      { id: 'b', title: 'B', category: 'disaster', severity: 'low', status: 'pending', is_breaking: false, story_key: 'b', lng: 1, lat: 2, bucket_time: '2026-11-20T10:00:00.000Z' },
    ]
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/signals/map/timeline?range=7d' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.buckets).toEqual([expect.objectContaining({ t: '2026-11-20T10:00:00.000Z', count: 2 })])
    expect(res.json().data.total_signals).toBe(2)
    expect(chainCalls).toContain('limit(10000)')
    expect(seconds).toEqual([])
  })
})

describe('bucketsFromRows and the bucketed query', () => {
  it('counts rows one by one when they carry no count, keeps 50 a bucket, oldest bucket first', () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, title: 't', category: 'c', severity: 'low', status: 'pending', is_breaking: false, lng: 0, lat: 0, bucket_time: '2026-11-21T02:00:00Z' })),
      { id: 'y', title: 't', category: 'c', severity: 'low', status: 'pending', is_breaking: false, lng: 0, lat: 0, bucket_time: '2026-11-21T01:00:00Z' },
    ] as TimelineRow[]
    const b = bucketsFromRows(rows)
    expect(b.map(x => [x.t, x.count, x.signals.length])).toEqual([
      ['2026-11-21T01:00:00.000Z', 1, 1],
      ['2026-11-21T02:00:00.000Z', 60, 50],
    ])
  })

  it('has no bucketed query for the week or the month, and reads no story ids where there are none', () => {
    expect(() => bucketedTimelineSql('7d', {}, true)).toThrow()
    expect(bucketedTimelineSql('1h', {}, false).sql).toMatch(/s\.id::text AS story_key/)
    expect(bucketedTimelineSql('1h', {}, false).sql).toMatch(/\/ 300\) \* 300/)
    // "all" is no filter
    expect(bucketedTimelineSql('24h', { category: 'all', severity: 'all' }, true).bindings).toEqual([MAX_SIGNALS_PER_BUCKET])
  })
})
