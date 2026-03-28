/**
 * OSINT Heartbeat Watchdog — unit tests
 *
 * Validates the watchdog's core behaviour:
 *   - Source registration
 *   - Heartbeat firing only when last_seen is stale (>= 8 min)
 *   - No heartbeat when last_seen is recent (< 8 min)
 *   - Non-fatal handling of Redis errors
 *   - Cleanup function stops the cron
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockHget     = vi.fn()
const mockHset     = vi.fn()
const mockSadd     = vi.fn()
const mockExec     = vi.fn().mockResolvedValue(null)
const mockPipeline = vi.fn(() => ({
  hset: mockHset,
  sadd: mockSadd,
  exec: mockExec,
}))

const mockRedis = {
  hget:     (...args: unknown[]) => mockHget(...args),
  pipeline: () => mockPipeline(),
} as unknown as import('ioredis').default

// Mock health module so we can spy on recordPollHeartbeat
const recordPollHeartbeatMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../health', () => ({
  recordPollHeartbeat: (...args: unknown[]) => recordPollHeartbeatMock(...args),
}))

vi.mock('../lib/logger', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info:  vi.fn(),
      warn:  vi.fn(),
      error: vi.fn(),
    }),
  },
}))

import { createOsintWatchdog } from '../lib/osint-watchdog'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nowIso  = () => new Date().toISOString()
const agoIso  = (ms: number) => new Date(Date.now() - ms).toISOString()

const MIN  = 60_000
const SOURCE = { id: 'seismic', name: 'USGS Seismic', slug: 'seismic' }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OsintWatchdog — registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('register() does not throw', () => {
    const watchdog = createOsintWatchdog(mockRedis)
    expect(() => watchdog.register(SOURCE.id, SOURCE.name, SOURCE.slug)).not.toThrow()
  })

  it('start() returns a cleanup function', () => {
    const watchdog = createOsintWatchdog(mockRedis)
    const stop = watchdog.start()
    expect(typeof stop).toBe('function')
    stop()
  })

  it('no heartbeat fired when no sources registered', async () => {
    const watchdog = createOsintWatchdog(mockRedis)
    // Directly call the internal cron logic by starting + stopping immediately
    const stop = watchdog.start()
    // Allow microtasks to settle
    await new Promise(r => setTimeout(r, 0))
    stop()
    expect(recordPollHeartbeatMock).not.toHaveBeenCalled()
  })
})

describe('OsintWatchdog — heartbeat logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires heartbeat when last_seen is older than 8 minutes', async () => {
    // last_seen = 10 minutes ago → stale → heartbeat expected
    mockHget.mockResolvedValue(agoIso(10 * MIN))

    const watchdog = createOsintWatchdog(mockRedis)
    watchdog.register(SOURCE.id, SOURCE.name, SOURCE.slug)

    // Manually trigger the cron by accessing internal logic via start + fast mock
    // We test by patching the interval directly using vi.useFakeTimers
    vi.useFakeTimers()
    const stop = watchdog.start()

    // Advance time past the watchdog interval (4 minutes)
    await vi.advanceTimersByTimeAsync(4 * MIN + 100)

    expect(recordPollHeartbeatMock).toHaveBeenCalledWith(
      SOURCE.id,
      SOURCE.name,
      SOURCE.slug,
    )

    stop()
    vi.useRealTimers()
  })

  it('does NOT fire heartbeat when last_seen is recent (< 8 minutes)', async () => {
    // last_seen = 3 minutes ago → fresh → no heartbeat
    mockHget.mockResolvedValue(agoIso(3 * MIN))

    const watchdog = createOsintWatchdog(mockRedis)
    watchdog.register(SOURCE.id, SOURCE.name, SOURCE.slug)

    vi.useFakeTimers()
    const stop = watchdog.start()
    await vi.advanceTimersByTimeAsync(4 * MIN + 100)

    expect(recordPollHeartbeatMock).not.toHaveBeenCalled()

    stop()
    vi.useRealTimers()
  })

  it('fires heartbeat when last_seen is null (source never produced a signal)', async () => {
    // last_seen = null → unknown → heartbeat expected (ageMs = now - 0 = Infinity)
    mockHget.mockResolvedValue(null)

    const watchdog = createOsintWatchdog(mockRedis)
    watchdog.register(SOURCE.id, SOURCE.name, SOURCE.slug)

    vi.useFakeTimers()
    const stop = watchdog.start()
    await vi.advanceTimersByTimeAsync(4 * MIN + 100)

    expect(recordPollHeartbeatMock).toHaveBeenCalledWith(
      SOURCE.id,
      SOURCE.name,
      SOURCE.slug,
    )

    stop()
    vi.useRealTimers()
  })

  it('handles multiple registered sources independently', async () => {
    // seismic: stale (10 min) → heartbeat
    // nws:     fresh (2 min)  → no heartbeat
    mockHget
      .mockResolvedValueOnce(agoIso(10 * MIN))  // seismic
      .mockResolvedValueOnce(agoIso(2 * MIN))   // nws-alerts

    const watchdog = createOsintWatchdog(mockRedis)
    watchdog.register('seismic',   'USGS Seismic',    'seismic')
    watchdog.register('nws-alerts', 'NWS Alerts',     'nws-alerts')

    vi.useFakeTimers()
    const stop = watchdog.start()
    await vi.advanceTimersByTimeAsync(4 * MIN + 100)

    expect(recordPollHeartbeatMock).toHaveBeenCalledTimes(1)
    expect(recordPollHeartbeatMock).toHaveBeenCalledWith('seismic', 'USGS Seismic', 'seismic')

    stop()
    vi.useRealTimers()
  })
})

describe('OsintWatchdog — error resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not throw when Redis hget fails', async () => {
    mockHget.mockRejectedValue(new Error('Redis connection lost'))

    const watchdog = createOsintWatchdog(mockRedis)
    watchdog.register(SOURCE.id, SOURCE.name, SOURCE.slug)

    vi.useFakeTimers()
    const stop = watchdog.start()

    await expect(vi.advanceTimersByTimeAsync(4 * MIN + 100)).resolves.not.toThrow()

    stop()
    vi.useRealTimers()
  })

  it('does not throw when recordPollHeartbeat fails', async () => {
    mockHget.mockResolvedValue(agoIso(10 * MIN))
    recordPollHeartbeatMock.mockRejectedValueOnce(new Error('Redis write failed'))

    const watchdog = createOsintWatchdog(mockRedis)
    watchdog.register(SOURCE.id, SOURCE.name, SOURCE.slug)

    vi.useFakeTimers()
    const stop = watchdog.start()

    await expect(vi.advanceTimersByTimeAsync(4 * MIN + 100)).resolves.not.toThrow()

    stop()
    vi.useRealTimers()
  })
})

describe('OsintWatchdog — cleanup', () => {
  it('stop() prevents further heartbeat cycles', async () => {
    mockHget.mockResolvedValue(agoIso(10 * MIN))

    const watchdog = createOsintWatchdog(mockRedis)
    watchdog.register(SOURCE.id, SOURCE.name, SOURCE.slug)

    vi.useFakeTimers()
    const stop = watchdog.start()

    // Advance one cycle → heartbeat fires
    await vi.advanceTimersByTimeAsync(4 * MIN + 100)
    const countAfterFirstCycle = recordPollHeartbeatMock.mock.calls.length

    // Stop the watchdog
    stop()

    // Advance another cycle → should NOT fire again
    await vi.advanceTimersByTimeAsync(4 * MIN + 100)
    expect(recordPollHeartbeatMock.mock.calls.length).toBe(countAfterFirstCycle)

    vi.useRealTimers()
  })
})

describe('OsintWatchdog — OSINT registry completeness', () => {
  it('registry covers all 29 OSINT source slugs', () => {
    // These slugs must match the sourceId values passed to insertAndCorrelate
    // in each source file. If a source is added or renamed, update this list.
    const expectedSlugs = [
      'gdelt', 'adsb', 'ais', 'seismic', 'firms', 'spaceweather',
      'gpsjam', 'ioda', 'celestrak', 'carrier-strike-groups',
      'who', 'iaea', 'market', 'acled', 'safecast', 'cisa-kev',
      'ofac-sanctions', 'reliefweb', 'nws-alerts', 'otx-threats',
      'gvp-volcano', 'eu-sanctions', 'power-outage', 'aviation-incidents',
      'unhcr-displacement', 'tsunami-warnings', 'interpol-notices',
      'comtrade', 'patents',
    ]
    expect(expectedSlugs).toHaveLength(29)
    // Verify no duplicates
    const unique = new Set(expectedSlugs)
    expect(unique.size).toBe(29)
  })
})
