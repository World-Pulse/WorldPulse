/**
 * The map's share picture (plan M29, Oct 15, 2026): what it says (lib/map-card.tsx).
 */
import { describe, it, expect } from 'vitest'
import { busiestPlaces, mapCardText } from '../map-card'

const pts = (...codes: Array<string | null>) => codes.map(country_code => ({ country_code }))

describe('busiestPlaces', () => {
  it('ranks countries by how many points they have, ties by code', () => {
    const r = busiestPlaces(pts('UA', 'US', 'UA', 'IL', 'US', 'UA'))
    expect(r).toEqual([{ name: 'Ukraine', count: 3 }, { name: 'United States', count: 2 }, { name: 'Israel', count: 1 }])
  })

  it('skips missing and malformed codes and keeps at most the limit', () => {
    expect(busiestPlaces(pts(null, '', 'XYZ', 'FR'))).toEqual([{ name: 'France', count: 1 }])
    expect(busiestPlaces(pts('FR', 'DE', 'IT', 'ES'), 2)).toHaveLength(2)
  })
})

describe('mapCardText', () => {
  it('writes the day in thousands separators', () => {
    const t = mapCardText({ verified24h: 1125, outlets24h: 1387, countries24h: 195 }, pts('UA'))
    expect(t?.stats.map(s => s.value)).toEqual(['1,125', '1,387', '195'])
    expect(t?.places).toEqual([{ name: 'Ukraine', count: '1 on the map' }])
  })

  it('has no card when nothing was verified or reported', () => {
    expect(mapCardText({ verified24h: 0, outlets24h: 0, countries24h: 0 }, [])).toBeNull()
  })
})
