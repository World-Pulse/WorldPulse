/**
 * Tests for apps/scraper/src/health.ts
 *
 * Covers: recordSuccess, recordFailure, getSourceHealth, getAllHealth,
 *         detectDeadSources, logHealthSummary, and the computeStatus logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Redis pipeline mock ──────────────────────────────────────────────────────
const pipelineMock = {
  hset:    vi.fn().mockReturnThis(),
  hincrby: vi.fn().mockReturnThis(),
  sadd:    vi.fn().mockReturnThis(),
  exec:    vi.fn().mockResolvedValue([]),
}

const redisMock = {
  pipeline:  vi.fn(() => pipelineMock),
  hgetall:   vi.fn(),
  smembers:  vi.fn(),
}

const loggerMock = {
  info:  vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

vi.mock('../lib/redis.js',   () => ({ redis: redisMock }))
vi.mock('../lib/logger.js',  () => ({ logger: loggerMock }))

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build the raw Redis hash that getSourceHealth would read for a source. */
function rawHash(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    source_name:   'Test Source',
    source_slug:   'test-source',
    last_seen:     new Date().toISOString(),
    last_attempt:  new Date().toISOString(),
    last_error:    '',
    success_count: '10',
    error_count:   '2',
    latency_ms:    '250',
    ...overrides,
  }
}

// ─── recordSuccess ────────────────────────────────────────────────────────────
describe('recordSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-attach pipeline mock after clear
    pipelineMock.hset.mockReturnThis()
    pipelineMock.hincrby.mockReturnThis()
    pipelineMock.sadd.mockReturnThis()
    pipelineMock.exec.mockResolvedValue([])
    redisMock.pipeline.mockReturnValue(pipelineMock)
  })

  it('calls hset with source fields and timestamps', async () => {
    const { recordSuccess } = await import('../health.js')
    await recordSuccess('src-1', 'Test Source', 'test-source', 123)

    expect(pipelineMock.hset).toHaveBeenCalledWith(
      'scraper:health:src-1',
      expect.objectContaining({
        source_name:  'Test Source',
        source_slug:  'test-source',
        latency_ms:   123,
      }),
    )
  })

  it('increments success_count', async () => {
    const { recordSuccess } = await import('../health.js')
    await recordSuccess('src-1', 'Test Source', 'test-source')
    expect(pipelineMock.hincrby).toHaveBeenCalledWith('scraper:health:src-1', 'success_count', 1)
  })

  it('adds sourceId to the health index set', async () => {
    const { recordSuccess } = await import('../health.js')
    await recordSuccess('src-2', 'Another Source', 'another-source')
    expect(pipelineMock.sadd).toHaveBeenCalledWith('scraper:health:index', 'src-2')
  })

  it('omits latency_ms field when not provided', async () => {
    const { recordSuccess } = await import('../health.js')
    await recordSuccess('src-3', 'No Latency', 'no-latency')

    const hsetArgs = pipelineMock.hset.mock.calls[0]
    const fields = hsetArgs[1] as Record<string, unknown>
    expect(fields).not.toHaveProperty('latency_ms')
  })

  it('executes the pipeline', async () => {
    const { recordSuccess } = await import('../health.js')
    await recordSuccess('src-4', 'X', 'x')
    expect(pipelineMock.exec).toHaveBeenCalledTimes(1)
  })
})

// ─── recordPollHeartbeat ──────────────────────────────────────────────────────
describe('recordPollHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pipelineMock.hset.mockReturnThis()
    pipelineMock.hincrby.mockReturnThis()
    pipelineMock.sadd.mockReturnThis()
    pipelineMock.exec.mockResolvedValue([])
    redisMock.pipeline.mockReturnValue(pipelineMock)
  })

  it('updates last_seen and last_attempt without incrementing success_count', async () => {
    const { recordPollHeartbeat } = await import('../health.js')
    await recordPollHeartbeat('src-hb', 'HB Source', 'hb-source')

    expect(pipelineMock.hset).toHaveBeenCalledWith(
      'scraper:health:src-hb',
      expect.objectContaining({
        source_name:         'HB Source',
        source_slug:         'hb-source',
        last_cycle_articles: 0,
      }),
    )
    const successIncrements = (pipelineMock.hincrby.mock.calls as unknown[][])
      .filter(c => c[1] === 'success_count')
    expect(successIncrements).toHaveLength(0)
  })

  it('includes latency_ms when provided', async () => {
    const { recordPollHeartbeat } = await import('../health.js')
    await recordPollHeartbeat('src-hb', 'HB Source', 'hb-source', 88)
    expect(pipelineMock.hset).toHaveBeenCalledWith(
      'scraper:health:src-hb',
      expect.objectContaining({ latency_ms: 88 }),
    )
  })

  it('adds sourceId to the health index set', async () => {
    const { recordPollHeartbeat } = await import('../health.js')
    await recordPollHeartbeat('src-hb2', 'HB2', 'hb2')
    expect(pipelineMock.sadd).toHaveBeenCalledWith('scraper:health:index', 'src-hb2')
  })

  it('executes the pipeline', async () => {
    const { recordPollHeartbeat } = await import('../health.js')
    await recordPollHeartbeat('src-hb3', 'HB3', 'hb3')
    expect(pipelineMock.exec).toHaveBeenCalledTimes(1)
  })
})

