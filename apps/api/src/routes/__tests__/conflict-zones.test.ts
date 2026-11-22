/**
 * The conflict zones layer (GET /api/v1/signals/map/conflict-zones). Nov 22, 2026: with the server overloaded its query
 * crossed the pool's 5 seconds and the layer answered 500 to everyone, the morning video's map too. It is now kept in
 * Redis and remade in the background with 30 seconds (lib/swr-cache.ts, lib/long-query.ts), so a slow database shows
 * the last layer instead of none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ fail: false, kept: null as string | null, seconds: 0 }))

vi.mock('../../db/redis', () => ({
  redis: {
    get: vi.fn(async () => h.kept),
    setex: vi.fn(async () => 'OK'),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
}))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../db/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }) }))
vi.mock('../../lib/long-query', () => ({
  longQuery: async (seconds: number, run: (trx: unknown) => Promise<unknown>) => {
    h.seconds = seconds
    return run({
      raw: async () => {
        if (h.fail) throw new Error('canceling statement due to statement timeout')
        return { rows: [
          { id: 'c1', title: 'Shelling near Kharkiv', severity: 'high', category: 'conflict', reliability_score: '0.8', location_name: 'Kharkiv, Ukraine', published_at: new Date('2026-11-22T03:00:00Z'), lat: 49.99, lng: 36.23 },
        ] }
      },
    })
  },
}))

import { redis } from '../../db/redis'
import { registerSignalRoutes, MAP_LAYER_SWR, MAP_LAYER_QUERY_SECONDS } from '../signals'

async function app() {
  const a = Fastify({ logger: false })
  await a.register(registerSignalRoutes, { prefix: '/api/v1/signals' })
  return a
}

beforeEach(() => { h.fail = false; h.kept = null; vi.clearAllMocks() })

describe('GET /api/v1/signals/map/conflict-zones', () => {
  it('answers the points as GeoJSON and keeps them, with 30 seconds for the query', async () => {
    const a = await app()
    const res = await a.inject({ method: 'GET', url: '/api/v1/signals/map/conflict-zones' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [36.23, 49.99] }, properties: { id: 'c1', severity: 'high', source_name: 'Kharkiv, Ukraine', published_at: '2026-11-22T03:00:00.000Z' } }] })
    expect(h.seconds).toBe(MAP_LAYER_QUERY_SECONDS)
    expect(MAP_LAYER_QUERY_SECONDS).toBe(30)
    expect(redis.setex).toHaveBeenCalledWith('signals:map:conflict-zones:v3', MAP_LAYER_SWR.freshSeconds + MAP_LAYER_SWR.staleSeconds, expect.any(String))
    expect(MAP_LAYER_SWR).toEqual({ freshSeconds: 120, staleSeconds: 6 * 3600, lockSeconds: 60 })
    await a.close()
  })

  it('a slow database: the last layer while the next is made, and 503 (not 500) with nothing kept', async () => {
    h.fail = true
    h.kept = JSON.stringify({ at: Date.now() - 1800_000, value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'old' } }] } })
    const a = await app()
    const stale = await a.inject({ method: 'GET', url: '/api/v1/signals/map/conflict-zones' })
    expect(stale.statusCode).toBe(200)
    expect(stale.json().features[0].properties.id).toBe('old')
    h.kept = null
    const none = await a.inject({ method: 'GET', url: '/api/v1/signals/map/conflict-zones' })
    expect(none.statusCode).toBe(503)
    expect(none.json()).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' })
    await a.close()
  })
})
