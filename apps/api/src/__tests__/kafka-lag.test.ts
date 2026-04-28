/**
 * Unit tests for the Kafka consumer lag checker (apps/api/src/lib/kafka-lag.ts).
 *
 * All KafkaJS and Redis calls are mocked — no live infrastructure required.
 * Uses vi.resetModules() per test so the _kafkaAdmin singleton starts fresh.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Per-test mock state ────────────────────────────────────────────────────────
let mockRedisGet:          ReturnType<typeof vi.fn>
let mockRedisSetex:        ReturnType<typeof vi.fn>
let mockConnect:           ReturnType<typeof vi.fn>
let mockFetchOffsets:      ReturnType<typeof vi.fn>
let mockFetchTopicOffsets: ReturnType<typeof vi.fn>
let getLagSummary:         (typeof import('../lib/kafka-lag'))['getLagSummary']

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildGroupOffsets(topic: string, committedOffset: number) {
  return [{ topic, partitions: [{ partition: 0, offset: String(committedOffset) }] }]
}

function buildTopicOffsets(endOffset: number) {
  return [{ partition: 0, offset: String(endOffset) }]
}

// ── Setup: fresh module + fresh mocks for every test ─────────────────────────
beforeEach(async () => {
  vi.resetModules()

  mockRedisGet          = vi.fn()
  mockRedisSetex        = vi.fn().mockResolvedValue('OK')
  mockConnect           = vi.fn().mockResolvedValue(undefined)
  mockFetchOffsets      = vi.fn()
  mockFetchTopicOffsets = vi.fn()

  vi.doMock('kafkajs', () => ({
    Kafka: vi.fn().mockImplementation(() => ({
      admin: () => ({
        connect:           mockConnect,
        fetchOffsets:      mockFetchOffsets,
        fetchTopicOffsets: mockFetchTopicOffsets,
      }),
    })),
  }))

  vi.doMock('../db/redis', () => ({
    redis: {
      get:   (...args: unknown[]) => mockRedisGet(...args),
      setex: (...args: unknown[]) => mockRedisSetex(...args),
    },
  }))

  const mod = await import('../lib/kafka-lag')
  getLagSummary = mod.getLagSummary
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('getLagSummary()', () => {

  it('returns cached result without calling Kafka admin when cache hit', async () => {
    const cached = {
      total_lag:      0,
      groups:         [],
      overall_status: 'healthy',
      checked_at:     new Date().toISOString(),
    }
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cached))

    const result = await getLagSummary()

    expect(result.overall_status).toBe('healthy')
    expect(mockConnect).not.toHaveBeenCalled()
    expect(mockFetchOffsets).not.toHaveBeenCalled()
  })

  it('returns healthy status when all groups have zero lag', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockFetchOffsets.mockResolvedValue(buildGroupOffsets('signals', 100))
    mockFetchTopicOffsets.mockResolvedValue(buildTopicOffsets(100))

    const result = await getLagSummary()

    expect(result.overall_status).toBe('healthy')
    expect(result.total_lag).toBe(0)
    expect(result.groups.every(g => g.status === 'healthy')).toBe(true)
  })

  it('returns warning status when a group has lag ≥ 500', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    // Committed at 100, end offset at 700 → lag 600 (warning threshold 500)
    mockFetchOffsets.mockResolvedValue(buildGroupOffsets('signals', 100))
    mockFetchTopicOffsets.mockResolvedValue(buildTopicOffsets(700))

    const result = await getLagSummary()

    expect(result.overall_status).toBe('warning')
    const group = result.groups.find(g => g.totalLag > 0)
    expect(group?.status).toBe('warning')
  })

  it('returns critical status when a group has lag ≥ 2000', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    // Committed at 0, end offset at 2500 → lag 2500 (critical threshold 2000)
    mockFetchOffsets.mockResolvedValue(buildGroupOffsets('signals', 0))
    mockFetchTopicOffsets.mockResolvedValue(buildTopicOffsets(2500))

    const result = await getLagSummary()

    expect(result.overall_status).toBe('critical')
    const criticalGroup = result.groups.find(g => g.status === 'critical')
    expect(criticalGroup).toBeDefined()
    expect(criticalGroup!.totalLag).toBeGreaterThanOrEqual(2000)
  })

  it('returns unavailable status when Kafka admin connect throws', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await getLagSummary()

    expect(result.overall_status).toBe('unavailable')
    expect(result.groups).toHaveLength(0)
  })

  it('returns unavailable status when Kafka admin times out (5 s)', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    // Never resolves → timeout wins
    mockConnect.mockImplementation(() => new Promise(() => { /* never resolves */ }))

    vi.useFakeTimers()
    const promise = getLagSummary()
    await vi.advanceTimersByTimeAsync(6_000)
    const result = await promise
    vi.useRealTimers()

    expect(result.overall_status).toBe('unavailable')
  }, 10_000)

  it('treats negative (uncommitted) offset as 0 for lag calculation', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    // Offset -1 means never committed — should be treated as 0
    mockFetchOffsets.mockResolvedValue(buildGroupOffsets('signals', -1))
    mockFetchTopicOffsets.mockResolvedValue(buildTopicOffsets(50))

    const result = await getLagSummary()
    const group = result.groups.find(g => g.totalLag > 0)
    // lag = max(0, 50 - 0) = 50
    expect(group?.totalLag).toBe(50)
  })

  it('writes the result to Redis cache with 30 s TTL on success', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockFetchOffsets.mockResolvedValue(buildGroupOffsets('signals', 10))
    mockFetchTopicOffsets.mockResolvedValue(buildTopicOffsets(10))

    await getLagSummary()

    expect(mockRedisSetex).toHaveBeenCalledWith(
      'kafka:lag:report',
      30,
      expect.any(String),
    )
  })

  it('returns a result with checked_at ISO timestamp', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockFetchOffsets.mockResolvedValue(buildGroupOffsets('signals', 5))
    mockFetchTopicOffsets.mockResolvedValue(buildTopicOffsets(5))

    const result = await getLagSummary()

    expect(result.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('handles a group with no subscribed topics (empty offsets) as healthy', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    // All groups return empty — never consumed any topic
    mockFetchOffsets.mockResolvedValue([])

    const result = await getLagSummary()

    const emptyGroup = result.groups.find(g => g.totalLag === 0 && g.partitions.length === 0)
    expect(emptyGroup).toBeDefined()
  })
})
