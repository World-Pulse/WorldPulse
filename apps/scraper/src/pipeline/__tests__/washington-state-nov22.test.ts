/**
 * Nov 22, 2026 live read: "Washington governor, union denounce ICE arrests of travelers at Seattle airport" sat at
 * Washington, D.C. (Investing.com, The News International). Washington state's governor is not the capital city.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText, withoutNonPlaceNames } from '../geo'

const city = (text: string) => placeFromText(withoutNonPlaceNames(text, '', 'US')[0])

describe('Washington state and Washington, D.C.', () => {
  it('does not pin the governor of Washington state at the capital', () => {
    const p = city('Washington governor, union denounce ICE arrests of travelers at Seattle airport')
    expect(p.countryCode).toBe('US')
    expect(p.lat).not.toBeCloseTo(38.9, 0)
  })
  it('keeps the capital when the text means it', () => {
    const p = city('Trump says he would work with Democrats in Washington')
    expect(p.lat).toBeCloseTo(38.9, 0)
  })
})
