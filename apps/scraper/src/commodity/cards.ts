/**
 * The commodity watch's cards (Oct 23, 2026; Devon: "Give each region one card with five readings
 * - yes, but it should be [country] specific", "Raise a flag", "Forecast with a plain score first,
 * showing its reasons, and check it against USDA's next monthly revision").
 *
 * One card per commodity and country, with five readings:
 *   1. outlook   USDA's estimate of this year's crop, against last year's and its last estimate
 *   2. weather   the risk in the forecast over the main growing regions, at the crop's stage
 *   3. trade     exports and imports and their share of the world's; this week's US purchases
 *   4. market    the World Bank's monthly price, and hedge funds' positions (the CFTC)
 *   5. news      how many reports our sources carried on it in the last 14 days
 * A plain score from 0 to 100, with its reasons: how much the supply looks at risk, and, where USDA
 * makes an estimate, how likely USDA is to cut it. A flag when the risk is real and the country
 * matters but our sources are saying little about it: "supply risk not in the news".
 */

import type { PsdSnapshot, CountryYears, Readings } from '../sources/usda-psd'
import type { PricesSnapshot, PriceSeries } from '../sources/worldbank-prices'
import type { EsrWeek } from '../sources/usda-export-sales'
import { COMMODITIES, type WatchCommodity } from './catalog'
import { REGIONS } from './regions'
import { countryName } from './countries'
import type { CountryWeather, Level } from './weather'

// ─── INPUTS ──────────────────────────────────────────────────────────────────

export interface CftcMarket {
  code: string
  name: string
  net: number
  previous_net: number
  open_interest: number
  year_max?: { net: number; date: string }
  year_min?: { net: number; date: string }
  finding: string | null
}
export interface CftcSnapshot { report_date: string; markets: CftcMarket[] }

export interface NewsCount {
  /** Reports in the last 14 days about this commodity and country */
  count: number
  latest: Array<{ id: string; title: string; created_at: string }>
}

export interface CardInputs {
  psd: PsdSnapshot | null
  previousPsd: PsdSnapshot | null
  prices: PricesSnapshot | null
  esr: EsrWeek | null
  cftc: CftcSnapshot | null
  /** `${commodity}:${iso}` → the weather over its regions */
  weather: ReadonlyMap<string, CountryWeather>
  /** `${commodity}:${iso}` → its news */
  news: ReadonlyMap<string, NewsCount> | null
}

// ─── CARDS ───────────────────────────────────────────────────────────────────

