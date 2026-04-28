import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Use vi.hoisted() so these variables are available when vi.mock() factory runs
// (vi.mock calls are hoisted to the top of the file by Vitest).

const {
  mockIncrPipe,
  mockExpirePipe,
  mockExecPipe,
  mockGet,
  mockSet,
  mockIncr,
  mockSmembers,
  mockHget,
  mockPipeline,
} = vi.hoisted(() => {
  const mockIncrPipe   = vi.fn().mockReturnValue(undefined)
  const mockExpirePipe = vi.fn().mockReturnValue(undefined)
  const mockExecPipe   = vi.fn().mockResolvedValue([])
  const mockGet        = vi.fn().mockResolvedValue(null)
  const mockSet        = vi.fn().mockResolvedValue('OK')
  const mockIncr       = vi.fn().mockResolvedValue(1)
  const mockSmembers   = vi.fn().mockResolvedValue([])
  const mockHget       = vi.fn().mockResolvedValue(null)
  const mockPipeline   = vi.fn().mockReturnValue({
    incr:   mockIncrPipe,
    expire: mockExpirePipe,
    exec:   mockExecPipe,
  })
  return { mockIncrPipe, mockExpirePipe, mockExecPipe, mockGet, mockSet, mockIncr, mockSmembers, mockHget, mockPipeline }
})

vi.mock('../redis.js', () => ({
  redis: {
    get:      mockGet,
    set:      mockSet,
    incr:     mockIncr,
    smembers: mockSmembers,
    hget:     mockHget,
    pipeline: mockPipeline,
  },
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Import after mocks are declared
import {
  currentHourBucket,
  evaluateCleanHour,
  runStabilityCheck,
  getStabilityState,
  recordUnhandledException,
  getExceptionCountForHour,
  TARGET_HOURS,
  CLEAN_SOURCE_THRESHOLD,
} from '../stability-tracker.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearMocks() {
  mockGet.mockReset()
  mockSet.mockReset()
  mockIncr.mockReset()
  mockSmembers.mockReset()
  mockHget.mockReset()
  mockPipeline.mockClear()
  mockIncrPipe.mockClear()
  mockExpirePipe.mockClear()
  mockExecPipe.mockResolvedValue([])
  mockGet.mockResolvedValue(null)
  mockSet.mockResolvedValue('OK')
  mockIncr.mockResolvedValue(1)
  mockSmembers.mockResolvedValue([])
  mockHget.mockResolvedValue(null)
}

// ─── currentHourBucket ────────────────────────────────────────────────────────

describe('currentHourBucket', () => {
  it('returns YYYY-MM-DDTHH format for a known date', () => {
    const now = new Date('2026-03-25T14:37:00.000Z')
    expect(currentHourBucket(now)).toBe('2026-03-25T14')
  })

  it('uses current date when no argument provided', () => {
    const result = currentHourBucket()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/)
  })

  it('returns 13-character string', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(currentHourBucket(now)).toHaveLength(13)
  })
})

// ─── recordUnhandledException ────────────────────────────────────────────────

describe('recordUnhandledException', () => {
  beforeEach(clearMocks)

  it('calls pipeline incr and expire for the current hour bucket', async () => {
    await recordUnhandledException('something went wrong')

    expect(mockPipeline).toHaveBeenCalledOnce()
    expect(mockIncrPipe).toHaveBeenCalledOnce()
    expect(mockExpirePipe).toHaveBeenCalledOnce()
    expect(mockExecPipe).toHaveBeenCalledOnce()
  })

  it('calls pipeline.incr with the exceptions key for the current hour', async () => {
    const now = new Date()
    const bucket = currentHourBucket(now)
    await recordUnhandledException('boom')

    const incrArg = mockIncrPipe.mock.calls[0]![0] as string
    expect(incrArg).toBe(`scraper:stability:exceptions:${bucket}`)
  })

  it('calls pipeline.expire with TTL of 7200 seconds (2 hours)', async () => {
    await recordUnhandledException('boom')

    const expireArgs = mockExpirePipe.mock.calls[0] as [string, number]
    expect(expireArgs[1]).toBe(2 * 3600)
  })
})

// ─── getExceptionCountForHour ────────────────────────────────────────────────

