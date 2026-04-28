/**
 * Event Threads Engine — Phase 1.6.2
 *
 * Graduates ephemeral Redis correlation clusters into durable PostgreSQL
 * event threads that track developing stories over days/weeks.
 *
 * Lifecycle:
 *   1. Correlation engine forms cluster in Redis (≥3 signals)
 *   2. This engine promotes qualifying clusters to event_threads
 *   3. New signals matching an existing thread get linked
 *   4. Thread status auto-transitions: developing → escalating → stable → resolved
 *
 * Runs every 30 minutes via scheduler.
 *
 * @module cortex/event-threads
 */

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

// ─── Types ───────────────────────────────────────────────────────────────────

interface RedisCluster {
  cluster_id: string
  primary_signal_id: string
  signal_ids: string[]
  categories: string[]
  sources: string[]
  severity: string
  correlation_score: number
  created_at: string
}

export interface EventThread {
  id: string
  title: string
  summary: string | null
  category: string
  region: string | null
  status: 'developing' | 'escalating' | 'stable' | 'resolved'
  peak_severity: string
  signal_count: number
  source_count: number
  severity_trajectory: Array<{ timestamp: string; avg_severity_rank: number; signal_count: number }>
  first_seen: string
  last_updated: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_SIGNALS_FOR_THREAD = 3    // Minimum cluster size to graduate
const STABLE_AFTER_HOURS = 48       // Mark "stable" after 48h without new signals
const RESOLVED_AFTER_HOURS = 168    // Mark "resolved" after 7 days without new signals
const SEVERITY_RANK: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
}
const THREAD_MERGE_WINDOW_HOURS = 72   // Merge threads that share signals within this window

// ─── Promote Redis clusters to threads ───────────────────────────────────────

/**
 * Scan recent Redis clusters and promote qualifying ones to event_threads.
 */
export async function promoteClusterToThreads(): Promise<{
  promoted: number
  updated: number
  merged: number
}> {
  let promoted = 0
  let updated = 0
  let merged = 0

  // Get recent cluster IDs from Redis sorted set
  const clusterIds = await redis.zrevrange('correlation:recent', 0, 200)

  for (const clusterId of clusterIds) {
    const raw = await redis.get(`correlation:cluster:${clusterId}`)
    if (!raw) continue

    let cluster: RedisCluster
    try {
      cluster = JSON.parse(raw)
    } catch { continue }

    if (cluster.signal_ids.length < MIN_SIGNALS_FOR_THREAD) continue

    // Check if this cluster already has a thread
    const existing = await db('event_threads')
      .where('cluster_id', clusterId)
      .first()

    if (existing) {
      // Update existing thread with any new signals
      const result = await updateThreadFromCluster(existing.id, cluster)
      if (result.new_signals > 0) updated++
      continue
    }

    // Check if any of these signals already belong to another thread
    const existingLinks = await db('event_thread_signals')
      .whereIn('signal_id', cluster.signal_ids)
      .select('thread_id', 'signal_id')

    if (existingLinks.length > 0) {
      // Signals already belong to an existing thread — merge into it
      const targetThreadId = existingLinks[0]!.thread_id
      await mergeClusterIntoThread(targetThreadId, cluster)
      merged++
      continue
    }

    // Create new thread
    await createThreadFromCluster(cluster)
    promoted++
  }

  console.log(`[CORTEX] Event threads: ${promoted} promoted, ${updated} updated, ${merged} merged`)
  return { promoted, updated, merged }
}

// ─── Create thread from cluster ──────────────────────────────────────────────

