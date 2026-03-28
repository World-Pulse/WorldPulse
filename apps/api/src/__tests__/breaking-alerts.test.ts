import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ─── Mock redis ─────────────────────────────────────────────────────────────
const mockRedis = {
  exists: vi.fn(),
  setex: vi.fn(),
  zadd: vi.fn(),
  zcard: vi.fn(),
  zremrangebyscore: vi.fn(),
  expire: vi.fn(),
  lpush: vi.fn(),
  ltrim: vi.fn(),
  lrange: vi.fn(),
  del: vi.fn(),
  rpush: vi.fn(),
  publish: vi.fn(),
}

vi.mock('../db/redis', () => ({ redis: mockRedis }))
vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../ws/handler', () => ({ broadcast: vi.fn() }))

import {
  checkAndEmitBreakingAlert,
  getActiveBreakingAlerts,
  dismissBreakingAlert,
  BREAKING_ALERT_RATE_LIMIT,
  BREAKING_ALERT_WINDOW_S,
} from '../lib/breaking-alerts'
import type { SignalInput } from '../lib/breaking-alerts'

// ─── HELPERS ────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    id: 'sig-001',
    title: 'Major earthquake detected',
    category: 'disaster',
    severity: 'critical',
    reliability_score: 0.85,
    location_name: 'Tokyo, Japan',
    country_code: 'JP',
    source_url: 'https://example.com/eq',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe('breaking-alerts constants', () => {
  it('BREAKING_ALERT_RATE_LIMIT equals 8', () => {
    expect(BREAKING_ALERT_RATE_LIMIT).toBe(8)
  })

  it('BREAKING_ALERT_WINDOW_S equals 3600', () => {
    expect(BREAKING_ALERT_WINDOW_S).toBe(3600)
  })
})

describe('checkAndEmitBreakingAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Defaults: no dedup, within rate limit
    mockRedis.exists.mockResolvedValue(0)
    mockRedis.zcard.mockResolvedValue(0)
    mockRedis.zremrangebyscore.mockResolvedValue(0)
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.zadd.mockResolvedValue(1)
    mockRedis.expire.mockResolvedValue(1)
    mockRedis.lpush.mockResolvedValue(1)
    mockRedis.ltrim.mockResolvedValue('OK')
    mockRedis.publish.mockResolvedValue(1)
  })

  it('emits alert for critical severity with high reliability', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ severity: 'critical', reliability_score: 0.9 }))
    // Should have called dedup setex
    expect(mockRedis.setex).toHaveBeenCalled()
    // Should have added to active list
    expect(mockRedis.lpush).toHaveBeenCalled()
    // Should have published to Redis pub/sub
    expect(mockRedis.publish).toHaveBeenCalledWith(
      'wp:alert.trigger',
      expect.stringContaining('alert.breaking'),
    )
  })

  it('emits alert for high severity with sufficient reliability', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ severity: 'high', reliability_score: 0.6 }))
    expect(mockRedis.lpush).toHaveBeenCalled()
  })

  it('skips medium severity signal', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ severity: 'medium' }))
    expect(mockRedis.exists).not.toHaveBeenCalled()
    expect(mockRedis.lpush).not.toHaveBeenCalled()
  })

  it('skips low severity signal', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ severity: 'low' }))
    expect(mockRedis.lpush).not.toHaveBeenCalled()
  })

  it('skips info severity signal', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ severity: 'info' }))
    expect(mockRedis.lpush).not.toHaveBeenCalled()
  })

  it('skips signal with reliability below 0.6', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ reliability_score: 0.59 }))
    expect(mockRedis.lpush).not.toHaveBeenCalled()
  })

  it('skips signal at exactly 0.6 reliability (boundary passes)', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ reliability_score: 0.6 }))
    expect(mockRedis.lpush).toHaveBeenCalled()
  })

  it('skips duplicate signal (dedup key exists)', async () => {
    mockRedis.exists.mockResolvedValue(1)
    await checkAndEmitBreakingAlert(makeSignal())
    expect(mockRedis.lpush).not.toHaveBeenCalled()
  })

  it('skips when rate limit is exceeded', async () => {
    mockRedis.zcard.mockResolvedValue(BREAKING_ALERT_RATE_LIMIT) // at limit
    await checkAndEmitBreakingAlert(makeSignal())
    expect(mockRedis.lpush).not.toHaveBeenCalled()
  })

  it('allows alert when rate count is below limit', async () => {
    mockRedis.zcard.mockResolvedValue(BREAKING_ALERT_RATE_LIMIT - 1)
    await checkAndEmitBreakingAlert(makeSignal())
    expect(mockRedis.lpush).toHaveBeenCalled()
  })

  it('trims active list to max 20 entries', async () => {
    await checkAndEmitBreakingAlert(makeSignal())
    expect(mockRedis.ltrim).toHaveBeenCalledWith('breaking:active', 0, 19)
  })

  it('sets dedup key with 2h TTL', async () => {
    await checkAndEmitBreakingAlert(makeSignal({ id: 'sig-xyz' }))
    expect(mockRedis.setex).toHaveBeenCalledWith('breaking:alert:sig-xyz', 7200, '1')
  })

  it('handles Redis error gracefully (no throw)', async () => {
    mockRedis.exists.mockRejectedValue(new Error('Redis down'))
    // Should NOT throw
    await expect(checkAndEmitBreakingAlert(makeSignal())).resolves.toBeUndefined()
  })
})

