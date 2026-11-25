/**
 * Nov 25, 2026 live read: "Pakistani astronaut, Chinese crew reach Tiangong space station as Shenzhou-24 docks
 * successfully" (Dunya News) sat at Shenzhou City, Hebei: a spacecraft's name is not a town.
 */
import { describe, it, expect } from 'vitest'
import { withoutNonPlaceNames } from '../geo'

describe('spacecraft names', () => {
  it('blanks Shenzhou and Tiangong', () => {
    const [h] = withoutNonPlaceNames('Pakistani astronaut, Chinese crew reach Tiangong space station as Shenzhou-24 docks successfully', '', 'PK')
    expect(h).not.toMatch(/Shenzhou|Tiangong/)
    expect(h).toMatch(/Chinese/)
  })
  it('leaves the town alone', () => {
    const [h] = withoutNonPlaceNames('Flood hits Shenzhou city in Hebei', '', 'CN')
    expect(h).toMatch(/Shenzhou/)
  })
})
