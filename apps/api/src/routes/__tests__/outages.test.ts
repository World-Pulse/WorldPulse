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
  // (db.raw on the function itself: the routes call db.raw while building a query)
  db: Object.assign(vi.fn(() => ({
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
  })), { raw: vi.fn((s: string) => s) }),
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

  // ── Which reports ─────────────────────────────────────────────────────────

  it("reads the reports the scraper tags 'ioda', by the columns signals has (Oct 20, 2026)", async () => {
    // signals has no source_id or source_url column: every query failed, and the error read as "no outages"
    vi.mocked(redis.get).mockResolvedValueOnce(null)
    await app.inject({ method: 'GET', url: '/api/v1/outages/recent?hours=24' })
    const builder = vi.mocked(db).mock.results.at(-1)!.value as Record<string, ReturnType<typeof vi.fn>>
    expect(builder.where!.mock.calls).toEqual([])
    expect(builder.whereRaw!.mock.calls).toEqual([
      ['? = ANY(tags)', ['ioda']],
      ['COALESCE(event_time, created_at) > now() - make_interval(hours => ?)', [24]],
    ])
    const selected = builder.select!.mock.calls[0]!.map(String)
    expect(selected).not.toContain('source_url')
    expect(selected).not.toContain('published_at')
    expect(selected).toContain('original_urls[1] as source_url')

    await app.inject({ method: 'GET', url: '/api/v1/outages/summary' })
    const summary = vi.mocked(db).mock.results.at(-1)!.value as Record<string, ReturnType<typeof vi.fn>>
    expect(summary.where!.mock.calls).toEqual([])
    expect(summary.whereRaw!.mock.calls[0]).toEqual(['? = ANY(tags)', ['ioda']])
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
      expect(json.code).toBe('VALIDATION_ERROR')
    })

    it('Test 3: rejects hours > 720', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?hours=721' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('VALIDATION_ERROR')
    })

    it('Test 4: rejects non-numeric hours', async () => {
      // (Fastify's own query check answers this one, in its own body)
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?hours=xyz' })
      expect(res.statusCode).toBe(400)
      expect(res.payload).toMatch(/hours/)
    })

    it('Test 5: rejects limit > 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/outages/recent?limit=201' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('VALIDATION_ERROR')
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
