/**
 * Kafka consumer group lag monitoring.
 *
 * Fetches consumer group committed offsets vs topic end offsets,
 * computes per-partition lag, and caches the result in Redis for 30s
 * to avoid hammering the Kafka admin API.
 *
 * Consumer groups monitored:
 *   - 'scraper-verify'               (apps/scraper/src/index.ts)
 *   - 'worldpulse-signal-processor'
 *   - 'worldpulse-verification'
 *   - 'worldpulse-correlator'
 */

import { Kafka } from 'kafkajs'
import { redis } from '../db/redis'

// ─── Constants ────────────────────────────────────────────────────────────────

export const MONITORED_GROUPS = [
  'scraper-verify',
  'worldpulse-signal-processor',
  'worldpulse-verification',
  'worldpulse-correlator',
]

const LAG_CACHE_KEY      = 'kafka:lag:report'
const LAG_CACHE_TTL      = 30        // seconds
const WARNING_THRESHOLD  = 500
const CRITICAL_THRESHOLD = 2_000
const ADMIN_TIMEOUT_MS   = 5_000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PartitionLag {
  topic:     string
  partition: number
  lag:       number
}

export interface LagReport {
  groupId:    string
  totalLag:   number
  partitions: PartitionLag[]
  status:     'healthy' | 'warning' | 'critical'
}

export interface LagSummary {
  total_lag:      number
  groups:         LagReport[]
  overall_status: 'healthy' | 'warning' | 'critical' | 'unavailable'
  checked_at:     string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveStatus(lag: number): 'healthy' | 'warning' | 'critical' {
  if (lag >= CRITICAL_THRESHOLD) return 'critical'
  if (lag >= WARNING_THRESHOLD)  return 'warning'
  return 'healthy'
}

function deriveOverallStatus(
  groups: LagReport[],
): 'healthy' | 'warning' | 'critical' {
  if (groups.some(g => g.status === 'critical')) return 'critical'
  if (groups.some(g => g.status === 'warning'))  return 'warning'
  return 'healthy'
}

// ─── Kafka admin (lazy singleton) ────────────────────────────────────────────

let _kafkaAdmin: ReturnType<InstanceType<typeof Kafka>['admin']> | null = null

export function getKafkaAdmin(): ReturnType<InstanceType<typeof Kafka>['admin']> {
  if (!_kafkaAdmin) {
    const kafka = new Kafka({
      clientId: 'wp-api-lag-checker',
      brokers:  (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
      retry:    { retries: 0, initialRetryTime: 100 },
    })
    _kafkaAdmin = kafka.admin()
  }
  return _kafkaAdmin
}

// ─── Core lag computation ─────────────────────────────────────────────────────

async function fetchGroupLag(
  admin: ReturnType<InstanceType<typeof Kafka>['admin']>,
  groupId: string,
): Promise<LagReport> {
  // Committed offsets for this consumer group across all its topics
  const groupOffsets = await admin.fetchOffsets({ groupId })

  if (groupOffsets.length === 0) {
    return { groupId, totalLag: 0, partitions: [], status: 'healthy' }
  }

  // Unique topics this group is subscribed to
  const topics = [...new Set(groupOffsets.map(o => o.topic))]

  // End (high-watermark) offsets per topic/partition
  const endOffsetMap = new Map<string, Map<number, number>>()
  for (const topic of topics) {
    const partitions = await admin.fetchTopicOffsets(topic)
    const partMap = new Map<number, number>()
    for (const p of partitions) {
      partMap.set(p.partition, Number(p.offset))
    }
    endOffsetMap.set(topic, partMap)
  }

  // Compute lag per partition
  const partitionLags: PartitionLag[] = []
  for (const topicEntry of groupOffsets) {
    const partMap = endOffsetMap.get(topicEntry.topic)
    if (!partMap) continue

    for (const partition of topicEntry.partitions) {
      const endOffset     = partMap.get(partition.partition) ?? 0
      const currentOffset = Number(partition.offset)
      // Offset -1 means the group has never committed for this partition
      const normalized    = currentOffset < 0 ? 0 : currentOffset
      const lag           = Math.max(0, endOffset - normalized)

      partitionLags.push({
        topic:     topicEntry.topic,
        partition: partition.partition,
        lag,
      })
    }
  }

  const totalLag = partitionLags.reduce((sum, p) => sum + p.lag, 0)
  return {
    groupId,
    totalLag,
    partitions: partitionLags,
    status:     deriveStatus(totalLag),
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a cached (30 s TTL) summary of consumer group lag across all
 * monitored groups. Falls back to { overall_status: 'unavailable' } if
 * Kafka cannot be reached within ADMIN_TIMEOUT_MS.
 */
export async function getLagSummary(): Promise<LagSummary> {
  // ── Cache hit ──────────────────────────────────────────────────────────
  const cached = await redis.get(LAG_CACHE_KEY)
  if (cached) {
    return JSON.parse(cached) as LagSummary
  }

  // ── Fetch fresh ────────────────────────────────────────────────────────
  try {
    const admin = getKafkaAdmin()

    await Promise.race([
      admin.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Kafka admin connect timeout')), ADMIN_TIMEOUT_MS),
      ),
    ])

    const reports = await Promise.all(
      MONITORED_GROUPS.map(groupId => fetchGroupLag(admin, groupId)),
    )

    const total_lag = reports.reduce((sum, r) => sum + r.totalLag, 0)
    const summary: LagSummary = {
      total_lag,
      groups:         reports,
      overall_status: deriveOverallStatus(reports),
      checked_at:     new Date().toISOString(),
    }

    await redis.setex(LAG_CACHE_KEY, LAG_CACHE_TTL, JSON.stringify(summary))
    return summary
  } catch {
    const summary: LagSummary = {
      total_lag:      0,
      groups:         [],
      overall_status: 'unavailable',
      checked_at:     new Date().toISOString(),
    }
    // Cache briefly so a flapping Kafka doesn't spam admin connect calls
    await redis.setex(LAG_CACHE_KEY, 10, JSON.stringify(summary)).catch(() => {})
    return summary
  }
}
