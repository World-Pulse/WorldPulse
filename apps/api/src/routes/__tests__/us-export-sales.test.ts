/**
 * GET /api/v1/trade/us-export-sales (Oct 23, 2026): USDA's weekly export sales, as the scraper
 * keeps the latest week in Redis (apps/scraper/src/sources/usda-export-sales.ts).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerTradeRoutes, US_EXPORT_SALES_KEY } from '../trade'
import { errorReply } from '../../lib/error-reply'
import { redis } from '../../db/redis'

vi.mock('../../db/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn((s: string) => s) }) }))
vi.mock('../../db/redis', () => ({
  redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') },
}))

const WEEK = {
  week_ending: '2026-10-15',
  period: 'October 9-15, 2026',
  released_at: '2026-10-22T12:30:00.000Z',
  source: 'USDA Foreign Agricultural Service, Weekly Export Sales (US government data, free to reuse)',
  report: 'https://apps.fas.usda.gov/esrqs/#/reports/weeklyexportsalesreportdetail',
  commodities: [
    { key: 'soybeans', name: 'soybeans', unit: 't', net_sales: 2_841_199, exports: 2_016_753 },
    { key: 'corn', name: 'corn', unit: 't', net_sales: 1_527_122, exports: 780_260 },
  ],
  buyers: [
    { commodity: 'corn', country: 'Mexico', country_code: 'MX', usda_code: '2010', net_sales: 477_700, exports: 379_200 },
    { commodity: 'soybeans', country: 'China', country_code: 'CN', usda_code: '5700', net_sales: 2_178_641, exports: 1_333_641 },
    { commodity: 'soybeans', country: 'Mexico', country_code: 'MX', usda_code: '2010', net_sales: 232_213, exports: 238_828 },
  ],
}

describe('GET /api/v1/trade/us-export-sales', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify()
    app.setErrorHandler((err, _req, reply) => {
      const { status, body } = errorReply(err)
      return reply.status(status).send(body)
    })
    await app.register(registerTradeRoutes, { prefix: '/api/v1/trade' })
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => { vi.mocked(redis.get).mockReset() })

  it('says so when no week has been read yet', async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/v1/trade/us-export-sales' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true, data: { available: false } })
  })

  it('answers the latest week, buyers largest first', async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(WEEK))
    const res = await app.inject({ method: 'GET', url: '/api/v1/trade/us-export-sales' })
    expect(res.statusCode).toBe(200)
    expect(redis.get).toHaveBeenCalledWith(US_EXPORT_SALES_KEY)
    const { data } = res.json() as { data: typeof WEEK & { available: boolean } }
    expect(data).toMatchObject({ available: true, week_ending: '2026-10-15', released_at: '2026-10-22T12:30:00.000Z' })
    expect(data.buyers.map(b => b.net_sales)).toEqual([2_178_641, 477_700, 232_213])
    expect(res.headers['cache-control']).toBe('public, max-age=600')
  })

  it('narrows to a buyer country and a commodity', async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(WEEK))
    const mx = (await app.inject({ method: 'GET', url: '/api/v1/trade/us-export-sales?country=mx' })).json() as { data: typeof WEEK }
    expect(mx.data.buyers.map(b => `${b.commodity}:${b.country_code}`)).toEqual(['corn:MX', 'soybeans:MX'])
    const soy = (await app.inject({ method: 'GET', url: '/api/v1/trade/us-export-sales?commodity=soybeans' })).json() as { data: typeof WEEK }
    expect(soy.data.commodities.map(c => c.key)).toEqual(['soybeans'])
    expect(soy.data.buyers.map(b => b.country_code)).toEqual(['CN', 'MX'])
  })

  it('refuses a country that is not a two-letter code, or a commodity it does not know', async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(WEEK))
    expect((await app.inject({ method: 'GET', url: '/api/v1/trade/us-export-sales?country=China' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/v1/trade/us-export-sales?commodity=coffee' })).statusCode).toBe(400)
  })

  it('treats an unreadable stored week as none', async () => {
    vi.mocked(redis.get).mockResolvedValue('{not json')
    const res = await app.inject({ method: 'GET', url: '/api/v1/trade/us-export-sales' })
    expect(res.json()).toMatchObject({ data: { available: false } })
  })
})
