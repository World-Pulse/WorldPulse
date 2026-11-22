/**
 * Nov 22, 2026 live read: "Air alert sounds hours after attack on Russia-bound ship in the Gulf of Finland"
 * (ABC News) sat at Moscow because only "Russia" was read.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText, withoutNonPlaceNames } from '../geo'

const city = (text: string) => placeFromText(withoutNonPlaceNames(text, '', 'US')[0])

describe('Gulf of Finland', () => {
  it('pins a ship attack at the gulf, not at Moscow', () => {
    const p = city('Air alert sounds hours after attack on Russia-bound ship in the Gulf of Finland')
    expect(p.lat).toBeCloseTo(59.8, 0)
    expect(p.lng).toBeCloseTo(25.0, 0)
  })
})
