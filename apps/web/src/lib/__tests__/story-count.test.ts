/**
 * A story's count covers its last two days, and a story that has run longer
 * also says how many have reported it since it began (Devon, Oct 20, 2026,
 * option 1: Oct 20's biggest story said 143 outlets and went back ten days).
 */
import { describe, it, expect } from 'vitest'
import { storyCountsOf, storyCountText, sinceText, storyDay, STORY_COUNT_DAYS } from '@/lib/story-count'

describe('storyCountsOf', () => {
  it("reads one story of GET /stories/outlets, never fewer since it began than in its last two days", () => {
    expect(storyCountsOf({ outlets: 48, outletsAll: 143, firstReportAt: '2026-10-10T15:00:00.000Z' }))
      .toEqual({ outlets: 48, outletsAll: 143, firstReportAt: '2026-10-10T15:00:00.000Z' })
    expect(storyCountsOf({ outlets: 5, outletsAll: 3 })).toEqual({ outlets: 5, outletsAll: 5, firstReportAt: null })
    // an older API's answer
    expect(storyCountsOf({ outlets: '12' })).toEqual({ outlets: 12, outletsAll: 12, firstReportAt: null })
    expect(storyCountsOf({ outlets: 4, outletsAll: 9, firstReportAt: 'not a time' })?.firstReportAt).toBeNull()
  })

  it('is null without a count', () => {
    expect(storyCountsOf(undefined)).toBeNull()
    expect(storyCountsOf({ outlets: 0 })).toBeNull()
    expect(storyCountsOf({ outlets: 'x' })).toBeNull()
  })
})

describe("the count's words", () => {
  it('a story inside two days: just the count', () => {
    expect(STORY_COUNT_DAYS).toBe(2)
    expect(storyCountText(48, 48, '2026-10-19T10:00:00Z')).toBe('48 outlets')
    expect(storyCountText(1, 1, null)).toBe('1 outlet')
    expect(sinceText(48, 48, '2026-10-19T10:00:00Z')).toBe('')
  })

  it('a story that has run longer: its last two days, and since it began', () => {
    expect(storyCountText(48, 143, '2026-10-10T15:00:00.000Z')).toBe('48 outlets in its last 2 days · 143 since Oct 10')
    expect(storyCountText(1, 6, null)).toBe('1 outlet in its last 2 days · 6 since it began')
  })

  it('names the day in UTC, so the server and the browser agree', () => {
    expect(storyDay('2026-10-10T23:30:00-05:00')).toBe('Oct 11')
    expect(storyDay('2026-10-01T00:10:00Z')).toBe('Oct 1')
  })
})
