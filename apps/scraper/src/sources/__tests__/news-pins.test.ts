/**
 * News pins where the story is (Oct 11, 2026). About 1 in 5 points on the
 * 24-hour map sat at an outlet's office: GDACS's alerts for the Panama
 * earthquakes in Ispra, Italy, ABC Australia's US stories in Sydney,
 * Investing.com's stock trades in Limassol, CNA's Panama coverage in Singapore.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Knex } from 'knex'
import {
  NEWS_SOURCE_REGISTRY, inferGeo, feedPoint, parseFeedItems, repinNewsHomePins, HOME_PIN_SOURCES,
} from '../news-rss'
import { gdacsAlertLevel, gdacsSeverity, gdacsTags, tidyGdacsTitle } from '../gdacs'

const source = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!

describe('inferGeo', () => {
  it("pins a story at the country its headline names, not the outlet's office", () => {
    expect(inferGeo('Traumatised Panamanians begin recovery from 7.7-magnitude earthquake', '', source('channel-news-asia')))
      .toMatchObject({ locationName: 'Panama', countryCode: 'PA', lat: 8.98, lng: -79.52 })
    expect(inferGeo('Major earthquake shakes Panama', '', source('abc-news')).countryCode).toBe('PA')
  })

  it('gives league football and crypto-exchange stories no home pin (Oct 30, 2026)', () => {
    expect(inferGeo('Binance hit by hack, users told to freeze accounts', '', source('rte-news'))).toMatchObject({ lat: null, countryCode: null })
    expect(inferGeo('Everton v Manchester United: Premier League preview', '', source('myjoyonline-gh')).lat).toBeNull()
  })

  it('reads the summary when the headline names no place', () => {
    const geo = inferGeo('Christa Pike released from hospital', 'The Tennessee inmate survived a failed execution', source('abc-au-world'))
    expect(geo).toMatchObject({ locationName: 'Tennessee', countryCode: 'US' })
  })

  it('knows US states, and "US" and "UK" in capitals', () => {
    expect(inferGeo('Eight people from the same family killed in Pennsylvania shooting', '', source('abc-au-world')).locationName).toBe('Pennsylvania')
    expect(inferGeo('US Says It Disabled Cargo Vessel', '', source('abc-news')).countryCode).toBe('US')
    expect(inferGeo('Mexico City braces for Hurricane Simon', '', source('abc-news')).countryCode).toBe('MX')
    expect(inferGeo('Wildfire spreads across New Mexico', '', source('abc-news')).locationName).toBe('New Mexico')
  })

  it("keeps a Ukrainian outlet's 'Russian drones' and front-line stories in Ukraine, not Moscow (Oct 29, 2026)", () => {
    const ip = source('interfax-ukraine-en')
    expect(inferGeo('Air defense downs 97 of 112 Russian drones, strikes recorded at 7 locations – Air Force', '', ip).countryCode).toBe('UA')
    expect(inferGeo('Russian troops advance near 2 villages in Zaporizhia region – DeepState', '', ip).countryCode).toBe('UA')
    expect(inferGeo('Kremlin says talks continue', '', ip).countryCode).toBe('RU')
  })

  it('uses the point the feed gives, named from the headline', () => {
    expect(inferGeo('Orange earthquake in Vanuatu', '', source('gdacs'), { lat: -17.5, lng: 168.1 }))
      .toEqual({ lat: -17.5, lng: 168.1, locationName: 'Vanuatu', countryCode: 'VU' })
  })

  it('reads a hint at the start of a word, but not inside another word (Oct 14, 2026)', () => {
    // a Le Monde reader survey ("... vous amènent-ils à modifier vos projets ?") was pinned on New Delhi: "modifier" read as Modi
    expect(inferGeo('Qu’avez-vous prévu pour les vacances de la Toussaint ?',
      'Le contexte économique et social ou la situation internationale vous amènent-ils à modifier vos projets ? Racontez-nous.', source('le-monde')).lat).toBeNull()
    expect(inferGeo('Parish council approves the new budget', '', source('abc-news')).lat).toBeNull()
    expect(inferGeo('Trumpet player wins award', '', source('abc-news')).lat).toBeNull()
    // the hints still read the words they're meant for
    expect(inferGeo('Modi meets Gulf leaders', '', source('abc-news')).countryCode).toBe('IN')
    expect(inferGeo('Indian army on alert', '', source('abc-news')).countryCode).toBe('IN')
    expect(inferGeo('Parisian police clear a camp', '', source('abc-news')).locationName).toMatch(/Paris/)
  })

  it('only national outlets fall back to their home', () => {
    expect(HOME_PIN_SOURCES.has('punch-nigeria')).toBe(true)
    expect(HOME_PIN_SOURCES.has('gdacs')).toBe(false)
    expect(HOME_PIN_SOURCES.has('investing-com-news')).toBe(false)
    expect(HOME_PIN_SOURCES.has('bdnews24')).toBe(false)
    for (const id of HOME_PIN_SOURCES) expect(NEWS_SOURCE_REGISTRY.some(s => s.id === id)).toBe(true)
    expect(inferGeo('8 emerging markets to consider in 2027: HSBC', '', source('investing-com-news')).lat).toBeNull()
  })
})

describe('feed points', () => {
  it('reads GeoRSS and W3C geo tags', () => {
    expect(feedPoint('<georss:point>8.6 -79.9</georss:point>')).toEqual({ lat: 8.6, lng: -79.9 })
    expect(feedPoint('<geo:Point><geo:lat>-17.7</geo:lat><geo:long>168.3</geo:long></geo:Point>')).toEqual({ lat: -17.7, lng: 168.3 })
    expect(feedPoint('<georss:point>0 0</georss:point>')).toBeNull()
    expect(feedPoint('<geo:lat>95</geo:lat><geo:long>10</geo:long>')).toBeNull()
    expect(feedPoint('<title>No point</title>')).toBeNull()
  })

  it('parses a GDACS item with its point and alert level', () => {
    const [item] = parseFeedItems(`<rss><channel><item>
      <title>Orange earthquake (Magnitude 7.7M, Depth:12.647km) in Panama 09/10/2026 17:56 UTC, 540 thousand (in MMI&gt;=VII).</title>
      <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1</link>
      <pubDate>Fri, 09 Oct 2026 18:20:00 GMT</pubDate>
      <description>An earthquake occurred in Panama.</description>
      <geo:Point><geo:lat>7.62</geo:lat><geo:long>-80.21</geo:long></geo:Point>
      <gdacs:alertlevel>Orange</gdacs:alertlevel>
    </item></channel></rss>`)
    expect(item).toMatchObject({ point: { lat: 7.62, lng: -80.21 }, alertLevel: 'Orange' })
  })
})

describe('GDACS alerts', () => {
  it('rates alerts by their level', () => {
    expect(gdacsAlertLevel('Green flood alert in Slovenia')).toBe('green')
    expect(gdacsAlertLevel('Earthquake in Peru', 'Red')).toBe('red')
    expect(gdacsAlertLevel('Earthquake in Peru')).toBeNull()
    expect(gdacsSeverity('red')).toBe('critical')
    expect(gdacsSeverity('orange')).toBe('high')
    expect(gdacsSeverity('green')).toBe('medium')
  })

  it('writes earthquake alerts as headlines', () => {
    expect(tidyGdacsTitle('Orange earthquake (Magnitude 7.7M, Depth:12.647km) in Panama 09/10/2026 17:56 UTC, 540 thousand (in MMI&gt;=VII).'))
      .toEqual({ title: 'M7.7 earthquake in Panama: 540,000 people exposed to very strong shaking', place: 'Panama' })
    expect(tidyGdacsTitle('Green earthquake (Magnitude 6M, Depth:10km) in Panama 10/10/2026 04:14 UTC, 4 thousand (in MMI>=VII).').title)
      .toBe('M6.0 earthquake in Panama: 4,000 people exposed to very strong shaking')
    expect(tidyGdacsTitle('Green earthquake (Magnitude 5.5M, Depth:52.054km) in Philippines 08/10/2026 08:07 UTC, 80 thousand in MMI V.').title)
      .toBe('M5.5 earthquake in Philippines: 80,000 people exposed to moderate shaking')
    expect(tidyGdacsTitle('Green earthquake (Magnitude 5.9M, Depth:10km) in West Of Macquarie Island 09/10/2026 14:49 UTC, [unknown].'))
      .toEqual({ title: 'M5.9 earthquake in West of Macquarie Island', place: 'West of Macquarie Island' })
    expect(tidyGdacsTitle('Green earthquake (Magnitude 5.5M, Depth:10km) in Panama 09/10/2026 18:22 UTC, Few people affected (in MMI>=VII).').title)
      .toBe('M5.5 earthquake in Panama: few people exposed to very strong shaking')
  })

  it('keeps other alerts as they are', () => {
    expect(tidyGdacsTitle('Green flood alert in Slovenia')).toEqual({ title: 'Green flood alert in Slovenia', place: null })
  })

  it('tags each alert with its own hazard', () => {
    expect(gdacsTags('Green flood alert in Slovenia')).toEqual(['gdacs', 'disaster', 'institutional', 'flood'])
    expect(gdacsTags('Orange earthquake (Magnitude 7.7M…) in Panama')).toContain('earthquake')
    expect(gdacsTags('Orange earthquake (Magnitude 7.7M…) in Panama')).not.toContain('flood')
  })
})

describe('repinNewsHomePins', () => {
  function fakeDb(rows: Array<Record<string, unknown>>) {
    const updates: Array<{ id: unknown; changes: Record<string, unknown> }> = []
    const db = Object.assign(
      (table: string) => ({
        where: (_col: string, id: unknown) => ({
          update: async (changes: Record<string, unknown>) => { updates.push({ id, changes }); return 1 },
        }),
        table,
      }),
      {
        raw: vi.fn((sql: string, bindings?: unknown[]) => (sql.trim().startsWith('SELECT') ? Promise.resolve({ rows }) : { sql, bindings })),
      },
    )
    return { db: db as unknown as Knex, updates }
  }

  it("moves, clears and retitles pins at an outlet's office, and leaves the rest", async () => {
    const { db, updates } = fakeDb([
      { id: 'gdacs-1', title: 'Orange earthquake (Magnitude 7.7M, Depth:12.647km) in Panama 09/10/2026 17:56 UTC, 540 thousand (in MMI&gt;=VII).',
        summary: 'An earthquake. Source: GDACS Alerts (reliability: 93%, bias: center).', tags: ['news', 'rss', 'gdacs'],
        location_name: 'Ispra, Italy', severity: 'high' },
      { id: 'gdacs-2', title: 'Green flood alert in Slovenia', summary: '', tags: ['rss', 'gdacs'], location_name: 'Ispra, Italy', severity: 'high' },
      { id: 'abc-1', title: 'Eight people from the same family killed in Pennsylvania shooting', summary: 'Police in the US said.', tags: ['rss', 'abc-au-world'],
        location_name: 'Sydney, Australia', severity: 'high' },
      { id: 'inv-1', title: '8 emerging markets to consider in 2027: HSBC', summary: '', tags: ['rss', 'investing-com-news'],
        location_name: 'Limassol, Cyprus', severity: 'low' },
      { id: 'punch-1', title: 'Tinubu will deliver more prosperity if re-elected', summary: '', tags: ['rss', 'punch-nigeria'],
        location_name: 'Lagos, Nigeria', severity: 'low' },
      { id: 'bbc-uk', title: 'UK inflation falls', summary: '', tags: ['rss', 'bbc-world'],
        location_name: 'London, United Kingdom', severity: 'low' },
    ])
    const totals = await repinNewsHomePins(db)
    const by = Object.fromEntries(updates.map(u => [u.id, u.changes]))

    expect(by['gdacs-1']).toMatchObject({
      title: 'M7.7 earthquake in Panama: 540,000 people exposed to very strong shaking',
      location_name: 'Panama', country_code: 'PA',
    })
    expect(by['gdacs-1']!.severity).toBeUndefined()   // orange is high already
    expect(by['gdacs-2']).toMatchObject({ severity: 'medium', location_name: 'Slovenia', country_code: 'SI' })
    expect(by['abc-1']).toMatchObject({ location_name: 'Pennsylvania', country_code: 'US' })
    expect(by['inv-1']).toEqual({ location: null, location_name: null, country_code: null })
    expect(by['punch-1']).toBeUndefined()          // a national outlet's story stays home
    expect(by['bbc-uk']).toMatchObject({ location_name: 'United Kingdom', country_code: 'GB' })  // a national story, pinned at London
    expect(totals).toEqual({ moved: 4, cleared: 1, retitled: 1 })
  })
})

describe('isObituary (Oct 11, 2026)', () => {
  it('skips death notices from obituaries sections and Legacy.com', async () => {
    const { isObituary } = await import('../news-rss')
    expect(isObituary({ title: 'Frank J. Mauro', link: 'https://www.dailygazette.com/obituaries/frank-j-mauro/article_21d788cc.html' })).toBe(true)
    expect(isObituary({ title: 'Jane Doe', link: 'https://www.legacy.com/us/obituaries/name/jane-doe' })).toBe(true)
    expect(isObituary({ title: 'Obituary: a pioneer of jazz', link: 'https://example.com/arts/123' })).toBe(true)
    expect(isObituary({ title: 'Ex-president dies at 90', link: 'https://example.com/world/ex-president-dies' })).toBe(false)
  })
})

describe('isShoppingItem (Oct 11, 2026)', () => {
  it("skips Wired's coupon codes, gift guides and product galleries", async () => {
    const { isShoppingItem } = await import('../news-rss')
    expect(isShoppingItem({ title: 'eBay Coupons: 20% Off in October 2026', link: 'https://www.wired.com/story/ebay-coupon-code/' })).toBe(true)
    expect(isShoppingItem({ title: 'LG Promo Codes and Coupons for October 2026', link: 'https://www.wired.com/story/lg-promo-code/' })).toBe(true)
    expect(isShoppingItem({ title: 'Best Lego Gifts for Brick Builders (2026)', link: 'https://www.wired.com/gallery/gifts-for-lego-lovers/' })).toBe(true)
    expect(isShoppingItem({ title: '13 Best Gifts for Every Traveler Should Have (2026)', link: 'https://www.wired.com/story/best-gifts-for-travelers/' })).toBe(true)
  })

  it('keeps news that mentions coupons or gifts', async () => {
    const { isShoppingItem } = await import('../news-rss')
    expect(isShoppingItem({ title: 'Government hands out food coupons to flood victims', link: 'https://example.com/world/food-coupons-floods' })).toBe(false)
    expect(isShoppingItem({ title: 'AI Is Getting Really Good at Messing With Cybercriminals', link: 'https://www.wired.com/story/ai-is-getting-really-good-at-messing-with-cybercriminals/' })).toBe(false)
    expect(isShoppingItem({ title: 'Bond coupon rates climb as yields rise', link: 'https://example.com/markets/bonds' })).toBe(false)
  })
})
