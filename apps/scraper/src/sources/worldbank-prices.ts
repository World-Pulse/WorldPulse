/**
 * The World Bank's monthly commodity prices, "the Pink Sheet" (Oct 23, 2026; Devon: "Start with
 * free prices", the commodity, weather and trade layer)
 *
 * Every month (about the second working day) the World Bank publishes the month before's average
 * price of 71 commodities in nominal US dollars: oil, gas and coal; cocoa, coffee, tea; vegetable
 * oils and meals; grains and rice; fruit, meat, shrimp, sugar, tobacco; timber; cotton and rubber;
 * fertilizers (phosphate rock, DAP, TSP, urea, potash); metals and precious metals. Licensed
 * CC BY 4.0: free to reuse with credit ("World Bank Commodity Price Data (The Pink Sheet)").
 *
 * The file is linked from the Commodity Markets page, under an address that changes with new
 * releases, so the page is read first for the link (the last address found is kept in case the
 * page can't be read):
 *   https://www.worldbank.org/en/research/commodity-markets  → CMO-Historical-Data-Monthly.xlsx
 *
 * Read every 6 hours (If-Modified-Since); a new file is read for each series' latest month, the
 * month before, a year before, how far back a higher or lower price was last seen, and its last 60
 * months. Into Redis as commodity:prices:latest, for the commodity watch, the map's commodities
 * layer and the country panels.
 */

import type Redis from 'ioredis'
import { logger as rootLogger } from '../lib/logger'
import { readSheet, type Cell, type SheetRow } from '../lib/xlsx'

const log = rootLogger.child({ module: 'worldbank-prices' })

export const SOURCE_ID = 'worldbank-prices'
export const PAGE_URL = 'https://www.worldbank.org/en/research/commodity-markets'
/** The address in October 2026, used until the page gives one */
export const DEFAULT_FILE_URL = 'https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx'
export const SHEET = 'Monthly Prices'
export const LATEST_KEY = 'commodity:prices:latest'
const FILE_URL_KEY = 'commodity:prices:file-url'
const MODIFIED_KEY = 'commodity:prices:last-modified'
const POLL_INTERVAL_MS = Number(process.env.WORLDBANK_PRICES_INTERVAL_MS) || 6 * 3_600_000
export const HISTORY_MONTHS = 60
const USER_AGENT = 'WorldPulse/1.0 (world-pulse.io; commodity watch)'

export const CREDIT = 'World Bank Commodity Price Data (The Pink Sheet)'
export const LICENCE = 'CC BY 4.0'

export interface PriceSeries {
  /** "coffee-arabica" */
  key: string
  /** "Coffee, Arabica" (the World Bank's footnote marks left out) */
  name: string
  /** "$/kg", "$/mt", "$/bbl", "$/troy oz", "$/mmbtu", "2010=100" */
  unit: string
  /** The latest month with a price, "2026-09" (some series stop: check it against the file's month) */
  month: string | null
  value: number | null
  /** The month before's price, and a year before's */
  previous: number | null
  year_ago: number | null
  /** Percent changes, one decimal */
  change_month_pct: number | null
  change_year_pct: number | null
  /**
   * The latest price's place in the series' history since 1960: "highest since 2025-03" (the last
   * month at least as high), "record" (never as high), or null when the month before was already
   * as high. The same for lows.
   */
  highest_since: string | null
  lowest_since: string | null
  /** The last 60 months, oldest first, from history.start ("2021-10"); null where there's no price */
  history: { start: string; values: Array<number | null> }
}

export interface PricesSnapshot {
  source: typeof CREDIT
  licence: typeof LICENCE
  file_url: string
  /** The file's Last-Modified */
  file_date: string | null
  /** The World Bank's own date, "Updated on October 02, 2026" → "2026-10-02" */
  updated: string | null
  /** The newest month in the file, "2026-09" */
  month: string | null
  series: Record<string, PriceSeries>
}

// ─── READING THE FILE ────────────────────────────────────────────────────────

