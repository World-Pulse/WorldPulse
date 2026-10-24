/**
 * The commodity watch's API (Oct 23, 2026): the cards the scraper keeps in Redis
 * (apps/scraper/src/commodity/watch.ts), for the map, the country panel, prices and the record.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerCommodityRoutes, resetCommodityCache, WATCH_KEY, ESR_KEY, PRICES_KEY, PARTNERS_KEY, type WatchCard } from '../commodities'
import { errorReply } from '../../lib/error-reply'
import { redis } from '../../db/redis'

vi.mock('../../db/redis', () => ({
  redis: { get: vi.fn(async () => null), lrange: vi.fn(async () => []) },
}))

const card = (over: Partial<WatchCard>): WatchCard => ({
  commodity: 'coffee', commodity_name: 'Coffee', group: 'softs', iso: 'BR', country: 'Brazil',
  outlook: { year: '2026/27', unit: '1000 60 KG BAGS', production: 71_900, previous: 63_000, change_pct: 14.1, revision_pct: null, share_pct: 37.9, estimate: '2026-07', text: "USDA: 71.9 million bags in 2026/27, up 14.1% on last year, 38% of the world's" },
  weather: { level: 3, weighted: 1.15, text: 'South Minas Gerais (Varginha): 4.8 mm of rain forecast in the next 10 days, 14% of normal, while the crop is flowering', regions: [{ id: 'coffee:BR:south-minas-gerais-varginha', name: 'South Minas Gerais (Varginha)', lat: -21.55, lon: -45.43, level: 3, doing: 'flowering', rain_mm: 4.8, rain_pct: 14, low_c: 11.9, high_c: 26.3, risk: '4.8 mm of rain forecast' }] },
  trade: { unit: '1000 60 KG BAGS', exports: 49_070, exports_share_pct: 30.9, imports: 90, imports_share_pct: 0.1, us: null, text: "Exports 49.1 million bags, 31% of the world's" },
  market: { price: { key: 'coffee-arabica' }, funds: null, text: 'Arabica coffee $7.26/kg in September' },
  news: { count: 1, latest: [{ id: 'n1', title: 'Coffee exports slow', created_at: '2026-10-19T00:00:00.000Z' }], text: '1 report in our sources in the last 14 days' },
  score: 55, call: 'cut likely', reasons: ['+40 High weather risk'], flag: { level: 3, text: 'Coffee in Brazil: dry' },
  ...over,
})
const SNAPSHOT = {
  updated_at: '2026-10-24T06:00:00.000Z',
  sources: { psd_release: '2026-10' },
  counts: { cards: 3, flags: 1, commodities: 2 },
  scorecard: { outcomes: 0, by_call: {}, pending: 3 },
  cards: [
    card({}),
    card({ iso: 'VN', country: 'Vietnam', weather: null, score: 0, call: 'no cut expected', flag: null, news: { count: 4, latest: [], text: '4 reports' } }),
    card({ commodity: 'soybeans', commodity_name: 'Soybeans', group: 'oilseeds', weather: null, score: 10, call: 'no cut expected', flag: null, news: { count: 2, latest: [{ id: 'n2', title: 'Soy harvest begins', created_at: '2026-10-20T00:00:00.000Z' }, { id: 'n1', title: 'Coffee exports slow', created_at: '2026-10-19T00:00:00.000Z' }], text: '2 reports' } }),
  ],
}

describe('GET /api/v1/commodities', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = Fastify()
    app.setErrorHandler((err, _req, reply) => { const { status, body } = errorReply(err); return reply.status(status).send(body) })
    await app.register(registerCommodityRoutes, { prefix: '/api/v1/commodities' })
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => {
    resetCommodityCache()
    vi.mocked(redis.get).mockReset()
    vi.mocked(redis.get).mockImplementation(async (key: string) => (key === WATCH_KEY ? JSON.stringify(SNAPSHOT) : null))
  })

  it('says so before the watch has run', async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/v1/commodities' })
    expect(res.json()).toMatchObject({ success: true, data: { available: false } })
  })

  it('lists the commodities, flagged ones first, and the flags', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/commodities' })
    const data = res.json().data
    expect(data.commodities.map((c: { key: string }) => c.key)).toEqual(['coffee', 'soybeans'])
    expect(data.commodities[0]).toMatchObject({ countries: 2, flags: 1, top: { iso: 'BR', score: 55 } })
    expect(data.flags).toEqual([{ commodity: 'coffee', commodity_name: 'Coffee', iso: 'BR', country: 'Brazil', score: 55, level: 3, text: 'Coffee in Brazil: dry' }])
  })

  it("gives the map one row per country: one commodity's, or each country's most at risk", async () => {
    const one = (await app.inject({ method: 'GET', url: '/api/v1/commodities/map?commodity=coffee' })).json().data
    expect(one.rows.map((r: { iso: string }) => r.iso)).toEqual(['BR', 'VN'])
    expect(one.rows[0]).toMatchObject({ score: 55, weather_level: 3, flag: true, regions: [{ lat: -21.55, lon: -45.43, level: 3 }] })
    const all = (await app.inject({ method: 'GET', url: '/api/v1/commodities/map' })).json().data
    expect(all.rows).toHaveLength(2)
    expect(all.rows[0]).toMatchObject({ iso: 'BR', commodity: 'coffee', flags: 1, commodities: 2 })
    expect((await app.inject({ method: 'GET', url: '/api/v1/commodities/map?commodity=tin' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/commodities/map?commodity=DROP%20TABLE' })).statusCode).toBe(400)
  })

  it("answers a country's panel with its cards, US purchases and news", async () => {
    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key === WATCH_KEY) return JSON.stringify(SNAPSHOT)
      if (key === ESR_KEY) return JSON.stringify({
        week_ending: '2026-10-15', source: 'USDA', report: 'https://apps.fas.usda.gov/esrqs/',
        commodities: [{ key: 'wheat', name: 'wheat', unit: 't' }],
        buyers: [{ commodity: 'wheat', country_code: 'BR', net_sales: 120_000, exports: 60_000, accumulated_exports: 900_000, prev_year_accumulated_exports: 700_000 }, { commodity: 'wheat', country_code: 'MX', net_sales: 5, exports: 5, accumulated_exports: 5, prev_year_accumulated_exports: 5 }],
      })
      return null
    })
    const data = (await app.inject({ method: 'GET', url: '/api/v1/commodities/country/br' })).json().data
    expect(data).toMatchObject({ iso: 'BR', country: 'Brazil', flags: 1, partners: null })   // none read yet
    expect(data.cards.map((c: WatchCard) => c.commodity)).toEqual(['coffee', 'soybeans'])
    expect(data.us.purchases).toEqual([{ commodity: 'wheat', name: 'wheat', unit: 't', net_sales: 120_000, exports: 60_000, accumulated: 900_000, prev_year_accumulated: 700_000 }])
    expect(data.news.map((n: { id: string }) => n.id)).toEqual(['n2', 'n1'])
    expect((await app.inject({ method: 'GET', url: '/api/v1/commodities/country/ZZ' })).statusCode).toBe(404)
  })

  it("adds the country's main buyers and suppliers, biggest trades first", async () => {
    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key === WATCH_KEY) return JSON.stringify(SNAPSHOT)
      if (key === PARTNERS_KEY) return JSON.stringify({
        year: 2024, release: '202601', source: 'CEPII BACI', licence: 'Etalab Open Licence 2.0', names: { coffee: 'Coffee', soybeans: 'Soybeans', wheat: 'Wheat' },
        countries: { BR: { name: 'Brazil',
          exports: { coffee: { value: 12_000_000, tonnes: 2_500_000, top: [{ iso: 'US', name: 'United States', value: 2_000_000, tonnes: 400_000, share: 16.7 }] }, soybeans: { value: 50_000_000, tonnes: 100_000_000, top: [{ iso: 'CN', name: 'China', value: 36_000_000, tonnes: 72_000_000, share: 72 }] } },
          imports: { wheat: { value: 1_500_000, tonnes: 6_000_000, top: [{ iso: 'AR', name: 'Argentina', value: 1_100_000, tonnes: 4_400_000, share: 73.3 }] } } } },
      })
      return null
    })
    const data = (await app.inject({ method: 'GET', url: '/api/v1/commodities/country/BR' })).json().data
    expect(data.partners).toMatchObject({ year: 2024, release: '202601', licence: 'Etalab Open Licence 2.0' })
    expect(data.partners.exports.map((e: { commodity: string }) => e.commodity)).toEqual(['soybeans', 'coffee'])
    expect(data.partners.imports[0]).toMatchObject({ commodity: 'wheat', name: 'Wheat', top: [{ iso: 'AR', share: 73.3 }] })
  })

  it("answers the World Bank's prices with their licence", async () => {
    vi.mocked(redis.get).mockImplementation(async (key: string) => (key === PRICES_KEY ? JSON.stringify({ source: 'World Bank Commodity Price Data (The Pink Sheet)', licence: 'CC BY 4.0', file_url: 'x', updated: '2026-10-02', month: '2026-09', series: { cocoa: { key: 'cocoa', value: 5.92 } } }) : null))
    const data = (await app.inject({ method: 'GET', url: '/api/v1/commodities/prices' })).json().data
    expect(data).toMatchObject({ available: true, licence: 'CC BY 4.0', month: '2026-09', series: [{ key: 'cocoa', value: 5.92 }] })
  })
})
