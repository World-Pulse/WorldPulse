import { describe, it, expect } from 'vitest'
import { toStringList, toHotspot, hotspotPlace } from '../hotspots'

describe('toStringList', () => {
  it('reads arrays and Postgres array text', () => {
    expect(toStringList(['conflict', 'health'])).toEqual(['conflict', 'health'])
    expect(toStringList('{breaking,conflict,"sci fi"}')).toEqual(['breaking', 'conflict', 'sci fi'])
    expect(toStringList('{}')).toEqual([])
    expect(toStringList(null)).toEqual([])
  })
})

describe('toHotspot', () => {
  it('turns the old string categories into a list (they crashed the map)', () => {
    const hs = toHotspot({ centerLat: '51.5', centerLng: -0.49, signalCount: 1338, categoryCount: 16, categories: '{breaking,conflict}', maxSeverity: 'low', sampleTitles: ['A'], sampleIds: null })
    expect(hs?.categories).toEqual(['breaking', 'conflict'])
    expect(hs?.centerLat).toBe(51.5)
    expect(hs?.sampleIds).toEqual([])
    expect(hs?.place).toBeNull()
  })

  it('drops hotspots without a position', () => {
    expect(toHotspot({ centerLat: null, centerLng: 3 })).toBeNull()
    expect(toHotspot('nope')).toBeNull()
  })

  it('names the place when it is known', () => {
    expect(hotspotPlace({ place: 'Kyiv, Ukraine', centerLat: 50.45, centerLng: 30.52 })).toBe('Kyiv, Ukraine')
    expect(hotspotPlace({ place: null, centerLat: 50.45, centerLng: 30.52 })).toBe('50.5°, 30.5°')
  })
})
