/**
 * Convergence hotspots (Oct 11, 2026): the categories came back as one string
 * ("{conflict,health}", an enum array node-pg doesn't parse) and opening the
 * map's list crashed the page; the ranking followed plain counts, so the top
 * cells were capitals full of everyday news.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ sql: '' }))

vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../db/postgres', () => ({
  db: Object.assign(vi.fn(), {
    raw: vi.fn(async (sql: string) => {
      h.sql = sql
      return { rows: [{
        cell_lat: 50, cell_lng: 31, signal_count: 40, category_count: 3,
        categories: '{conflict,disaster,health}', max_severity: 'critical', avg_reliability: '0.8',
        latest_signal_at: new Date('2026-10-11T05:00:00Z'), center_lat: '50.42', center_lng: '30.61',
        place: 'Kyiv, Ukraine', sample_titles: ['Strike on Kyiv'], sample_ids: '{a1,b2}',
      }] }
    }),
  }),
}))

import { registerSignalRoutes, pgTextArray } from '../signals'

describe('pgTextArray', () => {
  it('reads parsed arrays and Postgres array text', () => {
    expect(pgTextArray(['a', 'b'])).toEqual(['a', 'b'])
    expect(pgTextArray('{conflict,"sci fi"}')).toEqual(['conflict', 'sci fi'])
    expect(pgTextArray('{}')).toEqual([])
    expect(pgTextArray(undefined)).toEqual([])
  })
})

describe('GET /api/v1/signals/map/hotspots', () => {
  it('sends lists, the place, and ranks by serious signals', async () => {
    const app = Fastify({ logger: false })
    await app.register(registerSignalRoutes, { prefix: '/api/v1/signals' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/map/hotspots?hours=24&min_categories=2&limit=5' })
    expect(res.statusCode).toBe(200)
    const [hs] = res.json().data.hotspots
    expect(hs.categories).toEqual(['conflict', 'disaster', 'health'])
    expect(hs.sampleIds).toEqual(['a1', 'b2'])
    expect(hs.place).toBe('Kyiv, Ukraine')
    expect(hs.centerLat).toBeCloseTo(50.42)
    expect(h.sql).toMatch(/category::text/)
    expect(h.sql).toMatch(/AVG\(lat\)/)                       // the centre, not the cell's corner
    expect(h.sql).toMatch(/ORDER BY weight DESC/)
    expect(h.sql).toMatch(/FILTER \(WHERE sev_rank >= 3\)/)   // only medium or worse makes a convergence
  })
})
