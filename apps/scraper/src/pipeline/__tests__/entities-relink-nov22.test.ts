/**
 * The week's older reports read again for every name (Nov 22, 2026; Devon, 1:48 PM: "1 ok"): from 8 days before the
 * first start up to the names going live, every language, with the live path's rules and no model, a day at a time,
 * each entity's reports of the day in one statement, the most-named first, carrying on after the last day done.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1), on: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { relinkEntities, relinkWindows, entitiesToLink, RELINK_DAYS, RELINK_PAGE, SMALL_ENTITY, PAUSE_MS, type RelinkDeps, type RelinkReport } from '../entities-relink'
import { NAMES_LIVE_AT } from '../names-relink'

const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '+00')
/** The first start, the evening the re-link ships */
const CUTOFF = new Date('2026-11-22T20:30:00.000Z')
const FIRST = CUTOFF.getTime() - RELINK_DAYS * DAY

function deps(reportsOf: (from: Date) => RelinkReport[], over: Partial<RelinkDeps> = {}) {
  const calls = { pages: [] as Array<[string, string, string | null]>, links: [] as Array<[string, string[], string, string]>, done: [] as Array<[string, number]>, pauses: [] as number[] }
  const d: RelinkDeps = {
    async page(from, to, after, limit) {
      calls.pages.push([from.toISOString(), to.toISOString(), after?.id ?? null])
      const all = reportsOf(from)
      const start = after ? all.findIndex(r => r.id === after.id) + 1 : 0
      return all.slice(start, start + limit)
    },
    async link(entity, ids, oldest, newest) { calls.links.push([`${entity.type}:${entity.name}`, ids, oldest, newest]); return ids.length },
    dayDone: async () => null,
    async setDayDone(day, _stats, _total, of) { calls.done.push([day, of]) },
    async pause(ms) { calls.pauses.push(ms) },
    ...over,
  }
  return { d, calls }
}

const report = (id: string, ms: number, title: string, language = 'en', summary: string | null = null): RelinkReport =>
  ({ id, title, summary, language, created_at: at(ms) })

describe('the days it reads', () => {
  it('from 8 days before the first start up to the names going live, the last day cut there', () => {
    const w = relinkWindows(CUTOFF)
    expect(w[0]!.from.toISOString()).toBe(new Date(FIRST).toISOString())
    expect(w.at(-1)!.to.toISOString()).toBe(NAMES_LIVE_AT)
    expect(w).toHaveLength(Math.ceil((Date.parse(NAMES_LIVE_AT) - FIRST) / DAY))
    for (const [i, x] of w.entries()) if (i > 0) expect(x.from.getTime()).toBe(w[i - 1]!.to.getTime())
  })

  it('a first start 9 days after the names went live reads nothing, one 2 days after reads 6 days', () => {
    expect(relinkWindows(new Date(Date.parse(NAMES_LIVE_AT) + 9 * DAY))).toEqual([])
    expect(relinkWindows(new Date(Date.parse(NAMES_LIVE_AT) + 2 * DAY))).toHaveLength(6)
  })
})

