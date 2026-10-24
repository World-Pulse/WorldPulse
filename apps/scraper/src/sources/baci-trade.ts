/**
 * Trade partners: who buys each country's crops and who sells it its food (Oct 23, 2026; Devon:
 * "Clicking a country shows its crops, exports, what it buys from the US, its trade partners").
 *
 * CEPII's BACI: every country's trade with every other, product by product (HS 6-digit), value in
 * US dollars and tonnes, from UN trade statistics reconciled between exporters and importers.
 * Licensed Etalab Open Licence 2.0: "any use is authorized, provided the source is mentioned"
 * (UN Comtrade's own terms need written permission for publication). Yearly: the January release
 * adds the year before last (V202601 has 2022 to 2024).
 *
 * The download is one 300 MB zip with a CSV per year (~100 MB zipped, 370 MB of CSV); only the
 * newest year is read, by byte range, and streamed (never whole in memory), keeping the farm
 * products the commodity watch follows, energy, metals and fertilizers. Per country and commodity:
 * its exports' main buyers and its imports' main suppliers, with shares; and its trade in all goods
 * (Devon, Oct 23: "the Lloyd's Bank like data"): totals, main partners and main product groups.
 * Checked weekly; read again when the file changes (or when what is kept from it changes).
 *   https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html  → BACI_HS22_V<release>.zip
 */

import { Readable } from 'node:stream'
import { createInflateRaw, inflateRawSync } from 'node:zlib'
import type Redis from 'ioredis'
import { logger as rootLogger } from '../lib/logger'
import { centralDirectory, dataStart, type ZipListing } from '../lib/zip'
import { BY_KEY } from '../commodity/catalog'
import { countryName } from '../commodity/countries'
import { priceMoves, PRICE_MOVES_KEY } from '../commodity/price-moves'
import { LATEST_KEY as PRICES_KEY } from './worldbank-prices'
/** cftc-cot.ts's SNAPSHOT_KEY (not imported: that module brings the report pipeline with it) */
const CFTC_KEY = 'cftc:cot:latest'

const log = rootLogger.child({ module: 'baci-trade' })

export const SOURCE_ID = 'baci-trade'
export const PAGE_URL = 'https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html'
export const PARTNERS_KEY = 'commodity:partners:latest'
const FILE_KEY = 'commodity:partners:file'
const POLL_INTERVAL_MS = Number(process.env.BACI_INTERVAL_MS) || 7 * 86_400_000
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io; commodity watch)'
export const CREDIT = 'CEPII BACI (Gaulier and Zignago, 2010), from UN trade statistics'
export const LICENCE = 'Etalab Open Licence 2.0'
/** Partners kept per country and commodity */
const TOP = 6
/** Product groups kept per country and side */
const TOP_GROUPS = 8
/** What is kept from the file: a change re-reads the same file (2: all goods, energy and metals, Oct 23) */
const FORMAT = 2

