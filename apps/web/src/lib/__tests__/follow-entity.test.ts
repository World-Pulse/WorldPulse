/**
 * Following a person, place or organisation (plan K6; Devon, Oct 21, 2026):
 * the alert the Follow button makes.
 */
import { describe, it, expect } from 'vitest'
import { followAlertBody, followAlertName } from '../follow-entity'

describe('the Follow alert', () => {
  it('is named after it, matches its name, and comes once a day', () => {
    expect(followAlertName(' NATO ')).toBe('Follow: NATO')
    expect(followAlertBody('NATO')).toEqual({
      name: 'Follow: NATO', keywords: ['NATO'], minSeverity: 'low',
      channels: { email: true, push: false, in_app: true, digest: 'daily' },
    })
  })
  it('fits the API\'s limits', () => {
    const long = 'Organization for Security and Co-operation in Europe and a much longer imaginary suffix to pass one hundred'
    expect(followAlertName(long).length).toBeLessThanOrEqual(100)
    expect(followAlertBody(long).keywords[0]!.length).toBeLessThanOrEqual(100)
  })
})
