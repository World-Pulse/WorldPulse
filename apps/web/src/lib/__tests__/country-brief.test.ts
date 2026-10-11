import { describe, it, expect } from 'vitest'
import { signalsInCountry, countryBrief, type BriefSignal } from '../country-brief'
import type { CountryFeature } from '../country-shapes'

const sig = (id: string, extra: Partial<BriefSignal> = {}): BriefSignal => ({
  id, severity: 'medium', category: 'conflict', status: 'pending', country_code: null,
  lat: 0, lng: 0, created_at: '2026-10-11T00:00:00Z', ...extra,
})
const ukraine: CountryFeature = {
  type: 'Feature', properties: { iso_a2: 'UA' },
  geometry: { type: 'Polygon', coordinates: [[[22, 44], [40, 44], [40, 52], [22, 52], [22, 44]]] },
}

describe('signalsInCountry', () => {
  it("takes signals tagged with the country, and untagged ones whose pin is inside it", () => {
    const signals = [
      sig('tagged', { country_code: 'UA', lat: 0, lng: 0 }),            // tagged: the pin doesn't matter
      sig('inside', { lat: 50.4, lng: 30.5 }),                           // untagged, in Kyiv
      sig('elsewhere', { country_code: 'PL', lat: 50.2, lng: 23.0 }),   // tagged Poland near the border
      sig('outside', { lat: 52.5, lng: 13.4 }),                          // untagged, Berlin
    ]
    expect(signalsInCountry(signals, 'UA', ukraine).map(s => s.id)).toEqual(['tagged', 'inside'])
  })
})

describe('countryBrief', () => {
  it('counts by severity and topic, newest first', () => {
    const brief = countryBrief([
      sig('a', { severity: 'critical', status: 'verified', created_at: '2026-10-11T03:00:00Z' }),
      sig('b', { severity: 'high', category: 'disaster', created_at: '2026-10-11T05:00:00Z' }),
      sig('c', { severity: 'low', category: 'conflict', created_at: '2026-10-11T01:00:00Z' }),
      sig('d', { severity: 'info', category: '', created_at: 'not a date' }),
    ], 3)
    expect(brief.total).toBe(4)
    expect(brief.verified).toBe(1)
    expect(brief.bySeverity).toEqual({ critical: 1, high: 1, medium: 0, low: 2 })   // info counts as low
    expect(brief.categories).toEqual([{ category: 'conflict', count: 2 }, { category: 'disaster', count: 1 }, { category: 'other', count: 1 }])
    expect(brief.latest.map(s => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('is empty for no signals', () => {
    expect(countryBrief([])).toMatchObject({ total: 0, verified: 0, categories: [], latest: [] })
  })
})