/** HS codes (by prefix) → the commodity watch's keys */
export const HS_TO_COMMODITY: Array<[string, string[]]> = [
  ['wheat', ['1001']], ['corn', ['1005']], ['rice', ['1006']], ['barley', ['1003']], ['sorghum', ['1007']], ['oats', ['1004']], ['rye', ['1002']],
  ['millet', ['100821', '100829']],
  ['soybeans', ['1201']], ['rapeseed', ['1205']], ['sunflowerseed', ['1206']], ['peanuts', ['1202']], ['copra', ['1203']], ['palm-kernels', ['120710']], ['cottonseed', ['120721', '120729']],
  ['soybean-oil', ['1507']], ['palm-oil', ['1511']], ['rapeseed-oil', ['1514']], ['sunflower-oil', ['151211', '151219']], ['peanut-oil', ['1508']], ['olive-oil', ['1509']],
  ['coconut-oil', ['151311', '151319']], ['palm-kernel-oil', ['151321', '151329']], ['cottonseed-oil', ['151221', '151229']],
  ['soybean-meal', ['2304']], ['rapeseed-meal', ['230641', '230649']], ['sunflower-meal', ['230630']], ['peanut-meal', ['2305']], ['fish-meal', ['230120']],
  ['coffee', ['0901']], ['cocoa', ['1801', '1802', '1803', '1804', '1805']], ['tea', ['0902']], ['sugar', ['1701']], ['rubber', ['4001']], ['cotton', ['5201']],
  ['orange-juice', ['200911', '200912', '200919']], ['oranges', ['080510']], ['tangerines', ['080521', '080522', '080529']], ['lemons', ['080550']], ['grapefruit', ['080540']],
  ['apples', ['080810']], ['pears', ['080830']], ['table-grapes', ['080610']], ['cherries', ['080921', '080929']], ['peaches', ['080930']],
  ['almonds', ['080211', '080212']], ['walnuts', ['080231', '080232']], ['pistachios', ['080251', '080252']],
  ['beef', ['0201', '0202']], ['pork', ['0203']], ['chicken', ['020711', '020712', '020713', '020714']],
  ['butter', ['0405']], ['cheese', ['0406']], ['milk-powder', ['040221', '040229']], ['skim-milk-powder', ['040210']],
  // Energy, metals and fertilizers (Oct 23, 2026: how their prices move each country's exports)
  ['crude-oil', ['2709']], ['natural-gas', ['271111', '271121']], ['coal', ['2701']],
  ['iron-ore', ['2601']], ['copper', ['2603', '7402', '7403']], ['aluminium', ['7601']], ['nickel', ['7502']], ['zinc', ['7901']],
  ['lead', ['7801']], ['tin', ['8001']], ['gold', ['7108']], ['silver', ['7106']], ['platinum', ['711011', '711019']],
  ['urea', ['310210']], ['potash', ['310420']], ['dap', ['310530']], ['phosphate-rock', ['2510']],
]

/** Names for the commodities the watch's catalog doesn't have */
export const EXTRA_NAMES: Record<string, string> = {
  'crude-oil': 'Crude oil', 'natural-gas': 'Natural gas', coal: 'Coal', 'iron-ore': 'Iron ore', copper: 'Copper', aluminium: 'Aluminium',
  nickel: 'Nickel', zinc: 'Zinc', lead: 'Lead', tin: 'Tin', gold: 'Gold', silver: 'Silver', platinum: 'Platinum', urea: 'Urea',
  potash: 'Potash', dap: 'DAP fertilizer', 'phosphate-rock': 'Phosphate rock',
}

