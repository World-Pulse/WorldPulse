/**
 * Summaries without the outlet note the RSS reader used to add, and without
 * a repeat of the headline (lib/signal-text.ts, Oct 11, 2026).
 */

import { describe, it, expect } from 'vitest'
import { displaySummary, isStateMedia } from '../signal-text'

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
