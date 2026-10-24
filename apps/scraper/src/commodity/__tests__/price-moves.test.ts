/**
 * Price moves (Oct 23, 2026): the World Bank's September 2026 prices (Brent $116.80 a barrel, up 28.5%
 * on the month; Arabica $7.26/kg, down 8.9%; soybeans $524/t, up 8.7%) over a country's exports.
 */

import { describe, it, expect } from 'vitest'
import { priceMoves, seriesFor } from '../price-moves'
import type { PartnersSnapshot } from '../../sources/baci-trade'
import type { PricesSnapshot, PriceSeries } from '../../sources/worldbank-prices'

const series = (key: string, name: string, unit: string, value: number, m: number, y: number, month = '2026-09'): PriceSeries =>
  ({ key, name, unit, month, value, previous: null, year_ago: null, change_month_pct: m, change_year_pct: y, highest_since: null, lowest_since: null, history: { start: '2021-10', values: [] } })

const PRICES: PricesSnapshot = {
  source: 'World Bank Commodity Price Data (The Pink Sheet)', licence: 'CC BY 4.0', file_url: 'x', file_date: null, updated: '2026-10-02', month: '2026-09',
  series: {
    'crude-oil-brent': series('crude-oil-brent', 'Crude oil, Brent', '$/bbl', 116.8, 28.5, 71.8),
    'coffee-arabica': series('coffee-arabica', 'Coffee, Arabica', '$/kg', 7.26, -8.9, -17.8),
    soybeans: series('soybeans', 'Soybeans', '$/mt', 524, 8.7, 19.4),
    gold: series('gold', 'Gold', '$/troy oz', 4319, -2.1, 17.7, '2026-08'),     // a month old: not this month's
  },
}

const flows = (value: number) => ({ value, tonnes: null, top: [] })
const PARTNERS = {
  year: 2024, release: '202601', source: 'CEPII BACI (Gaulier and Zignago, 2010), from UN trade statistics', licence: 'Etalab Open Licence 2.0', file_url: 'x',
  names: { soybeans: 'Soybeans', coffee: 'Coffee', 'crude-oil': 'Crude oil', gold: 'Gold' },
  countries: {
    BR: { name: 'Brazil', exports: { soybeans: flows(50_000_000), coffee: flows(12_000_000), 'crude-oil': flows(40_000_000), gold: flows(5_000_000) }, imports: {},
      total: { exports: 330_000_000, imports: 260_000_000, buyers: [], suppliers: [], exports_by: [], imports_by: [] } },
    AF: { name: 'Afghanistan', exports: { coffee: flows(9) }, imports: {} },
  },
} as unknown as PartnersSnapshot

describe('price moves', () => {
  const snap = priceMoves(PARTNERS, PRICES, { report_date: '2026-10-20', markets: [{ code: '083731', name: 'coffee', net: 31_200, previous_net: 10_400 }] } as never, new Date('2026-10-24T03:00:00Z'))

  it("weighs each price by the country's exports of it", () => {
    expect(snap.countries.BR).toMatchObject({ name: 'Brazil', month_pct: 14.4, year_pct: 35.6, exposed_pct: 30.9, basket: 102_000_000 })
    expect(snap.countries.BR!.items.map(i => [i.commodity, i.share, i.price.key])).toEqual([
      ['soybeans', 49, 'soybeans'], ['crude-oil', 39.2, 'crude-oil-brent'], ['coffee', 11.8, 'coffee-arabica'],
    ])
  })

  it("adds hedge funds' positions where there's a market, and its sources", () => {
    expect(snap.countries.BR!.items.find(i => i.commodity === 'coffee')!.funds).toEqual({ market: 'coffee', net: 31_200, previous_net: 10_400 })
    expect(snap).toMatchObject({ month: '2026-09', trade_year: 2024, sources: { funds: 'CFTC Commitments of Traders, 2026-10-20' } })
  })

  it('leaves out small baskets and prices that stopped', () => {
    expect(snap.countries.AF).toBeUndefined()
    expect(seriesFor('gold', PRICES)).toBeNull()
    expect(seriesFor('crude-oil', PRICES)!.key).toBe('crude-oil-brent')   // no "average" series: Brent
  })
})