/** HS chapters (the first two digits) in plain words */
export const HS2_NAMES: Record<string, string> = {
  '01': 'Live animals', '02': 'Meat', '03': 'Fish and seafood', '04': 'Dairy, eggs and honey', '05': 'Other animal products',
  '06': 'Plants and flowers', '07': 'Vegetables', '08': 'Fruit and nuts', '09': 'Coffee, tea and spices', '10': 'Cereals',
  '11': 'Flour and malt', '12': 'Oilseeds', '13': 'Gums and resins', '14': 'Other plant products', '15': 'Fats and oils',
  '16': 'Meat and fish preparations', '17': 'Sugar', '18': 'Cocoa', '19': 'Cereal preparations', '20': 'Fruit and vegetable preparations',
  '21': 'Other food preparations', '22': 'Beverages', '23': 'Animal feed', '24': 'Tobacco', '25': 'Salt, stone and cement',
  '26': 'Ores', '27': 'Oil, gas and coal', '28': 'Inorganic chemicals', '29': 'Organic chemicals', '30': 'Pharmaceuticals',
  '31': 'Fertilizers', '32': 'Dyes and paints', '33': 'Cosmetics and perfumes', '34': 'Soaps and waxes', '35': 'Proteins and glues',
  '36': 'Explosives', '37': 'Photographic goods', '38': 'Other chemicals', '39': 'Plastics', '40': 'Rubber',
  '41': 'Hides and leather', '42': 'Leather goods', '43': 'Furs', '44': 'Wood', '45': 'Cork', '46': 'Basketware', '47': 'Pulp',
  '48': 'Paper', '49': 'Printed matter', '50': 'Silk', '51': 'Wool', '52': 'Cotton', '53': 'Other plant fibres',
  '54': 'Man-made filaments', '55': 'Man-made fibres', '56': 'Wadding and rope', '57': 'Carpets', '58': 'Special fabrics',
  '59': 'Coated fabrics', '60': 'Knitted fabrics', '61': 'Knitted clothing', '62': 'Clothing', '63': 'Other textiles',
  '64': 'Footwear', '65': 'Headgear', '66': 'Umbrellas', '67': 'Feathers and artificial flowers', '68': 'Stone and cement articles',
  '69': 'Ceramics', '70': 'Glass', '71': 'Gold, gems and jewellery', '72': 'Iron and steel', '73': 'Iron and steel articles',
  '74': 'Copper', '75': 'Nickel', '76': 'Aluminium', '78': 'Lead', '79': 'Zinc', '80': 'Tin', '81': 'Other base metals',
  '82': 'Tools', '83': 'Metal articles', '84': 'Machinery', '85': 'Electrical equipment', '86': 'Railway equipment',
  '87': 'Vehicles', '88': 'Aircraft', '89': 'Ships', '90': 'Instruments', '91': 'Clocks and watches', '92': 'Musical instruments',
  '93': 'Arms', '94': 'Furniture', '95': 'Toys and sports goods', '96': 'Other manufactures', '97': 'Art and antiques',
}

const PREFIXES: Map<string, string> = new Map(HS_TO_COMMODITY.flatMap(([c, ps]) => ps.map(p => [p, c] as [string, string])))

/** An HS 6-digit code's commodity, by its longest listed prefix */
export function commodityOf(hs6: string): string | null {
  return PREFIXES.get(hs6) ?? PREFIXES.get(hs6.slice(0, 4)) ?? null
}

export interface Partner { iso: string; name: string; value: number; tonnes: number | null; share: number }
export interface Flows { value: number; tonnes: number | null; top: Partner[] }
export interface Group { hs2: string; name: string; value: number; share: number }
/** A country's trade in all goods: totals, main partners, main product groups (thousands of US dollars) */
export interface TradeTotals { exports: number; imports: number; buyers: Partner[]; suppliers: Partner[]; exports_by: Group[]; imports_by: Group[] }
export interface CountryTrade { name: string; exports: Record<string, Flows>; imports: Record<string, Flows>; total?: TradeTotals }
export interface PartnersSnapshot {
  year: number
  release: string
  source: typeof CREDIT
  licence: typeof LICENCE
  file_url: string
  /** The commodities' names ("palm-oil" → "Palm oil") */
  names: Record<string, string>
  /** Values in thousands of US dollars, quantities in tonnes */
  countries: Record<string, CountryTrade>
}

// ─── READING THE FILE ────────────────────────────────────────────────────────

/** A name stored as UTF-8 read twice ("TÃ¼rkiye") put right ("Türkiye") */
export function fixMojibake(s: string): string {
  if (!/[ÃÂ]/.test(s)) return s
  const fixed = Buffer.from(s, 'latin1').toString('utf8')
  return fixed.includes('\uFFFD') ? s : fixed
}

