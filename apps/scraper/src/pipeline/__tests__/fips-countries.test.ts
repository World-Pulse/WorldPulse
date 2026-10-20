import { describe, it, expect } from 'vitest'
import { FIPS_TO_ISO, isoFromFips, isoForStoredFips } from '../fips-countries'
import { countryNameOf } from '../world-countries'

describe('FIPS_TO_ISO (Oct 20, 2026, H-0022)', () => {
  it('maps to two-letter ISO codes and names', () => {
    for (const [fips, [iso, name]] of Object.entries(FIPS_TO_ISO)) {
      expect(fips).toMatch(/^[A-Z]{2}$/)
      expect(iso).toMatch(/^[A-Z]{2}$/)
      expect(name.length).toBeGreaterThan(2)
    }
  })

  it('knows the codes that mean a different country in ISO', () => {
    const pairs: Array<[string, string]> = [
      ['NI', 'NG'], ['NG', 'NE'], ['EI', 'IE'], ['AU', 'AT'], ['AS', 'AU'], ['GM', 'DE'], ['GA', 'GM'],
      ['CH', 'CN'], ['SZ', 'CH'], ['IS', 'IL'], ['IC', 'IS'], ['RS', 'RU'], ['RI', 'RS'], ['CD', 'TD'],
      ['CG', 'CD'], ['SG', 'SN'], ['SN', 'SG'], ['SW', 'SE'], ['SE', 'SC'], ['KS', 'KR'], ['KR', 'KI'],
      ['CN', 'KM'], ['UK', 'GB'], ['UP', 'UA'], ['BO', 'BY'], ['BL', 'BO'], ['SF', 'ZA'], ['ZA', 'ZM'],
      ['WE', 'PS'], ['GZ', 'PS'], ['PS', 'PW'], ['JA', 'JP'], ['TU', 'TR'], ['IZ', 'IQ'], ['BM', 'MM'],
    ]
    for (const [fips, iso] of pairs) expect(isoFromFips(fips)).toBe(iso)
  })

  it('gives null for codes without an ISO country, and reads lowercase and spaces', () => {
    expect(isoFromFips('OS')).toBeNull()
    expect(isoFromFips('PF')).toBeNull()
    expect(isoFromFips('')).toBeNull()
    expect(isoFromFips(null)).toBeNull()
    expect(isoFromFips(' ni ')).toBe('NG')
  })
})

describe('isoForStoredFips', () => {
  const fix = (code: string, place: string | null) => isoForStoredFips(code, place, countryNameOf)

  it('fixes a stored FIPS code when the place names that country', () => {
    expect(fix('NI', 'Lagos, Lagos, Nigeria')).toBe('NG')
    expect(fix('EI', 'Ireland')).toBe('IE')
    expect(fix('AU', 'Vienna, Wien, Austria')).toBe('AT')
    expect(fix('IS', 'Jerusalem, Israel')).toBe('IL')
    expect(fix('GM', 'Berlin, Germany')).toBe('DE')
    expect(fix('IV', "Abidjan, Lagunes, Côte d'Ivoire")).toBe('CI')
  })

  it("leaves a code that is right in ISO: the place names the ISO country", () => {
    expect(fix('NI', 'Managua, Nicaragua')).toBeNull()
    expect(fix('AU', 'Sydney, New South Wales, Australia')).toBeNull()
    expect(fix('IS', 'Reykjavik, Iceland')).toBeNull()
    expect(fix('CH', 'Zurich, Switzerland')).toBeNull()
  })

  it('leaves codes that are the same in both, and rows without a place', () => {
    expect(fix('US', 'Washington, District of Columbia, United States')).toBeNull()
    expect(fix('NI', null)).toBeNull()
    expect(fix('NI', 'Lagos')).toBeNull()
  })
})
