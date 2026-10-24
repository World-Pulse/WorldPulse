/**
 * USDA world production, supply and distribution (PSD) (Oct 23, 2026; Devon: the commodity, weather
 * and trade layer, "all commodities should go first", every country)
 *
 * USDA's Foreign Agricultural Service estimates, for 64 farm commodities (grains, oilseeds, meals
 * and oils, coffee, cotton, sugar, meats, dairy, fruit, tree nuts) and every producing or trading
 * country, the year's production, exports, imports, stocks and use. Grains, oilseeds and cotton
 * are revised every month with the WASDE report (about the 10th, noon Eastern); sugar, coffee,
 * fruit and nuts once or twice a year. US government data, free to reuse; the whole database is
 * one public file, no key:
 *   https://apps.fas.usda.gov/psdonline/downloads/psd_alldata_csv.zip  (10 MB zipped, 200 MB of CSV)
 *
 * Checked daily (If-Modified-Since); on a new release the file is streamed (never held whole in
 * memory) and only the two latest marketing years are kept: per commodity and country, production,
 * exports, imports, ending stocks, domestic use, area and yield. The release goes to Redis as
 * commodity:psd:latest, and the one before it to commodity:psd:previous: the month-on-month
 * revisions the commodity watch checks its outlooks against.
 */

import { Readable } from 'node:stream'
import { createInflateRaw } from 'node:zlib'
import type Redis from 'ioredis'
import { logger as rootLogger } from '../lib/logger'
import { zipEntries, type ZipEntry } from '../lib/zip'

const log = rootLogger.child({ module: 'usda-psd' })

export const SOURCE_ID = 'usda-psd'
export const PSD_URL = 'https://apps.fas.usda.gov/psdonline/downloads/psd_alldata_csv.zip'
export const LATEST_KEY = 'commodity:psd:latest'
export const PREVIOUS_KEY = 'commodity:psd:previous'
const MODIFIED_KEY = 'commodity:psd:last-modified'
const POLL_INTERVAL_MS = Number(process.env.USDA_PSD_INTERVAL_MS) || 6 * 3_600_000

/** USDA's attribute ids → the readings the commodity watch uses */
export const ATTRIBUTES: Record<string, keyof Readings> = {
  '028': 'production',
  '088': 'exports',
  '057': 'imports',
  '176': 'ending_stocks',
  '125': 'consumption',
  '004': 'area',
  '184': 'yield',
}

export interface Readings {
  production?: number
  exports?: number
  imports?: number
  ending_stocks?: number
  consumption?: number
  area?: number
  yield?: number
}

export interface CountryYears {
  /** ISO 3166-1 alpha-2; "EU" for the European Union; null for groups and countries that no longer exist */
  iso: string | null
  name: string
  current: Readings
  previous: Readings
  /** When USDA last revised the current year's figures, "2026-10" */
  estimate: string | null
}

export interface CommodityPsd {
  name: string
  /** Production's unit as USDA gives it: "1000 MT", "1000 60 KG BAGS", "1000 480 lb. Bales" */
  unit: string
  /** The current and the previous marketing year, as USDA numbers them (2026 is 2026/27) */
  current_year: number
  previous_year: number
  countries: Record<string, CountryYears>
}

export interface PsdSnapshot {
  /** The file's Last-Modified */
  file_date: string | null
  /** The newest estimate month in the file, "2026-10" */
  release: string | null
  commodities: Record<string, CommodityPsd>
}

// ─── USDA'S COUNTRY CODES ────────────────────────────────────────────────────

/**
 * USDA's country codes (FIPS 10-4 style) → ISO 3166-1 alpha-2. null: a group, or a country that no
 * longer exists (its old years only). "EU": the European Union, which USDA reports as one.
 */
