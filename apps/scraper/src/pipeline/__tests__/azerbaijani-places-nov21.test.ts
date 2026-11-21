/**
 * Nov 21, 2026 live read (H-0067): Azerbaijani stories on a state visit to Vietnam wrote Hanoi as "Hanoyda" (in Hanoi)
 * and had no pin. Hanoy, Vyetnam, Pekin and Yaponiya are read with their Azerbaijani endings.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const az = (text: string) => placeFromText(withLocalNames(text, 'az'))

describe('Azerbaijani place names with endings', () => {
  it('pins a lunch in Hanoyda in Vietnam', () => {
    expect(az('Hanoyda İlham Əliyev və Mehriban Əliyeva üçün rəsmi nahar verilib').countryCode).toBe('VN')
  })
  it('reads Vyetnamın, Pekində and Yaponiyada', () => {
    expect(az('Vyetnamın prezidenti çıxış etdi').countryCode).toBe('VN')
    expect(az('Pekində görüş keçirilib').countryCode).toBe('CN')
    expect(az('Yaponiyada zəlzələ baş verib').countryCode).toBe('JP')
  })
  it('keeps Baku and unrelated words', () => {
    expect(az('Bakıda yeni metro stansiyası açılıb').countryCode).toBe('AZ')
  })
})
