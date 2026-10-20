/**
 * Places the round-3 feed search found misread (Oct 20, 2026): "Congress"
 * that is a party or another country's congress isn't Washington; São Tomé
 * with its accent, and Spanish "Guinea Ecuatorial", are their own countries.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { inferGeo } = await import('../news-rss')
const { placeFromText } = await import('../../pipeline/geo')

const src = { id: 'no-pin', defaultLat: 0, defaultLng: 0, defaultLocation: 'x', countryCode: 'SL' } as never
const country = (title: string) => inferGeo(title, '', src).countryCode

describe('the "congress" hint', () => {
  it("doesn't place a party's or another country's congress in Washington", () => {
    expect(country("All People's Congress names new chairman")).not.toBe('US')
    expect(country('Nigeria: All Progressives Congress primaries postponed')).toBe('NG')
    expect(country('African National Congress elects new leader')).not.toBe('US')
    expect(country('Congress slams BJP over fuel prices')).not.toBe('US')
    expect(country("China's National People's Congress approves new law")).toBe('CN')
  })

  it('still places the US Congress in Washington', () => {
    expect(country('Congress passes $1.2 trillion spending bill')).toBe('US')
    expect(country('Senators in Congress grill Pentagon chief')).toBe('US')
  })
})

describe('country names', () => {
  it('reads São Tomé with or without its accents', () => {
    expect(placeFromText('Eleições em São Tomé e Príncipe').countryCode).toBe('ST')
    expect(placeFromText('Sao Tome votes').countryCode).toBe('ST')
  })

  it('reads Spanish "Guinea Ecuatorial" as Equatorial Guinea, not Guinea', () => {
    expect(placeFromText('Elecciones en Guinea Ecuatorial').countryCode).toBe('GQ')
    expect(placeFromText('Guinea elects a president').countryCode).toBe('GN')
  })
})
