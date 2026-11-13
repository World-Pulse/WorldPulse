/**
 * Nov 13, 2026: the Microsoft Outlook outage sat at the home of national outlets (Samoa Global News at Apia,
 * Nationwide News Network at Kingston; Nov 12: Uganda, Thailand, Canada). A worldwide tech outage with no place
 * in its headline gets no pin; a place in the headline still wins.
 */
import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo } from '../news-rss'

const homePinned = NEWS_SOURCE_REGISTRY.find(s => HOME_PIN_SOURCES.has(s.id))!

describe('worldwide outages are not pinned at an outlet\'s home', () => {
  it('leaves them unplaced', () => {
    for (const t of [
      'Microsoft Outage Disrupts Email and Online Services Worldwide',
      'Microsoft struggling to fix major global outage',
      'Cloudflare outage takes down sites',
      'Global IT outage grounds services',
    ]) {
      expect(inferGeo(t, '', homePinned).countryCode, t).toBeNull()
    }
  })
  it('keeps a headline\'s own place', () => {
    expect(inferGeo('Microsoft outage hits banks in Nairobi', '', homePinned).locationName).toMatch(/Nairobi/)
  })
  it('does not touch ordinary national news', () => {
    expect(inferGeo('Power outage leaves homes dark after storm', '', homePinned).countryCode).toBe(homePinned.countryCode)
  })
})
