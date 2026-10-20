import { describe, it, expect } from 'vitest'
import { scoreOf } from '../score'

// V3f (Oct 20, 2026): most of the API answered "reliabilityScore": "0.925",
// the Postgres decimal as text
describe('scoreOf', () => {
  it('turns the decimal the driver sends as text into a number', () => {
    expect(scoreOf('0.925')).toBe(0.925)
    expect(scoreOf(0.5)).toBe(0.5)
    expect(scoreOf('1')).toBe(1)
  })
  it('is null when there is no score', () => {
    expect(scoreOf(null)).toBeNull()
    expect(scoreOf(undefined)).toBeNull()
    expect(scoreOf('')).toBeNull()
    expect(scoreOf('n/a')).toBeNull()
  })
})
