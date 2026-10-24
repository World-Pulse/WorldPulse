/**
 * The map's economy and price-move layers and the country brief's economy section (Oct 23, 2026;
 * Devon: "Add ... CME like data and the Lloyd's bank like data and layers to the map too").
 *
 *   - Country economics: the World Bank's World Development Indicators (CC BY 4.0), one indicator
 *     at a time (GET /api/v1/economy), and a country's profile with its trade in all goods (CEPII
 *     BACI) and how commodity prices moved its exports (GET /api/v1/economy/:iso)
 *   - Price moves: the World Bank's monthly prices weighted by each country's exports
 *     (GET /api/v1/commodities/price-moves); CME's own prices need CME's licence
 */

export type EconUnit = 'usd' | 'pct' | 'pct_gdp' | 'people'
export interface EconIndicator { key: string; code: string; name: string; unit: EconUnit }
export interface EconRow { iso: string; name: string; value: number; year: number }
export interface EconomyMap { available: true; updated_at: string; source: string; licence: string; link: string; indicator: EconIndicator; indicators: EconIndicator[]; rows: EconRow[] }

export interface TradePartner { iso: string; name: string; value: number; share: number }
export interface TradeGroup { hs2: string; name: string; value: number; share: number }
export interface PriceMoveItem {
  commodity: string
  name: string
  value: number
  share: number
  price: { key: string; name: string; unit: string; month: string | null; value: number | null; month_pct: number | null; year_pct: number | null }
  funds: { market: string; net: number; previous_net: number } | null
}
export interface EconomyProfile {
  available: true
  iso: string
  name: string
  region: string | null
  income: string | null
  figures: { source: string; licence: string; link: string; updated_at: string; values: Array<{ key: string; name: string; unit: EconUnit; value: number; year: number }> } | null
  /** Trade in all goods, thousands of US dollars */
  trade: { year: number; release: string; source: string; licence: string; exports: number; imports: number; buyers: TradePartner[]; suppliers: TradePartner[]; exports_by: TradeGroup[]; imports_by: TradeGroup[] } | null
  prices: { month: string | null; trade_year: number; sources: Record<string, string | null>; month_pct: number | null; year_pct: number | null; exposed_pct: number | null; basket: number; items: PriceMoveItem[] } | null
}
export interface PriceMoveRow { iso: string; name: string; month_pct: number | null; year_pct: number | null; exposed_pct: number | null; basket: number; top: PriceMoveItem[] }
export interface ShippingHeadline { id: string; title: string; url: string; published: string; kind: string | null; sectors: string[]; topics: string[] }

/** The indicators the map's layer offers, in the picker's order */
export const ECON_LAYER_KEYS = ['growth', 'inflation', 'unemployment', 'gdp_per_person', 'trade', 'current_account'] as const

/** US dollars in words: "$2.2 trillion", "$48 billion", "$9,960" */
export function dollars(v: number): string {
  const a = Math.abs(v), sign = v < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(1)} trillion`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)} billion`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)} million`
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`
}

/** One decimal, halves away from zero (−2.75 → −2.8, as 2.75 → 2.8) */
const round1 = (v: number): number => Math.sign(v) * Math.round(Math.abs(v) * 10) / 10

/** A percent with one decimal and a real minus sign */
export function pct1(v: number): string {
  const r = round1(v)
  return `${r < 0 ? '−' : ''}${Math.abs(r)}%`
}

/** A change with its sign: "+8.7%", "−8.9%" */
export function signed(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const r = round1(v)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`
}

/** An indicator's value in words */
export function formatEcon(unit: EconUnit, v: number): string {
  if (unit === 'usd') return dollars(v)
  if (unit === 'pct') return pct1(v)
  if (unit === 'pct_gdp') return `${pct1(v)} of GDP`
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} billion`
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)} million`
  return Math.round(v).toLocaleString('en-US')
}

interface Scale { stops: number[]; colors: string[]; unit: EconUnit }
/** Each layer indicator's colour breaks (one more colour than breaks) */
export const ECON_SCALES: Record<string, Scale> = {
  growth: { unit: 'pct', stops: [-2, 0, 2, 4, 6], colors: ['#b91c1c', '#f87171', '#fde68a', '#86efac', '#22c55e', '#15803d'] },
  inflation: { unit: 'pct', stops: [0, 3, 6, 10, 25], colors: ['#93c5fd', '#86efac', '#fde68a', '#fb923c', '#ef4444', '#7f1d1d'] },
  unemployment: { unit: 'pct', stops: [4, 7, 10, 15], colors: ['#86efac', '#fde68a', '#fb923c', '#ef4444', '#7f1d1d'] },
  gdp_per_person: { unit: 'usd', stops: [1500, 5000, 15000, 40000], colors: ['#fef3c7', '#fcd34d', '#f59e0b', '#d97706', '#92400e'] },
  trade: { unit: 'pct', stops: [30, 60, 100, 150], colors: ['#cffafe', '#67e8f9', '#22d3ee', '#0891b2', '#155e75'] },
  current_account: { unit: 'pct', stops: [-6, -2, 2, 6], colors: ['#b91c1c', '#f87171', '#fde68a', '#86efac', '#15803d'] },
}
/** Price moves: falls red, rises green, near flat grey */
export const MOVE_SCALE: Scale = { unit: 'pct', stops: [-10, -3, 3, 10], colors: ['#b91c1c', '#f87171', '#94a3b8', '#4ade80', '#15803d'] }

export function colorOn(scale: Scale, v: number): string {
  let i = 0
  while (i < scale.stops.length && v >= scale.stops[i]!) i++
  return scale.colors[i]!
}

/** The legend's labels, one per colour: "under −2%", "−2% to 0%", … "6% and over" */
export function scaleLabels(scale: Scale): string[] {
  const f = (v: number) => (scale.unit === 'usd' ? dollars(v) : pct1(v))
  const s = scale.stops
  return scale.colors.map((_, i) => (i === 0 ? `under ${f(s[0]!)}` : i === s.length ? `${f(s[i - 1]!)} and over` : `${f(s[i - 1]!)} to ${f(s[i]!)}`))
}

/** "Brazil's farm and mineral exports: soybeans +8.7%, crude oil +28.5%" */
export function movesText(items: PriceMoveItem[], n = 3): string {
  return items.slice(0, n).map(i => `${i.name.toLowerCase()} ${signed(i.price.month_pct)}`).join(', ')
}

export const ECON_CREDITS = "Figures: World Bank, World Development Indicators (CC BY 4.0). Trade: CEPII BACI (Etalab Open Licence 2.0). Prices: World Bank Commodity Price Data (CC BY 4.0). Shipping headlines: Lloyd's List (lloydslist.com)."
