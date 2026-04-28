/**
 * Tests for retry, circuit-breaker, rate-limiter, and DLQ modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── SHARED REDIS MOCK ────────────────────────────────────────────────────────
const redisMock = {
  hget:             vi.fn(),
  hgetall:          vi.fn(),
  hset:             vi.fn(),
  hsetnx:           vi.fn(),
  hincrby:          vi.fn(),
  hdel:             vi.fn(),
  expire:           vi.fn(),
  pexpire:          vi.fn(),
  del:              vi.fn(),
  incr:             vi.fn(),
  lpush:            vi.fn(),
  rpop:             vi.fn(),
  llen:             vi.fn(),
  lrange:           vi.fn(),
  ltrim:            vi.fn(),
  zadd:             vi.fn(),
  zcard:            vi.fn(),
  zrange:           vi.fn(),
  zremrangebyscore: vi.fn(),
  pipeline:         vi.fn(),
}

vi.mock('../redis.js', () => ({ redis: redisMock }))
vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── withRetry ────────────────────────────────────────────────────────────────
describe('withRetry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately on first success', async () => {
    const { withRetry } = await import('../retry.js')
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { delays: [] })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and resolves when fn eventually succeeds', async () => {
    const { withRetry } = await import('../retry.js')
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('recovered')
    const result = await withRetry(fn, { delays: [0, 0] })
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws RetryExhaustedError after exhausting all retries', async () => {
    const { withRetry, RetryExhaustedError } = await import('../retry.js')
    const fn = vi.fn().mockRejectedValue(new Error('permanent'))
    await expect(withRetry(fn, { delays: [0, 0, 0] })).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('RetryExhaustedError carries attempt count', async () => {
    const { withRetry, RetryExhaustedError } = await import('../retry.js')
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    try {
      await withRetry(fn, { delays: [0, 0] })
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError)
      expect((err as InstanceType<typeof RetryExhaustedError>).attempts).toBe(3)
    }
  })

  it('does NOT retry when shouldRetry returns false', async () => {
    const { withRetry } = await import('../retry.js')
    const fn = vi.fn().mockRejectedValue(new Error('not found'))
    const shouldRetry = vi.fn().mockReturnValue(false)
    await expect(withRetry(fn, { delays: [0, 0], shouldRetry })).rejects.toThrow('not found')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on non-transient HTTP 4xx errors by default', async () => {
    const { withRetry } = await import('../retry.js')
    const err404 = Object.assign(new Error('HTTP 404 Not Found'), { statusCode: 404 })
    const fn = vi.fn().mockRejectedValue(err404)
    await expect(withRetry(fn, { delays: [0, 0] })).rejects.toThrow('HTTP 404 Not Found')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on 5xx errors (transient)', async () => {
    const { withRetry } = await import('../retry.js')
    const err502 = Object.assign(new Error('HTTP 502 Bad Gateway'), { statusCode: 502 })
    const fn = vi.fn()
      .mockRejectedValueOnce(err502)
      .mockResolvedValue('ok')
    const result = await withRetry(fn, { delays: [0] })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('aborts pending retry when AbortSignal fires', async () => {
    const { withRetry } = await import('../retry.js')
    const controller = new AbortController()
    let calls = 0
    const fn = vi.fn().mockImplementation(() => {
      calls++
      controller.abort()
      return Promise.reject(new Error('fail'))
    })
    await expect(
      withRetry(fn, { delays: [100], signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  it('accepts legacy array form for backwards compatibility', async () => {
    const { withRetry } = await import('../retry.js')
    const fn = vi.fn().mockResolvedValue('legacy')
    const result = await withRetry(fn, [])
    expect(result).toBe('legacy')
  })

  it('uses default 3-retry schedule when no options given', async () => {
    const { withRetry } = await import('../retry.js')
    vi.useFakeTimers()
    let calls = 0
    const fn = vi.fn().mockImplementation(() => {
      calls++
      if (calls < 4) return Promise.reject(new Error('fail'))
      return Promise.resolve('done')
    })
    const promise = withRetry(fn)
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe('done')
    expect(fn).toHaveBeenCalledTimes(4)
  })
})

// ─── isNonTransientHttpError ───────────────────────────────────────────────────
describe('isNonTransientHttpError', () => {
  it('returns true for statusCode 404', async () => {
    const { isNonTransientHttpError } = await import('../retry.js')
    const err = Object.assign(new Error('not found'), { statusCode: 404 })
    expect(isNonTransientHttpError(err)).toBe(true)
  })

  it('returns true for message containing "status code 4"', async () => {
    const { isNonTransientHttpError } = await import('../retry.js')
    expect(isNonTransientHttpError(new Error('Request failed with status code 403'))).toBe(true)
  })

  it('returns false for 5xx', async () => {
    const { isNonTransientHttpError } = await import('../retry.js')
    const err = Object.assign(new Error('server error'), { statusCode: 503 })
    expect(isNonTransientHttpError(err)).toBe(false)
  })

  it('returns false for non-Error values', async () => {
    const { isNonTransientHttpError } = await import('../retry.js')
    expect(isNonTransientHttpError('string error')).toBe(false)
    expect(isNonTransientHttpError(null)).toBe(false)
  })
})

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
describe('circuit breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isCircuitOpen returns false when no state in Redis', async () => {
    redisMock.hget.mockResolvedValue(null)
    const { isCircuitOpen } = await import('../circuit-breaker.js')
    expect(await isCircuitOpen('src-1')).toBe(false)
  })

  it('isCircuitOpen returns false when open_until is in the past', async () => {
    redisMock.hget.mockResolvedValue(String(Date.now() - 1_000))
    const { isCircuitOpen } = await import('../circuit-breaker.js')
    expect(await isCircuitOpen('src-1')).toBe(false)
  })

  it('isCircuitOpen returns true when open_until is in the future', async () => {
    redisMock.hget.mockResolvedValue(String(Date.now() + 600_000))
    const { isCircuitOpen } = await import('../circuit-breaker.js')
    expect(await isCircuitOpen('src-2')).toBe(true)
  })

  it('cbSuccess deletes the Redis key', async () => {
    redisMock.hgetall.mockResolvedValue({})
    redisMock.del.mockResolvedValue(1)
    const { cbSuccess } = await import('../circuit-breaker.js')
    await cbSuccess('src-3')
    expect(redisMock.del).toHaveBeenCalledWith('scraper:cb:src-3')
  })

  it('cbFailure opens circuit after 5th consecutive failure', async () => {
    redisMock.hgetall.mockResolvedValue({ failures: '4', open_until: '0', open_count: '0' })
    redisMock.hincrby.mockResolvedValue(5)
    redisMock.hset.mockResolvedValue(1)
    redisMock.expire.mockResolvedValue(1)
    const { cbFailure } = await import('../circuit-breaker.js')
    await cbFailure('src-4', 'Test Source')
    expect(redisMock.hset).toHaveBeenCalled()
    expect(redisMock.expire).toHaveBeenCalled()
  })

  it('cbFailure does NOT open circuit before reaching threshold', async () => {
    redisMock.hgetall.mockResolvedValue({ failures: '2', open_until: '0', open_count: '0' })
    redisMock.hincrby.mockResolvedValue(3)
    const { cbFailure } = await import('../circuit-breaker.js')
    await cbFailure('src-5', 'Test Source')
    expect(redisMock.hset).not.toHaveBeenCalled()
  })

  it('getCircuitState returns CLOSED when no open_until', async () => {
    redisMock.hgetall.mockResolvedValue({})
    const { getCircuitState, CircuitStatus } = await import('../circuit-breaker.js')
    const state = await getCircuitState('src-6')
    expect(state.status).toBe(CircuitStatus.CLOSED)
    expect(state.failures).toBe(0)
    expect(state.openCount).toBe(0)
  })

  it('getCircuitState returns OPEN when open_until is in the future', async () => {
    const openUntil = Date.now() + 300_000
    redisMock.hgetall.mockResolvedValue({ failures: '5', open_until: String(openUntil), open_count: '1' })
    const { getCircuitState, CircuitStatus } = await import('../circuit-breaker.js')
    const state = await getCircuitState('src-7')
    expect(state.status).toBe(CircuitStatus.OPEN)
    expect(state.failures).toBe(5)
    expect(state.openCount).toBe(1)
  })

  it('getCircuitState returns HALF_OPEN when open_until is in the past', async () => {
    const pastTime = Date.now() - 1_000
    redisMock.hgetall.mockResolvedValue({ failures: '5', open_until: String(pastTime), open_count: '1' })
    const { getCircuitState, CircuitStatus } = await import('../circuit-breaker.js')
    const state = await getCircuitState('src-8')
    expect(state.status).toBe(CircuitStatus.HALF_OPEN)
  })

  it('acquireProbeSlot returns true when HSETNX succeeds', async () => {
    const pastTime = Date.now() - 1_000
    redisMock.hgetall.mockResolvedValue({ open_until: String(pastTime), failures: '5', open_count: '1' })
    redisMock.hsetnx.mockResolvedValue(1)
    const { acquireProbeSlot } = await import('../circuit-breaker.js')
    expect(await acquireProbeSlot('src-9')).toBe(true)
  })

  it('acquireProbeSlot returns false when probe slot already taken', async () => {
    const pastTime = Date.now() - 1_000
    redisMock.hgetall.mockResolvedValue({ open_until: String(pastTime), failures: '5', open_count: '1', probe_taken: '1' })
    redisMock.hsetnx.mockResolvedValue(0)
    const { acquireProbeSlot } = await import('../circuit-breaker.js')
    expect(await acquireProbeSlot('src-10')).toBe(false)
  })

  it('acquireProbeSlot returns false when circuit is not HALF_OPEN', async () => {
    redisMock.hgetall.mockResolvedValue({})  // CLOSED
    const { acquireProbeSlot } = await import('../circuit-breaker.js')
    expect(await acquireProbeSlot('src-11')).toBe(false)
  })

  it('cbFailure in HALF_OPEN re-opens with doubled backoff', async () => {
    const pastTime = Date.now() - 1_000
    redisMock.hgetall.mockResolvedValue({
      failures: '5', open_until: String(pastTime), open_count: '1', probe_taken: '1'
    })
    redisMock.hset.mockResolvedValue(1)
    redisMock.hdel.mockResolvedValue(1)
    redisMock.expire.mockResolvedValue(1)
    const { cbFailure } = await import('../circuit-breaker.js')
    await cbFailure('src-12', 'Test Source')
    // Should update open_count to 2 (doubling the backoff)
    const hsetCall = redisMock.hset.mock.calls[0]
    const openCountIdx = hsetCall.indexOf('open_count')
    expect(hsetCall[openCountIdx + 1]).toBe('2')
    // probe_taken should be cleared
    expect(redisMock.hdel).toHaveBeenCalledWith('scraper:cb:src-12', 'probe_taken')
  })
})

// ─── Dead-Letter Queue ────────────────────────────────────────────────────────
describe('dlq', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pushDLQ calls LPUSH with serialised entry', async () => {
    redisMock.lpush.mockResolvedValue(1)
    const { pushDLQ } = await import('../dlq.js')
    const entry = {
      feedUrl:    'https://example.com/rss',
      sourceId:   'src-1',
      sourceName: 'Example',
      error:      'ECONNREFUSED',
      attempts:   4,
      failedAt:   '2026-03-21T00:00:00.000Z',
    }
    await pushDLQ(entry)
    expect(redisMock.lpush).toHaveBeenCalledWith('scraper:dlq', JSON.stringify(entry))
  })

  it('pushDLQ trims the list when over MAX_DLQ_SIZE', async () => {
    redisMock.lpush.mockResolvedValue(1001)
    redisMock.ltrim.mockResolvedValue('OK')
    const { pushDLQ } = await import('../dlq.js')
    await pushDLQ({
      feedUrl: 'https://example.com/rss', sourceId: 's', sourceName: 'S',
      error: 'err', attempts: 1, failedAt: new Date().toISOString(),
    })
    expect(redisMock.ltrim).toHaveBeenCalledWith('scraper:dlq', 0, 999)
  })

  it('pushDLQ does NOT trim when under limit', async () => {
    redisMock.lpush.mockResolvedValue(10)
    const { pushDLQ } = await import('../dlq.js')
    await pushDLQ({
      feedUrl: 'https://example.com/rss', sourceId: 's', sourceName: 'S',
      error: 'err', attempts: 1, failedAt: new Date().toISOString(),
    })
    expect(redisMock.ltrim).not.toHaveBeenCalled()
  })

  it('popDLQ returns null when queue is empty', async () => {
    redisMock.rpop.mockResolvedValue(null)
    const { popDLQ } = await import('../dlq.js')
    expect(await popDLQ()).toBeNull()
  })

  it('popDLQ deserialises and returns an entry', async () => {
    const entry = {
      feedUrl: 'https://example.com/rss', sourceId: 'src-1', sourceName: 'Example',
      error: 'timeout', attempts: 4, failedAt: '2026-03-21T00:00:00.000Z',
    }
    redisMock.rpop.mockResolvedValue(JSON.stringify(entry))
    const { popDLQ } = await import('../dlq.js')
    expect(await popDLQ()).toEqual(entry)
  })

  it('dlqLength returns the list length', async () => {
    redisMock.llen.mockResolvedValue(7)
    const { dlqLength } = await import('../dlq.js')
    expect(await dlqLength()).toBe(7)
  })

  it('peekDLQ returns up to n entries without removing', async () => {
    const entries = [
      { feedUrl: 'https://a.com/rss', sourceId: '1', sourceName: 'A', error: 'e', attempts: 1, failedAt: '2026-01-01T00:00:00.000Z' },
      { feedUrl: 'https://b.com/rss', sourceId: '2', sourceName: 'B', error: 'e', attempts: 2, failedAt: '2026-01-01T00:00:00.000Z' },
    ]
    redisMock.lrange.mockResolvedValue(entries.map(e => JSON.stringify(e)))
    const { peekDLQ } = await import('../dlq.js')
    const result = await peekDLQ(2)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(entries[0])
    expect(redisMock.rpop).not.toHaveBeenCalled()
  })

  it('peekDLQ filters out malformed entries', async () => {
    redisMock.lrange.mockResolvedValue(['{bad json', '{"feedUrl":"ok","sourceId":"1","sourceName":"S","error":"e","attempts":1,"failedAt":"2026-01-01T00:00:00.000Z"}'])
    const { peekDLQ } = await import('../dlq.js')
    const result = await peekDLQ(5)
    expect(result).toHaveLength(1)
  })

  it('drainDLQ pops multiple entries via pipeline', async () => {
    const entry = { feedUrl: 'https://x.com/rss', sourceId: '1', sourceName: 'X', error: 'err', attempts: 1, failedAt: '2026-01-01T00:00:00.000Z' }
    const mockPipeline = {
      rpop: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, JSON.stringify(entry)],
        [null, JSON.stringify(entry)],
        [null, null],
      ]),
    }
    redisMock.pipeline.mockReturnValue(mockPipeline)
    const { drainDLQ } = await import('../dlq.js')
    const results = await drainDLQ(3)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual(entry)
  })
})

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
describe('acquireRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('acquires slot when under limit', async () => {
    const mockPipeline = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard:            vi.fn().mockReturnThis(),
      exec:             vi.fn().mockResolvedValue([[null, 0], [null, 1]]),
    }
    redisMock.pipeline.mockReturnValue(mockPipeline)
    redisMock.zadd.mockResolvedValue(1)
    redisMock.pexpire.mockResolvedValue(1)
    const { acquireRateLimit } = await import('../rate-limiter.js')
    await expect(acquireRateLimit('https://example.com/rss')).resolves.toBeUndefined()
    expect(redisMock.zadd).toHaveBeenCalledTimes(1)
  })

  it('waits until slot is free when over limit', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    let call = 0
    const mockPipeline = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard:            vi.fn().mockReturnThis(),
      exec: vi.fn().mockImplementation(() => {
        call++
        // First call: over limit (count = 5 with default limit 1+3=4)
        if (call === 1) return Promise.resolve([[null, 0], [null, 5]])
        // Second call: under limit
        return Promise.resolve([[null, 0], [null, 1]])
      }),
    }
    redisMock.pipeline.mockReturnValue(mockPipeline)
    redisMock.zrange.mockResolvedValue([`${now - 500}:abc`, String(now - 500)])
    redisMock.zadd.mockResolvedValue(1)
    redisMock.pexpire.mockResolvedValue(1)
    const { acquireRateLimit } = await import('../rate-limiter.js')
    const p = acquireRateLimit('https://ratelimited.example.com/feed')
    await vi.runAllTimersAsync()
    await p
    expect(mockPipeline.exec).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('getRateLimitState returns count and limit', async () => {
    redisMock.zremrangebyscore.mockResolvedValue(0)
    redisMock.zcard.mockResolvedValue(2)
    const { getRateLimitState } = await import('../rate-limiter.js')
    const state = await getRateLimitState('https://example.com/rss')
    expect(state.domain).toBe('example.com')
    expect(typeof state.count).toBe('number')
    expect(typeof state.limit).toBe('number')
  })
})
