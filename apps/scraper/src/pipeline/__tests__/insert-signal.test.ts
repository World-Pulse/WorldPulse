/**
 * Tests for the shared insertAndCorrelate() helper.
 *
 * Verifies that:
 *  1. Signals are inserted into the DB
 *  2. correlateSignal() is called with the correct CorrelationCandidate shape
 *  3. Correlation errors don't prevent signal insertion from succeeding
 *  4. recordSuccess() is called for health tracking after each successful insert
 *  5. Health tracking failures are non-fatal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockInsert = vi.fn()
const mockReturning = vi.fn()
vi.mock('../../lib/postgres', () => ({
  db: vi.fn(() => ({
    insert: (data: unknown) => {
      mockInsert(data)
      return { returning: (cols: string) => {
        mockReturning(cols)
        return [{ id: 'sig-001', title: 'Test Signal', category: 'conflict', severity: 'high', reliability_score: 0.85, location_name: 'Kyiv', tags: ['ukraine', 'conflict'], event_time: new Date('2026-03-24T12:00:00Z'), created_at: new Date() }]
      }}
    },
  })),
}))

const mockCorrelateSignal = vi.fn()
vi.mock('../correlate', () => ({
  correlateSignal: (...args: unknown[]) => mockCorrelateSignal(...args),
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Redis mock — prevents real connection attempts during tests
vi.mock('../../lib/redis', () => ({
  redis: {
    publish: vi.fn().mockResolvedValue(0),
  },
}))

// Health mock — spy on recordSuccess calls
const mockRecordSuccess = vi.fn().mockResolvedValue(undefined)
vi.mock('../../health', () => ({
  recordSuccess: (...args: unknown[]) => mockRecordSuccess(...args),
}))

import { insertAndCorrelate } from '../insert-signal'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('insertAndCorrelate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCorrelateSignal.mockResolvedValue(null)    // No cluster by default
    mockRecordSuccess.mockResolvedValue(undefined) // Health tracking succeeds
  })

  it('inserts a signal into the database and returns it', async () => {
    const signalData = {
      title: 'Test Signal',
      category: 'conflict',
      severity: 'high',
      reliability_score: 0.85,
    }
    const meta = { lat: 50.45, lng: 30.52, sourceId: 'source-001' }

    const result = await insertAndCorrelate(signalData, meta)

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining(signalData))
    expect(mockReturning).toHaveBeenCalledWith('*')
    expect(result).toBeDefined()
    expect(result.id).toBe('sig-001')
  })

  it('calls correlateSignal with correct CorrelationCandidate shape', async () => {
    const signalData = {
      title: 'Earthquake M6.2',
      category: 'science',
      severity: 'high',
    }
    const meta = { lat: 35.6, lng: 139.7, sourceId: 'usgs-seismic' }

    await insertAndCorrelate(signalData, meta)

    expect(mockCorrelateSignal).toHaveBeenCalledTimes(1)
    const candidate = mockCorrelateSignal.mock.calls[0][0]
    expect(candidate.id).toBe('sig-001')
    expect(candidate.title).toBe('Test Signal') // from mock DB return
    expect(candidate.lat).toBe(35.6)
    expect(candidate.lng).toBe(139.7)
    expect(candidate.source_id).toBe('usgs-seismic')
    expect(Array.isArray(candidate.tags)).toBe(true)
  })

  it('returns signal even when correlation throws', async () => {
    mockCorrelateSignal.mockRejectedValue(new Error('Redis connection lost'))

    const signalData = { title: 'Test', category: 'health', severity: 'medium' }
    const meta = { sourceId: 'who-feed' }

    const result = await insertAndCorrelate(signalData, meta)

    // Signal was still inserted and returned
    expect(result).toBeDefined()
    expect(result.id).toBe('sig-001')
    // Correlation was attempted
    expect(mockCorrelateSignal).toHaveBeenCalledTimes(1)
  })

  it('handles null lat/lng gracefully', async () => {
    const signalData = { title: 'Global Alert', category: 'security', severity: 'critical' }
    const meta = { sourceId: 'cisa-kev' }

    await insertAndCorrelate(signalData, meta)

    const candidate = mockCorrelateSignal.mock.calls[0][0]
    expect(candidate.lat).toBeNull()
    expect(candidate.lng).toBeNull()
  })

  it('logs cluster info when correlation succeeds', async () => {
    const { logger } = await import('../../lib/logger')

    mockCorrelateSignal.mockResolvedValue({
      cluster_id: 'cluster-001',
      signal_ids: ['sig-001', 'sig-002'],
      correlation_type: 'geo_temporal',
      correlation_score: 0.78,
    })

    const signalData = { title: 'Tsunami Warning', category: 'weather', severity: 'critical' }
    const meta = { lat: 35.0, lng: 140.0, sourceId: 'noaa-tsunami' }

    await insertAndCorrelate(signalData, meta)

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        signalId: 'sig-001',
        clusterId: 'cluster-001',
        clusterSize: 2,
      }),
      expect.stringContaining('correlated'),
    )
  })

  // ─── Health tracking tests ─────────────────────────────────────────────────

  it('calls recordSuccess after a successful insert', async () => {
    const signalData = { title: 'Test', category: 'conflict', severity: 'low' }
    const meta = { sourceId: 'gdelt', lat: null, lng: null }

    await insertAndCorrelate(signalData, meta)

    // Allow the non-blocking recordSuccess promise to settle
    await vi.runAllTimersAsync().catch(() => {})
    // Flush microtasks
    await Promise.resolve()

    expect(mockRecordSuccess).toHaveBeenCalledOnce()
    expect(mockRecordSuccess).toHaveBeenCalledWith('gdelt', 'gdelt', 'gdelt', undefined, 1)
  })

  it('uses sourceName and sourceSlug from meta when provided', async () => {
    const signalData = { title: 'Earthquake', category: 'science', severity: 'medium' }
    const meta = {
      sourceId:   'usgs-seismic',
      sourceName: 'USGS Seismic Monitor',
      sourceSlug: 'usgs-seismic',
      lat: 35.6,
      lng: 139.7,
    }

    await insertAndCorrelate(signalData, meta)
    await Promise.resolve()

    expect(mockRecordSuccess).toHaveBeenCalledWith(
      'usgs-seismic',
      'USGS Seismic Monitor',
      'usgs-seismic',
      undefined,
      1,
    )
  })

  it('falls back to sourceId for sourceName and sourceSlug when not provided', async () => {
    const signalData = { title: 'Cyber Alert', category: 'security', severity: 'high' }
    const meta = { sourceId: 'cisa-kev' }

    await insertAndCorrelate(signalData, meta)
    await Promise.resolve()

    const [sid, sname, sslug] = mockRecordSuccess.mock.calls[0] as string[]
    expect(sid).toBe('cisa-kev')
    expect(sname).toBe('cisa-kev')
    expect(sslug).toBe('cisa-kev')
  })

  it('returns the inserted signal even when recordSuccess rejects', async () => {
    mockRecordSuccess.mockRejectedValue(new Error('Redis down'))

    const signalData = { title: 'Health Alert', category: 'health', severity: 'medium' }
    const meta = { sourceId: 'who-feed' }

    const result = await insertAndCorrelate(signalData, meta)

    // Signal insertion succeeded despite health tracking failure
    expect(result).toBeDefined()
    expect(result.id).toBe('sig-001')
  })

  // ─── Map live-pin tests (lat/lng in Redis pub/sub payload) ─────────────────

  it('includes lat/lng in the Redis pub/sub payload when meta provides coordinates', async () => {
    const { redis } = await import('../../lib/redis')
    const mockPublish = vi.mocked(redis.publish)

    const signalData = {
      title: 'Earthquake M6.2 near Tokyo',
      category: 'science',
      severity: 'critical',   // FLASH tier — always published
      reliability_score: 0.9,
    }
    const meta = { lat: 35.6762, lng: 139.6503, sourceId: 'usgs-seismic' }

    await insertAndCorrelate(signalData, meta)
    await Promise.resolve()

    expect(mockPublish).toHaveBeenCalled()
    const publishCall = mockPublish.mock.calls.find(
      ([ch]) => ch === 'wp:signal.new',
    )
    expect(publishCall).toBeDefined()
    const payload = JSON.parse(publishCall![1] as string) as { event: string; payload: Record<string, unknown> }
    expect(payload.payload.lat).toBe(35.6762)
    expect(payload.payload.lng).toBe(139.6503)
  })

  it('omits lat/lng from payload when meta has no coordinates', async () => {
    const { redis } = await import('../../lib/redis')
    const mockPublish = vi.mocked(redis.publish)

    const signalData = {
      title: 'CISA Advisory: Critical Infrastructure Vulnerability',
      category: 'security',
      severity: 'critical',
      reliability_score: 0.95,
    }
    const meta = { sourceId: 'cisa-kev' }  // no lat/lng

    await insertAndCorrelate(signalData, meta)
    await Promise.resolve()

    const publishCall = mockPublish.mock.calls.find(
      ([ch]) => ch === 'wp:signal.new',
    )
    expect(publishCall).toBeDefined()
    const payload = JSON.parse(publishCall![1] as string) as { payload: Record<string, unknown> }
    expect(payload.payload.lat).toBeUndefined()
    expect(payload.payload.lng).toBeUndefined()
  })

  it('publishes ROUTINE (low-severity) signals to Redis for real-time map updates', async () => {
    const { redis } = await import('../../lib/redis')
    const mockPublish = vi.mocked(redis.publish)

    const signalData = {
      title: 'Minor flooding reported in rural area',
      category: 'climate',
      severity: 'low',
      reliability_score: 0.4,
    }
    const meta = { lat: 12.5, lng: 42.3, sourceId: 'reliefweb' }

    await insertAndCorrelate(signalData, meta)
    await Promise.resolve()

    // ALL signals must be published — not just FLASH/PRIORITY
    const publishCall = mockPublish.mock.calls.find(([ch]) => ch === 'wp:signal.new')
    expect(publishCall).toBeDefined()
    const payload = JSON.parse(publishCall![1] as string) as { event: string; payload: Record<string, unknown> }
    expect(payload.event).toBe('signal.new')
    // severity comes from the mock DB return ('high') — what matters is publish() is called unconditionally
    expect(payload.payload.id).toBe('sig-001')
    expect(payload.payload.lat).toBe(12.5)
    expect(payload.payload.lng).toBe(42.3)
  })

  it('omits lat/lng when coordinates are non-finite (prevents corrupt map pins)', async () => {
    const { redis } = await import('../../lib/redis')
    const mockPublish = vi.mocked(redis.publish)

    const signalData = {
      title: 'Space Weather Alert',
      category: 'space',
      severity: 'critical',
      reliability_score: 0.8,
    }
    const meta = { lat: NaN, lng: Infinity, sourceId: 'noaa-space-weather' }

    await insertAndCorrelate(signalData, meta)
    await Promise.resolve()

    const publishCall = mockPublish.mock.calls.find(
      ([ch]) => ch === 'wp:signal.new',
    )
    expect(publishCall).toBeDefined()
    const payload = JSON.parse(publishCall![1] as string) as { payload: Record<string, unknown> }
    expect(payload.payload.lat).toBeUndefined()
    expect(payload.payload.lng).toBeUndefined()
  })
})
