/**
 * What the World Map shows under "All topics" (lib/map-news.ts, plan M27,
 * Oct 14, 2026): news, not a books list, a podcast page or clickbait.
 */
import { describe, it, expect } from 'vitest'
import { isMapNews, mapPointsFor } from '../map-news'

describe('isMapNews', () => {
  it('leaves out low-severity other, culture and sports', () => {
    expect(isMapNews({ category: 'other', severity: 'low' })).toBe(false)   // "This 1 Trick Can Help You Feel Lighter"
    expect(isMapNews({ category: 'culture', severity: 'low' })).toBe(false)
    expect(isMapNews({ category: 'sports', severity: 'info' })).toBe(false)
    expect(isMapNews({ category: 'other', severity: null })).toBe(false)
  })

  it('keeps every other story, and those at medium severity or above', () => {
    expect(isMapNews({ category: 'conflict', severity: 'low' })).toBe(true)
    expect(isMapNews({ category: 'geopolitics', severity: 'info' })).toBe(true)
    expect(isMapNews({ category: 'other', severity: 'medium' })).toBe(true)   // a fatal fairground accident was filed as other
    expect(isMapNews({ category: 'sports', severity: 'high' })).toBe(true)
  })
})

describe('mapPointsFor', () => {
  const points = [
    { id: 'a', category: 'conflict', severity: 'high' },
    { id: 'b', category: 'other', severity: 'low' },
    { id: 'c', category: 'culture', severity: 'low' },
  ]

  it('shows news under "All topics"', () => {
    expect(mapPointsFor(points, 'all').map(p => p.id)).toEqual(['a'])
  })

  it('shows everything of a chosen topic', () => {
    expect(mapPointsFor(points, 'culture').map(p => p.id)).toEqual(['a', 'b', 'c'])
  })
})