// ─── recordFailure ────────────────────────────────────────────────────────────
describe('recordFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pipelineMock.hset.mockReturnThis()
    pipelineMock.hincrby.mockReturnThis()
    pipelineMock.sadd.mockReturnThis()
    pipelineMock.exec.mockResolvedValue([])
    redisMock.pipeline.mockReturnValue(pipelineMock)
  })

  it('calls hset with error fields', async () => {
    const { recordFailure } = await import('../health.js')
    await recordFailure('src-10', 'Bad Source', 'bad-source', 'ECONNREFUSED')

    expect(pipelineMock.hset).toHaveBeenCalledWith(
      'scraper:health:src-10',
      expect.objectContaining({
        source_name: 'Bad Source',
        source_slug: 'bad-source',
        last_error:  'ECONNREFUSED',
      }),
    )
  })

  it('increments error_count', async () => {
    const { recordFailure } = await import('../health.js')
    await recordFailure('src-10', 'Bad Source', 'bad-source', 'timeout')
    expect(pipelineMock.hincrby).toHaveBeenCalledWith('scraper:health:src-10', 'error_count', 1)
  })

  it('truncates error strings longer than 500 chars', async () => {
    const { recordFailure } = await import('../health.js')
    const longError = 'x'.repeat(600)
    await recordFailure('src-11', 'X', 'x', longError)

    const hsetArgs = pipelineMock.hset.mock.calls[0]
    const fields = hsetArgs[1] as Record<string, unknown>
    expect((fields['last_error'] as string).length).toBe(500)
  })
})

// ─── getScraperThroughput ─────────────────────────────────────────────────────
describe('getScraperThroughput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zero values when throughput key is empty', async () => {
    redisMock.hgetall.mockResolvedValue({})
    const { getScraperThroughput } = await import('../health.js')
    const t = await getScraperThroughput()
    expect(t.totalArticles).toBe(0)
    expect(t.lastCycleArticles).toBe(0)
    expect(t.lastCycleMs).toBeNull()
    expect(t.lastCycleAt).toBeNull()
  })

  it('parses stored numeric fields correctly', async () => {
    redisMock.hgetall.mockResolvedValue({
      total_articles:      '9999',
      last_cycle_articles: '42',
      last_cycle_ms:       '1500',
      last_cycle_at:       '2025-03-01T12:00:00.000Z',
    })
    const { getScraperThroughput } = await import('../health.js')
    const t = await getScraperThroughput()
    expect(t.totalArticles).toBe(9999)
    expect(t.lastCycleArticles).toBe(42)
    expect(t.lastCycleMs).toBe(1500)
    expect(t.lastCycleAt).toBe('2025-03-01T12:00:00.000Z')
  })
})

