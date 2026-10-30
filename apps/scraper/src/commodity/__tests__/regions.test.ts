/**
 * The crop regions table (Oct 23, 2026): every row well formed.
 */

import { describe, it, expect } from 'vitest'
import { REGIONS, regionsOf, pointKey } from '../regions'
import { BY_KEY } from '../catalog'
import { COUNTRIES } from '../countries'

describe('the crop regions', () => {
  it('has a known commodity with weather rules, a named country and a 12-month calendar in every row', () => {
    for (const r of REGIONS) {
      expect(BY_KEY.get(r.commodity)?.weather, r.id).toBeTruthy()
      expect(COUNTRIES.has(r.iso), r.id).toBe(true)
      expect(r.calendar, r.id).toHaveLength(12)
      expect(r.calendar.every(s => 'OPGBFH'.includes(s)), r.id).toBe(true)
      expect(r.share > 0 && r.share <= 1, r.id).toBe(true)
      expect(Math.abs(r.lat) <= 60 && Math.abs(r.lon) <= 180, r.id).toBe(true)
    }
  })

  it('gives each row its own id, and EU rows their member state', () => {
    expect(new Set(REGIONS.map(r => r.id)).size).toBe(REGIONS.length)
    expect(REGIONS.filter(r => r.iso === 'EU').every(r => r.country !== 'EU' && r.country.length === 2)).toBe(true)
    expect(regionsOf('wheat', 'EU').map(r => r.country)).toEqual(['FR', 'DE', 'PL', 'RO', 'BG', 'ES', 'IT', 'HU', 'CZ', 'LT', 'DK', 'SE'])
    // US wheat by NASS's 2025-26 production: Kansas and North Dakota still lead the country's level (a share of 0.15 or more)
    expect(regionsOf('wheat', 'US').map(r => r.place)).toEqual(['Kansas', 'Oklahoma', 'North Dakota', 'Montana', 'Montana', 'Washington', 'Oregon', 'Minnesota'])
    expect(regionsOf('wheat', 'US').filter(r => r.share >= 0.15).map(r => r.place)).toEqual(['Kansas', 'North Dakota'])
  })

  it("keeps each country's shares of a crop within the whole", () => {
    const totals = new Map<string, number>()
    for (const r of REGIONS) totals.set(`${r.commodity}:${r.iso}`, (totals.get(`${r.commodity}:${r.iso}`) ?? 0) + r.share)
    for (const [k, t] of totals) expect(t, k).toBeLessThanOrEqual(1.0001)
  })

  it('shares forecasts between regions at the same spot', () => {
    expect(pointKey(-12.55, -55.71)).toBe('-12.55,-55.71')
    const points = new Set(REGIONS.map(r => pointKey(r.lat, r.lon)))
    expect(points.size).toBeLessThan(REGIONS.length)
  })
})
