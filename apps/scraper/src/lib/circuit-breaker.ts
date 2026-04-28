/**
 * Per-source circuit breaker backed by Redis — three-state FSM.
 *
 * States:
 *   CLOSED    — normal operation, failures are counted
 *   OPEN      — source is paused; all requests skipped
 *   HALF_OPEN — cooldown expired; exactly ONE probe request is allowed through;
 *               success → CLOSED, failure → OPEN (with doubled backoff)
 *
 * Redis keys (hash):  scraper:cb:{sourceId}
 *   failures      — consecutive failure count
 *   open_until    — epoch ms; when non-zero and > now, circuit is OPEN
 *   open_count    — how many times this source has been opened (for backoff)
 *   probe_taken   — "1" when a half-open probe slot has been reserved
 *
 * Backoff schedule (doubles each successive open, max 2 h):
 *   1st open: 10 min → 2nd: 20 min → 3rd: 40 min → 4th+: 120 min
 */

import { redis } from './redis.js'
import { logger } from './logger.js'
import { DEFAULT_RESILIENCE_CONFIG, type SourceResilienceConfig } from './resilience-config.js'

const FAILURE_THRESHOLD     = DEFAULT_RESILIENCE_CONFIG.failureThreshold
const BASE_OPEN_DURATION_MS = DEFAULT_RESILIENCE_CONFIG.baseOpenMs
const MAX_OPEN_DURATION_MS  = DEFAULT_RESILIENCE_CONFIG.maxOpenMs
const EXPIRE_BUFFER_S = 120

/** Subset of SourceResilienceConfig that affects circuit-breaker behaviour. */
export type CircuitBreakerConfig = Pick<
  Required<SourceResilienceConfig>,
  'failureThreshold' | 'baseOpenMs' | 'maxOpenMs'
>

export enum CircuitStatus {
  CLOSED    = 'CLOSED',
  OPEN      = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitState {
  status:    CircuitStatus
  failures:  number
  openUntil: number   // epoch ms; 0 = closed
  openCount: number   // cumulative open count (for backoff)
}

const cbKey = (sourceId: string) => `scraper:cb:${sourceId}`

function computeOpenDurationMs(
  openCount: number,
  baseMs = BASE_OPEN_DURATION_MS,
  maxMs  = MAX_OPEN_DURATION_MS,
): number {
  const multiplier = Math.pow(2, Math.max(0, openCount - 1))
  return Math.min(baseMs * multiplier, maxMs)
}

export async function getCircuitState(sourceId: string): Promise<CircuitState> {
  const raw = await redis.hgetall(cbKey(sourceId))
  const openUntil = parseInt(raw['open_until'] ?? '0', 10)
  const now = Date.now()

  let status: CircuitStatus
  if (!openUntil || openUntil === 0) {
    status = CircuitStatus.CLOSED
  } else if (now < openUntil) {
    status = CircuitStatus.OPEN
  } else {
    status = CircuitStatus.HALF_OPEN
  }

  return {
    status,
    failures:  parseInt(raw['failures']   ?? '0', 10),
    openUntil,
    openCount: parseInt(raw['open_count'] ?? '0', 10),
  }
}

/** Returns true when the circuit is OPEN and the source should be skipped entirely. */
export async function isCircuitOpen(sourceId: string): Promise<boolean> {
  const raw = await redis.hget(cbKey(sourceId), 'open_until')
  if (!raw) return false
  const openUntil = parseInt(raw, 10)
  return Date.now() < openUntil
}

/**
 * Attempts to acquire the single half-open probe slot.
 * Returns true if this caller should be allowed to make the probe request.
 * Uses SET NX (via Redis HSETNX) for atomic slot reservation.
 */
export async function acquireProbeSlot(sourceId: string): Promise<boolean> {
  const key = cbKey(sourceId)
  // Check if we're actually in half-open state first
  const state = await getCircuitState(sourceId)
  if (state.status !== CircuitStatus.HALF_OPEN) return false

  // Atomically set probe_taken = "1" only if it doesn't already exist
  const result = await redis.hsetnx(key, 'probe_taken', '1')
  return result === 1
}

/** Call after a successful feed fetch. Resets circuit to CLOSED. */
export async function cbSuccess(sourceId: string): Promise<void> {
  const state = await getCircuitState(sourceId)
  const wasHalfOpen = state.status === CircuitStatus.HALF_OPEN
  await redis.del(cbKey(sourceId))

  if (wasHalfOpen) {
    logger.info({ sourceId }, 'Circuit breaker CLOSED — probe succeeded')
  }
}

/**
 * Call after a failed feed fetch.
 * Opens (or re-opens) the circuit once the failure threshold is reached.
 *
 * @param config  Optional per-source overrides for failureThreshold,
 *                baseOpenMs, and maxOpenMs. Falls back to module defaults
 *                when omitted — matches legacy behaviour exactly.
 */
export async function cbFailure(
  sourceId:   string,
  sourceName: string,
  config?:    Partial<CircuitBreakerConfig>,
): Promise<void> {
  const threshold = config?.failureThreshold ?? FAILURE_THRESHOLD
  const baseMs    = config?.baseOpenMs       ?? BASE_OPEN_DURATION_MS
  const maxMs     = config?.maxOpenMs        ?? MAX_OPEN_DURATION_MS

  const key   = cbKey(sourceId)
  const state = await getCircuitState(sourceId)

  // If probe failed in HALF_OPEN, re-open with doubled backoff
  if (state.status === CircuitStatus.HALF_OPEN) {
    const newOpenCount = state.openCount + 1
    const durationMs   = computeOpenDurationMs(newOpenCount, baseMs, maxMs)
    const openUntil    = Date.now() + durationMs
    const expireSec    = Math.ceil(durationMs / 1_000) + EXPIRE_BUFFER_S

    await redis.hset(key,
      'failures',   String(state.failures + 1),
      'open_until', String(openUntil),
      'open_count', String(newOpenCount),
    )
    await redis.hdel(key, 'probe_taken')
    await redis.expire(key, expireSec)

    logger.warn(
      { sourceId, sourceName, openCount: newOpenCount, durationMs, openUntilIso: new Date(openUntil).toISOString() },
      'Circuit breaker RE-OPENED after probe failure — backoff doubled',
    )
    return
  }

  const failures = await redis.hincrby(key, 'failures', 1)

  if (failures >= threshold) {
    const openCount  = (state.openCount ?? 0) + 1
    const durationMs = computeOpenDurationMs(openCount, baseMs, maxMs)
    const openUntil  = Date.now() + durationMs
    const expireSec  = Math.ceil(durationMs / 1_000) + EXPIRE_BUFFER_S

    await redis.hset(key,
      'open_until', String(openUntil),
      'open_count', String(openCount),
    )
    await redis.expire(key, expireSec)

    logger.warn(
      { sourceId, sourceName, failures, openCount, durationMs, openUntilIso: new Date(openUntil).toISOString() },
      'Circuit breaker OPEN — source paused',
    )
  }
}
