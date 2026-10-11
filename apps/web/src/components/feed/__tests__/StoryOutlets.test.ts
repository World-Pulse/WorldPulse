/**
 * One story, all outlets (plan 12c): reading the story fields of a feed row,
 * the badge each story gets, and the signal page's "Also reported by" list.
 * Node environment — pure helpers only.
 */

import { describe, it, expect } from 'vitest'
import { storyOf, storyBadge } from '../StoryOutlets'
import type { StoryInfo } from '../StoryOutlets'
import { otherMembers } from '../../../app/signals/[id]/StoryMembers'

const story = (outlets: string[], verifiedAt: string | null = null, size = outlets.length || 1): StoryInfo =>
  ({ id: 'S1', size, outlets, verifiedAt, updatedAt: null })

describe('storyOf', () => {
  it('reads the story fields of a ?group=story row', () => {
    expect(storyOf({
      storyId: 'S1', storySize: 5, storyOutlets: ['wapt.com', 'kashmirlife.net', '', 7],
      storyVerifiedAt: '2026-10-11T00:02:49.325Z', storyUpdatedAt: '2026-10-11T02:39:46.391Z',
    })).toEqual({
      id: 'S1', size: 5, outlets: ['wapt.com', 'kashmirlife.net'],
      verifiedAt: '2026-10-11T00:02:49.325Z', updatedAt: '2026-10-11T02:39:46.391Z',
    })
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
