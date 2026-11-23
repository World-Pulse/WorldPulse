import { it, expect } from 'vitest'
import { placeFromText, withoutNonPlaceNames } from '../geo'
const at = (t: string) => placeFromText(withoutNonPlaceNames(t, '', 'NG')[0])
it("'off Libya' is Libya's story, not the attacker's", () => {
  for (const t of ["Ukraine Strikes Russian Warship, Cargo Vessel Off Libya's Coast", 'Ukraine claims it sank Russian warship off Libya', 'Ukraine hits tanker off the coast of Libya'])
    expect(at(t).countryCode).toBe('LY')
  expect(at('Ukraine claims it sank warship').countryCode).toBe('UA')
})
