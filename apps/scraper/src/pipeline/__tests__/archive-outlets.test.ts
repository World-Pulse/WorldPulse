/**
 * The April–May archive's second outlets (Oct 22, 2026): its pending
 * one-outlet reports matched with the other outlets' reports of the same days,
 * by the live second outlet's test.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), sadd: vi.fn(), expire: vi.fn() } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

import { matchDay, verifyArchive, waitsForOutlet, ARCHIVE_FIRST_DAY, ARCHIVE_LAST_DAY, type ArchiveReport, type ArchiveDeps, type ArchiveMatch } from '../archive-outlets'

const AT = new Date('2026-05-03T10:00:00Z')
const hours = (h: number) => new Date(AT.getTime() + h * 3_600_000)
let seq = 0

const rep = (url: string, title: string, over: Partial<ArchiveReport> = {}): ArchiveReport => ({
  id: 'r' + seq++,
  title,
  category: 'disaster',
  severity: 'high',
  status: 'pending',
  source_count: 1,
  published_at: AT,
  created_at: AT,
  original_urls: [url],
  source_ids: [],
  location_name: 'Chhattisgarh, India',
  lat: 21.3,
  lng: 81.6,
  tags: ['news', 'rss'],
  ...over,
})

const noPause = async () => {}

describe('which archive reports wait for a second outlet', () => {
  it('pending, one outlet, medium or more, news another outlet could carry', () => {
    const r = rep('https://www.thehindu.com/a', 'Six dead, 40 injured as bus hits tree in Chhattisgarh')
    expect(waitsForOutlet(r)).toBe(true)
    expect(waitsForOutlet({ ...r, status: 'verified' })).toBe(false)
    expect(waitsForOutlet({ ...r, source_count: 2 })).toBe(false)
    expect(waitsForOutlet({ ...r, severity: 'low' })).toBe(false)
    expect(waitsForOutlet({ ...r, tags: ['osint', 'adsb'] })).toBe(false)
    // a republisher's copy or an aggregator's page isn't a newsroom's report
    expect(waitsForOutlet({ ...r, original_urls: ['http://www.indiagazette.com/news/279392606/six-dead-bus'] })).toBe(false)
    expect(waitsForOutlet({ ...r, original_urls: ['https://www.devdiscourse.com/article/six-dead-bus'] })).toBe(false)
  })
})

describe('a day of the archive', () => {
  it("finds another newsroom's report of the same story among the reports of those days", async () => {
    const held = rep('https://www.thehindu.com/news/bus-hits-tree-six-dead/article1.ece', 'Six dead, 40 injured as bus hits tree in Chhattisgarh')
    const other = rep('https://www.ndtv.com/india-news/six-killed-bus-rams-tree-123', 'Six killed, 40 injured after bus rams tree in Chhattisgarh', { severity: 'low', published_at: hours(2), created_at: hours(2) })
    const { matches, held: n } = await matchDay('2026-05-03', [held, other], noPause)
    expect(n).toBe(1)          // the low-severity one is an outlet, not a report waiting for one
    expect(matches).toHaveLength(1)
    expect(matches[0]!.report.id).toBe(held.id)
    expect(matches[0]!.outlets.map(o => o.site)).toEqual(['ndtv.com'])
    expect(matches[0]!.ids).toEqual([other.id])
  })

  it('both reports of a story wait: each gets the other', async () => {
    const a = rep('https://www.thehindu.com/news/bus/article2.ece', 'Six dead, 40 injured as bus hits tree in Chhattisgarh')
    const b = rep('https://www.ndtv.com/india-news/bus-456', 'Six killed, 40 injured after bus rams tree in Chhattisgarh', { published_at: hours(1), created_at: hours(1) })
    const { matches } = await matchDay('2026-05-03', [a, b], noPause)
    expect(matches.map(m => [m.report.id, m.ids])).toEqual([[a.id, [b.id]], [b.id, [a.id]]])
  })

  it('leaves out the same owner, other stories, copies, republished copies and other days', async () => {
    const held = rep('https://www.thehindu.com/news/bus/article3.ece', 'Six dead, 40 injured as bus hits tree in Chhattisgarh')
    // the others are outlets only (low severity: not waiting themselves)
    const low = { severity: 'low' }
    const pool = [
      held,
      rep('https://frontline.thehindu.com/news/bus-crash', 'Six killed, 40 injured as bus crashes into tree in Chhattisgarh', { status: 'verified' }),
      rep('https://www.ndtv.com/india-news/odisha-123', 'Six killed, 40 injured after bus rams tree in Odisha', low),
      rep('https://www.tribuneindia.com/news/bus-hits-tree-six-dead', 'Six dead, 40 injured as bus hits tree in Chhattisgarh', low),
      rep('http://www.indiagazette.com/news/279392606/six-killed-bus-chhattisgarh', 'Six killed, 40 injured after bus rams tree in Chhattisgarh', low),
      rep('https://indianexpress.com/article/six-killed-bus-chhattisgarh', 'Six killed, 40 injured after bus rams tree in Chhattisgarh', { ...low, published_at: hours(30), created_at: hours(30) }),
    ]
    const { matches } = await matchDay('2026-05-03', pool, noPause)
    expect(matches).toEqual([])
  })
})

describe('the whole archive, once', () => {
  const deps = (over: Partial<ArchiveDeps> = {}) => {
    const loads: string[] = []
    const applied: ArchiveMatch[] = []
    const counted: string[] = []
    const d: ArchiveDeps = {
      load: async (from) => { loads.push(from.toISOString().slice(0, 10)); return [] },
      apply: async (m) => { applied.push(m); return true },
      dayDone: async () => null,
      setDayDone: async () => {},
      count: async (s) => { counted.push(s.day) },
      pause: async () => {},
      ...over,
    }
    return { d, loads, applied, counted }
  }

  it('goes through every day from Apr 5 to May 20, each with the day before and after', async () => {
    const { d, loads, counted } = deps()
    const total = await verifyArchive(d)
    expect(total.days).toBe(46)
    expect(counted[0]).toBe(ARCHIVE_FIRST_DAY)
    expect(counted[counted.length - 1]).toBe(ARCHIVE_LAST_DAY)
    expect(loads[0]).toBe('2026-04-04')
  })

  it('carries on after the last day done', async () => {
    const { d, counted } = deps({ dayDone: async () => '2026-05-18' })
    const total = await verifyArchive(d)
    expect(counted).toEqual(['2026-05-19', '2026-05-20'])
    expect(total.days).toBe(2)
  })

  it('adds the outlets it finds and counts what turned verified', async () => {
    const held = rep('https://www.thehindu.com/news/bus/article4.ece', 'Six dead, 40 injured as bus hits tree in Chhattisgarh', { published_at: new Date('2026-05-20T09:00:00Z'), created_at: new Date('2026-05-20T09:00:00Z') })
    const other = rep('https://www.ndtv.com/india-news/bus-789', 'Six killed, 40 injured after bus rams tree in Chhattisgarh', { published_at: new Date('2026-05-20T11:00:00Z'), created_at: new Date('2026-05-20T11:00:00Z') })
    const { d, applied } = deps({ dayDone: async () => '2026-05-19', load: async () => [held, other] })
    const total = await verifyArchive(d)
    expect(applied.map(m => m.report.id)).toEqual([held.id, other.id])
    expect(total).toMatchObject({ days: 1, matched: 2, outlets: 2, verified: 2 })
  })
})
