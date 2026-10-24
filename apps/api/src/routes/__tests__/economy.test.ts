/**
 * Country economics, Lloyd's List's headlines and price moves (Oct 23, 2026): the API over what the
 * scraper keeps in Redis (the World Bank's figures, CEPII BACI's trade, the commodity watch's price
 * moves, Lloyd's List's feed).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerEconomyRoutes, resetEconomyCache, ECONOMICS_KEY } from '../economy'
import { registerShippingNewsRoutes, HEADLINES_KEY } from '../shipping-news'
import { registerCommodityRoutes, resetCommodityCache, PARTNERS_KEY, PRICE_MOVES_KEY } from '../commodities'
import { errorReply } from '../../lib/error-reply'
import { redis } from '../../db/redis'

vi.mock('../../db/redis', () => ({
  redis: { get: vi.fn(async () => null), lrange: vi.fn(async () => []) },
}))

const ECONOMICS = {
  updated_at: '2026-10-24T03:00:00.000Z', source: 'World Bank, World Development Indicators', licence: 'CC BY 4.0', link: 'https://data.worldbank.org',
  indicators: [
    { key: 'growth', code: 'NY.GDP.MKTP.KD.ZG', name: 'GDP growth', unit: 'pct' },
    { key: 'inflation', code: 'FP.CPI.TOTL.ZG', name: 'Inflation', unit: 'pct' },
  ],
  countries: {
    BR: { name: 'Brazil', region: 'Latin America & Caribbean', income: 'Upper middle income', values: { growth: { value: 2.286, year: 2025 }, inflation: { value: 5.1, year: 2025 } } },
    EG: { name: 'Egypt', region: 'Middle East, North Africa, Afghanistan & Pakistan', income: 'Lower middle income', values: { growth: { value: 4.392, year: 2025 } } },
  },
}
const PARTNERS = {
  year: 2024, release: '202601', source: 'CEPII BACI', licence: 'Etalab Open Licence 2.0', names: {},
  countries: { BR: { name: 'Brazil', exports: {}, imports: {}, total: {
    exports: 330_000_000, imports: 260_000_000,
    buyers: [{ iso: 'CN', name: 'China', value: 95_000_000, tonnes: null, share: 28.8 }], suppliers: [{ iso: 'CN', name: 'China', value: 63_000_000, tonnes: null, share: 24.2 }],
    exports_by: [{ hs2: '12', name: 'Oilseeds', value: 50_000_000, share: 15.2 }], imports_by: [{ hs2: '85', name: 'Electrical equipment', value: 30_000_000, share: 11.5 }],
  } } },
}
const MOVES = {
  updated_at: '2026-10-24T03:05:00.000Z', month: '2026-09', trade_year: 2024, sources: { prices: 'World Bank (CC BY 4.0)', trade: 'CEPII BACI', funds: null },
  countries: {
    BR: { name: 'Brazil', month_pct: 14.4, year_pct: 35.6, exposed_pct: 30.9, basket: 102_000_000, items: [{ commodity: 'soybeans', name: 'Soybeans', value: 50_000_000, share: 49, price: { key: 'soybeans', name: 'Soybeans', unit: '$/mt', month: '2026-09', value: 524, month_pct: 8.7, year_pct: 19.4 }, funds: null }] },
    SA: { name: 'Saudi Arabia', month_pct: 28.5, year_pct: 71.8, exposed_pct: 72, basket: 180_000_000, items: [] },
  },
}
const HEADLINES = {
  updated_at: '2026-10-24T03:00:00.000Z', source: "Lloyd's List", source_url: 'https://www.lloydslist.com',
  items: [
    { id: 'LL1158806', title: 'Crude tankers in correction mode after Hormuz-driven ‘super spike’', url: 'https://www.lloydslist.com/LL1158806/Crude', published: '2026-10-23T23:20:09.000Z', kind: 'Analysis', sectors: ['Tankers and Gas'], topics: ['VLCC'],
      places: [{ key: 'sea:strait-of-hormuz', name: 'Strait of Hormuz', iso: null, lat: 26.57, lon: 56.25 }] },
    { id: 'LL1158797', title: 'Shipping’s digital decade is only the beginning', url: 'https://www.lloydslist.com/LL1158797/Shipping', published: '2026-10-23T15:04:51.000Z', kind: 'News', sectors: ['Digitalisation'], topics: [],
      places: [{ key: 'GR', name: 'Greece', iso: 'GR', lat: null, lon: null }, { key: 'SG', name: 'Singapore', iso: 'SG', lat: null, lon: null }] },
    { id: 'LL1158790', title: 'Hormuz fuels bad bunkers as Singapore biofuel sales plunge', url: 'https://www.lloydslist.com/LL1158790/Hormuz', published: '2026-10-23T10:06:49.000Z', kind: 'News', sectors: ['Bunkers'], topics: [],
      places: [{ key: 'sea:strait-of-hormuz', name: 'Strait of Hormuz', iso: null, lat: 26.57, lon: 56.25 }, { key: 'SG', name: 'Singapore', iso: 'SG', lat: null, lon: null }] },
  ],
}

const STORE: Record<string, unknown> = { [ECONOMICS_KEY]: ECONOMICS, [PARTNERS_KEY]: PARTNERS, [PRICE_MOVES_KEY]: MOVES, [HEADLINES_KEY]: HEADLINES }

describe('economy, headlines and price moves', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = Fastify()
    app.setErrorHandler((err, _req, reply) => { const { status, body } = errorReply(err); return reply.status(status).send(body) })
    await app.register(registerEconomyRoutes, { prefix: '/api/v1/economy' })
    await app.register(registerShippingNewsRoutes, { prefix: '/api/v1/maritime' })
    await app.register(registerCommodityRoutes, { prefix: '/api/v1/commodities' })
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => {
    resetEconomyCache(); resetCommodityCache()
    vi.mocked(redis.get).mockReset()
    vi.mocked(redis.get).mockImplementation(async (key: string) => (key in STORE ? JSON.stringify(STORE[key]) : null))
  })

  it('gives the map one indicator for every country, with its source', async () => {
    const data = (await app.inject({ method: 'GET', url: '/api/v1/economy?indicator=growth' })).json().data
    expect(data).toMatchObject({ available: true, licence: 'CC BY 4.0', indicator: { key: 'growth', unit: 'pct' } })
    expect(data.rows).toEqual([{ iso: 'EG', name: 'Egypt', value: 4.392, year: 2025 }, { iso: 'BR', name: 'Brazil', value: 2.286, year: 2025 }])
    expect((await app.inject({ method: 'GET', url: '/api/v1/economy?indicator=happiness' })).statusCode).toBe(404)
  })

  it("answers a country's profile: figures, trade in all goods and price moves", async () => {
    const data = (await app.inject({ method: 'GET', url: '/api/v1/economy/br' })).json().data
    expect(data).toMatchObject({ iso: 'BR', name: 'Brazil', income: 'Upper middle income' })
    expect(data.figures.values.map((v: { key: string }) => v.key)).toEqual(['growth', 'inflation'])
    expect(data.trade).toMatchObject({ year: 2024, licence: 'Etalab Open Licence 2.0', exports: 330_000_000, buyers: [{ iso: 'CN', share: 28.8 }] })
    expect(data.prices).toMatchObject({ month: '2026-09', month_pct: 14.4, items: [{ commodity: 'soybeans' }] })
    expect((await app.inject({ method: 'GET', url: '/api/v1/economy/ZZ' })).statusCode).toBe(404)
  })

  it('lists the price moves, biggest first', async () => {
    const data = (await app.inject({ method: 'GET', url: '/api/v1/commodities/price-moves' })).json().data
    expect(data.rows.map((r: { iso: string }) => r.iso)).toEqual(['SA', 'BR'])
    expect(data).toMatchObject({ month: '2026-09', trade_year: 2024 })
  })

  it("lists Lloyd's List's headlines, credited, and the places they're about", async () => {
    const data = (await app.inject({ method: 'GET', url: '/api/v1/maritime/headlines' })).json().data
    expect(data.credit).toBe("Headlines: Lloyd's List (lloydslist.com)")
    expect(data.places.map((p: { key: string; count: number }) => [p.key, p.count])).toEqual([['sea:strait-of-hormuz', 2], ['SG', 2], ['GR', 1]])
    expect(data.places[0].latest.title).toBe('Crude tankers in correction mode after Hormuz-driven ‘super spike’')
    const sg = (await app.inject({ method: 'GET', url: '/api/v1/maritime/headlines?country=sg' })).json().data
    expect(sg.items.map((i: { id: string }) => i.id)).toEqual(['LL1158797', 'LL1158790'])
  })

  it('says so before the sources have been read', async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    for (const url of ['/api/v1/economy', '/api/v1/economy/BR', '/api/v1/maritime/headlines', '/api/v1/commodities/price-moves']) {
      expect((await app.inject({ method: 'GET', url })).json().data.available).toBe(false)
    }
  })
})
