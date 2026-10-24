/**
 * The commodity watch (Oct 23, 2026): every 6 hours, the weather forecast over every crop region,
 * a count of what our sources say about each crop and country, a card per commodity and country
 * (cards.ts), a flag in the feed when a supply risk isn't in the news, and a log of the watch's
 * calls, checked against USDA's revisions as they come.
 *
 * Reads what the other sources keep in Redis: USDA's PSD (usda-psd.ts), the World Bank's prices
 * (worldbank-prices.ts), USDA's weekly export sales and the CFTC's positions. Keeps:
 *   commodity:weather:latest   every region's weather and risk
 *   commodity:watch:latest     every card, the sources' dates and the calls' record
 *   commodity:forecasts        the latest call per commodity and country, until USDA revises it
 *   commodity:forecast-outcomes what USDA did after each call (the newest 2,000)
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { COMMODITIES, BY_KEY, type WatchCommodity } from './catalog'
import { REGIONS, pointKey } from './regions'
import { readLocationforecast, readPowerClimatology, assessRegion, countryWeather, MET_CREDIT, POWER_CREDIT, type PointForecast, type RegionWeather, type CountryWeather } from './weather'
import { buildCards, cardCountries, flagTitle, type Card, type CftcSnapshot, type NewsCount } from './cards'
import { countryWords, countryName, sameCountry } from './countries'
import { LATEST_KEY as PSD_KEY, PREVIOUS_KEY as PSD_PREVIOUS_KEY, type PsdSnapshot } from '../sources/usda-psd'
import { LATEST_KEY as PRICES_KEY, CREDIT as PRICES_CREDIT, type PricesSnapshot } from '../sources/worldbank-prices'
import { SNAPSHOT_KEY as ESR_KEY, type EsrWeek } from '../sources/usda-export-sales'
import { SNAPSHOT_KEY as CFTC_KEY } from '../sources/cftc-cot'
import { PARTNERS_KEY, type PartnersSnapshot } from '../sources/baci-trade'
import { priceMoves, PRICE_MOVES_KEY } from './price-moves'

const log = rootLogger.child({ module: 'commodity-watch' })

export const SOURCE_ID = 'commodity-watch'
export const WATCH_KEY = 'commodity:watch:latest'
export const WEATHER_KEY = 'commodity:weather:latest'
const POINTS_KEY = 'commodity:weather:points'
const NORMALS_KEY = 'commodity:weather:normals'
export const FORECASTS_KEY = 'commodity:forecasts'
export const OUTCOMES_KEY = 'commodity:forecast-outcomes'
const INTERVAL_MS = Number(process.env.COMMODITY_WATCH_INTERVAL_MS) || 6 * 3_600_000
const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete.json'
const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/climatology/point'
/** MET Norway asks every app to say who it is and how to reach it */
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io; commodity watch)'
const FLAG_TTL_S = 8 * 86_400
/**
 * Flags show on the map, the commodities page and the country panels from the first round. Into the
 * feed as reports only once a day of flags has been checked by hand (Oct 23, 2026): a forecast-based
 * flag that's wrong in the public feed costs more than a day's wait.
 */
export const FLAGS_IN_FEED = false
const PAGE = 'https://world-pulse.io/commodities'

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

// ─── WEATHER ─────────────────────────────────────────────────────────────────

interface StoredForecast extends PointForecast { lm: string | null; at: number }

