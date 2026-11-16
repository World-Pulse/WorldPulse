import { describe, expect, it } from 'vitest'
import { actionGeoIsNamed } from '../gdelt'

// Nov 15, 2026: GDELT codes the US state of Georgia as the country; its coded place is kept only on the country's own words
describe('GDELT\'s "Georgia" is the country only on its own words', () => {
  it('drops the coded country for the US state', () => {
    expect(actionGeoIsNamed('GE', 'Ossoff wins reelection in Georgia holding Senate seat for Democrats')).toBe(false)
    expect(actionGeoIsNamed('GE', 'Keisha Lance Bottoms becomes Georgia’s first black governor')).toBe(false)
    expect(actionGeoIsNamed('GE', 'Georgia elections 2026: 8 polling locations change in state’s largest county')).toBe(false)
    expect(actionGeoIsNamed('GE', 'Georgian voters head to the polls in Atlanta')).toBe(false)
  })
  it('keeps it for the country', () => {
    expect(actionGeoIsNamed('GE', 'Opposition launches ‘Georgia Without Ivanishvili’ campaign')).toBe(true)
    expect(actionGeoIsNamed('GE', 'Two teenagers arrested in Tbilisi over alleged plot to attack school')).toBe(true)
    expect(actionGeoIsNamed('GE', 'Georgian Dream moves to ban opposition parties')).toBe(true)
  })
  it('leaves other countries as before', () => {
    expect(actionGeoIsNamed('UA', 'Ukraine says drones hit Kharkiv')).toBe(true)
  })
})
