/**
 * The second outlet (plan 0s3, Oct 22, 2026): other outlets' reports of a
 * story only one outlet carried, found in GDELT's news index.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

import {
  queryWords, searchUrl, gdeltTime, seenAt, readReply, siteOf, otherOutlets, searchable, dueRound,
  runSecondOutlets, MAX_ADDED, type HeldReport, type DocArticle, type SecondOutletDeps, type DueReport, type SearchReply,
} from '../second-outlet'

const AT = new Date('2026-10-22T10:00:00Z')
const seen = (d: Date) => gdeltTime(d).replace(/^(\d{8})/, '$1T') + 'Z'
const LATER = new Date(AT.getTime() + 3 * 3_600_000)

const report = (over: Partial<HeldReport> = {}): HeldReport => ({
  id: 'sig-1',
  title: 'Six dead, 40 injured as bus hits tree in Chhattisgarh',
  category: 'disaster',
  severity: 'high',
  published_at: AT,
  original_urls: ['https://www.thehindu.com/news/national/chhattisgarh/bus-hits-tree-six-dead/article1.ece'],
  source_ids: [],
  location_name: 'Chhattisgarh, India',
  lat: 21.3,
  lng: 81.6,
  tags: ['news', 'rss', 'the-hindu-national'],
  ...over,
})

const article = (url: string, title: string, at = new Date(AT.getTime() + 2 * 3_600_000)): DocArticle =>
  ({ url, title, seendate: seen(at), domain: new URL(url).hostname, language: 'English' })

describe('the words searched', () => {
  it('takes the places and names first, then long words; no short, plain or number words', () => {
    expect(queryWords('Six dead, 40 injured as bus hits tree in Chhattisgarh; CM announces compensation'))
      .toEqual(['chhattisgarh', 'compensation', 'tree'])
    expect(queryWords('Melioidosis kills 45 in four northeastern provinces')).toEqual(['melioidosis', 'northeastern', 'provinces'])
    expect(queryWords('Suspects in Athens explosion will be found soon, minister says')).toEqual(['athens', 'suspects', 'explosion'])
    expect(queryWords('Minister Chrysochoidis Says Suspects in Athens Explosion Will Be Found Soon')[0]).toBe('chrysochoidis')
    expect(queryWords('Russia reportedly strikes central Kyiv with cluster-warhead ballistic missile')).toEqual(['kyiv', 'russia', 'ballistic'])
  })

  it('reads a title-case headline by its places and long words', () => {
    expect(queryWords('Fires Fuelled By El Niño Kill 12 In Peru, Leave Hundreds Homeless')).toEqual(['peru', 'hundreds', 'homeless'])
  })

  it('asks GDELT for English articles in the window', () => {
    const url = new URL(searchUrl(['chhattisgarh', 'compensation', 'tree'], new Date('2026-10-21T10:00:00Z'), new Date('2026-10-22T12:30:00Z')))
    expect(url.origin + url.pathname).toBe('https://api.gdeltproject.org/api/v2/doc/doc')
    expect(url.searchParams.get('query')).toBe('chhattisgarh compensation tree sourcelang:english')
    expect(url.searchParams.get('mode')).toBe('artlist')
    expect(url.searchParams.get('format')).toBe('json')
    expect(url.searchParams.get('startdatetime')).toBe('20261021100000')
    expect(url.searchParams.get('enddatetime')).toBe('20261022123000')
  })

  it('reads GDELT times', () => {
    expect(seenAt('20261022T153000Z')?.toISOString()).toBe('2026-10-22T15:30:00.000Z')
    expect(seenAt('yesterday')).toBeNull()
  })
})

describe("GDELT's reply", () => {
  it('reads articles, an empty answer, "slow down" and refusals', () => {
    expect(readReply(200, JSON.stringify({ articles: [{ url: 'https://a.com/x', title: 'T' }] }))).toEqual({ kind: 'ok', articles: [{ url: 'https://a.com/x', title: 'T' }] })
    expect(readReply(200, '{}')).toEqual({ kind: 'ok', articles: [] })
    expect(readReply(429, 'Please limit requests to one every 5 seconds or contact …')).toEqual({ kind: 'slow' })
    expect(readReply(200, 'Please limit requests to one every 5 seconds or contact …')).toEqual({ kind: 'slow' })
    expect(readReply(200, 'The specified phrase is too short.').kind).toBe('error')
    expect(readReply(500, 'oops')).toEqual({ kind: 'error', reason: 'HTTP 500' })
  })

  it('reads a reply with a stray backslash in a headline', () => {
    const reply = readReply(200, '{"articles": [{"url": "https://a.com/x", "title": "Floods \\hit Lagos"}]}')
    expect(reply.kind).toBe('ok')
  })
})

describe('which articles are other outlets', () => {
  it('counts one owner\'s sister sites as one website', () => {
    expect(siteOf('en.protothema.gr')).toBe('protothema.gr')
    expect(siteOf('www.protothema.gr')).toBe('protothema.gr')
    expect(siteOf('news.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteOf('abc.net.au')).toBe('abc.net.au')
    expect(siteOf('frontline.thehindu.com')).toBe('thehindu.com')
  })

  it('takes another newsroom\'s report of the same story', () => {
    const found = otherOutlets(report(), [
      article('https://www.ndtv.com/india-news/six-killed-40-injured-after-bus-hits-tree-in-chhattisgarh-123', 'Six killed, 40 injured after bus hits tree in Chhattisgarh - NDTV'),
    ], LATER)
    expect(found.map(f => f.site)).toEqual(['ndtv.com'])
    expect(found[0]!.title).toBe('Six killed, 40 injured after bus hits tree in Chhattisgarh')
  })

  it('leaves out the same website, aggregators, other stories, copies, and articles a day away', () => {
    const found = otherOutlets(report(), [
      article('https://frontline.thehindu.com/news/bus-crash-chhattisgarh-six-killed-forty-injured', 'Six killed, 40 injured as bus crashes into tree in Chhattisgarh'),
      article('https://www.msn.com/en-in/news/india/six-killed-40-injured-after-bus-hits-tree-in-chhattisgarh/ar-1', 'Six killed, 40 injured after bus hits tree in Chhattisgarh'),
      article('https://www.ndtv.com/india-news/six-killed-40-injured-after-bus-hits-tree-in-odisha-123', 'Six killed, 40 injured after bus hits tree in Odisha'),
      article('https://www.tribuneindia.com/news/bus-hits-tree-six-dead', 'Six dead, 40 injured as bus hits tree in Chhattisgarh'),
      article('https://indianexpress.com/article/six-killed-bus-chhattisgarh', 'Six killed, 40 injured after bus hits tree in Chhattisgarh', new Date(AT.getTime() + 30 * 3_600_000)),
    ], new Date(AT.getTime() + 31 * 3_600_000))
    expect(found).toEqual([])
  })

  it('counts one wire story on several papers once, and at most three outlets', () => {
    const wire = 'Six killed, 40 injured after bus hits tree in Chhattisgarh'
    const found = otherOutlets(report(), [
      article('https://www.ndtv.com/a/six-killed-chhattisgarh-1', wire),
      article('https://www.deccanherald.com/b/six-killed-chhattisgarh-2', wire),
      article('https://www.hindustantimes.com/c/chhattisgarh-bus-accident', 'Chhattisgarh bus accident: six killed, 40 injured as bus hits tree'),
      article('https://www.news18.com/d/chhattisgarh-bus-crash', 'Bus hits tree in Chhattisgarh, six killed and 40 injured'),
      article('https://www.timesnownews.com/e/chhattisgarh-bus', 'Chhattisgarh: six killed, 40 injured as bus rams into tree'),
    ], LATER)
    expect(found.map(f => f.site)).toEqual(['ndtv.com', 'hindustantimes.com', 'news18.com'])
    expect(found).toHaveLength(MAX_ADDED)
  })
})

describe('which reports, and when', () => {
  it('searches news, not machine feeds or template headlines', () => {
    expect(searchable(report())).toBe(true)
    expect(searchable(report({ title: 'Aircraft DAL1063 squawking 7500 — Unlawful interference (hijacking) (United States)', tags: ['osint', 'adsb', 'aviation'] }))).toBe(false)
    expect(searchable(report({ title: '14 killed, 7 injured after gold mine collapse in Colombia', tags: ['osint', 'gdelt', 'cameo-19'] }))).toBe(true)
    expect(searchable(report({ title: 'Armed conflict in Washington, District of Columbia, United States', tags: ['osint', 'gdelt'] }))).toBe(false)
  })

  it('searches medium reports after 3 hours, high and critical after 1 and again after 10', () => {
    const h = 3_600_000
    expect(dueRound('medium', 2 * h, false, false)).toBe(0)
    expect(dueRound('medium', 4 * h, false, false)).toBe(1)
    expect(dueRound('medium', 12 * h, true, false)).toBe(0)
    expect(dueRound('high', 1.5 * h, false, false)).toBe(1)
    expect(dueRound('high', 5 * h, true, false)).toBe(0)
    expect(dueRound('critical', 11 * h, true, false)).toBe(2)
    expect(dueRound('critical', 11 * h, true, true)).toBe(0)
    expect(dueRound('high', 31 * h, false, false)).toBe(0)
  })
})

describe('a pass', () => {
  const deps = (replies: SearchReply[], due: DueReport[], over: Partial<SecondOutletDeps> = {}) => {
    const calls = { urls: [] as string[], added: [] as Array<{ id: string; sites: string[]; crossCheck: boolean }>, released: [] as string[], paused: 0, counted: null as unknown, remembered: 0 }
    let t = AT.getTime() + 3 * 3_600_000
    const d: SecondOutletDeps = {
      due: async () => due,
      claim: async () => true,
      release: async id => { calls.released.push(id) },
      current: async id => due.find(x => x.report.id === id)?.report ?? null,
      search: async url => { calls.urls.push(url); return replies.shift() ?? { kind: 'ok', articles: [] } },
      add: async (r, found, crossCheck) => { calls.added.push({ id: r.id, sites: found.map(f => f.site), crossCheck }); return true },
      crossChecksToday: async () => 0,
      paused: async () => false,
      pause: async () => { calls.paused++ },
      lock: async () => true,
      unlock: async () => {},
      count: async (_day, stats) => { calls.counted = { ...stats } },
      remember: async () => { calls.remembered++ },
      wait: async ms => { t += ms },
      clock: () => (t += 1_000),
      ...over,
    }
    return { d, calls }
  }

  it('adds the outlets it finds, searches again with two words when three find nothing, and keeps count', async () => {
    const one = report()
    const two = report({ id: 'sig-2', severity: 'medium', title: 'Melioidosis kills 45 in four northeastern provinces', original_urls: ['https://www.khaosodenglish.com/news/2026/10/22/melioidosis-kills-45/'], location_name: null, lat: null, lng: null })
    const { d, calls } = deps([
      { kind: 'ok', articles: [article('https://www.ndtv.com/india-news/six-killed-40-injured-after-bus-hits-tree-in-chhattisgarh-123', 'Six killed, 40 injured after bus hits tree in Chhattisgarh')] },
      { kind: 'ok', articles: [] },
      { kind: 'ok', articles: [] },
    ], [{ report: one, round: 1, at: AT }, { report: two, round: 1, at: AT }])
    const stats = await runSecondOutlets(d)
    expect(calls.added).toEqual([{ id: 'sig-1', sites: ['ndtv.com'], crossCheck: true }])
    expect(calls.urls).toHaveLength(3)
    expect(new URL(calls.urls[2]!).searchParams.get('query')).toBe('melioidosis northeastern sourcelang:english')
    expect(stats).toMatchObject({ due: 2, searched: 2, requests: 3, matched: 1, outlets: 1, promoted: 1, crosschecked: 1, slow: 0, errors: 0 })
    expect(calls.counted).toMatchObject({ matched: 1 })
    expect(calls.remembered).toBe(1)
  })

  it('stops for a while when GDELT says to slow down, and the report is searched again later', async () => {
    const { d, calls } = deps([{ kind: 'slow' }], [{ report: report(), round: 1, at: AT }, { report: report({ id: 'sig-2' }), round: 1, at: AT }])
    const stats = await runSecondOutlets(d)
    expect(stats.slow).toBe(1)
    expect(calls.paused).toBe(1)
    expect(calls.released).toEqual(['sig-1'])
    expect(calls.urls).toHaveLength(1)
  })

  it('leaves the cross-check out past its daily share, and skips a report another outlet has joined since', async () => {
    const { d, calls } = deps([
      { kind: 'ok', articles: [article('https://www.ndtv.com/india-news/six-killed-40-injured-after-bus-hits-tree-in-chhattisgarh-123', 'Six killed, 40 injured after bus hits tree in Chhattisgarh')] },
    ], [{ report: report({ id: 'gone' }), round: 1, at: AT }, { report: report(), round: 2, at: AT }], {
      crossChecksToday: async () => 100,
      current: async id => (id === 'gone' ? null : report()),
    })
    const stats = await runSecondOutlets(d)
    expect(stats.skipped).toBe(1)
    expect(calls.added).toEqual([{ id: 'sig-1', sites: ['ndtv.com'], crossCheck: false }])
    expect(stats.crosschecked).toBe(0)
  })

  it('does nothing while paused or while another pass runs', async () => {
    const paused = deps([], [{ report: report(), round: 1, at: AT }], { paused: async () => true })
    expect((await runSecondOutlets(paused.d)).requests).toBe(0)
    const locked = deps([], [{ report: report(), round: 1, at: AT }], { lock: async () => false })
    expect((await runSecondOutlets(locked.d)).requests).toBe(0)
  })
})
