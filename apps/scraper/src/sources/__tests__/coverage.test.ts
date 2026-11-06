/**
 * The Dev Room's coverage map keeps itself current (Devon, Nov 6, 2026: "Update the coverage map
 * automatically when these updates happen"): the news poller writes each place's feeds to
 * news-rss:coverage, /ops-status.json carries them, and HQ's hourly sync draws the Coverage tab.
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY } from '../news-rss'
import { COUNTED_PLACES, COVERAGE_KEY, coverageOf, languageName, noteCoverage, outletName, territoryName } from '../coverage'

const feed = (name: string, countryCode: string, language = 'en', parked?: string) => ({ name, countryCode, language, parked })

describe('the places the map counts', () => {
  it('are the 202: the UN members and observers, and Kosovo, Taiwan, Hong Kong, Macau, Puerto Rico, Greenland, New Caledonia', () => {
    expect(Object.keys(COUNTED_PLACES)).toHaveLength(202)
    for (const code of ['PS', 'VA', 'XK', 'TW', 'HK', 'MO', 'PR', 'GL', 'NC', 'US', 'FJ', 'ZW']) expect(COUNTED_PLACES[code]).toBeTruthy()
    for (const code of ['BM', 'KY', 'GU', 'EH', 'FK', 'TF']) expect(COUNTED_PLACES[code]).toBeUndefined()
    expect(COUNTED_PLACES.CD).toBe('DR Congo')
    expect(COUNTED_PLACES.CG).toBe('Republic of the Congo')
    expect(COUNTED_PLACES.KN).toBe('Saint Kitts and Nevis')
  })

  it('territories are named the same way', () => {
    expect(territoryName('BM')).toBe('Bermuda')
    expect(territoryName('TC')).toBe('Turks and Caicos Islands')
    expect(territoryName('PM')).toBe('Saint Pierre and Miquelon')
    expect(territoryName('ZZ')).toBe('ZZ')
  })
})

describe('outlet and language names', () => {
  it('a feed is named for its outlet', () => {
    expect(outletName('Sydney Morning Herald — World')).toBe('Sydney Morning Herald')
    expect(outletName('RTSH (Albania)')).toBe('RTSH')
    expect(outletName('Euronews Albania (English)')).toBe('Euronews Albania')
    expect(outletName('Al-Monitor')).toBe('Al-Monitor')
  })

  it('languages by their English names', () => {
    expect(languageName('sq')).toBe('Albanian')
    expect(languageName('lt')).toBe('Lithuanian')
    expect(languageName('en')).toBe('English')
  })
})

describe('coverageOf', () => {
  it('counts every feed once, for its home place, with languages and outlets', () => {
    const c = coverageOf([
      feed('Tirana Times', 'AL'), feed('RTSH (Albania)', 'AL', 'sq'), feed('Balkanweb (Albania)', 'al', 'sq'),
      feed('Euronews Albania (English)', 'AL'), feed('Bernews', 'BM'), feed('North Press', 'SY', 'en', 'HTTP 403'),
      feed('No home', ''),
    ], new Date('2026-11-06T16:00:00Z'))
    expect(c.at).toBe('2026-11-06T16:00:00.000Z')
    expect(c.feeds).toBe(6)
    expect(c.english).toBe(4)
    expect(c.parked).toBe(1)
    expect(c.languages).toEqual(['English', 'Albanian'])
    const by = Object.fromEntries(c.places.map(p => [p.c, p]))
    expect(by.AL).toEqual({ c: 'AL', n: 'Albania', f: 4, en: 2, l: ['English', 'Albanian'], o: ['Euronews Albania', 'Tirana Times', 'Balkanweb', 'RTSH'] })
    expect(by.BM).toMatchObject({ n: 'Bermuda', f: 1, t: true })
    expect(by.SY).toMatchObject({ f: 1, p: 1 })
    expect(by.FR).toEqual({ c: 'FR', n: 'France', f: 0, en: 0, l: [], o: [] })   // a counted place with no feed
    expect(c.places).toHaveLength(203)
    expect(c.places.map(p => p.c)).toEqual([...c.places.map(p => p.c)].sort())
  })

  it('languages: the most feeds first, English first on a tie', () => {
    const c = coverageOf([feed('A', 'AR', 'es'), feed('B', 'AR', 'es'), feed('C', 'AR'), feed('D', 'CA', 'fr'), feed('E', 'CA')])
    const by = Object.fromEntries(c.places.map(p => [p.c, p]))
    expect(by.AR.l).toEqual(['Spanish', 'English'])
    expect(by.CA.l).toEqual(['English', 'French'])
  })

  it("on today's feed list: every feed counted, every counted place listed, the territories flagged", () => {
    const c = coverageOf(NEWS_SOURCE_REGISTRY)
    expect(c.feeds).toBe(NEWS_SOURCE_REGISTRY.length)
    expect(c.english).toBe(NEWS_SOURCE_REGISTRY.filter(s => s.language === 'en').length)
    expect(c.parked).toBe(NEWS_SOURCE_REGISTRY.filter(s => s.parked).length)
    for (const code of Object.keys(COUNTED_PLACES)) expect(c.places.some(p => p.c === code)).toBe(true)
    for (const p of c.places) {
      expect(Boolean(p.t)).toBe(!(p.c in COUNTED_PLACES))
      expect(p.o.length).toBeLessThanOrEqual(p.f)
      expect(p.n.length).toBeGreaterThan(1)
    }
    expect(c.places.filter(p => p.t).map(p => p.c)).toEqual(expect.arrayContaining(['BM', 'GU']))
    // it fits the status file comfortably
    expect(JSON.stringify(c).length).toBeLessThan(60_000)
  })
})

describe('noteCoverage', () => {
  it('writes the numbers for the status file', async () => {
    const store = new Map<string, string>()
    const redis = { set: async (k: string, v: string) => { store.set(k, v); return 'OK' as const } }
    const n = await noteCoverage(redis as never, [feed('Tirana Times', 'AL'), feed('Bernews', 'BM')])
    expect(n).toBe(2)
    const saved = JSON.parse(store.get(COVERAGE_KEY) ?? '{}')
    expect(saved.feeds).toBe(2)
    expect(saved.places.find((p: { c: string }) => p.c === 'AL').o).toEqual(['Tirana Times'])
  })

  it("doesn't throw when Redis refuses", async () => {
    const redis = { set: async () => { throw new Error('down') } }
    await expect(noteCoverage(redis as never, [feed('A', 'AL')])).resolves.toBe(0)
  })
})
