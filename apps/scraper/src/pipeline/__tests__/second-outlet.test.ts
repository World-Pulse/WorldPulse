/**
 * The second outlet (plan 0s3, Oct 22, 2026): other outlets' reports of a
 * story only one outlet carried, found in GDELT's list of the articles it read.
 */

import { describe, it, expect, vi } from 'vitest'
import zlib from 'node:zlib'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

import { readArticles, filesToRead, newestStamp, unzipFirst, stampOf, type GdeltArticle } from '../gdelt-articles'
import {
  storyTokens, candidatePairs, siteOf, ownerOf, nearCopy, otherOutlets, searchable, runSecondOutlets, newState,
  MAX_ADDED, FEATURE_RE, type HeldReport, type SecondOutletDeps, type CycleStats,
} from '../second-outlet'

const AT = new Date('2026-10-22T10:00:00Z')
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

const article = (url: string, title: string, at = new Date(AT.getTime() + 2 * 3_600_000)): GdeltArticle =>
  ({ url, title, site: siteOf(new URL(url).hostname), at })

/** A GKG 2.1 line: 27 tab-separated fields, the ones read filled */
const gkgLine = (date: string, url: string, title: string, collection = '1') => {
  const f = Array.from({ length: 27 }, () => '')
  f[0] = `${date}-1`; f[1] = date; f[2] = collection; f[3] = new URL(url).hostname; f[4] = url
  f[26] = `<PAGE_LINKS></PAGE_LINKS><PAGE_TITLE>${title}</PAGE_TITLE>`
  return f.join('\t')
}

/** A one-file zip, as GDELT makes them */
function zipOf(name: string, content: string): Buffer {
  const data = zlib.deflateRawSync(Buffer.from(content))
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8)
  h.writeUInt32LE(data.length, 18); h.writeUInt32LE(Buffer.byteLength(content), 22); h.writeUInt16LE(name.length, 26)
  return Buffer.concat([h, Buffer.from(name), data])
}

describe("GDELT's list of articles", () => {
  it('reads the newest file and the files to read after a gap or a restart', () => {
    expect(newestStamp('7379290 76851a http://data.gdeltproject.org/gdeltv2/20261022180000.gkg.csv.zip\n')).toBe('20261022180000')
    expect(filesToRead('20261022180000', null, 4)).toEqual(['20261022171500', '20261022173000', '20261022174500', '20261022180000'])
    expect(filesToRead('20261022180000', '20261022173000', 8)).toEqual(['20261022174500', '20261022180000'])
    expect(filesToRead('20261022180000', '20261022180000', 8)).toEqual([])
    expect(filesToRead('20261022180000', '20261021000000', 3)).toEqual(['20261022173000', '20261022174500', '20261022180000'])
    expect(stampOf(new Date('2026-10-22T18:07:31Z'))).toBe('20261022180000')
  })

  it('reads web articles with their titles, without the outlet name, each once', async () => {
    const text = [
      gkgLine('20261022121500', 'https://www.ndtv.com/india-news/bus-123', 'Six killed, 40 injured after bus hits tree in Chhattisgarh - NDTV'),
      gkgLine('20261022121500', 'https://www.ndtv.com/india-news/bus-123', 'Six killed, 40 injured after bus hits tree in Chhattisgarh - NDTV'),
      gkgLine('20261022121500', 'https://example.org/broadcast', 'A TV transcript', '2'),
      gkgLine('20261022121500', 'https://en.protothema.gr/x', 'Athens explosion: police trace bag &amp; drugs'),
      '',
    ].join('\n')
    const articles = readArticles((await unzipFirst(zipOf('20261022121500.gkg.csv', text))).toString('utf8'))
    expect(articles.map(a => [a.site, a.title])).toEqual([
      ['ndtv.com', 'Six killed, 40 injured after bus hits tree in Chhattisgarh'],
      ['protothema.gr', 'Athens explosion: police trace bag & drugs'],
    ])
    expect(articles[0]!.at.toISOString()).toBe('2026-10-22T12:15:00.000Z')
  })
})