export const FAS_TO_ISO: Record<string, string | null> = {
  AF: 'AF', AG: 'DZ', AR: 'AR', AM: 'AM', AS: 'AU', AJ: 'AZ', BA: 'BH', BO: 'BY', BR: 'BR', CA: 'CA', CI: 'CL',
  CH: 'CN', CO: 'CO', CS: 'CR', EC: 'EC', EG: 'EG', E4: 'EU', GG: 'GE', GR: 'GR', HK: 'HK', IN: 'IN', ID: 'ID',
  IR: 'IR', IS: 'IL', IT: 'IT', JA: 'JP', JO: 'JO', KZ: 'KZ', KS: 'KR', KG: 'KG', MY: 'MY', MX: 'MX', MO: 'MA',
  NZ: 'NZ', NO: 'NO', PK: 'PK', PE: 'PE', RP: 'PH', PO: 'PT', QA: 'QA', RS: 'RU', SA: 'SA', RB: 'RS', SN: 'SG',
  SF: 'ZA', SP: 'ES', SZ: 'CH', TW: 'TW', TH: 'TH', TS: 'TN', TU: 'TR', UP: 'UA', TC: 'AE', UK: 'GB', US: 'US',
  UZ: 'UZ', VM: 'VN', AU: 'AT', BE: 'BE', BH: 'BZ', BU: 'BG', EZ: 'CZ', DA: 'DK', DR: 'DO', ES: 'SV', EN: 'EE',
  E2: null, FI: 'FI', CZ: null, YO: null, FR: 'FR', GC: null, GM: 'DE', GE: null, GT: 'GT', HA: 'HT', HO: 'HN',
  HU: 'HU', EI: 'IE', LG: 'LV', LH: 'LT', MD: 'MD', NL: 'NL', NU: 'NI', PN: 'PA', PL: 'PL', RO: 'RO', LO: 'SK',
  SW: 'SE', TI: 'TJ', TX: 'TM', UR: null, UY: 'UY', VE: 'VE', YU: null, AL: 'AL', AO: 'AO', BG: 'BD', BK: 'BA',
  BM: 'MM', HR: 'HR', IZ: 'IQ', KN: 'KP', KU: 'KW', LE: 'LB', LY: 'LY', NP: 'NP', NI: 'NG', MU: 'OM', CE: 'LK',
  SY: 'SY', ZA: 'ZM', RH: 'ZW', BT: 'BT', BL: 'BO', CU: 'CU', CY: 'CY', ER: 'ER', ET: 'ET', IC: 'IS', KE: 'KE',
  MT: 'MT', MK: 'MK', SR: null, SI: 'SI', YM: 'YE', YE: null, DM: 'BJ', BY: 'BI', CM: 'CM', CT: 'CF', CF: 'CG',
  CG: 'CD', IV: 'CI', EK: 'GQ', GB: 'GA', GH: 'GH', GU: 'GN', GY: 'GY', JM: 'JM', KV: 'XK', LA: 'LA', LI: 'LR',
  MA: 'MG', MI: 'MW', MJ: 'ME', NC: 'NC', PP: 'PG', PA: 'PY', RW: 'RW', SG: 'SN', SL: 'SL', TZ: 'TZ', TO: 'TG',
  TD: 'TT', UG: 'UG', BC: 'BW', UV: 'BF', CV: 'CV', CB: 'KH', CD: 'TD', WZ: 'SZ', GA: 'GM', PU: 'GW', LT: 'LS',
  ML: 'ML', MR: 'MR', MZ: 'MZ', WA: 'NA', SO: 'SO', OD: 'SS', MP: 'MU', NG: 'NE', SU: 'SD', YS: null, LU: 'LU',
  GZ: 'PS', FJ: 'FJ', WS: 'WS', BD: 'BM', FO: 'FO', BB: 'BB', NA: null, NS: 'SR', AC: 'AG', BF: 'BS', MC: 'MO',
  DJ: 'DJ', ZZ: null, CN: 'KM', TP: 'ST', BP: 'SB', NH: 'VU', S8: 'BE', BX: 'BN', RE: 'RE', E3: null, FT: null,
  FP: 'PF', Y2: null, GI: 'GI', GN: null, GL: 'GL', GJ: 'GD', GP: 'GP', MV: 'MV', MB: 'MQ', MG: 'MN', RQ: 'PR',
  SE: 'SC', SC: 'KN', ST: 'LC', TN: 'TO', VO: 'VI',
}

// ─── READING THE FILE ────────────────────────────────────────────────────────

