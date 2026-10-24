/**
 * USDA Weekly Export Sales (Oct 23, 2026; Devon: ingest the Weekly Export Sales Report "as a new
 * source for commodity, trade, market, economic data")
 *
 * Every Thursday at 8:30 AM Eastern (a day later in a week with a federal holiday), USDA's Foreign
 * Agricultural Service publishes what US exporters sold and shipped in the week before, for each
 * farm commodity and each buyer country. Its Export Sales Reporting and Query System (ESRQS, since
 * March 2026) puts the report in public files that need no key or sign-in:
 *   CWRCommoditySummary.xml          each commodity, this week and the week before (in thousands)
 *   CWRCountryCommoditySummary.xml   each commodity and buyer country, the same two weeks
 *   WeeklyHighlightsReport.xml       USDA's own summary, a paragraph per commodity
 * US government data: free to reuse.
 *
 * Once a week, after USDA's release time (the files can be up earlier; WorldPulse never publishes
 * the numbers before USDA does):
 *   - a report per main commodity (wheat, corn, soybeans, soybean meal and oil, sorghum, rice,
 *     upland cotton, beef, pork) in USDA's words, pinned in Washington;
 *   - a report per notable buyer, the week's largest purchases or cancellations (up to 8), pinned
 *     in the buyer's capital: where US farm goods are going;
 *   - the whole week, every commodity above and every buyer, in Redis (usda:esr:latest) for
 *     GET /api/v1/trade/us-export-sales.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import type { SignalSeverity } from '@worldpulse/types'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'
import { countryPin, mentionedCountries } from '../pipeline/geo'
import { countryNameOf } from '../pipeline/world-countries'

const log = rootLogger.child({ module: 'usda-export-sales' })

export const SOURCE_ID = 'usda-export-sales'
const BASE = 'https://apps.fas.usda.gov/esrqs/StaticReports/'
/** Where a reader finds the report (the files themselves are replaced every week) */
export const REPORT_PAGE = 'https://apps.fas.usda.gov/esrqs/#/reports/weeklyexportsalesreportdetail'
const POLL_INTERVAL_MS = Number(process.env.USDA_ESR_INTERVAL_MS) || 3 * 3_600_000
const RELIABILITY = 0.95
export const SNAPSHOT_KEY = 'usda:esr:latest'
const SNAPSHOT_TTL_S = 30 * 86_400
const DONE_TTL_S = 60 * 86_400
const DEDUP_TTL_S = 60 * 86_400
const MAX_BUYERS = 8
const WASHINGTON = { lat: 38.8868, lng: -77.0325 }   // USDA, Jamie L. Whitten Building

// ─── COMMODITIES ─────────────────────────────────────────────────────────────

export interface CommodityGroup {
  /** The name the API uses */
  key: string
  /** USDA's paragraph heading in the Weekly Highlights */
  heading: string
  /** USDA's commodity code: its all-classes total where it has one (all wheat, all rice, all upland cotton) */
  code: string
  /** "US soybean export sales" */
  adjective: string
  /** "China bought 2.18 million t of US soybeans" */
  noun: string
  unit: 't' | 'bales'
  /** Net sales and shipments both under this: no report for the commodity that week */
  floor: number
  /** A buyer's purchase or cancellation this size or more makes a report of its own */
  buyerMin: number
}

export const GROUPS: CommodityGroup[] = [
  { key: 'wheat',        heading: 'Wheat',                 code: '107',  adjective: 'wheat',         noun: 'wheat',         unit: 't',     floor: 5_000,  buyerMin: 100_000 },
  { key: 'corn',         heading: 'Corn',                  code: '401',  adjective: 'corn',          noun: 'corn',          unit: 't',     floor: 5_000,  buyerMin: 100_000 },
  { key: 'soybeans',     heading: 'Soybeans',              code: '801',  adjective: 'soybean',       noun: 'soybeans',      unit: 't',     floor: 5_000,  buyerMin: 100_000 },
  { key: 'soybean-meal', heading: 'Soybean Cake and Meal', code: '901',  adjective: 'soybean meal',  noun: 'soybean meal',  unit: 't',     floor: 5_000,  buyerMin: 50_000 },
  { key: 'soybean-oil',  heading: 'Soybean Oil',           code: '902',  adjective: 'soybean oil',   noun: 'soybean oil',   unit: 't',     floor: 2_000,  buyerMin: 10_000 },
  { key: 'sorghum',      heading: 'Sorghum',               code: '701',  adjective: 'sorghum',       noun: 'sorghum',       unit: 't',     floor: 5_000,  buyerMin: 50_000 },
  { key: 'rice',         heading: 'Rice',                  code: '1505', adjective: 'rice',          noun: 'rice',          unit: 't',     floor: 5_000,  buyerMin: 25_000 },
  { key: 'cotton',       heading: 'Cotton',                code: '1404', adjective: 'upland cotton', noun: 'upland cotton', unit: 'bales', floor: 10_000, buyerMin: 25_000 },
  { key: 'beef',         heading: 'Beef',                  code: '1701', adjective: 'beef',          noun: 'beef',          unit: 't',     floor: 1_000,  buyerMin: 5_000 },
  { key: 'pork',         heading: 'Pork',                  code: '1702', adjective: 'pork',          noun: 'pork',          unit: 't',     floor: 1_000,  buyerMin: 10_000 },
]

