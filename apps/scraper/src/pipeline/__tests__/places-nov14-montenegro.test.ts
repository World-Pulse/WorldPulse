/**
 * Montenegro's towns and Sofia in the cases a sentence puts them in, read for outlets in Serbian/Montenegrin.
 * Nov 14, 2026: Aktuelno's "Planirana zaobilaznica oko Bara" (Bar) and "CNP na ETC konferenciji u Sofiji" (Sofia) sat at
 * Podgorica, the outlet's home.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const sr = (text: string) => placeFromText(withLocalNames(text, 'sr'))

describe('Montenegrin towns and Sofia in a sentence', () => {
  it('reads Bar behind a place preposition', () => {
    expect(sr('Nenezić: Planirana zaobilaznica oko Bara prijeti da ugrozi maslinu')).toMatchObject({ countryCode: 'ME', countryCode: 'ME' })
    expect(sr('Požar u Baru, vatrogasci na terenu')).toMatchObject({ countryCode: 'ME', countryCode: 'ME' })
  })
  it('reads Sofia behind a place preposition, not Sofija the name', () => {
    expect(sr('CNP na ETC konferenciji u Sofiji: Umjetnička sloboda')).toMatchObject({ countryCode: 'BG' })
    expect(sr('Sofija Vergara u Podgorici').name).toBe('Podgorica')
  })
  it('reads other northern towns', () => {
    for (const t of ['Požar u Kolašinu', 'Nesreća u Žabljaku', 'Protest u Rožajama', 'Pljačka u Mojkovcu', 'Skup u Danilovgradu'])
      expect(sr(t).countryCode, t).toBe('ME')
  })
  it('leaves the word "bar" and other languages alone', () => {
    expect(withLocalNames('Otvoren novi bar u centru', 'sr')).toBe('Otvoren novi bar u centru')
    expect(withLocalNames('oko Bara', 'en')).toBe('oko Bara')
  })
})
