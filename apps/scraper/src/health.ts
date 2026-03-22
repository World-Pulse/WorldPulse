/**
 * Per-source scraper health tracking.
 *
 * Redis keys:
 *   scraper:health:{sourceId}  — hash: source_name, source_slug, last_seen,
 *                                      last_attempt, last_error, success_count,
 *                                      error_count
 *   scraper:health:index       — set of all tracked source IDs
 */

import { redis } from './lib/redis'
import { logger } from './lib/logger'

const HEALTH_KEY = (sourceId: string) => `scraper:health:${sourceId}`
const HEALTH_INDEX_KEY = 'scraper:health:index'
const DEAD_THRESHOLD_MS = 30 * 60 * 1_000 // 30 minutes

export interface SourceHealth {
  sourceId: string
  sourceName: string
  sourceSlug: string
  lastSeen: string | null
  lastAttempt: string | null
  lastError: string | null
  errorCount: number
  successCount: number
  successRate: number
  latencyMs: number | null
  status: 'healthy' | 'degraded' | 'dead' | 'unknown'
}

function computeStatus(
  lastSeen: string | null,
  lastAttempt: string | null,
  successRate: number,
  total: number,
): SourceHealth['status'] {
  if (!lastAttempt) return 'unknown'
  const now = Date.now()
  const seenAt = lastSeen ? new Date(lastSeen).getTime() : 0
  if (now - seenAt > DEAD_THRESHOLD_MS) return 'dead'
  if (total >= 5 && successRate < 0.5) return 'degraded'
  return 'healthy'
}

export async function recordSuccess(
  sourceId: string,
  sourceName: string,
  sourceSlug: string,
  latencyMs?: number,
): Promise<void> {
  const key = HEALTH_KEY(sourceId)
  const now = new Date().toISOString()
  const fields: Record<string, string | number> = {
    source_name: sourceName,
    source_slug: sourceSlug,
    last_seen: now,
    last_attempt: now,
  }
  if (latencyMs !== undefined) {
    fields['latency_ms'] = latencyMs
  }
  const pipe = redis.pipeline()
  pipe.hset(key, fields)
  pipe.hincrby(key, 'success_count', 1)
  pipe.sadd(HEALTH_INDEX_KEY, sourceId)
  await pipe.exec()
}

export async function recordFailure(
  sourceId: string,
  sourceName: string,
  sourceSlug: string,
  error: string,
): Promise<void> {
  const key = HEALTH_KEY(sourceId)
  const now = new Date().toISOString()
  const pipe = redis.pipeline()
  pipe.hset(key, {
    source_name: sourceName,
    source_slug: sourceSlug,
    last_attempt: now,
    last_error: error.slice(0, 500),
  })
  pipe.hincrby(key, 'error_count', 1)
  pipe.sadd(HEALTH_INDEX_KEY, sourceId)
  await pipe.exec()
}

export async function getSourceHealth(sourceId: string): Promise<SourceHealth> {
  const raw = await redis.hgetall(HEALTH_KEY(sourceId))
  const successCount = parseInt(raw['success_count'] ?? '0', 10)
  const errorCount = parseInt(raw['error_count'] ?? '0', 10)
  const total = successCount + errorCount
  const successRate = total > 0 ? successCount / total : 0
  const lastSeen = raw['last_seen'] ?? null
  const lastAttempt = raw['last_attempt'] ?? null

  const rawLatency = raw['latency_ms']
  const latencyMs = rawLatency !== undefined ? parseInt(rawLatency, 10) : null

  return {
    sourceId,
    sourceName: raw['source_name'] ?? sourceId,
    sourceSlug: raw['source_slug'] ?? sourceId,
    lastSeen,
    lastAttempt,
    lastError: raw['last_error'] ?? null,
    errorCount,
    successCount,
    successRate,
    latencyMs,
    status: computeStatus(lastSeen, lastAttempt, successRate, total),
  }
}

export async function getAllHealth(): Promise<SourceHealth[]> {
  const sourceIds = await redis.smembers(HEALTH_INDEX_KEY)
  if (sourceIds.length === 0) return []
  return Promise.all(sourceIds.map(id => getSourceHealth(id)))
}

export async function detectDeadSources(): Promise<string[]> {
  const all = await getAllHealth()
  const dead = all.filter(h => h.status === 'dead')

  if (dead.length > 0) {
    logger.warn(
      {
        deadSources: dead.map(d => ({
          id: d.sourceId,
          name: d.sourceName,
          lastSeen: d.lastSeen,
        })),
      },
      `Dead source detection: ${dead.length} source(s) inactive for >30 minutes`,
    )
  }

  return dead.map(d => d.sourceId)
}

export async function logHealthSummary(): Promise<void> {
  let all: SourceHealth[]
  try {
    all = await getAllHealth()
  } catch (err) {
    logger.error({ err }, 'Failed to read scraper health for summary')
    return
  }

  if (all.length === 0) {
    logger.info('Scraper health summary: no sources tracked yet')
    return
  }

  const healthy  = all.filter(h => h.status === 'healthy').length
  const degraded = all.filter(h => h.status === 'degraded').length
  const dead     = all.filter(h => h.status === 'dead').length
  const unknown  = all.filter(h => h.status === 'unknown').length

  const totalSuccesses = all.reduce((s, h) => s + h.successCount, 0)
  const totalErrors    = all.reduce((s, h) => s + h.errorCount, 0)
  const avgSuccessRate = all.reduce((s, h) => s + h.successRate, 0) / all.length

  logger.info(
    {
      total: all.length,
      healthy,
      degraded,
      dead,
      unknown,
      totalSuccesses,
      totalErrors,
      avgSuccessRate: Number(avgSuccessRate.toFixed(3)),
    },
    'Scraper health summary',
  )
}
