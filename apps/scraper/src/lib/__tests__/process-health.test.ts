import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.mock factories are hoisted above the imports, so the mocks they use are made in vi.hoisted
const { mockHset, mockPexpire, mockSet, mockLpush, mockLtrim } = vi.hoisted(() => ({
  mockHset:    vi.fn().mockResolvedValue(1),
  mockPexpire: vi.fn().mockResolvedValue(1),
  mockSet:     vi.fn().mockResolvedValue('OK'),
  mockLpush:   vi.fn().mockResolvedValue(1),
  mockLtrim:   vi.fn().mockResolvedValue('OK'),
}))

vi.mock('../redis.js', () => ({
  redis: {
    hset:    mockHset,
    pexpire: mockPexpire,
    set:     mockSet,
    lpush:   mockLpush,
    ltrim:   mockLtrim,
  },
}))

vi.mock('os', () => ({
  default: {
    hostname: vi.fn().mockReturnValue('test-host'),
  },
}))

// Import after mocks are declared
import {
  startHeartbeat,
  stopHeartbeat,
  recordProcessCrash,
  registerCrashHandlers,
} from '../process-health.js'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('startHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockHset.mockClear()
    mockPexpire.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets scraper:process hash with status=running immediately', async () => {
    const timer = startHeartbeat(100)
    // Flush the initial async write
    await vi.advanceTimersByTimeAsync(0)

    expect(mockHset).toHaveBeenCalledWith(
      'scraper:process',
      expect.objectContaining({ status: 'running' }),
    )
    stopHeartbeat(timer)
  })

  it('advances last_heartbeat after one interval tick', async () => {
    const timer = startHeartbeat(100)
    await vi.advanceTimersByTimeAsync(0)

    const firstCall = mockHset.mock.calls[0]![1] as Record<string, string>
    const firstTimestamp = firstCall['last_heartbeat']

    // Advance by one interval
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(0)   // let the tick's async write finish

    const secondCall = mockHset.mock.calls[1]![1] as Record<string, string>
    const secondTimestamp = secondCall['last_heartbeat']

    expect(secondTimestamp).toBeDefined()
    // Timestamps must differ (second tick is later)
    expect(secondTimestamp).not.toBe(firstTimestamp)

    stopHeartbeat(timer)
  })

  // Oct 29, 2026: where the scraper's memory is, and how it grows since its start
  it('adds the memory in MB to scraper:process, and a sample to the history every 5 minutes', async () => {
    mockLpush.mockClear(); mockLtrim.mockClear()
    const timer = startHeartbeat(30_000)
    await vi.advanceTimersByTimeAsync(0)
    const fields = mockHset.mock.calls[0]![1] as Record<string, string>
    for (const k of ['rss_mb', 'heap_used_mb', 'heap_total_mb', 'external_mb', 'array_buffers_mb', 'heap_limit_mb']) {
      expect(Number(fields[k])).toBeGreaterThan(-1)
    }
    expect(Number(fields['heap_limit_mb'])).toBeGreaterThan(0)
    expect(mockLpush).toHaveBeenCalledTimes(1)
    const [key, json] = mockLpush.mock.calls[0]! as [string, string]
    expect(key).toBe('scraper:memory:history')
    const sample = JSON.parse(json)
    expect(sample.started).toBe(fields['started_at'])
    expect(typeof sample.heap_used_mb).toBe('number')
    expect(mockLtrim).toHaveBeenCalledWith('scraper:memory:history', 0, 47)
    // the next heartbeats within 5 minutes add no sample; the one after 5 minutes does
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(mockLpush).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockLpush).toHaveBeenCalledTimes(2)
    stopHeartbeat(timer)
  })

  it('sets TTL via pexpire at intervalMs * 3', async () => {
    const intervalMs = 100
    const timer = startHeartbeat(intervalMs)
    await vi.advanceTimersByTimeAsync(0)

    expect(mockPexpire).toHaveBeenCalledWith('scraper:process', intervalMs * 3)
    stopHeartbeat(timer)
  })
})

describe('stopHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockHset.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the interval so no further writes occur', async () => {
    const timer = startHeartbeat(100)
    await vi.advanceTimersByTimeAsync(0)

    const callsAfterStart = mockHset.mock.calls.length

    stopHeartbeat(timer)

    // Advance past multiple intervals — no new calls expected
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(0)   // let the tick's async write finish

    expect(mockHset.mock.calls.length).toBe(callsAfterStart)
  })
})

describe('recordProcessCrash', () => {
  beforeEach(() => {
    mockHset.mockClear()
    mockSet.mockClear()
  })

  it('sets status=crashed with correct fields in scraper:process hash', async () => {
    await recordProcessCrash('uncaughtException', 'boom', 'Error: boom\n  at foo')

    expect(mockHset).toHaveBeenCalledWith(
      'scraper:process',
      expect.objectContaining({
        status:             'crashed',
        last_crash_type:    'uncaughtException',
        last_crash_message: 'boom',
        last_crash_stack:   'Error: boom\n  at foo',
      }),
    )
  })

  it('sets scraper:last_crash string key with 7-day TTL', async () => {
    await recordProcessCrash('unhandledRejection', 'promise fail', undefined)

    expect(mockSet).toHaveBeenCalledWith(
      'scraper:last_crash',
      expect.stringContaining('"type":"unhandledRejection"'),
      'EX',
      7 * 24 * 60 * 60,
    )
  })
})

describe('registerCrashHandlers', () => {
  it('registers uncaughtException and unhandledRejection listeners on process', () => {
    const beforeUncaught    = process.listenerCount('uncaughtException')
    const beforeUnhandled   = process.listenerCount('unhandledRejection')

    registerCrashHandlers()

    expect(process.listenerCount('uncaughtException')).toBe(beforeUncaught + 1)
    expect(process.listenerCount('unhandledRejection')).toBe(beforeUnhandled + 1)

    // Cleanup — remove the listeners we just added so they don't affect other tests
    const uncaughtListeners  = process.rawListeners('uncaughtException')
    const unhandledListeners = process.rawListeners('unhandledRejection')
    process.removeListener('uncaughtException',  uncaughtListeners[uncaughtListeners.length - 1]  as (...args: unknown[]) => void)
    process.removeListener('unhandledRejection', unhandledListeners[unhandledListeners.length - 1] as (...args: unknown[]) => void)
  })
})
