/**
 * Foreign capitals in the cases a Montenegrin or Serbian sentence puts them in. Nov 16, 2026: Portal Analitika's
 * "Podrška evropskih liberala u Dablinu…" sat at Podgorica and "Drakić na Bečkom ekonomskom forumu" too.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const sr = (text: string) => placeFromText(withLocalNames(text, 'sr'))

describe('capitals in a Montenegrin sentence', () => {
  it('reads Dublin behind "u Dablinu"', () => {
    expect(sr('Podrška evropskih liberala u Dablinu bržem članstvu Crne Gore u EU')).toMatchObject({ countryCode: 'IE' })
  })
  it('reads Vienna behind "Bečkom"', () => {
    expect(sr('Drakić na Bečkom ekonomskom forumu: evropske integracije kao prilika')).toMatchObject({ countryCode: 'AT' })
  })
  it('reads other capitals in their cases', () => {
    expect(sr('Sastanak u Parizu').countryCode).toBe('FR')
    expect(sr('Samit u Varšavi').countryCode).toBe('PL')
    expect(sr('Posjeta Budimpešti').countryCode).toBe('HU')
  })
  it('leaves other languages alone', () => {
    expect(withLocalNames('Dablin talks', 'en')).toBe('Dablin talks')
  })
})
