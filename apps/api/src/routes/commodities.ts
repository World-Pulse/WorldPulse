/**
 * The commodity watch's API (Oct 23, 2026; Devon: the commodity, weather and trade layer on the
 * map, and "Clicking a country shows its crops, exports, what it buys from the US, its trade
 * partners, its weather risk and its news").
 *
 * The scraper's commodity watch (apps/scraper/src/commodity/watch.ts) keeps every card in Redis;
 * these routes read it:
 *   GET /api/v1/commodities              every commodity in the watch, its flags and top country
 *   GET /api/v1/commodities/map          one row per country for the map (?commodity= for one, or all)
 *   GET /api/v1/commodities/country/:iso a country's cards, what it bought from the US this week, and
 *                                        its main trade partners for each farm product (CEPII's BACI)
 *   GET /api/v1/commodities/prices       the World Bank's monthly prices (CC BY 4.0)
 *   GET /api/v1/commodities/weather      the crop regions' weather (?commodity=, ?country=)
 *   GET /api/v1/commodities/scorecard    the watch's calls against USDA's revisions
 *   GET /api/v1/commodities/price-moves  how commodity prices moved each country's exports (the World
 *                                        Bank's monthly prices over CEPII BACI's trade; Oct 23, Devon:
 *                                        "CME like data")
 */

import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'

export const WATCH_KEY = 'commodity:watch:latest'
export const WEATHER_KEY = 'commodity:weather:latest'
export const PRICES_KEY = 'commodity:prices:latest'
export const ESR_KEY = 'usda:esr:latest'
export const OUTCOMES_KEY = 'commodity:forecast-outcomes'
export const PARTNERS_KEY = 'commodity:partners:latest'
export const PRICE_MOVES_KEY = 'commodity:price-moves:latest'

// ─── TYPES (the scraper's, as stored) ────────────────────────────────────────

interface CardRegion { id: string; name: string; lat: number; lon: number; level: number; doing: string; rain_mm: number; rain_pct: number | null; low_c: number | null; high_c: number | null; risk: string | null }
export interface WatchCard {
  commodity: string
  commodity_name: string
  group: string
  iso: string
  country: string
  outlook: { year: string; unit: string; production: number | null; previous: number | null; change_pct: number | null; revision_pct: number | null; share_pct: number | null; estimate: string | null; text: string } | null
  weather: { level: number; weighted: number; text: string; regions: CardRegion[] } | null
  trade: { unit: string; exports: number | null; exports_share_pct: number | null; imports: number | null; imports_share_pct: number | null; us: { text: string } | null; text: string } | null
  market: { price: Record<string, unknown> | null; funds: Record<string, unknown> | null; text: string } | null
  news: { count: number; latest: Array<{ id: string; title: string; created_at: string }>; text: string } | null
  score: number
  call: string | null
  reasons: string[]
  flag: { text: string; level: number } | null
}
export interface WatchSnapshot {
  updated_at: string
  sources: Record<string, unknown>
  counts: { cards: number; flags: number; commodities: number }
  scorecard: { outcomes: number; by_call: Record<string, unknown>; pending: number }
  cards: WatchCard[]
}

/** How commodity prices moved a country's exports (the scraper's commodity/price-moves.ts) */
export interface CountryPriceMoves {
  name: string
  month_pct: number | null
  year_pct: number | null
  exposed_pct: number | null
  basket: number
  items: Array<{ commodity: string; name: string; value: number; share: number; price: { key: string; name: string; unit: string; month: string | null; value: number | null; month_pct: number | null; year_pct: number | null }; funds: { market: string; net: number; previous_net: number } | null }>
}
export interface PriceMovesSnapshot { updated_at: string; month: string | null; trade_year: number; sources: Record<string, string | null>; countries: Record<string, CountryPriceMoves> }

// The snapshot is large (every card): parse it once a minute, not once a request
let cached: { at: number; raw: string; snapshot: WatchSnapshot } | null = null
async function loadWatch(): Promise<WatchSnapshot | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.snapshot
  const raw = await redis.get(WATCH_KEY).catch(() => null)
  if (!raw) return null
  if (cached && cached.raw === raw) { cached.at = Date.now(); return cached.snapshot }
  try {
    const snapshot = JSON.parse(raw) as WatchSnapshot
    cached = { at: Date.now(), raw, snapshot }
    return snapshot
  } catch {
    return null
  }
}
/** For tests: forget the parsed snapshots */
export function resetCommodityCache(): void { cached = null; partnersCache = null }