// ─── USDA'S COUNTRY NAMES ────────────────────────────────────────────────────

/**
 * USDA's names for buyer countries (as its files spell them, upper case), to ISO codes. null: a
 * group of places or a country that no longer exists. A name not here is looked up in the text
 * matcher the news uses.
 */
const USDA_COUNTRIES: Record<string, string | null> = {
  'CANADA': 'CA', 'MEXICO': 'MX', 'GUATEMALA': 'GT', 'BELIZE': 'BZ', 'EL SALVADOR': 'SV', 'HONDURAS': 'HN',
  'NICARAGUA': 'NI', 'COSTA RICA': 'CR', 'PANAMA': 'PA', 'JAMAICA': 'JM', 'HAITI': 'HT', 'DOMINICAN REPUBLIC': 'DO',
  'LEEWARD-WINDWARD ISLANDS': null, 'TRINIDAD AND TOBAGO': 'TT', 'NETHERLANDS ANTILLES': null, 'COLOMBIA': 'CO',
  'VENEZUELA': 'VE', 'GUYANA': 'GY', 'SURINAM': 'SR', 'ECUADOR': 'EC', 'PERU': 'PE', 'CHILE': 'CL', 'BRAZIL': 'BR',
  'BANGLADESH': 'BD', 'SRI LANKA': 'LK', 'THAILAND': 'TH', 'VIETNAM': 'VN', 'MALAYSIA': 'MY', 'INDONESIA': 'ID',
  'PHILIPPINES': 'PH', 'KOREA, REPUBLIC OF': 'KR', 'TAIWAN': 'TW', 'JAPAN': 'JP', 'MOROCCO': 'MA', 'MAURITANIA': 'MR',
  'SENEGAL': 'SN', 'GUINEA': 'GN', "COTE D'IVOIRE": 'CI', 'NIGERIA': 'NG', 'ANGOLA': 'AO', 'SOMALIA': 'SO',
  'KENYA': 'KE', 'MAURITIUS AND DEPENDENTS': 'MU', 'SOUTH AFRICA, REPUBLIC OF': 'ZA', 'BARBADOS': 'BB',
  'UNITED ARAB EMIRATES': 'AE', 'MOZAMBIQUE': 'MZ', 'UNITED KINGDOM': 'GB', 'BELGIUM-LUXEMBOURG': 'BE', 'SPAIN': 'ES',
  'ITALY': 'IT', 'BURMA': 'MM', 'SINGAPORE': 'SG', 'EGYPT': 'EG', 'CYPRUS': 'CY', 'HONG KONG': 'HK', 'AUSTRALIA': 'AU',
  'BERMUDA': 'BM', 'BAHAMAS, THE': 'BS', 'CAYMAN ISLANDS': 'KY', 'ICELAND': 'IS', 'IRELAND': 'IE', 'NETHERLANDS': 'NL',
  'FRANCE': 'FR', 'KUWAIT': 'KW', 'QATAR': 'QA', 'NEPAL': 'NP', 'CHINA, PEOPLES REPUBLIC OF': 'CN', 'NEW ZEALAND': 'NZ',
  'OTHER PACIFIC ISLANDS, NEC': null, 'VIRGIN ISLANDS OF THE U.S.': 'VI', 'GUAM': 'GU', 'CUBA': 'CU', 'PORTUGAL': 'PT',
  'ISRAEL': 'IL', 'JORDAN': 'JO', 'SAUDI ARABIA': 'SA', 'PAKISTAN': 'PK', 'ALGERIA': 'DZ', 'TUNISIA': 'TN', 'LIBYA': 'LY',
  'GERMANY': 'DE', 'GREECE': 'GR', 'TURKEY': 'TR', 'TURKIYE': 'TR', 'IRAQ': 'IQ', 'LAOS': 'LA', 'CAMBODIA': 'KH',
  'POLAND': 'PL', 'LEBANON': 'LB', 'OMAN': 'OM', 'GAMBIA, THE': 'GM', 'INDIA': 'IN', 'SWITZERLAND': 'CH',
  'SLOVENIA': 'SI', 'BAHRAIN': 'BH', 'DJIBOUTI AFARS-ISSAS': 'DJ', 'FEDERATED STATES OF MICRONESIA': 'FM',
  'AMERICAN SAMOA': 'AS', 'NORTHERN MARIANA ISLANDS': 'MP', 'TURKS AND CAICOS ISLANDS': 'TC', 'MALTA & GOZO': 'MT',
  'LIBERIA': 'LR', 'SWEDEN': 'SE', 'NORWAY': 'NO', 'DENMARK': 'DK', 'AUSTRIA': 'AT', 'UKRAINE': 'UA',
  'YUGOSLAVIA': null, 'ALBANIA': 'AL', 'PALAU': 'PW', 'PARAGUAY': 'PY', 'ARGENTINA': 'AR', 'ETHIOPIA': 'ET',
  'GREENLAND': 'GL', 'FRENCH WEST INDIES': null, 'AZERBAIJAN, REPUBLIC OF': 'AZ', 'GEORGIA, REPUBLIC OF': 'GE',
  'KAZAKHSTAN, REPUBLIC OF': 'KZ', 'MOLDOVA, REPUBLIC OF': 'MD', 'UZBEKISTAN, REPUBLIC OF': 'UZ', 'MACAU': 'MO',
  "KOREA, DEMOCRATIC PEOPLE'S REP": 'KP', 'BRITISH PACIFIC ISLANDS': null, 'TOGO': 'TG', 'MACEDONIA (SKOPJE)': 'MK',
  'FRENCH PACIFIC ISLANDS': null, 'GABON': 'GA', 'CONGO (BRAZZAVILLE)': 'CG',
}