/** Every point's forecast (MET Norway, at most one request per point per 3 hours) and normals (NASA, once) */
export async function refreshWeather(redis: Redis, now = Date.now()): Promise<{ forecasts: Map<string, PointForecast>; normals: Map<string, number[]>; fetched: number; unchanged: number; failed: number }> {
  const points = new Map<string, { lat: number; lon: number }>()
  for (const r of REGIONS) points.set(pointKey(r.lat, r.lon), { lat: r.lat, lon: r.lon })
  const cached = await redis.hgetall(POINTS_KEY)
  const storedNormals = await redis.hgetall(NORMALS_KEY)
  const forecasts = new Map<string, PointForecast>()
  const normals = new Map<string, number[]>()
  let fetched = 0, unchanged = 0, failed = 0, refused = false
  const keep = (key: string, f: StoredForecast | null): void => {
    if (!f) return
    // Only the windows still ahead (or under way)
    const windows = f.windows.filter(w => Date.parse(w.start) >= now - 6 * 3_600_000)
    if (windows.length >= 8) forecasts.set(key, { updated: f.updated, windows })
  }

  for (const [key, p] of points) {
    const prev = parse<StoredForecast>(cached[key])
    if (refused || (prev && now - prev.at < 3 * 3_600_000)) { keep(key, prev); continue }
    try {
      const res = await fetch(`${MET_URL}?lat=${p.lat.toFixed(2)}&lon=${p.lon.toFixed(2)}`, {
        headers: { 'User-Agent': USER_AGENT, ...(prev?.lm ? { 'If-Modified-Since': prev.lm } : {}) },
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 304 && prev) {
        const entry = { ...prev, at: now }
        await redis.hset(POINTS_KEY, key, JSON.stringify(entry))
        keep(key, entry)
        unchanged++
      } else if (res.ok) {
        const entry: StoredForecast = { ...readLocationforecast(await res.json()), lm: res.headers.get('last-modified'), at: now }
        await redis.hset(POINTS_KEY, key, JSON.stringify(entry))
        keep(key, entry)
        fetched++
      } else {
        failed++
        keep(key, prev)
        // Asked to slow down or refused: stop for this round, keep what we have
        if (res.status === 429 || res.status === 403) { refused = true; log.warn({ status: res.status }, 'MET Norway refused a forecast; trying again next round') }
      }
    } catch (err) {
      failed++
      keep(key, prev)
      log.debug({ err, key }, 'MET Norway forecast not read')
    }
    await sleep(250)
  }

  let normalsFetched = 0
  for (const [key, p] of points) {
    const stored = parse<number[]>(storedNormals[key])
    if (stored) { normals.set(key, stored); continue }
    if (normalsFetched >= 120) continue          // the rest next round
    try {
      const res = await fetch(`${POWER_URL}?parameters=PRECTOTCORR&community=AG&longitude=${p.lon.toFixed(2)}&latitude=${p.lat.toFixed(2)}&format=JSON`, {
        headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000),
      })
      normalsFetched++
      if (res.ok) {
        const n = readPowerClimatology(await res.json())
        if (n) { normals.set(key, n); await redis.hset(NORMALS_KEY, key, JSON.stringify(n)) }
      }
    } catch (err) {
      log.debug({ err, key }, 'NASA POWER normals not read')
    }
    await sleep(500)
  }
  return { forecasts, normals, fetched, unchanged, failed }
}

/** Every region's weather risk, and each commodity and country's */
export function assessAll(forecasts: ReadonlyMap<string, PointForecast>, normals: ReadonlyMap<string, number[]>, now = new Date()): { regions: RegionWeather[]; byCountry: Map<string, CountryWeather> } {
  const regions: RegionWeather[] = []
  for (const r of REGIONS) {
    const commodity = BY_KEY.get(r.commodity)
    if (!commodity) continue
    const key = pointKey(r.lat, r.lon)
    regions.push(assessRegion(r, commodity, forecasts.get(key) ?? null, normals.get(key) ?? null, now))
  }
  const groups = new Map<string, RegionWeather[]>()
  for (const r of regions) {
    const k = `${r.commodity}:${r.iso}`
    const list = groups.get(k)
    if (list) list.push(r); else groups.set(k, [r])
  }
  const byCountry = new Map<string, CountryWeather>()
  for (const [k, list] of groups) {
    if (!list.some(r => r.days > 0)) continue      // no forecast for any of its regions yet
    const [commodity, iso] = k.split(':') as [string, string]
    byCountry.set(k, countryWeather(commodity, iso, list))
  }
  return { regions, byCountry }
}