export interface PartnerRow { iso: string; name: string; value: number; tonnes: number | null; share: number }
interface PartnerFlows { value: number; tonnes: number | null; top: PartnerRow[] }
/** A country's trade in all goods (the scraper's TradeTotals; thousands of US dollars) */
export interface TradeTotals {
  exports: number
  imports: number
  buyers: PartnerRow[]
  suppliers: PartnerRow[]
  exports_by: Array<{ hs2: string; name: string; value: number; share: number }>
  imports_by: Array<{ hs2: string; name: string; value: number; share: number }>
}
export interface PartnersSnapshot {
  year: number
  release: string
  source: string
  licence: string
  names: Record<string, string>
  countries: Record<string, { name: string; exports: Record<string, PartnerFlows>; imports: Record<string, PartnerFlows>; total?: TradeTotals }>
}
// The partners file is large too (every country's farm trade) and changes once a year: kept 10 minutes
let partnersCache: { at: number; snapshot: PartnersSnapshot | null } | null = null
export async function loadPartners(): Promise<PartnersSnapshot | null> {
  if (partnersCache && Date.now() - partnersCache.at < 600_000) return partnersCache.snapshot
  const raw = await redis.get(PARTNERS_KEY).catch(() => null)
  let snapshot: PartnersSnapshot | null = null
  try { snapshot = raw ? JSON.parse(raw) as PartnersSnapshot : null } catch { snapshot = null }
  partnersCache = { at: Date.now(), snapshot }
  return snapshot
}

/** A country's main buyers and suppliers, its biggest trades first */
function countryPartners(p: PartnersSnapshot | null, iso: string) {
  const c = p?.countries[iso]
  if (!p || !c) return null
  const list = (side: Record<string, PartnerFlows>) => Object.entries(side)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 10)
    .map(([commodity, f]) => ({ commodity, name: p.names[commodity] ?? commodity, value: f.value, tonnes: f.tonnes, top: f.top.slice(0, 5) }))
  return { year: p.year, release: p.release, source: p.source, licence: p.licence, exports: list(c.exports), imports: list(c.imports) }
}

export async function loadJson<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key).catch(() => null)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

const NOT_YET = "The commodity watch hasn't run yet: it reads USDA's, the World Bank's and the weather's data a few minutes after the scraper starts, then every 6 hours."
const KEY_RE = '^[a-z0-9-]{2,40}$'
const ISO_RE = '^[A-Za-z]{2}$'

/** A light row for the map */
function mapRow(c: WatchCard) {
  return {
    iso: c.iso, country: c.country, commodity: c.commodity, commodity_name: c.commodity_name,
    score: c.score, call: c.call, weather_level: c.weather?.level ?? null, flag: c.flag !== null,
    share_pct: c.outlook?.share_pct ?? null, exports_share_pct: c.trade?.exports_share_pct ?? null,
    headline: c.flag?.text ?? c.weather?.text ?? c.outlook?.text ?? null,
    regions: (c.weather?.regions ?? []).map(r => ({ name: r.name, lat: r.lat, lon: r.lon, level: r.level, risk: r.risk })),
  }
}

