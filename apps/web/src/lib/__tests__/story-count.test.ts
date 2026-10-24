/**
 * A story's count covers its last two days, and a story that has run longer
 * also says how many have reported it since it began (Devon, Oct 20, 2026,
 * option 1: Oct 20's biggest story said 143 outlets and went back ten days).
 */
import { describe, it, expect } from 'vitest'
import { storyCountsOf, sinceText, storyDay, storyPageTitle, STORY_COUNT_DAYS } from '@/lib/story-count'

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

  it('leaves the headline alone when the story is not verified, has one outlet or has no counts', () => {
    expect(storyPageTitle('A', counts({ verified: false }))).toBe('A')
    expect(storyPageTitle('A', { outlets: 3, outletsAll: 3, firstReportAt: null })).toBe('A')
    expect(storyPageTitle('A', counts({ outlets: 1 }))).toBe('A')
    expect(storyPageTitle('A', null)).toBe('A')
  })
})
