/**
 * CFTC Commitments of Traders (Oct 23, 2026)
 *
 * Devon asked for CME Group's markets in WorldPulse. CME's own pages are for personal,
 * non-commercial use only (no automated collection, no reuse, no AI use), so its prices need a
 * licence. What WorldPulse can bring in is the regulator's weekly report on the same markets: the
 * CFTC publishes, as US government data free to reuse, who holds what in every US futures market
 * with 20 or more large traders, CME's and ICE's included.
 *
 * Every Friday at 3:30 PM Eastern (positions as of that Tuesday; later in a holiday week), in the
 * CFTC's Public Reporting Environment (publicreporting.cftc.gov, Socrata, no key):
 *   72hh-3qpy  Disaggregated, futures only: commodities. "Managed money": hedge funds and other
 *              money managers.
 *   gpe5-46if  Traders in Financial Futures, futures only: rates, currencies, the S&P 500 and
 *              bitcoin. "Leveraged funds": hedge funds and trading advisers.
 *
 * For 23 markets, a report when the funds' net position (long less short) is notable:
 *   - a switch between betting on higher and on lower prices;
 *   - the largest (or smallest) net position in a year;
 *   - a week's change at least 2.5 times the year's typical (median) weekly change and at least
 *     2% of the contracts open.
 * One report per market a week at most, pinned at the exchange (Chicago or New York). The week's
 * positions for every market go to Redis (cftc:cot:latest) for the commodity pages to come.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import type { SignalSeverity } from '@worldpulse/types'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'
import { newYorkTime } from './usda-export-sales'

const log = rootLogger.child({ module: 'cftc-cot' })

export const SOURCE_ID = 'cftc-cot'
const API = 'https://publicreporting.cftc.gov/resource/'
export const REPORT_PAGE = 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm'
const POLL_INTERVAL_MS = Number(process.env.CFTC_COT_INTERVAL_MS) || 2 * 3_600_000
const RELIABILITY = 0.95
export const SNAPSHOT_KEY = 'cftc:cot:latest'
const SNAPSHOT_TTL_S = 30 * 86_400
const DONE_TTL_S = 60 * 86_400
const WEEKS = 52

const CITY = {
  'Chicago':  { lat: 41.8781, lng: -87.6298 },
  'New York': { lat: 40.7069, lng: -74.0089 },
} as const

export const DATASETS = {
  disaggregated: { id: '72hh-3qpy', long: 'm_money_positions_long_all', short: 'm_money_positions_short_all', who: 'hedge funds and other money managers ("managed money")' },
  tff:           { id: 'gpe5-46if', long: 'lev_money_positions_long',   short: 'lev_money_positions_short',   who: 'hedge funds and trading advisers ("leveraged funds")' },
} as const

export interface Market {
  code: string
  name: string
  dataset: keyof typeof DATASETS
  city: keyof typeof CITY
  /** What a long position bets on, and a short one */
  up: string
  down: string
  tag: string
}

const prices = (n: string) => ({ up: `higher ${n} prices`, down: `lower ${n} prices` })

