/**
 * Second newsrooms for the quiet places (Nov 10, 2026; Devon, 11:03 AM: "look for a second newsroom in the 8 quiet
 * places, so their stories can get verified?" - "yes"): the places with feeds but no verified report in a week.
 * EmoNews (Dominica) and SBC (Seychelles, in Creole) were found; the other six have no newsroom with a working feed.
 * EmoNews carries the region's news too, so the place-finder learned the Caribbean's territories ("Anguilla",
 * "Martinique", "Bonaire", "T&T"). Headlines from the two feeds on Nov 10.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo, skippedLink, thinPlaces } = await import('../news-rss')

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!
const emo = src('emonews-dm')
const sbc = src('sbc-seychelles')
const at = (title: string, source = emo, description = '') => inferGeo(title, description, source)
const world = src('bbc-world')

describe('EmoNews, Dominica (Nov 10, 2026)', () => {
  it("is Dominica's third feed, read once, with no home pin", () => {
    expect(emo).toMatchObject({ countryCode: 'DM', language: 'en', feedUrl: 'https://emonewsdm.com/feed.xml' })
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes('emonewsdm.com'))).toHaveLength(1)
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'DM').map(s => s.id).sort())
      .toEqual(['dominica-news-online-dm', 'emonews-dm', 'opm-pressroom-dm'])
    expect(HOME_PIN_SOURCES.has(emo.id)).toBe(false)
    // still a thinly covered place, so its outlets' stories are matched over two days (correlate.ts)
    expect(thinPlaces()).toContain('DM')
  })

  it('skips its death announcements and job notices', () => {
    for (const link of [
      'https://emonewsdm.com/story/death-announcement-of-roland-george-better-known-as-mesh-aged-59-of-glanvillia',
      'https://emonewsdm.com/story/vacancy-notice',
      'https://emonewsdm.com/story/vacancy-notice-2',
      'https://emonewsdm.com/story/secret-bay-vacancies',
    ]) expect(skippedLink(emo, link), link).toBe(true)
    for (const link of [
      'https://emonewsdm.com/story/domlec-announces-approval-of-new-electricity-tariff',
      'https://emonewsdm.com/story/dominica-targets-1-million-cruise-passengers-a-year-as-2026-2027-season-opens',
    ]) expect(skippedLink(emo, link), link).toBe(false)
  })

  it("puts Dominica's stories in Dominica and the region's where they name", () => {
    expect(at('Dominica Targets 1 Million Cruise Passengers a Year as 2026/2027 Season Opens').countryCode).toBe('DM')
    expect(at('Status of Dominica’s Citizenship by Investment Programme and Engagement with the European Union').countryCode).toBe('DM')
    expect(at('Barbados steps up fight against climate change with USD 3.5 million investment in agricultural resilience').countryCode).toBe('BB')
    expect(at('Grenada Tourism Authority to Launch Pure Experiences to Showcase Locally Operated Tours and Activities').countryCode).toBe('GD')
    expect(at('Anguilla pursues greater share of luxury yachting market').countryCode).toBe('AI')
    expect(at('Martinique expects 275 cruise calls in 2026-27 season').countryCode).toBe('MQ')
    expect(at('Carnival Corporation highlights stronger Bonaire cruise outlook for 2027').countryCode).toBe('BQ')
    expect(at('Back‑to‑Back Wins for T&T at UWI Reparations  Debate Competition').countryCode).toBe('TT')
    // a headline that names no place gets none (half of them are the region's: the ECCB, the CTO)
    expect(at('DOMLEC Announces Approval of New Electricity Tariff').lat).toBeNull()
    expect(at('CTO launches Caribbean Tourism Month with call for regional unity and local opportunity').lat).toBeNull()
  })
})

describe("the Caribbean's territories, for any outlet (Nov 10, 2026)", () => {
  it('are places of their own', () => {
    expect(at('Aruba election results announced', world).countryCode).toBe('AW')
    expect(at('Curaçao parliament approves budget', world).countryCode).toBe('CW')
    expect(at('Curacao parliament approves budget', world).countryCode).toBe('CW')
    expect(at('St. Maarten prime minister resigns', world).countryCode).toBe('SX')
    expect(at('Guadeloupe hit by power cuts', world).countryCode).toBe('GP')
    expect(at('St Barts airport closed after storm', world).countryCode).toBe('BL')
    expect(at('Cayman Islands financial regulator fines bank', world).countryCode).toBe('KY')
    expect(at('Caymanian lawmakers debate budget', world).countryCode).toBe('KY')
    expect(at('Turks and Caicos premier sworn in', world).countryCode).toBe('TC')
    expect(at('British Virgin Islands governor speaks', world).countryCode).toBe('VG')
    expect(at('Bermuda budget surplus', world).countryCode).toBe('BM')
    expect(at('Anguillians vote in election', world).countryCode).toBe('AI')
  })

  it("aren't France, the Netherlands or the US when their adjective comes first", () => {
    expect(at('French island of Guadeloupe hit by power cuts', world).countryCode).toBe('GP')
    expect(at('Protests on the French island of Martinique over prices', world).countryCode).toBe('MQ')
    expect(at('Dutch island of Aruba braces for storm', world).countryCode).toBe('AW')
    for (const title of ['U.S. Virgin Islands lawmakers meet', 'US Virgin Islands lawmakers meet', 'USVI lawmakers meet',
      'United States Virgin Islands lawmakers meet']) expect(at(title, world).countryCode, title).toBe('VI')
    // the US is still the US
    for (const title of ['U.S. imposes new tariffs', 'US imposes new tariffs', 'United States imposes new tariffs'])
      expect(at(title, world).countryCode, title).toBe('US')
  })

  it('leave out names that are something else', () => {
    expect(at('Aruba Networks launches new switch', world).countryCode).not.toBe('AW')
    expect(at('HPE Aruba unveils campus switches', world).countryCode).not.toBe('AW')
    expect(at('Bermuda Triangle mystery solved, scientist says', world).countryCode).not.toBe('BM')
    expect(at('Blue Curaçao cocktails for summer', world).countryCode).not.toBe('CW')
    expect(at('Porsche Cayman recall announced', world).countryCode).not.toBe('KY')
    expect(at('AT&T earnings beat forecasts', world).countryCode).not.toBe('TT')
    // not Montserrat (also a Catalan name): Montserrat Caballé's tribute is Barcelona's
    expect(at('Montserrat Caballé tribute concert in Barcelona', world).countryCode).toBe('ES')
  })

  it("names Saint Lucia's people too", () => {
    expect(at('Prime Minister Pierre announces new opportunities for Saint Lucians', world).countryCode).toBe('LC')
    expect(at('St Lucian fishermen rescued', world).countryCode).toBe('LC')
  })
})

describe("every feed's language (Nov 10, 2026)", () => {
  it("fits the database's two letters", () => {
    // a report's language is CHAR(2): SBC's stories, filed under Seselwa's three-letter code (crs), weren't stored
    for (const s of NEWS_SOURCE_REGISTRY) expect(s.language, s.id).toMatch(/^[a-z]{2}$/)
  })
})

describe('SBC, Seychelles (Nov 10, 2026)', () => {
  it("is Seychelles' second feed, in Creole (filed as French), pinned at home", () => {
    expect(sbc).toMatchObject({ countryCode: 'SC', language: 'fr', feedUrl: 'https://www.sbc.sc/feed/' })
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes('sbc.sc'))).toHaveLength(1)
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'SC').map(s => s.id).sort()).toEqual(['sbc-seychelles', 'statehouse-seychelles'])
    expect(HOME_PIN_SOURCES.has(sbc.id)).toBe(true)
  })

  it('puts its stories in Seychelles, at the island or village they name', () => {
    expect(at('Minis pour Transpor, Por e Lavyasyon Sivil, Veronique laporte in vizit La Digue.', sbc).locationName).toBe('La Digue')
    expect(at('Lakours 30 kilomet letour Praslin, i en avangou pour ‘Crazy Challenge’ ki pou fer Mahé le 28 Novanm.', sbc).locationName).toBe('Praslin')
    expect(at('Partisipan dan legzibisyon listwar Sesel in resevwar zot pri.', sbc).countryCode).toBe('SC')
    expect(at('Lasanble Nasyonal in aprouv proze-de-lwa pou amann Lalwa Kontrol Taba ki’n la depi 2009.', sbc))
      .toMatchObject({ countryCode: 'SC', locationName: 'Victoria, Seychelles' })
    expect(at('Sesel in anonse ki i pe siport Lana Nusseibeh dan son demars pou vin prosen Sekreter Zeneral Nasyon Zini.', sbc).countryCode).toBe('SC')
  })
})
