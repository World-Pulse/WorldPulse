/**
 * Tests for retry, circuit-breaker, rate-limiter, and DLQ modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── SHARED REDIS MOCK ────────────────────────────────────────────────────────
const redisMock = {
  hget:    vi.fn(),
  hgetall: vi.fn(),
  hset:    vi.fn(),
  hincrby: vi.fn(),
  expire:  vi.fn(),
  del:     vi.fn(),
  incr:    vi.fn(),
  lpush:   vi.fn(),
  rpop:    vi.fn(),
  llen:    vi.fn(),
}

vi.mock('../redis.js', () => ({ redis: redisMock }))
vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── withRetry ────────────────────────────────────────────────────────────────
describe('withRetry', () => {
  it('resolves immediately on first success', async () => {
    const { withRetry } = await import('../retry.js')
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, [])
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and resolves when fn eventually succeeds', async () => {
    const { withRetry } = await import('../retry.js')
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('recovered')
    // Use zero-delay schedule to keep tests fast
    const result = await withRetry(fn, [0, 0])
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last error after exhausting all retries', async () => {
    const { withRetry } = await import('../retry.js')
    const fn = vi.fn().mockRejectedValue(new Error('permanent'))
    await expect(withRetry(fn, [0, 0, 0])).rejects.toThrow('permanent')
    // 1 initial + 3 retries = 4 total attempts
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('uses the default 3-retry schedule (1 s, 5 s, 30 s) when no delays arg given', async () => {
    // Verify the module exports the 4-attempt behaviour by checking call count.
    const { withRetry } = await import('../retry.js')
    let calls = 0
    const fn = vi.fn().mockImplementation(() => {
      calls++
      if (calls < 4) throw new Error('fail')
      return Promise.resolve('done')
    })
    // Spy on setTimeout to avoid actually waiting
    vi.useFakeTimers()
    const promise = withRetry(fn)
    // Advance through all delay intervals
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe('done')
    expect(fn).toHaveBeenCalledTimes(4)
    vi.useRealTimers()
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
    redisMock.del.mockResolvedValue(1)
    const { cbSuccess } = await import('../circuit-breaker.js')
    await cbSuccess('src-3')
    expect(redisMock.del).toHaveBeenCalledWith('scraper:cb:src-3')
  })

  it('cbFailure opens circuit after 5th consecutive failure', async () => {
    redisMock.hincrby.mockResolvedValue(5)
    redisMock.hset.mockResolvedValue(1)
    redisMock.expire.mockResolvedValue(1)
    const { cbFailure } = await import('../circuit-breaker.js')
    await cbFailure('src-4', 'Test Source')
    expect(redisMock.hset).toHaveBeenCalled()
    expect(redisMock.expire).toHaveBeenCalled()
  })

  it('cbFailure does NOT open circuit before reaching threshold', async () => {
    redisMock.hincrby.mockResolvedValue(3)
    const { cbFailure } = await import('../circuit-breaker.js')
    await cbFailure('src-5', 'Test Source')
    expect(redisMock.hset).not.toHaveBeenCalled()
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

  it('popDLQ returns null when queue is empty', async () => {
    redisMock.rpop.mockResolvedValue(null)
    const { popDLQ } = await import('../dlq.js')
    expect(await popDLQ()).toBeNull()
  })

  it('popDLQ deserialises and returns an entry', async () => {
    const entry = {
      feedUrl:    'https://example.com/rss',
      sourceId:   'src-1',
      sourceName: 'Example',
      error:      'timeout',
      attempts:   4,
      failedAt:   '2026-03-21T00:00:00.000Z',
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
})

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
describe('acquireRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns immediately when within quota (first request in bucket)', async () => {
    // incr returns 1 → first request in this bucket → slot acquired
    redisMock.incr.mockResolvedValue(1)
    redisMock.expire.mockResolvedValue(1)
    const { acquireRateLimit } = await import('../rate-limiter.js')
    await expect(acquireRateLimit('https://example.com/rss')).resolves.toBeUndefined()
    expect(redisMock.incr).toHaveBeenCalledTimes(1)
  })

  it('waits until next bucket when quota is exceeded', async () => {
    vi.useFakeTimers()
    // First call: over quota (count=2 with RPS=1); second call: new bucket (count=1)
    redisMock.incr
      .mockResolvedValueOnce(2)   // over limit
      .mockResolvedValueOnce(1)   // new bucket — slot acquired
    redisMock.expire.mockResolvedValue(1)
    const { acquireRateLimit } = await import('../rate-limiter.js')
    const p = acquireRateLimit('https://ratelimited.example.com/feed')
    await vi.runAllTimersAsync()
    await p
    expect(redisMock.incr).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
