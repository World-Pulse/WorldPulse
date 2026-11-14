/**
 * Chile's Justice Minister Fernando Rabat is not Morocco's capital.
 * Nov 14, 2026: Radio Cooperativa's story on decrees "firmados por el ministro Fernando Rabat" was pinned at Rabat, Morocco.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'

describe('Rabat the surname and Rabat the city', () => {
  it('does not pin the minister at Morocco', () => {
    const t = 'Mirosevic acudirá al Consejo para la Transparencia. El Ministerio entregó 300 decretos, 17 firmados por el ministro Fernando Rabat'
    expect(placeFromText(t)?.countryCode).not.toBe('MA')
    expect(placeFromText('Decretos firmados por la ministra de Justicia Rabat')?.countryCode).not.toBe('MA')
  })
  it('still pins the city', () => {
    expect(placeFromText('King Mohammed VI receives envoys in Rabat')).toMatchObject({ countryCode: 'MA' })
    expect(placeFromText('Rabat: Morocco opens a new tram line')).toMatchObject({ countryCode: 'MA' })
  })
})
