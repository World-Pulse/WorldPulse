/**
 * Lloyd's List's headlines (Oct 23, 2026; Devon: "Add Lloyd's List data ... and layers to the map").
 *
 * Lloyd's List offers its news feed free for websites, credited to lloydslist.com
 * (https://www.lloydslist.com/rss-feeds: "incorporate RSS feeds into your own website", attribution
 * "lloydslist.com"). Only that feed comes in, as offered: each headline's title, date, kind, sectors
 * and topics, and the countries and sea areas it is tagged with, kept 14 days, shown with the credit
 * and a link to the article on lloydslist.com. Its general terms bar AI training and reserve other
 * commercial use, so the headlines are never summarized, classified, stored as signals or read by
 * the AI pipeline, and no abstracts, images or author details are kept. Articles and Lloyd's List's
 * Data Tools stay behind its subscription (a licence: customersuccess@lloydslistintelligence.com).
 *
 * The feed has the latest 20 headlines; it is read every 30 minutes (with its ETag) and merged.
 */

import type Redis from 'ioredis'
import { logger as rootLogger } from '../lib/logger'
import { decodeXmlText } from '../lib/xlsx'
import { KNOWN_COUNTRY_NAMES, MORE_COUNTRIES } from '../pipeline/world-countries'

const log = rootLogger.child({ module: 'lloyds-list' })

export const SOURCE_ID = 'lloyds-list'
export const FEED_URL = 'https://www.lloydslist.com/rss/lloyds-list'
export const ITEMS_KEY = 'maritime:lloydslist:items'
const ETAG_KEY = 'maritime:lloydslist:etag'
const POLL_INTERVAL_MS = 30 * 60_000
const KEEP_DAYS = 14
const KEEP_MAX = 200
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io; shipping headlines, credited to lloydslist.com)'
export const CREDIT = "Lloyd's List"
export const CREDIT_URL = 'https://www.lloydslist.com'

/** Lloyd's List's sectors (the rest of an item's tags are topics, companies, countries and regions) */
const SECTORS = new Set([
  'Containers', 'Tankers and Gas', 'Dry Bulk', 'Ports and Logistics', 'Shipbuilding', 'Insurance', 'Finance', 'Offshore',
  'Energy', 'Risk and Compliance', 'Technology and Innovation', 'Decarbonisation', 'Regulation', 'Crewing', 'Safety',
  'Piracy and Security', 'Casualty', 'Political Risk and Trade', 'Sanctions', 'LNG', 'LPG', 'Bunkers', 'Fuels',
  'Ship operations', 'Charter rates', 'Freight rates', 'Sustainability', 'Environment', 'Digitalisation', 'Consolidation',
])

/** Tags that are regions too wide to pin, or not places at all */
const NOT_PLACES = new Set(['international', 'europe', 'asia pacific', 'middle east and africa', 'americas', 'eu', 'daily briefing', 'people'])

/** Sea areas and crises Lloyd's List tags, pinned where they happen */
export const SEA_AREAS: Array<{ tag: RegExp; name: string; lat: number; lon: number }> = [
  { tag: /^strait of hormuz/i, name: 'Strait of Hormuz', lat: 26.57, lon: 56.25 },
  { tag: /^red sea/i, name: 'Red Sea', lat: 15.6, lon: 41.6 },
  { tag: /^black sea/i, name: 'Black Sea', lat: 43.4, lon: 34.0 },
  { tag: /^arctic( shipping)?$/i, name: 'Arctic', lat: 75.0, lon: 70.0 },
  { tag: /^panama canal/i, name: 'Panama Canal', lat: 9.08, lon: -79.68 },
  { tag: /^suez canal/i, name: 'Suez Canal', lat: 30.6, lon: 32.33 },
  { tag: /^baltic/i, name: 'Baltic Sea', lat: 57.5, lon: 19.5 },
  { tag: /^gulf of guinea/i, name: 'Gulf of Guinea', lat: 2.5, lon: 4.0 },
  { tag: /^(strait of )?malacca/i, name: 'Strait of Malacca', lat: 2.6, lon: 101.3 },
  { tag: /^taiwan strait/i, name: 'Taiwan Strait', lat: 24.3, lon: 119.6 },
  { tag: /^south china sea/i, name: 'South China Sea', lat: 12.0, lon: 114.0 },
  { tag: /^(bosphorus|turkish straits)/i, name: 'Turkish Straits', lat: 41.1, lon: 29.05 },
  { tag: /^bab el-?mandeb/i, name: 'Bab el-Mandeb', lat: 12.6, lon: 43.3 },
]

