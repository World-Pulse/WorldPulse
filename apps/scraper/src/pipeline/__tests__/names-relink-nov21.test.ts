/**
 * The names re-read (Nov 21, 2026; Devon, 3:31 PM: "Proceed with the rerun"): the 7 days of reports before names in
 * every language went live, in the languages other than English, linked to the names their headlines carry, a day at
 * a time, each entity's reports of the day in one statement, carrying on after the last day done.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: (...a: unknown[]) => query(...a) } }))
vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1), on: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { relinkNames, namesToLink, NAMES_LIVE_AT, RELINK_DAYS, RELINK_PAGE, type RelinkDeps, type RelinkReport } from '../names-relink'
import { linkEntityToReports } from '../entity-graph'
import { redis } from '../../lib/redis'

const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '+00')

function deps(reportsOf: (from: Date) => RelinkReport[], over: Partial<RelinkDeps> = {}) {
  const calls = { pages: [] as Array<[string, string, { at: string; id: string } | null]>, links: [] as Array<[string, string[], string, string]>, done: [] as string[] }
  const d: RelinkDeps = {
    async page(from, to, after, limit) {
      calls.pages.push([from.toISOString(), to.toISOString(), after])
      const all = reportsOf(from)
      const start = after ? all.findIndex(r => r.id === after.id) + 1 : 0
      return all.slice(start, start + limit)
    },
    async link(entity, ids, oldest, newest) { calls.links.push([entity.name, ids, oldest, newest]); return ids.length },
    dayDone: async () => null,
    async setDayDone(day) { calls.done.push(day) },
    pause: async () => {},
    ...over,
  }
  return { d, calls }
}

describe('the names re-read of the week before', () => {
  beforeEach(() => { query.mockReset() })

  it('reads the 7 days before the names went live, a day at a time, and links each entity once a day', async () => {
    const end = Date.parse(NAMES_LIVE_AT)
    const firstDay = end - RELINK_DAYS * DAY
    const { d, calls } = deps(from => from.getTime() === firstDay
      ? [
          { id: 'r1', title: 'Путин встретился с Си Цзиньпином в Пекине', language: 'ru', created_at: at(firstDay + 1_000) },
          { id: 'r2', title: 'Владимир Путин в Москве', language: 'ru', created_at: at(firstDay + 2_000) },
          { id: 'r3', title: 'Le gouvernement approuve le budget', language: 'fr', created_at: at(firstDay + 3_000) },
        ]
      : [])
    const total = await relinkNames(d)
    expect(calls.done).toHaveLength(RELINK_DAYS)
    expect(calls.done[0]).toBe(new Date(firstDay).toISOString())
    // the last window stops where the live path began
    expect(calls.pages.at(-1)?.[1]).toBe(NAMES_LIVE_AT)
    const putin = calls.links.find(l => l[0] === 'Vladimir Putin')!
    expect(putin[1]).toEqual(['r1', 'r2'])
    expect(putin[2]).toBe(at(firstDay + 1_000))
    expect(putin[3]).toBe(at(firstDay + 2_000))
    expect(calls.links.filter(l => l[0] === 'Vladimir Putin')).toHaveLength(1)
    expect(calls.links.map(l => l[0])).toEqual(expect.arrayContaining(['Xi Jinping', 'Beijing', 'Moscow']))
    expect(total).toMatchObject({ days: RELINK_DAYS, reports: 3, named: 2 })
  })

  it('pages through a big day with its cursor, and carries on after the last day done', async () => {
    const end = Date.parse(NAMES_LIVE_AT)
    const big = Array.from({ length: RELINK_PAGE + 5 }, (_, i) => ({ id: `r${i}`, title: 'Президент Украины Владимир Зеленский', language: 'ru', created_at: at(end - DAY + i) }))
    const doneDay = new Date(end - 2 * DAY).toISOString()
    const { d, calls } = deps(from => (from.getTime() === end - DAY ? big : []), { dayDone: async () => doneDay })
    await relinkNames(d)
    // only the day after the one done
    expect(calls.done).toEqual([new Date(end - DAY).toISOString()])
    expect(calls.pages.map(p => p[2]?.id ?? null)).toEqual([null, `r${RELINK_PAGE - 1}`])
    expect(calls.links.find(l => l[0] === 'Ukraine')?.[1]).toHaveLength(RELINK_PAGE + 5)
  })

  it('a failed entity is counted and the day still finishes', async () => {
    const end = Date.parse(NAMES_LIVE_AT)
    const { d, calls } = deps(from => (from.getTime() === end - DAY ? [{ id: 'r1', title: 'Москва и Пекин', language: 'ru', created_at: at(end - DAY) }] : []), {
      link: async entity => { if (entity.name === 'Moscow') throw new Error('deadlock'); return 1 },
    })
    const total = await relinkNames(d)
    expect(calls.done).toHaveLength(RELINK_DAYS)
    expect(total.added).toBe(1)
  })

  it('reads the headline as the live path does: the table only, nothing for English', () => {
    expect(namesToLink({ title: 'Путин встретился с Си Цзиньпином в Пекине', language: 'ru' }).map(e => e.name).sort()).toEqual(['Beijing', 'Vladimir Putin', 'Xi Jinping'])
    expect(namesToLink({ title: 'Putin meets Xi in Beijing', language: 'en' })).toEqual([])
  })
})

describe("one entity's reports in one statement", () => {
  beforeEach(() => { query.mockReset(); vi.mocked(redis.del).mockClear() })

  it('counts only the reports new to it, moves the dates the right way, and drops its cached node', async () => {
    query.mockResolvedValueOnce({ rows: [{ added: 2 }] })
    const added = await linkEntityToReports({ name: 'Moscow', type: 'location', salience: 0.5 }, ['r1', 'r2', 'r3'], '2026-11-15 10:00:00+00', '2026-11-15 12:00:00+00')
    expect(added).toBe(2)
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/SELECT unnest\(\$6::text\[\]\) AS sid\s+EXCEPT\s+SELECT unnest\(signal_ids\) FROM entity_nodes WHERE id = \$1/)
    expect(sql).toMatch(/mention_count = entity_nodes\.mention_count \+ \(SELECT count\(\*\) FROM fresh\)/)
    expect(sql).toMatch(/first_seen = LEAST\(entity_nodes\.first_seen, \$5::timestamptz\)/)
    expect(sql).toMatch(/last_seen = GREATEST\(entity_nodes\.last_seen, \$7::timestamptz\)/)
    expect(sql).not.toMatch(/RETURNING \*/)
    expect(params[5]).toEqual(['r1', 'r2', 'r3'])
    expect(redis.del).toHaveBeenCalledWith(`kg:node:${params[0]}`)
  })

  it('asks nothing for no reports', async () => {
    expect(await linkEntityToReports({ name: 'Moscow', type: 'location', salience: 0.5 }, [], '', '')).toBe(0)
    expect(query).not.toHaveBeenCalled()
  })
})
