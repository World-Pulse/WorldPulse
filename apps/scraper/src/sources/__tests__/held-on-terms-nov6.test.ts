/**
 * Two of the four outlets held back on their terms go in (Devon, Nov 6, 2026, 10:19 AM: "1 go in anyway"): Cayman
 * Compass and FBC News, each with its terms noted beside its entry. The Royal Gazette and Sermitsiaq.AG wait for their
 * feeds' addresses.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo } from '../news-rss'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}

describe('the outlets held on their terms (Nov 6, 2026, 11 AM)', () => {
  it("adds Cayman Compass, the Cayman Islands' second outlet, pinned at home", () => {
    const cc = src('cayman-compass-ky')
    expect(cc).toMatchObject({ countryCode: 'KY', language: 'en', feedUrl: 'https://www.caymancompass.com/feed/' })
    expect(HOME_PIN_SOURCES.has(cc.id)).toBe(true)
    expect(inferGeo('Government trials new emergency housing programme', '', cc).countryCode).toBe('KY')
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'KY')).toHaveLength(2)
  })

  it("adds FBC News, Fiji's public broadcaster, labelled state media and pinned at home", () => {
    const fbc = src('fbc-news-fj')
    expect(fbc).toMatchObject({ countryCode: 'FJ', language: 'en', biasLabel: 'state-media' })
    expect(fbc.reliability).toBeLessThan(0.6)
    expect(fbc.extraTags).toContain('state-media')
    expect(HOME_PIN_SOURCES.has(fbc.id)).toBe(true)
    expect(inferGeo('Dry spell threatens vegetable prices', '', fbc).countryCode).toBe('FJ')
  })

  it('reads one feed per outlet', () => {
    for (const host of ['caymancompass.com', 'fbcnews.com.fj']) {
      expect(NEWS_SOURCE_REGISTRY.filter(s => new URL(s.feedUrl).hostname.replace(/^www\./, '') === host), host).toHaveLength(1)
    }
  })
})