export interface ShippingPlace {
  /** "RO" for a country, "sea:black-sea" for a sea area */
  key: string
  name: string
  /** A country's ISO code; sea areas have none */
  iso: string | null
  /** Where it's pinned: a sea area's point, a country's capital (as the map pins country-level news) */
  lat: number | null
  lon: number | null
}

export interface ShippingHeadline {
  /** Lloyd's List's own id ("LL1158802") */
  id: string
  title: string
  url: string
  published: string
  /** "News", "Analysis", "Opinion", "Interviews" … */
  kind: string | null
  sectors: string[]
  topics: string[]
  places: ShippingPlace[]
}

export interface HeadlinesSnapshot {
  updated_at: string
  source: typeof CREDIT
  source_url: typeof CREDIT_URL
  feed: typeof FEED_URL
  items: ShippingHeadline[]
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()

/** Lloyd's List's spellings that aren't our countries' names */
const ALIASES: Record<string, string> = {
  'russian federation': 'RU', 'usa': 'US', 'us': 'US', 'united states of america': 'US', 'uk': 'GB', 'great britain': 'GB',
  'republic of korea': 'KR', 'korea': 'KR', 'dprk': 'KP', 'turkiye': 'TR', 'viet nam': 'VN', 'uae': 'AE', 'hong kong': 'HK',
  'taiwan': 'TW', 'ivory coast': 'CI', 'cote d ivoire': 'CI', 'democratic republic of the congo': 'CD', 'dr congo': 'CD',
  'czech republic': 'CZ', 'macau': 'MO', 'macao': 'MO',
}
const BY_NAME: Map<string, string> = new Map([
  ...Object.entries(KNOWN_COUNTRY_NAMES).map(([code, name]) => [norm(name), code] as [string, string]),
  ...MORE_COUNTRIES.map(e => [norm(e.name), e.code] as [string, string]),
  ...Object.entries(ALIASES),
])
/** The capitals of the countries world-countries.ts leaves to geo.ts (the rest carry their own) */
const CAPITALS: Record<string, [number, number]> = {
  US: [38.90, -77.04], GB: [51.51, -0.13], CN: [39.90, 116.41], RU: [55.76, 37.62], FR: [48.86, 2.35], DE: [52.52, 13.40],
  JP: [35.68, 139.69], IN: [28.61, 77.21], BR: [-15.79, -47.88], CA: [45.42, -75.70], AU: [-35.28, 149.13], IL: [31.77, 35.21],
  IR: [35.69, 51.39], KP: [39.04, 125.76], KR: [37.57, 126.98], PK: [33.68, 73.05], AF: [34.53, 69.17], SY: [33.51, 36.29],
  IQ: [33.31, 44.37], SA: [24.71, 46.68], TR: [39.93, 32.86], UA: [50.45, 30.52], MX: [19.43, -99.13], AR: [-34.60, -58.38],
  CO: [4.71, -74.07], NG: [9.08, 7.40], ZA: [-25.75, 28.19], KE: [-1.29, 36.82], ET: [9.03, 38.74], ID: [-6.21, 106.85],
  PH: [14.60, 120.98], VN: [21.03, 105.85], TH: [13.76, 100.50], MY: [3.14, 101.69], HK: [22.32, 114.17], TW: [25.03, 121.57], MO: [22.20, 113.54],
  ...Object.fromEntries(MORE_COUNTRIES.map(e => [e.code, [e.lat, e.lng] as [number, number]])),
}

const NAME_OF: Map<string, string> = new Map([
  ...MORE_COUNTRIES.map(e => [e.code, e.name] as [string, string]),
  ...Object.entries(KNOWN_COUNTRY_NAMES),
  ['HK', 'Hong Kong'], ['TW', 'Taiwan'], ['MO', 'Macau'],
])

/** A tag's place: a country by its whole name, or a sea area; null for anything else */
export function placeOfTag(tag: string): ShippingPlace | null {
  const t = tag.trim()
  if (!t || NOT_PLACES.has(norm(t))) return null
  const sea = SEA_AREAS.find(a => a.tag.test(t))
  if (sea) return { key: `sea:${norm(sea.name).replace(/ /g, '-')}`, name: sea.name, iso: null, lat: sea.lat, lon: sea.lon }
  const iso = BY_NAME.get(norm(t))
  if (!iso) return null
  const at = CAPITALS[iso]
  return { key: iso, name: NAME_OF.get(iso) ?? t, iso, lat: at?.[0] ?? null, lon: at?.[1] ?? null }
}

const tagText = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? decodeXmlText(m[1]!.replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : null
}

/** The feed's items: title, link (without its tracking tags), date, kind, sectors, topics and places */
export function readFeed(xml: string): ShippingHeadline[] {
  const out: ShippingHeadline[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1]!
    const title = tagText(it, 'title')
    const link = tagText(it, 'link')
    const date = tagText(it, 'pubDate')
    if (!title || !link || !date || /^daily briefing\b/i.test(title)) continue
    // pubDate is right (GMT); atom:updated carries a wrong offset
    const published = new Date(date)
    if (Number.isNaN(published.getTime())) continue
    // Their link carries search tags ("?utm_source=search…", entities written twice): the article alone
    const url = decodeXmlText(link).split('?')[0]!
    if (!/^https:\/\/(www\.)?lloydslist\.com\//.test(url)) continue
    // The feed sometimes mixes two articles in one item (Oct 23: "The Daily View" with another
    // article's id, date and tags): the link's id must be the item's id, or its tags can't be trusted
    const linkId = /lloydslist\.com\/(LL\d+)\//.exec(url)?.[1] ?? null
    const tagId = tagText(it, 'id')
    if (linkId && tagId && linkId !== tagId) continue
    const id = linkId ?? tagId ?? url
    const tags = [...it.matchAll(/<taxonomy_item>([\s\S]*?)<\/taxonomy_item>/g)].map(t => decodeXmlText(t[1]!).trim()).filter(Boolean)
    const places: ShippingPlace[] = []
    const sectors: string[] = [], topics: string[] = []
    for (const tag of tags) {
      const place = placeOfTag(tag)
      if (place) { if (!places.some(p => p.key === place.key)) places.push(place); continue }
      if (SECTORS.has(tag)) sectors.push(tag)
      else if (!NOT_PLACES.has(norm(tag))) topics.push(tag)
    }
    out.push({
      id, title: title.replace(/\s+/g, ' '), url, published: published.toISOString(),
      kind: tagText(it, 'contenttype') || tagText(it, 'category'),
      sectors: [...new Set(sectors)].slice(0, 4), topics: [...new Set(topics)].slice(0, 6), places: places.slice(0, 6),
    })
  }
  return out
}

/** New items merged into the kept ones: newest first, 14 days, at most 200 */
export function mergeItems(kept: readonly ShippingHeadline[], fresh: readonly ShippingHeadline[], now = Date.now()): ShippingHeadline[] {
  const byId = new Map<string, ShippingHeadline>()
  for (const item of [...kept, ...fresh]) byId.set(item.id, item)
  return [...byId.values()]
    .filter(item => now - Date.parse(item.published) <= KEEP_DAYS * 86_400_000)
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, KEEP_MAX)
}