/** BACI's country codes (numeric) → ISO alpha-2 and name; "Other Asia, nes" is Taiwan */
export function readCountryCodes(csv: string): Map<string, { iso: string; name: string }> {
  const out = new Map<string, { iso: string; name: string }>()
  for (const line of csv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    const f = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(x => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? []
    const [code, name, iso2] = f
    if (!code) continue
    if (code === '490') { out.set(code, { iso: 'TW', name: 'Taiwan' }); continue }
    if (iso2 && /^[A-Z]{2}$/.test(iso2)) out.set(code, { iso: iso2, name: countryName(iso2, fixMojibake(name ?? iso2)) })
  }
  return out
}

/** The newest year's file in the zip's listing ("BACI_HS22_Y2024_V202601.csv") */
export function newestYear(listing: readonly ZipListing[]): { entry: ZipListing; year: number } | null {
  let best: { entry: ZipListing; year: number } | null = null
  for (const e of listing) {
    const m = /_Y(\d{4})_V\d+\.csv$/.exec(e.name)
    if (m && (!best || Number(m[1]) > best.year)) best = { entry: e, year: Number(m[1]) }
  }
  return best
}

/** The rows (t,i,j,k,v,q) into each country's main buyers and suppliers, per commodity */
export async function readFlows(lines: AsyncIterable<string> | Iterable<string>, codes: ReadonlyMap<string, { iso: string; name: string }>): Promise<Record<string, CountryTrade>> {
  // commodity|exporter|importer → value, tonnes
  const pairs = new Map<string, { v: number; q: number; qKnown: boolean }>()
  // All goods: exporter|importer, exporter|chapter, importer|chapter → value
  const pairTotals = new Map<string, number>(), outGroups = new Map<string, number>(), inGroups = new Map<string, number>()
  const bump = (m: Map<string, number>, key: string, v: number): void => { m.set(key, (m.get(key) ?? 0) + v) }
  let header = true
  for await (const line of lines as AsyncIterable<string>) {
    if (header) { header = false; if (/^t,/.test(line)) continue }
    if (!line) continue
    // t,i,j,k,v,q — the product code is the 4th field
    const parts = line.split(',')
    const k = parts[3]
    if (!k) continue
    const hs6 = k.length === 5 ? `0${k}` : k
    const i = parts[1]!, j = parts[2]!
    const v = Number(parts[4])
    if (!Number.isFinite(v)) continue
    bump(pairTotals, `${i}|${j}`, v)
    bump(outGroups, `${i}|${hs6.slice(0, 2)}`, v)
    bump(inGroups, `${j}|${hs6.slice(0, 2)}`, v)
    const commodity = commodityOf(hs6)
    if (!commodity) continue
    // An unknown quantity is an empty field (Number('') would be 0)
    const q = parts[5] ? Number(parts[5]) : NaN
    const key = `${commodity}|${i}|${j}`
    const p = pairs.get(key)
    if (p) { p.v += v; if (Number.isFinite(q)) p.q += q; else p.qKnown = false }
    else pairs.set(key, { v, q: Number.isFinite(q) ? q : 0, qKnown: Number.isFinite(q) })
  }
  // Each side's partners
  const sides = new Map<string, Map<string, Array<{ partner: string; v: number; q: number | null }>>>()   // `${iso}|exports|commodity`
  const add = (iso: string, side: 'exports' | 'imports', commodity: string, partner: string, v: number, q: number | null): void => {
    const k = `${iso}|${side}`
    let byC = sides.get(k)
    if (!byC) sides.set(k, byC = new Map())
    let list = byC.get(commodity)
    if (!list) byC.set(commodity, list = [])
    list.push({ partner, v, q })
  }
  for (const [key, p] of pairs) {
    const [commodity, i, j] = key.split('|') as [string, string, string]
    const ex = codes.get(i), im = codes.get(j)
    if (!ex || !im) continue
    add(ex.iso, 'exports', commodity, im.iso, p.v, p.qKnown ? p.q : null)
    add(im.iso, 'imports', commodity, ex.iso, p.v, p.qKnown ? p.q : null)
  }
  const names = new Map([...codes.values()].map(c => [c.iso, c.name]))
  const out: Record<string, CountryTrade> = {}
  for (const [k, byC] of sides) {
    const [iso, side] = k.split('|') as [string, 'exports' | 'imports']
    const country = out[iso] ??= { name: names.get(iso) ?? iso, exports: {}, imports: {} }
    for (const [commodity, list] of byC) {
      const value = list.reduce((s, x) => s + x.v, 0)
      if (value < 100) continue                                    // under $100,000 a year: leave it out
      const tonnes = list.every(x => x.q !== null) ? Math.round(list.reduce((s, x) => s + (x.q ?? 0), 0)) : null
      const top = [...list].sort((a, b) => b.v - a.v).slice(0, TOP).map(x => ({
        iso: x.partner, name: names.get(x.partner) ?? x.partner, value: Math.round(x.v), tonnes: x.q === null ? null : Math.round(x.q),
        share: Math.round((x.v / value) * 1000) / 10,
      }))
      country[side][commodity] = { value: Math.round(value), tonnes, top }
    }
  }
  // All goods
  const partners = new Map<string, { buyers: Array<[string, number]>; suppliers: Array<[string, number]> }>()
  const sideOf = (iso: string) => partners.get(iso) ?? (partners.set(iso, { buyers: [], suppliers: [] }), partners.get(iso)!)
  for (const [key, v] of pairTotals) {
    const [i, j] = key.split('|') as [string, string]
    const ex = codes.get(i), im = codes.get(j)
    if (!ex || !im) continue
    sideOf(ex.iso).buyers.push([im.iso, v])
    sideOf(im.iso).suppliers.push([ex.iso, v])
  }
  const groupsOf = (m: Map<string, number>): Map<string, Array<[string, number]>> => {
    const byIso = new Map<string, Array<[string, number]>>()
    for (const [key, v] of m) {
      const [code, hs2] = key.split('|') as [string, string]
      const c = codes.get(code)
      if (!c) continue
      const list = byIso.get(c.iso) ?? (byIso.set(c.iso, []), byIso.get(c.iso)!)
      list.push([hs2, v])
    }
    return byIso
  }
  const outBy = groupsOf(outGroups), inBy = groupsOf(inGroups)
  const topPartners = (list: Array<[string, number]>, total: number): Partner[] => [...list].sort((a, b) => b[1] - a[1]).slice(0, TOP)
    .map(([iso, v]) => ({ iso, name: names.get(iso) ?? iso, value: Math.round(v), tonnes: null, share: total > 0 ? Math.round((v / total) * 1000) / 10 : 0 }))
  const topGroups = (list: Array<[string, number]> | undefined, total: number): Group[] => [...(list ?? [])].sort((a, b) => b[1] - a[1]).slice(0, TOP_GROUPS)
    .map(([hs2, v]) => ({ hs2, name: HS2_NAMES[hs2] ?? `HS ${hs2}`, value: Math.round(v), share: total > 0 ? Math.round((v / total) * 1000) / 10 : 0 }))
  for (const [iso, p] of partners) {
    const exports = p.buyers.reduce((s, [, v]) => s + v, 0), imports = p.suppliers.reduce((s, [, v]) => s + v, 0)
    if (exports + imports < 1_000) continue                         // under $1 million a year in all: leave it out
    const country = out[iso] ??= { name: names.get(iso) ?? iso, exports: {}, imports: {} }
    country.total = {
      exports: Math.round(exports), imports: Math.round(imports),
      buyers: topPartners(p.buyers, exports), suppliers: topPartners(p.suppliers, imports),
      exports_by: topGroups(outBy.get(iso), exports), imports_by: topGroups(inBy.get(iso), imports),
    }
  }
  return out
}

/** The zip's address on BACI's page */
export function findZipUrl(html: string, base = PAGE_URL): string | null {
  const m = /href="([^"]*BACI_HS22_V(\d{6})\.zip)"/.exec(html)
  return m ? new URL(m[1]!, base).toString() : null
}

