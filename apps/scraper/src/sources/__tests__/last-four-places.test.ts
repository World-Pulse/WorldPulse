/**
 * The last four places without an outlet (Oct 31, 2026, Q9). Devon: "Let's close the gap and try
 * to find signals for Brunei, Greenland, Liechtenstein and Nauru". Brunei, Greenland and (Devon,
 * 1:40 PM: "Do it without the key") Liechtenstein are read through their governments' press
 * offices; Nauru through Islands Business's Naoero tag, and its new name, Naoero, now names it.
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, parseFeedItems, dateFromLink, inferGeo } from '../news-rss'
import { mentionedCountries } from '../../pipeline/geo'

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!

describe('the last four places', () => {
  it('gives Brunei, Greenland and Liechtenstein an outlet at home, as state media', () => {
    for (const [id, code, language] of [['pmo-brunei', 'BN', 'en'], ['naalakkersuisut-gl', 'GL', 'da'], ['regierung-li', 'LI', 'de']]) {
      expect(src(id)?.countryCode, id).toBe(code)
      expect(src(id).language, id).toBe(language)
      expect(src(id).biasLabel, id).toBe('state-media')
      expect(HOME_PIN_SOURCES.has(id), id).toBe(true)
    }
  })

  it("gives Nauru a regional newsroom's feed for it, at home (Devon, 1:40 PM: \"is there anything for Nauru at all?\")", () => {
    expect(src('islands-business-nauru')).toMatchObject({ countryCode: 'NR', language: 'en', feedUrl: 'https://islandsbusiness.com/tag/naoero/feed/' })
    expect(HOME_PIN_SOURCES.has('islands-business-nauru')).toBe(true)
    // every place on the map now has an outlet of its own
    for (const code of ['BN', 'GL', 'LI', 'NR']) expect(NEWS_SOURCE_REGISTRY.some(s => s.countryCode === code), code).toBe(true)
  })

  it("pins their stories at home, or where they name", () => {
    expect(inferGeo('His Majesty presents, receives Letters of Credence', '', src('pmo-brunei')).countryCode).toBe('BN')
    // a visit received at home stays at home (Nov 5, 2026: Oman's state visit sat in Muscat); a trip abroad goes where it names
    expect(inferGeo('Crown Prince receives Singapore minister', '', src('pmo-brunei')).countryCode).toBe('BN')
    expect(inferGeo('Crown Prince attends ASEAN meeting in Singapore', '', src('pmo-brunei')).countryCode).toBe('SG')
    expect(inferGeo('Jens-Frederik Nielsen: Med den nye lufthavn bygger vi landet', '', src('naalakkersuisut-gl'))).toMatchObject({ countryCode: 'GL', locationName: 'Nuuk, Greenland' })
    expect(inferGeo('Pressemeddelelse vedrørende indsættelse af vinter backup-helikopterkapacitet i Tasiilaq-distriktet', '', src('naalakkersuisut-gl'))).toMatchObject({ countryCode: 'GL', locationName: 'Tasiilaq' })
    expect(inferGeo('Richtig Heizen mit Holz', 'Fürstentum Liechtenstein: Vaduz (ots) - Die Tage werden kürzer', src('regierung-li')).countryCode).toBe('LI')
    expect(inferGeo('Schweizer Identitätskarten: Neue Erfassungsstelle in Sargans', '', src('regierung-li')).countryCode).toBe('CH')
    expect(inferGeo('Life expectancy in the Pacific, and the case of Naoero', '', src('islands-business-nauru')).countryCode).toBe('NR')
  })

  it("names Liechtenstein in German too", () => {
    expect(mentionedCountries('Historischer Staatsbesuch Liechtensteins in Indien')).toContain('LI')
    expect(mentionedCountries('Die liechtensteinische Regierung tagt')).toEqual(['LI'])
    expect(mentionedCountries('Liechtensteiners vote on casinos')).toEqual(['LI'])
  })

  it('names Nauru by its new name and its people', () => {
    expect(mentionedCountries('Naoero signs new policing deal')).toEqual(['NR'])
    expect(mentionedCountries('Republic of Naoero opens its first embassy')).toEqual(['NR'])
    expect(mentionedCountries('The dei-Naoero vote on a new constitution')).toEqual(['NR'])
    expect(mentionedCountries('Nauruan president meets Australian PM')).toEqual(['NR', 'AU'])
    expect(mentionedCountries('Nauru phosphate exports fall')).toEqual(['NR'])
  })
})

describe('dateFromLink', () => {
  const now = Date.UTC(2026, 9, 31, 17)

  it("reads the day from a link that carries one", () => {
    expect(dateFromLink('https://naalakkersuisut.gl/Nyheder/2026/10/3010_styrelseschef?sc_lang=da', now)).toBe('2026-10-30T12:00:00.000Z')
    expect(dateFromLink('https://example.com/2026/10/29/a-story/', now)).toBe('2026-10-29T12:00:00.000Z')
  })

  it('is never later than now', () => {
    expect(dateFromLink('https://example.com/2026/10/31/a-story/', Date.UTC(2026, 9, 31, 6))).toBe('2026-10-31T06:00:00.000Z')
  })

  it("gives nothing for a link without a real date", () => {
    expect(dateFromLink('https://example.com/news/story-12345', now)).toBe('')
    expect(dateFromLink('https://example.com/2026/02/30/not-a-day/', now)).toBe('')
    expect(dateFromLink('https://naalakkersuisut.gl/Nyheder/2026/10/3009_month-does-not-match', now)).toBe('')
    expect(dateFromLink('', now)).toBe('')
  })

  it("dates the Greenland government's undated items, and leaves a feed's own dates alone", () => {
    const xml = '<?xml version="1.0" encoding="utf-8"?><rss xmlns:a10="http://www.w3.org/2005/Atom" version="2.0"><channel><title>Naalakkersuisut.gl</title>'
      + '<item><link>https://naalakkersuisut.gl/Nyheder/2026/10/3010_styrelseschef?sc_lang=da</link><title>Ny styrelseschef ansat i Socialstyrelsen</title><description /></item>'
      + '<item><link>https://naalakkersuisut.gl/Nyheder/2026/10/2910_ilulissat?sc_lang=da</link><title>Jens-Frederik Nielsen: Med den nye lufthavn bygger vi landet</title><description /></item>'
      + '<item><link>https://example.com/2026/10/01/dated/</link><title>Dated</title><pubDate>Thu, 29 Oct 2026 06:43:50 +0000</pubDate></item>'
      + '</channel></rss>'
    const items = parseFeedItems(xml)
    expect(items.map(i => i.pubDate)).toEqual(['2026-10-30T12:00:00.000Z', '2026-10-29T12:00:00.000Z', 'Thu, 29 Oct 2026 06:43:50 +0000'])
    expect(items[0]).toMatchObject({ title: 'Ny styrelseschef ansat i Socialstyrelsen', description: '' })
  })
})
