/**
 * The Local's Denmark and Sweden editions (R5, Nov 9, 2026): the second English-language newsroom for each place
 * (Denmark had The Copenhagen Post, Sweden Radio Sweden). Each feed was read Nov 9 and its terms are those of The
 * Local's Switzerland and Austria feeds, already read.
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo } from '../news-rss'

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)

describe('The Local Denmark and Sweden (Nov 9, 2026)', () => {
  it('are listed once each, in English, at home', () => {
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.feedUrl.startsWith('https://feeds.thelocal.com/rss/'))).toHaveLength(4)
    expect(src('thelocal-dk')).toMatchObject({ countryCode: 'DK', language: 'en', feedUrl: 'https://feeds.thelocal.com/rss/dk' })
    expect(src('thelocal-se')).toMatchObject({ countryCode: 'SE', language: 'en', feedUrl: 'https://feeds.thelocal.com/rss/se' })
  })
  it('pin their stories at home', () => {
    for (const id of ['thelocal-dk', 'thelocal-se']) expect(HOME_PIN_SOURCES.has(id), id).toBe(true)
    expect(inferGeo("Denmark's 'hard ghettos' row reaches Supreme Court", '', src('thelocal-dk')!).countryCode).toBe('DK')
    expect(inferGeo('Sweden Democrat leader to give update on ministerial posts', '', src('thelocal-se')!).countryCode).toBe('SE')
  })
})
