/**
 * search-consumer.test.ts
 *
 * Unit tests for apps/api/src/lib/search-consumer.ts
 *
 * Coverage:
 *  - startSearchConsumer() creates an interval timer
 *  - stopSearchConsumer() clears the timer
 *  - Calling startSearchConsumer() twice only starts one interval
 *  - The consumer calls syncSignalsSince on each tick
 *  - Timer is cleared by stopSearchConsumer() so no further syncs occur
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const { mockSyncSignalsSince } = vi.hoisted(() => ({
  mockSyncSignalsSince: vi.fn(),
}))

vi.mock('../lib/search-backfill', () => ({
  syncSignalsSince: mockSyncSignalsSince,
}))

vi.mock('../lib/logger', () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ── Import under test ─────────────────────────────────────────────────────────
// Import after mocks are registered
import { startSearchConsumer, stopSearchConsumer } from '../lib/search-consumer'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('startSearchConsumer / stopSearchConsumer', () => {

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockSyncSignalsSince.mockResolvedValue(0)
    // Ensure the consumer is stopped before each test so module-level
    // state from a prior test doesn't leak.
    await stopSearchConsumer()
  })

  afterEach(async () => {
    // Always clean up so timers don't leak between tests
    await stopSearchConsumer()
    vi.useRealTimers()
  })

  it('starts an interval when called', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    await startSearchConsumer()

    expect(setIntervalSpy).toHaveBeenCalledOnce()
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1_000)
  })

  it('calling startSearchConsumer() twice only creates one interval', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    await startSearchConsumer()
    await startSearchConsumer()

    expect(setIntervalSpy).toHaveBeenCalledOnce()
  })

  it('stopSearchConsumer() clears the interval timer', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    await startSearchConsumer()
    await stopSearchConsumer()

    expect(clearIntervalSpy).toHaveBeenCalledOnce()
  })

  it('stopSearchConsumer() is a no-op when consumer is not running', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    // Consumer not started — calling stop should not throw or call clearInterval
    await stopSearchConsumer()

    expect(clearIntervalSpy).not.toHaveBeenCalled()
  })

  it('calls syncSignalsSince on each interval tick', async () => {
    mockSyncSignalsSince.mockResolvedValue(3)

    await startSearchConsumer()

    // Advance time by one tick (5 minutes)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)

    expect(mockSyncSignalsSince).toHaveBeenCalledOnce()
    // The date passed should be approximately 7 minutes in the past
    const since: Date = mockSyncSignalsSince.mock.calls[0][0] as Date
    expect(since).toBeInstanceOf(Date)
    // Allow a few seconds of tolerance
    const expectedMs = Date.now() - 7 * 60 * 1_000
    expect(Math.abs(since.getTime() - expectedMs)).toBeLessThan(5_000)
  })

  it('calls syncSignalsSince on multiple ticks', async () => {
    mockSyncSignalsSince.mockResolvedValue(0)

    await startSearchConsumer()

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)

    expect(mockSyncSignalsSince).toHaveBeenCalledTimes(3)
  })

  it('does not call syncSignalsSince after stopSearchConsumer()', async () => {
    mockSyncSignalsSince.mockResolvedValue(0)

    await startSearchConsumer()
    await stopSearchConsumer()

    // Advance past multiple intervals — no syncs should fire
    await vi.advanceTimersByTimeAsync(20 * 60 * 1_000)

    expect(mockSyncSignalsSince).not.toHaveBeenCalled()
  })

  it('swallows syncSignalsSince errors without crashing', async () => {
    mockSyncSignalsSince.mockRejectedValue(new Error('DB exploded'))

    await startSearchConsumer()

    // Should not throw
    await expect(
      vi.advanceTimersByTimeAsync(5 * 60 * 1_000),
    ).resolves.not.toThrow()
  })

  it('can be restarted after being stopped', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    await startSearchConsumer()
    await stopSearchConsumer()
    await startSearchConsumer()

    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
  })
})
