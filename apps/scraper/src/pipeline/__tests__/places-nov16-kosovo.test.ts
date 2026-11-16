/**
 * Kosovo's smaller towns by their Albanian names. Nov 16, 2026: an Albanian outlet's story from Han i Elezit sat at
 * Skopje, the outlet's home.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const sq = (text: string) => placeFromText(withLocalNames(text, 'sq'))

describe('Kosovo towns in an Albanian sentence', () => {
  it('reads Han i Elezit and Hani i Elezit', () => {
    expect(sq('Kontrollet në Han i Elezit shtohen para festave')).toMatchObject({ countryCode: 'XK' })
    expect(sq('Kolona te Hani i Elezit')).toMatchObject({ countryCode: 'XK' })
  })
  it('reads other towns', () => {
    expect(sq('Aksident në Kaçanik').countryCode).toBe('XK')
    expect(sq('Zjarr në Lipjan').countryCode).toBe('XK')
    expect(sq('Protestë në Fushë Kosovë').countryCode).toBe('XK')
    expect(sq('Ujë i pijshëm në Rahovec').countryCode).toBe('XK')
  })
})
