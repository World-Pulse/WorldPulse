/**
 * Feed upkeep, Nov 3, 2026 (Devon: "Can you bring them back? We need to maintain"): four feeds whose
 * feed is gone come out, two stand-ins come in, and the feeds that only turn the server away for now
 * stay in, to come back on their own (a paused feed is tried again every 6 hours).
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES } from '../news-rss'

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)

describe('feed upkeep (Nov 3, 2026)', () => {
  it('takes out the feeds that are gone', () => {
    for (const id of ['renewableenergyworld', 'national-post', 'defimedia-mu', 'east-african']) {
      expect(src(id), id).toBeUndefined()
      expect(HOME_PIN_SOURCES.has(id), id).toBe(false)
    }
  })

  it('keeps the feeds that may come back by themselves', () => {
    for (const id of ['france24', 'nation-news-bb', 'borba-me', 'sunday-standard-bw', 'scr-whats-in-blue']) {
      expect(src(id), id).toBeDefined()
    }
  })

  it('adds Canary Media for clean energy and KBC News for Kenya, each read once', () => {
    const canary = src('canary-media')!
    expect(canary).toMatchObject({ countryCode: 'US', category: 'climate', language: 'en', biasLabel: 'center' })
    const kbc = src('kbc-ke')!
    expect(kbc).toMatchObject({ countryCode: 'KE', language: 'en', biasLabel: 'state-media' })
    for (const s of [canary, kbc]) {
      expect(s.feedUrl).toMatch(/^https:\/\//)
      expect(NEWS_SOURCE_REGISTRY.filter(x => x.feedUrl === s.feedUrl), s.id).toHaveLength(1)
      expect(NEWS_SOURCE_REGISTRY.filter(x => x.id === s.id), s.id).toHaveLength(1)
    }
    // A Kenyan story that names no place is pinned in Nairobi; Canary Media's stories span the country
    expect(HOME_PIN_SOURCES.has('kbc-ke')).toBe(true)
    expect(HOME_PIN_SOURCES.has('canary-media')).toBe(false)
  })

  it('keeps Kenya at three feeds and Mauritius at two', () => {
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'KE').map(s => s.id).sort())
      .toEqual(['capitalfm-ke', 'kbc-ke', 'standard-ke'])
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'MU')).toHaveLength(2)
  })
})
