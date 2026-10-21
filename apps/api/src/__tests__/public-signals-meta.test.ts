/**
 * GET /api/v1/public/signals answers a meta block like the other lists
 * (plan V3f), through the route's own response schema: on Oct 21, 2026 the
 * block shipped without a place in the schema, and the serializer dropped it.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/redis', () => ({ redis: { get: async () => null, setex: async () => 'OK' } }))
vi.mock('../lib/categories', () => ({ signalCategories: async () => ['conflict'] }))
vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: async () => ({ total: 42, exact: true }) }))
vi.mock('../db/postgres', () => {
  const rows = [
    { id: 's1', title: 'One', category: 'conflict', severity: 'high', reliability_score: '0.9', location_name: null, published_at: '2026-10-21T10:00:00Z', source_url: null },
    { id: 's2', title: 'Two', category: 'conflict', severity: 'low', reliability_score: '0.7', location_name: 'Kyiv', published_at: '2026-10-21T09:00:00Z', source_url: null },
  ]
  const q: Record<string, unknown> = {}
  for (const m of ['where', 'orderBy', 'limit', 'offset', 'select', 'whereRaw']) q[m] = () => q
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok)
  return { db: Object.assign(() => q, { raw: (s: string) => s }) }
})

import Fastify from 'fastify'
import { registerPublicRoutes } from '../routes/public'

describe('GET /api/v1/public/signals: meta', () => {
  it('is in the answer, beside the totals', async () => {
    const app = Fastify()
    await app.register(registerPublicRoutes, { prefix: '/api/v1/public' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/signals?limit=2&offset=10' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ total: 42, total_exact: true, limit: 2, offset: 10 })
    expect(body.meta).toEqual({ total: 42, total_exact: true, limit: 2, offset: 10, has_more: true })
  })
})