/** Lines of a deflated byte stream */
export async function* inflatedLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const stream = Readable.from(body).pipe(createInflateRaw())
  let rest = ''
  for await (const chunk of stream) {
    const text = rest + (chunk as Buffer).toString('utf8')
    const lines = text.split(/\r?\n/)
    rest = lines.pop() ?? ''
    for (const line of lines) yield line
  }
  if (rest) yield rest
}

// ─── POLLER ──────────────────────────────────────────────────────────────────

async function range(url: string, from: number, to: number, timeoutMs = 60_000): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Range: `bytes=${from}-${to}` }, signal: AbortSignal.timeout(timeoutMs) })
  if (res.status !== 206) throw new Error(`BACI: byte range not served (HTTP ${res.status})`)
  return res
}

export function startBaciTradePoller(redis: Redis): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      const page = await fetch(PAGE_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
      if (!page.ok) { log.warn({ status: page.status }, 'BACI: page not read'); return }
      const url = findZipUrl(await page.text())
      if (!url) { log.warn('BACI: no HS22 file on the page'); return }
      const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
      const size = Number(head.headers.get('content-length'))
      if (!head.ok || !size) { log.warn({ status: head.status }, 'BACI: file size unknown'); return }
      const fileId = `v${FORMAT}|${url}|${size}|${head.headers.get('last-modified') ?? ''}`
      if ((await redis.get(FILE_KEY)) === fileId && await redis.exists(PARTNERS_KEY)) return

      const tailStart = Math.max(0, size - 65_536)
      const listing = centralDirectory(Buffer.from(await (await range(url, tailStart, size - 1)).arrayBuffer()), tailStart)
      const newest = newestYear(listing)
      const codesEntry = listing.find(e => /^country_codes/.test(e.name))
      if (!newest || !codesEntry) { log.warn('BACI: the zip has no year file or country codes'); return }

      const readSmall = async (e: ZipListing): Promise<string> => {
        const start = dataStart(Buffer.from(await (await range(url, e.local, e.local + 29)).arrayBuffer()), e.local)
        const data = Buffer.from(await (await range(url, start, start + e.compressed - 1)).arrayBuffer())
        return (e.method === 8 ? inflateRawSync(data) : data).toString('utf8')
      }
      const codes = readCountryCodes(await readSmall(codesEntry))
      const e = newest.entry
      const start = dataStart(Buffer.from(await (await range(url, e.local, e.local + 29)).arrayBuffer()), e.local)
      const started = Date.now()
      const res = await range(url, start, start + e.compressed - 1, 20 * 60_000)
      if (!res.body || e.method !== 8) { log.warn({ method: e.method }, 'BACI: unexpected file'); return }
      const countries = await readFlows(inflatedLines(res.body as unknown as AsyncIterable<Uint8Array>), codes)
      const n = Object.keys(countries).length
      if (n < 100) { log.warn({ countries: n }, 'BACI: too few countries read; keeping the last year'); return }
      const release = /_V(\d{6})\.zip$/.exec(url)?.[1] ?? ''
      const names = Object.fromEntries(HS_TO_COMMODITY.map(([c]) => [c, BY_KEY.get(c)?.name ?? EXTRA_NAMES[c] ?? c]))
      const snapshot: PartnersSnapshot = { year: newest.year, release, source: CREDIT, licence: LICENCE, file_url: url, names, countries }
      await redis.set(PARTNERS_KEY, JSON.stringify(snapshot))
      await redis.set(FILE_KEY, fileId)
      log.info({ year: newest.year, release, countries: n, ms: Date.now() - started }, 'BACI: trade partners read')
      // The price moves weigh prices by this trade: work them out now, not at the watch's next round
      try {
        const [pricesRaw, cftcRaw] = await redis.mget(PRICES_KEY, CFTC_KEY)
        if (pricesRaw) await redis.set(PRICE_MOVES_KEY, JSON.stringify(priceMoves(snapshot, JSON.parse(pricesRaw), cftcRaw ? JSON.parse(cftcRaw) : null)))
      } catch (err) {
        log.warn({ err }, 'BACI: price moves not worked out')
      }
    } catch (err) {
      log.error({ err }, 'BACI poll error')
    } finally {
      running = false
    }
  }

  // Ten minutes after start (a big read), then weekly
  const first = setTimeout(() => { void poll() }, 10 * 60_000)
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    log.info('BACI trade partners poller stopped')
  }
}