// ─── getSourceHealth ──────────────────────────────────────────────────────────
describe('getSourceHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns unknown status when no data exists in Redis', async () => {
    redisMock.hgetall.mockResolvedValue({})
    const { getSourceHealth } = await import('../health.js')
    const health = await getSourceHealth('src-99')
    expect(health.status).toBe('unknown')
    expect(health.successCount).toBe(0)
    expect(health.errorCount).toBe(0)
  })

  it('returns healthy status for a recently-seen source with good rate', async () => {
    redisMock.hgetall.mockResolvedValue(rawHash())
    const { getSourceHealth } = await import('../health.js')
    const health = await getSourceHealth('src-1')
    expect(health.status).toBe('healthy')
    expect(health.successRate).toBeCloseTo(10 / 12, 3)
  })

  it('returns failed status when success rate < 50% with ≥5 attempts', async () => {
    redisMock.hgetall.mockResolvedValue(rawHash({
      success_count: '2',
      error_count:   '8',
      last_seen:     new Date().toISOString(),
    }))
    const { getSourceHealth } = await import('../health.js')
    const health = await getSourceHealth('src-2')
    expect(health.status).toBe('failed')
  })

  it('returns stale status when last_seen is older than 30 minutes', async () => {
    const oldTime = new Date(Date.now() - 31 * 60 * 1_000).toISOString()
    redisMock.hgetall.mockResolvedValue(rawHash({
      last_seen:    oldTime,
      last_attempt: new Date().toISOString(),
    }))
    const { getSourceHealth } = await import('../health.js')
    const health = await getSourceHealth('src-3')
    expect(health.status).toBe('stale')
  })

  it('parses latency_ms as integer', async () => {
    redisMock.hgetall.mockResolvedValue(rawHash({ latency_ms: '450' }))
    const { getSourceHealth } = await import('../health.js')
    const health = await getSourceHealth('src-4')
    expect(health.latencyMs).toBe(450)
  })

  it('returns null latencyMs when field is absent', async () => {
    const { latency_ms: _removed, ...noLatency } = rawHash()
    redisMock.hgetall.mockResolvedValue(noLatency)
    const { getSourceHealth } = await import('../health.js')
    const health = await getSourceHealth('src-5')
    expect(health.latencyMs).toBeNull()
  })

  it('falls back to sourceId for name/slug when fields are missing', async () => {
    redisMock.hgetall.mockResolvedValue({})
    const { getSourceHealth } = await import('../health.js')
    const health = await getSourceHealth('mystery-src')
    expect(health.sourceName).toBe('mystery-src')
    expect(health.sourceSlug).toBe('mystery-src')
  })
})

// ─── getAllHealth ─────────────────────────────────────────────────────────────
describe('getAllHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an empty array when the index set is empty', async () => {
    redisMock.smembers.mockResolvedValue([])
    const { getAllHealth } = await import('../health.js')
    expect(await getAllHealth()).toEqual([])
  })

  it('returns one entry per source in the index', async () => {
    redisMock.smembers.mockResolvedValue(['src-a', 'src-b'])
    redisMock.hgetall.mockResolvedValue(rawHash())
    const { getAllHealth } = await import('../health.js')
    const results = await getAllHealth()
    expect(results).toHaveLength(2)
  })
})

// ─── detectDeadSources ────────────────────────────────────────────────────────
describe('detectDeadSources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array and does not warn when no sources are stale', async () => {
    redisMock.smembers.mockResolvedValue(['src-alive'])
    redisMock.hgetall.mockResolvedValue(rawHash())  // recently seen → healthy
    const { detectDeadSources } = await import('../health.js')
    const stale = await detectDeadSources()
    expect(stale).toEqual([])
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('returns stale source ids and logs a warning', async () => {
    const oldTime = new Date(Date.now() - 35 * 60 * 1_000).toISOString()
    redisMock.smembers.mockResolvedValue(['src-stale'])
    redisMock.hgetall.mockResolvedValue(rawHash({
      last_seen:    oldTime,
      last_attempt: new Date().toISOString(),
    }))
    const { detectDeadSources } = await import('../health.js')
    const stale = await detectDeadSources()
    expect(stale).toEqual(['src-stale'])
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ staleSources: expect.any(Array) }),
      expect.stringContaining('Dead-source detection'),
    )
  })
})

// ─── logHealthSummary ─────────────────────────────────────────────────────────
describe('logHealthSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs "no sources tracked yet" when index is empty', async () => {
    redisMock.smembers.mockResolvedValue([])
    const { logHealthSummary } = await import('../health.js')
    await logHealthSummary()
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining('no sources tracked yet'),
    )
  })

  it('logs a summary object with correct counts', async () => {
    redisMock.smembers.mockResolvedValue(['src-1', 'src-2', 'src-3'])

    // src-1: healthy
    // src-2: dead (old last_seen)
    // src-3: degraded (low success rate)
    const oldTime = new Date(Date.now() - 35 * 60 * 1_000).toISOString()
    redisMock.hgetall
      .mockResolvedValueOnce(rawHash())                                      // healthy
      .mockResolvedValueOnce(rawHash({ last_seen: oldTime }))               // dead
      .mockResolvedValueOnce(rawHash({ success_count: '1', error_count: '9' })) // degraded

    const { logHealthSummary } = await import('../health.js')
    await logHealthSummary()

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        total:   3,
        healthy: 1,
        stale:   1,
      }),
      expect.stringContaining('Scraper health summary'),
    )
  })

  it('logs an error and returns gracefully when Redis throws', async () => {
    redisMock.smembers.mockRejectedValue(new Error('Redis down'))
    const { logHealthSummary } = await import('../health.js')
    await expect(logHealthSummary()).resolves.toBeUndefined()
    expect(loggerMock.error).toHaveBeenCalled()
  })
})
