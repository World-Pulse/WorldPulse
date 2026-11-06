/**
 * Second newsrooms and new kinds of feed, Nov 5, 2026, 11:45 PM (Devon, 10:01 PM: "Second newsrooms for the 32
 * places that have only one feed, starting with Lebanon, Syria, Jordan and the Baltics" and "Next signals: US and
 * EU health alerts, US maritime advisories, aviation news, space news, commodities news and research/education
 * publications, once their terms check out"). Each feed was read with the poller's own reader and its terms read
 * first (plan Q15's method). The places with few feeds of their own also get the same-story second look across two
 * days (thinPlaces, correlate.ts setThinPlaces).
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo, thinPlaces, THIN_PLACE_FEEDS } from '../news-rss'

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)
const ADDED = ['north-press-sy', 'ecdc-news', 'nasa-news', 'airlinegeeks', 'farmdoc-daily',
  'the-conversation-africa', 'the-conversation-fr', 'the-conversation-es']
const host = (url: string) => new URL(url).hostname.replace(/^www\./, '')

describe('feeds added Nov 5, 2026, 11:45 PM', () => {
  it('adds them, each once, with its place, language and kind of news', () => {
    for (const id of ADDED) expect(src(id), id).toBeDefined()
    expect(NEWS_SOURCE_REGISTRY.filter(s => ADDED.includes(s.id))).toHaveLength(ADDED.length)
    expect(src('north-press-sy')).toMatchObject({ countryCode: 'SY', language: 'en', category: 'geopolitics' })
    expect(src('ecdc-news')).toMatchObject({ category: 'health', countryCode: 'SE' })
    expect(src('nasa-news')).toMatchObject({ category: 'space', countryCode: 'US' })
    expect(src('airlinegeeks')).toMatchObject({ category: 'economy' })
    expect(src('farmdoc-daily')).toMatchObject({ category: 'economy', countryCode: 'US' })
    expect(src('the-conversation-fr')).toMatchObject({ language: 'fr', category: 'science' })
    expect(src('the-conversation-es')).toMatchObject({ language: 'es', category: 'science' })
    // Syria now has two newsrooms of its own in English (and three in Arabic since Nov 6, ok-to-all-outlets-nov6.test.ts);
    // Levant24 stays out (round 8, Oct 31: it writes up Arabic outlets' reports)
    const syria = NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'SY' && s.language === 'en')
    expect(syria.map(s => s.id).sort()).toEqual(['north-press-sy', 'syria-direct'])
    expect(new Set(syria.map(s => host(s.feedUrl))).size).toBe(2)
  })

  it('leaves out the candidates whose terms or answers failed (departments/research/r5-second-newsrooms-2026-11-05.md)', () => {
    const urls = NEWS_SOURCE_REGISTRY.map(s => s.feedUrl)
    // This is Beirut, 15min, Estonian World and Spaceflight Now waited on Devon's call, and went in on Nov 6, 7:34 AM
    // (held-outlets-nov6.test.ts)
    for (const site of ['lbcgroup.tv', 'syrianobserver.com', 'postimees.ee',
      'aerotime.aero', 'rigzone.com', 'atlanticcouncil.org', 'lowyinstitute.org', 'jordantimes.com', 'levant24.com']) {
      expect(urls.some(u => u.includes(site)), site).toBe(false)
    }
  })

  it("pins at home only the one that is mostly its own country's news", () => {
    expect(HOME_PIN_SOURCES.has('farmdoc-daily')).toBe(true)
    for (const id of ['north-press-sy', 'ecdc-news', 'nasa-news', 'airlinegeeks', 'the-conversation-africa', 'the-conversation-fr', 'the-conversation-es']) {
      expect(HOME_PIN_SOURCES.has(id), id).toBe(false)
    }
    // North Press's Iraqi and Jordanian stories go where they name; a placeless one gets no pin
    expect(inferGeo('Gunmen kill fuel station guard, injure three on Erbil-Kirkuk road', '', src('north-press-sy')!).countryCode).toBe('IQ')
    expect(inferGeo('Jordanian army foils drug smuggling attempt using balloons', '', src('north-press-sy')!).countryCode).toBe('JO')
    expect(inferGeo('Sesame harvest season begins', '', src('north-press-sy')!).lat).toBeNull()
  })
})

describe('thinly covered places (Nov 5, 2026)', () => {
  it(`are those with ${THIN_PLACE_FEEDS} feeds of their own or fewer`, () => {
    const thin = new Set(thinPlaces())
    for (const code of ['DM', 'LC', 'TO', 'VU', 'GD', 'HR', 'DJ', 'LB', 'JO', 'EE', 'LT']) expect(thin.has(code), code).toBe(true)
    // Honduras has four since El Pulso, Syria five since its Arabic press (Nov 6)
    for (const code of ['US', 'GB', 'IN', 'NG', 'FR', 'HN', 'SY']) expect(thin.has(code), code).toBe(false)
    expect(thinPlaces([{ ...src('naharnet')!, countryCode: 'ZZ' }])).toEqual(['ZZ'])
  })
})

describe('second newsrooms for the places of Q10 with one (Nov 6, 2026, 12:10 AM)', () => {
  it('adds El Pulso (Honduras), La Nation (Djibouti) and Ahora EG (Equatorial Guinea), each pinned at home', () => {
    expect(src('el-pulso-hn')).toMatchObject({ countryCode: 'HN', language: 'es' })
    expect(src('la-nation-dj')).toMatchObject({ countryCode: 'DJ', language: 'fr', biasLabel: 'state-media' })
    expect(src('ahora-eg-gq')).toMatchObject({ countryCode: 'GQ', language: 'es', biasLabel: 'state-media' })
    for (const id of ['el-pulso-hn', 'la-nation-dj', 'ahora-eg-gq']) expect(HOME_PIN_SOURCES.has(id), id).toBe(true)
    expect(inferGeo('Billet : La commande publique en tournée régionale', '', src('la-nation-dj')!).countryCode).toBe('DJ')
    expect(inferGeo('Cristiano Ronaldo anuncia su retirada de la selección de Portugal', '', src('ahora-eg-gq')!).countryCode).toBe('PT')
    expect(inferGeo('Gobierno anuncia que buscará concluir los ocho hospitales iniciados por la administración anterior', '', src('el-pulso-hn')!).countryCode).toBe('HN')
    // St Vincent Times stayed out ("for your personal and non-business use") until Devon's call on Nov 6, 7:34 AM
    // (held-outlets-nov6.test.ts)
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes('stvincenttimes.com')).map(s => s.id)).toEqual(['st-vincent-times-vc'])
  })
})

describe("small places' own feeds keep their stories at home (Nov 5, 2026, plan Q10)", () => {
  it("pins a press office's visits received at home at home, and its trips abroad where they go", () => {
    const pmo = src('pmo-brunei')!
    expect(inferGeo('His Majesty receives in audience His Majesty The Sultan of Oman', '', pmo).countryCode).toBe('BN')
    expect(inferGeo('Crown Prince Receives Outgoing High Commissioner Islamic Republic Of Pakistan', '', pmo).countryCode).toBe('BN')
    expect(inferGeo('His Majesty The Sultan of Oman Departs Brunei Darussalam', '', pmo).countryCode).toBe('BN')
    const fsm = src('fsm-president-office')!
    expect(inferGeo('President Simina Meets with JICA President in Tokyo', '', fsm).countryCode).toBe('JP')
    // an outlet that is not a press office still goes by the place named first
    expect(inferGeo('Oman and Brunei sign defence pact in Muscat', '', src('times-of-oman')!).countryCode).toBe('OM')
  })

  it("pins Top FM's politics stories in Mauritius", () => {
    expect(HOME_PIN_SOURCES.has('top-fm-mu')).toBe(true)
    expect(inferGeo('Adrien Duval s’en prend à Paul Bérenger : « Je n’ai aucune leçon à recevoir de lui »', '', src('top-fm-mu')!).countryCode).toBe('MU')
  })
})
