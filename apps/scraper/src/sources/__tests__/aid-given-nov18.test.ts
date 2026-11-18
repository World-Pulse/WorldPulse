/**
 * A country named as who is helped or fought is not where the story is (geo.ts AID_GIVEN, FOUGHT_AGAINST; Nov 18, 2026:
 * "US Arrests Alleged Russian Agent for Spying on Defense Firm Aiding Ukraine" sat in Ukraine).
 */
import { describe, it, expect } from 'vitest'
import { withoutNonPlaceNames } from '../../pipeline/geo'

describe('a country helped or fought', () => {
  it('is blanked out of the headline', () => {
    const [a] = withoutNonPlaceNames('US Arrests Alleged Russian Agent for Spying on Defense Firm Aiding Ukraine', '', 'UA')
    expect(a).not.toMatch(/Ukraine/)
    const [b] = withoutNonPlaceNames('Prince Harry says he would return to the Army to fight against Russia', '', 'AR')
    expect(b).not.toMatch(/Russia/)
    const [c] = withoutNonPlaceNames('Harry volvería al Ejército para combatir contra Rusia', '', 'AR')
    expect(c).not.toMatch(/Rusia/)
  })
  it('leaves a place the story names and plain "against"', () => {
    const [a] = withoutNonPlaceNames('Firm aiding Ukraine opens plant in Warsaw', '', 'PL')
    expect(a).toMatch(/Warsaw/)
    const [b] = withoutNonPlaceNames('New sanctions against Russia announced', '', 'US')
    expect(b).toMatch(/Russia/)
  })
})