export function startLloydsListPoller(redis: Redis): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      const etag = await redis.get(ETAG_KEY)
      const res = await fetch(FEED_URL, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml', ...(etag ? { 'If-None-Match': etag } : {}) },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 304) return
      if (!res.ok) { log.warn({ status: res.status }, "Lloyd's List: feed not read"); return }
      const fresh = readFeed(await res.text())
      if (!fresh.length) { log.warn("Lloyd's List: no items in the feed"); return }
      const raw = await redis.get(ITEMS_KEY)
      let kept: ShippingHeadline[] = []
      try { kept = raw ? (JSON.parse(raw) as HeadlinesSnapshot).items ?? [] : [] } catch { kept = [] }
      const items = mergeItems(kept, fresh)
      const snapshot: HeadlinesSnapshot = { updated_at: new Date().toISOString(), source: CREDIT, source_url: CREDIT_URL, feed: FEED_URL, items }
      await redis.set(ITEMS_KEY, JSON.stringify(snapshot))
      const tag = res.headers.get('etag')
      if (tag) await redis.set(ETAG_KEY, tag, 'EX', 86_400)
      log.info({ fresh: fresh.length, kept: items.length }, "Lloyd's List: headlines read")
    } catch (err) {
      log.error({ err }, "Lloyd's List poll error")
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => { void poll() }, 2 * 60_000)
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    log.info("Lloyd's List headlines poller stopped")
  }
}
