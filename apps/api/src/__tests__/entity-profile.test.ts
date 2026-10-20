/**
 * Entity pages (lib/entity-profile.ts, Oct 13, 2026). The queries were run
 * against Postgres 16 with fixture rows (a three-report story, single reports
 * on ten days, a report from 40 days ago, a malformed id); these check the
 * parts that don't need a database.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/postgres', () => ({ db: { raw: vi.fn() } }))
vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } }))
vi.mock('../routes/stories', () => ({ storiesOfSignals: vi.fn(async () => []) }))
vi.mock('../lib/stories', () => ({ signalsHaveStoryIds: vi.fn(async () => true) }))
vi.mock('../lib/long-query', () => ({ longQuery: vi.fn() }))
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { mentionIds, dailySeries, ACTIVITY_DAYS, connectionsOf, entityProfile, buildProfile, CONNECTION_REPORTS, CONNECTION_SECONDS, QUICK, FULL, PROFILE_TTL } from '../lib/entity-profile'
import { redis } from '../db/redis'
import { db } from '../db/postgres'
import { longQuery } from '../lib/long-query'
import { logger } from '../lib/logger'

describe('mentionIds', () => {
  it('keeps well-formed report ids, lowercase and once each', () => {
    const a = '6f1c2a3b-0000-4000-8000-000000000001'
    expect(mentionIds([a, a.toUpperCase(), 'not-a-uuid', 42, null])).toEqual([a])
    expect(mentionIds(null)).toEqual([])
  })
})

describe('dailySeries', () => {
  it('is 30 UTC days ending today, oldest first, with empty days as 0', () => {
    const now = Date.parse('2026-10-13T03:30:00Z')
    const series = dailySeries(new Map([['2026-10-13', 4], ['2026-10-01', 2]]), now)
    expect(series).toHaveLength(ACTIVITY_DAYS)
    expect(series[0]).toEqual({ day: '2026-09-14', n: 0 })
    expect(series.at(-1)).toEqual({ day: '2026-10-13', n: 4 })
    expect(series.find(d => d.day === '2026-10-01')?.n).toBe(2)
  })
})

describe('"named with" (Oct 20, 2026: /entities/anwar-ibrahim-… answered 500)', () => {
  const ids = ['6f1c2a3b-0000-4000-8000-000000000001', '6f1c2a3b-0000-4000-8000-000000000002']
  const since = new Date('2026-09-20T00:00:00Z')

  it("reads the entity's newest reports only, entities seen since then, under its own longer limit", async () => {
    const raw = vi.fn(async () => ({ rows: [{ id: 'asean', type: 'organisation', name: 'ASEAN', shared: 5 }] }))
    vi.mocked(longQuery).mockImplementationOnce(async (_s, run) => run({ raw } as never))
    expect(await connectionsOf('anwar', ids, since)).toEqual([{ id: 'asean', type: 'organisation', name: 'ASEAN', shared: 5 }])
    expect(vi.mocked(longQuery).mock.calls.at(-1)?.[0]).toBe(CONNECTION_SECONDS)
    const [sql, params] = raw.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/ORDER BY created_at DESC\s+LIMIT \?/)
    expect(sql).toMatch(/n\.last_seen >= \(SELECT min\(created_at\) FROM mine\) - interval '3 days'/)
    expect(params).toEqual([ids, since, CONNECTION_REPORTS, 'anwar', 12])
  })

  it('gives up (null) instead of failing the page when the query times out', async () => {
    vi.mocked(longQuery).mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
    expect(await connectionsOf('anwar', ids, since)).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it("a first view's slow parts give up before the website's 10-second wait; the background remake may take longer", () => {
    expect(CONNECTION_SECONDS).toBeLessThan(10)
    expect(Math.max(QUICK.stories, QUICK.connections)).toBeLessThan(9)
    expect(FULL.stories).toBeGreaterThan(QUICK.stories)
    expect(FULL.connections).toBeGreaterThan(QUICK.connections)
  })

  it('asks nothing for an entity without reports', async () => {
    vi.mocked(longQuery).mockClear()
    expect(await connectionsOf('anwar', [], since)).toEqual([])
    expect(longQuery).not.toHaveBeenCalled()
  })

  it('still answers the profile when "named with" times out', async () => {
    vi.mocked(db.raw).mockImplementation((async (sql: string) => {
      if (/FROM entity_nodes WHERE id = \?/.test(sql)) {
        return { rows: [{ id: 'e503847e4ee3f485', type: 'person', canonical_name: 'Anwar Ibrahim', first_seen: '2026-04-06T00:00:00Z', last_seen: '2026-10-20T11:00:00Z', signal_ids: ids }] }
      }
      if (/to_char\(created_at/.test(sql)) return { rows: [{ day: '2026-10-20', n: 2, last24: 2, prev24: 0, last7: 2 }] }
      return { rows: [] }
    }) as never)
    // stories answer (storiesOfSignals is mocked); "named with" runs on the transaction and times out
    vi.mocked(longQuery).mockImplementation((async (_s: number, run: (trx: unknown) => Promise<unknown>) => run({ raw: async () => { throw new Error('canceling statement due to statement timeout') } })) as never)
    vi.mocked(redis.setex).mockClear()
    const profile = await entityProfile('e503847e4ee3f485')
    expect(profile?.entity.name).toBe('Anwar Ibrahim')
    expect(profile?.activity.last24h).toBe(2)
    expect(profile?.connections).toEqual([])
    // a first view with a part cut off is kept as already due, so the full profile is made in the background
    const kept = JSON.parse(String(vi.mocked(redis.setex).mock.calls[0]?.[2]))
    expect(kept.value.entity.name).toBe('Anwar Ibrahim')
    expect(kept.at).toBeLessThan(Date.now() - PROFILE_TTL * 1000)
    vi.mocked(longQuery).mockReset()
  })

  it('a quick profile with nothing cut off is kept as fresh', async () => {
    vi.mocked(longQuery).mockImplementation((async (_s: number, run: (trx: unknown) => Promise<unknown>) => run({ raw: async () => ({ rows: [] }) })) as never)
    vi.mocked(redis.setex).mockClear()
    const { partial } = await buildProfile('e503847e4ee3f485', QUICK)
    expect(partial).toBe(false)
    await entityProfile('e503847e4ee3f485')
    const kept = JSON.parse(String(vi.mocked(redis.setex).mock.calls[0]?.[2]))
    expect(kept.at).toBeGreaterThan(Date.now() - 5_000)
    vi.mocked(longQuery).mockReset()
  })
})

