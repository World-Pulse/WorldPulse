/**
 * The Natural hazards layer's query (Oct 11, 2026): it filtered on a
 * source_id column that signals doesn't have, so it failed with a 500 and the
 * layer stayed empty. Hazard signals are found by their feeds' tags.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ calls: [] as Array<{ method: string; args: unknown[] }> }))

vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../db/postgres', () => {
  function builder() {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'whereIn', 'whereRaw', 'orderBy', 'limit']) {
      b[m] = (...args: unknown[]) => { h.calls.push({ method: m, args }); return b }
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve([
      { id: 'q1', title: 'M5.1 earthquake near Hualien', category: 'disaster', severity: 'medium', reliability_score: 0.9,
        source_slug: 'seismic', published_at: new Date('2026-10-11T05:00:00Z'), lat: 23.9, lng: 121.6 },
    ]).then(res, rej)
    return b
  }
  return { db: Object.assign(vi.fn(() => builder()), { raw: vi.fn((sql: string) => ({ sql, toString: () => sql })) }) }
})

import { registerHazardsRoutes, HAZARD_TAGS } from '../hazards'

describe('GET /api/v1/hazards/map/points', () => {
  it('finds hazard signals by their tags, in the window by when they arrived', async () => {
    const app = Fastify({ logger: false })
    await app.register(registerHazardsRoutes, { prefix: '/api/v1/hazards' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/hazards/map/points?hours=48' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.points[0]).toMatchObject({ id: 'q1', source_slug: 'seismic', lat: 23.9 })
    const raws = h.calls.filter(c => c.method === 'whereRaw').map(c => String(c.args[0]))
    expect(raws).toContain('tags && ?::text[]')
    expect(h.calls.find(c => c.method === 'whereRaw' && c.args[0] === 'tags && ?::text[]')?.args[1]).toEqual([HAZARD_TAGS])
    expect(raws.some(r => /created_at > now\(\)/.test(r))).toBe(true)
    expect(h.calls.some(c => c.method === 'whereIn' && c.args[0] === 'source_id')).toBe(false)
  })
})
