/**
 * Shared Signal Insertion Helper
 *
 * Provides a unified function for OSINT source pollers to insert signals
 * and automatically run cross-source event correlation. This ensures every
 * signal — whether from RSS-based scrapers or OSINT API pollers — flows
 * through the correlation engine.
 *
 * Usage:
 *   import { insertAndCorrelate } from '../pipeline/insert-signal'
 *
 *   const signal = await insertAndCorrelate({
 *     title, summary, category, severity, reliability_score,
 *     source_count: 1, source_ids: [sourceId],
 *     location: db.raw(`ST_MakePoint(?, ?)`, [lng, lat]),
 *     location_name, country_code, region, tags,
 *     language: 'en', event_time: new Date(pubDate),
 *   }, { lat, lng, sourceId })
 *
 * @module pipeline/insert-signal
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { correlateSignal } from './correlate'
import type { CorrelationCandidate } from './correlate'

/** Extra metadata not in the DB row but needed for correlation */
export interface CorrelationMeta {
  lat?: number | null
  lng?: number | null
  sourceId: string
}

/**
 * Insert a signal into the database and run correlation.
 *
 * @param signalData - Columns for the `signals` table insert
 * @param meta - Lat/lng and sourceId for correlation scoring
 * @returns The inserted signal row (with id)
 */
export async function insertAndCorrelate(
  signalData: Record<string, unknown>,
  meta: CorrelationMeta,
): Promise<Record<string, unknown>> {
  // 1. Insert the signal
  const [signal] = await db('signals').insert(signalData).returning('*')

  // 2. Run cross-source correlation (non-blocking — errors are non-fatal)
  try {
    const candidate: CorrelationCandidate = {
      id:               String(signal.id),
      title:            String(signal.title ?? ''),
      category:         String(signal.category ?? ''),
      severity:         String(signal.severity ?? 'low'),
      source_id:        meta.sourceId,
      location_name:    signal.location_name ?? null,
      lat:              meta.lat ?? null,
      lng:              meta.lng ?? null,
      published_at:     signal.event_time ?? signal.created_at ?? new Date(),
      reliability_score: Number(signal.reliability_score ?? 0.5),
      tags:             Array.isArray(signal.tags) ? signal.tags : [],
    }

    const cluster = await correlateSignal(candidate)

    if (cluster) {
      logger.info({
        signalId:    signal.id,
        clusterId:   cluster.cluster_id,
        clusterSize: cluster.signal_ids.length,
        corrType:    cluster.correlation_type,
        corrScore:   cluster.correlation_score.toFixed(2),
      }, 'OSINT signal correlated into event cluster')
    }
  } catch (err) {
    logger.warn({ err, signalId: signal.id }, 'OSINT signal correlation failed (non-fatal)')
  }

  // 3. Publish signal for breaking alert evaluation (API-side handler)
  try {
    const severity = String(signal.severity ?? 'low')
    const reliabilityScore = Number(signal.reliability_score ?? 0)
    if ((severity === 'critical' || severity === 'high') && reliabilityScore >= 0.6) {
      await redis.publish('wp:signal.new', JSON.stringify({
        event: 'signal.new',
        payload: {
          id:               String(signal.id),
          title:            String(signal.title ?? ''),
          category:         String(signal.category ?? ''),
          severity,
          reliability_score: reliabilityScore,
          location_name:    signal.location_name ?? undefined,
          country_code:     signal.country_code ?? undefined,
          source_url:       signal.source_url ?? undefined,
          created_at:       signal.created_at ?? new Date().toISOString(),
        },
      }))
    }
  } catch (err) {
    logger.debug({ err, signalId: signal.id }, 'Failed to publish signal for breaking alert (non-fatal)')
  }

  return signal
}
