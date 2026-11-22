/**
 * The map's travel advisories layer (lib/travel-levels.ts): the API's levels made into the countries to shade.
 */
import { describe, it, expect } from 'vitest'
import { TRAVEL_LEVELS, travelShading, travelCounts } from '../travel-levels'

describe('travel advisory shading', () => {
  it('one colour a level, from normal precautions to do not travel', () => {
    expect(TRAVEL_LEVELS.map(l => l.level)).toEqual([1, 2, 3, 4])
    expect(new Set(TRAVEL_LEVELS.map(l => l.color)).size).toBe(4)
    expect(TRAVEL_LEVELS[3]).toMatchObject({ label: 'Do not travel', color: '#ef4444' })
  })

  it('shades each country by its level, once, and leaves out what is not a level or a country', () => {
    const rows = travelShading([
      { country: 'IR', level: 4, since: '2026-11-03' }, { country: 'FR', level: 2, since: null },
      { country: 'IR', level: 1, since: null }, { country: 'XX1', level: 2 }, { country: 'DE', level: 9 },
      { country: 'GB', level: '1' }, null, 'x',
    ])
    expect(rows).toEqual([{ iso: 'IR', color: '#ef4444', level: 4 }, { iso: 'FR', color: '#fde047', level: 2 }])
    expect(travelShading(undefined)).toEqual([])
    expect(travelShading({ levels: [] })).toEqual([])
  })

  it('counts the countries at each level', () => {
    expect(travelCounts([{ level: 4 }, { level: 2 }, { level: 2 }, { level: 1 }, { level: 7 }])).toEqual([1, 2, 0, 1])
  })
})
