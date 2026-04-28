/**
 * Scraper Stability Tracker
 *
 * Tracks the 14-consecutive-day stability clock required for Gate 1 launch.
 * An "hour" is clean if:
 *   - ≥70% of tracked sources had last_seen within the hour window (≥1 successful poll)
 *   - Zero unhandled process-level exceptions occurred during the hour
 *
 * Redis keys written:
 *   scraper:stability:consecutive_clean_hours  — integer streak counter
 *   scraper:stability:last_failure_at          — ISO timestamp of last failed hour
 *   scraper:stability:status                   — 'stable' | 'degraded' | 'failed'
 *   scraper:stability:exceptions:{YYYY-MM-DDTHH} — per-hour exception counter (TTL 2h)
 *
 * Target: 336 consecutive clean hours (14 days × 24 h)
 */

import { redis } from './redis'
import { logger } from './logger'

// ─── Constants ────────────────────────────────────────────────────────────────

export const TARGET_HOURS = 336 // 14 days

/** Fraction of sources that must be active for a clean hour */
export const CLEAN_SOURCE_THRESHOLD = 0.70

// Redis key constants — also consumed by the API route
export const STABILITY_KEYS = {
  CONSECUTIVE_CLEAN_HOURS: 'scraper:stability:consecutive_clean_hours',
  LAST_FAILURE_AT:         'scraper:stability:last_failure_at',
  STATUS:                  'scraper:stability:status',
  EXCEPTIONS_PREFIX:       'scraper:stability:exceptions:',
} as const

const HEALTH_INDEX_KEY = 'scraper:health:index'
const HEALTH_KEY       = (sourceId: string) => `scraper:health:${sourceId}`

// ─── Types ────────────────────────────────────────────────────────────────────

export type StabilityStatus = 'stable' | 'degraded' | 'failed'

export interface CleanHourEvaluation {
  clean:             boolean
  activeSourceCount: number
  totalSourceCount:  number
  activePercent:     number
  exceptionCount:    number
  hourBucket:        string
  failureReason:     string | null
}