const titleCase = (s: string): string =>
  s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bThe\b/g, 'the').replace(/\bAnd\b/g, 'and')

/** A buyer as USDA names it ("CHINA, PEOPLES REPUBLIC OF   ") to its ISO code and our name for it */
export function usdaCountry(name: string): { code: string | null; name: string } {
  const key = name.trim().toUpperCase()
  const code = key in USDA_COUNTRIES ? (USDA_COUNTRIES[key] ?? null) : (mentionedCountries(titleCase(key))[0] ?? null)
  const known = code ? countryNameOf(code) : undefined
  const plain = key.replace(/, (?:REPUBLIC OF|THE|PEOPLES REPUBLIC OF)$/, '')
  return { code, name: known ?? titleCase(plain) }
}

// ─── READING USDA'S FILES ────────────────────────────────────────────────────

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Every <Details …/> row of one of USDA's report files, as its attributes */
export function parseDetails(xml: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = []
  for (const m of xml.matchAll(/<Details\s([^>]*?)\s*\/>/g)) {
    const attrs: Record<string, string> = {}
    for (const a of (m[1] ?? '').matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) attrs[a[1]!] = decodeXml(a[2]!)
    rows.push(attrs)
  }
  return rows
}

/** "10/15/2026" → "2026-10-15" */
export function isoDate(usda: string | undefined): string | null {
  const m = (usda ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null
}

/** USDA's numbers are in thousands (of tons, bales or pieces) */
const units = (v: string | undefined): number => Math.round(Number(v ?? 0) * 1000) || 0

export interface Highlights {
  /** "October 9-15, 2026" */
  period: string | null
  /** Heading → paragraph text, the first of each heading */
  paragraphs: Map<string, string>
}

export function parseHighlights(xml: string): Highlights {
  const raw = xml.match(/Textbox1="([^"]*)"/)?.[1]
  const text = raw ? decodeXml(raw) : ''
  const period = text.match(/for the period ([A-Z][a-z]+ \d{1,2}(?:\s*-\s*(?:[A-Z][a-z]+ )?\d{1,2})?, \d{4})/)?.[1] ?? null
  const paragraphs = new Map<string, string>()
  for (const block of text.split(/(?:\r?\n[ \t]*){2,}/)) {
    const p = block.replace(/\s+/g, ' ').trim()
    const h = p.match(/^([A-Z][A-Za-z ]{1,40}):\s+(\S[\s\S]*)$/)
    if (h && !paragraphs.has(h[1]!)) paragraphs.set(h[1]!, h[2]!)
  }
  return { period, paragraphs }
}

