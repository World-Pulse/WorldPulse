/**
 * Tests for fetchWithResilience — the unified resilience wrapper.
 *
 * Verifies that all six layers of protection are applied in the correct order:
 * 1. Circuit open → CircuitOpenError thrown, fetcher never called
 * 2. HALF_OPEN probe slot taken → CircuitOpenError, fetcher never called
 * 3. HALF_OPEN probe slot free → fetcher allowed through
 * 4. Rate limit acquired before each attempt
 * 5. Retry on transient failure; no retry on 4xx
 * 6. cbSuccess called on success; cbFailure + DLQ push on final failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Shared mocks ─────────────────────────────────────────────────────────────
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

// ─── Helpers to set circuit state ─────────────────────────────────────────────
function mockCircuitClosed() {
  redisMock.hget.mockResolvedValue(null)
  redisMock.hgetall.mockResolvedValue({})
}

function mockCircuitOpen() {
  const openUntil = String(Date.now() + 600_000)
  redisMock.hget.mockResolvedValue(openUntil)
  redisMock.hgetall.mockResolvedValue({ open_until: openUntil, failures: '5', open_count: '1' })
}

function mockCircuitHalfOpen() {
  const pastTime = String(Date.now() - 1_000)
  redisMock.hget.mockResolvedValue(pastTime)
  redisMock.hgetall.mockResolvedValue({ open_until: pastTime, failures: '5', open_count: '1' })
}

function mockRateLimitOk() {
  const pipe = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard:            vi.fn().mockReturnThis(),
    exec:             vi.fn().mockResolvedValue([[null, 0], [null, 0]]),
  }
  redisMock.pipeline.mockReturnValue(pipe)
  redisMock.zadd.mockResolvedValue(1)
  redisMock.pexpire.mockResolvedValue(1)
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('fetchWithResilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Circuit breaker: OPEN ───────────────────────────────────────────────────
  it('throws CircuitOpenError and never calls fetcher when circuit is OPEN', async () => {
    mockCircuitOpen()
    const { fetchWithResilience, CircuitOpenError } = await import('../fetch-with-resilience.js')
    const fetcher = vi.fn()
    await expect(
      fetchWithResilience('src-1', 'Test', 'https://example.com', fetcher)
    ).rejects.toBeInstanceOf(CircuitOpenError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  // ── Circuit breaker: HALF_OPEN, slot taken ──────────────────────────────────
  it('throws CircuitOpenError when HALF_OPEN probe slot is already taken', async () => {
    mockCircuitHalfOpen()
    redisMock.hsetnx.mockResolvedValue(0)  // slot taken
    const { fetchWithResilience, CircuitOpenError } = await import('../fetch-with-resilience.js')
    const fetcher = vi.fn()
    await expect(
      fetchWithResilience('src-2', 'Test', 'https://example.com', fetcher)
    ).rejects.toBeInstanceOf(CircuitOpenError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  // ── Circuit breaker: HALF_OPEN, slot acquired ───────────────────────────────
  it('calls fetcher when HALF_OPEN and probe slot acquired', async () => {
    mockCircuitHalfOpen()
    redisMock.hsetnx.mockResolvedValue(1)  // slot acquired
    mockRateLimitOk()
    redisMock.del.mockResolvedValue(1)  // cbSuccess → del key

    const { fetchWithResilience } = await import('../fetch-with-resilience.js')
    const fetcher = vi.fn().mockResolvedValue('probe-ok')
    const result = await fetchWithResilience('src-3', 'Test', 'https://example.com', fetcher, { retryDelays: [] })
    expect(result).toBe('probe-ok')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(redisMock.del).toHaveBeenCalledWith('scraper:cb:src-3')
  })

  // ── Happy path: CLOSED circuit ──────────────────────────────────────────────
  it('resolves with fetcher result and calls cbSuccess on CLOSED circuit', async () => {
    mockCircuitClosed()
    mockRateLimitOk()
    redisMock.del.mockResolvedValue(1)

    const { fetchWithResilience } = await import('../fetch-with-resilience.js')
    const fetcher = vi.fn().mockResolvedValue({ events: 42 })
    const result = await fetchWithResilience('src-4', 'Test', 'https://api.example.com/data', fetcher, { retryDelays: [] })
    expect(result).toEqual({ events: 42 })
    expect(redisMock.del).toHaveBeenCalledWith('scraper:cb:src-4')
  })

  // ── Retry on transient failure ──────────────────────────────────────────────
  it('retries and succeeds after transient failure', async () => {
    mockCircuitClosed()
    mockRateLimitOk()
    redisMock.del.mockResolvedValue(1)

    const { fetchWithResilience } = await import('../fetch-with-resilience.js')
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue('recovered')

    const result = await fetchWithResilience(
      'src-5', 'Test', 'https://example.com', fetcher,
      { retryDelays: [0] },  // zero delay for test speed
    )
    expect(result).toBe('recovered')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  // ── No retry on 4xx ────────────────────────────────────────────────────────
  it('does not retry on HTTP 4xx error', async () => {
    mockCircuitClosed()
    mockRateLimitOk()
    redisMock.hincrby.mockResolvedValue(1)
    redisMock.hgetall.mockResolvedValue({})  // cbFailure reads state
    redisMock.lpush.mockResolvedValue(1)     // DLQ push

    const { fetchWithResilience } = await import('../fetch-with-resilience.js')
    const err403 = Object.assign(new Error('HTTP 403 Forbidden'), { statusCode: 403 })
    const fetcher = vi.fn().mockRejectedValue(err403)

    await expect(
      fetchWithResilience('src-6', 'Test', 'https://example.com', fetcher, { retryDelays: [0, 0] })
    ).rejects.toThrow('HTTP 403 Forbidden')
    // fetcher called once — no retry
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  // ── cbFailure + DLQ on exhaustion ──────────────────────────────────────────
  it('calls cbFailure and pushes to DLQ when retries exhausted', async () => {
    mockCircuitClosed()
    mockRateLimitOk()
    // cbFailure reads state + increments failures
    redisMock.hgetall.mockResolvedValue({ failures: '2', open_until: '0', open_count: '0' })
    redisMock.hincrby.mockResolvedValue(3)
    redisMock.lpush.mockResolvedValue(1)  // DLQ push

    const { fetchWithResilience, CircuitOpenError } = await import('../fetch-with-resilience.js')
    const fetcher = vi.fn().mockRejectedValue(new Error('upstream down'))

    await expect(
      fetchWithResilience('src-7', 'Failing Source', 'https://down.example.com/feed', fetcher, { retryDelays: [0] })
    ).rejects.toThrow()

    // cbFailure: hincrby called to increment failure count
    expect(redisMock.hincrby).toHaveBeenCalledWith('scraper:cb:src-7', 'failures', 1)

    // DLQ: lpush called with the feed URL and source info
    expect(redisMock.lpush).toHaveBeenCalledWith(
      'scraper:dlq',
      expect.stringContaining('"sourceId":"src-7"'),
    )
    expect(redisMock.lpush).toHaveBeenCalledWith(
      'scraper:dlq',
      expect.stringContaining('"feedUrl":"https://down.example.com/feed"'),
    )
  })

  // ── rateLimit: false ───────────────────────────────────────────────────────
  it('skips rate limiting when rateLimit: false', async () => {
    mockCircuitClosed()
    redisMock.del.mockResolvedValue(1)
    // Do NOT set up redisMock.pipeline — if rate limiter runs it will fail

    const { fetchWithResilience } = await import('../fetch-with-resilience.js')
    const fetcher = vi.fn().mockResolvedValue('ws-data')
    const result = await fetchWithResilience(
      'src-8', 'WS Source', 'wss://example.com/stream', fetcher,
      { retryDelays: [], rateLimit: false },
    )
    expect(result).toBe('ws-data')
    expect(redisMock.pipeline).not.toHaveBeenCalled()
  })

  // ── AbortSignal propagated to withRetry ────────────────────────────────────
  it('aborts in-flight retry when AbortSignal fires', async () => {
    mockCircuitClosed()
    mockRateLimitOk()
    redisMock.hincrby.mockResolvedValue(1)
    redisMock.hgetall.mockResolvedValue({ failures: '0', open_until: '0', open_count: '0' })
    redisMock.lpush.mockResolvedValue(1)

    const controller = new AbortController()
    const { fetchWithResilience } = await import('../fetch-with-resilience.js')

    let calls = 0
    const fetcher = vi.fn().mockImplementation(() => {
      calls++
      controller.abort()
      return Promise.reject(new Error('fail'))
    })

    await expect(
      fetchWithResilience('src-9', 'Test', 'https://example.com', fetcher, {
        retryDelays: [100],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(calls).toBe(1)
  })
})
