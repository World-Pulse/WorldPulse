/**
 * GET /api/v1/maritime/live: ships in the main straits right now, from the
 * fleet the scraper keeps in Redis (aisstream.io; Oct 19, 2026, PLAN M39).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const mockRedis = { get: vi.fn() }
vi.mock('../../db/redis', () => ({ get redis() { return mockRedis } }))
vi.mock('../../db/postgres', () => ({ db: {} }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))

import { AIS_LIVE_KEY, liveShipsGeoJson, registerMaritimeRoutes, shipKind } from '../maritime'

const ship = (o: Record<string, unknown> = {}) => ({
  mmsi: '353136000', name: 'EVER GIVEN', lat: 26.51234, lon: 56.34567, sog: 12.3, cog: 87.5, heading: 88,
  nav: 0, type: 84, dest: 'FUJAIRAH', area: 'Strait of Hormuz', at: Date.parse('2026-10-20T03:00:00Z'), ...o,
})

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(registerMaritimeRoutes, { prefix: '/api/v1/maritime' })
  return app
}

describe('live ships', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('names what a ship is from its AIS type', () => {
    expect([84, 71, 60, 30, 35, 55, 52, null].map(shipKind)).toEqual(['tanker', 'cargo', 'passenger', 'fishing', 'military', 'military', 'other', 'other'])
  })

  it('maps the fleet to GeoJSON, positions rounded to about 100 m', () => {
    const [f] = liveShipsGeoJson({ ships: [ship() as never] })
    expect(f!.geometry.coordinates).toEqual([56.346, 26.512])
    expect(f!.properties).toMatchObject({ mmsi: '353136000', name: 'EVER GIVEN', kind: 'tanker', sog: 12.3, dest: 'FUJAIRAH', seen: '2026-10-20T03:00:00.000Z' })
    expect(liveShipsGeoJson(null)).toEqual([])
  })

  it('GET /live serves the fleet the scraper wrote', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ at: '2026-10-20T03:00:30.000Z', connected: true, areas: [{ name: 'Strait of Hormuz', ships: 1 }], ships: [ship()] }))
    const res = await (await buildApp()).inject({ method: 'GET', url: '/api/v1/maritime/live' })
    expect(mockRedis.get).toHaveBeenCalledWith(AIS_LIVE_KEY)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=30')
    const body = res.json()
    expect(body).toMatchObject({ available: true, connected: true, source: 'aisstream.io', type: 'FeatureCollection' })
    expect(body.features).toHaveLength(1)
  })

  it('GET /live says when there is no live feed (no key yet), with no ships', async () => {
    mockRedis.get.mockResolvedValue(null)
    const res = await (await buildApp()).inject({ method: 'GET', url: '/api/v1/maritime/live' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ available: false, connected: false, features: [] })
  })
})