describe('getActiveBreakingAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed alerts from Redis list', async () => {
    const alert = {
      alertId: 'a1',
      signalId: 's1',
      title: 'Test',
      severity: 'critical',
      category: 'conflict',
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }
    mockRedis.lrange.mockResolvedValue([JSON.stringify(alert)])
    const result = await getActiveBreakingAlerts()
    expect(result).toHaveLength(1)
    expect(result[0]?.alertId).toBe('a1')
  })

  it('returns empty array when list is empty', async () => {
    mockRedis.lrange.mockResolvedValue([])
    const result = await getActiveBreakingAlerts()
    expect(result).toHaveLength(0)
  })

  it('skips unparseable entries', async () => {
    mockRedis.lrange.mockResolvedValue(['not-json', JSON.stringify({ alertId: 'a2', signalId: 's2', title: 'OK', severity: 'high', category: 'health', timestamp: new Date().toISOString(), expiresAt: new Date().toISOString() })])
    const result = await getActiveBreakingAlerts()
    expect(result).toHaveLength(1)
    expect(result[0]?.alertId).toBe('a2')
  })

  it('returns empty array on Redis error', async () => {
    mockRedis.lrange.mockRejectedValue(new Error('Redis down'))
    const result = await getActiveBreakingAlerts()
    expect(result).toHaveLength(0)
  })
})

describe('dismissBreakingAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis.del.mockResolvedValue(1)
    mockRedis.rpush.mockResolvedValue(1)
    mockRedis.expire.mockResolvedValue(1)
  })

  it('removes the alert from the list', async () => {
    const a1 = JSON.stringify({ alertId: 'dismiss-me', signalId: 's1', title: 'A', severity: 'critical', category: 'conflict', timestamp: new Date().toISOString(), expiresAt: new Date().toISOString() })
    const a2 = JSON.stringify({ alertId: 'keep-me', signalId: 's2', title: 'B', severity: 'high', category: 'health', timestamp: new Date().toISOString(), expiresAt: new Date().toISOString() })
    mockRedis.lrange.mockResolvedValue([a1, a2])

    await dismissBreakingAlert('dismiss-me')

    // Should rebuild list without dismissed alert
    expect(mockRedis.del).toHaveBeenCalledWith('breaking:active')
    expect(mockRedis.rpush).toHaveBeenCalledWith('breaking:active', a2)
  })

  it('deletes list entirely when last alert is dismissed', async () => {
    const a1 = JSON.stringify({ alertId: 'only-one', signalId: 's1', title: 'Solo', severity: 'critical', category: 'conflict', timestamp: new Date().toISOString(), expiresAt: new Date().toISOString() })
    mockRedis.lrange.mockResolvedValue([a1])

    await dismissBreakingAlert('only-one')

    expect(mockRedis.del).toHaveBeenCalledWith('breaking:active')
    expect(mockRedis.rpush).not.toHaveBeenCalled()
  })

  it('handles Redis error gracefully', async () => {
    mockRedis.lrange.mockRejectedValue(new Error('Redis down'))
    await expect(dismissBreakingAlert('any')).resolves.toBeUndefined()
  })
})
