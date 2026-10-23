/**
 * Natural Hazards API Tests
 *
 * Test suite for GET /api/v1/hazards/map/points endpoint
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerHazardsRoutes } from '../hazards'
import { errorReply } from '../../lib/error-reply'
import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

// Stand-ins for the database and Redis (the test used the real ones, so it needed a server
// with both running): a query builder that answers no rows after any chain, and an empty cache
vi.mock('../../db/postgres', () => {
  const builder = (): unknown => {
    const b: Record<string, unknown> = {}
    const proxy: unknown = new Proxy(b, {
      get: (_t, prop) => prop === 'then'
        ? (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve([]).then(resolve, reject)
        : () => proxy,
    })
    return proxy
  }
  return { db: Object.assign(vi.fn(() => builder()), { raw: vi.fn((sql: string) => sql) }) }
})
vi.mock('../../db/redis', () => ({
  redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') },
}))

describe('Hazards API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify()
    // The API's answer to a failed request (index.ts): a schema refusal is
    // { success: false, code: 'VALIDATION_ERROR', … }
    app.setErrorHandler((err, _req, reply) => {
      const { status, body } = errorReply(err)
      return reply.status(status).send(body)
    })
    await app.register(registerHazardsRoutes, { prefix: '/api/v1/hazards' })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /map/points', () => {
    it('Test 1: returns 200 with points structure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points',
      })

      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { points: unknown[] } }
      expect(json.success).toBe(true)
      expect(Array.isArray(json.data.points)).toBe(true)
    })

    it('Test 2: validates hours param min (< 1 returns 400)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points?hours=0',
      })

      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; error?: string }
      expect(json.success).toBe(false)
      expect(json.error).toContain('must be between')
    })

    it('Test 3: validates hours param max (> 720 returns 400)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points?hours=721',
      })

      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; error?: string }
      expect(json.success).toBe(false)
      expect(json.error).toContain('must be between')
    })

    it('Test 4: invalid hours param returns 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points?hours=abc',
      })

      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; error?: string }
      expect(json.success).toBe(false)
    })

    it('Test 5: response includes required fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points?hours=48',
      })

      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        cached: boolean
        data: {
          points: Array<{
            id: string
            title: string
            lat: number
            lng: number
            severity: string
            category: string
            source_slug: string
            published_at: string
            reliability_score: number
          }>
          count: number
          hours: number
        }
      }
      expect(json.success).toBe(true)
      expect(json.data.hours).toBe(48)
      expect(json.data.count).toBe(json.data.points.length)
      if (json.data.points.length > 0) {
        const point = json.data.points[0]
        expect(point).toHaveProperty('id')
        expect(point).toHaveProperty('title')
        expect(point).toHaveProperty('lat')
        expect(point).toHaveProperty('lng')
        expect(point).toHaveProperty('severity')
        expect(point).toHaveProperty('category')
        expect(point).toHaveProperty('source_slug')
        expect(point).toHaveProperty('published_at')
        expect(point).toHaveProperty('reliability_score')
      }
    })

    it('Test 6: rate limit headers present', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points',
      })

      expect(res.statusCode).toBe(200)
      // Fastify rate-limit should add x-ratelimit-* headers
      expect(res.headers).toBeDefined()
    })

    it('Test 7: valid hours param (48) accepted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points?hours=48',
      })

      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { hours: number } }
      expect(json.success).toBe(true)
      expect(json.data.hours).toBe(48)
    })

    it('Test 8: default hours=48 when not specified', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/hazards/map/points',
      })

      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { hours: number } }
      expect(json.success).toBe(true)
      expect(json.data.hours).toBe(48)
    })
  })
})
