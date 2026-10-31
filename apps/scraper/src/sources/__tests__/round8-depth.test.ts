/**
 * Round 8 (Oct 31, 2026, Q9): depth for the places with one or two feeds. Devon, 2:43 PM: "let's now
 * [go through] every place with only 1 or 2 sources to create more depth", with helpers (eight, one
 * per region). 64 feeds for 49 places, each checked again before it went in; the helpers' notes are
 * in the HQ's departments/research/sources-round-8-2026-10-31.md.
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo, parseFeedItems } from '../news-rss'
import { cleanSummary, feedText } from '../../pipeline/text'

const ROUND_8 = [
  'eswatini-observer-sz', 'eswatini-positive-news-sz', 'the-dawn-ss', 'defimedia-mu', 'namibian-sun-na',
  'new-era-na', 'rwanda-dispatch-rw', 'mwebantu-zm', 'news-diggers-zm', 'ang-guinea-bissau',
  'e-global-guinea-bissau', 'journal-de-brazza-cg', 'rstp-sao-tome', 'stp-press', 'business-in-cameroon',
  'datacameroon', 'corbeau-news-centrafrique', 'atpe-tchad', 'aip-cote-divoire', 'rti-info-ci',
  'e-global-equatorial-guinea', 'direct-infos-gabon', 'lunion-gabon', 'le-sahel-niger',
  'actuniger-politique', 'calabash-newspaper-sl', '24heureinfo-tg', 'maldives-voice-mv', 'mfr-maldives',
  'diligente-tl', 'tbs-bangladesh', 'china-digital-times', 'antigua-observer-ag', 'abs-tv-radio-ag',
  'cbc-barbados-bb', 'the-voice-lc', 'zns-bahamas-bs', 'love-fm-bz',
  'san-pedro-sun-bz', 'nationwide-news-jm', 'ttt-news-tt', 'portalb-mk', 'tv21-mk', 'rtsh-al',
  'balkanweb-al', 'sofia-globe-bg', 'bgen-croatia', 'gazeta-express-xk', 'borba-me', 'primorske-novice-si',
  'azertac-en', 'saba-yemen-en', 'khovar-en', 'shafaq-kurdistan', 'kuwait-times-kw', 'qatar-tribune',
  'lsm-english-lv', 'altaveu-ad', 'corriere-romagna-sm', 'crux-vatican', 'zenit-pope-va', 'hello-monaco',
  'kleine-zeitung-at', 'samoa-global-news-ws',
]

/** Their stories range over many countries, so a story that names no place isn't pinned at home */
const NOT_AT_HOME = ['china-digital-times', 'gazeta-express-xk']

/** State news agencies, state-owned papers and state broadcasters */
const STATE_MEDIA = [
  'abs-tv-radio-ag', 'azertac-en', 'cbc-barbados-bb', 'zns-bahamas-bs', 'aip-cote-divoire', 'rti-info-ci',
  'lunion-gabon', 'ang-guinea-bissau', 'new-era-na', 'le-sahel-niger', 'stp-press', 'eswatini-observer-sz',
  'atpe-tchad', 'khovar-en', 'ttt-news-tt', 'saba-yemen-en',
]

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!

