/**
 * Nov 17, 2026: a California outlet's story from Santa Cruz sat at Washington DC (the name is also Bolivia's, Spain's
 * and Chile's, so it is read only for American outlets).
 */
import { describe, it, expect } from 'vitest'
import { homePlaceFromText, findGazetteerPlace } from '../geo'

describe('Santa Cruz for American outlets', () => {
  it('is California for a US outlet', () => {
    const p = homePlaceFromText('ICE agents use pepper spray, shove protestor to the ground in Santa Cruz', 'US')
    expect(p).toMatchObject({ name: 'Santa Cruz', countryCode: 'US' })
  })
  it('is not read for other countries\' outlets or without a country', () => {
    expect(homePlaceFromText('Protest in Santa Cruz', 'GB')).toBeNull()
    expect(homePlaceFromText('Protest in Santa Cruz', 'BO')?.countryCode).not.toBe('US')
    expect(findGazetteerPlace('Protest in Santa Cruz')).toBeNull()
  })
})