/** "Rice, Thai 5% " → "rice-thai-5"; "Potassium chloride **" → "potassium-chloride" */
export function seriesKey(name: string): string {
  return name.toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** "Coal, South African **" → "Coal, South African" */
export function cleanName(name: string): string {
  return name.replace(/\*+/g, '').replace(/\s+/g, ' ').trim()
}

/** "($/kg)" → "$/kg" */
export function cleanUnit(unit: string): string {
  return unit.trim().replace(/^\((.*)\)$/, '$1').trim()
}

/** "2026M09" → "2026-09" */
export function monthOf(cell: Cell): string | null {
  const m = typeof cell === 'string' ? /^(\d{4})M(\d{2})$/.exec(cell.trim()) : null
  return m ? `${m[1]}-${m[2]}` : null
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "Updated on October 02, 2026" → "2026-10-02" */
export function updatedOn(text: string): string | null {
  const m = /updated on\s+([a-z]+)\s+(\d{1,2}),\s*(\d{4})/i.exec(text)
  if (!m) return null
  const month = MONTHS.indexOf(m[1]!.toLowerCase())
  return month < 0 ? null : `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`
}

/** A month a number of months before or after another ("2026-09", -12 → "2025-09") */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const k = y * 12 + (m - 1) + n
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`
}

function pct(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10
}

function price(cell: Cell | undefined): number | null {
  // Missing months are "…" in the file
  return typeof cell === 'number' && Number.isFinite(cell) ? cell : null
}

/** The Monthly Prices sheet's rows into each series' latest reading and recent history */
export function readPrices(rows: readonly SheetRow[], fileUrl = DEFAULT_FILE_URL, fileDate: string | null = null): PricesSnapshot {
  const dataStart = rows.findIndex(r => monthOf(r.cells.A ?? null) !== null)
  if (dataStart < 2) throw new Error('the Monthly Prices sheet has no months in column A')
  const head = rows.slice(0, dataStart)

  // The units row: the last before the data whose cells are mostly "(…)"; the names are the row above
  const isUnits = (row: SheetRow): boolean => {
    const texts = Object.entries(row.cells).filter(([c, v]) => c !== 'A' && typeof v === 'string' && v.trim())
    return texts.length >= 5 && texts.filter(([, v]) => /^\(.*\)$/.test(String(v).trim())).length >= texts.length * 0.8
  }
  const unitsAt = head.map(isUnits).lastIndexOf(true)
  if (unitsAt < 1) throw new Error('the Monthly Prices sheet has no row of units')
  const units = head[unitsAt]!.cells
  const names = head[unitsAt - 1]!.cells
  let updated: string | null = null
  for (const row of head) for (const v of Object.values(row.cells)) if (!updated && typeof v === 'string') updated = updatedOn(v)

  const data = rows.slice(dataStart).filter(r => monthOf(r.cells.A ?? null))
  const months = data.map(r => monthOf(r.cells.A ?? null)!)
  const newest = months.length ? months[months.length - 1]! : null

  const series: Record<string, PriceSeries> = {}
  for (const [col, rawName] of Object.entries(names)) {
    if (col === 'A' || typeof rawName !== 'string' || !rawName.trim()) continue
    const name = cleanName(rawName)
    const key = seriesKey(name)
    if (!key || series[key]) continue
    const byMonth = new Map<string, number>()
    data.forEach((r, i) => {
      const v = price(r.cells[col])
      if (v !== null) byMonth.set(months[i]!, v)
    })
    // The latest month with a price, and the comparisons from it
    let at = -1
    for (let i = data.length - 1; i >= 0; i--) if (byMonth.has(months[i]!)) { at = i; break }
    const month = at >= 0 ? months[at]! : null
    const value = month ? byMonth.get(month)! : null
    const previous = month ? byMonth.get(addMonths(month, -1)) ?? null : null
    const yearAgo = month ? byMonth.get(addMonths(month, -12)) ?? null : null
    let highestSince: string | null = null
    let lowestSince: string | null = null
    if (value !== null && at > 0) {
      const lastHigh = (() => { for (let i = at - 1; i >= 0; i--) { const v = byMonth.get(months[i]!); if (v !== undefined && v >= value) return i } return -1 })()
      const lastLow = (() => { for (let i = at - 1; i >= 0; i--) { const v = byMonth.get(months[i]!); if (v !== undefined && v <= value) return i } return -1 })()
      // Only when the price passed something: the month before wasn't already as high (as low)
      if (lastHigh < at - 1) highestSince = lastHigh < 0 ? 'record' : months[lastHigh]!
      if (lastLow < at - 1) lowestSince = lastLow < 0 ? 'record' : months[lastLow]!
    }
    const start = newest ? addMonths(newest, -(HISTORY_MONTHS - 1)) : ''
    const values: Array<number | null> = []
    if (newest) for (let k = 0; k < HISTORY_MONTHS; k++) values.push(byMonth.get(addMonths(start, k)) ?? null)
    series[key] = {
      key,
      name,
      unit: cleanUnit(typeof units[col] === 'string' ? (units[col] as string) : ''),
      month,
      value,
      previous,
      year_ago: yearAgo,
      change_month_pct: pct(value, previous),
      change_year_pct: pct(value, yearAgo),
      highest_since: highestSince,
      lowest_since: lowestSince,
      history: { start, values },
    }
  }
  return { source: CREDIT, licence: LICENCE, file_url: fileUrl, file_date: fileDate, updated, month: newest, series }
}

/** The monthly file's address on the Commodity Markets page */
export function findFileUrl(html: string): string | null {
  const m = /(?:https?:)?\/\/thedocs\.worldbank\.org\/[^"'\s<>]*?CMO-Historical-Data-Monthly\.xlsx/i.exec(html)
  if (!m) return null
  return m[0].startsWith('//') ? `https:${m[0]}` : m[0].replace(/^http:/, 'https:')
}

// ─── POLLER ──────────────────────────────────────────────────────────────────

export function startWorldBankPricesPoller(redis: Redis): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      // 1. Where the file is this month
      const known = (await redis.get(FILE_URL_KEY)) || DEFAULT_FILE_URL
      let fileUrl = known
      try {
        const page = await fetch(PAGE_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
        if (page.ok) fileUrl = findFileUrl(await page.text()) || known
        else log.warn({ status: page.status }, 'World Bank prices: Commodity Markets page not read; using the last address')
      } catch (err) {
        log.warn({ err }, 'World Bank prices: Commodity Markets page not reached; using the last address')
      }

      // 2. The file, unless it hasn't changed
      const since = fileUrl === known ? await redis.get(MODIFIED_KEY) : null
      const res = await fetch(fileUrl, {
        headers: { 'User-Agent': USER_AGENT, ...(since ? { 'If-Modified-Since': since } : {}) },
        signal: AbortSignal.timeout(120_000),
      })
      if (res.status === 304) return
      if (!res.ok) { log.warn({ status: res.status, fileUrl }, 'World Bank prices: download failed'); return }
      const modified = res.headers.get('last-modified')
      const snapshot = readPrices(readSheet(Buffer.from(await res.arrayBuffer()), SHEET), fileUrl, modified)
      const current = Object.values(snapshot.series).filter(s => s.month === snapshot.month).length
      if (current < 40) { log.warn({ current, month: snapshot.month }, 'World Bank prices: too few series priced in the newest month; keeping the last file'); return }
      await redis.set(LATEST_KEY, JSON.stringify(snapshot))
      await redis.set(FILE_URL_KEY, fileUrl)
      if (modified) await redis.set(MODIFIED_KEY, modified)
      log.info({ series: Object.keys(snapshot.series).length, month: snapshot.month, updated: snapshot.updated }, 'World Bank prices: file read')
    } catch (err) {
      log.error({ err }, 'World Bank prices poll error')
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => { void poll() }, 90_000)
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    log.info('World Bank prices poller stopped')
  }
}
