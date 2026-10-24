/**
 * Country economics (Oct 23, 2026; Devon: "Add ... the Lloyd's Bank like data and layers to the map").
 *
 * What a trade portal's country profile shows, from sources that may be published: the World Bank's
 * World Development Indicators (CC BY 4.0; apps/scraper/src/sources/worldbank-wdi.ts), each country's
 * trade in all goods with its main partners and product groups (CEPII BACI, Etalab Open Licence 2.0),
 * and how commodity prices moved its exports (the commodity watch's price moves).
 *   GET /api/v1/economy?indicator=growth   one indicator for every country (the map's layer)
 *   GET /api/v1/economy/:iso               a country's profile
 */

import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { loadPartners, loadJson, PRICE_MOVES_KEY, type PriceMovesSnapshot } from './commodities'

export const ECONOMICS_KEY = 'country:economics:latest'

interface Indicator { key: string; code: string; name: string; unit: 'usd' | 'pct' | 'pct_gdp' | 'people' }
interface EconomicsSnapshot {
  updated_at: string
  source: string
  licence: string
  link: string
  indicators: Indicator[]
  countries: Record<string, { name: string; region: string | null; income: string | null; values: Record<string, { value: number; year: number }> }>
}

let cached: { at: number; raw: string; snapshot: EconomicsSnapshot } | null = null
async function loadEconomics(): Promise<EconomicsSnapshot | null> {
  if (cached && Date.now() - cached.at < 300_000) return cached.snapshot
  const raw = await redis.get(ECONOMICS_KEY).catch(() => null)
  if (!raw) return null
  if (cached && cached.raw === raw) { cached.at = Date.now(); return cached.snapshot }
  try {
    const snapshot = JSON.parse(raw) as EconomicsSnapshot
    cached = { at: Date.now(), raw, snapshot }
    return snapshot
  } catch {
    return null
  }
}
/** For tests */
export function resetEconomyCache(): void { cached = null }

const NOT_YET = "The World Bank's country figures haven't been read yet: they come a few minutes after the scraper starts, then daily."

export const registerEconomyRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET / ────────────────────────────────────────────────
  app.get<{ Querystring: { indicator?: string } }>('/', {
    schema: {
      summary: 'One economic indicator for every country (World Bank, CC BY 4.0)',
      querystring: { type: 'object', properties: { indicator: { type: 'string', pattern: '^[a-z_]{2,30}$', description: 'growth (default), inflation, unemployment, trade, current_account, gdp_per_person, gdp, exports, imports, population' } } },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const e = await loadEconomics()
    if (!e) return reply.send({ success: true, data: { available: false, message: NOT_YET } })
    const key = req.query.indicator ?? 'growth'
    const indicator = e.indicators.find(i => i.key === key)
    if (!indicator) return reply.status(404).send({ success: false, error: `No indicator "${key}"`, code: 'NOT_FOUND' })
    const rows = Object.entries(e.countries)
      .filter(([, c]) => c.values[key])
      .map(([iso, c]) => ({ iso, name: c.name, value: c.values[key]!.value, year: c.values[key]!.year }))
      .sort((a, b) => b.value - a.value)
    return reply.header('Cache-Control', 'public, max-age=3600').send({
      success: true,
      data: { available: true, updated_at: e.updated_at, source: e.source, licence: e.licence, link: e.link, indicator, indicators: e.indicators, rows },
    })
  })

  // ─── GET /:iso ────────────────────────────────────────────
  app.get<{ Params: { iso: string } }>('/:iso', {
    schema: {
      summary: "A country's economy: World Bank figures, its trade in all goods (CEPII BACI) and how commodity prices moved its exports",
      params: { type: 'object', required: ['iso'], properties: { iso: { type: 'string', pattern: '^[A-Za-z]{2}$' } } },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const iso = req.params.iso.toUpperCase()
    const [e, partners, moves] = await Promise.all([loadEconomics(), loadPartners(), loadJson<PriceMovesSnapshot>(PRICE_MOVES_KEY)])
    const c = e?.countries[iso]
    const t = partners?.countries[iso]
    const pm = moves?.countries[iso] ?? null
    if (!c && !t?.total && !pm) {
      if (!e && !partners) return reply.send({ success: true, data: { available: false, message: NOT_YET } })
      return reply.status(404).send({ success: false, error: `No economic figures for ${iso}`, code: 'NOT_FOUND' })
    }
    return reply.header('Cache-Control', 'public, max-age=1800').send({
      success: true,
      data: {
        available: true, iso, name: c?.name ?? t?.name ?? pm?.name ?? iso, region: c?.region ?? null, income: c?.income ?? null,
        figures: c && e ? {
          source: e.source, licence: e.licence, link: e.link, updated_at: e.updated_at,
          values: e.indicators.filter(i => c.values[i.key]).map(i => ({ key: i.key, name: i.name, unit: i.unit, value: c.values[i.key]!.value, year: c.values[i.key]!.year })),
        } : null,
        trade: t?.total && partners ? { year: partners.year, release: partners.release, source: partners.source, licence: partners.licence, ...t.total } : null,
        prices: pm && moves ? { month: moves.month, trade_year: moves.trade_year, sources: moves.sources, ...pm } : null,
      },
    })
  })
}