export const MARKETS: Market[] = [
  { code: '067651', name: 'WTI crude oil',         dataset: 'disaggregated', city: 'New York', tag: 'crude-oil',     ...prices('WTI crude oil') },
  { code: '06765T', name: 'Brent crude oil',       dataset: 'disaggregated', city: 'New York', tag: 'brent',         ...prices('Brent crude oil') },
  { code: '023651', name: 'natural gas',           dataset: 'disaggregated', city: 'New York', tag: 'natural-gas',   ...prices('US natural gas') },
  { code: '111659', name: 'gasoline',              dataset: 'disaggregated', city: 'New York', tag: 'gasoline',      ...prices('gasoline') },
  { code: '088691', name: 'gold',                  dataset: 'disaggregated', city: 'New York', tag: 'gold',          ...prices('gold') },
  { code: '084691', name: 'silver',                dataset: 'disaggregated', city: 'New York', tag: 'silver',        ...prices('silver') },
  { code: '085692', name: 'copper',                dataset: 'disaggregated', city: 'New York', tag: 'copper',        ...prices('copper') },
  { code: '002602', name: 'corn',                  dataset: 'disaggregated', city: 'Chicago',  tag: 'corn',          ...prices('corn') },
  { code: '005602', name: 'soybeans',              dataset: 'disaggregated', city: 'Chicago',  tag: 'soybeans',      ...prices('soybean') },
  { code: '001602', name: 'wheat',                 dataset: 'disaggregated', city: 'Chicago',  tag: 'wheat',         ...prices('wheat') },
  { code: '057642', name: 'live cattle',           dataset: 'disaggregated', city: 'Chicago',  tag: 'cattle',        ...prices('cattle') },
  { code: '054642', name: 'lean hogs',             dataset: 'disaggregated', city: 'Chicago',  tag: 'hogs',          ...prices('hog') },
  { code: '083731', name: 'coffee',                dataset: 'disaggregated', city: 'New York', tag: 'coffee',        ...prices('coffee') },
  { code: '073732', name: 'cocoa',                 dataset: 'disaggregated', city: 'New York', tag: 'cocoa',         ...prices('cocoa') },
  { code: '080732', name: 'sugar',                 dataset: 'disaggregated', city: 'New York', tag: 'sugar',         ...prices('sugar') },
  { code: '033661', name: 'cotton',                dataset: 'disaggregated', city: 'New York', tag: 'cotton',        ...prices('cotton') },
  { code: '13874A', name: 'S&P 500',               dataset: 'tff', city: 'Chicago', tag: 'sp500',    up: 'a rising S&P 500',                    down: 'a falling S&P 500' },
  { code: '043602', name: '10-year Treasury note', dataset: 'tff', city: 'Chicago', tag: 'treasuries', up: 'lower 10-year Treasury yields',     down: 'higher 10-year Treasury yields' },
  { code: '020601', name: 'Treasury bond',         dataset: 'tff', city: 'Chicago', tag: 'treasuries', up: 'lower long-term Treasury yields',   down: 'higher long-term Treasury yields' },
  { code: '045601', name: 'fed funds',             dataset: 'tff', city: 'Chicago', tag: 'fed-funds', up: 'lower US interest rates',           down: 'higher US interest rates' },
  { code: '099741', name: 'euro',                  dataset: 'tff', city: 'Chicago', tag: 'euro',     up: 'a stronger euro against the dollar', down: 'a weaker euro against the dollar' },
  { code: '097741', name: 'Japanese yen',          dataset: 'tff', city: 'Chicago', tag: 'yen',      up: 'a stronger yen against the dollar',  down: 'a weaker yen against the dollar' },
  { code: '133741', name: 'bitcoin',               dataset: 'tff', city: 'Chicago', tag: 'bitcoin',  up: 'a higher bitcoin price',             down: 'a lower bitcoin price' },
]

// ─── A MARKET'S YEAR ─────────────────────────────────────────────────────────

export interface Week {
  /** The Tuesday the positions are from, "2026-10-20" */
  date: string
  openInterest: number
  long: number
  short: number
}

export type Finding =
  | { kind: 'flip'; lastSameSide: string | null }
  | { kind: 'largest' }
  | { kind: 'smallest' }
  | { kind: 'move'; delta: number; typical: number }

