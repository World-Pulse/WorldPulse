/**
 * One row per story (plan 12b): collapsing a page of signals into stories.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ hasColumn: vi.fn(async () => true) }))
vi.mock('../db/postgres', () => ({ db: { schema: { hasColumn: h.hasColumn }, raw: vi.fn() } }))

import { collapseStories, outletsOf, hostOf, storyKeyOf, FEED_POST_ROWS } from '../lib/stories'

const row = (id: string, story_id: string | null, status = 'pending', reliability_score = 0.7) =>
  ({ id, story_id, status, reliability_score })

describe('collapseStories', () => {
  it('keeps one entry per story, in order of its newest signal', () => {
    const rows = [row('a', 'S1'), row('b', null), row('c', 'S1'), row('d', 'S2')]
    const { stories, lastIndex, more } = collapseStories(rows, 10)
    expect(stories.map(s => s.key)).toEqual(['S1', 'b', 'S2'])
    expect(lastIndex).toBe(3)
    expect(more).toBe(false)
  })

  it('shows the best member: verified first, then the most reliable', () => {
    const rows = [row('a', 'S1', 'pending', 0.9), row('b', 'S1', 'verified', 0.7), row('c', 'S1', 'verified', 0.8)]
    expect(collapseStories(rows, 10).stories[0].row.id).toBe('c')
  })

  it('stops at the page size and says there is more, with the last row it used', () => {
    const rows = [row('a', 'S1'), row('b', 'S2'), row('c', 'S1'), row('d', 'S3'), row('e', 'S2')]
    const { stories, lastIndex, more } = collapseStories(rows, 2)
    expect(stories.map(s => s.key)).toEqual(['S1', 'S2'])
    expect(lastIndex).toBe(2) // 'c' (S1) was used; 'd' starts the next page
    expect(more).toBe(true)
  })

  it('treats a signal without a story as its own story', () => {
    expect(storyKeyOf({ id: 'x', story_id: null })).toBe('x')
    expect(storyKeyOf({ id: 'x', story_id: 'S9' })).toBe('S9')
  })
})

describe('collapseStories on feed posts (global feed, plan 12c)', () => {
  const post = (id: string, signal_id: string | null, story_id: string | null, post_type = 'signal', signal_status = 'pending', signal_reliability = 0.7) =>
    ({ id, signal_id, story_id, post_type, signal_status, signal_reliability })

  it('groups the automated posts of one story', () => {
    const rows = [post('p1', 'a', 'S1'), post('p2', 'b', null), post('p3', 'c', 'S1')]
    const { stories } = collapseStories(rows, 10, FEED_POST_ROWS)
    expect(stories.map(s => s.key)).toEqual(['S1', 'b'])
  })

  it("never groups people's posts, even about the same signal", () => {
    const rows = [post('p1', 'a', 'S1'), post('p2', 'a', 'S1', 'thread'), post('p3', null, null, 'text')]
    const { stories } = collapseStories(rows, 10, FEED_POST_ROWS)
    expect(stories.map(s => s.key)).toEqual(['S1', 'post:p2', 'post:p3'])
  })

  it("shows the post of the story's best signal", () => {
    const rows = [post('p1', 'a', 'S1', 'signal', 'pending', 0.95), post('p2', 'b', 'S1', 'signal', 'verified', 0.8)]
    expect(collapseStories(rows, 10, FEED_POST_ROWS).stories[0].row.id).toBe('p2')
  })
})

describe('outletsOf', () => {
  it('lists each website once, without www., in the order first seen', () => {
    expect(outletsOf([
      'https://www.aljazeera.com/news/a', 'https://npr.org/b', 'https://aljazeera.com/c', 'not a url', null,
    ])).toEqual(['aljazeera.com', 'npr.org'])
  })

  it('stops at the limit', () => {
    expect(outletsOf(['https://a.com/1', 'https://b.com/1', 'https://c.com/1'], 2)).toEqual(['a.com', 'b.com'])
  })

  it('hostOf returns "" for non-addresses', () => {
    expect(hostOf(42)).toBe('')
    expect(hostOf('https://WWW.DW.com/en')).toBe('dw.com')
  })
})

describe('signalsHaveStoryIds', () => {
  beforeEach(() => { vi.resetModules(); h.hasColumn.mockReset() })

  it('checks the column once it exists', async () => {
    h.hasColumn.mockResolvedValue(true)
    const { signalsHaveStoryIds } = await import('../lib/stories')
    expect(await signalsHaveStoryIds()).toBe(true)
    expect(await signalsHaveStoryIds()).toBe(true)
    expect(h.hasColumn).toHaveBeenCalledTimes(1)
  })

  it('answers false while the column is missing, without asking on every request', async () => {
    h.hasColumn.mockResolvedValue(false)
    const { signalsHaveStoryIds } = await import('../lib/stories')
    expect(await signalsHaveStoryIds()).toBe(false)
    expect(await signalsHaveStoryIds()).toBe(false)
    expect(h.hasColumn).toHaveBeenCalledTimes(1)
  })
})