/**
 * How a week's net sales compare with the four weeks before, as USDA words it in the paragraph's
 * first sentence ("were down 25 percent from the previous week and 28 percent from the prior
 * 4-week average"; "were up noticeably from the previous week and from the prior 4-week average";
 * "were down 7 percent from the previous week, but up 30 percent from …"). pct null: "noticeably".
 */
export function vsFourWeekAverage(paragraph: string): { dir: 'up' | 'down'; pct: number | null } | null {
  const first = paragraph.split(/\.\s/)[0] ?? ''
  const m = first.match(/were (up|down) (noticeably|\d+ percent) from the previous week,? (?:and|but) (?:(up|down) )?(noticeably |\d+ percent )?from the prior 4-week average/)
  if (!m) return null
  const dir = (m[3] ?? m[1]) as 'up' | 'down'
  const amount = (m[4] ?? (m[3] ? '' : m[2]) ?? '').trim()
  if (amount === 'noticeably') return { dir, pct: null }
  const pct = Number(amount.replace(' percent', ''))
  return Number.isFinite(pct) && amount ? { dir, pct } : null
}

// ─── WHEN USDA PUBLISHES ─────────────────────────────────────────────────────

/** The instant of a New York wall-clock time (EDT or EST, as it is that day) */
export function newYorkTime(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh + 5, mm))
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5'
  const offset = Number(zone.replace('GMT', '')) || -5
  return new Date(Date.UTC(y, m - 1, d, hh - offset, mm))
}

/** US federal holidays of a year, as observed (a Saturday's on the Friday, a Sunday's on the Monday) */
export function federalHolidays(year: number): Set<string> {
  const day = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d))
  const iso = (t: Date) => t.toISOString().slice(0, 10)
  const nth = (m: number, weekday: number, n: number) => {
    const first = day(m, 1).getUTCDay()
    return iso(day(m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7))
  }
  const last = (m: number, weekday: number) => {
    const end = new Date(Date.UTC(year, m, 0))
    return iso(new Date(end.getTime() - ((end.getUTCDay() - weekday + 7) % 7) * 86_400_000))
  }
  const observed = (m: number, d: number) => {
    const t = day(m, d), wd = t.getUTCDay()
    return iso(new Date(t.getTime() + (wd === 6 ? -1 : wd === 0 ? 1 : 0) * 86_400_000))
  }
  return new Set([
    observed(1, 1), nth(1, 1, 3), nth(2, 1, 3), last(5, 1), observed(6, 19), observed(7, 4),
    nth(9, 1, 1), nth(10, 1, 2), observed(11, 11), nth(11, 4, 4), observed(12, 25),
  ])
}

/**
 * When USDA publishes the report for a week (weeks end on Thursdays): the next Thursday at 8:30 AM
 * Eastern, or the Friday when a federal holiday falls between that Monday and Thursday.
 */
export function releaseTime(weekEnding: string): Date {
  const [y, m, d] = weekEnding.split('-').map(Number) as [number, number, number]
  const thursday = new Date(Date.UTC(y, m - 1, d + 7))
  const year = thursday.getUTCFullYear()
  const holidays = new Set([...federalHolidays(year), ...federalHolidays(year + 1)])
  const holidayWeek = [3, 2, 1, 0].some(k => holidays.has(new Date(thursday.getTime() - k * 86_400_000).toISOString().slice(0, 10)))
  const day = new Date(thursday.getTime() + (holidayWeek ? 86_400_000 : 0))
  return newYorkTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 8, 30)
}

// ─── WORDING ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "2026-10-15" → "Oct 15" */
export const shortDate = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
const longDate = (iso: string): string => `${LONG_MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`

