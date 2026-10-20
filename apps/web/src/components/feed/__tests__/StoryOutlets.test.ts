/**
 * One story, all outlets (plan 12c): reading the story fields of a feed row,
 * the badge each story gets, and the signal page's "Also reported by" list.
 * Node environment — pure helpers only.
 */

import { describe, it, expect } from 'vitest'
import { storyOf, storyBadge, storyBadgeTitle } from '../StoryOutlets'
import type { StoryInfo } from '../StoryOutlets'
import { otherMembers, timelineOutlets } from '../../../app/signals/[id]/StoryMembers'

const story = (outlets: string[], verifiedAt: string | null = null, size = outlets.length || 1): StoryInfo =>
  ({ id: 'S1', size, outlets, verifiedAt, updatedAt: null })

describe('storyOf', () => {
  it('reads the story fields of a ?group=story row', () => {
    expect(storyOf({
      storyId: 'S1', storySize: 5, storyOutlets: ['wapt.com', 'kashmirlife.net', '', 7],
      storyVerifiedAt: '2026-10-11T00:02:49.325Z', storyUpdatedAt: '2026-10-11T02:39:46.391Z',
    })).toEqual({
      id: 'S1', size: 5, outlets: ['wapt.com', 'kashmirlife.net'], outletCount: 2, outletCountAll: 2,
      verifiedAt: '2026-10-11T00:02:49.325Z', updatedAt: '2026-10-11T02:39:46.391Z',
    })
  })

  it("counts every outlet of its last two days, not the names, which stop at 12 (Oct 20, 2026)", () => {
    const names = Array.from({ length: 12 }, (_, i) => `site${i}.com`)
    const s = storyOf({ storyId: 'S1', storySize: 313, storyOutlets: names, storyOutletCount: 48, storyOutletCountAll: 143 })
    expect(s).toMatchObject({ outletCount: 48, outletCountAll: 143 })
    expect(storyBadge(s!, 'verified')?.label).toBe('Verified · 48 outlets')
    expect(storyBadgeTitle(s!, 48)).toBe('313 reports of this story · 143 outlets since it began')
    // never fewer than it names, and an older API without the counts
    expect(storyOf({ storyId: 'S1', storyOutlets: ['a.com', 'b.com'], storyOutletCount: 1 })?.outletCount).toBe(2)
    expect(storyOf({ storyId: 'S1', storyOutlets: ['a.com', 'b.com'] })).toMatchObject({ outletCount: 2, outletCountAll: 2 })
    expect(storyBadgeTitle(storyOf({ storyId: 'S1', storyOutlets: ['a.com'] })!, 1)).toBeUndefined()
  })

  it('is undefined for rows without a story (older API, posts by people)', () => {
    expect(storyOf({ id: 'x', title: 'Hello' })).toBeUndefined()
    expect(storyOf(null)).toBeUndefined()
  })

  it('treats a missing or broken size as one signal', () => {
    expect(storyOf({ storyId: 'S1', storySize: 'abc' })?.size).toBe(1)
    expect(storyOf({ storyId: 'S1' })?.outlets).toEqual([])
  })
})

describe('storyBadge', () => {
  it('says verified with the outlet count', () => {
    expect(storyBadge(story(['a.com', 'b.com', 'c.com'], '2026-10-11T00:00:00Z')))
      .toEqual({ label: 'Verified · 3 outlets', tone: 'verified' })
  })

  it('trusts the signal status when the story has no verification time', () => {
    expect(storyBadge(story(['a.com', 'b.com']), 'verified')?.tone).toBe('verified')
    expect(storyBadge(story(['a.com']), 'verified')?.label).toBe('Verified')
  })

  it('counts outlets of a story that is not verified (yet)', () => {
    expect(storyBadge(story(['a.com', 'b.com']), 'pending')).toEqual({ label: '2 outlets', tone: 'multi' })
  })

  it('says "1 outlet so far" for a single report, and nothing without an outlet', () => {
    expect(storyBadge(story(['a.com']), 'pending')).toEqual({ label: '1 outlet so far', tone: 'single' })
    expect(storyBadge(story([]), 'pending')).toBeNull()
  })
})

describe('timelineOutlets', () => {
  const base = { storyId: 'a', size: 313, verifiedAt: null, signals: [] }

  it("shows the story's whole life, and its last two days' count when that's fewer", () => {
    const t = timelineOutlets({ ...base, outlets: 48, outletNames: ['c.com'], outletsAll: 143, outletNamesAll: ['a.com', 'b.com', 'c.com'] }, 7)
    expect(t).toEqual({ total: 143, names: ['a.com', 'b.com', 'c.com'], recent: 48 })
    expect(timelineOutlets({ ...base, outlets: 4, outletsAll: 4, outletNamesAll: ['a.com'] }, 2).recent).toBeNull()
  })

  it("reads an older API's answer, whose count was the whole life's", () => {
    expect(timelineOutlets({ ...base, outlets: 55, outletNames: ['a.com', '', 'b.com'] }, 3)).toEqual({ total: 55, names: ['a.com', 'b.com'], recent: null })
    expect(timelineOutlets({ ...base }, 3)).toEqual({ total: 3, names: [], recent: null })
  })
})

describe('otherMembers', () => {
  const member = (id: string) => ({ id, title: id, status: 'pending', outlet: `${id}.com`, url: null, createdAt: null, verifiedAt: null })

  it("lists the story's other reports, oldest first, without this signal", () => {
    const detail = { storyId: 'a', size: 3, verifiedAt: null, signals: [member('a'), member('b'), member('c')] }
    expect(otherMembers(detail, 'b').map(m => m.id)).toEqual(['a', 'c'])
  })

  it('is empty for a story of one, or no answer', () => {
    expect(otherMembers({ storyId: 'a', size: 1, verifiedAt: null, signals: [member('a')] }, 'a')).toEqual([])
    expect(otherMembers(null, 'a')).toEqual([])
  })
})
