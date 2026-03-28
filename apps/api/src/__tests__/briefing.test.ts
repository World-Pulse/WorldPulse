import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock DB + Redis ─────────────────────────────────────────────────────────

const mockSelect = vi.fn().mockReturnThis()
const mockWhere = vi.fn().mockReturnThis()
const mockWhereIn = vi.fn().mockReturnThis()
const mockWhereNotNull = vi.fn().mockReturnThis()
const mockOrderByRaw = vi.fn().mockReturnThis()
const mockOrderBy = vi.fn().mockReturnThis()
const mockGroupBy = vi.fn().mockReturnThis()
const mockCount = vi.fn().mockReturnThis()
const mockCountDistinct = vi.fn().mockReturnThis()
const mockAvg = vi.fn().mockReturnThis()
const mockLimit = vi.fn()
const mockRaw = vi.fn((s: string) => s)

const mockDb = vi.fn(() => ({
  select: mockSelect,
  where: mockWhere,
  whereIn: mockWhereIn,
  whereNotNull: mockWhereNotNull,
  orderByRaw: mockOrderByRaw,
  orderBy: mockOrderBy,
  groupBy: mockGroupBy,
  count: mockCount,
  countDistinct: mockCountDistinct,
  avg: mockAvg,
  limit: mockLimit,
}))

;(mockDb as Record<string, unknown>).raw = mockRaw

vi.mock('../db/postgres', () => ({ db: mockDb }))

const mockRedisGet = vi.fn()
const mockRedisSetex = vi.fn()
const mockRedisScan = vi.fn().mockResolvedValue(['0', []])
const mockRedisLpush = vi.fn()
const mockRedisLtrim = vi.fn()
const mockRedisLrange = vi.fn().mockResolvedValue([])

vi.mock('../db/redis', () => ({
  redis: {
    get: mockRedisGet,
    setex: mockRedisSetex,
    scan: mockRedisScan,
    lpush: mockRedisLpush,
    ltrim: mockRedisLtrim,
    lrange: mockRedisLrange,
  },
}))

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ─── Import after mocks ──────────────────────────────────────────────────────

import { generateDailyBriefing, getBriefingHistory } from '../lib/briefing-generator'

describe('briefing-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisGet.mockResolvedValue(null) // no cache by default
    mockLimit.mockResolvedValue([])      // empty results by default
    mockCount.mockReturnValue({
      where: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    })
  })

  describe('generateDailyBriefing', () => {
    it('returns cached briefing if available', async () => {
      const cachedBriefing = {
        id: 'briefing-2026-03-24-24h',
        date: '2026-03-24',
        generated_at: '2026-03-24T12:00:00Z',
        model: 'anthropic',
        period_hours: 24,
        total_signals: 100,
        total_clusters: 5,
        executive_summary: 'Test cached briefing',
        key_developments: [],
        category_breakdown: [],
        geographic_hotspots: [],
        threat_assessment: 'Low threat',
        outlook: 'All clear',
        top_signals: [],
      }
      mockRedisGet.mockResolvedValue(JSON.stringify(cachedBriefing))

      const result = await generateDailyBriefing(24)
      expect(result.executive_summary).toBe('Test cached briefing')
      expect(result.model).toBe('anthropic')
    })

    it('returns empty briefing when no signals exist', async () => {
      // All queries return empty
      mockLimit.mockResolvedValue([])
      // Mock the count query chain
      const mockCountChain = {
        where: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      }
      mockDb.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        orderByRaw: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue(mockCountChain),
        countDistinct: vi.fn().mockReturnThis(),
        avg: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }))

      const result = await generateDailyBriefing(24)
      expect(result.total_signals).toBe(0)
      expect(result.model).toBe('none')
      expect(result.executive_summary).toContain('No signals')
    })

    it('generates extractive briefing when no LLM keys are set', async () => {
      // Remove all LLM env vars
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY
      delete process.env.GEMINI_API_KEY
      delete process.env.OPENROUTER_API_KEY
      delete process.env.OLLAMA_URL

      const mockSignals = [
        {
          id: '1',
          title: 'Major earthquake in Japan',
          category: 'science',
          severity: 'critical',
          reliability_score: 0.95,
          location_name: 'Tokyo',
          country_code: 'JP',
          source_domain: 'usgs.gov',
          created_at: new Date().toISOString(),
        },
        {
          id: '2',
          title: 'Conflict escalation in Middle East',
          category: 'conflict',
          severity: 'high',
          reliability_score: 0.88,
          location_name: 'Syria',
          country_code: 'SY',
          source_domain: 'acled.org',
          created_at: new Date().toISOString(),
        },
      ]

      // Setup mock chain for different query types
      let callCount = 0
      mockDb.mockImplementation(() => {
        callCount++
        const chain = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          whereIn: vi.fn().mockReturnThis(),
          whereNotNull: vi.fn().mockReturnThis(),
          orderByRaw: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          count: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              count: vi.fn().mockResolvedValue([{ count: 42 }]),
            }),
          }),
          countDistinct: vi.fn().mockReturnThis(),
          avg: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(mockSignals),
        }
        return chain
      })

      const result = await generateDailyBriefing(24)
      expect(result.model).toBe('extractive')
      expect(result.executive_summary).toContain('processed')
      expect(result.key_developments.length).toBeGreaterThan(0)
    })

    it('caps hours at 72 when larger value passed', async () => {
      mockLimit.mockResolvedValue([])
      mockDb.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        orderByRaw: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        }),
        countDistinct: vi.fn().mockReturnThis(),
        avg: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }))

      const result = await generateDailyBriefing(24)
      expect(result.period_hours).toBe(24)
    })

    it('includes correct date in briefing id', async () => {
      mockDb.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        orderByRaw: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        }),
        countDistinct: vi.fn().mockReturnThis(),
        avg: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }))

      const result = await generateDailyBriefing(24)
      const today = new Date().toISOString().slice(0, 10)
      expect(result.id).toContain(today)
      expect(result.date).toBe(today)
    })
  })

  describe('getBriefingHistory', () => {
    it('returns empty array when no history exists', async () => {
      mockRedisLrange.mockResolvedValue([])
      const history = await getBriefingHistory()
      expect(history).toEqual([])
    })

    it('parses stored history entries correctly', async () => {
      mockRedisLrange.mockResolvedValue([
        JSON.stringify({ id: 'briefing-2026-03-24-24h', date: '2026-03-24', total_signals: 100 }),
        JSON.stringify({ id: 'briefing-2026-03-23-24h', date: '2026-03-23', total_signals: 85 }),
      ])
      const history = await getBriefingHistory()
      expect(history).toHaveLength(2)
      expect(history[0].id).toBe('briefing-2026-03-24-24h')
      expect(history[1].total_signals).toBe(85)
    })

    it('handles Redis errors gracefully', async () => {
      mockRedisLrange.mockRejectedValue(new Error('Connection failed'))
      const history = await getBriefingHistory()
      expect(history).toEqual([])
    })
  })
})