export interface Reading {
  market: Market
  current: Week
  net: number
  previousNet: number
  maxNet: { net: number; date: string }
  minNet: { net: number; date: string }
  finding: Finding | null
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return 0
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** One market's last year of weeks, newest first, read for the one finding worth a report (if any) */
export function readMarket(market: Market, weeks: Week[]): Reading | null {
  const year = weeks.slice(0, WEEKS)
  if (year.length < 10) return null                  // too little history to say what's unusual
  const nets = year.map(w => w.long - w.short)
  const net = nets[0]!, previousNet = nets[1]!
  const current = year[0]!
  let maxI = 0, minI = 0
  nets.forEach((n, i) => { if (n > nets[maxI]!) maxI = i; if (n < nets[minI]!) minI = i })
  const reading: Reading = {
    market, current, net, previousNet,
    maxNet: { net: nets[maxI]!, date: year[maxI]!.date },
    minNet: { net: nets[minI]!, date: year[minI]!.date },
    finding: null,
  }

  // 1. From betting on lower prices to higher, or back
  if (net !== 0 && previousNet !== 0 && Math.sign(net) !== Math.sign(previousNet)) {
    const i = nets.findIndex((n, k) => k > 0 && Math.sign(n) === Math.sign(net))
    reading.finding = { kind: 'flip', lastSameSide: i > 0 ? year[i]!.date : null }
    return reading
  }
  // 2. The largest or smallest net position of the year, and alone at it
  const others = nets.slice(1)
  const above = net > Math.max(...others), below = net < Math.min(...others)
  if (above || below) {
    const largest = net > 0 ? above : below          // furthest from zero on its side
    reading.finding = { kind: largest ? 'largest' : 'smallest' }
    return reading
  }
  // 3. A week's change well beyond a usual week's
  const deltas = nets.slice(0, -1).map((n, i) => n - nets[i + 1]!)
  const delta = deltas[0]!
  const typical = median(deltas.slice(1).map(Math.abs))
  if (typical > 0 && Math.abs(delta) >= 2.5 * typical && Math.abs(delta) >= 0.02 * current.openInterest) {
    reading.finding = { kind: 'move', delta, typical }
  }
  return reading
}

// ─── WORDING ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
const withYear = (iso: string): string => `${shortDate(iso)}, ${iso.slice(0, 4)}`
const n = (x: number): string => Math.round(Math.abs(x)).toLocaleString('en-US')
/** "21,000 contracts": a title's rounding, to the thousand from 10,000 */
const contracts = (x: number): string => {
  const a = Math.abs(x)
  return `${(a >= 10_000 ? Math.round(a / 1000) * 1000 : Math.round(a / 100) * 100).toLocaleString('en-US')} contracts`
}
const side = (net: number, m: Market): string => (net >= 0 ? m.up : m.down)

export interface PlannedReport {
  dedupKey: string
  title: string
  summary: string
  severity: SignalSeverity
  lat: number
  lng: number
  locationName: string
  tags: string[]
}

export function planReport(r: Reading): PlannedReport | null {
  const f = r.finding
  if (!f) return null
  const m = r.market
  const when = ` (CFTC, week to ${shortDate(r.current.date)})`
  let title: string
  let severity: SignalSeverity = 'medium'
  if (f.kind === 'flip') {
    title = `Hedge funds now bet on ${side(r.net, m)}`
      + (f.lastSameSide ? `, for the first time since ${withYear(f.lastSameSide)}` : ', for the first time in at least a year')
  } else if (f.kind === 'largest') {
    title = `Hedge funds' bet on ${side(r.net, m)} is the biggest in a year`
  } else if (f.kind === 'smallest') {
    title = `Hedge funds' bet on ${side(r.net, m)} is the smallest in a year`
    severity = 'low'
  } else {
    // Towards higher prices: adding to a long or cutting a short
    const verb = (f.delta > 0) === (r.net > 0) ? 'added to' : 'cut'
    const times = Math.round(Math.abs(f.delta) / f.typical)
    title = `Hedge funds ${verb} their bet on ${side(r.net, m)} by ${contracts(f.delta)} in a week, about ${times} times a usual week's change`
    severity = times >= 4 ? 'medium' : 'low'
  }
  const ds = DATASETS[m.dataset]
  const share = r.current.openInterest > 0 ? Math.round((100 * Math.abs(r.net)) / r.current.openInterest) : null
  const summary = [
    `Commitments of Traders (US Commodity Futures Trading Commission), ${m.name} futures, positions on Tuesday ${withYear(r.current.date)}:`
      + ` ${ds.who} held ${n(r.current.long)} contracts betting on ${m.up} and ${n(r.current.short)} betting on ${m.down},`
      + ` a net ${r.net >= 0 ? 'long' : 'short'} of ${n(r.net)} contracts${share !== null ? ` (${share}% of the ${n(r.current.openInterest)} contracts open)` : ''}.`,
    `A week earlier the net was ${r.previousNet >= 0 ? 'long' : 'short'} ${n(r.previousNet)}.`
      + ` Over the past year it ranged from ${r.minNet.net >= 0 ? 'long' : 'short'} ${n(r.minNet.net)} (${withYear(r.minNet.date)})`
      + ` to ${r.maxNet.net >= 0 ? 'long' : 'short'} ${n(r.maxNet.net)} (${withYear(r.maxNet.date)}).`,
    'Positions show what large traders hold, not where prices go next. Source: CFTC Commitments of Traders.',
  ].join('\n\n')
  const place = CITY[m.city]
  return {
    dedupKey: `osint:cftc-cot:${r.current.date}:${m.code}`,
    title: (title + when).slice(0, 500),
    summary,
    severity,
    lat: place.lat,
    lng: place.lng,
    locationName: `${m.city}, US`,
    tags: ['cftc', 'cot', 'positioning', 'futures', 'finance', m.tag, f.kind],
  }
}

/** When the CFTC publishes a Tuesday's positions: that Friday, 3:30 PM Eastern */
export function releaseTime(tuesday: string): Date {
  const [y, mo, d] = tuesday.split('-').map(Number) as [number, number, number]
  const friday = new Date(Date.UTC(y, mo - 1, d + 3))
  return newYorkTime(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate(), 15, 30)
}

// ─── POLLER ──────────────────────────────────────────────────────────────────

type Row = Record<string, string>

async function query(dataset: keyof typeof DATASETS, params: Record<string, string>): Promise<Row[]> {
  const url = `${API}${DATASETS[dataset].id}.json?${new URLSearchParams(params).toString()}`
  return fetchWithResilience(SOURCE_ID, 'CFTC Commitments of Traders', url, async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WorldPulse/1.0 (world-pulse.io; weekly positioning)', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw Object.assign(new Error(`CFTC ${dataset}: HTTP ${res.status}`), { statusCode: res.status })
    return res.json() as Promise<Row[]>
  })
}

