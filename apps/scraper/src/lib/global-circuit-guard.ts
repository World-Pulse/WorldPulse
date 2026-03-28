/**
 * Global circuit breaker guard.
 *
 * Aggregates the open/closed state across all health-tracked sources and
 * surfaces a system-level health signal. When a large fraction of circuits
 * are OPEN it is likely an infrastructure problem (network partition, upstream
 * provider outage) rather than an isolated source failure.
 *
 *  healthy   — < DEGRADED_THRESHOLD of sources OPEN (< 20%)
 *  degraded  — ≥ 20% and < 40% of sources OPEN
 *  critical  — ≥ 40% of sources OPEN
 *  unknown   — health index unavailable (Redis down, empty set)
 *
 * Designed to run on the same interval as logHealthSummary() so operators
 * have a single-line aggregate alongside per-source detail.
 */

import { getCircuitState, CircuitStatus } from './circuit-breaker.js'
import { logger }                          from './logger.js'
import { redis }                           from './redis.js'

const DEGRADED_THRESHOLD = 0.20   // 20% of tracked sources OPEN
const CRITICAL_THRESHOLD = 0.40   // 40% of tracked sources OPEN

/** Shared Redis set populated by health.ts (recordSuccess / recordFailure). */
const HEALTH_INDEX_KEY = 'scraper:health:index'

export type GlobalCircuitStatus = 'healthy' | 'degraded' | 'critical' | 'unknown'

export interface GlobalCircuitHealth {
  status:        GlobalCircuitStatus
  openCount:     number
  halfOpenCount: number
  closedCount:   number
  totalTracked:  number
  /** Fraction of tracked sources that are OPEN (0–1). */
  openFraction:  number
}

/**
 * Reads all circuit states from Redis and returns an aggregate health view.
 * Logs a warning when degraded and an error when critical.
 *
 * Never throws — returns `{ status: 'unknown' }` if Redis is unavailable.
 */
export async function checkGlobalCircuitHealth(): Promise<GlobalCircuitHealth> {
  let sourceIds: string[]
  try {
    sourceIds = await redis.smembers(HEALTH_INDEX_KEY)
  } catch {
    return {
      status: 'unknown', openCount: 0, halfOpenCount: 0,
      closedCount: 0, totalTracked: 0, openFraction: 0,
    }
  }

  if (sourceIds.length === 0) {
    return {
      status: 'healthy', openCount: 0, halfOpenCount: 0,
      closedCount: 0, totalTracked: 0, openFraction: 0,
    }
  }

  const states = await Promise.all(
    sourceIds.map(id => getCircuitState(id).catch(() => null)),
  )

  let openCount     = 0
  let halfOpenCount = 0
  let closedCount   = 0

  for (const state of states) {
    if (!state) continue
    if (state.status === CircuitStatus.OPEN)       openCount++
    else if (state.status === CircuitStatus.HALF_OPEN) halfOpenCount++
    else                                               closedCount++
  }

  const totalTracked = openCount + halfOpenCount + closedCount
  const openFraction = totalTracked > 0 ? openCount / totalTracked : 0

  let status: GlobalCircuitStatus
  if (openFraction >= CRITICAL_THRESHOLD) {
    status = 'critical'
  } else if (openFraction >= DEGRADED_THRESHOLD) {
    status = 'degraded'
  } else {
    status = 'healthy'
  }

  const meta = {
    openCount,
    halfOpenCount,
    closedCount,
    totalTracked,
    openFraction: Number(openFraction.toFixed(3)),
  }

  if (status === 'critical') {
    logger.error(
      meta,
      'Global circuit guard: CRITICAL — infrastructure-level failure likely',
    )
  } else if (status === 'degraded') {
    logger.warn(
      meta,
      'Global circuit guard: DEGRADED — elevated source failures',
    )
  } else {
    logger.debug(meta, 'Global circuit guard: healthy')
  }

  return { status, ...meta }
}
