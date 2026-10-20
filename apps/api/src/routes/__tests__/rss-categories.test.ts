/**
 * The RSS feeds' categories are the database's own (plan 0o, Oct 20, 2026):
 * the fixed list had 10 names no signal has and refused 9 that signals do
 * have (economy, finance, geopolitics…).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ enumRows: [] as Array<{ name: string }>, raw: [] as string[] }))

vi.mock('../../db/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string) => {
      h.raw.push(sql)
      if (/enum_range\(NULL::category\)/.test(sql)) return { rows: h.enumRows }
      return { rows: [] }
    }),
  }),
}))
vi.mock('../../db/redis', () => ({
  redis: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) },
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { registerRssRoutes } from '../rss'
import { forgetSignalCategories } from '../../lib/categories'

async function build() {
  const app = Fastify({ logger: false })
  await app.register(registerRssRoutes, { prefix: '/api/v1/rss' })
  return app
}

describe('RSS categories', () => {
  beforeEach(() => {
    forgetSignalCategories()
    h.raw.length = 0
    h.enumRows = ['breaking', 'conflict', 'geopolitics', 'economy', 'finance', 'other'].map(name => ({ name }))
  })

  it("lists one feed per database category in the OPML, leaving out \"other\"", async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/api/v1/rss/opml' })
    expect(res.statusCode).toBe(200)
    for (const c of ['breaking', 'conflict', 'geopolitics', 'economy', 'finance']) {
      expect(res.body).toContain(`/api/v1/rss/category/${c}.xml`)
    }
    expect(res.body).not.toContain('/category/other.xml')
    expect(res.body).not.toContain('/category/military.xml')   // a name no signal has
  })

  it('answers 400 with the list for a filter the database has no category for', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/api/v1/rss/signals.json?category=economics' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('economy, finance')
  })

  it('answers 404 for a category feed that does not exist', async () => {
    const app = await build()
    expect((await app.inject({ method: 'GET', url: '/api/v1/rss/category/military.xml' })).statusCode).toBe(404)
  })
})
