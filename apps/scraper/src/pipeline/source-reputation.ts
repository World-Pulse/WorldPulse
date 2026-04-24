/**
 * Source Reputation Scoring
 *
 * Tracks each source's accuracy over a rolling 30-day window:
 *   - corroboration_rate: % of signals that got multi-source corroboration
 *   - dispute_rate: % of signals that were flagged by users
 *   - computed_reliability: auto-adjusted reliability score
 *
 * Sources with high dispute rates get their base reliability reduced.
 * Sources with high corroboration rates get a small bonus.
 *
 * Runs as a periodic job in the scraper (every 6 hours).
 */

import { db } from '../lib/postgres'
import { logger as rootLogger } from '../lib/logger'

const log = rootLogger.child({ module: 'source-reputation' })

const WINDOW_DAYS = 30
const MIN_SIGNALS_FOR_ADJUSTMENT = 10

// Thresholds for auto-adjustment
const HIGH_DISPUTE_THRESHOLD = 0.15    // 15%+ disputed → reduce reliability
const LOW_CORROBORATION_THRESHOLD = 0.05 // <5% corroborated → slight reduction
const HIGH_CORROBORATION_THRESHOLD = 0.30 // 30%+ corroborated → bonus

const MAX_PENALTY = -0.15
const MAX_BONUS = 0.05

/**
 * Recompute reputation scores for all sources.
 * Called every 6 hours by the scraper.
 */
export async function recomputeSourceReputation(): Promise<{
  sourcesUpdated: number
  adjustments: number
}> {
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

  // Get all distinct sources with their signal counts
  const sourceStats = await db('signals')
    .select(db.raw('source_ids[1]::text as source_id'))
    .count('id as total_signals')
    .select(db.raw(`COUNT(*) FILTER (WHERE source_count >= 2) as corroborated`))
    .where('published_at', '>=', windowStart.toISOString())
    .whereRaw('array_length(source_ids, 1) > 0')
    .groupByRaw('source_ids[1]::text')
    .having(db.raw('COUNT(id) >= ?', [3]))

  // Get dispute counts per source
  const disputeStats = await db('signal_disputes')
    .join('signals', 'signal_disputes.signal_id', 'signals.id')
    .select(db.raw('signals.source_ids[1]::text as source_id'))
    .count('signal_disputes.id as disputed')
    .where('signal_disputes.created_at', '>=', windowStart.toISOString())
    .whereIn('signal_disputes.status', ['pending', 'accepted'])
    .groupByRaw('signals.source_ids[1]::text')

  const disputeMap = new Map(disputeStats.map((r: any) => [r.source_id, Number(r.disputed)]))

  // Get source names
  const sourceNames = await db('sources')
    .select('id', 'name', 'reliability')

  const nameMap = new Map(sourceNames.map((s: any) => [String(s.id), { name: s.name, reliability: Number(s.reliability) }]))

  let sourcesUpdated = 0
  let adjustments = 0

  for (const stat of sourceStats) {
    const sourceId = stat.source_id as string
    const total = Number(stat.total_signals)
    const corroborated = Number(stat.corroborated)
    const disputed = disputeMap.get(sourceId) ?? 0

    const corroborationRate = total > 0 ? corroborated / total : 0
    const disputeRate = total > 0 ? disputed / total : 0

    const sourceInfo = nameMap.get(sourceId)
    const baseReliability = sourceInfo?.reliability ?? 0.5
    const sourceName = sourceInfo?.name ?? `source-${sourceId}`

    // Compute reliability adjustment
    let adjustment = 0
    let reason = ''

    if (total >= MIN_SIGNALS_FOR_ADJUSTMENT) {
      // High dispute rate → penalize
      if (disputeRate > HIGH_DISPUTE_THRESHOLD) {
        adjustment = Math.max(MAX_PENALTY, -(disputeRate - HIGH_DISPUTE_THRESHOLD) * 0.5)
        reason = `High dispute rate: ${(disputeRate * 100).toFixed(1)}%`
      }

      // Low corroboration → slight penalty
      if (corroborationRate < LOW_CORROBORATION_THRESHOLD && total >= 20) {
        const corrobPenalty = -0.03
        adjustment = Math.max(MAX_PENALTY, adjustment + corrobPenalty)
        if (reason) reason += '; '
        reason += `Low corroboration: ${(corroborationRate * 100).toFixed(1)}%`
      }

      // High corroboration → small bonus
      if (corroborationRate > HIGH_CORROBORATION_THRESHOLD) {
        const bonus = Math.min(MAX_BONUS, (corroborationRate - HIGH_CORROBORATION_THRESHOLD) * 0.1)
        adjustment = Math.min(MAX_BONUS, adjustment + bonus)
        if (reason) reason += '; '
        reason += `High corroboration: ${(corroborationRate * 100).toFixed(1)}%`
      }
    }

    const computedReliability = Math.max(0.05, Math.min(0.99, baseReliability + adjustment))

    // Upsert source_reputation record
    await db.raw(`
      INSERT INTO source_reputation (source_id, source_name, total_signals, corroborated, disputed,
        corroboration_rate, dispute_rate, computed_reliability, base_reliability,
        reliability_adjustment, last_adjustment_reason, window_start, window_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON CONFLICT (source_id) DO UPDATE SET
        source_name = EXCLUDED.source_name,
        total_signals = EXCLUDED.total_signals,
        corroborated = EXCLUDED.corroborated,
        disputed = EXCLUDED.disputed,
        corroboration_rate = EXCLUDED.corroboration_rate,
        dispute_rate = EXCLUDED.dispute_rate,
        computed_reliability = EXCLUDED.computed_reliability,
        reliability_adjustment = EXCLUDED.reliability_adjustment,
        last_adjustment_reason = EXCLUDED.last_adjustment_reason,
        window_start = EXCLUDED.window_start,
        window_end = NOW(),
        updated_at = NOW()
    `, [
      sourceId, sourceName, total, corroborated, disputed,
      corroborationRate, disputeRate, computedReliability, baseReliability,
      adjustment, reason || null, windowStart.toISOString(),
    ])

    sourcesUpdated++
    if (Math.abs(adjustment) > 0.001) {
      adjustments++
      log.info({
        sourceId,
        sourceName,
        total,
        corroborationRate: +(corroborationRate * 100).toFixed(1),
        disputeRate: +(disputeRate * 100).toFixed(1),
        adjustment: +adjustment.toFixed(3),
        computedReliability: +computedReliability.toFixed(3),
        reason,
      }, 'Source reliability adjusted')
    }
  }

  log.info({ sourcesUpdated, adjustments }, 'Source reputation recomputation complete')
  return { sourcesUpdated, adjustments }
}
