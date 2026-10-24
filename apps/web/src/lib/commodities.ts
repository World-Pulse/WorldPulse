/**
 * The commodity watch on the website (Oct 23, 2026; Devon: a commodity, weather and trade layer on
 * the map, and a country's crops, exports, US purchases, weather risk and news when it's clicked).
 * The API (apps/api/src/routes/commodities.ts) answers what the scraper's watch keeps. Types and
 * words here (safe in the browser); the server's fetches in commodities-fetch.ts.
 */


export interface CardRegion { id: string; name: string; lat: number; lon: number; level: number; doing: string; rain_mm: number; rain_pct: number | null; low_c: number | null; high_c: number | null; risk: string | null }

export interface CommodityCard {
  commodity: string
  commodity_name: string
  group: string
  iso: string
  country: string
  outlook: { year: string; unit: string; production: number | null; previous: number | null; change_pct: number | null; revision_pct: number | null; share_pct: number | null; estimate: string | null; text: string } | null
  weather: { level: number; weighted: number; text: string; regions: CardRegion[] } | null
  trade: { unit: string; exports: number | null; exports_share_pct: number | null; imports: number | null; imports_share_pct: number | null; us: { text: string } | null; text: string } | null
  market: { price: { key: string; name: string; unit: string; month: string; value: number } | null; funds: { market: string; report_date: string; net: number } | null; text: string } | null
  news: { count: number; latest: Array<{ id: string; title: string; created_at: string }>; text: string } | null
  score: number
  call: 'cut likely' | 'cut possible' | 'no cut expected' | null
  reasons: string[]
  flag: { text: string; level: number } | null
}

export interface MapRow {
  iso: string
  country: string
  commodity: string
  commodity_name: string
  score: number
  call: string | null
  weather_level: number | null
  flag: boolean
  share_pct: number | null
  exports_share_pct: number | null
  headline: string | null
  regions: Array<{ name: string; lat: number; lon: number; level: number; risk: string | null }>
  /** All-commodities rows: how many of the country's cards are flagged, and how many it has */
  flags?: number
  commodities?: number
}

export interface CommodityOverview {
  available: true
  updated_at: string
  sources: { psd_release?: string | null; prices_month?: string | null; esr_week?: string | null; cftc_date?: string | null; credits?: string[] }
  counts: { cards: number; flags: number; commodities: number }
  scorecard: { outcomes: number; by_call: Record<string, { calls: number; cut: number; raised: number; unchanged: number }>; pending: number }
  flags: Array<{ commodity: string; commodity_name: string; iso: string; country: string; score: number; level: number; text: string }>
  commodities: Array<{ key: string; name: string; group: string; countries: number; flags: number; top: { iso: string; country: string; score: number; call: string | null; headline: string | null } }>
}

export interface CountryCommodities {
  available: true
  iso: string
  country: string
  updated_at: string
  flags: number
  cards: CommodityCard[]
  us: { week_ending: string; report: string; purchases: Array<{ commodity: string; name: string; unit: string; net_sales: number; exports: number; accumulated: number; prev_year_accumulated: number }> } | null
  news: Array<{ id: string; title: string; created_at: string; commodity: string }>
  /** Its main buyers and suppliers per commodity: farm products, energy, metals (CEPII's BACI; values in thousands of US dollars) */
  partners: {
    year: number
    /** BACI's version, '202601' for January 2026: Etalab's licence asks for the date of the last update with the credit */
    release: string
    source: string
    licence: string
    exports: TradeLine[]
    imports: TradeLine[]
  } | null
}

export interface TradeLine {
  commodity: string
  name: string
  value: number
  tonnes: number | null
  top: Array<{ iso: string; name: string; value: number; tonnes: number | null; share: number }>
}

/** Thousands of US dollars in words: 12,000,000 → "$12 billion", 950 → "$950,000" */
export function dollarsK(k: number): string {
  const d = k * 1000
  if (d >= 1e9) return `$${(d / 1e9).toFixed(d >= 1e10 ? 0 : 1)} billion`
  if (d >= 1e6) return `$${(d / 1e6).toFixed(d >= 1e7 ? 0 : 1)} million`
  return `$${Math.round(d).toLocaleString('en-US')}`
}

/** BACI's credit with its last update, as its licence asks: "CEPII BACI, January 2026 release" */
export function baciCredit(partners: { release?: string | null }): string {
  const r = partners.release ?? ''
  return /^\d{6}$/.test(r) ? `CEPII BACI, ${monthLabel(`${r.slice(0, 4)}-${r.slice(4)}`)} release` : 'CEPII BACI'
}

/** "China 72%, United States 9%, Japan 4%" */
export function partnersText(line: TradeLine, n = 3): string {
  return line.top.slice(0, n).map(p => `${p.name} ${p.share >= 10 ? Math.round(p.share) : p.share}%`).join(', ')
}

export interface PriceSeries { key: string; name: string; unit: string; month: string | null; value: number | null; change_month_pct: number | null; change_year_pct: number | null; highest_since: string | null; lowest_since: string | null; history: { start: string; values: Array<number | null> } }
export interface PricesData { available: true; source: string; licence: string; file_url: string; updated: string | null; month: string | null; series: PriceSeries[] }

/** Risk level → words and colour (0 none, 1 low, 2 medium, 3 high) */
/** The EU's member states: USDA reports the EU as one, so its card shades all of them on the map */
export const EU_MEMBERS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'] as const

/**
 * The member states the EU's flag outlines on the map: only those holding one of its growing regions
 * at medium or high risk. Its card still shades all 27, but on Oct 24, 2026 a dry Castile and León
 * outlined every one of them in red as if each were at risk; now it outlines Spain.
 * `contains(iso, lng, lat)` says whether a member's shape holds the point.
 */
export function euFlagMembers(eu: MapRow | undefined, contains: (iso: string, lng: number, lat: number) => boolean): Set<string> {
  const out = new Set<string>()
  if (!eu?.flag) return out
  for (const g of eu.regions) {
    if (g.level < 2) continue
    for (const iso of EU_MEMBERS) if (contains(iso, g.lon, g.lat)) out.add(iso)
  }
  return out
}

export const LEVEL_WORDS = ['No risk', 'Low', 'Medium', 'High'] as const
export const LEVEL_COLOR = ['#64748b', '#38bdf8', '#f59e0b', '#ef4444'] as const

/** The supply-risk score's colour on the map (the same breaks as the calls) */
export function scoreColor(score: number): string {
  if (score >= 50) return '#ef4444'
  if (score >= 30) return '#f97316'
  if (score >= 10) return '#f59e0b'
  if (score > 0) return '#38bdf8'
  return '#475569'
}

/** "2026-09" → "September 2026" */
export function monthLabel(ym: string | null | undefined): string {
  if (!ym) return ''
  const d = new Date(`${ym}-15T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** A percent with its sign: "+14.1%", "−8.9%" */
export function signedPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`
}

export const CREDITS = 'Crop figures: USDA FAS (PSD, Weekly Export Sales). Prices: World Bank Commodity Price Data (The Pink Sheet), CC BY 4.0. Hedge funds: CFTC Commitments of Traders. Weather: MET Norway (CC BY 4.0), normals from NASA POWER. Trade partners: CEPII BACI (Etalab Open Licence 2.0).'
