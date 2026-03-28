/**
 * Tests for the shared insertAndCorrelate() helper.
 *
 * Verifies that:
 *  1. Signals are inserted into the DB
 *  2. correlateSignal() is called with the correct CorrelationCandidate shape
 *  3. Correlation errors don't prevent signal insertion from succeeding
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

import { insertAndCorrelate } from '../insert-signal'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('insertAndCorrelate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCorrelateSignal.mockResolvedValue(null) // No cluster by default
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

    expect(mockInsert).toHaveBeenCalledWith(signalData)
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
})
