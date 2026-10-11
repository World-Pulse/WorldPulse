/**
 * "Latest in view" beside the map (plan M14): ordering and outlet names.
 */
import { describe, it, expect } from 'vitest'
import { latestFirst, outletOf, storyBadge } from '../LiveList'

describe('latestFirst', () => {
  it('puts the newest first and stops at the limit', () => {
    const items = [
      { id: 'a', created_at: '2026-10-11T01:00:00Z' },
      { id: 'b', created_at: '2026-10-11T03:00:00Z' },
      { id: 'c', created_at: '2026-10-11T02:00:00Z' },
    ]
    expect(latestFirst(items).map(i => i.id)).toEqual(['b', 'c', 'a'])
    expect(latestFirst(items, 2).map(i => i.id)).toEqual(['b', 'c'])
  })

  it('does not reorder the caller’s array', () => {
    const items = [{ id: 'a', created_at: '2026-10-11T01:00:00Z' }, { id: 'b', created_at: '2026-10-11T03:00:00Z' }]
    latestFirst(items)
    expect(items[0].id).toBe('a')
  })
})

describe('outletOf', () => {
  it('reads the first link’s website from an array or the map’s JSON string', () => {
    expect(outletOf(['https://www.aljazeera.com/news/x', 'https://dw.com/y'])).toBe('aljazeera.com')
    expect(outletOf('["https://nst.com.my/news/1"]')).toBe('nst.com.my')
  })

  it('is empty without a usable link', () => {
    expect(outletOf(null)).toBe('')
    expect(outletOf([])).toBe('')
    expect(outletOf('not json')).toBe('')
  })
})

describe('storyBadge', () => {
  it('says how many outlets carried the story, with the verified mark when it is', () => {
    expect(storyBadge(true, { size: 33, outlets: 12 })).toBe('Verified · 12 outlets')
    expect(storyBadge(false, { size: 4, outlets: 3 })).toBe('3 outlets')
  })

  it("marks a report of a verified story verified, as the story's page does", () => {
    expect(storyBadge(false, { size: 6, outlets: 7, verified: true })).toBe('Verified · 7 outlets')
  })

  it('says nothing about one outlet, or before the counts arrive', () => {
    expect(storyBadge(true, { size: 1, outlets: 1 })).toBe('Verified')
    expect(storyBadge(true, undefined)).toBe('Verified')
    expect(storyBadge(false, { size: 1, outlets: 1 })).toBe('')
    expect(storyBadge(false, undefined)).toBe('')
  })
})