// ─── NEWS ────────────────────────────────────────────────────────────────────

export interface NewsRow { id: string; title: string; summary: string | null; country_code: string | null; created_at: string | Date }

/** Which of a commodity's stories are about a country: placed there, or naming it or one of its regions */
export function countForCountry(rows: readonly NewsRow[], commodity: WatchCommodity, iso: string): NewsCount {
  const places = [...new Set(REGIONS.filter(r => r.commodity === commodity.key && r.iso === iso).map(r => r.place))]
  const placeWords = places.length ? new RegExp(`\\b(?:${places.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null
  const words = countryWords(iso, countryName(iso))
  const hits = rows.filter(r => {
    const text = `${r.title} ${r.summary ?? ''}`
    return sameCountry(iso, r.country_code) || words.test(text) || (placeWords?.test(text) ?? false)
  })
  return {
    count: hits.length,
    latest: hits.slice(0, 3).map(r => ({ id: r.id, title: r.title, created_at: new Date(r.created_at).toISOString() })),
  }
}

/** What our sources said in the last 14 days about each commodity, per country (null if the count failed) */
export async function countNews(db: Knex, psd: PsdSnapshot | null): Promise<Map<string, NewsCount> | null> {
  const out = new Map<string, NewsCount>()
  try {
    for (const commodity of COMMODITIES) {
      if (!commodity.news) continue
      const countries = cardCountries(commodity, psd)
      if (!countries.length) continue
      const rows = await db('signals')
        .select('id', 'title', 'summary', 'country_code', 'created_at')
        .where('created_at', '>', db.raw("now() - interval '14 days'"))
        // The same expression as the signals' full-text index (idx_signals_text)
        .whereRaw("to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'')) @@ to_tsquery('english', ?)", [commodity.news])
        .whereRaw("NOT (? = ANY(tags))", [SOURCE_ID])
        .orderBy('created_at', 'desc')
        .limit(2000)
        .timeout(15_000, { cancel: true }) as NewsRow[]
      for (const iso of countries) out.set(`${commodity.key}:${iso}`, countForCountry(rows, commodity, iso))
    }
    return out
  } catch (err) {
    log.warn({ err }, 'Commodity watch: the news count failed; no flags this round')
    return null
  }
}

// ─── THE CALLS' RECORD ───────────────────────────────────────────────────────

export interface Call { score: number; call: NonNullable<Card['call']>; at: string }
export interface ForecastEntry {
  commodity: string
  iso: string
  year: string
  /** USDA's estimate when the call was made, and when USDA made it */
  production: number
  estimate: string
  first: Call
  last: Call
}
export interface Outcome {
  commodity: string
  iso: string
  year: string
  estimate_before: string
  estimate_after: string
  before: number
  after: number
  change_pct: number
  outcome: 'cut' | 'raised' | 'unchanged'
  first: Call
  last: Call
  checked_at: string
}

/** The watch's calls against USDA's revisions: a new call per card, an outcome when USDA has revised since */
export function updateCalls(entries: ReadonlyMap<string, ForecastEntry>, cards: readonly Card[], now = new Date()): { entries: Map<string, ForecastEntry>; outcomes: Outcome[] } {
  const next = new Map(entries)
  const outcomes: Outcome[] = []
  const at = now.toISOString()
  for (const card of cards) {
    const o = card.outlook
    if (!card.call || !o || !o.production || !o.estimate) continue
    const key = `${card.commodity}:${card.iso}`
    const call: Call = { score: card.score, call: card.call, at }
    const e = next.get(key)
    if (e && e.year === o.year && o.estimate > e.estimate) {
      const change = Math.round(((o.production - e.production) / e.production) * 1000) / 10
      outcomes.push({
        commodity: card.commodity, iso: card.iso, year: e.year, estimate_before: e.estimate, estimate_after: o.estimate,
        before: e.production, after: o.production, change_pct: change,
        outcome: change <= -0.5 ? 'cut' : change >= 0.5 ? 'raised' : 'unchanged',
        first: e.first, last: e.last, checked_at: at,
      })
    }
    if (e && e.year === o.year && o.estimate === e.estimate) next.set(key, { ...e, last: call })
    else next.set(key, { commodity: card.commodity, iso: card.iso, year: o.year, production: o.production, estimate: o.estimate, first: call, last: call })
  }
  return { entries: next, outcomes }
}

/** How often USDA cut after each kind of call (the last call before its revision) */
export function scorecard(outcomes: readonly Outcome[]): Record<string, { calls: number; cut: number; raised: number; unchanged: number }> {
  const out: Record<string, { calls: number; cut: number; raised: number; unchanged: number }> = {}
  for (const o of outcomes) {
    const row = out[o.last.call] ??= { calls: 0, cut: 0, raised: 0, unchanged: 0 }
    row.calls++
    row[o.outcome]++
  }
  return out
}

// ─── THE WATCH ───────────────────────────────────────────────────────────────

const weekNumber = (ms: number): number => Math.floor(ms / (7 * 86_400_000))

export async function runWatch(db: Knex, redis: Redis, producer?: Producer | null): Promise<void> {
  const started = Date.now()
  const [psdRaw, prevRaw, pricesRaw, esrRaw, cftcRaw] = await redis.mget(PSD_KEY, PSD_PREVIOUS_KEY, PRICES_KEY, ESR_KEY, CFTC_KEY)
  const psd = parse<PsdSnapshot>(psdRaw)
  const previousPsd = parse<PsdSnapshot>(prevRaw)
  const prices = parse<PricesSnapshot>(pricesRaw)
  const esr = parse<EsrWeek>(esrRaw)
  const cftc = parse<CftcSnapshot>(cftcRaw)

  // Price moves (Oct 23, 2026): the World Bank's prices over each country's exports (CEPII BACI),
  // worked out first: they need no weather
  try {
    const partners = parse<PartnersSnapshot>(await redis.get(PARTNERS_KEY))
    if (partners && prices) await redis.set(PRICE_MOVES_KEY, JSON.stringify(priceMoves(partners, prices, cftc)))
  } catch (err) {
    log.warn({ err }, 'commodity watch: price moves not worked out')
  }

  const w = await refreshWeather(redis)
  const { regions, byCountry } = assessAll(w.forecasts, w.normals)
  await redis.set(WEATHER_KEY, JSON.stringify({
    updated_at: new Date().toISOString(), credits: [MET_CREDIT, POWER_CREDIT],
    points: { forecasts: w.forecasts.size, normals: w.normals.size, fetched: w.fetched, unchanged: w.unchanged, failed: w.failed },
    regions,
  }))

  const news = await countNews(db, psd)
  const cards = buildCards({ psd, previousPsd, prices, esr, cftc, weather: byCountry, news })

  // Flags into the feed, once a week per commodity and country
  let flagged = 0
  for (const card of cards) {
    if (!card.flag || !FLAGS_IN_FEED) continue
    const weather = byCountry.get(`${card.commodity}:${card.iso}`)
    const region = weather?.regions.find(r => r.level === weather.level) ?? weather?.regions[0]
    if (!weather || !region) continue
    const dedupKey = `commodity:flag:${card.commodity}:${card.iso}:${weekNumber(Date.now())}`
    if (await redis.get(dedupKey)) continue
    const row = {
      title: flagTitle(card, weather).slice(0, 500),
      summary: `${card.flag.text} Supply-risk score ${card.score}/100 (${card.reasons.join('; ')}). From WorldPulse's commodity watch: weather forecast from MET Norway, normals from NASA POWER, crop figures from USDA, prices from the World Bank.`,
      original_urls: [`${PAGE}?commodity=${encodeURIComponent(card.commodity)}&country=${card.iso}`],
      source_ids: [],
      category: 'economy' as const,
      severity: card.flag.level >= 3 ? 'high' as const : 'medium' as const,
      status: 'pending',
      reliability_score: 0.7,
      location: db.raw('ST_MakePoint(?, ?)', [region.lon, region.lat]),
      location_name: `${region.name}, ${card.country}`,
      country_code: region.country.length === 2 && region.country !== 'EU' ? region.country : null,
      region: null,
      tags: [SOURCE_ID, card.commodity, 'supply-risk', `weather-${region.risks[0]?.kind ?? 'risk'}`],
      language: 'en',
      event_time: new Date(),
      source_count: 1,
    }
    try {
      const signal = await insertAndCorrelate(row, { lat: region.lat, lng: region.lon, sourceId: SOURCE_ID, sourceName: 'WorldPulse commodity watch', sourceSlug: SOURCE_ID })
      await redis.set(dedupKey, '1', 'EX', FLAG_TTL_S)
      flagged++
      if (signal && (signal as { id?: unknown }).id && producer) {
        await producer.send({
          topic: 'signals.verified',
          messages: [{ key: 'economy', value: JSON.stringify({ event: 'signal.new', payload: signal, filter: { category: 'economy', severity: row.severity } }) }],
        }).catch(() => {})
      }
    } catch (err) {
      log.warn({ err, commodity: card.commodity, iso: card.iso }, 'Commodity watch: a flag was not stored')
    }
  }

  // The calls' record
  const stored = await redis.hgetall(FORECASTS_KEY)
  const entries = new Map<string, ForecastEntry>()
  for (const [k, v] of Object.entries(stored)) { const e = parse<ForecastEntry>(v); if (e) entries.set(k, e) }
  const { entries: next, outcomes } = updateCalls(entries, cards)
  if (next.size) await redis.hset(FORECASTS_KEY, Object.fromEntries([...next].map(([k, v]) => [k, JSON.stringify(v)])))
  if (outcomes.length) {
    await redis.lpush(OUTCOMES_KEY, ...outcomes.map(o => JSON.stringify(o)))
    await redis.ltrim(OUTCOMES_KEY, 0, 1999)
  }
  const record = (await redis.lrange(OUTCOMES_KEY, 0, 1999)).map(s => parse<Outcome>(s)).filter((o): o is Outcome => !!o)

  await redis.set(WATCH_KEY, JSON.stringify({
    updated_at: new Date().toISOString(),
    sources: {
      psd_release: psd?.release ?? null, psd_file_date: psd?.file_date ?? null,
      prices_month: prices?.month ?? null, prices_updated: prices?.updated ?? null,
      esr_week: esr?.week_ending ?? null, cftc_date: cftc?.report_date ?? null,
      weather_points: w.forecasts.size,
      credits: ['USDA FAS PSD (US government data)', PRICES_CREDIT + ' (CC BY 4.0)', 'USDA Weekly Export Sales', 'CFTC Commitments of Traders', MET_CREDIT, POWER_CREDIT],
    },
    counts: { cards: cards.length, flags: cards.filter(c => c.flag).length, commodities: new Set(cards.map(c => c.commodity)).size },
    scorecard: { outcomes: record.length, by_call: scorecard(record), pending: next.size },
    cards,
  }))
  log.info({ cards: cards.length, flags: cards.filter(c => c.flag).length, flagged, forecasts: w.forecasts.size, fetched: w.fetched, outcomes: outcomes.length, ms: Date.now() - started }, 'Commodity watch: round done')
}

export function startCommodityWatch(db: Knex, redis: Redis, producer?: Producer | null): () => void {
  let running = false
  const run = async (): Promise<void> => {
    if (running) return
    running = true
    try { await runWatch(db, redis, producer) } catch (err) { log.error({ err }, 'Commodity watch round failed') } finally { running = false }
  }
  // Four minutes after start: after USDA's and the World Bank's files are read
  const first = setTimeout(() => { void run() }, 4 * 60_000)
  const timer = setInterval(() => { void run() }, INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    log.info('Commodity watch stopped')
  }
}
