/**
 * Space Weather Intelligence API Tests
 *
 * Test suite for:
 *   GET /api/v1/space-weather/recent
 *   GET /api/v1/space-weather/summary
 *
 * Sources: NOAA SWPC (geomagnetic/solar/radio) + CelesTrak (satellite tracking).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerSpaceWeatherRoutes } from '../space-weather'
import { redis } from '../../db/redis'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../db/postgres', () => ({
  db: vi.fn(() => ({
    select:      vi.fn().mockReturnThis(),
    where:       vi.fn().mockReturnThis(),
    whereIn:     vi.fn().mockReturnThis(),
    whereRaw:    vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    orderBy:     vi.fn().mockReturnThis(),
    limit:       vi.fn().mockResolvedValue([]),
    raw:         vi.fn((s: string) => s),
  })),
}))

vi.mock('../../db/redis', () => ({
  redis: {
    get:   vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Space Weather API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify()
    await app.register(registerSpaceWeatherRoutes, { prefix: '/api/v1/space-weather' })
  })

  afterAll(async () => {
    await app.close()
  })

  // ── GET /recent ───────────────────────────────────────────────────────────

  describe('GET /recent', () => {
    it('Test 1: returns 200 with events array', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { events: unknown[] } }
      expect(json.success).toBe(true)
      expect(Array.isArray(json.data.events)).toBe(true)
    })

    it('Test 2: rejects hours < 1', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?hours=0' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_HOURS')
    })

    it('Test 3: rejects hours > 720', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?hours=721' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_HOURS')
    })

    it('Test 4: rejects non-numeric hours', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?hours=abc' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_HOURS')
    })

    it('Test 5: rejects limit > 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?limit=201' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_LIMIT')
    })

    it('Test 6: rejects limit < 1', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?limit=0' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_LIMIT')
    })

    it('Test 7: accepts valid hours=24', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?hours=24' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { hours: number } }
      expect(json.success).toBe(true)
      expect(json.data.hours).toBe(24)
    })

    it('Test 8: default hours=48 when not specified', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { hours: number } }
      expect(json.data.hours).toBe(48)
    })

    it('Test 9: count matches events length', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: { events: unknown[]; count: number }
      }
      expect(json.data.count).toBe(json.data.events.length)
    })

    it('Test 10: accepts severity filter=critical', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?severity=critical' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean }
      expect(json.success).toBe(true)
    })

    it('Test 11: ignores unknown severity values (no filter applied)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/recent?severity=bogus' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean }
      expect(json.success).toBe(true)
    })
  })

  // ── GET /summary ──────────────────────────────────────────────────────────

  describe('GET /summary', () => {
    it('Test 12: returns 200 with storm level fields', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: {
          geomagnetic_level:     number
          solar_radiation_level: number
          radio_blackout_level:  number
        }
      }
      expect(json.success).toBe(true)
      expect(typeof json.data.geomagnetic_level).toBe('number')
      expect(typeof json.data.solar_radiation_level).toBe('number')
      expect(typeof json.data.radio_blackout_level).toBe('number')
    })

    it('Test 13: returns active_events and satellite_events_24h', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: { active_events: number; satellite_events_24h: number }
      }
      expect(typeof json.data.active_events).toBe('number')
      expect(typeof json.data.satellite_events_24h).toBe('number')
    })

    it('Test 14: cached response has cached:true', async () => {
      const mockSummary = {
        geomagnetic_level:     3,
        solar_radiation_level: 1,
        radio_blackout_level:  2,
        active_events:         7,
        latest_at:             new Date().toISOString(),
        satellite_events_24h:  2,
      }
      vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(mockSummary))

      const res = await app.inject({ method: 'GET', url: '/api/v1/space-weather/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        cached:  boolean
        data:    typeof mockSummary
      }
      expect(json.success).toBe(true)
      expect(json.cached).toBe(true)
      expect(json.data.geomagnetic_level).toBe(3)
      expect(json.data.solar_radiation_level).toBe(1)
      expect(json.data.radio_blackout_level).toBe(2)
    })
  })
})
