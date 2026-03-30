/**
 * Internet Outage Intelligence API Tests
 *
 * Test suite for:
 *   GET /api/v1/outages/recent
 *   GET /api/v1/outages/summary
 *
 * Counters OpenClaw internet outage monitoring (terminal-only) with web UI.
 * IODA source: Georgia Tech CAIDA (reliability 0.87).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerOutagesRoutes } from '../outages'
import { db }    from '../../db/postgres'
import { redis } from '../../db/redis'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../db/postgres', () => ({
  db: vi.fn(() => ({
    select:     vi.fn().mockReturnThis(),
    where:      vi.fn().mockReturnThis(),
    whereIn:    vi.fn().mockReturnThis(),
    whereRaw:   vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    groupBy:    vi.fn().mockReturnThis(),
    orderBy:    vi.fn().mockReturnThis(),
    orderByRaw: vi.fn().mockReturnThis(),
    limit:      vi.fn().mockResolvedValue([]),
    raw:        vi.fn((s: string) => s),
  })),
}))

vi.mock('../../db/redis', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
  },
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Outages API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify()
    await app.register(registerOutagesRoutes, { prefix: '/api/v1/outages' })
  })

  afterAll(async () => {
    await app.close()
  })

  // ── GET /recent ───────────────────────────────────────────────────────────

  describe('GET /recent', () => {
    it('Test 1: returns 200 with events array', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { events: unknown[] } }
      expect(json.success).toBe(true)
      expect(Array.isArray(json.data.events)).toBe(true)
    })

    it('Test 2: rejects hours < 1', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?hours=0' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_HOURS')
    })

    it('Test 3: rejects hours > 720', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?hours=721' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_HOURS')
    })

    it('Test 4: rejects non-numeric hours', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?hours=xyz' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_HOURS')
    })

    it('Test 5: rejects limit > 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?limit=201' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_LIMIT')
    })

    it('Test 6: accepts valid hours=24', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?hours=24' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { hours: number } }
      expect(json.success).toBe(true)
      expect(json.data.hours).toBe(24)
    })

    it('Test 7: default hours=48 when not specified', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { hours: number } }
      expect(json.data.hours).toBe(48)
    })

    it('Test 8: returns count matching events length', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: { events: unknown[]; count: number }
      }
      expect(json.data.count).toBe(json.data.events.length)
    })

    it('Test 9: accepts severity filter=critical', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?severity=critical' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean }
      expect(json.success).toBe(true)
    })

    it('Test 10: accepts severity filter=high', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?severity=high' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean }
      expect(json.success).toBe(true)
    })
  })

  // ── GET /summary ──────────────────────────────────────────────────────────

  describe('GET /summary', () => {
    it('Test 11: returns 200 with countries array', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: { countries: unknown[]; count: number }
      }
      expect(json.success).toBe(true)
      expect(Array.isArray(json.data.countries)).toBe(true)
    })

    it('Test 12: summary count matches countries length', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: { countries: unknown[]; count: number }
      }
      expect(json.data.count).toBe(json.data.countries.length)
    })

    it('Test 13: cached responses have cached:true', async () => {
      const mockData = [
        {
          location_name: 'Iran',
          country_code: 'IR',
          severity: 'critical',
          event_count: 3,
          latest_at: new Date().toISOString(),
        },
      ]
      vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(mockData))

      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; cached: boolean }
      expect(json.success).toBe(true)
      expect(json.cached).toBe(true)
    })
  })
})
