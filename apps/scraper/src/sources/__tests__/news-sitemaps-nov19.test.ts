/**
 * News sitemaps read as feeds (Nov 19, 2026; Devon, 8:29 AM: "Go on 1"; 8:35: "If you can pull sources I'd rather you
 * pull sources than site map it"). Most outlets checked in the source rounds advertise no feed, but many name a Google
 * News sitemap in robots.txt. Shapes from Prothom Alo's and Bizportal's sitemaps that morning.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { parseFeedItems, parseNewsSitemap, NEWS_SOURCE_REGISTRY } = await import('../news-rss')
const { withLocalNames } = await import('../../pipeline/local-names')

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
<url><loc>https://www.prothomalo.com/bangladesh/older</loc><news:news><news:publication><news:name>Prothom Alo</news:name><news:language>bn</news:language></news:publication>
<news:publication_date>2026-11-19T09:00:00+06:00</news:publication_date><news:title><![CDATA[পুরোনো খবর]]></news:title></news:news></url>
<url><loc>https://www.prothomalo.com/bangladesh/crime/463553io5s</loc><news:news><news:publication><news:name>Prothom Alo</news:name><news:language>bn</news:language></news:publication>
<news:publication_date>2026-11-19T18:40:00+06:00</news:publication_date><news:title>১২ দিনে ৭৪ পরিবহনে আগুন, ৭৮ স্থানে ককটেল</news:title></news:news></url>
<url><loc>https://www.prothomalo.com/topic/no-news</loc></url>
</urlset>`

describe('a news sitemap', () => {
  it('reads as a feed, newest first, with titles, links and dates, and skips pages that are not news', () => {
    const items = parseFeedItems(SITEMAP)
    expect(items.map(i => i.link)).toEqual(['https://www.prothomalo.com/bangladesh/crime/463553io5s', 'https://www.prothomalo.com/bangladesh/older'])
    expect(items[0]).toMatchObject({ title: '১২ দিনে ৭৪ পরিবহনে আগুন, ৭৮ স্থানে ককটেল', pubDate: '2026-11-19T18:40:00+06:00', description: '' })
    expect(items[1].title).toBe('পুরোনো খবর')
  })

  it('leaves an ordinary feed as it was, and a plain sitemap empty', () => {
    expect(parseFeedItems('<rss><channel><item><title>A</title><link>https://x.org/a</link></item></channel></rss>').map(i => i.title)).toEqual(['A'])
    expect(parseNewsSitemap('<urlset><url><loc>https://x.org/about</loc></url></urlset>')).toEqual([])
  })
})

describe('the sitemap outlets', () => {
  const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))
  it('lists all 22', () => {
    const ids = ['bdnews24-bangla', 'prothom-alo', 'bartaman-patrika', 'ei-samay', 'dainik-jagran', 'jansatta', 'haribhoomi', 'naidunia',
      'prabhat-khabar', 'the-lallantop', 'munhwa-ilbo', 'bangkokbiznews', 'komchadluek', 'nation-tv-th', 'posttoday', 'china-times',
      'setn', 'upmedia', 'hk01', 'iran-international', 'afghanistan-international', 'bizportal']
    for (const id of ids) expect(byId.get(id), id).toBeDefined()
    expect(byId.get('bizportal')).toMatchObject({ language: 'he', countryCode: 'IL' })
    expect(new Set(NEWS_SOURCE_REGISTRY.map(s => s.id)).size).toBe(NEWS_SOURCE_REGISTRY.length)
  })
})

describe('Hebrew place names', () => {
  it('reads them with their joined little words', () => {
    expect(withLocalNames('הבורסה בתל אביב נפלה', 'he')).toContain('Tel Aviv')
    expect(withLocalNames('ירי טילים מאיראן לישראל', 'he')).toMatch(/Iran[\s\S]*Israel/)
    expect(withLocalNames('הפד בארה"ב העלה ריבית', 'he')).toContain('United States')
  })
})

describe('the thin-countries round', () => {
  const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))
  it('lists its 20 outlets in their own language', () => {
    const want: Array<[string, string, string]> = [
      ['jyllands-posten', 'da', 'DK'], ['berlingske', 'da', 'DK'], ['aktuality-sk', 'sk', 'SK'], ['stvr-spravy', 'sk', 'SK'],
      ['aripaev-ee', 'et', 'EE'], ['err-ee', 'et', 'EE'], ['delfi-ee', 'et', 'EE'], ['tvnet-lv', 'lv', 'LV'],
      ['indeksonline', 'sq', 'XK'], ['al-quds', 'ar', 'PS'], ['annahar', 'ar', 'LB'], ['al-jadeed', 'ar', 'LB'],
      ['altaghyeer', 'ar', 'SD'], ['alnilin', 'ar', 'SD'], ['khabar-agency-ye', 'ar', 'YE'], ['asia-plus-tj-ru', 'ru', 'TJ'],
      ['zerkalo-by', 'ru', 'BY'], ['turkmen-news', 'ru', 'TM'], ['hronika-tm', 'ru', 'TM'], ['vox-cg', 'fr', 'CG'],
    ]
    for (const [id, language, countryCode] of want) expect(byId.get(id), id).toMatchObject({ language, countryCode })
  })
  it('reads Slovak, Estonian and Latvian place names', () => {
    expect(withLocalNames('Útok dronov v Rusku', 'sk')).toContain('Russia')
    expect(withLocalNames('Venemaal toimus plahvatus', 'et')).toContain('Russia')
    expect(withLocalNames('Sprādziens Krievijā', 'lv')).toContain('Russia')
    expect(withLocalNames('ruský minister', 'sk')).not.toContain('Russia')
  })
})