describe('round 8: depth for the places with one or two feeds', () => {
  it('reads 64 more feeds, each once and at an address no other entry reads', () => {
    expect(new Set(ROUND_8).size).toBe(64)
    for (const id of ROUND_8) {
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.id === id), id).toHaveLength(1)
      expect(src(id).feedUrl, id).toMatch(/^https:\/\//)
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl === src(id).feedUrl), id).toHaveLength(1)
    }
    // 49 places
    expect(new Set(ROUND_8.map(id => src(id).countryCode)).size).toBe(49)
  })

  it('reads them in languages the reader handles', () => {
    const languages = new Set(['en', 'fr', 'pt', 'sq', 'ca', 'de', 'sr', 'sl', 'it'])
    for (const id of ROUND_8) expect(languages.has(String(src(id).language)), id).toBe(true)
  })

  it('pins a story that names no place at home, except for the two that cover many countries', () => {
    for (const id of ROUND_8) expect(HOME_PIN_SOURCES.has(id), id).toBe(!NOT_AT_HOME.includes(id))
  })

  it('labels state agencies, state-owned papers and state broadcasters as state media', () => {
    for (const id of ROUND_8) expect(src(id).biasLabel === 'state-media', id).toBe(STATE_MEDIA.includes(id))
  })

  it("tries LSM's English feed once more, at the address lsm-en had until Oct 21", () => {
    expect(src('lsm-english-lv')).toMatchObject({ feedUrl: 'https://eng.lsm.lv/rss/', countryCode: 'LV', language: 'en' })
    expect(NEWS_SOURCE_REGISTRY.some(s => s.id === 'lsm-en')).toBe(false)
  })

  it('leaves out the six held back on terms or for what they publish', () => {
    // Times Caribbean: 3 of its 10 newest stories carried an AI chat tool's search citations
    for (const host of ['shabait.com', 'kuenselonline.com', 'nbcsvg.com', 'levant24.com', 'businessadvantagepng.com', 'timescaribbeanonline.com']) {
      expect(NEWS_SOURCE_REGISTRY.some(s => new URL(s.feedUrl).hostname.replace(/^www\./, '') === host), host).toBe(false)
    }
  })

  it('pins their stories at home, or where they name', () => {
    expect(inferGeo('Fuel prices rise for November as ERB adjusts pump prices', '', src('mwebantu-zm')).countryCode).toBe('ZM')
    expect(inferGeo('Monaco Leaves FATF Grey List After Two Years of Sweeping Reforms', '', src('hello-monaco')).countryCode).toBe('MC')
    expect(inferGeo('Pope Leo tells Villanova and Notre Dame basketball teams to play with joy', '', src('crux-vatican')).countryCode).toBe('VA')
    expect(inferGeo('San Pedro Tests Redesigned Beach Drain Near High School', '', src('san-pedro-sun-bz')).countryCode).toBe('BZ')
    expect(inferGeo('Niger-Tchad : les chefs de diplomatie privilégient le dialogue', '', src('actuniger-politique')).countryCode).toBe('NE')
    expect(inferGeo('Holness: UK willingness to meaningfully engage on reparations welcomed', '', src('nationwide-news-jm')).countryCode).toBe('GB')
  })
})

describe("round 8's summaries", () => {
  const summary = (html: string) => cleanSummary(feedText(html))

  it("drops News Diggers' paywall line, which is its whole summary", () => {
    expect(summary('<p>This content is for members only. Visit the site and log in/register to read.</p>')).toBe('')
    expect(summary('This content is for members only.')).toBe('')
  })

  it("drops the Eswatini Observer's reading-time note", () => {
    expect(summary('<p>Reading Time: 2 minutes</p><p>A Standard Bank Digital Consultant accused of fraud was granted bail.</p>'))
      .toBe('A Standard Bank Digital Consultant accused of fraud was granted bail.')
  })

  it("drops the WordPress block comments around Gazeta Express's paragraphs, written out or encoded", () => {
    expect(feedText('<!-- wp:paragraph --><p>Agjencia e Statistikave të Kosovës ka publikuar</p><!-- /wp:paragraph -->'))
      .toBe('Agjencia e Statistikave të Kosovës ka publikuar')
    expect(feedText('&lt;!-- wp:paragraph --&gt;&lt;p&gt;Rriten çmimet&lt;/p&gt;&lt;!-- /wp:paragraph --&gt;')).toBe('Rriten çmimet')
    const [item] = parseFeedItems(`<rss><channel><item><title>ASK publikon statistikat</title><link>https://www.gazetaexpress.com/ask/</link>
      <pubDate>Sat, 31 Oct 2026 10:00:00 +0000</pubDate><description><![CDATA[<p><img src="https://www.gazetaexpress.com/a.jpg" /></p>
      <!-- wp:paragraph --><p>Agjencia e Statistikave të Kosovës ka publikuar statistikat.</p><!-- /wp:paragraph -->]]></description></item></channel></rss>`)
    expect(summary(item.description ?? '')).toBe('Agjencia e Statistikave të Kosovës ka publikuar statistikat.')
  })
})
