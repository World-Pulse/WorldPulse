/**
 * scraper-stability.test.ts
 *
 * Comprehensive tests for the Gate 1 stability tracker.
 *
 * Tests cover:
 *  - currentHourBucket() output format
 *  - evaluateCleanHour() — source activity threshold, exception gating, edge cases
 *  - runStabilityCheck() — streak increment, reset, status transitions
 *  - getStabilityState() — defaults, percent_to_gate, estimated_gate_clear_date
 *  - recordUnhandledException() / getExceptionCountForHour()
 *  - Redis key naming contracts
 *  - Full scenario: multi-hour streak then failure resets to 0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Redis before any module imports ──────────────────────────────────────
const redisMock: Record<string, string | number> = {}
const redisSets: Record<string, Set<string>> = {}

const mockRedis = {
  get:      vi.fn(async (key: string) => redisMock[key]?.toString() ?? null),
  set:      vi.fn(async (key: string, val: string | number) => { redisMock[key] = String(val); return 'OK' }),
  setex:    vi.fn(async (key: string, _ttl: number, val: string) => { redisMock[key] = val; return 'OK' }),
  incr:     vi.fn(async (key: string) => {
    redisMock[key] = (parseInt(String(redisMock[key] ?? '0'), 10) + 1)
    return redisMock[key] as number
  }),
  expire:   vi.fn(async () => 1),
  smembers: vi.fn(async (key: string) => [...(redisSets[key] ?? new Set<string>())]),
  hget:     vi.fn(async (_key: string, _field: string) => null as string | null),
  pipeline: vi.fn(() => ({
    incr:   vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec:   vi.fn(async () => []),
  })),
}

vi.mock('../db/redis', () => ({ redis: mockRedis }))

// Import after mocks are in place
const {
  currentHourBucket,
  evaluateCleanHour,
  runStabilityCheck,
  getStabilityState,
  recordUnhandledException,
  getExceptionCountForHour,
  STABILITY_KEYS,
  TARGET_HOURS,
  CLEAN_SOURCE_THRESHOLD,
} = await import('../../../../../../apps/scraper/src/lib/stability-tracker')

// Silence logger noise during tests
vi.mock('../../../../../../apps/scraper/src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─────────────────────────────────────────────────────────────────────────────

function resetRedis() {
  Object.keys(redisMock).forEach(k => delete redisMock[k])
  Object.keys(redisSets).forEach(k => delete redisSets[k])
  vi.clearAllMocks()
  // Re-bind vi.fn() return values after clearAllMocks
  mockRedis.get.mockImplementation(async (key: string) => redisMock[key]?.toString() ?? null)
  mockRedis.set.mockImplementation(async (key: string, val: string | number) => { redisMock[key] = String(val); return 'OK' })
  mockRedis.setex.mockImplementation(async (key: string, _ttl: number, val: string) => { redisMock[key] = val; return 'OK' })
  mockRedis.incr.mockImplementation(async (key: string) => {
    redisMock[key] = (parseInt(String(redisMock[key] ?? '0'), 10) + 1)
    return redisMock[key] as number
  })
  mockRedis.expire.mockResolvedValue(1)
  mockRedis.smembers.mockImplementation(async (key: string) => [...(redisSets[key] ?? new Set<string>())])
  mockRedis.hget.mockResolvedValue(null)
  mockRedis.pipeline.mockImplementation(() => ({
    incr:   vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec:   vi.fn(async () => []),
  }))
}

beforeEach(() => resetRedis())
afterEach(() => resetRedis())

// ─── Constants & key format ───────────────────────────────────────────────────

describe('STABILITY_KEYS', () => {
  it('consecutive_clean_hours key matches expected format', () => {
    expect(STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS).toBe('scraper:stability:consecutive_clean_hours')
  })

  it('last_failure_at key matches expected format', () => {
    expect(STABILITY_KEYS.LAST_FAILURE_AT).toBe('scraper:stability:last_failure_at')
  })

  it('status key matches expected format', () => {
    expect(STABILITY_KEYS.STATUS).toBe('scraper:stability:status')
  })

  it('exceptions prefix starts with scraper:stability:exceptions:', () => {
    expect(STABILITY_KEYS.EXCEPTIONS_PREFIX).toBe('scraper:stability:exceptions:')
  })

  it('TARGET_HOURS equals 336 (14 days × 24h)', () => {
    expect(TARGET_HOURS).toBe(336)
  })

  it('CLEAN_SOURCE_THRESHOLD equals 0.70', () => {
    expect(CLEAN_SOURCE_THRESHOLD).toBe(0.70)
  })
})

// ─── currentHourBucket ───────────────────────────────────────────────────────

describe('currentHourBucket()', () => {
  it('returns a 13-character ISO string (YYYY-MM-DDTHH)', () => {
    const bucket = currentHourBucket(new Date('2026-03-25T14:32:00.000Z'))
    expect(bucket).toBe('2026-03-25T14')
    expect(bucket).toHaveLength(13)
  })

  it('truncates minutes and seconds', () => {
    const bucket = currentHourBucket(new Date('2026-03-25T09:59:59.999Z'))
    expect(bucket).toBe('2026-03-25T09')
  })
})

// ─── evaluateCleanHour ───────────────────────────────────────────────────────

describe('evaluateCleanHour()', () => {
  it('returns clean=false when no sources are tracked', async () => {
    mockRedis.smembers.mockResolvedValueOnce([])
    const result = await evaluateCleanHour()
    expect(result.clean).toBe(false)
    expect(result.totalSourceCount).toBe(0)
    expect(result.failureReason).toMatch(/no sources/i)
  })

  it('returns clean=true when 100% of sources are active within the hour', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce(['s1', 's2', 's3'])
    // All three sources seen within the current hour
    mockRedis.hget
      .mockResolvedValueOnce('2026-03-25T14:10:00.000Z') // s1
      .mockResolvedValueOnce('2026-03-25T14:20:00.000Z') // s2
      .mockResolvedValueOnce('2026-03-25T14:25:00.000Z') // s3
    mockRedis.get.mockResolvedValueOnce(null) // no exceptions

    const result = await evaluateCleanHour(now)
    expect(result.clean).toBe(true)
    expect(result.activeSourceCount).toBe(3)
    expect(result.totalSourceCount).toBe(3)
    expect(result.failureReason).toBeNull()
  })

  it('returns clean=true at exactly the 70% threshold', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    // 7 of 10 sources active = 70%
    const sourceIds = ['s1','s2','s3','s4','s5','s6','s7','s8','s9','s10']
    mockRedis.smembers.mockResolvedValueOnce(sourceIds)

    for (let i = 0; i < 7; i++) {
      mockRedis.hget.mockResolvedValueOnce('2026-03-25T14:01:00.000Z') // active
    }
    for (let i = 0; i < 3; i++) {
      mockRedis.hget.mockResolvedValueOnce('2026-03-25T13:00:00.000Z') // previous hour → inactive
    }
    mockRedis.get.mockResolvedValueOnce(null) // no exceptions

    const result = await evaluateCleanHour(now)
    expect(result.clean).toBe(true)
    expect(result.activePercent).toBeCloseTo(0.70)
  })

  it('returns clean=false when only 69% of sources are active', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    // 69 of 100 sources active
    const sourceIds = Array.from({ length: 100 }, (_, i) => `s${i}`)
    mockRedis.smembers.mockResolvedValueOnce(sourceIds)

    for (let i = 0; i < 69; i++) {
      mockRedis.hget.mockResolvedValueOnce('2026-03-25T14:01:00.000Z')
    }
    for (let i = 0; i < 31; i++) {
      mockRedis.hget.mockResolvedValueOnce('2026-03-25T13:00:00.000Z')
    }
    mockRedis.get.mockResolvedValueOnce(null)

    const result = await evaluateCleanHour(now)
    expect(result.clean).toBe(false)
    expect(result.failureReason).toMatch(/69\.0%/)
  })

  it('returns clean=false when sources pass threshold but there are exceptions', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce(['s1', 's2'])
    mockRedis.hget
      .mockResolvedValueOnce('2026-03-25T14:01:00.000Z')
      .mockResolvedValueOnce('2026-03-25T14:02:00.000Z')
    mockRedis.get.mockResolvedValueOnce('2') // 2 exceptions

    const result = await evaluateCleanHour(now)
    expect(result.clean).toBe(false)
    expect(result.exceptionCount).toBe(2)
    expect(result.failureReason).toMatch(/2 unhandled exception/)
  })

  it('sources seen in a previous hour do not count as active', async () => {
    const now = new Date('2026-03-25T14:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce(['s1', 's2'])
    // Both sources were seen 2 hours ago
    mockRedis.hget
      .mockResolvedValueOnce('2026-03-25T12:59:00.000Z')
      .mockResolvedValueOnce('2026-03-25T13:00:00.000Z')
    mockRedis.get.mockResolvedValueOnce(null)

    const result = await evaluateCleanHour(now)
    expect(result.activeSourceCount).toBe(0)
    expect(result.clean).toBe(false)
  })
})

// ─── runStabilityCheck ───────────────────────────────────────────────────────

describe('runStabilityCheck()', () => {
  function setupActiveHour(now: Date, sourceCount: number, allActive = true) {
    const sourceIds = Array.from({ length: sourceCount }, (_, i) => `src-${i}`)
    mockRedis.smembers.mockResolvedValue(sourceIds)

    const hourBucket = `${now.toISOString().slice(0, 13)}`
    const activeTs   = `${hourBucket}:10:00.000Z`
    const staleTs    = `${now.toISOString().slice(0, 10)}T${String(now.getUTCHours() - 2).padStart(2, '0')}:00:00.000Z`

    mockRedis.hget.mockResolvedValue(allActive ? activeTs : staleTs)
    mockRedis.get.mockResolvedValue(null) // no exceptions
  }

  it('increments consecutive_clean_hours on a clean hour', async () => {
    const now = new Date('2026-03-25T10:30:00.000Z')
    setupActiveHour(now, 10, true)

    await runStabilityCheck(now)

    expect(mockRedis.incr).toHaveBeenCalledWith(STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS)
  })

  it('sets status to "degraded" when streak < 336', async () => {
    const now = new Date('2026-03-25T10:30:00.000Z')
    setupActiveHour(now, 10, true)
    redisMock[STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS] = '41' // will become 42 after incr

    await runStabilityCheck(now)

    expect(redisMock[STABILITY_KEYS.STATUS]).toBe('degraded')
  })

  it('sets status to "stable" when streak reaches 336', async () => {
    const now = new Date('2026-03-25T10:30:00.000Z')
    setupActiveHour(now, 10, true)
    // Pre-set so incr will produce exactly 336
    redisMock[STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS] = '335'

    await runStabilityCheck(now)

    expect(redisMock[STABILITY_KEYS.STATUS]).toBe('stable')
  })

  it('resets consecutive_clean_hours to 0 on a failed hour', async () => {
    const now = new Date('2026-03-25T10:30:00.000Z')
    redisMock[STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS] = '100'
    mockRedis.smembers.mockResolvedValueOnce([]) // no sources → fails

    await runStabilityCheck(now)

    expect(redisMock[STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS]).toBe('0')
  })

  it('sets last_failure_at on a failed hour', async () => {
    const now = new Date('2026-03-25T10:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce([])

    await runStabilityCheck(now)

    expect(redisMock[STABILITY_KEYS.LAST_FAILURE_AT]).toBe(now.toISOString())
  })

  it('sets status to "failed" on a failed hour', async () => {
    const now = new Date('2026-03-25T10:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce([])

    await runStabilityCheck(now)

    expect(redisMock[STABILITY_KEYS.STATUS]).toBe('failed')
  })

  it('does not update last_failure_at on a clean hour', async () => {
    const now = new Date('2026-03-25T10:30:00.000Z')
    setupActiveHour(now, 3, true)

    await runStabilityCheck(now)

    expect(redisMock[STABILITY_KEYS.LAST_FAILURE_AT]).toBeUndefined()
  })
})

// ─── getStabilityState ───────────────────────────────────────────────────────

describe('getStabilityState()', () => {
  it('returns defaults when Redis has no data', async () => {
    mockRedis.get.mockResolvedValue(null)

    const state = await getStabilityState()
    expect(state.consecutive_clean_hours).toBe(0)
    expect(state.target_hours).toBe(336)
    expect(state.percent_to_gate).toBe(0)
    expect(state.status).toBe('degraded')
    expect(state.last_failure_at).toBeNull()
  })

  it('calculates percent_to_gate correctly at 0 hours', async () => {
    mockRedis.get
      .mockResolvedValueOnce('0')    // streak
      .mockResolvedValueOnce(null)   // last_failure_at
      .mockResolvedValueOnce(null)   // status

    const state = await getStabilityState()
    expect(state.percent_to_gate).toBe(0)
  })

  it('calculates percent_to_gate correctly at 168 hours (50%)', async () => {
    mockRedis.get
      .mockResolvedValueOnce('168')  // 168 / 336 = 50%
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('degraded')

    const state = await getStabilityState()
    expect(state.percent_to_gate).toBe(50)
  })

  it('caps percent_to_gate at 100 when streak exceeds target', async () => {
    mockRedis.get
      .mockResolvedValueOnce('400') // more than 336
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('stable')

    const state = await getStabilityState()
    expect(state.percent_to_gate).toBe(100)
  })

  it('estimated_gate_clear_date is in the future when streak < 336', async () => {
    mockRedis.get
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('degraded')

    const before = Date.now()
    const state  = await getStabilityState()
    const clearMs = new Date(state.estimated_gate_clear_date!).getTime()

    expect(clearMs).toBeGreaterThan(before)
    // Should be roughly (336 - 100) * 3600 * 1000 ms in the future (±10s tolerance)
    const expectedMs = before + (336 - 100) * 3_600_000
    expect(Math.abs(clearMs - expectedMs)).toBeLessThan(10_000)
  })

  it('estimated_gate_clear_date is now (or past) when streak >= 336', async () => {
    mockRedis.get
      .mockResolvedValueOnce('336')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('stable')

    const before = Date.now()
    const state  = await getStabilityState()
    const clearMs = new Date(state.estimated_gate_clear_date!).getTime()

    expect(clearMs).toBeGreaterThanOrEqual(before - 1000) // allow 1 s of drift
    expect(clearMs).toBeLessThanOrEqual(before + 1000)
  })

  it('reflects last_failure_at from Redis', async () => {
    const ts = '2026-03-25T08:00:00.000Z'
    mockRedis.get
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce(ts)
      .mockResolvedValueOnce('failed')

    const state = await getStabilityState()
    expect(state.last_failure_at).toBe(ts)
  })

  it('reflects status from Redis', async () => {
    mockRedis.get
      .mockResolvedValueOnce('50')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('stable')

    const state = await getStabilityState()
    expect(state.status).toBe('stable')
  })
})

// ─── recordUnhandledException / getExceptionCountForHour ─────────────────────

describe('recordUnhandledException()', () => {
  it('increments the exception counter via pipeline', async () => {
    const pipelineMock = { incr: vi.fn().mockReturnThis(), expire: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) }
    mockRedis.pipeline.mockReturnValueOnce(pipelineMock)

    await recordUnhandledException('TypeError: Cannot read property')

    expect(pipelineMock.incr).toHaveBeenCalledOnce()
    const key: string = pipelineMock.incr.mock.calls[0][0]
    expect(key).toMatch(/^scraper:stability:exceptions:/)
    expect(pipelineMock.expire).toHaveBeenCalledWith(key, 2 * 3_600)
    expect(pipelineMock.exec).toHaveBeenCalledOnce()
  })
})

describe('getExceptionCountForHour()', () => {
  it('returns 0 when no exceptions recorded', async () => {
    mockRedis.get.mockResolvedValueOnce(null)
    const count = await getExceptionCountForHour('2026-03-25T10')
    expect(count).toBe(0)
  })

  it('returns the correct count when exceptions exist', async () => {
    mockRedis.get.mockResolvedValueOnce('3')
    const count = await getExceptionCountForHour('2026-03-25T10')
    expect(count).toBe(3)
  })
})

// ─── Full scenario: multi-hour streak then failure ────────────────────────────

describe('Full stability scenario', () => {
  it('accumulates streak across clean hours then resets on failure', async () => {
    // Hour 1 — clean
    const h1 = new Date('2026-03-25T10:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce(['src-1', 'src-2', 'src-3'])
    mockRedis.hget
      .mockResolvedValueOnce('2026-03-25T10:05:00.000Z')
      .mockResolvedValueOnce('2026-03-25T10:10:00.000Z')
      .mockResolvedValueOnce('2026-03-25T10:15:00.000Z')
    mockRedis.get.mockResolvedValueOnce(null) // no exceptions
    await runStabilityCheck(h1)
    expect(redisMock[STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS]).toBe(1)

    // Hour 2 — clean
    const h2 = new Date('2026-03-25T11:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce(['src-1', 'src-2', 'src-3'])
    mockRedis.hget
      .mockResolvedValueOnce('2026-03-25T11:05:00.000Z')
      .mockResolvedValueOnce('2026-03-25T11:10:00.000Z')
      .mockResolvedValueOnce('2026-03-25T11:15:00.000Z')
    mockRedis.get.mockResolvedValueOnce(null)
    await runStabilityCheck(h2)
    expect(redisMock[STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS]).toBe(2)
    expect(redisMock[STABILITY_KEYS.STATUS]).toBe('degraded')

    // Hour 3 — FAIL (no sources)
    const h3 = new Date('2026-03-25T12:30:00.000Z')
    mockRedis.smembers.mockResolvedValueOnce([])
    await runStabilityCheck(h3)
    expect(redisMock[STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS]).toBe('0')
    expect(redisMock[STABILITY_KEYS.STATUS]).toBe('failed')
    expect(redisMock[STABILITY_KEYS.LAST_FAILURE_AT]).toBe(h3.toISOString())
  })
})
