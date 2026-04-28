/**
 * Per-source scraper health tracking.
 *
 * Redis keys:
 *   scraper:health:{sourceId}  — hash: source_name, source_slug, last_seen,
 *                                      last_attempt, last_error, success_count,
 *                                      error_count, articles_scraped,
 *                                      last_cycle_articles, last_cycle_ms
 *   scraper:health:index       — set of all tracked source IDs
 *   scraper:throughput         — hash: total_articles, last_cycle_articles,
 *                                      last_cycle_ms, last_cycle_at
 */

import { redis } from './lib/redis'
import { logger } from './lib/logger'

const HEALTH_KEY = (sourceId: string) => `scraper:health:${sourceId}`
const HEALTH_INDEX_KEY = 'scraper:health:index'
const THROUGHPUT_KEY = 'scraper:throughput'
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
  articlesScraped: number
  lastCycleArticles: number
  /** stale = no signal for >30 min; failed = success rate <50% with ≥5 attempts */
  status: 'healthy' | 'stale' | 'failed' | 'unknown'
}

export interface ScraperThroughput {
  totalArticles: number
  lastCycleArticles: number
  lastCycleMs: number | null
  lastCycleAt: string | null
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
  if (now - seenAt > DEAD_THRESHOLD_MS) return 'stale'
  if (total >= 5 && successRate < 0.5) return 'failed'
  return 'healthy'
}

export async function recordSuccess(
  sourceId: string,
  sourceName: string,
  sourceSlug: string,
  latencyMs?: number,
  articlesCount?: number,
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
  if (articlesCount !== undefined) {
    fields['last_cycle_articles'] = articlesCount
  }
  const pipe = redis.pipeline()
  pipe.hset(key, fields)
  pipe.hincrby(key, 'success_count', 1)
  if (articlesCount !== undefined && articlesCount > 0) {
    pipe.hincrby(key, 'articles_scraped', articlesCount)
  }
  pipe.sadd(HEALTH_INDEX_KEY, sourceId)
  await pipe.exec()
}

/**
 * Record that an OSINT source polled successfully but produced zero new signals
 * (e.g. all events were deduplicated from cache, or a quiet monitoring period).
 *
 * Unlike recordSuccess(), this does NOT increment success_count or articles_scraped —
 * it only updates last_seen and last_attempt so the source stays HEALTHY in the
 * stability tracker's 70% quorum check even during quiet periods.
 *
 * Called by the OSINT Heartbeat Watchdog (lib/osint-watchdog.ts) for any registered
 * OSINT source that hasn't recorded a signal insertion within its polling window.
 */
export async function recordPollHeartbeat(
  sourceId:   string,
  sourceName: string,
  sourceSlug: string,
  latencyMs?: number,
): Promise<void> {
  const key = HEALTH_KEY(sourceId)
  const now = new Date().toISOString()
  const fields: Record<string, string | number> = {
    source_name:         sourceName,
    source_slug:         sourceSlug,
    last_seen:           now,   // alive — polled successfully, just no new signals
    last_attempt:        now,
    last_cycle_articles: 0,
  }
  if (latencyMs !== undefined) {
    fields['latency_ms'] = latencyMs
  }
  const pipe = redis.pipeline()
  pipe.hset(key, fields)
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
    last_cycle_articles: 0,
  })
  pipe.hincrby(key, 'error_count', 1)
  pipe.sadd(HEALTH_INDEX_KEY, sourceId)
  await pipe.exec()
}

export async function recordCycleThroughput(
  totalArticlesThisCycle: number,
  cycleDurationMs: number,
): Promise<void> {
  const pipe = redis.pipeline()
  pipe.hset(THROUGHPUT_KEY, {
    last_cycle_articles: totalArticlesThisCycle,
    last_cycle_ms: cycleDurationMs,
    last_cycle_at: new Date().toISOString(),
  })
  pipe.hincrby(THROUGHPUT_KEY, 'total_articles', totalArticlesThisCycle)
  await pipe.exec()
}

export async function getScraperThroughput(): Promise<ScraperThroughput> {
  const raw = await redis.hgetall(THROUGHPUT_KEY)
  return {
    totalArticles: parseInt(raw['total_articles'] ?? '0', 10),
    lastCycleArticles: parseInt(raw['last_cycle_articles'] ?? '0', 10),
    lastCycleMs: raw['last_cycle_ms'] !== undefined ? parseInt(raw['last_cycle_ms'], 10) : null,
    lastCycleAt: raw['last_cycle_at'] ?? null,
  }
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
    articlesScraped: parseInt(raw['articles_scraped'] ?? '0', 10),
    lastCycleArticles: parseInt(raw['last_cycle_articles'] ?? '0', 10),
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
  const stale = all.filter(h => h.status === 'stale')

  if (stale.length > 0) {
    logger.warn(
      {
        staleSources: stale.map(d => ({
          id: d.sourceId,
          name: d.sourceName,
          lastSeen: d.lastSeen,
        })),
      },
      `Dead-source detection: ${stale.length} source(s) stale (no signal for >30 minutes)`,
    )
  }

  return stale.map(d => d.sourceId)
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

  const healthy = all.filter(h => h.status === 'healthy').length
  const stale   = all.filter(h => h.status === 'stale').length
  const failed  = all.filter(h => h.status === 'failed').length
  const unknown = all.filter(h => h.status === 'unknown').length

  const totalSuccesses     = all.reduce((s, h) => s + h.successCount, 0)
  const totalErrors        = all.reduce((s, h) => s + h.errorCount, 0)
  const avgSuccessRate     = all.reduce((s, h) => s + h.successRate, 0) / all.length
  const totalArticles      = all.reduce((s, h) => s + h.articlesScraped, 0)
  const lastCycleArticles  = all.reduce((s, h) => s + h.lastCycleArticles, 0)

  let throughput: ScraperThroughput | null = null
  try {
    throughput = await getScraperThroughput()
  } catch {
    // non-fatal
  }

  logger.info(
    {
      total: all.length,
      healthy,
      stale,
      failed,
      unknown,
      totalSuccesses,
      totalErrors,
      avgSuccessRate: Number(avgSuccessRate.toFixed(3)),
      totalArticles,
      lastCycleArticles,
      throughput: throughput
        ? {
            totalArticlesAllTime: throughput.totalArticles,
            lastCycleArticles: throughput.lastCycleArticles,
            lastCycleMs: throughput.lastCycleMs,
            lastCycleAt: throughput.lastCycleAt,
          }
        : null,
    },
    `Scraper health summary: ${all.length} sources — ${healthy} healthy, ${stale} stale, ${failed} failed, ${unknown} unknown`,
  )
}