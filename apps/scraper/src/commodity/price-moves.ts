/**
 * Price moves: how commodity prices moved each country's exports (Oct 23, 2026; Devon: "Add ... CME
 * like data ... and layers to the map").
 *
 * CME's futures prices need CME's licence. What can be published: the World Bank's monthly prices
 * (CC BY 4.0) and hedge funds' positions from the CFTC (US government data). For each country, its
 * exports of the commodities the World Bank prices (CEPII BACI, the latest year, by value), each
 * weighted by its export value, and how their prices moved on the month and on the year: a country
 * that sells mostly crude oil moves with oil, a coffee exporter with coffee. Worked out in each round
 * of the commodity watch.
 */

import { BY_KEY } from './catalog'
import type { CftcSnapshot } from './cards'
import type { PartnersSnapshot } from '../sources/baci-trade'
import type { PricesSnapshot, PriceSeries } from '../sources/worldbank-prices'

export const PRICE_MOVES_KEY = 'commodity:price-moves:latest'

/** The World Bank series and CFTC market for the commodities the watch's catalog doesn't have */
export const EXTRA: Record<string, { prices: string[]; cftc: string | null }> = {
  'crude-oil': { prices: ['crude-oil-average', 'crude-oil-brent'], cftc: '067651' },
  'natural-gas': { prices: ['natural-gas-index', 'natural-gas-europe', 'liquefied-natural-gas-japan'], cftc: '023651' },
  coal: { prices: ['coal-australian', 'coal-south-african'], cftc: null },
  'iron-ore': { prices: ['iron-ore-cfr-spot'], cftc: null },
  copper: { prices: ['copper'], cftc: '085692' },
  aluminium: { prices: ['aluminum'], cftc: null },
  nickel: { prices: ['nickel'], cftc: null },
  zinc: { prices: ['zinc'], cftc: null },
  lead: { prices: ['lead'], cftc: null },
  tin: { prices: ['tin'], cftc: null },
  gold: { prices: ['gold'], cftc: '088691' },
  silver: { prices: ['silver'], cftc: '084691' },
  platinum: { prices: ['platinum'], cftc: null },
  urea: { prices: ['urea'], cftc: null },
  potash: { prices: ['potassium-chloride'], cftc: null },
  dap: { prices: ['dap'], cftc: null },
  'phosphate-rock': { prices: ['phosphate-rock'], cftc: null },
}

/** A country's priced exports below this (thousands of US dollars: $50 million a year) aren't shown */
const MIN_BASKET = 50_000

export interface PriceMoveItem {
  commodity: string
  name: string
  /** Its exports, thousands of US dollars a year */
  value: number
  /** Its share of the country's priced exports, % */
  share: number
  price: { key: string; name: string; unit: string; month: string | null; value: number | null; month_pct: number | null; year_pct: number | null }
  funds: { market: string; net: number; previous_net: number } | null
}

export interface CountryPriceMoves {
  name: string
  /** The export-weighted price change, % (null when none of its prices has one) */
  month_pct: number | null
  year_pct: number | null
  /** Priced commodities' share of all its exports, % */
  exposed_pct: number | null
  /** Its priced exports, thousands of US dollars a year */
  basket: number
  items: PriceMoveItem[]
}

export interface PriceMovesSnapshot {
  updated_at: string
  /** The prices' month ("2026-09") and the trade year (2024) */
  month: string | null
  trade_year: number
  sources: { prices: string; trade: string; funds: string | null }
  countries: Record<string, CountryPriceMoves>
}

const pct = (n: number): number => Math.round(n * 10) / 10

/** The series that prices a commodity: its first listed series with a price in the file's latest month */
export function seriesFor(commodity: string, prices: PricesSnapshot): PriceSeries | null {
  const keys = BY_KEY.get(commodity)?.prices ?? EXTRA[commodity]?.prices ?? []
  for (const k of keys) {
    const s = prices.series[k]
    // Some series stop: one whose last price is older than the file's month doesn't count
    if (s && s.value !== null && s.month === prices.month && (s.change_month_pct !== null || s.change_year_pct !== null)) return s
  }
  return null
}

export function priceMoves(partners: PartnersSnapshot, prices: PricesSnapshot, cftc: CftcSnapshot | null, now = new Date()): PriceMovesSnapshot {
  const countries: Record<string, CountryPriceMoves> = {}
  for (const [iso, trade] of Object.entries(partners.countries)) {
    const items: PriceMoveItem[] = []
    for (const [commodity, flows] of Object.entries(trade.exports)) {
      const s = seriesFor(commodity, prices)
      if (!s || flows.value <= 0) continue
      const code = BY_KEY.get(commodity)?.cftc ?? EXTRA[commodity]?.cftc ?? null
      const f = code ? cftc?.markets.find(m => m.code === code) : undefined
      items.push({
        commodity, name: partners.names[commodity] ?? commodity, value: flows.value, share: 0,
        price: { key: s.key, name: s.name, unit: s.unit, month: s.month, value: s.value, month_pct: s.change_month_pct, year_pct: s.change_year_pct },
        funds: f ? { market: f.name, net: f.net, previous_net: f.previous_net } : null,
      })
    }
    const basket = items.reduce((sum, x) => sum + x.value, 0)
    if (basket < MIN_BASKET) continue
    const weighted = (pick: (x: PriceMoveItem) => number | null): number | null => {
      const known = items.filter(x => pick(x) !== null)
      const w = known.reduce((sum, x) => sum + x.value, 0)
      return w > 0 ? pct(known.reduce((sum, x) => sum + x.value * (pick(x) as number), 0) / w) : null
    }
    items.sort((a, b) => b.value - a.value)
    for (const x of items) x.share = pct((x.value / basket) * 100)
    const total = trade.total?.exports
    countries[iso] = {
      name: trade.name,
      month_pct: weighted(x => x.price.month_pct),
      year_pct: weighted(x => x.price.year_pct),
      exposed_pct: total ? pct(Math.min(100, (basket / total) * 100)) : null,
      basket: Math.round(basket),
      items: items.slice(0, 8),
    }
  }
  return {
    updated_at: now.toISOString(),
    month: prices.month,
    trade_year: partners.year,
    sources: { prices: `${prices.source} (${prices.licence})`, trade: `${partners.source} (${partners.licence})`, funds: cftc ? `CFTC Commitments of Traders, ${cftc.report_date}` : null },
    countries,
  }
}
