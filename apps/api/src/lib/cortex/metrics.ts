/**
 * Cortex Metrics & Intelligence Quality — Phase 1.6.6
 *
 * Ties together all Cortex subsystems into a single health + quality picture:
 *   1. Pipeline metrics — throughput, latency, error rates per subsystem
 *   2. Intelligence quality scoring — how much "intelligence" vs raw data
 *   3. Cortex health dashboard — single endpoint for brain agent + admin
 *   4. Subsystem status — is each component running and producing output
 *
 * @module cortex/metrics
 */

import { db } from '../../db/postgres'
import { redis } from '../../db/redis'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubsystemStatus {
  name: string
  status: 'healthy' | 'degraded' | 'offline' | 'unknown'
  last_run: string | null
  last_output: Record<string, number>
  error: string | null
}

export interface IntelligenceQuality {
  // Signal-level quality
  total_signals: number
  corroborated_signals: number
  corroboration_rate: number
  avg_reliability: number
  multi_source_rate: number

  // Entity enrichment
  total_entities: number
  entities_with_edges: number
  entity_coverage: number    // % of signals linked to entities

  // Embedding coverage
  embedding_coverage: number

  // Thread coverage
  active_threads: number
  signals_in_threads: number
  thread_coverage: number    // % of recent signals in event threads

  // Baseline coverage
  baseline_days: number
  anomalies_last_7d: number

  // Pattern intelligence
  causal_chains_discovered: number
  geographic_hotspots: number
  cross_cluster_bridges: number

  // Composite score (0-100)
  intelligence_score: number
}

