/**
 * Cortex Metrics & Intelligence Quality — Phase 1.6.6
 *
 * Ties together all Cortex subsystems into a single health + quality picture:
 *   1. Pipeline metrics — throughput per subsystem
 *   2. Intelligence quality scoring — how much "intelligence" vs raw data
 *   3. Cortex health dashboard — single endpoint for brain agent + admin
 *   4. Subsystem status — is each component running and producing output
 *
 * Oct 15, 2026: the measures are honest and kept.
 *   - "Corroboration" is the share of reports confirmed by 2+ outlets (it was
 *     the share rated 0.6+, now `reliable_rate`).
 *   - Entity coverage works (it compared uuid ids with a text array and always
 *     failed into 0).
 *   - Thread coverage compares 30 days with 30 days (it divided all-time thread
 *     reports by 30 days of reports, so it sat at 100%).
 *   - Pattern discovery counts links that share a subject or named entities,
 *     not every link the engine made.
 *   - A measure that can't be read this time is left out of the score, not
 *     counted as 0: one query timing out at the 5-second limit swung the score
 *     from 74 to 64 within minutes.
 *   - Both answers are kept in Redis and remade in the background with a longer
 *     time limit, so the endpoints answer at once instead of a 500 after 5 s.
 *
 * @module cortex/metrics
 */

import type { Knex } from 'knex'
import { db } from '../../db/postgres'
import { redis } from '../../db/redis'
import { staleWhileRevalidate } from '../swr-cache'
import { longQuery } from '../long-query'
import { honestScore, sensibleLinks, type ScorePart } from './honest'

type Q = Knex | Knex.Transaction

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubsystemStatus {
  name: string
  status: 'healthy' | 'degraded' | 'offline' | 'unknown'
  last_run: string | null
  last_output: Record<string, number>
  error: string | null
}

export interface IntelligenceQuality {
  // Signal-level quality (30 days)
  total_signals: number
  corroborated_signals: number
  /** share confirmed by 2+ outlets (0-1) */
  corroboration_rate: number
  avg_reliability: number
  multi_source_rate: number
  /** share rated 0.6 or more (what "corroboration" used to count) */
  reliable_rate: number

  // Entity enrichment
  total_entities: number
  entities_with_edges: number
  /** % of the week's reports linked to an entity (null: not measured this time) */
  entity_coverage: number | null

  // Embedding coverage
  /** % of the week's reports with a fingerprint */
  embedding_coverage: number
  /** % of all reports with a fingerprint */
  embedding_coverage_all: number

  // Thread coverage
  active_threads: number
  signals_in_threads: number
  /** share of 30 days of reports in a story thread (0-1; null: not measured this time) */
  thread_coverage: number | null

  // Baseline coverage
  baseline_days: number
  anomalies_last_7d: number

  // Pattern intelligence
  causal_chains_discovered: number
  geographic_hotspots: number
  cross_cluster_bridges: number
  entity_links: number
  sensible_links: number
  links_claimed: number
  link_duplicates: number