/** A quantity as a title gives it: "2.18 million t", "239,600 t" (USDA rounds to the hundred), "199,600 bales" */
export function formatQuantity(n: number, unit: 't' | 'bales'): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(a / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} million ${unit}`
  return `${(Math.round(a / 100) * 100).toLocaleString('en-US')} ${unit}`
}
/** The exact figure: "2,178,641 t" */
const exact = (n: number, unit: 't' | 'bales'): string => `${Math.round(n).toLocaleString('en-US')} ${unit}`

// ─── THE WEEK ────────────────────────────────────────────────────────────────

export interface CommodityWeek {
  key: string
  name: string
  unit: 't' | 'bales'
  marketing_year: string | null
  net_sales: number
  exports: number
  outstanding: number
  accumulated_exports: number
  prev_year_accumulated_exports: number
  prev_week_net_sales: number | null
  prev_week_exports: number | null
  vs_4_week_average: { dir: 'up' | 'down'; pct: number | null } | null
  usda_summary: string | null
}

export interface BuyerWeek {
  commodity: string
  country: string
  country_code: string | null
  usda_code: string
  net_sales: number
  exports: number
  outstanding: number
  accumulated_exports: number
  prev_year_accumulated_exports: number
}

export interface EsrWeek {
  week_ending: string
  period: string | null
  released_at: string
  source: string
  report: string
  commodities: CommodityWeek[]
  buyers: BuyerWeek[]
}

/** The latest week in USDA's three files, every commodity in GROUPS and every named buyer */
export function readWeek(summaryXml: string, countryXml: string, highlightsXml: string): EsrWeek | null {
  const summary = parseDetails(summaryXml)
  const weeks = [...new Set(summary.map(r => isoDate(r.PeriodEndingDate)).filter((w): w is string => !!w))].sort()
  const week = weeks[weeks.length - 1]
  if (!week) return null
  const previous = weeks.length > 1 ? weeks[weeks.length - 2]! : null
  const highlights = parseHighlights(highlightsXml)
  const row = (code: string, w: string | null) =>
    w ? summary.find(r => r.CommodityCode === code && isoDate(r.PeriodEndingDate) === w && (r.MYCOType ?? 'Standard') === 'Standard') : undefined

  const commodities: CommodityWeek[] = []
  for (const g of GROUPS) {
    const r = row(g.code, week)
    if (!r) continue
    const prev = row(g.code, previous)
    const paragraph = highlights.paragraphs.get(g.heading) ?? null
    commodities.push({
      key: g.key,
      name: g.noun,
      unit: g.unit,
      marketing_year: r.MarketingYear ?? null,
      net_sales: units(r.NetSales),
      exports: units(r.WeeklyExports),
      outstanding: units(r.OutstandingSales),
      accumulated_exports: units(r.AccumulatedExports),
      prev_year_accumulated_exports: units(r.PreviousMKTYearAccumulatedExports),
      prev_week_net_sales: prev ? units(prev.NetSales) : null,
      prev_week_exports: prev ? units(prev.WeeklyExports) : null,
      vs_4_week_average: paragraph ? vsFourWeekAverage(paragraph) : null,
      usda_summary: paragraph,
    })
  }

  const byCode = new Map(GROUPS.map(g => [g.code, g]))
  const buyers: BuyerWeek[] = []
  for (const r of parseDetails(countryXml)) {
    const g = byCode.get(r.CommodityCode ?? '')
    const usdaCode = (r.CountryCode ?? '').trim()
    // Only countries: not "UNKNOWN" (9990), nor the totals and optional-origin rows (no code)
    if (!g || !usdaCode || usdaCode === '9990' || isoDate(r.PeriodEndingDate) !== week) continue
    if ((r.MYCOType ?? 'Standard') !== 'Standard') continue
    const c = usdaCountry(r.CountryName ?? '')
    buyers.push({
      commodity: g.key,
      country: c.name,
      country_code: c.code,
      usda_code: usdaCode,
      net_sales: units(r.NetSales),
      exports: units(r.WeeklyExports),
      outstanding: units(r.OutstandingSales),
      accumulated_exports: units(r.AccumulatedExports),
      prev_year_accumulated_exports: units(r.PreviousYearAccumulatedExports),
    })
  }
  buyers.sort((a, b) => b.net_sales - a.net_sales)

  return {
    week_ending: week,
    period: highlights.period,
    released_at: releaseTime(week).toISOString(),
    source: "USDA Foreign Agricultural Service, Weekly Export Sales (US government data, free to reuse)",
    report: REPORT_PAGE,
    commodities,
    buyers,
  }
}

// ─── REPORTS FOR THE FEED ────────────────────────────────────────────────────

export interface PlannedSignal {
  dedupKey: string
  title: string
  summary: string
  severity: SignalSeverity
  countryCode: string | null
  locationName: string
  lat: number | null
  lng: number | null
  tags: string[]
}

/** How a commodity's week reads: the change on the four weeks before, or net cancellations */
export function commoditySeverity(c: CommodityWeek, g: CommodityGroup): SignalSeverity {
  if (c.net_sales <= -g.floor) return 'high'   // net cancellations
  const v = c.vs_4_week_average
  if (!v) return 'low'
  if (v.dir === 'up' && (v.pct === null || v.pct >= 100)) return 'high'
  if (v.pct === null || v.pct >= 50) return 'medium'
  return 'low'
}

export function planSignals(week: EsrWeek): PlannedSignal[] {
  const out: PlannedSignal[] = []
  const date = shortDate(week.week_ending)
  const groupOf = new Map(GROUPS.map(g => [g.key, g]))
  const tagsFor = (g: CommodityGroup) => ['usda', 'export-sales', 'trade', 'agriculture', 'economy', g.key]

  for (const c of week.commodities) {
    const g = groupOf.get(c.key)!
    if (Math.abs(c.net_sales) < g.floor && c.exports < g.floor) continue
    const top = week.buyers.filter(b => b.commodity === c.key && b.net_sales >= g.buyerMin).slice(0, 1)[0]
    let title: string
    if (c.net_sales < 0) {
      title = `US ${g.adjective} export sales: net cancellations of ${formatQuantity(c.net_sales, g.unit)} in the week to ${date}`
    } else {
      const prev = c.prev_week_net_sales
      const change = prev !== null && prev > 0 ? Math.round((100 * (c.net_sales - prev)) / prev) : null
      const verb = change === null ? 'were' : change >= 100 ? 'jumped to' : change >= 20 ? 'rose to' : change <= -20 ? 'fell to' : 'were'
      title = `US ${g.adjective} export sales ${verb} ${formatQuantity(c.net_sales, g.unit)} in the week to ${date}`
        + (top ? `; ${top.country} bought ${formatQuantity(top.net_sales, g.unit)}` : '')
    }
    const figures = `Week ending ${longDate(week.week_ending)}: net sales ${exact(c.net_sales, g.unit)}, shipments ${exact(c.exports, g.unit)}`
      + `; sold but not yet shipped ${exact(c.outstanding, g.unit)}; shipped so far this marketing year (${c.marketing_year ?? 'current'}) ${exact(c.accumulated_exports, g.unit)}`
      + `, against ${exact(c.prev_year_accumulated_exports, g.unit)} a year earlier.`
    out.push({
      dedupKey: `osint:usda-esr:${week.week_ending}:${g.code}`,
      title,
      summary: [c.usda_summary ? `USDA: ${c.usda_summary}` : null, figures, "Source: USDA's Weekly Export Sales."].filter(Boolean).join('\n\n').slice(0, 2000),
      severity: commoditySeverity(c, g),
      countryCode: 'US',
      locationName: 'United States',
      lat: WASHINGTON.lat,
      lng: WASHINGTON.lng,
      tags: tagsFor(g),
    })
  }

  // The week's notable buyers, the largest against each commodity's own scale first
  const notable = week.buyers
    .map(b => ({ b, g: groupOf.get(b.commodity)! }))
    .filter(({ b, g }) => Math.abs(b.net_sales) >= g.buyerMin)
    .sort((x, y) => Math.abs(y.b.net_sales) / y.g.buyerMin - Math.abs(x.b.net_sales) / x.g.buyerMin)
    .slice(0, MAX_BUYERS)
  for (const { b, g } of notable) {
    const pin = b.country_code ? countryPin(b.country_code) : null
    const title = b.net_sales >= 0
      ? `${b.country} bought ${formatQuantity(b.net_sales, g.unit)} of US ${g.noun} in the week to ${date}`
      : `${b.country} cancelled ${formatQuantity(b.net_sales, g.unit)} of US ${g.noun} purchases in the week to ${date}`
    const lastYear = b.prev_year_accumulated_exports > 0
      ? `, against ${exact(b.prev_year_accumulated_exports, g.unit)} by this point last year.`
      : ', against none by this point last year.'
    const summary = `USDA's weekly export sales, week ending ${longDate(week.week_ending)}: net sales of US ${g.noun} to ${b.country} were ${exact(b.net_sales, g.unit)}`
      + ` and ${exact(b.exports, g.unit)} were shipped. ${b.country} has ${exact(b.outstanding, g.unit)} bought and not yet shipped,`
      + ` and ${exact(b.accumulated_exports, g.unit)} shipped so far this marketing year${lastYear}`
      + "\n\nSource: USDA's Weekly Export Sales."
    out.push({
      dedupKey: `osint:usda-esr:${week.week_ending}:${g.code}:${b.usda_code}`,
      title,
      summary,
      severity: Math.abs(b.net_sales) >= 10 * g.buyerMin ? 'high' : 'medium',
      countryCode: b.country_code,
      locationName: b.country,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
      tags: [...tagsFor(g), 'trade-flow', ...(b.country_code ? [`buyer-${b.country_code.toLowerCase()}`] : [])],
    })
  }
  return out
}

