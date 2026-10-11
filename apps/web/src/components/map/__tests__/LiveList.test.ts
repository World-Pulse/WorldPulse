/**
 * "Latest in view" beside the map (plan M14): ordering and outlet names.
 */
import { describe, it, expect } from 'vitest'
import { latestFirst, outletOf } from '../LiveList'

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
