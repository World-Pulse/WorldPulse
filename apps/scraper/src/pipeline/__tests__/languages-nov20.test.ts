/**
 * Hausa (Nov 20, 2026; Devon, Nov 19, 8:37 PM: "cover languages where readers are"): about 94 million speakers in Nigeria,
 * Niger and beyond, read from three outlets. Place names, the dead and injured and the kind of event, the hooked letters
 * in story matching, and the round's feed upkeep (Chiba Nippo out, ABC read once).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

const { rateSeverity } = await import('../severity')
const { foreignCasualties } = await import('../severity-languages')
const { foldAccents, storyWords } = await import('../correlate')
const { withLocalNames } = await import('../local-names')
const { NEWS_SOURCE_REGISTRY, parseNewsSitemap, sitemapDay } = await import('../../sources/news-rss')

describe('Hausa place names', () => {
  it("reads the names that differ from English, with or without the linker", () => {
    expect(withLocalNames('Shugaban Najeriya ya isa Legas', 'ha')).toBe('Shugaban Nigeria ya isa Lagos')
    expect(withLocalNames("Gwamnatin Nijeriya da 'yan Nijar", 'ha')).toBe("Gwamnatin Nigeria da 'yan Niger")
    expect(withLocalNames('Najeriyar ta yi magana', 'ha')).toBe('Nigeria ta yi magana')
    expect(withLocalNames("Amurka da Isra'ila sun kai hari Iraƙi", 'ha')).toBe('United States da Israel sun kai hari Iraq')
    expect(withLocalNames('Rasha da Sin', 'ha')).toBe('Russia da China')
    expect(withLocalNames('Afirka ta Kudu da Koriya ta Arewa', 'ha')).toBe('South Africa da North Korea')
  })

  it('leaves Nigeria\'s own state names as they are, and blanks out "mali" (wealth)', () => {
    expect(withLocalNames('Gobara a kasuwar Kano da Kaduna', 'ha')).toBe('Gobara a kasuwar Kano da Kaduna')
    expect(withLocalNames('An sace mali mai yawa a Mali', 'ha')).toBe('An sace … mai yawa a Mali')
    // "sin" in lower case is no country
    expect(withLocalNames('Sin ta ce', 'ha')).toBe('China ta ce')
  })
})

describe('Hausa severity', () => {
  it('counts the dead and injured, the count after the people', () => {
    expect(foreignCasualties("'Yan bindiga sun kashe mutane 15 a jihar Zamfara", 'ha')?.dead).toBe(15)
    expect(foreignCasualties('Mutum 5 sun mutu a hatsarin mota, mutum 7 sun jikkata', 'ha')).toMatchObject({ dead: 5, injured: 7 })
    expect(foreignCasualties('An kashe aƙalla mutum 10 a harin Borno', 'ha')?.dead).toBe(10)
    expect(foreignCasualties('Ambaliya ta yi sanadin mutuwar mutum 23 a Neja', 'ha')?.dead).toBe(23)
    expect(foreignCasualties('An jikkata mutane 12 a zanga-zanga', 'ha')?.injured).toBe(12)
    expect(foreignCasualties('Mutum biyar ne suka rasu', 'ha')?.dead).toBe(5)
  })

  it("doesn't count those who killed, or money spent", () => {
    expect(foreignCasualties("'Yan bindiga 30 sun kashe sarki", 'ha')?.dead ?? 0).toBe(0)
    expect(foreignCasualties('An kashe naira biliyan 10 a aikin hanya', 'ha')?.dead ?? 0).toBe(0)
  })

  it('rates serious news above low, everyday news low', () => {
    expect(rateSeverity('Harin bam ya tashi a Maiduguri', null, 'other', 'ha')).toBe('high')
    expect(rateSeverity('Juyin mulki a Nijar', null, 'politics', 'ha')).toBe('high')
    expect(rateSeverity("'Yan bindiga sun sace mutane a Katsina", null, 'other', 'ha')).not.toBe('low')
    expect(rateSeverity('Zanga-zanga ta ɓarke a Kano', null, 'politics', 'ha')).toBe('medium')
    expect(rateSeverity('Gobara ta tashi a kasuwar Kano', null, 'other', 'ha')).toBe('medium')
    expect(rateSeverity('Sarkin Kano ya yaba wa gwamnatin tarayya', null, 'politics', 'ha')).toBe('low')
  })
})

describe('Hausa in story matching', () => {
  it('folds the hooked letters, so words keep their first letters and both spellings meet', () => {
    expect(foldAccents('Ƙasar Ɗan Ɓarawo Ƴan')).toBe('kasar dan barawo yan')
    const hooked = storyWords('Ƙasar Nijar ta ɗauki matakin rufe iyakoki')
    const plain = storyWords('Kasar Nijar ta dauki matakin rufe iyakoki')
    expect([...hooked].sort()).toEqual([...plain].sort())
    expect(hooked.has('asar')).toBe(false)
  })

  it('leaves out its small words', () => {
    const words = storyWords('Gwamnati za ta kafa kwamiti domin bincike kan rikicin cikin jam’iyya')
    for (const small of ['domin', 'cikin']) expect(words.has(small)).toBe(false)
  })
})

describe("the round's feeds", () => {
  it('reads Hausa from three or more outlets, each at its own address', () => {
    const hausa = NEWS_SOURCE_REGISTRY.filter(s => s.language === 'ha')
    expect(hausa.length).toBeGreaterThanOrEqual(3)
    for (const s of hausa) expect(NEWS_SOURCE_REGISTRY.filter(o => o.feedUrl === s.feedUrl).length, s.id).toBe(1)
  })

  it('marks state media and keeps their reliability below 0.6', () => {
    for (const id of ['trt-afrika-hausa']) {
      const src = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(src?.biasLabel, id).toBe('state-media')
      expect(src!.reliability, id).toBeLessThan(0.6)
    }
  })

  it("leaves out France Médias Monde's feeds, whose terms reserve text and data mining", () => {
    expect(NEWS_SOURCE_REGISTRY.filter(s => /rfi\.fr\//.test(s.feedUrl))).toEqual([])
  })

  it('reads Pakistan and Bangladesh from more outlets, each at its own address', () => {
    for (const id of ['aaj-news', 'geo-news', 'ary-news', 'the-news-pk', 'pakistan-observer', 'daily-star-bd']) {
      const entries = NEWS_SOURCE_REGISTRY.filter(s => s.id === id)
      expect(entries.length, id).toBe(1)
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl === entries[0]!.feedUrl).length, id).toBe(1)
    }
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'PK').length).toBeGreaterThanOrEqual(12)
  })

  it("dates a news sitemap's day without a time: today's as now, an earlier day's at noon UTC", () => {
    const now = Date.parse('2026-11-20T13:20:00Z')
    expect(sitemapDay('2026-11-20', now)).toBe('2026-11-20T13:20:00.000Z')
    // Pakistan is 5 hours ahead: its next day while it is still today in UTC
    expect(sitemapDay('2026-11-21', now)).toBe('2026-11-20T13:20:00.000Z')
    expect(sitemapDay('2026-11-19', now)).toBe('2026-11-19T12:00:00.000Z')
    expect(sitemapDay('2026-11-20T18:20:02+05:00', now)).toBe('2026-11-20T18:20:02+05:00')
    const xml = '<urlset><url><loc>https://www.geo.tv/latest/1-a</loc><news:news><news:publication_date>2026-11-20</news:publication_date>' +
      '<news:title>Floods in Sindh</news:title></news:news></url></urlset>'
    expect(parseNewsSitemap(xml, now)[0]?.pubDate).toBe('2026-11-20T13:20:00.000Z')
  })

  it("reads ABC's list once, at its current address, and leaves Chiba Nippo's digest out", () => {
    const abc = NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes('abc.net.au'))
    expect(abc.map(s => s.id)).toEqual(['abc-au-world'])
    expect(abc[0]!.feedUrl).toBe('https://www.abc.net.au/news/feed/10719976/rss.xml')
    expect(NEWS_SOURCE_REGISTRY.find(s => s.id === 'chiba-nippo')).toBeUndefined()
  })
})