/** One CSV line into its fields (USDA quotes text fields; no field holds a line break) */
export function csvFields(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** The first file in a zip (USDA's download holds one: psd_alldata.csv) */
export function firstEntry(zip: Buffer): ZipEntry {
  const entry = zipEntries(zip)[0]
  if (!entry) throw new Error('empty zip file')
  return entry
}

/** Every line of a zip's first file, inflated as a stream (the CSV is 200 MB; it is never whole in memory) */
export async function* zipLines(zip: Buffer): AsyncGenerator<string> {
  const entry = firstEntry(zip)
  if (entry.method !== 8 && entry.method !== 0) throw new Error(`zip method ${entry.method} not supported`)
  const source = Readable.from([entry.data])
  const stream = entry.method === 8 ? source.pipe(createInflateRaw()) : source
  let rest = ''
  for await (const chunk of stream) {
    const text = rest + (chunk as Buffer).toString('utf8')
    const lines = text.split(/\r?\n/)
    rest = lines.pop() ?? ''
    for (const line of lines) yield line
  }
  if (rest) yield rest
}

/** Market_Year, Calendar_Year, Month and Attribute_ID, right after the quoted country name */
const QUICK = /",(\d{4}),(\d{4}),(\d{1,2}),(\d{3}),/

/** The PSD CSV's lines into the two latest marketing years of every commodity and country */
export async function readPsd(lines: AsyncIterable<string> | Iterable<string>, fileDate: string | null = null): Promise<PsdSnapshot> {
  let header: string[] | null = null
  const col: Record<string, number> = {}
  // commodity → year → country → readings
  const byYear = new Map<string, Map<number, Map<string, { name: string; readings: Readings; estimate: string | null }>>>()
  const names = new Map<string, string>()
  const units = new Map<string, string>()
  let newestYear = 0
  let release: string | null = null
  const minYear = new Date().getUTCFullYear() - 3      // the file goes back to 1960: keep the last few

  for await (const line of lines as AsyncIterable<string>) {
    if (!line) continue
    if (!header) {
      header = csvFields(line).map(s => s.trim())
      header.forEach((h, i) => { col[h] = i })
      continue
    }
    // A cheap look at the year and attribute (after the quoted country name) before splitting the
    // whole line: most of the file's 2 million lines are older years or other attributes
    const quick = QUICK.exec(line)
    if (quick && (Number(quick[1]) < minYear || !ATTRIBUTES[quick[4]!])) continue
    const f = csvFields(line)
    const year = Number(f[col.Market_Year!])
    if (!(year >= minYear)) continue
    const attr = ATTRIBUTES[f[col.Attribute_ID!] ?? '']
    if (!attr) continue
    const code = f[col.Commodity_Code!] ?? ''
    const country = f[col.Country_Code!] ?? ''
    const value = Number(f[col.Value!])
    if (!code || !country || !Number.isFinite(value)) continue
    names.set(code, f[col.Commodity_Description!] ?? code)
    if (attr === 'production') units.set(code, (f[col.Unit_Description!] ?? '').replace(/[()]/g, '').trim())
    const estimate = f[col.Calendar_Year!] && f[col.Month!] ? `${f[col.Calendar_Year!]}-${String(f[col.Month!]).padStart(2, '0')}` : null
    if (estimate && (!release || estimate > release)) release = estimate
    if (year > newestYear) newestYear = year
    let years = byYear.get(code)
    if (!years) byYear.set(code, years = new Map())
    let countries = years.get(year)
    if (!countries) years.set(year, countries = new Map())
    let entry = countries.get(country)
    if (!entry) countries.set(country, entry = { name: f[col.Country_Name!] ?? country, readings: {}, estimate })
    entry.readings[attr] = value
    if (estimate && (!entry.estimate || estimate > entry.estimate)) entry.estimate = estimate
  }

  const commodities: Record<string, CommodityPsd> = {}
  for (const [code, years] of byYear) {
    // The current year: the newest with any production reported
    const withProduction = [...years.entries()]
      .filter(([, cs]) => [...cs.values()].some(c => (c.readings.production ?? 0) > 0))
      .map(([y]) => y)
      .sort((a, b) => b - a)
    const current = withProduction[0]
    if (current === undefined) continue
    const cur = years.get(current)!, prev = years.get(current - 1)
    const countries: Record<string, CountryYears> = {}
    for (const fas of new Set([...cur.keys(), ...(prev?.keys() ?? [])])) {
      const c = cur.get(fas), p = prev?.get(fas)
      const readings = c?.readings ?? {}
      const before = p?.readings ?? {}
      // A country with nothing this year or last isn't part of the picture
      if (![...Object.values(readings), ...Object.values(before)].some(v => (v ?? 0) !== 0)) continue
      countries[fas] = {
        iso: fas in FAS_TO_ISO ? FAS_TO_ISO[fas]! : null,
        name: (c ?? p)!.name,
        current: readings,
        previous: before,
        estimate: c?.estimate ?? null,
      }
    }
    commodities[code] = {
      name: names.get(code) ?? code,
      unit: units.get(code) ?? '',
      current_year: current,
      previous_year: current - 1,
      countries,
    }
  }
  return { file_date: fileDate, release, commodities }
}

// ─── POLLER ──────────────────────────────────────────────────────────────────

export function startUsdaPsdPoller(redis: Redis): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      const since = await redis.get(MODIFIED_KEY)
      const res = await fetch(PSD_URL, {
        headers: {
          'User-Agent': 'WorldPulse/1.0 (world-pulse.io; commodity watch)',
          ...(since ? { 'If-Modified-Since': since } : {}),
        },
        signal: AbortSignal.timeout(180_000),
      })
      if (res.status === 304) return
      if (!res.ok) { log.warn({ status: res.status }, 'USDA PSD: download failed'); return }
      const modified = res.headers.get('last-modified')
      const zip = Buffer.from(await res.arrayBuffer())
      const started = Date.now()
      const snapshot = await readPsd(zipLines(zip), modified)
      const count = Object.keys(snapshot.commodities).length
      if (count < 20) { log.warn({ count }, 'USDA PSD: too few commodities read; keeping the last release'); return }
      const latest = await redis.get(LATEST_KEY)
      if (latest) {
        const before = JSON.parse(latest) as PsdSnapshot
        // Keep the release before as "previous" only when this is a newer release
        if (before.release && snapshot.release && before.release < snapshot.release) await redis.set(PREVIOUS_KEY, latest)
      }
      await redis.set(LATEST_KEY, JSON.stringify(snapshot))
      if (modified) await redis.set(MODIFIED_KEY, modified)
      log.info({ commodities: count, release: snapshot.release, ms: Date.now() - started }, 'USDA PSD: release read')
    } catch (err) {
      log.error({ err }, 'USDA PSD poll error')
    } finally {
      running = false
    }
  }

  // A minute after start, so the scraper's other sources come up first
  const first = setTimeout(() => { void poll() }, 60_000)
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    log.info('USDA PSD poller stopped')
  }
}