describe('getExceptionCountForHour', () => {
  beforeEach(clearMocks)

  it('returns 0 when Redis returns null', async () => {
    mockGet.mockResolvedValue(null)
    const count = await getExceptionCountForHour('2026-03-25T14')
    expect(count).toBe(0)
  })

  it('returns the parsed integer from Redis', async () => {
    mockGet.mockResolvedValue('5')
    const count = await getExceptionCountForHour('2026-03-25T14')
    expect(count).toBe(5)
  })

  it('uses current bucket when no argument given', async () => {
    mockGet.mockResolvedValue('3')
    const count = await getExceptionCountForHour()
    expect(count).toBe(3)
    const key = mockGet.mock.calls[0]![0] as string
    expect(key).toMatch(/^scraper:stability:exceptions:\d{4}-\d{2}-\d{2}T\d{2}$/)
  })
})

// ─── evaluateCleanHour ───────────────────────────────────────────────────────

describe('evaluateCleanHour', () => {
  beforeEach(clearMocks)

  it('returns clean=false with "No sources tracked yet" when no sources', async () => {
    mockSmembers.mockResolvedValue([])
    mockGet.mockResolvedValue(null) // no exceptions

    const result = await evaluateCleanHour(new Date('2026-03-25T14:00:00.000Z'))

    expect(result.clean).toBe(false)
    expect(result.totalSourceCount).toBe(0)
    expect(result.failureReason).toBe('No sources tracked yet')
  })

  it('returns clean=true when ≥70% of sources active and zero exceptions', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    // Bucket start is 2026-03-25T14:00:00.000Z — sources seen during the hour
    const withinHour = new Date('2026-03-25T14:10:00.000Z').toISOString()

    mockSmembers.mockResolvedValue(['src-1', 'src-2', 'src-3'])
    // All 3 sources active within the hour
    mockHget.mockResolvedValue(withinHour)
    // Zero exceptions
    mockGet.mockResolvedValue(null)

    const result = await evaluateCleanHour(now)

    expect(result.clean).toBe(true)
    expect(result.activeSourceCount).toBe(3)
    expect(result.totalSourceCount).toBe(3)
    expect(result.exceptionCount).toBe(0)
    expect(result.failureReason).toBeNull()
  })

  it('returns clean=false when fewer than 70% of sources are active', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    const withinHour = new Date('2026-03-25T14:10:00.000Z').toISOString()

    mockSmembers.mockResolvedValue(['src-1', 'src-2', 'src-3', 'src-4', 'src-5'])
    // Only 2 of 5 active (40%) — below 70% threshold
    mockHget
      .mockResolvedValueOnce(withinHour)  // src-1 active
      .mockResolvedValueOnce(withinHour)  // src-2 active
      .mockResolvedValueOnce(null)        // src-3 inactive
      .mockResolvedValueOnce(null)        // src-4 inactive
      .mockResolvedValueOnce(null)        // src-5 inactive
    mockGet.mockResolvedValue(null)

    const result = await evaluateCleanHour(now)

    expect(result.clean).toBe(false)
    expect(result.activeSourceCount).toBe(2)
    expect(result.totalSourceCount).toBe(5)
    expect(result.activePercent).toBeLessThan(CLEAN_SOURCE_THRESHOLD)
    expect(result.failureReason).not.toBeNull()
  })

  it('returns clean=false when exceptions > 0 even if sources are fine', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    const withinHour = new Date('2026-03-25T14:10:00.000Z').toISOString()

    mockSmembers.mockResolvedValue(['src-1', 'src-2'])
    // Both sources active — 100%
    mockHget.mockResolvedValue(withinHour)
    // But 2 exceptions occurred
    mockGet.mockResolvedValue('2')

    const result = await evaluateCleanHour(now)

    expect(result.clean).toBe(false)
    expect(result.activeSourceCount).toBe(2)
    expect(result.exceptionCount).toBe(2)
    expect(result.failureReason).toContain('2 unhandled exception')
  })
})

// ─── runStabilityCheck ───────────────────────────────────────────────────────

