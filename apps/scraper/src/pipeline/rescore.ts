/**
 * Delayed Corroboration Re-Scorer
 *
 * Runs every 30 minutes. Finds signals inserted 30–90 minutes ago that are
 * still single-source (source_count = 1, no cluster). For each, re-runs the
 * correlator to check if new corroborating signals have arrived since the
 * original insert.
 *
 * Why this matters: breaking news typically gets picked up by 3-5 wire
 * syndication outlets within 30-60 minutes. At insert time, only the first
 * outlet has published, so the signal starts as single-source. This job
 * catches the corroboration window after multiple outlets have reported.
 *
 * When corroboration is found:
 *   - source_count is updated to reflect the cluster size
 *   - reliability_score gets the corroboration boost
 *   - severity cap may be lifted (e.g., medium → high if now 2+ sources)
 *   - The signal becomes eligible for higher feed tiers
 *
 * @module pipeline/rescore
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger as rootLogger } from '../lib/logger'
import { correlateSignal, type CorrelationCandidate } from './correlate'
import { maxSeverityForSourceCount } from './reliability-score'
import { sourceKey } from './signal-columns'

const log = rootLogger.child({ module: 'rescore' })

/** How far back to look for single-source signals (ms) */
const RESCORE_WINDOW_MIN_MS = 30 * 60 * 1000   // 30 minutes ago
const RESCORE_WINDOW_MAX_MS = 120 * 60 * 1000   // 2 hours ago (wider window for slow news cycles)
const RESCORE_BATCH_SIZE = 50
const RESCORE_REDIS_PREFIX = 'rescore:checked:'
const RESCORE_TTL_S = 4 * 3600  // Don't re-check same signal for 4 hours

/**
 * Run the delayed corroboration re-scoring pass.
 *
 * Returns the number of signals that gained corroboration.
 */
export async function runDelayedRescore(): Promise<{
  checked: number
  corroborated: number
  upgraded: number
}> {
  const now = Date.now()
  const windowStart = new Date(now - RESCORE_WINDOW_MAX_MS)
  const windowEnd = new Date(now - RESCORE_WINDOW_MIN_MS)

  // Find single-source signals in the rescore window that haven't been
  // checked recently and don't already belong to a cluster
  const candidates = await db('signals')
    .select(
      'id', 'title', 'category', 'severity',
      db.raw('source_ids[1]::text as source_id'),
      db.raw('original_urls[1] as first_url'),
      'location_name', 'reliability_score', 'tags',
      db.raw('COALESCE(event_time, created_at) as published_at'),
      'source_count',
      db.raw('ST_Y(location::geometry) as lat'),
      db.raw('ST_X(location::geometry) as lng'),
    )
    // created_at, not published_at: new rows had no published_at until Oct 2026
    .where('created_at', '>=', windowStart.toISOString())
    .where('created_at', '<=', windowEnd.toISOString())
    .where(function () {
      this.where('source_count', '<=', 1).orWhereNull('source_count')
    })
    .whereNull('last_corroborated_at')
    .orderBy('created_at', 'desc')
    .limit(RESCORE_BATCH_SIZE)

  if (candidates.length === 0) {
    return { checked: 0, corroborated: 0, upgraded: 0 }
  }

  // Filter out signals we've already checked recently (Redis dedup)
  const unchecked: typeof candidates = []
  for (const c of candidates) {
    const key = `${RESCORE_REDIS_PREFIX}${c.id}`
    const seen = await redis.get(key)
    if (!seen) {
      unchecked.push(c)
    }
  }

  if (unchecked.length === 0) {
    return { checked: candidates.length, corroborated: 0, upgraded: 0 }
  }

  let corroborated = 0
  let upgraded = 0

  for (const signal of unchecked) {
    // Mark as checked so we don't re-process
    await redis.setex(`${RESCORE_REDIS_PREFIX}${signal.id}`, RESCORE_TTL_S, '1')

    const candidate: CorrelationCandidate = {
      id: signal.id,
      title: signal.title,
      category: signal.category,
      severity: signal.severity,
      source_id: sourceKey(signal.source_id, signal.first_url),
      location_name: signal.location_name,
      lat: signal.lat ? Number(signal.lat) : null,
      lng: signal.lng ? Number(signal.lng) : null,
      published_at: signal.published_at,
      reliability_score: Number(signal.reliability_score ?? 0.5),
      tags: Array.isArray(signal.tags) ? signal.tags : [],
    }

    try {
      // correlateSignal raises source_count itself when other outlets report
      // the same story (correlate.ts isSameStory). A cluster of merely related
      // signals is not corroboration, so its size and sources are not used here.
      await correlateSignal(candidate)
      const row = await db('signals').where('id', signal.id).first('source_count') as { source_count?: number } | undefined
      const newSourceCount = Number(row?.source_count ?? 1)

      if (newSourceCount >= 2) {
        corroborated++

        // Check if severity can be upgraded now that we have corroboration
        const maxSev = maxSeverityForSourceCount(newSourceCount, signal.category)
        const SEVERITY_RANK: Record<string, number> = {
          critical: 4, high: 3, medium: 2, low: 1, info: 0,
        }
        const currentRank = SEVERITY_RANK[signal.severity] ?? 1
        const maxRank = SEVERITY_RANK[maxSev] ?? 4

        // If severity was previously capped and now qualifies for upgrade,
        // check if the original signal content warranted higher severity
        if (currentRank < maxRank && newSourceCount >= 2) {
          // Upgrade medium → high for corroborated signals in strategic categories
          const strategicCategories = new Set([
            'conflict', 'geopolitics', 'security', 'disaster',
            'health', 'breaking', 'economy',
          ])
          if (signal.severity === 'medium' && strategicCategories.has(signal.category)) {
            await db('signals')
              .where('id', signal.id)
              .update({ severity: 'high' })
            upgraded++
            log.info({
              signalId: signal.id,
              title: signal.title.slice(0, 80),
              oldSeverity: signal.severity,
              newSeverity: 'high',
              sourceCount: newSourceCount,
            }, 'Severity upgraded after delayed corroboration')
          }
        }

        log.info({
          signalId: signal.id,
          title: signal.title.slice(0, 80),
          sources: newSourceCount,
        }, 'Delayed corroboration found — signal now multi-source')
      }
    } catch (err) {
      log.warn({ err, signalId: signal.id }, 'Rescore correlation failed for signal')
    }
  }

  log.info({
    checked: unchecked.length,
    corroborated,
    upgraded,
    windowMinutes: `${RESCORE_WINDOW_MIN_MS / 60000}-${RESCORE_WINDOW_MAX_MS / 60000}`,
  }, 'Delayed rescore pass complete')

  return {
    checked: unchecked.length,
    corroborated,
    upgraded,
  }
}
