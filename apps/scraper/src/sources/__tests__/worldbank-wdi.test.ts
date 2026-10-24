/**
 * Country economics from the World Bank's World Development Indicators (Oct 23, 2026). The rows are
 * the API's own (country list and GDP growth, as served on Oct 23: the 2025 figures).
 */

import { describe, it, expect } from 'vitest'
import { readCountries, readIndicator, buildSnapshot, INDICATORS, type EconomicsSnapshot } from '../worldbank-wdi'

const COUNTRIES = [{ page: 1, pages: 1, per_page: '400', total: 296 }, [
  { id: 'AFE', iso2Code: 'ZH', name: 'Africa Eastern and Southern', region: { id: 'NA', iso2code: 'NA', value: 'Aggregates' }, incomeLevel: { id: 'NA', iso2code: 'NA', value: 'Aggregates' } },
  { id: 'BRA', iso2Code: 'BR', name: 'Brazil', region: { id: 'LCN', iso2code: 'ZJ', value: 'Latin America & Caribbean ' }, incomeLevel: { id: 'UMC', iso2code: 'XT', value: 'Upper middle income' } },
  { id: 'EGY', iso2Code: 'EG', name: 'Egypt, Arab Rep.', region: { id: 'MEA', iso2code: 'ZQ', value: 'Middle East, North Africa, Afghanistan & Pakistan' }, incomeLevel: { id: 'LMC', iso2code: 'XN', value: 'Lower middle income' } },
  { id: 'KOR', iso2Code: 'KR', name: 'Korea, Rep.', region: { id: 'EAS', iso2code: 'Z4', value: 'East Asia & Pacific' }, incomeLevel: { id: 'HIC', iso2code: 'XD', value: 'High income' } },
  { id: 'WLD', iso2Code: '1W', name: 'World', region: { id: 'NA', iso2code: 'NA', value: 'Aggregates' }, incomeLevel: { id: 'NA', iso2code: 'NA', value: 'Aggregates' } },
  { id: 'XKX', iso2Code: 'XK', name: 'Kosovo', region: { id: 'ECS', iso2code: 'Z7', value: 'Europe & Central Asia' }, incomeLevel: { id: 'UMC', iso2code: 'XT', value: 'Upper middle income' } },
]]

const row = (iso3: string, id: string, name: string, value: number | null, date = '2025') =>
  ({ indicator: { id: 'NY.GDP.MKTP.KD.ZG', value: 'GDP growth (annual %)' }, country: { id, value: name }, countryiso3code: iso3, date, value, obs_status: '', decimal: 1 })
const GROWTH = [{ page: 1, pages: 1, per_page: 500, total: 262, sourceid: null, lastupdated: '2026-10-08' }, [
  row('AFE', 'ZH', 'Africa Eastern and Southern', 3.7430158719504),
  row('WLD', '1W', 'World', 2.92127318539153),
  row('BRA', 'BR', 'Brazil', 2.2857464902475),
  row('EGY', 'EG', 'Egypt, Arab Rep.', 4.39201068570188),
  row('KOR', 'KR', 'Korea, Rep.', 1.00701840291242),
  row('XKX', 'XK', 'Kosovo', 3.59217142544483),
]]

describe("the World Bank's country figures", () => {
  const countries = readCountries(COUNTRIES)

  it('keeps countries, not aggregates, under plain names', () => {
    expect([...countries.values()].map(c => c.iso2)).toEqual(['BR', 'EG', 'KR', 'XK'])
    expect(countries.get('EGY')).toEqual({ iso2: 'EG', name: 'Egypt', region: 'Middle East, North Africa, Afghanistan & Pakistan', income: 'Lower middle income' })
    expect(countries.get('KOR')!.name).toBe('South Korea')
    expect(countries.get('BRA')!.region).toBe('Latin America & Caribbean')
  })

  it("reads an indicator's latest value per country", () => {
    const growth = readIndicator(GROWTH, countries)
    expect([...growth.keys()]).toEqual(['BR', 'EG', 'KR', 'XK'])
    expect(growth.get('BR')).toEqual({ value: 2.286, year: 2025 })
  })

  it("builds the snapshot, keeping an indicator's last values when it couldn't be read", () => {
    const previous = { countries: { BR: { name: 'Brazil', region: null, income: null, values: { inflation: { value: 5.1, year: 2025 }, growth: { value: 3.4, year: 2024 } } } } } as unknown as EconomicsSnapshot
    const readings = new Map(INDICATORS.map(i => [i.key, i.key === 'growth' ? readIndicator(GROWTH, countries) : null]))
    const snap = buildSnapshot(countries, readings, previous, new Date('2026-10-24T03:00:00Z'))
    expect(snap).toMatchObject({ source: 'World Bank, World Development Indicators', licence: 'CC BY 4.0', updated_at: '2026-10-24T03:00:00.000Z' })
    // Growth is new; inflation couldn't be read, so its stored value stays
    expect(snap.countries.BR!.values).toEqual({ growth: { value: 2.286, year: 2025 }, inflation: { value: 5.1, year: 2025 } })
    expect(Object.keys(snap.countries)).toEqual(['BR', 'EG', 'KR', 'XK'])
  })
})
