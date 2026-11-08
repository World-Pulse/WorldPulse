/**
 * GET /api/v1/countries/:code/daily (Nov 8, 2026): the reports pinned in a
 * country per UTC day, for the AI assistants' trend tool ("is coverage of
 * Sudan growing?"), every day of the window, a day with none as 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ sql: '', bindings: [] as unknown[], rows: [] as Array<Record<string, unknown>> }))

vi.mock('../db/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string, bindings: unknown[]) => {
      h.sql = sql
      h.bindings = bindings
      return { rows: h.rows }
    }),
  }),
}))
vi.mock('../db/redis', () => ({
  redis: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) },
}))

import { registerCountryRoutes } from '../routes/countries'

async function get(url: string) {
  const app = Fastify({ logger: false })
  await app.register(registerCountryRoutes, { prefix: '/api/v1/countries' })
  return app.inject({ method: 'GET', url })
}

describe('GET /api/v1/countries/:code/daily', () => {
  beforeEach(() => { h.rows = []; h.sql = '' })

  it('counts every report and the verified ones per UTC day, the whole window, none as 0', async () => {
    const today = new Date().toISOString().slice(0, 10)
    h.rows = [{ day: today, reports: 12, verified: 3 }]
    const res = await get('/api/v1/countries/sd/daily?days=7')
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d).toMatchObject({ code: 'SD', name: 'Sudan', days: 7 })
    expect(d.daily).toHaveLength(7)
    expect(d.daily[6]).toEqual({ day: today, reports: 12, verified: 3 })
    expect(d.daily[0]).toMatchObject({ reports: 0, verified: 0 })
    // one country, its reports and verified ones, from the window's first UTC midnight
    expect(h.sql).toMatch(/count\(\*\) FILTER \(WHERE status = 'verified'\)::int AS verified/)
    expect(h.sql).toMatch(/WHERE country_code = \? AND created_at >= \? AND status IN \('verified', 'pending'\)/)
    expect(h.bindings[0]).toBe('SD')
    expect((h.bindings[1] as Date).toISOString().slice(11)).toBe('00:00:00.000Z')
  })

  it('takes 7 to 90 days (30 otherwise) and answers 400 for what is not a country code', async () => {
    expect((await get('/api/v1/countries/SD/daily')).json().data.days).toBe(30)
    expect((await get('/api/v1/countries/SD/daily?days=500')).json().data.days).toBe(30)
    expect((await get('/api/v1/countries/Sudan/daily')).statusCode).toBe(400)
  })
})
