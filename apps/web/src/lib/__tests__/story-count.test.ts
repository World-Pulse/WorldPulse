/**
 * A story's count covers its last two days, and a story that has run longer
 * also says how many have reported it since it began (Devon, Oct 20, 2026,
 * option 1: Oct 20's biggest story said 143 outlets and went back ten days).
 */
import { describe, it, expect } from 'vitest'
import { storyCountsOf, sinceText, storyDay, storyPageTitle, storyIndexable, storyCanonicalPath, storyFactLine, STORY_COUNT_DAYS } from '@/lib/story-count'

describe('storyCountsOf', () => {
  it("reads one story of GET /stories/outlets, never fewer since it began than in its last two days", () => {
    expect(storyCountsOf({ outlets: 48, outletsAll: 143, firstReportAt: '2026-10-10T15:00:00.000Z', verified: true }))
      .toEqual({ outlets: 48, outletsAll: 143, firstReportAt: '2026-10-10T15:00:00.000Z', verified: true })
    expect(storyCountsOf({ outlets: 5, outletsAll: 3 })).toEqual({ outlets: 5, outletsAll: 5, firstReportAt: null })
    // an older API's answer
    expect(storyCountsOf({ outlets: '12' })).toEqual({ outlets: 12, outletsAll: 12, firstReportAt: null })
    expect(storyCountsOf({ outlets: 4, outletsAll: 9, firstReportAt: 'not a time' })?.firstReportAt).toBeNull()
    // the story's id, so its page can leave its own story out of "Related"
    expect(storyCountsOf({ outlets: 4, storyId: 'S1' })?.storyId).toBe('S1')
    expect(storyCountsOf({ outlets: 4, storyId: '' })).not.toHaveProperty('storyId')
  })

  it('is null without a count', () => {
    expect(storyCountsOf(undefined)).toBeNull()
    expect(storyCountsOf({ outlets: 0 })).toBeNull()
    expect(storyCountsOf({ outlets: 'x' })).toBeNull()
  })
})

describe("the count's words", () => {
  it('a story inside two days: nothing more to say', () => {
    expect(STORY_COUNT_DAYS).toBe(2)
    expect(sinceText(48, 48, '2026-10-19T10:00:00Z')).toBe('')
  })

  it('a story that has run longer: how many since it began', () => {
    expect(sinceText(48, 143, '2026-10-10T15:00:00.000Z')).toBe('143 since Oct 10')
    expect(sinceText(1, 6, null)).toBe('6 since it began')
  })

  it('names the day in UTC, so the server and the browser agree', () => {
    expect(storyDay('2026-10-10T23:30:00-05:00')).toBe('Oct 11')
    expect(storyDay('2026-10-01T00:10:00Z')).toBe('Oct 1')
  })
})

describe('storyPageTitle', () => {
  const counts = (o: Partial<{ outlets: number; verified: boolean }>) =>
    ({ outlets: 5, outletsAll: 5, firstReportAt: null, verified: true, ...o })

  it('adds the outlet count of a verified story', () => {
    expect(storyPageTitle('Riyadh airport attack kills 12', counts({ outlets: 25 })))
      .toBe('Riyadh airport attack kills 12 · verified by 25 outlets')
  })

  it('adds the countries the outlets are from, from two on', () => {
    expect(storyPageTitle('Riyadh airport attack kills 12', { ...counts({ outlets: 81 }), countries: 36 }))
      .toBe('Riyadh airport attack kills 12 · verified by 81 outlets in 36 countries')
    expect(storyPageTitle('A', { ...counts({ outlets: 5 }), countries: 1 })).toBe('A · verified by 5 outlets')
    expect(storyCountsOf({ outlets: 4, countries: 7 })?.countries).toBe(7)
    expect(storyCountsOf({ outlets: 4, countries: 1 })).not.toHaveProperty('countries')
    expect(storyCountsOf({ outlets: 4, countries: 'x' })).not.toHaveProperty('countries')
  })

  it('leaves the headline alone when the story is not verified, has one outlet or has no counts', () => {
    expect(storyPageTitle('A', counts({ verified: false }))).toBe('A')
    expect(storyPageTitle('A', { outlets: 3, outletsAll: 3, firstReportAt: null })).toBe('A')
    expect(storyPageTitle('A', counts({ outlets: 1 }))).toBe('A')
    expect(storyPageTitle('A', null)).toBe('A')
  })
})

describe('what search engines read (Nov 8, 2026: "Do it now" to winning Google)', () => {
  const CANON = '99999999-9999-4999-8999-999999999999'
  const counts = (over: Record<string, unknown> = {}) => storyCountsOf({ outlets: 81, outletsAll: 81, firstReportAt: '2026-11-07T15:31:00.000Z', verified: true, countries: 36, canonicalId: CANON, ...over })

  it('reads the story\'s canonical page from the API, a real id only', () => {
    expect(counts()?.canonicalId).toBe(CANON)
    expect(counts({ canonicalId: 'not-an-id' })).not.toHaveProperty('canonicalId')
  })

  it('points every report of a story at its one page; a report on its own is its own', () => {
    expect(storyCanonicalPath('11111111-1111-4111-8111-111111111111', counts())).toBe(`/signals/${CANON}`)
    expect(storyCanonicalPath('11111111-1111-4111-8111-111111111111', counts({ canonicalId: undefined }))).toBe('/signals/11111111-1111-4111-8111-111111111111')
    expect(storyCanonicalPath('11111111-1111-4111-8111-111111111111', null)).toBe('/signals/11111111-1111-4111-8111-111111111111')
  })

  it("puts only verified stories in search results: an unconfirmed report's page stays out", () => {
    expect(storyIndexable('verified', null)).toBe(true)
    expect(storyIndexable('pending', counts())).toBe(true)                       // its story is verified
    expect(storyIndexable('pending', counts({ verified: false, outlets: 1 }))).toBe(false)
    expect(storyIndexable('pending', null)).toBe(false)
    expect(storyIndexable('false', counts({ verified: false }))).toBe(false)
  })

  it('says the facts in one sentence, first', () => {
    expect(storyFactLine({ verified: true, outlets: 81, countries: 36, firstReportAt: '2026-11-07T15:31:00.000Z' }))
      .toBe('Verified: 81 outlets in 36 countries have reported this story since Nov 7.')
    expect(storyFactLine({ verified: false, outlets: 3, countries: 1 })).toBe('3 outlets have reported this story so far; it is not verified yet.')
    expect(storyFactLine({ verified: false, outlets: 1 })).toBe('Only one outlet has reported this so far: treat it as unconfirmed.')
    expect(storyFactLine({ verified: false, outlets: 0 })).toBe('')
  })
})