describe('the re-link of the week before', () => {
  it('links each entity once a day, every language, the most-named first, and stops where the live path began', async () => {
    const { d, calls } = deps(from => from.getTime() === FIRST
      ? [
          report('r1', FIRST + 1_000, 'Putin meets Xi in Beijing as talks on Ukraine stall'),
          report('r2', FIRST + 2_000, 'Путин встретился с Си Цзиньпином в Пекине', 'ru'),
          report('r3', FIRST + 3_000, 'Ukraine says drones hit a refinery', 'en'),
          report('r4', FIRST + 4_000, 'Local bakery wins award', 'en', 'A family bakery won the regional prize.'),
          report('r5', FIRST + 5_000, 'काठमाडौँमा बस दुर्घटना', 'ne'),
        ]
      : [])
    const total = await relinkEntities(CUTOFF, d)
    const windows = relinkWindows(CUTOFF)
    expect(calls.done.map(x => x[0])).toEqual(windows.map(w => w.from.toISOString()))
    expect(calls.done[0]![1]).toBe(windows.length)
    expect(calls.pages.at(-1)?.[1]).toBe(NAMES_LIVE_AT)
    const putin = calls.links.find(l => l[0] === 'person:Vladimir Putin')!
    expect(putin[1]).toEqual(['r1', 'r2'])
    expect([putin[2], putin[3]]).toEqual([at(FIRST + 1_000), at(FIRST + 2_000)])
    expect(calls.links.filter(l => l[0] === 'person:Vladimir Putin')).toHaveLength(1)
    expect(calls.links.find(l => l[0] === 'location:Ukraine')?.[1]).toEqual(['r1', 'r3'])
    expect(calls.links.find(l => l[0] === 'location:Kathmandu')?.[1]).toEqual(['r5'])
    // the most-named first
    const sizes = calls.links.map(l => l[1].length)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(total).toMatchObject({ days: windows.length, reports: 5, linked: 4 })
  })

  it('pages through a big day with its cursor, and carries on after the last day done', async () => {
    const windows = relinkWindows(CUTOFF)
    const last = windows.at(-1)!
    const big = Array.from({ length: RELINK_PAGE + 5 }, (_, i) => report(`r${i}`, last.from.getTime() + i, 'Ukraine says drones hit a refinery'))
    const doneDay = windows.at(-2)!.from.toISOString()
    const { d, calls } = deps(from => (from.getTime() === last.from.getTime() ? big : []), { dayDone: async () => doneDay })
    await relinkEntities(CUTOFF, d)
    expect(calls.done.map(x => x[0])).toEqual([last.from.toISOString()])
    expect(calls.pages.map(p => p[2])).toEqual([null, `r${RELINK_PAGE - 1}`])
    expect(calls.links.find(l => l[0] === 'location:Ukraine')?.[1]).toHaveLength(RELINK_PAGE + 5)
    // a big entity takes the long pause, and the server gets a breath between pages
    expect(calls.pauses).toContain(PAUSE_MS.entity)
    expect(calls.pauses).toContain(PAUSE_MS.page)
  })

  it('a small entity takes the short pause', async () => {
    const { d, calls } = deps(from => (from.getTime() === FIRST ? [report('r1', FIRST, 'Kano State governor visits Abuja')] : []))
    await relinkEntities(CUTOFF, d)
    expect(SMALL_ENTITY).toBeGreaterThan(1)
    expect(calls.pauses).toContain(PAUSE_MS.small)
    expect(calls.pauses).not.toContain(PAUSE_MS.entity)
  })

  it('a failed entity is counted and the day still finishes', async () => {
    const { d, calls } = deps(from => (from.getTime() === FIRST ? [report('r1', FIRST, 'Putin meets Xi in Beijing')] : []), {
      link: async entity => { if (entity.name === 'Beijing') throw new Error('deadlock'); return 1 },
    })
    const total = await relinkEntities(CUTOFF, d)
    expect(calls.done).toHaveLength(relinkWindows(CUTOFF).length)
    expect(total.failed).toBe(1)
    // Putin's link is still written
    expect(total.added).toBe(1)
  })
})

describe('a report read as the live path reads one', () => {
  it('the rules on headline and summary, the places in other scripts where the rules found none, and the names in its own language', () => {
    const names = (title: string, language: string, summary: string | null = null) => entitiesToLink({ title, summary, language }).map(e => `${e.type}:${e.name}`).sort()
    expect(names('Putin meets Xi in Beijing as talks on Ukraine stall', 'en')).toEqual(['location:Beijing', 'location:Ukraine', 'person:Vladimir Putin'])
    // the summary is read too, as on the live path
    expect(names('Putin meets Xi in Beijing as talks on Ukraine stall', 'en', 'The Russian president Vladimir Putin met Chinese leader Xi Jinping.'))
      .toEqual(['location:Beijing', 'location:China', 'location:Ukraine', 'person:Vladimir Putin', 'person:Xi Jinping'])
    expect(names('Путин встретился с Си Цзиньпином в Пекине', 'ru')).toEqual(['location:Beijing', 'person:Vladimir Putin', 'person:Xi Jinping'])
    expect(names('東京で地震', 'ja')).toEqual(['location:Japan', 'location:Tokyo'])
    expect(names('Local bakery wins award', 'en', 'A family bakery won the regional prize.')).toEqual([])
    // no language kept: read as English
    expect(entitiesToLink({ title: 'Kano State governor visits Abuja', summary: null, language: null }).map(e => e.name).sort()).toEqual(['Abuja', 'Kano'])
  })
})
