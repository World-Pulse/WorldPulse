/**
 * Cyber Threat Intelligence API Tests
 *
 * Test suite for:
 *   GET /api/v1/cyber/recent
 *   GET /api/v1/cyber/summary
 *
 * Sources: CISA KEV (cisa-kev) + AlienVault OTX (otx-threats).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerCyberRoutes } from '../routes/cyber'
import { redis } from '../db/redis'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../db/postgres', () => ({
  db: vi.fn(() => ({
    select:       vi.fn().mockReturnThis(),
    where:        vi.fn().mockReturnThis(),
    whereIn:      vi.fn().mockReturnThis(),
    whereRaw:     vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    orderBy:      vi.fn().mockReturnThis(),
    limit:        vi.fn().mockResolvedValue([]),
    raw:          vi.fn((s: string) => s),
  })),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get:   vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Cyber Threat Intelligence API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify()
    await app.register(registerCyberRoutes, { prefix: '/api/v1/cyber' })
  })

  afterAll(async () => {
    await app.close()
  })

  // ── GET /recent ───────────────────────────────────────────────────────────

  describe('GET /recent', () => {

    it('Test 1: returns 200 with signals array on success', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { signals: unknown[] } }
      expect(json.success).toBe(true)
      expect(Array.isArray(json.data.signals)).toBe(true)
    })

    it('Test 2: default window is 24h', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { window: string } }
      expect(json.data.window).toBe('24h')
    })

    it('Test 3: accepts window=48h and reflects it in response', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent?window=48h' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { window: string } }
      expect(json.success).toBe(true)
      expect(json.data.window).toBe('48h')
    })

    it('Test 4: accepts window=7d and reflects it in response', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent?window=7d' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { success: boolean; data: { window: string } }
      expect(json.success).toBe(true)
      expect(json.data.window).toBe('7d')
    })

    it('Test 5: rejects invalid time window param with 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent?window=3h' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_WINDOW')
    })

    it('Test 6: rejects numeric window param with 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent?window=24' })
      expect(res.statusCode).toBe(400)
      const json = JSON.parse(res.payload) as { success: boolean; code: string }
      expect(json.success).toBe(false)
      expect(json.code).toBe('INVALID_WINDOW')
    })

    it('Test 7: count field matches signals array length', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: { signals: unknown[]; count: number }
      }
      expect(json.data.count).toBe(json.data.signals.length)
    })

    it('Test 8: returns empty signals array when no threats exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as { data: { signals: unknown[]; count: number } }
      // DB mock returns [] by default
      expect(json.data.signals).toHaveLength(0)
      expect(json.data.count).toBe(0)
    })

    it('Test 9: cached response has cached:true', async () => {
      const mockSignals = [
        {
          id:                'sig-1',
          title:             'CVE-2024-1234 CISA KEV',
          summary:           'Active exploitation detected',
          severity:          'critical',
          reliability_score: 0.95,
          source_url:        'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
          published_at:      new Date().toISOString(),
          source_slug:       'cisa-kev',
        },
      ]
      vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(mockSignals))

      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent?window=24h' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        cached:  boolean
        data:    { signals: typeof mockSignals }
      }
      expect(json.success).toBe(true)
      expect(json.cached).toBe(true)
      expect(json.data.signals[0]?.source_slug).toBe('cisa-kev')
    })

    it('Test 10: source_slug detection — cisa-kev vs otx-threats in cached data', async () => {
      const mockSignals = [
        {
          id:                'sig-cisa',
          title:             'Apache Log4j KEV',
          summary:           'Log4Shell exploitation',
          severity:          'critical',
          reliability_score: 0.95,
          source_url:        null,
          published_at:      new Date().toISOString(),
          source_slug:       'cisa-kev',
        },
        {
          id:                'sig-otx',
          title:             'OTX Pulse: Ransomware campaign',
          summary:           'New ransomware C2 infrastructure',
          severity:          'high',
          reliability_score: 0.82,
          source_url:        'https://otx.alienvault.com/pulse/abc123',
          published_at:      new Date().toISOString(),
          source_slug:       'otx-threats',
        },
      ]
      vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(mockSignals))

      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/recent?window=7d' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        data: { signals: Array<{ source_slug: string }> }
      }
      const slugs = json.data.signals.map(s => s.source_slug)
      expect(slugs).toContain('cisa-kev')
      expect(slugs).toContain('otx-threats')
    })

  })

  // ── GET /summary ──────────────────────────────────────────────────────────

  describe('GET /summary', () => {

    it('Test 11: returns 200 with all required count fields', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        data: {
          total_24h:      number
          cisa_kev_count: number
          otx_count:      number
          critical_count: number
          high_count:     number
          medium_count:   number
          low_count:      number
        }
      }
      expect(json.success).toBe(true)
      expect(typeof json.data.total_24h).toBe('number')
      expect(typeof json.data.cisa_kev_count).toBe('number')
      expect(typeof json.data.otx_count).toBe('number')
      expect(typeof json.data.critical_count).toBe('number')
      expect(typeof json.data.high_count).toBe('number')
      expect(typeof json.data.medium_count).toBe('number')
      expect(typeof json.data.low_count).toBe('number')
    })

    it('Test 12: summary cached response returns cached:true', async () => {
      const mockSummary = {
        total_24h:      42,
        cisa_kev_count: 18,
        otx_count:      24,
        critical_count: 5,
        high_count:     12,
        medium_count:   17,
        low_count:      8,
      }
      vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(mockSummary))

      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        success: boolean
        cached:  boolean
        data:    typeof mockSummary
      }
      expect(json.success).toBe(true)
      expect(json.cached).toBe(true)
      expect(json.data.total_24h).toBe(42)
      expect(json.data.cisa_kev_count).toBe(18)
      expect(json.data.otx_count).toBe(24)
    })

    it('Test 13: severity counts are all zero when DB returns empty', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cyber/summary' })
      expect(res.statusCode).toBe(200)
      const json = JSON.parse(res.payload) as {
        data: {
          total_24h:      number
          critical_count: number
          high_count:     number
          medium_count:   number
          low_count:      number
        }
      }
      // DB mock returns [] by default → all counts = 0
      expect(json.data.total_24h).toBe(0)
      expect(json.data.critical_count).toBe(0)
      expect(json.data.high_count).toBe(0)
      expect(json.data.medium_count).toBe(0)
      expect(json.data.low_count).toBe(0)
    })

  })

})
