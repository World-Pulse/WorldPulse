/**
 * Per-source resilience configuration store.
 *
 * Allows operators to tune retry and circuit-breaker settings per data source
 * without a code deploy. Settings are stored in Redis and fall back to
 * application defaults for unregistered sources.
 *
 * Redis key:  scraper:rcfg:{sourceId}  (hash)
 *   failure_threshold  — consecutive failures before opening circuit (default: 5)
 *   base_open_ms       — initial circuit-open duration ms (default: 600_000 = 10 min)
 *   max_open_ms        — maximum circuit-open duration ms (default: 7_200_000 = 2 h)
 *   retry_delays_json  — JSON number array, e.g. "[1000,5000,30000]"
 *
 * Redis key:  scraper:rcfg:index  (set)
 *   Tracks all source IDs that have a custom config entry.
 */

import { redis } from './redis.js'

const RCFG_KEY        = (sourceId: string) => `scraper:rcfg:${sourceId}`
const RCFG_INDEX_KEY  = 'scraper:rcfg:index'

export interface SourceResilienceConfig {
  /** Consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number
  /** Initial circuit-open duration in ms. Default: 600_000 (10 min) */
  baseOpenMs?: number
  /** Maximum circuit-open duration in ms. Default: 7_200_000 (2 h) */
  maxOpenMs?: number
  /** Retry delay schedule in ms. Default: [1_000, 5_000, 30_000] */
  retryDelays?: readonly number[]
}

export const DEFAULT_RESILIENCE_CONFIG: Required<SourceResilienceConfig> = {
  failureThreshold: 5,
  baseOpenMs:       10 * 60_000,       // 10 min
  maxOpenMs:        2 * 60 * 60_000,   // 2 h
  retryDelays:      [1_000, 5_000, 30_000],
}

/**
 * Retrieve the resilience config for a source.
 * Returns defaults for any field that has not been overridden.
 */
export async function getResilienceConfig(
  sourceId: string,
): Promise<Required<SourceResilienceConfig>> {
  const raw = await redis.hgetall(RCFG_KEY(sourceId))

  if (!raw || Object.keys(raw).length === 0) {
    return { ...DEFAULT_RESILIENCE_CONFIG }
  }

  let retryDelays: readonly number[] = DEFAULT_RESILIENCE_CONFIG.retryDelays
  if (raw['retry_delays_json']) {
    try {
      const parsed = JSON.parse(raw['retry_delays_json']) as unknown
      if (Array.isArray(parsed) && parsed.every(n => typeof n === 'number')) {
        retryDelays = parsed as number[]
      }
    } catch {
      // Malformed JSON — fall back to default
    }
  }

  return {
    failureThreshold: raw['failure_threshold']
      ? parseInt(raw['failure_threshold'], 10)
      : DEFAULT_RESILIENCE_CONFIG.failureThreshold,
    baseOpenMs: raw['base_open_ms']
      ? parseInt(raw['base_open_ms'], 10)
      : DEFAULT_RESILIENCE_CONFIG.baseOpenMs,
    maxOpenMs: raw['max_open_ms']
      ? parseInt(raw['max_open_ms'], 10)
      : DEFAULT_RESILIENCE_CONFIG.maxOpenMs,
    retryDelays,
  }
}

/**
 * Persist a per-source resilience config override.
 * Only the provided fields are written; omitted fields retain their current
 * value (or remain as defaults if the key did not previously exist).
 */
export async function setResilienceConfig(
  sourceId: string,
  config: SourceResilienceConfig,
): Promise<void> {
  const fields: Record<string, string> = {}

  if (config.failureThreshold !== undefined) {
    if (!Number.isFinite(config.failureThreshold) || config.failureThreshold < 1) {
      throw new RangeError('failureThreshold must be a positive integer')
    }
    fields['failure_threshold'] = String(Math.round(config.failureThreshold))
  }
  if (config.baseOpenMs !== undefined) {
    if (!Number.isFinite(config.baseOpenMs) || config.baseOpenMs < 1_000) {
      throw new RangeError('baseOpenMs must be at least 1000 ms')
    }
    fields['base_open_ms'] = String(config.baseOpenMs)
  }
  if (config.maxOpenMs !== undefined) {
    if (!Number.isFinite(config.maxOpenMs) || config.maxOpenMs < 1_000) {
      throw new RangeError('maxOpenMs must be at least 1000 ms')
    }
    fields['max_open_ms'] = String(config.maxOpenMs)
  }
  if (config.retryDelays !== undefined) {
    if (!Array.isArray(config.retryDelays) || !config.retryDelays.every(n => typeof n === 'number' && n >= 0)) {
      throw new TypeError('retryDelays must be an array of non-negative numbers')
    }
    fields['retry_delays_json'] = JSON.stringify(config.retryDelays)
  }

  if (Object.keys(fields).length === 0) return

  await redis.hset(RCFG_KEY(sourceId), fields)
  await redis.sadd(RCFG_INDEX_KEY, sourceId)
}

/** Remove all custom overrides for a source (reverts to defaults). */
export async function deleteResilienceConfig(sourceId: string): Promise<void> {
  await redis.del(RCFG_KEY(sourceId))
  await redis.srem(RCFG_INDEX_KEY, sourceId)
}

/** List all source IDs that have custom resilience config overrides. */
export async function listConfiguredSources(): Promise<string[]> {
  return redis.smembers(RCFG_INDEX_KEY)
}
