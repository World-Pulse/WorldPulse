/**
 * Kafka consumer group lag monitor for the scraper process.
 *
 * Every 5 minutes, fetches consumer group lag and:
 *  - Logs a summary line at INFO level
 *  - Logs a WARN with structured fields for any critical group (lag ≥ 2000)
 *
 * Results are cached in Redis at 'kafka:lag:report' (30 s TTL) — the same key
 * the API reads, so both sides share a single Kafka admin call per interval.
 */

import { Kafka } from 'kafkajs'
import { redis } from './redis'
import { logger } from './logger'

// ─── Constants ────────────────────────────────────────────────────────────────

const MONITORED_GROUPS = [
  'scraper-verify',
  'worldpulse-signal-processor',
  'worldpulse-verification',
  'worldpulse-correlator',
]

const LAG_CACHE_KEY      = 'kafka:lag:report'
const LAG_CACHE_TTL      = 30        // seconds
const WARNING_THRESHOLD  = 500
const CRITICAL_THRESHOLD = 2_000
const MONITOR_INTERVAL   = 5 * 60_000 // 5 minutes
const ADMIN_TIMEOUT_MS   = 5_000

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartitionLag {
  topic:     string
  partition: number
  lag:       number
}

interface GroupLag {
  groupId:  string
  totalLag: number
  status:   'healthy' | 'warning' | 'critical'
  partitions: PartitionLag[]
}

interface LagCache {
  total_lag:      number
  groups:         GroupLag[]
  overall_status: 'healthy' | 'warning' | 'critical' | 'unavailable'
  checked_at:     string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveStatus(lag: number): 'healthy' | 'warning' | 'critical' {
  if (lag >= CRITICAL_THRESHOLD) return 'critical'
  if (lag >= WARNING_THRESHOLD)  return 'warning'
  return 'healthy'
}

// ─── Kafka admin (lazy singleton) ────────────────────────────────────────────

let _admin: ReturnType<InstanceType<typeof Kafka>['admin']> | null = null

function getAdmin(): ReturnType<InstanceType<typeof Kafka>['admin']> {
  if (!_admin) {
    const kafka = new Kafka({
      clientId: 'wp-scraper-lag-monitor',
      brokers:  (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
      retry:    { retries: 0, initialRetryTime: 100 },
    })
    _admin = kafka.admin()
  }
  return _admin
}

// ─── Lag fetch ────────────────────────────────────────────────────────────────

async function fetchGroupLag(
  admin: ReturnType<InstanceType<typeof Kafka>['admin']>,
  groupId: string,
): Promise<GroupLag> {
  const groupOffsets = await admin.fetchOffsets({ groupId })

  if (groupOffsets.length === 0) {
    return { groupId, totalLag: 0, partitions: [], status: 'healthy' }
  }

  const topics = [...new Set(groupOffsets.map(o => o.topic))]
  const endOffsetMap = new Map<string, Map<number, number>>()

  for (const topic of topics) {
    const partitions = await admin.fetchTopicOffsets(topic)
    const partMap = new Map<number, number>()
    for (const p of partitions) {
      partMap.set(p.partition, Number(p.offset))
    }
    endOffsetMap.set(topic, partMap)
  }

  const partitionLags: PartitionLag[] = []
  for (const topicEntry of groupOffsets) {
    const partMap = endOffsetMap.get(topicEntry.topic)
    if (!partMap) continue

    for (const partition of topicEntry.partitions) {
      const endOffset     = partMap.get(partition.partition) ?? 0
      const currentOffset = Number(partition.offset)
      const normalized    = currentOffset < 0 ? 0 : currentOffset
      const lag           = Math.max(0, endOffset - normalized)
      partitionLags.push({ topic: topicEntry.topic, partition: partition.partition, lag })
    }
  }

  const totalLag = partitionLags.reduce((sum, p) => sum + p.lag, 0)
  return { groupId, totalLag, partitions: partitionLags, status: deriveStatus(totalLag) }
}

// ─── Main check ───────────────────────────────────────────────────────────────

export async function checkKafkaLag(): Promise<void> {
  // If we have a fresh cache entry (from the API side), use it to avoid
  // a duplicate admin connect.
  const cached = await redis.get(LAG_CACHE_KEY).catch(() => null)
  if (cached) {
    const data = JSON.parse(cached) as LagCache
    logSummary(data.groups)
    return
  }

  try {
    const admin = getAdmin()

    await Promise.race([
      admin.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Kafka admin connect timeout')), ADMIN_TIMEOUT_MS),
      ),
    ])

    const groups = await Promise.all(
      MONITORED_GROUPS.map(groupId => fetchGroupLag(admin, groupId)),
    )

    const total_lag      = groups.reduce((sum, g) => sum + g.totalLag, 0)
    const hasCritical    = groups.some(g => g.status === 'critical')
    const hasWarning     = groups.some(g => g.status === 'warning')
    const overall_status = hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy'

    const cache: LagCache = {
      total_lag,
      groups,
      overall_status,
      checked_at: new Date().toISOString(),
    }

    await redis.setex(LAG_CACHE_KEY, LAG_CACHE_TTL, JSON.stringify(cache)).catch(() => {})

    logSummary(groups)
  } catch (err) {
    logger.warn({ err }, '[KAFKA LAG] Admin check failed — Kafka may be unavailable')
  }
}

function logSummary(groups: GroupLag[]): void {
  // Summary line e.g.:
  // [KAFKA LAG] scraper-verify: 0 | worldpulse-signal-processor: 12 | ...
  const parts = groups.map(g => `${g.groupId}: ${g.totalLag}`)
  logger.info(`[KAFKA LAG] ${parts.join(' | ')}`)

  // Warn for critical groups
  for (const group of groups) {
    if (group.status === 'critical') {
      logger.warn(
        { group: group.groupId, lag: group.totalLag, threshold: CRITICAL_THRESHOLD },
        '[KAFKA LAG] Critical consumer lag detected',
      )
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts the 5-minute lag monitoring interval.
 * Returns the interval handle so the caller can clear it on shutdown.
 */
export function startKafkaLagMonitor(): ReturnType<typeof setInterval> {
  // Run once immediately, then on interval
  checkKafkaLag().catch(err => logger.warn({ err }, '[KAFKA LAG] Initial check failed'))
  return setInterval(() => {
    checkKafkaLag().catch(err => logger.warn({ err }, '[KAFKA LAG] Interval check failed'))
  }, MONITOR_INTERVAL)
}
