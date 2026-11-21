/**
 * Replacement and second-outlet round (Nov 21, 2026; Devon, Nov 20, 11:27 PM: "4,5,6 only go", item 6): outlets for the
 * languages and countries whose feeds turn the server away, and more outlets for Polish, Japanese, Chinese and Slovak.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { NEWS_SOURCE_REGISTRY } = await import('../news-rss')

const ADDED: Record<string, [string, string][]> = {
  ro: [['hotnews-ro', 'RO'], ['adevarul-ro', 'RO'], ['mediafax-ro', 'RO'], ['zf-ro', 'RO'], ['economica-ro', 'RO'],
       ['unimedia-md', 'MD'], ['jurnal-md', 'MD']],
  bg: [['darik-news-bg', 'BG'], ['vesti-bg', 'BG'], ['fakti-bg', 'BG'], ['investor-bg', 'BG']],
  lt: [['tv3-lt', 'LT'], ['madeinvilnius-lt', 'LT']],
  pl: [['defence24-pl', 'PL'], ['cyberdefence24-pl', 'PL'], ['energetyka24-pl', 'PL'], ['interia-pl', 'PL'], ['dziennik-pl', 'PL'],
       ['forsal-pl', 'PL'], ['polityka-pl', 'PL'], ['oko-press', 'PL'], ['natemat-pl', 'PL'], ['tygodnik-powszechny', 'PL']],
  ja: [['kyoto-shimbun', 'JP'], ['business-insider-jp', 'JP'], ['nippon-com-ja', 'JP'], ['bunshun-jp', 'JP']],
  zh: [['ettoday', 'TW'], ['pts-news-tw', 'TW'], ['tvbs-news', 'TW'], ['business-today-tw', 'TW']],
  es: [['telemetro-pa', 'PA'], ['eco-tv-pa', 'PA'], ['en-segundos-pa', 'PA'], ['caras-y-caretas-uy', 'UY'], ['busqueda-uy', 'UY']],
  pt: [['noticias-mz', 'MZ']],
  ar: [['khaberni-jo', 'JO']],
  en: [['softpower-ug', 'UG']],
  sk: [['hn-online-sk', 'SK'], ['postoj-sk', 'SK']],
}

// The feeds the server is turned away from or that stopped answering (the status page, Nov 21).
const TURNED_AWAY = new Set(['g4media', 'tv8-md', 'nova-bg', '15min-lt', 'la-prensa-pa', 'el-pais-uy', 'carta-mz', 'al-ghad-jo', 'pml-daily-ug'])

describe('replacement and second-outlet round (Nov 21, 2026)', () => {
  const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))

  it('reads each in its language and country, from its own feed or news sitemap', () => {
    for (const [language, rows] of Object.entries(ADDED)) {
      for (const [id, country] of rows) {
        const source = byId.get(id)
        expect(source, id).toBeDefined()
        expect(source!.language, id).toBe(language)
        expect(source!.countryCode, id).toBe(country)
        expect(source!.feedUrl, id).toMatch(/^https:\/\//)
        expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl === source!.feedUrl), id).toHaveLength(1)
      }
    }
    expect(Object.values(ADDED).flat()).toHaveLength(41)
  })

  it('reads the sitemap outlets from their news sitemaps', () => {
    for (const id of ['tv3-lt', 'oko-press', 'pts-news-tw', 'tvbs-news', 'business-today-tw', 'eco-tv-pa', 'busqueda-uy', 'khaberni-jo', 'postoj-sk']) {
      expect(byId.get(id)!.feedUrl, id).toMatch(/sitemap/)
    }
  })

  it('gives Romanian, Bulgarian and Lithuanian three outlets or more beside those turned away', () => {
    for (const language of ['ro', 'bg', 'lt']) {
      const reading = NEWS_SOURCE_REGISTRY.filter(s => s.language === language && !TURNED_AWAY.has(s.id))
      expect(reading.length, language).toBeGreaterThanOrEqual(3)
    }
  })

  it('gives Panama, Uruguay, Mozambique, Jordan and Uganda more outlets than those turned away', () => {
    for (const country of ['PA', 'UY', 'MZ', 'JO', 'UG']) {
      const reading = NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === country && !TURNED_AWAY.has(s.id))
      expect(reading.length, country).toBeGreaterThanOrEqual(3)
    }
  })

  it("labels Mozambique's state-controlled daily as state media, below 0.6", () => {
    const source = byId.get('noticias-mz')!
    expect(source.biasLabel).toBe('state-media')
    expect(source.reliability).toBeLessThan(0.6)
    expect(source.extraTags).toContain('state-media')
  })

  it('leaves out the outlets whose terms ban robots, scraping, data mining or AI training', () => {
    const out = ['wiadomosci.wp.pl', 'fakt.pl', 'newsweek.pl', 'onet.pl', 'businessinsider.com.pl', 'delfi.lt', 'vz.lt', 'ntv.co.jp',
      'haaretz.co.il', 'themarker.com', 'i24news', 'jdn.co.il', 'actualno.com', 'economic.bg', 'storm.mg', 'mirrormedia.mg']
    for (const site of out) {
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.includes(site)), site).toHaveLength(0)
    }
  })
})
