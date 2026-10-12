/**
 * Summaries without the outlet note the RSS reader used to add, and without
 * a repeat of the headline (lib/signal-text.ts, Oct 11, 2026).
 */

import { describe, it, expect } from 'vitest'
import { displaySummary, isStateMedia, outletSite, storyTags } from '../signal-text'

const TITLE = 'Yemen’s Houthis renew warning over Saudi airports after deadly Riyadh attack'

describe('displaySummary', () => {
  it('shows nothing when the summary is the headline plus the outlet note', () => {
    expect(displaySummary(`${TITLE}. Source: Investing.com News (reliability: 76%, bias: center).`, TITLE)).toBe('')
    expect(displaySummary(`${TITLE}.`, TITLE)).toBe('')
    expect(displaySummary(`“${TITLE}”`, TITLE)).toBe('')
  })

  it('keeps the story and drops the note, the state-media sentence included', () => {
    expect(displaySummary('Moscow says the drones were downed. Source: TASS (reliability: 45%, bias: state-media). ⚠️ This outlet is state-controlled and may reflect official government positions.', 'Drones'))
      .toBe('Moscow says the drones were downed.')
    expect(displaySummary('Floods closed schools. Source: New Straits Times (Malaysia) (reliability: 75%, bias: center).', 'Floods'))
      .toBe('Floods closed schools.')
  })

  it('leaves other summaries as they are', () => {
    const story = 'Talks resume on Sunday, the source said (reliability of the claim unclear).'
    expect(displaySummary(story, 'Talks')).toBe(story)
    expect(displaySummary(null, TITLE)).toBe('')
    expect(displaySummary(undefined, TITLE)).toBe('')
    expect(displaySummary('A longer summary.', null)).toBe('A longer summary.')
  })
})

describe('isStateMedia', () => {
  it("reads the scraper's state-media tag", () => {
    expect(isStateMedia(['news', 'rss', 'state-media'])).toBe(true)
    expect(isStateMedia(['news'])).toBe(false)
    expect(isStateMedia(undefined)).toBe(false)
  })
})

describe('displaySummary (HTML a feed sent encoded, Oct 11, 2026)', () => {
  it('shows text, not codes', () => {
    expect(displaySummary('&lt;p>Information Minister Attaullah Tarar on Sunday alleged a nexus.&lt;/p>', 'Info minister alleges nexus'))
      .toBe('Information Minister Attaullah Tarar on Sunday alleged a nexus.')
    expect(displaySummary("Yemen's ministry raises alarm over supplies in Taiz &lt;div class=\"field field-field-text\"", 'Supplies run low in Taiz'))
      .toBe("Yemen's ministry raises alarm over supplies in Taiz")
  })
})

describe('outletSite', () => {
  it("names the website of a signal's first link", () => {
    expect(outletSite(['https://www.theguardian.com/world/2026/oct/11/story'])).toBe('theguardian.com')
    expect(outletSite(['https://bworldonline.com/corporate/2026/10/11/786052/x/'])).toBe('bworldonline.com')
    expect(outletSite([])).toBe('')
    expect(outletSite(null)).toBe('')
    expect(outletSite(['not a link'])).toBe('')
  })
})

describe('storyTags', () => {
  const text = 'At least 139 migrants die in boat wreck between Djibouti and Yemen. The International Organization for Migration said most were Ethiopian.'

  it("drops tags about the feed and the badges, keeps the story's own words (Oct 12, 2026)", () => {
    expect(storyTags(['news', 'rss', 'france24', 'fr', 'disaster', 'critical', 'france', 'europe'], text)).toEqual([])
    expect(storyTags(['yemen', 'Djibouti', 'migration', 'yemen'], text)).toEqual(['yemen', 'Djibouti', 'migration'])
  })

  it('matches a several-word tag only when the text says every word', () => {
    expect(storyTags(['climate-change', 'climate_summit'], 'Leaders discuss climate change in Belem')).toEqual(['climate-change'])
  })

  it('leaves out two-letter tags, the state-media marker and anything that is not text', () => {
    expect(storyTags(['us', 'un', 'state-media', 42, null], 'The UN told us the state media story')).toEqual([])
    expect(storyTags(null, text)).toEqual([])
  })
})
