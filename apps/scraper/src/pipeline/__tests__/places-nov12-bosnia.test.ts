/**
 * Bosnian and Serbian towns in the cases a sentence puts them in, read for outlets in Serbian/Montenegrin
 * (language "sr"). Nov 12, 2026: Portal Analitika's "…u psihijatrijskoj bolnici u Zenici" (Zenica) sat at Podgorica,
 * the outlet's home, because only "Zenica" itself was known.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const sr = (text: string) => placeFromText(withLocalNames(text, 'sr'))

describe('Bosnian and Serbian towns in a sentence', () => {
  it('reads the town behind "u Zenici"', () => {
    expect(sr('Nasilje nad pacijentom u psihijatrijskoj bolnici u Zenici: Uprava predala policiji i videosnimke')).toMatchObject({ countryCode: 'BA', name: 'Zenica' })
  })
  it('reads other towns in their cases', () => {
    expect(sr('Požar u Tuzli, vatrogasci na terenu').countryCode).toBe('BA')
    expect(sr('Saobraćajna nesreća kod Mostara').countryCode).toBe('BA')
    expect(sr('Protest u Banjoj Luci').countryCode).toBe('BA')
    expect(sr('Uhapšen u Bijeljini').countryCode).toBe('BA')
    expect(sr('Utakmica u Novom Sadu').countryCode).toBe('RS')
  })
  it('leaves other languages and plain text alone', () => {
    expect(withLocalNames('Zenica police said', 'en')).toBe('Zenica police said')
  })
})