describe('which articles are other outlets', () => {
  it("counts one owner's websites as one", () => {
    expect(siteOf('en.protothema.gr')).toBe('protothema.gr')
    expect(siteOf('news.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteOf('abc.net.au')).toBe('abc.net.au')
    expect(siteOf('frontline.thehindu.com')).toBe('thehindu.com')
    expect(ownerOf('bbc.com')).toBe(ownerOf('bbc.co.uk'))
    expect(ownerOf('thespec.com')).toBe(ownerOf('niagarafallsreview.ca'))
    expect(ownerOf('cbc.ca')).toBe('cbc.ca')
  })

  it('pairs a report with the articles that share two of its words, not only words of a kind of event', () => {
    const reports = [{ tokens: storyTokens('Six dead, 40 injured as bus hits tree in Chhattisgarh') }, { tokens: storyTokens('Police say two killed') }]
    const articles = [
      { tokens: storyTokens('Chhattisgarh bus accident: six killed') },
      { tokens: storyTokens('Two killed, police say, in Lagos') },
      { tokens: storyTokens('Bus fares rise in Delhi') },
    ]
    expect([...candidatePairs(reports, articles)]).toEqual([[0, [0]]])
  })

  it("takes another newsroom's report of the same story", () => {
    const found = otherOutlets(report(), [
      article('https://www.ndtv.com/india-news/six-killed-40-injured-after-bus-hits-tree-in-chhattisgarh-123', 'Six killed, 40 injured after bus rams tree in Chhattisgarh'),
    ], LATER)
    expect(found.map(f => f.site)).toEqual(['ndtv.com'])
  })

  it('leaves out the same owner, aggregators, other stories, copies, features and articles a day away', () => {
    const found = otherOutlets(report(), [
      article('https://frontline.thehindu.com/news/bus-crash-chhattisgarh-six-killed', 'Six killed, 40 injured as bus crashes into tree in Chhattisgarh'),
      article('https://www.msn.com/en-in/news/india/six-killed/ar-1', 'Six killed, 40 injured after bus rams tree in Chhattisgarh'),
      article('https://allafrica.com/stories/1.html', 'India: Six dead, 40 injured after bus rams tree in Chhattisgarh'),
      article('https://www.ndtv.com/india-news/odisha-123', 'Six killed, 40 injured after bus rams tree in Odisha'),
      article('https://www.tribuneindia.com/news/bus-hits-tree-six-dead', 'Six dead, 40 injured as bus hits tree in Chhattisgarh'),
      article('https://www.deccanherald.com/india/bus', 'India: Six dead, 40 injured as a bus hits a tree in Chhattisgarh'),
      article('https://www.news18.com/explainers/bus', 'Explainer: why buses keep hitting trees in Chhattisgarh after six dead, 40 injured'),
      article('https://indianexpress.com/article/six-killed-bus-chhattisgarh', 'Six killed, 40 injured after bus rams tree in Chhattisgarh', new Date(AT.getTime() + 30 * 3_600_000)),
    ], new Date(AT.getTime() + 31 * 3_600_000))
    expect(found).toEqual([])
  })

  it('counts one wire story on several papers once, and at most three outlets', () => {
    const wire = 'Six killed, 40 injured after bus rams tree in Chhattisgarh'
    const found = otherOutlets(report(), [
      article('https://www.ndtv.com/a/six-killed-chhattisgarh-1', wire),
      article('https://www.deccanherald.com/b/six-killed-chhattisgarh-2', `${wire}, police say`),
      article('https://www.hindustantimes.com/c/chhattisgarh-bus-accident', 'Chhattisgarh bus accident: six killed, 40 injured as bus hits tree'),
      article('https://www.news18.com/d/chhattisgarh-bus-crash', 'Bus hits tree in Chhattisgarh near Raipur, six killed and 40 hurt'),
      article('https://www.timesnownews.com/e/chhattisgarh-bus', 'Chhattisgarh: six die, 40 hurt as speeding bus rams into tree'),
    ], LATER)
    expect(found.map(f => f.site)).toEqual(['ndtv.com', 'hindustantimes.com', 'news18.com'])
    expect(found).toHaveLength(MAX_ADDED)
  })

  it('reads a near copy as a copy, and a feature as no report', () => {
    expect(nearCopy('Nigeria: Kaduna Journalist Granted Bail After Court Sets Aside Conviction', 'Kaduna journalist granted bail after court sets aside conviction')).toBe(true)
    expect(nearCopy('Some referendum questions flip to "no" as the count continues in Alberta', 'Some Alberta referendum questions flip to ‘no’ as count continues')).toBe(true)
    expect(nearCopy('Minister giving Stelco owner 15 days to reverse layoffs before turning to the courts', 'Stelco has 15 days to undo layoffs or it could end up in court, industry minister warns')).toBe(false)
    expect(FEATURE_RE.test('Factbox-Who are the Americans detained in Russia?')).toBe(true)
    expect(FEATURE_RE.test('American detained in Russia arrives in U.S.')).toBe(false)
  })

  it('searches news, not machine feeds or template headlines', () => {
    expect(searchable(report())).toBe(true)
    expect(searchable(report({ title: 'Aircraft DAL1063 squawking 7500 — Unlawful interference (hijacking) (United States)', tags: ['osint', 'adsb', 'aviation'] }))).toBe(false)
    expect(searchable(report({ title: '14 killed, 7 injured after gold mine collapse in Colombia', tags: ['osint', 'gdelt', 'cameo-19'] }))).toBe(true)
    expect(searchable(report({ title: 'Armed conflict in Washington, District of Columbia, United States', tags: ['osint', 'gdelt'] }))).toBe(false)
  })
})

describe('a cycle', () => {
  const ndtv = article('https://www.ndtv.com/india-news/six-killed-40-injured-after-bus-hits-tree-in-chhattisgarh-123', 'Six killed, 40 injured after bus rams tree in Chhattisgarh')
  const other = article('https://www.example-news.com/a', 'Peso closes at record low for fourth day')

  const deps = (files: Record<string, GdeltArticle[]>, reports: HeldReport[], over: Partial<SecondOutletDeps> = {}) => {
    const calls = { fetched: [] as string[], added: [] as Array<{ id: string; sites: string[]; crossCheck: boolean }>, counted: [] as CycleStats[], remembered: 0 }
    const d: SecondOutletDeps = {
      newestStamp: async () => Object.keys(files).sort().pop() ?? null,
      fetchArticles: async stamp => { calls.fetched.push(stamp); return files[stamp] ?? null },
      waiting: async () => reports,
      add: async (r, found, crossCheck) => { calls.added.push({ id: r.id, sites: found.map(f => f.site), crossCheck }); return true },
      crossChecksToday: async () => 0,
      lock: async () => true,
      unlock: async () => {},
      count: async (_day, stats) => { calls.counted.push({ ...stats }) },
      remember: async () => { calls.remembered++ },
      clock: () => LATER.getTime(),
      ...over,
    }
    return { d, calls }
  }

  it('reads the last hour after a restart, compares every report, adds what it finds and keeps count', async () => {
    const state = newState()
    const { d, calls } = deps({ '20261022114500': [other], '20261022120000': [ndtv], '20261022121500': [], '20261022123000': [] }, [report(), report({ id: 'sig-2', title: 'Melioidosis kills 45 in four northeastern provinces' })])
    const stats = await runSecondOutlets(state, d)
    expect(calls.fetched).toEqual(['20261022114500', '20261022120000', '20261022121500', '20261022123000'])
    expect(calls.added).toEqual([{ id: 'sig-1', sites: ['ndtv.com'], crossCheck: true }])
    expect(stats).toMatchObject({ files: 4, articles: 2, reports: 2, matched: 1, outlets: 1, promoted: 1, crosschecked: 1, errors: 0 })
    expect(calls.remembered).toBe(1)
  })

  it('compares a report only with the articles new since it was last compared', async () => {
    const state = newState()
    const files: Record<string, GdeltArticle[]> = { '20261022120000': [ndtv] }
    const first = deps(files, [report()], { add: async () => false })
    await runSecondOutlets(state, first.d)
    files['20261022121500'] = [other]
    const second = deps(files, [report()])
    const stats = await runSecondOutlets(state, second.d)
    expect(second.calls.fetched).toEqual(['20261022121500'])
    expect(stats.pairs).toBe(0)                 // the NDTV article was compared the first time
    expect(second.calls.added).toEqual([])
  })

  it('leaves the cross-check out past its daily share', async () => {
    const { d, calls } = deps({ '20261022120000': [ndtv] }, [report()], { crossChecksToday: async () => 100 })
    const stats = await runSecondOutlets(newState(), d)
    expect(calls.added).toEqual([{ id: 'sig-1', sites: ['ndtv.com'], crossCheck: false }])
    expect(stats.crosschecked).toBe(0)
  })

  it('keeps going when a file is unreadable, and does nothing while another cycle runs', async () => {
    const broken = deps({ '20261022120000': [ndtv] }, [report()], { fetchArticles: async () => { throw new Error('HTTP 503') } })
    const stats = await runSecondOutlets(newState(), broken.d)
    expect(stats.errors).toBe(4)
    expect(stats.files).toBe(0)
    const locked = deps({ '20261022120000': [ndtv] }, [report()], { lock: async () => false })
    expect((await runSecondOutlets(newState(), locked.d)).files).toBe(0)
    expect(locked.calls.fetched).toEqual([])
  })
})
