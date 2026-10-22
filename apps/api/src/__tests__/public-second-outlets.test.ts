/**
 * GET /api/v1/public/second-outlets (plan 0s3, Oct 22, 2026): what the
 * scraper's search of GDELT's news index found for reports only one outlet
 * carried, today's and yesterday's counts and the latest matches, so the
 * matches can be read by anyone.
 */
import { describe, it, expect, vi } from 'vitest'

const today = new Date().toISOString().slice(0, 10)
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

vi.mock('../db/redis', () => ({
  redis: {
    get: async () => null,
    setex: async () => 'OK',
    hgetall: async (key: string) => (key.endsWith(today) ? { searched: '40', matched: '9', outlets: '13', promoted: '8' } : {}),
    lrange: async () => [
      JSON.stringify({ id: 's1', title: 'Six dead as bus hits tree in Chhattisgarh', found: [{ site: 'ndtv.com', title: 'Six killed after bus hits tree in Chhattisgarh', url: 'https://www.ndtv.com/a' }] }),
      'not json',
    ],
  },
}))
vi.mock('../db/postgres', () => ({ db: Object.assign(() => ({}), { raw: (s: string) => s }) }))
vi.mock('../lib/categories', () => ({ signalCategories: async () => ['conflict'] }))
vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: async () => ({ total: 0, exact: true }) }))

import Fastify from 'fastify'
import { registerPublicRoutes } from '../routes/public'

describe('GET /api/v1/public/second-outlets', () => {
  it("answers the days' counts as numbers and the latest matches", async () => {
    const app = Fastify()
    await app.register(registerPublicRoutes, { prefix: '/api/v1/public' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/second-outlets' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    const { data } = res.json()
    expect(data.days[today]).toEqual({ searched: 40, matched: 9, outlets: 13, promoted: 8 })
    expect(data.days[yesterday]).toEqual({})
    expect(data.latest).toHaveLength(1)
    expect(data.latest[0].found[0].site).toBe('ndtv.com')
  })
})
