/**
 * Nov 21, 2026 live read: Turkish "kabul edildi" (was accepted) pinned Evrensel's "İBB'nin 2027 mali yılı bütçesi
 * kabul edildi" in Kabul, Afghanistan. Kabul is now read only as written, with its capital.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'

const country = (text: string) => placeFromText(text).countryCode ?? null

describe('Kabul the city and Turkish "kabul" (accepted)', () => {
  it('does not pin a Turkish budget vote in Afghanistan', () => {
    expect(country("İBB'nin 2027 mali yılı bütçesi kabul edildi")).not.toBe('AF')
  })
  it('still finds the city as written', () => {
    expect(country('Explosion rocks Kabul on Friday')).toBe('AF')
  })
})
