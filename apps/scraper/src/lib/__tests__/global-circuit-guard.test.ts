/**
 * Tests for global-circuit-guard — aggregate circuit-breaker health view.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Redis mock ───────────────────────────────────────────────────────────────
const redisMock = {
  smembers: vi.fn(),
  hget:     vi.fn(),
  hgetall:  vi.fn(),
}

vi.mock('../redis.js',  () => ({ redis: redisMock }))
vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate Redis state for a CLOSED circuit. */
function mockClosed(sourceId: string) {
  return { sourceId, open_until: '0', failures: '0', open_count: '0' }
}

/** Simulate Redis state for an OPEN circuit (open_until in the future). */
function mockOpen(sourceId: string) {
  return { sourceId, open_until: String(Date.now() + 600_000), failures: '5', open_count: '1' }
}

/** Simulate Redis state for a HALF_OPEN circuit (open_until in the past). */
function mockHalfOpen(sourceId: string) {
  return { sourceId, open_until: String(Date.now() - 1_000), failures: '5', open_count: '1' }
}

/**
 * Set up hgetall so each source ID gets the right mock state.
 * Mirrors how getCircuitState() works: hgetall returns the hash for a given key.
 */
function setupCircuitStates(states: ReturnType<typeof mockClosed>[]) {
  redisMock.hgetall.mockImplementation((key: string) => {
    const sourceId = key.replace('scraper:cb:', '')
    const state = states.find(s => s.sourceId === sourceId)
    if (!state) return Promise.resolve({})
    const { open_until, failures, open_count } = state
    return Promise.resolve({ open_until, failures, open_count })
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('checkGlobalCircuitHealth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns healthy with zeros when health index is empty', async () => {
    redisMock.smembers.mockResolvedValue([])
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.status).toBe('healthy')
    expect(health.totalTracked).toBe(0)
    expect(health.openFraction).toBe(0)
  })

  it('returns unknown when Redis is unavailable', async () => {
    redisMock.smembers.mockRejectedValue(new Error('ECONNREFUSED'))
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.status).toBe('unknown')
  })

  it('returns healthy when all circuits are CLOSED', async () => {
    const sources = ['s1', 's2', 's3', 's4', 's5'].map(mockClosed)
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.status).toBe('healthy')
    expect(health.openCount).toBe(0)
    expect(health.closedCount).toBe(5)
    expect(health.openFraction).toBe(0)
  })

  it('returns healthy when open fraction is below the degraded threshold (< 20%)', async () => {
    // 1 open out of 10 = 10% → healthy
    const sources = [
      mockOpen('s1'),
      ...(['s2','s3','s4','s5','s6','s7','s8','s9','s10'].map(mockClosed)),
    ]
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.status).toBe('healthy')
    expect(health.openCount).toBe(1)
    expect(health.openFraction).toBeCloseTo(0.1)
  })

  it('returns degraded when 20%–39% of circuits are OPEN', async () => {
    // 2 open out of 8 = 25% → degraded
    const sources = [
      mockOpen('s1'), mockOpen('s2'),
      ...(['s3','s4','s5','s6','s7','s8'].map(mockClosed)),
    ]
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.status).toBe('degraded')
    expect(health.openCount).toBe(2)
  })

  it('returns critical when ≥ 40% of circuits are OPEN', async () => {
    // 4 open out of 8 = 50% → critical
    const sources = [
      mockOpen('s1'), mockOpen('s2'), mockOpen('s3'), mockOpen('s4'),
      ...(['s5','s6','s7','s8'].map(mockClosed)),
    ]
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.status).toBe('critical')
    expect(health.openCount).toBe(4)
    expect(health.openFraction).toBeCloseTo(0.5)
  })

  it('counts HALF_OPEN circuits separately from OPEN', async () => {
    // 2 OPEN + 1 HALF_OPEN + 7 CLOSED = 10 total
    // openFraction = 2/10 = 20% → degraded
    const sources = [
      mockOpen('s1'), mockOpen('s2'), mockHalfOpen('s3'),
      ...(['s4','s5','s6','s7','s8','s9','s10'].map(mockClosed)),
    ]
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.halfOpenCount).toBe(1)
    expect(health.openCount).toBe(2)
    expect(health.closedCount).toBe(7)
    // open fraction = 2/10 = 0.2, which is exactly at DEGRADED_THRESHOLD
    expect(health.status).toBe('degraded')
  })

  it('returns healthy when open fraction is exactly below 20% boundary', async () => {
    // 1 OPEN out of 6 = 16.7% → healthy
    const sources = [
      mockOpen('s1'),
      ...(['s2','s3','s4','s5','s6'].map(mockClosed)),
    ]
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    expect(health.status).toBe('healthy')
  })

  it('logs an error for critical status', async () => {
    const { logger } = await import('../logger.js')
    const sources = [
      mockOpen('s1'), mockOpen('s2'), mockOpen('s3'), mockOpen('s4'),
      mockClosed('s5'),
    ]
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    await checkGlobalCircuitHealth()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ openCount: 4 }),
      expect.stringContaining('CRITICAL'),
    )
  })

  it('logs a warning for degraded status', async () => {
    const { logger } = await import('../logger.js')
    const sources = [
      mockOpen('s1'), mockOpen('s2'),
      ...(['s3','s4','s5','s6','s7','s8'].map(mockClosed)),
    ]
    redisMock.smembers.mockResolvedValue(sources.map(s => s.sourceId))
    setupCircuitStates(sources)
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    await checkGlobalCircuitHealth()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ openCount: 2 }),
      expect.stringContaining('DEGRADED'),
    )
  })

  it('tolerates individual getCircuitState failures gracefully', async () => {
    redisMock.smembers.mockResolvedValue(['s1', 's2', 's3'])
    redisMock.hgetall
      .mockResolvedValueOnce({})           // s1 → CLOSED
      .mockRejectedValueOnce(new Error('Redis timeout'))  // s2 → error (skipped)
      .mockResolvedValueOnce({})           // s3 → CLOSED
    const { checkGlobalCircuitHealth } = await import('../global-circuit-guard.js')
    const health = await checkGlobalCircuitHealth()
    // s2 is skipped (null), s1 and s3 are CLOSED
    expect(health.closedCount).toBe(2)
    expect(health.totalTracked).toBe(2)
    expect(health.status).toBe('healthy')
  })
})