export interface CortexHealth {
  status: 'healthy' | 'degraded' | 'offline'
  subsystems: SubsystemStatus[]
  intelligence_quality: IntelligenceQuality
  pipeline_stats: {
    signals_24h: number
    signals_7d: number
    sources_active: number
    avg_signals_per_hour: number
  }
  generated_at: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HEALTH_CACHE_TTL = 300  // 5 min
const HEALTH_CACHE_KEY = 'cortex:health:latest'

// ─── Subsystem Status Checks ────────────────────────────────────────────────

async function checkBaselineStatus(): Promise<SubsystemStatus> {
  try {
    const latest = await db('signal_baselines')
      .orderBy('date', 'desc')
      .select('date')
      .first()

    const anomalyCount = await db('signal_anomalies')
      .where('date', '>=', db.raw("CURRENT_DATE - INTERVAL '7 days'"))
      .count('* as count')
      .first()

    const daysSinceRun = latest
      ? Math.floor((Date.now() - new Date(latest.date).getTime()) / (24 * 3600 * 1000))
      : null

    return {
      name: 'statistical_baselines',
      status: daysSinceRun !== null && daysSinceRun <= 2 ? 'healthy' : daysSinceRun !== null ? 'degraded' : 'offline',
      last_run: latest?.date ?? null,
      last_output: {
        days_since_update: daysSinceRun ?? -1,
        anomalies_7d: Number((anomalyCount as any)?.count ?? 0),
      },
      error: null,
    }
  } catch (err) {
    return { name: 'statistical_baselines', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

async function checkThreadStatus(): Promise<SubsystemStatus> {
  try {
    const counts = await db('event_threads')
      .select('status')
      .count('* as count')
      .groupBy('status')

    const statusMap: Record<string, number> = {}
    for (const r of counts as any[]) {
      statusMap[r.status] = Number(r.count)
    }

    const latest = await db('event_threads')
      .orderBy('last_updated', 'desc')
      .select('last_updated')
      .first()

    const hoursSince = latest
      ? (Date.now() - new Date(latest.last_updated).getTime()) / 3600000
      : null

    return {
      name: 'event_threads',
      status: hoursSince !== null && hoursSince <= 2 ? 'healthy' : hoursSince !== null ? 'degraded' : 'offline',
      last_run: latest?.last_updated?.toISOString?.() ?? null,
      last_output: statusMap,
      error: null,
    }
  } catch (err) {
    return { name: 'event_threads', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

async function checkEntityStatus(): Promise<SubsystemStatus> {
  try {
    const [entityCount, edgeCount, recentEntity] = await Promise.all([
      db('entity_nodes').count('* as count').first(),
      db('entity_edges').count('* as count').first(),
      db('entity_nodes').orderBy('last_seen', 'desc').select('last_seen').first(),
    ])

    const hoursSince = recentEntity?.last_seen
      ? (Date.now() - new Date(recentEntity.last_seen).getTime()) / 3600000
      : null

    return {
      name: 'entity_graph',
      status: hoursSince !== null && hoursSince <= 6 ? 'healthy' : hoursSince !== null ? 'degraded' : 'offline',
      last_run: recentEntity?.last_seen?.toISOString?.() ?? null,
      last_output: {
        entities: Number((entityCount as any)?.count ?? 0),
        edges: Number((edgeCount as any)?.count ?? 0),
      },
      error: null,
    }
  } catch (err) {
    return { name: 'entity_graph', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

async function checkEmbeddingStatus(): Promise<SubsystemStatus> {
  try {
    const stats = await db.raw(`
      SELECT
        COUNT(*) as total,
        COUNT(embedding) as with_embedding
      FROM signals
    `)

    const row = stats.rows?.[0] ?? {}
    const total = Number(row.total ?? 0)
    const withEmb = Number(row.with_embedding ?? 0)
    const coverage = total > 0 ? Math.round((withEmb / total) * 100) : 0

    return {
      name: 'embeddings',
      status: coverage > 50 ? 'healthy' : coverage > 10 ? 'degraded' : 'offline',
      last_run: null,
      last_output: {
        total_signals: total,
        with_embedding: withEmb,
        coverage_pct: coverage,
      },
      error: null,
    }
  } catch (err) {
    return { name: 'embeddings', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

async function checkPatternStatus(): Promise<SubsystemStatus> {
  try {
    const cached = await redis.get('cortex:patterns:latest').catch(() => null)
    if (!cached) {
      return { name: 'pattern_detection', status: 'offline', last_run: null, last_output: {}, error: null }
    }

    const report = JSON.parse(cached)
    return {
      name: 'pattern_detection',
      status: 'healthy',
      last_run: report.generated_at ?? null,
      last_output: {
        causal_chains: report.causal_chains?.length ?? 0,
        bridges: report.cross_cluster_bridges?.length ?? 0,
        hotspots: report.geographic_hotspots?.length ?? 0,
      },
      error: null,
    }
  } catch (err) {
    return { name: 'pattern_detection', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

// ─── Intelligence Quality Scoring ───────────────────────────────────────────

/**
 * Compute a composite intelligence quality score (0-100).
 * Measures how much "intelligence" the Cortex has built vs raw data.
 */
export async function computeIntelligenceQuality(): Promise<IntelligenceQuality> {
  const [
    signalStats,
    entityStats,
    embeddingStats,
    threadStats,
    baselineStats,
    patternReport,
  ] = await Promise.all([
    // Signal-level quality
    db.raw(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE reliability_score >= 0.6) as corroborated,
        COALESCE(AVG(reliability_score), 0) as avg_reliability,
        COUNT(*) FILTER (WHERE source_count >= 2) as multi_source
      FROM signals
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `).then(r => r.rows?.[0] ?? {}),

    // Entity enrichment
    db.raw(`
      SELECT
        COUNT(*) as total_entities,
        COUNT(*) FILTER (WHERE id IN (SELECT DISTINCT source_entity_id FROM entity_edges UNION SELECT DISTINCT target_entity_id FROM entity_edges)) as with_edges
      FROM entity_nodes
    `).then(r => r.rows?.[0] ?? {}).catch(() => ({ total_entities: 0, with_edges: 0 })),

    // Embedding coverage
    db.raw(`
      SELECT
        COUNT(embedding)::float / GREATEST(COUNT(*), 1) * 100 as coverage
      FROM signals
    `).then(r => Number(r.rows?.[0]?.coverage ?? 0)).catch(() => 0),

    // Thread coverage
    db.raw(`
      SELECT
        COUNT(DISTINCT et.id) FILTER (WHERE et.status IN ('developing', 'escalating')) as active_threads,
        COUNT(DISTINCT ets.signal_id) as signals_in_threads
      FROM event_threads et
      LEFT JOIN event_thread_signals ets ON et.id = ets.thread_id
    `).then(r => r.rows?.[0] ?? {}).catch(() => ({ active_threads: 0, signals_in_threads: 0 })),

    // Baseline coverage
    db.raw(`
      SELECT
        COUNT(DISTINCT date) as baseline_days,
        (SELECT COUNT(*) FROM signal_anomalies WHERE date >= CURRENT_DATE - INTERVAL '7 days') as anomalies_7d
      FROM signal_baselines
    `).then(r => r.rows?.[0] ?? {}).catch(() => ({ baseline_days: 0, anomalies_7d: 0 })),

    // Pattern detection
    redis.get('cortex:patterns:latest').then(c => c ? JSON.parse(c) : null).catch(() => null),
  ])

  const totalSignals = Number(signalStats.total ?? 0)
  const corroborated = Number(signalStats.corroborated ?? 0)
  const avgReliability = Number(signalStats.avg_reliability ?? 0)
  const multiSource = Number(signalStats.multi_source ?? 0)

  const totalEntities = Number(entityStats.total_entities ?? 0)
  const entitiesWithEdges = Number(entityStats.with_edges ?? 0)

  const activeThreads = Number(threadStats.active_threads ?? 0)
  const signalsInThreads = Number(threadStats.signals_in_threads ?? 0)

  const baselineDays = Number(baselineStats.baseline_days ?? 0)
  const anomalies7d = Number(baselineStats.anomalies_7d ?? 0)

  const chainsCount = patternReport?.causal_chains?.length ?? 0
  const hotspotsCount = patternReport?.geographic_hotspots?.length ?? 0
  const bridgesCount = patternReport?.cross_cluster_bridges?.length ?? 0

  // Entity coverage: what % of recent signals have at least one entity linked
  let entityCoverage = 0
  try {
    const ecRow = await db.raw(`
      SELECT
        COUNT(DISTINCT s.id)::float / GREATEST(COUNT(*), 1) * 100 as coverage
      FROM signals s
      LEFT JOIN entity_nodes en ON s.id = ANY(en.signal_ids)
      WHERE s.created_at >= NOW() - INTERVAL '7 days'
    `)
    entityCoverage = Number(ecRow.rows?.[0]?.coverage ?? 0)
  } catch { /* entity_nodes may not exist */ }

  // ── Composite intelligence score ──
  // Weight each dimension and sum to 100
  const corrobRate = totalSignals > 0 ? corroborated / totalSignals : 0
  const multiSourceRate = totalSignals > 0 ? multiSource / totalSignals : 0
  const threadCoverage = totalSignals > 0 ? Math.min(1, signalsInThreads / totalSignals) : 0

  const score =
    Math.min(20, corrobRate * 20) +                             // Corroboration (0-20)
    Math.min(15, (avgReliability / 1) * 15) +                   // Avg reliability (0-15)
    Math.min(15, (Number(embeddingStats) / 100) * 15) +         // Embedding coverage (0-15)
    Math.min(15, (entityCoverage / 100) * 15) +                 // Entity coverage (0-15)
    Math.min(10, threadCoverage * 10) +                         // Thread coverage (0-10)
    Math.min(10, Math.min(1, baselineDays / 30) * 10) +         // Baseline maturity (0-10)
    Math.min(15, ((chainsCount + hotspotsCount + bridgesCount) / 20) * 15) // Pattern discovery (0-15)

  return {
    total_signals: totalSignals,
    corroborated_signals: corroborated,
    corroboration_rate: Math.round(corrobRate * 1000) / 1000,
    avg_reliability: Math.round(avgReliability * 1000) / 1000,
    multi_source_rate: Math.round(multiSourceRate * 1000) / 1000,

    total_entities: totalEntities,
    entities_with_edges: entitiesWithEdges,
    entity_coverage: Math.round(entityCoverage * 10) / 10,

    embedding_coverage: Math.round(Number(embeddingStats) * 10) / 10,

    active_threads: activeThreads,
    signals_in_threads: signalsInThreads,
    thread_coverage: Math.round(threadCoverage * 1000) / 1000,

    baseline_days: baselineDays,
    anomalies_last_7d: anomalies7d,

    causal_chains_discovered: chainsCount,
    geographic_hotspots: hotspotsCount,
    cross_cluster_bridges: bridgesCount,

    intelligence_score: Math.round(Math.min(100, Math.max(0, score))),
  }
}

// ─── Full Cortex Health ─────────────────────────────────────────────────────

/**
 * Comprehensive Cortex health check — returns all subsystem statuses,
 * intelligence quality score, and pipeline throughput stats.
 */
export async function getCortexHealth(): Promise<CortexHealth> {
  // Check cache first
  const cached = await redis.get(HEALTH_CACHE_KEY).catch(() => null)
  if (cached) return JSON.parse(cached)

  const [subsystems, quality, pipelineStats] = await Promise.all([
    // All subsystem checks in parallel
    Promise.all([
      checkBaselineStatus(),
      checkThreadStatus(),
      checkEntityStatus(),
      checkEmbeddingStatus(),
      checkPatternStatus(),
    ]),

    // Intelligence quality
    computeIntelligenceQuality(),

    // Pipeline throughput
    Promise.all([
      db('signals').where('created_at', '>=', db.raw("NOW() - INTERVAL '24 hours'")).count('* as count').first(),
      db('signals').where('created_at', '>=', db.raw("NOW() - INTERVAL '7 days'")).count('* as count').first(),
      db('sources').where('active', true).count('* as count').first(),
    ]).then(([d24h, d7d, sources]) => ({
      signals_24h: Number((d24h as any)?.count ?? 0),
      signals_7d: Number((d7d as any)?.count ?? 0),
      sources_active: Number((sources as any)?.count ?? 0),
      avg_signals_per_hour: Math.round(Number((d24h as any)?.count ?? 0) / 24),
    })),
  ])

  // Overall status: healthy if all subsystems healthy, degraded if any degraded, offline if majority offline
  const offlineCount = subsystems.filter(s => s.status === 'offline').length
  const degradedCount = subsystems.filter(s => s.status === 'degraded').length
  const overallStatus: CortexHealth['status'] =
    offlineCount >= 3 ? 'offline' :
    offlineCount > 0 || degradedCount > 0 ? 'degraded' :
    'healthy'

  const health: CortexHealth = {
    status: overallStatus,
    subsystems,
    intelligence_quality: quality,
    pipeline_stats: pipelineStats,
    generated_at: new Date().toISOString(),
  }

  // Cache
  await redis.setex(HEALTH_CACHE_KEY, HEALTH_CACHE_TTL, JSON.stringify(health)).catch(() => {})

  return health
}