  // Composite score (0-100)
  intelligence_score: number
  score_parts: ScorePart[]
  left_out: string[]
  computed_at: string
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

const QUALITY_KEY = 'cortex:quality:v2'
const HEALTH_KEY = 'cortex:health:v2'
const KEEP = { freshSeconds: 600, staleSeconds: 6 * 3600, lockSeconds: 300 }
const HEALTH_KEEP = { freshSeconds: 300, staleSeconds: 6 * 3600, lockSeconds: 300 }
const LONG_SECONDS = 120

function isTrx(q: Q): q is Knex.Transaction {
  return (q as { isTransaction?: boolean }).isTransaction === true
}

/**
 * Run part of a check inside a savepoint when `q` is a transaction: a failed
 * query aborts a Postgres transaction, and without the savepoint every query
 * after it would fail too.
 */
function guarded<T>(q: Q, run: (q: Q) => Promise<T>): Promise<T> {
  return isTrx(q) ? q.transaction(sp => run(sp)) : run(q)
}

/** Run one measure; null (left out) when it can't be read, never a made-up 0 */
async function measure<T>(q: Q, name: string, run: (q: Q) => Promise<T>): Promise<T | null> {
  try {
    return await guarded(q, run)
  } catch (err) {
    console.warn(`[CORTEX] metric "${name}" could not be read:`, String((err as Error)?.message ?? err).slice(0, 160))
    return null
  }
}

// ─── Subsystem Status Checks ────────────────────────────────────────────────

async function checkBaselineStatus(outer: Q): Promise<SubsystemStatus> {
  try {
    return await guarded<SubsystemStatus>(outer, async (q) => {
      const latest = await q('signal_baselines').orderBy('date', 'desc').select('date').first()
      const anomalyCount = await q('signal_anomalies')
        .where('date', '>=', q.raw("CURRENT_DATE - INTERVAL '7 days'"))
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
    })
  } catch (err) {
    return { name: 'statistical_baselines', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

async function checkThreadStatus(outer: Q): Promise<SubsystemStatus> {
  try {
    return await guarded<SubsystemStatus>(outer, async (q) => {
      const counts = await q('event_threads').select('status').count('* as count').groupBy('status')
      const statusMap: Record<string, number> = {}
      for (const r of counts as any[]) statusMap[r.status] = Number(r.count)

      // Redis heartbeat first — the scraper writes this every cycle even when idle
      const heartbeat = await redis.get('cortex:threads:heartbeat').catch(() => null)
      let heartbeatAlive = false
      if (heartbeat) {
        const heartbeatAge = (Date.now() - new Date(heartbeat).getTime()) / 60000
        heartbeatAlive = heartbeatAge <= 10 // 2 missed 5-minute cycles
      }

      // Threads updated from the past (a thread's own timestamps can sit hours ahead: see the time-zone note)
      const latest = await q('event_threads')
        .where('last_updated', '<=', q.raw("NOW() + INTERVAL '10 minutes'"))
        .orderBy('last_updated', 'desc')
        .select('last_updated')
        .first()

      const lastRun = heartbeat ?? latest?.last_updated?.toISOString?.() ?? null
      const hoursSinceThread = latest
        ? (Date.now() - new Date(latest.last_updated).getTime()) / 3600000
        : null

      let status: 'healthy' | 'degraded' | 'offline' = 'offline'
      if (heartbeatAlive) status = 'healthy'
      else if (hoursSinceThread !== null && hoursSinceThread <= 2) status = 'healthy'
      else if (hoursSinceThread !== null || heartbeat) status = 'degraded'

      return { name: 'event_threads', status, last_run: lastRun, last_output: statusMap, error: null }
    })
  } catch (err) {
    return { name: 'event_threads', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

async function checkEntityStatus(outer: Q): Promise<SubsystemStatus> {
  try {
    return await guarded<SubsystemStatus>(outer, async (q) => {
      const [entityCount, edgeCount, recentEntity] = await Promise.all([
        q('entity_nodes').count('* as count').first(),
        q('entity_edges').count('* as count').first(),
        q('entity_nodes').orderBy('last_seen', 'desc').select('last_seen').first(),
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
    })
  } catch (err) {
    return { name: 'entity_graph', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

async function checkEmbeddingStatus(outer: Q): Promise<SubsystemStatus> {
  try {
    return await guarded<SubsystemStatus>(outer, async (q) => {
      const stats = await q.raw(`
        SELECT
          COUNT(*) AS total,
          COUNT(embedding) AS with_embedding,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week_total,
          COUNT(embedding) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week_with
        FROM signals
      `)
      const row = stats.rows?.[0] ?? {}
      const total = Number(row.total ?? 0)
      const withEmb = Number(row.with_embedding ?? 0)
      const weekTotal = Number(row.week_total ?? 0)
      const weekWith = Number(row.week_with ?? 0)
      const coverage = total > 0 ? Math.round((withEmb / total) * 100) : 0
      const weekCoverage = weekTotal > 0 ? Math.round((weekWith / weekTotal) * 100) : 0
      return {
        name: 'embeddings',
        // judged on this week's reports: old coverage hides a fingerprinting that has stopped
        status: weekCoverage > 50 ? 'healthy' : weekCoverage > 10 ? 'degraded' : 'offline',
        last_run: null,
        last_output: {
          total_signals: total,
          with_embedding: withEmb,
          coverage_pct: coverage,
          week_coverage_pct: weekCoverage,
        },
        error: null,
      }
    })
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
    const links = sensibleLinks(report)
    const ageHours = report.generated_at ? (Date.now() - new Date(report.generated_at).getTime()) / 3600000 : null
    return {
      name: 'pattern_detection',
      status: ageHours !== null && ageHours <= 6 ? 'healthy' : 'degraded',
      last_run: report.generated_at ?? null,
      last_output: {
        causal_chains: report.causal_chains?.length ?? 0,
        bridges: report.cross_cluster_bridges?.length ?? 0,
        hotspots: report.geographic_hotspots?.length ?? 0,
        entity_links: report.entity_links?.length ?? 0,
        share_a_subject: links.sensible,
      },
      error: null,
    }
  } catch (err) {
    return { name: 'pattern_detection', status: 'offline', last_run: null, last_output: {}, error: String(err) }
  }
}

// ─── Intelligence Quality Scoring ───────────────────────────────────────────

/**
 * Compute the intelligence quality measures and the composite score (0-100).
 * Runs every query on `q`; pass a transaction from `longQuery` for a longer
 * time limit. Most callers want the kept copy: `getIntelligenceQuality()`.
 */
export async function computeIntelligenceQuality(q: Q = db): Promise<IntelligenceQuality> {
  const signalStats = await measure(q, 'signals', c => c.raw(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE source_count >= 2) AS multi_source,
        COUNT(*) FILTER (WHERE reliability_score >= 0.6) AS reliable,
        COALESCE(AVG(reliability_score), 0) AS avg_reliability
      FROM signals
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `).then((r: any) => r.rows?.[0] ?? {}))

  const entityStats = await measure(q, 'entities', c => c.raw(`
      SELECT
        COUNT(*) AS total_entities,
        COUNT(*) FILTER (WHERE id IN (SELECT source_entity_id FROM entity_edges UNION SELECT target_entity_id FROM entity_edges)) AS with_edges
      FROM entity_nodes
    `).then((r: any) => r.rows?.[0] ?? {}))

  // Entity coverage: the share of the week's reports that a named person, place or
  // organisation points to (entity_nodes.signal_ids holds report ids as text)
  const entityCoverage = await measure(q, 'entity coverage', c => c.raw(`
      WITH recent AS (
        SELECT id::text AS sid FROM signals WHERE created_at >= NOW() - INTERVAL '7 days'
      ),
      linked AS (
        SELECT DISTINCT lower(u.sid) AS sid
        FROM entity_nodes en
        CROSS JOIN LATERAL unnest(en.signal_ids) AS u(sid)
        WHERE en.last_seen >= NOW() - INTERVAL '8 days'
      )
      SELECT COUNT(*) FILTER (WHERE r.sid IN (SELECT sid FROM linked))::float / GREATEST(COUNT(*), 1) * 100 AS coverage
      FROM recent r
    `).then((r: any) => Number(r.rows?.[0]?.coverage ?? 0)))

  const embedding = await measure(q, 'embeddings', c => c.raw(`
      SELECT
        COUNT(embedding)::float / GREATEST(COUNT(*), 1) * 100 AS all_cov,
        COUNT(embedding) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::float
          / GREATEST(COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 1) * 100 AS week_cov
      FROM signals
    `).then((r: any) => ({ all: Number(r.rows?.[0]?.all_cov ?? 0), week: Number(r.rows?.[0]?.week_cov ?? 0) })))

  // Thread coverage, like for like: 30 days of reports in a thread / 30 days of reports
  const threads = await measure(q, 'threads', c => c.raw(`
      SELECT
        (SELECT COUNT(*) FROM event_threads WHERE status IN ('developing', 'escalating')) AS active_threads,
        (SELECT COUNT(DISTINCT signal_id) FROM event_thread_signals) AS signals_in_threads,
        (SELECT COUNT(DISTINCT ets.signal_id)
           FROM event_thread_signals ets
           JOIN signals s ON s.id = ets.signal_id
          WHERE s.created_at >= NOW() - INTERVAL '30 days') AS recent_in_threads
    `).then((r: any) => r.rows?.[0] ?? {}))

  const baselines = await measure(q, 'baselines', c => c.raw(`
      SELECT
        (SELECT COUNT(DISTINCT date) FROM signal_baselines) AS baseline_days,
        (SELECT COUNT(*) FROM signal_anomalies WHERE date >= CURRENT_DATE - INTERVAL '7 days') AS anomalies_7d
    `).then((r: any) => r.rows?.[0] ?? {}))

  const patternReport = await redis.get('cortex:patterns:latest').then(c => (c ? JSON.parse(c) : null)).catch(() => null)

  const totalSignals = Number(signalStats?.total ?? 0)
  const multiSource = Number(signalStats?.multi_source ?? 0)
  const reliable = Number(signalStats?.reliable ?? 0)
  const avgReliability = Number(signalStats?.avg_reliability ?? 0)
  const multiSourceRate = totalSignals > 0 ? multiSource / totalSignals : 0
  const reliableRate = totalSignals > 0 ? reliable / totalSignals : 0

  const recentInThreads = threads ? Number(threads.recent_in_threads ?? 0) : null
  const threadCoverage = recentInThreads == null || totalSignals === 0 ? null : Math.min(1, recentInThreads / totalSignals)

  const links = sensibleLinks(patternReport)
  const scored = honestScore({
    multiSourceRate,
    avgReliability,
    embeddingCoverage: embedding?.week ?? 0,
    entityCoverage,
    threadCoverage,
    baselineDays: Number(baselines?.baseline_days ?? 0),
    sensibleLinks: links.sensible,
    linksClaimed: links.total,
  })

  return {
    total_signals: totalSignals,
    corroborated_signals: multiSource,
    corroboration_rate: round3(multiSourceRate),
    avg_reliability: round3(avgReliability),
    multi_source_rate: round3(multiSourceRate),
    reliable_rate: round3(reliableRate),

    total_entities: Number(entityStats?.total_entities ?? 0),
    entities_with_edges: Number(entityStats?.with_edges ?? 0),
    entity_coverage: entityCoverage == null ? null : Math.round(entityCoverage * 10) / 10,

    embedding_coverage: Math.round((embedding?.week ?? 0) * 10) / 10,
    embedding_coverage_all: Math.round((embedding?.all ?? 0) * 10) / 10,

    active_threads: Number(threads?.active_threads ?? 0),
    signals_in_threads: Number(threads?.signals_in_threads ?? 0),
    thread_coverage: threadCoverage == null ? null : round3(threadCoverage),

    baseline_days: Number(baselines?.baseline_days ?? 0),
    anomalies_last_7d: Number(baselines?.anomalies_7d ?? 0),

    causal_chains_discovered: patternReport?.causal_chains?.length ?? 0,
    geographic_hotspots: patternReport?.geographic_hotspots?.length ?? 0,
    cross_cluster_bridges: patternReport?.cross_cluster_bridges?.length ?? 0,
    entity_links: patternReport?.entity_links?.length ?? 0,
    sensible_links: links.sensible,
    links_claimed: links.total,
    link_duplicates: links.duplicates,

    intelligence_score: scored.score,
    score_parts: scored.parts,
    left_out: scored.left_out,
    computed_at: new Date().toISOString(),
  }
}

/** The kept intelligence measures: answered at once, remade in the background every 10 minutes */
export function getIntelligenceQuality(): Promise<IntelligenceQuality> {
  return staleWhileRevalidate(QUALITY_KEY, KEEP, () => longQuery(LONG_SECONDS, trx => computeIntelligenceQuality(trx)))
}

// ─── Full Cortex Health ─────────────────────────────────────────────────────

async function buildCortexHealth(q: Q): Promise<CortexHealth> {
  const subsystems = [
    await checkBaselineStatus(q),
    await checkThreadStatus(q),
    await checkEntityStatus(q),
    await checkEmbeddingStatus(q),
    await checkPatternStatus(),
  ]
  const quality = await getIntelligenceQuality()

  const pipelineRow = await measure(q, 'pipeline', c => c.raw(`
      SELECT
        (SELECT COUNT(*) FROM signals WHERE created_at >= NOW() - INTERVAL '24 hours') AS d24,
        (SELECT COUNT(*) FROM signals WHERE created_at >= NOW() - INTERVAL '7 days') AS d7,
        (SELECT COUNT(*) FROM sources WHERE active = true) AS sources
    `).then((r: any) => r.rows?.[0] ?? {}))
  const d24 = Number(pipelineRow?.d24 ?? 0)

  // healthy if all subsystems are healthy, degraded if any is not, offline if most are offline
  const offlineCount = subsystems.filter(s => s.status === 'offline').length
  const degradedCount = subsystems.filter(s => s.status === 'degraded').length
  const status: CortexHealth['status'] =
    offlineCount >= 3 ? 'offline' : offlineCount > 0 || degradedCount > 0 ? 'degraded' : 'healthy'

  return {
    status,
    subsystems,
    intelligence_quality: quality,
    pipeline_stats: {
      signals_24h: d24,
      signals_7d: Number(pipelineRow?.d7 ?? 0),
      sources_active: Number(pipelineRow?.sources ?? 0),
      avg_signals_per_hour: Math.round(d24 / 24),
    },
    generated_at: new Date().toISOString(),
  }
}

/**
 * Comprehensive Cortex health check — all subsystem statuses, the intelligence
 * quality score and pipeline throughput. Kept: answered at once, remade in the
 * background every 5 minutes with a longer time limit.
 */
export function getCortexHealth(): Promise<CortexHealth> {
  return staleWhileRevalidate(HEALTH_KEY, HEALTH_KEEP, () => longQuery(LONG_SECONDS, trx => buildCortexHealth(trx)))
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