/** Every market of one report kind, a year and a week back from the newest report */
async function yearOf(dataset: keyof typeof DATASETS, newest: string): Promise<Map<string, Week[]>> {
  const ds = DATASETS[dataset]
  const codes = MARKETS.filter(m => m.dataset === dataset).map(m => `'${m.code}'`).join(',')
  const since = new Date(Date.parse(`${newest}T00:00:00Z`) - (WEEKS + 1) * 7 * 86_400_000).toISOString().slice(0, 10)
  const rows = await query(dataset, {
    $select: `cftc_contract_market_code,report_date_as_yyyy_mm_dd,open_interest_all,${ds.long},${ds.short}`,
    $where: `cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd >= '${since}T00:00:00.000'`,
    $order: 'report_date_as_yyyy_mm_dd DESC',
    $limit: '5000',
  })
  const out = new Map<string, Week[]>()
  for (const r of rows) {
    const code = r.cftc_contract_market_code ?? ''
    const week: Week = {
      date: (r.report_date_as_yyyy_mm_dd ?? '').slice(0, 10),
      openInterest: Number(r.open_interest_all) || 0,
      long: Number(r[ds.long]) || 0,
      short: Number(r[ds.short]) || 0,
    }
    if (!week.date) continue
    const list = out.get(code) ?? []
    list.push(week)
    out.set(code, list)
  }
  for (const list of out.values()) list.sort((a, b) => b.date.localeCompare(a.date))
  return out
}

export function startCftcCotPoller(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      const latestRows = await query('disaggregated', { $select: 'max(report_date_as_yyyy_mm_dd) AS latest' })
      const newest = (latestRows[0]?.latest ?? '').slice(0, 10)
      if (!newest) { log.warn('CFTC: no report date'); return }
      if (await redis.get(`cftc:cot:done:${newest}`)) return
      if (Date.now() < releaseTime(newest).getTime()) return

      const years = new Map([...await yearOf('disaggregated', newest), ...await yearOf('tff', newest)])
      const readings: Reading[] = []
      for (const m of MARKETS) {
        const weeks = years.get(m.code) ?? []
        if (weeks[0]?.date !== newest) continue        // not in this week's report
        const r = readMarket(m, weeks)
        if (r) readings.push(r)
      }

      await redis.set(SNAPSHOT_KEY, JSON.stringify({
        report_date: newest,
        released_at: releaseTime(newest).toISOString(),
        source: 'CFTC Commitments of Traders (US government data, free to reuse)',
        markets: readings.map(r => ({
          code: r.market.code, name: r.market.name, who: DATASETS[r.market.dataset].who,
          long: r.current.long, short: r.current.short, net: r.net, previous_net: r.previousNet,
          open_interest: r.current.openInterest, year_max: r.maxNet, year_min: r.minNet,
          finding: r.finding?.kind ?? null,
        })),
      }), 'EX', SNAPSHOT_TTL_S)

      let inserted = 0
      for (const r of readings) {
        const p = planReport(r)
        if (!p || await redis.get(p.dedupKey)) continue
        try {
          const signal = await insertAndCorrelate({
            title: p.title,
            summary: p.summary,
            original_urls: [REPORT_PAGE],
            source_ids: [],
            category: 'finance' as const,
            severity: p.severity,
            status: 'pending',
            reliability_score: RELIABILITY,
            location: db.raw('ST_MakePoint(?, ?)', [p.lng, p.lat]),
            location_name: p.locationName,
            country_code: 'US',
            region: 'Americas',
            tags: p.tags,
            language: 'en',
            event_time: new Date(),
            source_count: 1,
          }, { lat: p.lat, lng: p.lng, sourceId: SOURCE_ID, sourceName: 'CFTC Commitments of Traders', sourceSlug: SOURCE_ID })
          await redis.set(p.dedupKey, '1', 'EX', DONE_TTL_S)
          inserted++
          if (signal && (signal as { id?: unknown }).id && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{ key: 'finance', value: JSON.stringify({ event: 'signal.new', payload: signal, filter: { category: 'finance', severity: p.severity } }) }],
            }).catch(() => {})
          }
        } catch (err) {
          log.warn({ err, title: p.title }, 'CFTC: a report was not stored')
        }
      }
      await redis.set(`cftc:cot:done:${newest}`, '1', 'EX', DONE_TTL_S)
      log.info({ report: newest, markets: readings.length, inserted }, 'CFTC Commitments of Traders read')
    } catch (err) {
      if (err instanceof CircuitOpenError) return
      log.error({ err }, 'CFTC Commitments of Traders poll error')
    } finally {
      running = false
    }
  }

  void poll()
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearInterval(timer)
    log.info('CFTC Commitments of Traders poller stopped')
  }
}