export interface Card {
  commodity: string
  commodity_name: string
  group: WatchCommodity['group']
  iso: string
  country: string
  outlook: {
    year: string
    unit: string
    production: number | null
    previous: number | null
    change_pct: number | null
    /** Against USDA's estimate a release before, for the same year */
    revision_pct: number | null
    share_pct: number | null
    /** When USDA last changed it, "2026-10" */
    estimate: string | null
    text: string
  } | null
  weather: {
    level: Level
    weighted: number
    text: string
    regions: Array<{ id: string; name: string; lat: number; lon: number; level: Level; doing: string; rain_mm: number; rain_pct: number | null; low_c: number | null; high_c: number | null; risk: string | null }>
  } | null
  trade: {
    unit: string
    exports: number | null
    exports_share_pct: number | null
    imports: number | null
    imports_share_pct: number | null
    us: { week_ending: string; net_sales: number; accumulated: number; prev_year_accumulated: number; unit: string; text: string } | null
    text: string
  } | null
  market: {
    price: { key: string; name: string; unit: string; month: string; value: number; change_month_pct: number | null; change_year_pct: number | null; highest_since: string | null; lowest_since: string | null } | null
    funds: { market: string; report_date: string; net: number; previous_net: number; finding: string | null } | null
    text: string
  } | null
  news: { count: number; latest: NewsCount['latest']; text: string } | null
  /** How much the supply looks at risk, 0 to 100 */
  score: number
  /** Where USDA makes an estimate: how likely it is to cut it at its next revision */
  call: 'cut likely' | 'cut possible' | 'no cut expected' | null
  reasons: string[]
  flag: { text: string; level: Level } | null
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const pct = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined || b === null || b === undefined || b === 0 ? null : r1(((a - b) / Math.abs(b)) * 100)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthName = (ym: string): string => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym
const signed = (n: number): string => `${n > 0 ? 'up' : 'down'} ${Math.abs(n)}%`

/** USDA's figures in words: 71,900 thousand 60 kg bags → "71.9 million bags" */
export function amount(value: number, unit: string): string {
  const u = unit.toUpperCase()
  let n = value
  let word = unit
  if (u.startsWith('1000 ')) n = value * 1000
  if (/60 KG BAGS/.test(u)) word = 'bags'
  else if (/BALES/.test(u)) word = 'bales'
  else if (/HEAD/.test(u)) word = 'head'
  else if (/MT|TONNE|^T$/.test(u)) word = 't'
  if (Math.abs(n) >= 1e9) return `${r1(n / 1e9)} billion ${word}`
  if (Math.abs(n) >= 1e6) return `${r1(n / 1e6)} million ${word}`
  return `${Math.round(n).toLocaleString('en-US')} ${word}`
}

/** USDA's marketing year in words: 2026 → "2026/27"; meat and dairy go by calendar year */
export function yearLabel(year: number, group: WatchCommodity['group']): string {
  return group === 'meat' || group === 'dairy' ? String(year) : `${year}/${String((year + 1) % 100).padStart(2, '0')}`
}

function worldTotals(countries: Record<string, CountryYears>): { production: number; exports: number; imports: number } {
  let production = 0, exports = 0, imports = 0
  for (const c of Object.values(countries)) {
    production += c.current.production ?? 0
    exports += c.current.exports ?? 0
    imports += c.current.imports ?? 0
  }
  return { production, exports, imports }
}

const PRICE_LABELS: Record<string, string> = { 'Cotton, A Index': 'Cotton (A Index)', 'Tea, avg 3 auctions': 'Tea (three-auction average)' }

/** A World Bank series' name in words: "Coffee, Arabica" → "Arabica coffee" */
export function priceLabel(name: string): string {
  if (PRICE_LABELS[name]) return PRICE_LABELS[name]!
  const i = name.indexOf(', ')
  if (i < 0) return name
  const label = `${name.slice(i + 2)} ${name.slice(0, i).toLowerCase()}`
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** The price that prices it: the first of its World Bank series priced in the file's newest month */
export function pickPrice(commodity: WatchCommodity, prices: PricesSnapshot | null): PriceSeries | null {
  if (!prices) return null
  const series = commodity.prices.map(k => prices.series[k]).filter((s): s is PriceSeries => !!s && s.value !== null)
  return series.find(s => s.month === prices.month) ?? null
}

/** Which countries get a card: the ones that matter for the commodity, and every one with growing regions */
export function cardCountries(commodity: WatchCommodity, psd: PsdSnapshot | null): string[] {
  const out = new Set<string>()
  const data = commodity.psd ? psd?.commodities[commodity.psd] : undefined
  if (data) {
    const world = worldTotals(data.countries)
    for (const c of Object.values(data.countries)) {
      if (!c.iso) continue
      const share = (v: number | undefined, total: number): number => (total > 0 ? (v ?? 0) / total : 0)
      if (share(c.current.production, world.production) >= 0.01 || share(c.current.exports, world.exports) >= 0.02 || share(c.current.imports, world.imports) >= 0.05) out.add(c.iso)
    }
  }
  for (const r of REGIONS) if (r.commodity === commodity.key) out.add(r.iso)
  return [...out].sort()
}

function findCountry(countries: Record<string, CountryYears> | undefined, iso: string): CountryYears | null {
  if (!countries) return null
  for (const c of Object.values(countries)) if (c.iso === iso) return c
  return null
}

/** One card */
export function buildCard(commodity: WatchCommodity, iso: string, inputs: CardInputs): Card {
  const data = commodity.psd ? inputs.psd?.commodities[commodity.psd] : undefined
  const before = commodity.psd ? inputs.previousPsd?.commodities[commodity.psd] : undefined
  const c = findCountry(data?.countries, iso)
  const name = countryName(iso, c?.name)
  const card: Card = {
    commodity: commodity.key, commodity_name: commodity.name, group: commodity.group, iso, country: name,
    outlook: null, weather: null, trade: null, market: null, news: null, score: 0, call: null, reasons: [], flag: null,
  }
  const reasons: Array<[points: number, text: string]> = []

  // 1. Outlook
  if (data && c) {
    const world = worldTotals(data.countries)
    const prod = c.current.production ?? null
    const prevProd = c.previous.production ?? null
    const old = before && before.current_year === data.current_year ? findCountry(before.countries, iso) : null
    const revision = old && c.estimate && old.estimate && c.estimate > old.estimate ? pct(prod, old.current.production) : null
    const change = pct(prod, prevProd)
    const share = prod !== null && world.production > 0 ? r1((prod / world.production) * 100) : null
    const year = yearLabel(data.current_year, commodity.group)
    let text = prod !== null && prod > 0
      ? `USDA: ${amount(prod, data.unit)} in ${year}${change !== null ? `, ${signed(change)} on last year` : ''}${share !== null && share >= 1 ? `, ${Math.round(share)}% of the world's` : ''}`
      : `USDA expects no ${commodity.name.toLowerCase()} crop to speak of in ${year}`
    if (revision !== null && Math.abs(revision) >= 0.5) text += `; ${revision > 0 ? 'raised' : 'cut'} ${Math.abs(revision)}% in ${monthName(c.estimate!)}`
    card.outlook = { year, unit: data.unit, production: prod, previous: prevProd, change_pct: change, revision_pct: revision, share_pct: share, estimate: c.estimate, text }
  }

  // 2. Weather
  const weather = inputs.weather.get(`${commodity.key}:${iso}`)
  if (weather) {
    const regions = weather.regions.slice(0, 6).map(r => ({
      id: r.id, name: r.name, lat: r.lat, lon: r.lon, level: r.level, doing: r.doing, rain_mm: r.rain_mm, rain_pct: r.rain_pct, low_c: r.low_c, high_c: r.high_c, risk: r.risks[0]?.text ?? null,
    }))
    const days = Math.round(weather.regions[0]?.days ?? 0)
    const text = weather.summary ?? (days ? `No weather risk in the next ${days} days in the main growing regions` : 'No forecast yet')
    card.weather = { level: weather.level, weighted: weather.weighted, text, regions }
    if (weather.level === 3) reasons.push([40, `High weather risk. ${weather.summary}`])
    else if (weather.level === 2) reasons.push([25, `Medium weather risk. ${weather.summary}`])
    else if (weather.level === 1) reasons.push([10, `Some weather risk. ${weather.summary}`])
  }

  // 3. Trade
  if (data && c) {
    const world = worldTotals(data.countries)
    const ex = c.current.exports ?? null
    const im = c.current.imports ?? null
    const exShare = ex !== null && world.exports > 0 ? r1((ex / world.exports) * 100) : null
    const imShare = im !== null && world.imports > 0 ? r1((im / world.imports) * 100) : null
    const parts: string[] = []
    if (ex) parts.push(`Exports ${amount(ex, data.unit)}${exShare !== null && exShare >= 1 ? `, ${Math.round(exShare)}% of the world's` : ''}`)
    if (im) parts.push(`imports ${amount(im, data.unit)}${imShare !== null && imShare >= 1 ? `, ${Math.round(imShare)}% of the world's` : ''}`)
    let us: NonNullable<Card['trade']>['us'] = null
    const esrRows = inputs.esr?.buyers.filter(b => b.commodity === commodity.key && b.country_code === iso) ?? []
    if (inputs.esr && esrRows.length) {
      const unit = inputs.esr.commodities.find(x => x.key === commodity.key)?.unit ?? 't'
      const net = esrRows.reduce((s, b) => s + b.net_sales, 0)
      const acc = esrRows.reduce((s, b) => s + b.accumulated_exports, 0)
      const prevAcc = esrRows.reduce((s, b) => s + b.prev_year_accumulated_exports, 0)
      const word = unit === 'bales' ? 'bales' : 't'
      const fmt = (n: number): string => (Math.abs(n) >= 1e6 ? `${r1(n / 1e6)} million ${word}` : `${Math.round(n).toLocaleString('en-US')} ${word}`)
      const week = inputs.esr.week_ending
      us = {
        week_ending: week, net_sales: net, accumulated: acc, prev_year_accumulated: prevAcc, unit: word,
        text: `${net >= 0 ? 'Bought' : 'Cancelled'} ${fmt(Math.abs(net))} of US ${commodity.name.toLowerCase()} in the week to ${new Date(`${week}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}; ${fmt(acc)} shipped this marketing year (${fmt(prevAcc)} a year earlier)`,
      }
      parts.push(us.text.charAt(0).toLowerCase() + us.text.slice(1))
    }
    const text = parts.length ? parts.join('; ').replace(/^./, s => s.toUpperCase()) : 'No exports or imports to speak of'
    card.trade = { unit: data.unit, exports: ex, exports_share_pct: exShare, imports: im, imports_share_pct: imShare, us, text }
  }

  // 4. Market
  const price = pickPrice(commodity, inputs.prices)
  const fundsRow = commodity.cftc ? inputs.cftc?.markets.find(m => m.code === commodity.cftc) : undefined
  if (price || fundsRow) {
    const parts: string[] = []
    if (price) {
      const month = monthName(price.month!)
      parts.push(`${priceLabel(price.name)} $${price.value!.toLocaleString('en-US')}${price.unit.replace(/^\$/, '')} in ${month}${price.change_month_pct !== null ? `, ${signed(price.change_month_pct)} on the month` : ''}${price.change_year_pct !== null ? `, ${signed(price.change_year_pct)} on the year` : ''}${price.highest_since ? (price.highest_since === 'record' ? ', a record' : `, the highest since ${monthName(price.highest_since)} ${price.highest_since.slice(0, 4)}`) : price.lowest_since ? (price.lowest_since === 'record' ? ', the lowest on record' : `, the lowest since ${monthName(price.lowest_since)} ${price.lowest_since.slice(0, 4)}`) : ''}`)
    }
    if (fundsRow && inputs.cftc) {
      const side = fundsRow.net >= 0 ? 'betting on higher prices' : 'betting on lower prices'
      const finding = fundsRow.finding === 'largest' ? ', their biggest bet in a year' : fundsRow.finding === 'smallest' ? ', their smallest in a year' : fundsRow.finding === 'flip' ? ', after switching sides' : ''
      parts.push(`hedge funds ${side} (${Math.abs(fundsRow.net).toLocaleString('en-US')} contracts net${finding})`)
    }
    card.market = {
      price: price ? { key: price.key, name: priceLabel(price.name), unit: price.unit, month: price.month!, value: price.value!, change_month_pct: price.change_month_pct, change_year_pct: price.change_year_pct, highest_since: price.highest_since, lowest_since: price.lowest_since } : null,
      funds: fundsRow && inputs.cftc ? { market: fundsRow.name, report_date: inputs.cftc.report_date, net: fundsRow.net, previous_net: fundsRow.previous_net, finding: fundsRow.finding } : null,
      text: parts.join('; ').replace(/^./, s => s.toUpperCase()),
    }
  }

  // 5. News
  const news = inputs.news?.get(`${commodity.key}:${iso}`)
  if (news && commodity.news) {
    card.news = { count: news.count, latest: news.latest.slice(0, 3), text: news.count === 0 ? 'No reports in our sources in the last 14 days' : `${news.count} report${news.count === 1 ? '' : 's'} in our sources in the last 14 days` }
  }

  // The score's other reasons, beside the weather's
  const level = card.weather?.level ?? 0
  const o = card.outlook
  if (o && o.change_pct !== null && o.production) {
    if (o.change_pct >= 10) reasons.push([10, `USDA expects a crop ${Math.round(o.change_pct)}% bigger than last year's: room for a cut`])
    else if (o.change_pct >= 5) reasons.push([5, `USDA expects a crop ${Math.round(o.change_pct)}% bigger than last year's`])
  }
  if (o && o.revision_pct !== null) {
    if (o.revision_pct >= 2) reasons.push([5, `USDA raised its estimate ${o.revision_pct}% in ${monthName(o.estimate!)}`])
    else if (o.revision_pct <= -2) reasons.push([-10, `USDA already cut its estimate ${Math.abs(o.revision_pct)}% in ${monthName(o.estimate!)}`])
  }
  if (level >= 2 && price && price.change_month_pct !== null && price.change_month_pct <= -5) {
    reasons.push([5, `${priceLabel(price.name)} fell ${Math.abs(price.change_month_pct)}% in ${monthName(price.month!)}: the market isn't paying for the weather risk`])
  }
  if (level >= 2 && fundsRow && fundsRow.net < 0) reasons.push([5, 'Hedge funds are betting on lower prices despite the weather'])
  card.score = Math.max(0, Math.min(100, reasons.reduce((s, [p]) => s + p, 0)))
  card.reasons = reasons.filter(([p]) => p !== 0).sort((a, b) => b[0] - a[0]).map(([p, t]) => `${p > 0 ? '+' : ''}${p} ${t}`)
  if (o && o.production) card.call = card.score >= 50 ? 'cut likely' : card.score >= 30 ? 'cut possible' : 'no cut expected'

  // The flag: a real risk, in a country that matters, that our sources barely mention
  const matters = (o?.share_pct ?? 0) >= 3 || (card.trade?.exports_share_pct ?? 0) >= 5 || (!commodity.psd && (card.weather?.regions.length ?? 0) > 0)
  const quiet = card.news !== null && card.news.count <= 2
  const notAlreadyCut = !(o && o.revision_pct !== null && o.revision_pct <= -2)
  if (level >= 2 && matters && quiet && notAlreadyCut && card.weather) {
    card.flag = {
      level,
      text: `${commodity.name} in ${name}: ${card.weather.text}.${o ? ` ${o.text}.` : ''} ${card.news!.text}.`,
    }
  }
  return card
}

/** Every card */
export function buildCards(inputs: CardInputs, commodities: readonly WatchCommodity[] = COMMODITIES): Card[] {
  const cards: Card[] = []
  for (const commodity of commodities) {
    for (const iso of cardCountries(commodity, inputs.psd)) cards.push(buildCard(commodity, iso, inputs))
  }
  return cards
}

/** A flag's headline for the feed ("Little rain forecast for Brazil's coffee as it flowers") */
export function flagTitle(card: Card, weather: CountryWeather): string {
  const region = weather.regions.find(r => r.level === weather.level) ?? weather.regions[0]
  const risk = region?.risks[0]
  const crop = card.commodity_name.replace(/\s*\(.*\)/, '').toLowerCase()
  const stage = region?.stage
  const when = stage === 'B' ? (card.commodity === 'corn' ? 'as it pollinates' : 'as it flowers') : stage === 'F' ? 'as it fills' : stage === 'P' ? 'at planting' : stage === 'H' ? 'at harvest' : 'as it grows'
  const where = `${card.country}'s ${crop}`
  switch (risk?.kind) {
    case 'dry': return `Little rain forecast for ${where} ${when}, a supply risk few are reporting`
    case 'frost': return `Frost forecast for ${where} in ${region!.name}, a supply risk few are reporting`
    case 'heat': return `Heat forecast for ${where} ${when}, a supply risk few are reporting`
    case 'wet': return `Heavy rain forecast for ${where} ${when}, a supply risk few are reporting`
    default: return `Weather risk for ${where}, little reported`
  }
}

export type { Readings }
