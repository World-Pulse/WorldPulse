/**
 * Search engines and share previews (plan G2, Oct 11, 2026): every page said
 * it was the home page, robots.txt and sitemap.xml didn't exist, and story
 * links had no picture.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { pageMetadata, newsArticleJsonLd, jsonLdText, metaDescription, SITE_IMAGE } from '../page-metadata'
import robots from '../../app/robots'
import sitemap from '../../app/sitemap'

describe('pageMetadata', () => {
  it('gives a page its own address, title and picture', () => {
    const m = pageMetadata({ path: '/map', title: 'Live World Map', description: 'Every verified event.' })
    expect(m.title).toBe('Live World Map — WorldPulse')
    expect(m.alternates).toEqual({ canonical: '/map' })
    expect(m.openGraph).toMatchObject({ url: '/map', siteName: 'WorldPulse', images: [SITE_IMAGE] })
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', images: ['/og-image.png'] })
  })
})

describe('newsArticleJsonLd', () => {
  it('describes a story for search engines', () => {
    const ld = newsArticleJsonLd({
      id: 'abc', title: 'Twelve killed in attack on Riyadh airport', description: 'Saudi officials said…',
      published: '2026-10-10T20:00:00Z', modified: '2026-10-11T08:00:00Z', place: 'Riyadh, Saudi Arabia',
    })
    expect(ld).toMatchObject({
      '@type': 'NewsArticle',
      url: 'https://world-pulse.io/signals/abc',
      datePublished: '2026-10-10T20:00:00Z',
      dateModified: '2026-10-11T08:00:00Z',
      contentLocation: { '@type': 'Place', name: 'Riyadh, Saudi Arabia' },
      publisher: { '@type': 'Organization', name: 'WorldPulse' },
    })
  })

  it('keeps headlines within 110 characters', () => {
    const ld = newsArticleJsonLd({ id: 'x', title: 'a'.repeat(140), description: 'd' })
    expect(String(ld.headline)).toHaveLength(110)
  })

  it("can't close the script tag it is written into", () => {
    const text = jsonLdText({ headline: 'Bad </script><script>alert(1)</script>' })
    expect(text).not.toContain('<')
    expect(JSON.parse(text).headline).toBe('Bad </script><script>alert(1)</script>')
  })
})

describe('robots.txt', () => {
  it('points to the sitemap and keeps account pages out, but not /developers', () => {
    const r = robots()
    expect(r.sitemap).toEqual(['https://world-pulse.io/sitemap.xml', 'https://world-pulse.io/news-sitemap.xml'])
    const rules = Array.isArray(r.rules) ? r.rules[0]! : r.rules
    const disallow = ([] as string[]).concat(rules.disallow ?? [])
    expect(disallow).toEqual(expect.arrayContaining(['/api/', '/admin', '/settings', '/auth/']))
    // robots.txt rules are prefixes ("$" ends one)
    const blocked = (path: string) => disallow.some(d => d.endsWith('$') ? path === d.slice(0, -1) : path.startsWith(d))
    expect(blocked('/developers')).toBe(false)
    expect(blocked('/developer')).toBe(true)
    expect(blocked('/signals/abc')).toBe(false)
    expect(blocked('/map')).toBe(false)
  })
})

describe('sitemap.xml', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('lists the main pages and every verified story the API names', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, data: { stories: [{ id: 's1', updatedAt: '2026-10-11T18:00:00.000Z' }] },
    }))))
    const entries = await sitemap()
    expect(entries[0]!.url).toBe('https://world-pulse.io')
    expect(entries.map(e => e.url)).toEqual(expect.arrayContaining(['https://world-pulse.io/map', 'https://world-pulse.io/briefing']))
    expect(entries.at(-1)).toMatchObject({ url: 'https://world-pulse.io/signals/s1', lastModified: new Date('2026-10-11T18:00:00.000Z') })
  })

  it('lists a page per entity the knowledge graph names often (Oct 13, 2026)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/knowledge-graph/sitemap')
        ? { success: true, data: { entities: [{ id: 'a84d671cb97c1d91', name: 'Houthis', lastReport: '2026-10-12T20:00:00.000Z', reports: 216 }] } }
        : { success: true, data: { stories: [] } },
    ))))
    const entries = await sitemap()
    expect(entries.at(-1)).toMatchObject({ url: 'https://world-pulse.io/entities/houthis-a84d671cb97c1d91', lastModified: new Date('2026-10-12T20:00:00.000Z') })
  })

  it('lists the index and topic pages that have their own titles (H-0023, Oct 20, 2026)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { stories: [] } }))))
    const urls = (await sitemap()).map(e => e.url)
    for (const path of ['/countries', '/maritime', '/sources', '/explore', '/cyber-threats', '/internet-outages']) {
      expect(urls).toContain(`https://world-pulse.io${path}`)
    }
    // pages that don't load yet stay out
    for (const path of ['/sanctions', '/cameras', '/audio-claims', '/video-claims', '/patents']) {
      expect(urls).not.toContain(`https://world-pulse.io${path}`)
    }
  })

  it('still lists the main pages when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const entries = await sitemap()
    expect(entries.length).toBeGreaterThan(3)
    expect(entries.every(e => !e.url.includes('/signals/'))).toBe(true)
  })
})

describe('metaDescription', () => {
  it('cuts long summaries at a word, about where search results stop', () => {
    const long = 'At least 139 migrants, including at least 15 children, have died and around 84 are missing after a boat carrying more than 300 people capsized while sailing from Djibouti to Yemen, the United Nations said on Sunday.'
    const d = metaDescription(long)
    expect(d.length).toBeLessThanOrEqual(200)
    expect(d.endsWith('…')).toBe(true)
    expect(long.startsWith(d.slice(0, -1))).toBe(true)
    expect(metaDescription('Short one.')).toBe('Short one.')
  })
})