export const registerCommodityRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET / ────────────────────────────────────────────────
  app.get('/', {
    schema: { summary: 'Commodity watch: every commodity, its flags and its most at-risk country' },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const w = await loadWatch()
    if (!w) return reply.send({ success: true, data: { available: false, message: NOT_YET } })
    const byCommodity = new Map<string, WatchCard[]>()
    for (const c of w.cards) {
      const list = byCommodity.get(c.commodity)
      if (list) list.push(c); else byCommodity.set(c.commodity, [c])
    }
    const commodities = [...byCommodity.values()].map(cards => {
      const top = [...cards].sort((a, b) => b.score - a.score)[0]!
      return {
        key: top.commodity, name: top.commodity_name, group: top.group,
        countries: cards.length, flags: cards.filter(c => c.flag).length,
        top: { iso: top.iso, country: top.country, score: top.score, call: top.call, headline: top.flag?.text ?? top.weather?.text ?? top.outlook?.text ?? null },
      }
    }).sort((a, b) => b.flags - a.flags || b.top.score - a.top.score || a.name.localeCompare(b.name))
    const flags = w.cards.filter(c => c.flag).sort((a, b) => b.score - a.score).map(c => ({ commodity: c.commodity, commodity_name: c.commodity_name, iso: c.iso, country: c.country, score: c.score, level: c.flag!.level, text: c.flag!.text }))
    return reply.header('Cache-Control', 'public, max-age=300').send({
      success: true,
      data: { available: true, updated_at: w.updated_at, sources: w.sources, counts: w.counts, scorecard: w.scorecard, flags, commodities },
    })
  })

  // ─── GET /map ─────────────────────────────────────────────
  app.get<{ Querystring: { commodity?: string } }>('/map', {
    schema: {
      summary: 'Commodity watch for the map: one row per country',
      querystring: { type: 'object', properties: { commodity: { type: 'string', pattern: KEY_RE, description: 'One commodity ("coffee"); all commodities when left out' } } },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const w = await loadWatch()
    if (!w) return reply.send({ success: true, data: { available: false, message: NOT_YET } })
    const commodity = req.query.commodity
    let rows
    if (commodity) {
      rows = w.cards.filter(c => c.commodity === commodity).sort((a, b) => b.score - a.score).map(mapRow)
      if (!rows.length) return reply.status(404).send({ success: false, error: `No commodity "${commodity}" in the watch`, code: 'NOT_FOUND' })
    } else {
      // All commodities: each country's most at-risk card, with how many flags it has
      const best = new Map<string, { card: WatchCard; flags: number; commodities: number }>()
      for (const c of w.cards) {
        const b = best.get(c.iso)
        if (!b) best.set(c.iso, { card: c, flags: c.flag ? 1 : 0, commodities: 1 })
        else {
          b.commodities++
          if (c.flag) b.flags++
          if (c.score > b.card.score || (c.flag && !b.card.flag)) b.card = c
        }
      }
      rows = [...best.values()].sort((a, b) => b.card.score - a.card.score).map(b => ({ ...mapRow(b.card), flags: b.flags, commodities: b.commodities }))
    }
    return reply.header('Cache-Control', 'public, max-age=300').send({ success: true, data: { available: true, updated_at: w.updated_at, commodity: commodity ?? null, rows } })
  })

  // ─── GET /country/:iso ────────────────────────────────────
  app.get<{ Params: { iso: string } }>('/country/:iso', {
    schema: {
      summary: "A country's commodities: crops, exports, US purchases, weather risk and news",
      params: { type: 'object', required: ['iso'], properties: { iso: { type: 'string', pattern: ISO_RE } } },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const iso = req.params.iso.toUpperCase()
    const w = await loadWatch()
    if (!w) return reply.send({ success: true, data: { available: false, message: NOT_YET } })
    const cards = w.cards.filter(c => c.iso === iso).sort((a, b) => b.score - a.score || (b.outlook?.share_pct ?? 0) - (a.outlook?.share_pct ?? 0))
    // What it bought from the US in USDA's latest week, every commodity
    const esr = await loadJson<{ week_ending: string; source: string; report: string; buyers: Array<{ commodity: string; country_code: string | null; net_sales: number; exports: number; accumulated_exports: number; prev_year_accumulated_exports: number }>; commodities: Array<{ key: string; name: string; unit: string }> }>(ESR_KEY)
    const us = esr ? {
      week_ending: esr.week_ending, source: esr.source, report: esr.report,
      purchases: esr.buyers.filter(b => b.country_code === iso).sort((a, b) => b.net_sales - a.net_sales).map(b => ({
        commodity: b.commodity, name: esr.commodities.find(c => c.key === b.commodity)?.name ?? b.commodity, unit: esr.commodities.find(c => c.key === b.commodity)?.unit ?? 't',
        net_sales: b.net_sales, exports: b.exports, accumulated: b.accumulated_exports, prev_year_accumulated: b.prev_year_accumulated_exports,
      })),
    } : null
    const seen = new Set<string>()
    const news = cards.flatMap(c => (c.news?.latest ?? []).map(n => ({ ...n, commodity: c.commodity })))
      .filter(n => (seen.has(n.id) ? false : (seen.add(n.id), true)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 12)
    const partners = countryPartners(await loadPartners(), iso)
    if (!cards.length && !us?.purchases.length && !partners) {
      return reply.status(404).send({ success: false, error: `No commodity readings for ${iso} yet`, code: 'NOT_FOUND' })
    }
    return reply.header('Cache-Control', 'public, max-age=300').send({
      success: true,
      data: {
        available: true, iso, country: cards[0]?.country ?? iso, updated_at: w.updated_at, sources: w.sources,
        flags: cards.filter(c => c.flag).length, cards, us, news,
        // Its main buyers and suppliers (CEPII's BACI, yearly; values in thousands of US dollars)
        partners,
      },
    })
  })

  // ─── GET /prices ──────────────────────────────────────────
  app.get('/prices', {
    schema: { summary: "The World Bank's monthly commodity prices (the Pink Sheet, CC BY 4.0)" },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const p = await loadJson<{ source: string; licence: string; file_url: string; updated: string | null; month: string | null; series: Record<string, unknown> }>(PRICES_KEY)
    if (!p) return reply.send({ success: true, data: { available: false, message: "The World Bank's monthly prices haven't been read yet." } })
    return reply.header('Cache-Control', 'public, max-age=1800').send({ success: true, data: { available: true, ...p, series: Object.values(p.series) } })
  })

  // ─── GET /weather ─────────────────────────────────────────
  app.get<{ Querystring: { commodity?: string; country?: string } }>('/weather', {
    schema: {
      summary: "The crop regions' weather risk (MET Norway's forecast, NASA POWER's normals)",
      querystring: { type: 'object', properties: { commodity: { type: 'string', pattern: KEY_RE }, country: { type: 'string', pattern: ISO_RE } } },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const wx = await loadJson<{ updated_at: string; credits: string[]; regions: Array<{ commodity: string; iso: string; country: string; level: number }> }>(WEATHER_KEY)
    if (!wx) return reply.send({ success: true, data: { available: false, message: NOT_YET } })
    const country = req.query.country?.toUpperCase()
    const regions = wx.regions.filter(r => (!req.query.commodity || r.commodity === req.query.commodity) && (!country || r.iso === country || r.country === country))
      .sort((a, b) => b.level - a.level)
    return reply.header('Cache-Control', 'public, max-age=600').send({ success: true, data: { available: true, updated_at: wx.updated_at, credits: wx.credits, regions } })
  })

  // ─── GET /price-moves ─────────────────────────────────────
  app.get('/price-moves', {
    schema: { summary: "How commodity prices moved each country's exports: the World Bank's monthly prices weighted by CEPII BACI's trade" },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const pm = await loadJson<PriceMovesSnapshot>(PRICE_MOVES_KEY)
    if (!pm) return reply.send({ success: true, data: { available: false, message: "Price moves come once the World Bank's prices and the year's trade figures have been read (a few minutes after the scraper starts)." } })
    const rows = Object.entries(pm.countries)
      .map(([iso, c]) => ({ iso, name: c.name, month_pct: c.month_pct, year_pct: c.year_pct, exposed_pct: c.exposed_pct, basket: c.basket, top: c.items.slice(0, 3) }))
      .sort((a, b) => Math.abs(b.month_pct ?? 0) - Math.abs(a.month_pct ?? 0))
    return reply.header('Cache-Control', 'public, max-age=1800').send({
      success: true,
      data: { available: true, updated_at: pm.updated_at, month: pm.month, trade_year: pm.trade_year, sources: pm.sources, rows },
    })
  })

  // ─── GET /scorecard ───────────────────────────────────────
  app.get('/scorecard', {
    schema: { summary: "The commodity watch's calls against USDA's next revisions" },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const w = await loadWatch()
    const raw = await redis.lrange(OUTCOMES_KEY, 0, 199).catch(() => [] as string[])
    const outcomes = raw.map(s => { try { return JSON.parse(s) as Record<string, unknown> } catch { return null } }).filter(Boolean)
    return reply.header('Cache-Control', 'public, max-age=600').send({
      success: true,
      data: {
        how: "Each card's plain score (0 to 100) calls USDA's next revision of the country's crop: 50 or more \"cut likely\", 30 to 49 \"cut possible\", under 30 \"no cut expected\". When USDA revises, the last call before it is checked: cut (0.5% or more lower), raised (0.5% or more higher) or unchanged.",
        by_call: w?.scorecard.by_call ?? {}, pending: w?.scorecard.pending ?? 0, outcomes,
      },
    })
  })
}
