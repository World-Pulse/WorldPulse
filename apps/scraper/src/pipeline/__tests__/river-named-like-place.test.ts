/**
 * A river named like a state is not that state. Nov 13, 2026: "180 aboard cruise ship rescued after Mississippi River
 * tanker crash in New Orleans" sat in central Mississippi, 300 km from the crash.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText, withoutNonPlaceNames } from '../geo'

const read = (t: string) => placeFromText(withoutNonPlaceNames(t, '', 'US')[0])

describe('rivers named like a state', () => {
  it('reads the city, not the state', () => {
    expect(read('180 aboard cruise ship rescued safely after Mississippi River tanker crash in New Orleans')).toMatchObject({ name: 'New Orleans' })
    expect(read('Barge hits bridge on Mississippi River near Memphis')).toMatchObject({ name: 'Memphis' })
  })
  it('keeps the pin when the river is the only place named', () => {
    expect(read('Mississippi River levels fall').countryCode).toBe('US')
  })
  it('leaves the state alone', () => {
    expect(read('Mississippi governor signs bill')).toMatchObject({ name: 'Mississippi' })
  })
})