async function createThreadFromCluster(cluster: RedisCluster): Promise<string> {
  // Fetch signal details for title and region
  const signals = await db('signals')
    .whereIn('id', cluster.signal_ids)
    .select('id', 'title', 'category', 'severity', 'location_name', 'reliability_score', 'published_at')
    .orderBy('published_at', 'asc')

  if (signals.length === 0) return ''

  // Primary signal = highest severity, then most recent
  const primary = signals.reduce((best: any, s: any) => {
    const bestRank = SEVERITY_RANK[best.severity] ?? 0
    const sRank = SEVERITY_RANK[s.severity] ?? 0
    return sRank > bestRank ? s : best
  }, signals[0])

  const categories = [...new Set(signals.map((s: any) => s.category))]
  const regions = [...new Set(signals.map((s: any) => s.location_name).filter(Boolean))]
  const sources = cluster.sources?.length ?? 0

  const avgSeverityRank = signals.reduce((sum: number, s: any) =>
    sum + (SEVERITY_RANK[s.severity] ?? 1), 0) / signals.length

  const thread = await db('event_threads')
    .insert({
      title: primary.title,
      category: categories[0] ?? 'unknown',
      region: regions[0] ?? null,
      status: 'developing',
      peak_severity: primary.severity,
      signal_count: signals.length,
      source_count: sources,
      avg_reliability: signals.reduce((s: number, sig: any) =>
        s + Number(sig.reliability_score ?? 0.5), 0) / signals.length,
      severity_trajectory: JSON.stringify([{
        timestamp: new Date().toISOString(),
        avg_severity_rank: Math.round(avgSeverityRank * 100) / 100,
        signal_count: signals.length,
      }]),
      related_entities: '[]',
      cluster_id: cluster.cluster_id,
      first_seen: signals[0]!.published_at,
      last_updated: signals[signals.length - 1]!.published_at,
    })
    .returning('id')

  const threadId = thread[0]?.id
  if (!threadId) return ''

  // Link signals to thread
  const links = signals.map((s: any, i: number) => ({
    thread_id: threadId,
    signal_id: s.id,
    role: s.id === primary.id ? 'primary' : 'member',
  }))

  await db('event_thread_signals').insert(links).onConflict(['thread_id', 'signal_id']).ignore()

  console.log(`[CORTEX] Created event thread: "${primary.title.slice(0, 60)}..." (${signals.length} signals)`)
  return threadId
}

// ─── Update thread with new signals ──────────────────────────────────────────

async function updateThreadFromCluster(
  threadId: string,
  cluster: RedisCluster,
): Promise<{ new_signals: number }> {
  // Find signals not yet linked
  const existingLinks = await db('event_thread_signals')
    .where('thread_id', threadId)
    .select('signal_id')

  const existingIds = new Set(existingLinks.map((l: any) => l.signal_id))
  const newSignalIds = cluster.signal_ids.filter(id => !existingIds.has(id))

  if (newSignalIds.length === 0) return { new_signals: 0 }

  // Get new signal details
  const newSignals = await db('signals')
    .whereIn('id', newSignalIds)
    .select('id', 'severity', 'reliability_score', 'published_at')

  if (newSignals.length === 0) return { new_signals: 0 }

  // Link new signals
  await db('event_thread_signals')
    .insert(newSignals.map((s: any) => ({
      thread_id: threadId,
      signal_id: s.id,
      role: 'member',
    })))
    .onConflict(['thread_id', 'signal_id'])
    .ignore()

  // Update thread stats
  const allSignals = await db('event_thread_signals')
    .where('thread_id', threadId)
    .join('signals', 'event_thread_signals.signal_id', 'signals.id')
    .select('signals.severity', 'signals.reliability_score')

  const avgSeverityRank = allSignals.reduce((sum: number, s: any) =>
    sum + (SEVERITY_RANK[s.severity] ?? 1), 0) / allSignals.length

  const peakSev = allSignals.reduce((best: string, s: any) => {
    return (SEVERITY_RANK[s.severity] ?? 0) > (SEVERITY_RANK[best] ?? 0) ? s.severity : best
  }, 'low')

  // Get existing trajectory and append
  const thread = await db('event_threads').where('id', threadId).first()
  const trajectory = Array.isArray(thread?.severity_trajectory)
    ? thread.severity_trajectory
    : JSON.parse(thread?.severity_trajectory ?? '[]')

  trajectory.push({
    timestamp: new Date().toISOString(),
    avg_severity_rank: Math.round(avgSeverityRank * 100) / 100,
    signal_count: allSignals.length,
  })

  // Detect escalation: is severity trending up?
  const status = detectThreadStatus(trajectory, thread?.status)

  await db('event_threads').where('id', threadId).update({
    signal_count: allSignals.length,
    peak_severity: peakSev,
    avg_reliability: allSignals.reduce((s: number, sig: any) =>
      s + Number(sig.reliability_score ?? 0.5), 0) / allSignals.length,
    severity_trajectory: JSON.stringify(trajectory),
    status,
    last_updated: new Date().toISOString(),
  })

  return { new_signals: newSignals.length }
}