// ─── POLLER ──────────────────────────────────────────────────────────────────

async function fetchText(file: string): Promise<string> {
  const url = BASE + file
  return fetchWithResilience(SOURCE_ID, 'USDA Weekly Export Sales', url, async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WorldPulse/1.0 (world-pulse.io; weekly export sales)', 'Accept': 'application/xml,text/xml' },
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw Object.assign(new Error(`USDA ${file}: HTTP ${res.status}`), { statusCode: res.status })
    return res.text()
  })
}

export function startUsdaExportSalesPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      const summaryXml = await fetchText('CWRCommoditySummary.xml')
      const weeks = parseDetails(summaryXml).map(r => isoDate(r.PeriodEndingDate)).filter((w): w is string => !!w).sort()
      const latest = weeks[weeks.length - 1]
      if (!latest) { log.warn('USDA export sales: no week in the commodity summary'); return }
      if (await redis.get(`usda:esr:done:${latest}`)) return
      const release = releaseTime(latest)
      if (Date.now() < release.getTime()) {
        log.info({ week: latest, release: release.toISOString() }, "USDA export sales: waiting for USDA's release time")
        return
      }
      const [countryXml, highlightsXml] = await Promise.all([
        fetchText('CWRCountryCommoditySummary.xml'),
        fetchText('WeeklyHighlightsReport.xml'),
      ])
      const week = readWeek(summaryXml, countryXml, highlightsXml)
      if (!week || week.week_ending !== latest) { log.warn({ latest }, 'USDA export sales: the files disagree on the week'); return }

      await redis.set(SNAPSHOT_KEY, JSON.stringify(week), 'EX', SNAPSHOT_TTL_S)

      let inserted = 0
      for (const s of planSignals(week)) {
        if (await redis.get(s.dedupKey)) continue
        const row = {
          title: s.title.slice(0, 500),
          summary: s.summary,
          original_urls: [REPORT_PAGE],
          source_ids: [],
          category: 'economy' as const,
          severity: s.severity,
          status: 'pending',
          reliability_score: RELIABILITY,
          location: s.lat !== null && s.lng !== null ? db.raw('ST_MakePoint(?, ?)', [s.lng, s.lat]) : null,
          location_name: s.locationName,
          country_code: s.countryCode,
          region: null,
          tags: s.tags,
          language: 'en',
          event_time: new Date(),
          source_count: 1,
        }
        try {
          const signal = await insertAndCorrelate(row, { lat: s.lat, lng: s.lng, sourceId: SOURCE_ID, sourceName: 'USDA Weekly Export Sales', sourceSlug: SOURCE_ID })
          await redis.set(s.dedupKey, '1', 'EX', DEDUP_TTL_S)
          inserted++
          if (signal && (signal as { id?: unknown }).id && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{ key: 'economy', value: JSON.stringify({ event: 'signal.new', payload: signal, filter: { category: 'economy', severity: s.severity } }) }],
            }).catch(() => {})
          }
        } catch (err) {
          log.warn({ err, title: s.title }, 'USDA export sales: a report was not stored')
        }
      }
      await redis.set(`usda:esr:done:${latest}`, '1', 'EX', DONE_TTL_S)
      log.info({ week: latest, inserted, commodities: week.commodities.length, buyers: week.buyers.length }, 'USDA export sales: week read')
    } catch (err) {
      if (err instanceof CircuitOpenError) return
      log.error({ err }, 'USDA export sales poll error')
    } finally {
      running = false
    }
  }

  void poll()
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearInterval(timer)
    log.info('USDA export sales poller stopped')
  }
}