export interface StabilityState {
  consecutive_clean_hours:   number
  target_hours:              number
  percent_to_gate:           number
  status:                    StabilityStatus
  last_failure_at:           string | null
  estimated_gate_clear_date: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the current hour bucket string (e.g. "2026-03-25T10").
 * Exported for testability.
 */
export function currentHourBucket(now = new Date()): string {
  return now.toISOString().slice(0, 13) // "YYYY-MM-DDTHH"
}

// ─── Exception tracking ───────────────────────────────────────────────────────

/**
 * Increment the unhandled-exception counter for the current hour.
 * Call this from process.on('uncaughtException') and 'unhandledRejection'
 * hooks so that the stability evaluator can detect process-level failures.
 */
export async function recordUnhandledException(reason: string): Promise<void> {
  const bucket = currentHourBucket()
  const key    = `${STABILITY_KEYS.EXCEPTIONS_PREFIX}${bucket}`
  const pipe   = redis.pipeline()
  pipe.incr(key)
  pipe.expire(key, 2 * 3_600) // keep for 2 hours — one full evaluation cycle
  await pipe.exec()
  logger.warn({ reason, bucket }, '[STABILITY] Unhandled exception recorded')
}

/**
 * Return the exception count for a given hour bucket (defaults to now).
 */
export async function getExceptionCountForHour(bucket?: string): Promise<number> {
  const b   = bucket ?? currentHourBucket()
  const val = await redis.get(`${STABILITY_KEYS.EXCEPTIONS_PREFIX}${b}`)
  return parseInt(val ?? '0', 10)
}

// ─── Clean-hour evaluation ────────────────────────────────────────────────────

/**
 * Evaluate whether the current hour qualifies as "clean".
 *
 * A clean hour requires both:
 *   1. ≥70% of tracked sources had last_seen within the hour window
 *   2. Zero unhandled exceptions in the current hour bucket
 */
export async function evaluateCleanHour(now = new Date()): Promise<CleanHourEvaluation> {
  const hourBucket   = currentHourBucket(now)
  const hourStartMs  = new Date(`${hourBucket}:00:00.000Z`).getTime()

  const sourceIds      = await redis.smembers(HEALTH_INDEX_KEY)
  const totalSourceCount = sourceIds.length

  if (totalSourceCount === 0) {
    return {
      clean:             false,
      activeSourceCount: 0,
      totalSourceCount:  0,
      activePercent:     0,
      exceptionCount:    0,
      hourBucket,
      failureReason:     'No sources tracked yet',
    }
  }

  // Fetch last_seen for all sources in parallel
  const lastSeenValues = await Promise.all(
    sourceIds.map((id: string) => redis.hget(HEALTH_KEY(id), 'last_seen')),
  )

  let activeSourceCount = 0
  for (const lastSeen of lastSeenValues) {
    if (lastSeen) {
      const seenMs = new Date(lastSeen).getTime()
      if (seenMs >= hourStartMs) {
        activeSourceCount++
      }
    }
  }

  const activePercent  = activeSourceCount / totalSourceCount
  const exceptionCount = await getExceptionCountForHour(hourBucket)

  let failureReason: string | null = null
  if (activePercent < CLEAN_SOURCE_THRESHOLD) {
    failureReason = `Only ${(activePercent * 100).toFixed(1)}% of sources active (threshold: ${CLEAN_SOURCE_THRESHOLD * 100}%)`
  } else if (exceptionCount > 0) {
    failureReason = `${exceptionCount} unhandled exception(s) in hour ${hourBucket}`
  }

  return {
    clean:             failureReason === null,
    activeSourceCount,
    totalSourceCount,
    activePercent,
    exceptionCount,
    hourBucket,
    failureReason,
  }
}

// ─── Main stability check (runs every 60 minutes) ────────────────────────────

/**
 * Evaluate the current hour and update the Redis stability keys.
 * Should be called by a setInterval(..., 60 * 60_000) in the scraper bootstrap.
 */
export async function runStabilityCheck(now = new Date()): Promise<void> {
  const evaluation = await evaluateCleanHour(now)

  if (evaluation.clean) {
    const newStreak = await redis.incr(STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS)

    const status: StabilityStatus = newStreak >= TARGET_HOURS ? 'stable' : 'degraded'
    await redis.set(STABILITY_KEYS.STATUS, status)

    logger.info(
      {
        hourBucket:          evaluation.hourBucket,
        activeSources:       `${evaluation.activeSourceCount}/${evaluation.totalSourceCount}`,
        activePercent:       `${(evaluation.activePercent * 100).toFixed(1)}%`,
        exceptionCount:      evaluation.exceptionCount,
        consecutiveCleanHours: newStreak,
        targetHours:         TARGET_HOURS,
        status,
      },
      `[STABILITY] Hour ${evaluation.hourBucket} clean — consecutive streak: ${newStreak}/${TARGET_HOURS} (target: 336 for 14 days)`,
    )
  } else {
    await redis.set(STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS, '0')
    await redis.set(STABILITY_KEYS.LAST_FAILURE_AT, now.toISOString())
    await redis.set(STABILITY_KEYS.STATUS, 'failed')

    logger.warn(
      {
        hourBucket:    evaluation.hourBucket,
        activeSources: `${evaluation.activeSourceCount}/${evaluation.totalSourceCount}`,
        activePercent: `${(evaluation.activePercent * 100).toFixed(1)}%`,
        exceptionCount: evaluation.exceptionCount,
        reason:        evaluation.failureReason,
      },
      `[STABILITY] Hour ${evaluation.hourBucket} FAILED — streak reset to 0`,
    )
  }
}

// ─── State reader (used by API route) ─────────────────────────────────────────

/**
 * Read current stability state from Redis.
 * Returns safe defaults if no data exists yet.
 */
export async function getStabilityState(): Promise<StabilityState> {
  const [streakRaw, lastFailureAt, statusRaw] = await Promise.all([
    redis.get(STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS),
    redis.get(STABILITY_KEYS.LAST_FAILURE_AT),
    redis.get(STABILITY_KEYS.STATUS),
  ])

  const consecutive_clean_hours = Math.max(0, parseInt(streakRaw ?? '0', 10))
  const status = (statusRaw as StabilityStatus | null) ?? 'degraded'

  const percent_to_gate = Number(
    Math.min(100, (consecutive_clean_hours / TARGET_HOURS) * 100).toFixed(2),
  )

  const hoursRemaining = Math.max(0, TARGET_HOURS - consecutive_clean_hours)
  const estimated_gate_clear_date = hoursRemaining === 0
    ? new Date().toISOString()
    : new Date(Date.now() + hoursRemaining * 3_600_000).toISOString()

  return {
    consecutive_clean_hours,
    target_hours:              TARGET_HOURS,
    percent_to_gate,
    status,
    last_failure_at:           lastFailureAt ?? null,
    estimated_gate_clear_date,
  }
}