// ─── Merge cluster into existing thread ──────────────────────────────────────

async function mergeClusterIntoThread(
  threadId: string,
  cluster: RedisCluster,
): Promise<void> {
  // Update the cluster_id reference
  await db('event_threads')
    .where('id', threadId)
    .whereNull('cluster_id')
    .update({ cluster_id: cluster.cluster_id })

  await updateThreadFromCluster(threadId, cluster)
}

// ─── Thread lifecycle management ─────────────────────────────────────────────

/**
 * Update thread statuses based on activity.
 * - No new signals for 48h → "stable"
 * - No new signals for 7d → "resolved"
 */
export async function updateThreadLifecycles(): Promise<{
  stabilized: number
  resolved: number
}> {
  const now = new Date()
  const stableThreshold = new Date(now.getTime() - STABLE_AFTER_HOURS * 3600 * 1000)
  const resolvedThreshold = new Date(now.getTime() - RESOLVED_AFTER_HOURS * 3600 * 1000)

  const stabilized = await db('event_threads')
    .whereIn('status', ['developing', 'escalating'])
    .where('last_updated', '<', stableThreshold.toISOString())
    .update({ status: 'stable' })

  const resolved = await db('event_threads')
    .where('status', 'stable')
    .where('last_updated', '<', resolvedThreshold.toISOString())
    .update({
      status: 'resolved',
      resolved_at: now.toISOString(),
    })

  if (stabilized > 0 || resolved > 0) {
    console.log(`[CORTEX] Thread lifecycle: ${stabilized} → stable, ${resolved} → resolved`)
  }

  return { stabilized, resolved }
}

// ─── Status detection ────────────────────────────────────────────────────────

function detectThreadStatus(
  trajectory: Array<{ avg_severity_rank: number; signal_count: number }>,
  currentStatus: string,
): string {
  if (trajectory.length < 2) return currentStatus ?? 'developing'

  const recent = trajectory.slice(-3)
  const older  = trajectory.slice(-6, -3)

  if (older.length === 0) return 'developing'

  const recentAvgSev = recent.reduce((s, t) => s + t.avg_severity_rank, 0) / recent.length
  const olderAvgSev  = older.reduce((s, t) => s + t.avg_severity_rank, 0) / older.length

  const recentAvgCount = recent.reduce((s, t) => s + t.signal_count, 0) / recent.length
  const olderAvgCount  = older.reduce((s, t) => s + t.signal_count, 0) / older.length

  // Escalating: severity or volume trending up significantly
  if (recentAvgSev > olderAvgSev * 1.2 || recentAvgCount > olderAvgCount * 1.5) {
    return 'escalating'
  }

  return 'developing'
}

// ─── Full cycle ──────────────────────────────────────────────────────────────

/**
 * Run the full event threads cycle:
 * 1. Promote qualifying Redis clusters to threads
 * 2. Update thread lifecycles (stable/resolved transitions)
 */
export async function runEventThreadsCycle(): Promise<{
  promoted: number
  updated: number
  merged: number
  stabilized: number
  resolved: number
}> {
  const promotion = await promoteClusterToThreads()
  const lifecycle = await updateThreadLifecycles()

  return { ...promotion, ...lifecycle }
}
