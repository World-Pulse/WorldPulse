/**
 * Per-source circuit breaker backed by Redis.
 *
 * Redis keys (hash):  scraper:cb:{sourceId}
 *   failures    — consecutive failure count
 *   open_until  — epoch ms; when non-zero and > now, circuit is OPEN (skip source)
 *
 * Threshold : 5 consecutive failures → open for 10 minutes.
 */

import { redis } from './redis.js'
import { logger } from './logger.js'

const FAILURE_THRESHOLD  = 5
const OPEN_DURATION_MS   = 10 * 60 * 1_000   // 10 minutes
const EXPIRE_BUFFER_S    = 120                 // extra TTL buffer after open_until

const cbKey = (sourceId: string) => `scraper:cb:${sourceId}`

export interface CircuitState {
  failures:  number
  openUntil: number   // epoch ms; 0 = closed
}

export async function getCircuitState(sourceId: string): Promise<CircuitState> {
  const raw = await redis.hgetall(cbKey(sourceId))
  return {
    failures:  parseInt(raw['failures']   ?? '0', 10),
    openUntil: parseInt(raw['open_until'] ?? '0', 10),
  }
}

/** Returns true when the circuit is open and the source should be skipped. */
export async function isCircuitOpen(sourceId: string): Promise<boolean> {
  const raw = await redis.hget(cbKey(sourceId), 'open_until')
  if (!raw) return false
  return Date.now() < parseInt(raw, 10)
}

/** Call after a successful feed fetch for this source. Resets the circuit. */
export async function cbSuccess(sourceId: string): Promise<void> {
  await redis.del(cbKey(sourceId))
}

/**
 * Call after a failed feed fetch for this source.
 * Opens the circuit once the failure threshold is reached.
 */
export async function cbFailure(
  sourceId: string,
  sourceName: string,
): Promise<void> {
  const key      = cbKey(sourceId)
  const failures = await redis.hincrby(key, 'failures', 1)

  if (failures >= FAILURE_THRESHOLD) {
    const openUntil = Date.now() + OPEN_DURATION_MS
    const expireSec = Math.ceil(OPEN_DURATION_MS / 1_000) + EXPIRE_BUFFER_S

    await redis.hset(key, 'open_until', String(openUntil))
    await redis.expire(key, expireSec)

    logger.warn(
      { sourceId, sourceName, failures, openUntilIso: new Date(openUntil).toISOString() },
      'Circuit breaker OPEN — source paused for 10 minutes',
    )
  }
}
