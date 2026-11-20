/**
 * Feed upkeep (Nov 20, 2026, afternoon): I am Gujarat's two feeds stopped at 6:30 PM IST on Nov 19, so it is read
 * from the news sitemap its robots.txt names. And second outlets for Georgian and Mongolian: Batumelebi and Bolod.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { NEWS_SOURCE_REGISTRY, parseNewsSitemap } = await import('../news-rss')

const SITEMAP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
<url>
  <loc>https://www.iamgujarat.com/india/vantara-elephant-calf-raja/articleshow/136036363.cms</loc>
  <lastmod>2026-11-20T23:24:47+05:30</lastmod>
  <news:news>
    <news:publication><news:language>gu</news:language><news:name>I am Gujarat</news:name></news:publication>
    <news:publication_date>2026-11-20T23:24:47+05:30</news:publication_date>
    <news:title>અનંત અંબાણીના 'વનતારા' દ્વારા સારવાર માટે આસામથી સાત અઠવાડિયાના હાથીના બચ્ચા 'રાજા'ને એરલિફ્ટ કરાયો</news:title>
  </news:news>
</url>
</urlset>`

describe('I am Gujarat', () => {
  it('is read from the news sitemap its robots.txt names', () => {
    const source = NEWS_SOURCE_REGISTRY.find(s => s.id === 'iamgujarat')!
    expect(source.feedUrl).toBe('https://www.iamgujarat.com/staticsitemap/iag/news/sitemap-48hours.xml')
    expect(source.language).toBe('gu')
  })

  it("and the sitemap's items are read with their titles, links and times", () => {
    const [item] = parseNewsSitemap(SITEMAP, Date.parse('2026-11-20T18:30:00Z'))
    expect(item!.title).toMatch(/^અનંત અંબાણીના/)
    expect(item!.link).toBe('https://www.iamgujarat.com/india/vantara-elephant-calf-raja/articleshow/136036363.cms')
    expect(new Date(item!.pubDate!).toISOString()).toBe('2026-11-20T17:54:47.000Z')
  })
})

describe('second outlets for Georgian and Mongolian', () => {
  it('reads Batumelebi in Georgian and Bolod in Mongolian, each from its own feed', () => {
    for (const [id, language] of [['batumelebi-ge', 'ka'], ['bolod-mn', 'mn']] as const) {
      const source = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(source, id).toBeDefined()
      expect(source!.language).toBe(language)
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl === source!.feedUrl)).toHaveLength(1)
      expect(NEWS_SOURCE_REGISTRY.filter(s => s.language === language).length).toBeGreaterThanOrEqual(2)
    }
  })
})
