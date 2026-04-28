/**
 * Cortex — WorldPulse Intelligence Engine
 *
 * Central nervous system for the intelligence platform.
 * Each subsystem operates independently on its own schedule,
 * but this index provides a unified import surface and
 * the ability to run a full diagnostic.
 *
 * Subsystems:
 *   1.6.1 — Statistical Baselines (nightly, 3am UTC)
 *   1.6.2 — Event Threads (every 30min)
 *   1.6.3 — Entity Strengthening (nightly, 4am UTC)
 *   1.6.4 — Semantic Embeddings (on-insert + backfill)
 *   1.6.5 — Cross-Domain Pattern Detection (weekly, Sunday 5am UTC)
 *   1.6.6 — Cortex Metrics & Health (on-demand)
 *
 * @module cortex
 */

// Re-export all subsystems
export { computeDailyBaselines, getBaselineStats, detectAnomalies, runNightlyBaselines, backfillBaselines } from './baselines'
export { runEventThreadsCycle } from './event-threads'
export { runEntityStrengtheningCycle } from './entity-strengthen'
export { embedSignal, findSimilarSignals, semanticSearch, checkSemanticDuplicate, backfillEmbeddings, getEmbeddingStats } from './embeddings'
export { runPatternDetectionCycle, learnCausalChains, detectCrossClusterBridges, detectGeographicHotspots } from './pattern-detection'
export { getCortexHealth, computeIntelligenceQuality } from './metrics'

// ─── Full Cortex Diagnostic ─────────────────────────────────────────────────

/**
 * Run a full diagnostic of all Cortex subsystems.
 * Used by the brain agent for its daily reflection.
 */
export async function runCortexDiagnostic(): Promise<{
  health: Awaited<ReturnType<typeof import('./metrics').getCortexHealth>>
  summary: string
}> {
  const { getCortexHealth } = await import('./metrics')
  const health = await getCortexHealth()

  const q = health.intelligence_quality
  const lines = [
    `Cortex Status: ${health.status.toUpperCase()}`,
    `Intelligence Score: ${q.intelligence_score}/100`,
    `Pipeline: ${health.pipeline_stats.signals_24h} signals/24h from ${health.pipeline_stats.sources_active} sources`,
    `Corroboration: ${Math.round(q.corroboration_rate * 100)}% | Reliability: ${Math.round(q.avg_reliability * 100)}%`,
    `Entities: ${q.total_entities} (${q.entities_with_edges} with edges, ${Math.round(q.entity_coverage)}% coverage)`,
    `Embeddings: ${Math.round(q.embedding_coverage)}% coverage`,
    `Threads: ${q.active_threads} active (${q.signals_in_threads} signals)`,
    `Baselines: ${q.baseline_days} days | Anomalies (7d): ${q.anomalies_last_7d}`,
    `Patterns: ${q.causal_chains_discovered} chains, ${q.geographic_hotspots} hotspots, ${q.cross_cluster_bridges} bridges`,
    '',
    'Subsystems:',
    ...health.subsystems.map(s => `  ${s.status === 'healthy' ? '✓' : s.status === 'degraded' ? '⚠' : '✗'} ${s.name}: ${s.status}`),
  ]

  return {
    health,
    summary: lines.join('\n'),
  }
}