describe('runStabilityCheck', () => {
  beforeEach(clearMocks)

  it('increments CONSECUTIVE_CLEAN_HOURS on a clean hour and sets status=degraded when streak < 336', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    const withinHour = new Date('2026-03-25T14:10:00.000Z').toISOString()

    mockSmembers.mockResolvedValue(['src-1'])
    mockHget.mockResolvedValue(withinHour)
    mockGet.mockResolvedValue(null) // zero exceptions
    mockIncr.mockResolvedValue(10)  // streak = 10 (< 336)

    await runStabilityCheck(now)

    expect(mockIncr).toHaveBeenCalledWith('scraper:stability:consecutive_clean_hours')
    expect(mockSet).toHaveBeenCalledWith('scraper:stability:status', 'degraded')
  })

  it('sets status=stable when streak reaches 336', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    const withinHour = new Date('2026-03-25T14:10:00.000Z').toISOString()

    mockSmembers.mockResolvedValue(['src-1'])
    mockHget.mockResolvedValue(withinHour)
    mockGet.mockResolvedValue(null)
    mockIncr.mockResolvedValue(TARGET_HOURS) // exactly at target

    await runStabilityCheck(now)

    expect(mockSet).toHaveBeenCalledWith('scraper:stability:status', 'stable')
  })

  it('resets CONSECUTIVE_CLEAN_HOURS to 0 on a failed hour, sets LAST_FAILURE_AT, sets STATUS=failed', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')

    // No sources → evaluateCleanHour returns clean=false
    mockSmembers.mockResolvedValue([])
    mockGet.mockResolvedValue(null)

    await runStabilityCheck(now)

    const setCalls = mockSet.mock.calls as [string, string][]
    const streakReset = setCalls.find(([k]) => k === 'scraper:stability:consecutive_clean_hours')
    const failureSet  = setCalls.find(([k]) => k === 'scraper:stability:last_failure_at')
    const statusSet   = setCalls.find(([k]) => k === 'scraper:stability:status')

    expect(streakReset).toBeDefined()
    expect(streakReset![1]).toBe('0')

    expect(failureSet).toBeDefined()
    expect(failureSet![1]).toBe(now.toISOString())

    expect(statusSet).toBeDefined()
    expect(statusSet![1]).toBe('failed')

    // incr should NOT be called on a failed hour
    expect(mockIncr).not.toHaveBeenCalled()
  })
})

// ─── getStabilityState ───────────────────────────────────────────────────────

describe('getStabilityState', () => {
  beforeEach(clearMocks)

  it('returns safe defaults when no data exists in Redis', async () => {
    mockGet.mockResolvedValue(null)

    const state = await getStabilityState()

    expect(state.consecutive_clean_hours).toBe(0)
    expect(state.target_hours).toBe(TARGET_HOURS)
    expect(state.percent_to_gate).toBe(0)
    expect(state.status).toBe('degraded')
    expect(state.last_failure_at).toBeNull()
    expect(state.estimated_gate_clear_date).not.toBeNull()
  })

  it('returns correct percent_to_gate for a partial streak', async () => {
    // get is called for streak, last_failure_at, status — in order
    mockGet
      .mockResolvedValueOnce('168') // 168 clean hours = 50%
      .mockResolvedValueOnce(null)  // last_failure_at
      .mockResolvedValueOnce('degraded') // status

    const state = await getStabilityState()

    expect(state.consecutive_clean_hours).toBe(168)
    expect(state.percent_to_gate).toBe(50)
    expect(state.status).toBe('degraded')
  })

  it('caps percent_to_gate at 100 and sets a past/present estimated_gate_clear_date when at target', async () => {
    mockGet
      .mockResolvedValueOnce(String(TARGET_HOURS))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('stable')

    const state = await getStabilityState()

    expect(state.percent_to_gate).toBe(100)
    expect(state.status).toBe('stable')
    // estimated date should be essentially now (hoursRemaining = 0)
    const diff = Date.now() - new Date(state.estimated_gate_clear_date!).getTime()
    expect(diff).toBeGreaterThanOrEqual(0)
    expect(diff).toBeLessThan(5000) // within 5 seconds
  })

  it('returns all required fields', async () => {
    mockGet
      .mockResolvedValueOnce('24')
      .mockResolvedValueOnce('2026-03-24T10:00:00.000Z')
      .mockResolvedValueOnce('failed')

    const state = await getStabilityState()

    expect(state).toHaveProperty('consecutive_clean_hours', 24)
    expect(state).toHaveProperty('target_hours', TARGET_HOURS)
    expect(state).toHaveProperty('percent_to_gate')
    expect(state).toHaveProperty('status', 'failed')
    expect(state).toHaveProperty('last_failure_at', '2026-03-24T10:00:00.000Z')
    expect(state).toHaveProperty('estimated_gate_clear_date')
  })
})
