import { describe, it, expect } from 'vitest'
import { actionGeoIsNamed } from '../gdelt'

describe('actionGeoIsNamed (Nov 8, 2026)', () => {
  it('a US politics story coded Iran is not Iran', () => {
    expect(actionGeoIsNamed('IR', 'Democrats turn up heat on Hegseth, vow impeachment push after midterm victories')).toBe(false)
  })
  it('keeps a country the text names', () => {
    expect(actionGeoIsNamed('IR', 'Iran says it will resume talks')).toBe(true)
    expect(actionGeoIsNamed('IR', 'Iranian drones hit a tanker')).toBe(true)
  })
  it('keeps the place when GDELT coded none', () => {
    expect(actionGeoIsNamed('', 'Anything at all')).toBe(true)
  })
})
