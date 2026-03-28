/**
 * fetchWithResilience — unified resilience wrapper for OSINT pollers.
 *
 * Combines the four resilience primitives that the RSS scraper wires together
 * manually in index.ts into a single reusable call so every OSINT source gets:
 *
 *   1. Circuit breaker check  — skip OPEN sources entirely
 *   2. HALF_OPEN probe gate   — allow exactly one probe through
 *   3. Per-domain rate limit  — respect the sliding-window token bucket
 *   4. Exponential backoff    — retry transient failures (1 s → 5 s → 30 s)
 *   5. Circuit breaker update — cbSuccess / cbFailure after each attempt cycle
 *   6. Dead-letter queue      — push failures for later inspection
 *
 * Usage:
 *   const data = await fetchWithResilience(
 *     'usgs-seismic',
 *     'USGS Seismic',
 *     'https://earthquake.usgs.gov/...',
 *     () => fetch(USGS_API).then(r => r.json()),
 *   )
 */

import { withRetry, RetryExhaustedError, type RetryOptions } from './retry.js'
import {
  isCircuitOpen,
  getCircuitState,
  acquireProbeSlot,
  cbSuccess,
  cbFailure,
  CircuitStatus,
  type CircuitBreakerConfig,
} from './circuit-breaker.js'
import { acquireRateLimit } from './rate-limiter.js'
import { pushDLQ } from './dlq.js'
import { logger } from './logger.js'

export class CircuitOpenError extends Error {
  constructor(sourceId: string) {
    super(`Circuit open for source ${sourceId} — request skipped`)
    this.name = 'CircuitOpenError'
  }
}

export interface ResilienceOptions {
  /** Retry schedule (ms). Defaults to [1000, 5000, 30000]. */
  retryDelays?: readonly number[]
  /**
   * Return false to NOT retry this error (e.g. 404, auth failure).
   * Defaults to skipping HTTP 4xx errors.
   */
  shouldRetry?: RetryOptions['shouldRetry']
  /** AbortSignal — cancels in-flight retries on shutdown. */
  signal?: AbortSignal
  /**
   * Pass false to skip rate limiting (e.g. for WebSocket sources that don't
   * make discrete HTTP requests).
   */
  rateLimit?: boolean
  /**
   * Per-source circuit-breaker config overrides.
   * When provided, these values override the module-level defaults for this
   * call only (failureThreshold, baseOpenMs, maxOpenMs).
   */
  circuitConfig?: Partial<CircuitBreakerConfig>
}

/**
 * Wraps an async fetch function with the full WorldPulse resilience stack.
 *
 * @param sourceId    Stable identifier used for circuit-breaker and DLQ keys.
 * @param sourceName  Human-readable name for log/DLQ messages.
 * @param url         The URL being fetched (used for rate limiting and DLQ).
 * @param fetcher     The actual data-fetching function to protect.
 * @param opts        Optional overrides for retry schedule, AbortSignal, etc.
 * @returns           Whatever `fetcher` resolves with.
 * @throws            `CircuitOpenError` if the circuit is OPEN.
 *                    Re-throws the underlying error if retries are exhausted.
 */
export async function fetchWithResilience<T>(
  sourceId: string,
  sourceName: string,
  url: string,
  fetcher: () => Promise<T>,
  opts: ResilienceOptions = {},
): Promise<T> {
  const { rateLimit = true, circuitConfig } = opts

  // ── 1. Circuit breaker: skip OPEN sources ─────────────────────────────────
  if (await isCircuitOpen(sourceId)) {
    logger.debug({ sourceId, sourceName }, 'fetchWithResilience: circuit OPEN — skipping')
    throw new CircuitOpenError(sourceId)
  }

  // ── 2. HALF_OPEN: allow exactly one probe request ─────────────────────────
  const state = await getCircuitState(sourceId)
  if (state.status === CircuitStatus.HALF_OPEN) {
    const acquired = await acquireProbeSlot(sourceId)
    if (!acquired) {
      logger.debug({ sourceId, sourceName }, 'fetchWithResilience: circuit HALF_OPEN — probe slot taken')
      throw new CircuitOpenError(sourceId)
    }
    logger.info({ sourceId, sourceName }, 'fetchWithResilience: circuit HALF_OPEN — probe allowed')
  }

  // ── 3. Rate limiting ──────────────────────────────────────────────────────
  if (rateLimit) {
    await acquireRateLimit(url)
  }

  // ── 4. Retry with exponential backoff ────────────────────────────────────
  try {
    const result = await withRetry<T>(fetcher, {
      delays:      opts.retryDelays,
      shouldRetry: opts.shouldRetry,
      signal:      opts.signal,
    })

    // ── 5a. Success: reset circuit breaker ───────────────────────────────────
    await cbSuccess(sourceId)

    return result
  } catch (err) {
    // ── 5b. Failure: record in circuit breaker ───────────────────────────────
    await cbFailure(sourceId, sourceName, circuitConfig)

    // ── 6. Push to DLQ for later inspection ─────────────────────────────────
    const dlqError =
      err instanceof RetryExhaustedError && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error ? err.message : String(err)

    const attempts = err instanceof RetryExhaustedError ? err.attempts : 1

    await pushDLQ({
      feedUrl:    url,
      sourceId,
      sourceName,
      error:      dlqError,
      attempts,
      failedAt:   new Date().toISOString(),
    }).catch(dlqErr => {
      logger.warn({ dlqErr, sourceId }, 'fetchWithResilience: DLQ push failed (non-fatal)')
    })

    logger.warn(
      { sourceId, sourceName, url, attempts, error: dlqError },
      'fetchWithResilience: fetch failed after retries',
    )

    throw err
  }
}
