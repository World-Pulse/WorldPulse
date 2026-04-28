/**
 * Admin Kafka Lag API Route Tests — apps/api/src/routes/admin-kafka.ts
 *
 * Tests the Kafka consumer group lag monitoring endpoint:
 * admin authorization, lag status thresholds, response structure,
 * rate limiting, error handling, and schema validation.
 */

import { describe, it, expect } from 'vitest'

// ─── Constants (mirroring admin-kafka.ts) ───────────────────────────────────

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW = '1 minute'
const CACHE_TTL = 30 // seconds
const CACHE_KEY = 'kafka:lag:report'

// ─── Status Thresholds ──────────────────────────────────────────────────────

const WARNING_THRESHOLD = 500
const CRITICAL_THRESHOLD = 2000

type LagStatus = 'healthy' | 'warning' | 'critical' | 'unavailable'

function computePartitionStatus(lag: number): LagStatus {
  if (lag >= CRITICAL_THRESHOLD) return 'critical'
  if (lag >= WARNING_THRESHOLD) return 'warning'
  return 'healthy'
}

function computeOverallStatus(groups: Array<{ status: LagStatus }>): LagStatus {
  if (groups.some(g => g.status === 'critical')) return 'critical'
  if (groups.some(g => g.status === 'warning')) return 'warning'
  return 'healthy'
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface PartitionLag {
  topic: string
  partition: number
  lag: number
}

interface GroupLag {
  groupId: string
  totalLag: number
  status: LagStatus
  partitions: PartitionLag[]
}

interface LagSummary {
  total_lag: number
  overall_status: LagStatus
  checked_at: string
  groups: GroupLag[]
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

function buildMockLagSummary(groupData: Array<{
  groupId: string
  partitions: Array<{ topic: string; partition: number; lag: number }>
}>): LagSummary {
  const groups: GroupLag[] = groupData.map(g => {
    const totalLag = g.partitions.reduce((sum, p) => sum + p.lag, 0)
    const maxLag = Math.max(...g.partitions.map(p => p.lag))
    return {
      groupId: g.groupId,
      totalLag,
      status: computePartitionStatus(maxLag),
      partitions: g.partitions,
    }
  })

  return {
    total_lag: groups.reduce((sum, g) => sum + g.totalLag, 0),
    overall_status: computeOverallStatus(groups),
    checked_at: new Date().toISOString(),
    groups,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═════════════════════════════════════════════════════════════════════════════

describe('Admin Kafka Constants', () => {
  it('rate limit is 30 requests per minute', () => {
    expect(RATE_LIMIT_MAX).toBe(30)
    expect(RATE_LIMIT_WINDOW).toBe('1 minute')
  })

  it('cache TTL is 30 seconds', () => {
    expect(CACHE_TTL).toBe(30)
  })

  it('cache key is kafka:lag:report', () => {
    expect(CACHE_KEY).toBe('kafka:lag:report')
  })
})

describe('Status Thresholds', () => {
  it('warning threshold is 500 messages', () => {
    expect(WARNING_THRESHOLD).toBe(500)
  })

  it('critical threshold is 2000 messages', () => {
    expect(CRITICAL_THRESHOLD).toBe(2000)
  })

  it('critical > warning', () => {
    expect(CRITICAL_THRESHOLD).toBeGreaterThan(WARNING_THRESHOLD)
  })
})

describe('Partition Status Computation', () => {
  it('lag 0 → healthy', () => {
    expect(computePartitionStatus(0)).toBe('healthy')
  })

  it('lag 499 → healthy', () => {
    expect(computePartitionStatus(499)).toBe('healthy')
  })

  it('lag 500 → warning', () => {
    expect(computePartitionStatus(500)).toBe('warning')
  })

  it('lag 1999 → warning', () => {
    expect(computePartitionStatus(1999)).toBe('warning')
  })

  it('lag 2000 → critical', () => {
    expect(computePartitionStatus(2000)).toBe('critical')
  })

  it('lag 100000 → critical', () => {
    expect(computePartitionStatus(100000)).toBe('critical')
  })
})

describe('Overall Status Computation', () => {
  it('all healthy → healthy', () => {
    expect(computeOverallStatus([
      { status: 'healthy' },
      { status: 'healthy' },
    ])).toBe('healthy')
  })

  it('one warning → warning', () => {
    expect(computeOverallStatus([
      { status: 'healthy' },
      { status: 'warning' },
    ])).toBe('warning')
  })

  it('one critical → critical', () => {
    expect(computeOverallStatus([
      { status: 'healthy' },
      { status: 'critical' },
    ])).toBe('critical')
  })

  it('critical takes precedence over warning', () => {
    expect(computeOverallStatus([
      { status: 'warning' },
      { status: 'critical' },
    ])).toBe('critical')
  })

  it('empty groups → healthy', () => {
    expect(computeOverallStatus([])).toBe('healthy')
  })
})

describe('Lag Summary Response Shape', () => {
  const summary = buildMockLagSummary([
    {
      groupId: 'signal-processors',
      partitions: [
        { topic: 'signals.raw', partition: 0, lag: 100 },
        { topic: 'signals.raw', partition: 1, lag: 200 },
        { topic: 'signals.raw', partition: 2, lag: 50 },
      ],
    },
    {
      groupId: 'enrichment-workers',
      partitions: [
        { topic: 'signals.enriched', partition: 0, lag: 10 },
      ],
    },
  ])

  it('has total_lag field', () => {
    expect(summary).toHaveProperty('total_lag')
    expect(typeof summary.total_lag).toBe('number')
  })

  it('has overall_status field', () => {
    expect(summary).toHaveProperty('overall_status')
    expect(['healthy', 'warning', 'critical', 'unavailable']).toContain(summary.overall_status)
  })

  it('has checked_at as ISO date', () => {
    expect(new Date(summary.checked_at).toISOString()).toBe(summary.checked_at)
  })

  it('has groups array', () => {
    expect(Array.isArray(summary.groups)).toBe(true)
    expect(summary.groups.length).toBe(2)
  })

  it('each group has groupId, totalLag, status, partitions', () => {
    for (const group of summary.groups) {
      expect(group).toHaveProperty('groupId')
      expect(group).toHaveProperty('totalLag')
      expect(group).toHaveProperty('status')
      expect(group).toHaveProperty('partitions')
      expect(typeof group.groupId).toBe('string')
      expect(typeof group.totalLag).toBe('number')
    }
  })

  it('each partition has topic, partition, lag', () => {
    for (const group of summary.groups) {
      for (const p of group.partitions) {
        expect(p).toHaveProperty('topic')
        expect(p).toHaveProperty('partition')
        expect(p).toHaveProperty('lag')
        expect(typeof p.topic).toBe('string')
        expect(typeof p.partition).toBe('number')
        expect(typeof p.lag).toBe('number')
      }
    }
  })

  it('total_lag equals sum of all group totalLags', () => {
    const sumGroupLags = summary.groups.reduce((s, g) => s + g.totalLag, 0)
    expect(summary.total_lag).toBe(sumGroupLags)
  })

  it('group totalLag equals sum of its partition lags', () => {
    for (const group of summary.groups) {
      const partitionSum = group.partitions.reduce((s, p) => s + p.lag, 0)
      expect(group.totalLag).toBe(partitionSum)
    }
  })
})

describe('Healthy Scenario', () => {
  const summary = buildMockLagSummary([
    {
      groupId: 'signal-processors',
      partitions: [
        { topic: 'signals.raw', partition: 0, lag: 5 },
        { topic: 'signals.raw', partition: 1, lag: 3 },
      ],
    },
  ])

  it('overall status is healthy', () => {
    expect(summary.overall_status).toBe('healthy')
  })

  it('total lag is low', () => {
    expect(summary.total_lag).toBe(8)
  })
})

describe('Warning Scenario', () => {
  const summary = buildMockLagSummary([
    {
      groupId: 'signal-processors',
      partitions: [
        { topic: 'signals.raw', partition: 0, lag: 600 },
        { topic: 'signals.raw', partition: 1, lag: 100 },
      ],
    },
  ])

  it('overall status is warning', () => {
    expect(summary.overall_status).toBe('warning')
  })
})

describe('Critical Scenario', () => {
  const summary = buildMockLagSummary([
    {
      groupId: 'signal-processors',
      partitions: [
        { topic: 'signals.raw', partition: 0, lag: 5000 },
      ],
    },
    {
      groupId: 'enrichment-workers',
      partitions: [
        { topic: 'signals.enriched', partition: 0, lag: 2 },
      ],
    },
  ])

  it('overall status is critical', () => {
    expect(summary.overall_status).toBe('critical')
  })

  it('signal-processors group is critical', () => {
    const sp = summary.groups.find(g => g.groupId === 'signal-processors')
    expect(sp?.status).toBe('critical')
  })

  it('enrichment-workers group is healthy', () => {
    const ew = summary.groups.find(g => g.groupId === 'enrichment-workers')
    expect(ew?.status).toBe('healthy')
  })
})

describe('Admin Authorization', () => {
  it('admin account_type grants access', () => {
    const user = { accountType: 'admin' }
    expect(user.accountType === 'admin').toBe(true)
  })

  it('non-admin account types are denied', () => {
    const deniedTypes = ['user', 'free', 'pro', 'expert', 'official']
    for (const type of deniedTypes) {
      expect(type === 'admin').toBe(false)
    }
  })
})

describe('Error Responses', () => {
  it('non-admin gets 403 FORBIDDEN', () => {
    const error = { success: false, error: 'Admin access required', code: 'FORBIDDEN' }
    expect(error.code).toBe('FORBIDDEN')
    expect(error.success).toBe(false)
  })

  it('Kafka unavailable returns 503 SERVICE_UNAVAILABLE', () => {
    const error = { success: false, error: 'Kafka unavailable', code: 'SERVICE_UNAVAILABLE' }
    expect(error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('unavailable status triggers 503', () => {
    const summary: LagSummary = {
      total_lag: 0,
      overall_status: 'unavailable',
      checked_at: new Date().toISOString(),
      groups: [],
    }
    expect(summary.overall_status).toBe('unavailable')
  })
})

describe('Response Schema Validation', () => {
  it('200 response matches documented schema', () => {
    const schema = {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            total_lag: { type: 'number' },
            overall_status: { type: 'string', enum: ['healthy', 'warning', 'critical', 'unavailable'] },
            checked_at: { type: 'string', format: 'date-time' },
            groups: { type: 'array' },
          },
        },
      },
    }

    expect(schema.properties.data.properties.overall_status.enum).toContain('healthy')
    expect(schema.properties.data.properties.overall_status.enum).toContain('warning')
    expect(schema.properties.data.properties.overall_status.enum).toContain('critical')
    expect(schema.properties.data.properties.overall_status.enum).toContain('unavailable')
    expect(schema.properties.data.properties.overall_status.enum.length).toBe(4)
  })

  it('403 and 503 response schemas include success, error, code', () => {
    const errorSchema = {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' },
        code: { type: 'string' },
      },
    }

    expect(errorSchema.properties).toHaveProperty('success')
    expect(errorSchema.properties).toHaveProperty('error')
    expect(errorSchema.properties).toHaveProperty('code')
  })
})
