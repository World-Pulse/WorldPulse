import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { authenticate } from '../middleware/auth'

// ─── Redis key helpers (must match apps/scraper/src/health.ts) ──────────────
const HEALTH_KEY  = (sourceId: string) => `scraper:health:${sourceId}`
const HEALTH_INDEX_KEY = 'scraper:health:index'
const DEAD_THRESHOLD_MS = 30 * 60 * 1_000

interface SourceHealth {
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

async function getSourceHealth(sourceId: string): Promise<SourceHealth> {
  const raw = await redis.hgetall(HEALTH_KEY(sourceId))
  const successCount = parseInt(raw['success_count'] ?? '0', 10)
  const errorCount   = parseInt(raw['error_count']   ?? '0', 10)
  const total        = successCount + errorCount
  const successRate  = total > 0 ? successCount / total : 0
  const lastSeen     = raw['last_seen']    ?? null
  const lastAttempt  = raw['last_attempt'] ?? null

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
    successRate: Number(successRate.toFixed(4)),
    latencyMs,
    status: computeStatus(lastSeen, lastAttempt, successRate, total),
  }
}

export const registerAdminRoutes: FastifyPluginAsync = async (app) => {

  // ─── GET /api/v1/admin/scraper/health ──────────────────────────────────────
  app.get('/scraper/health', { preHandler: [authenticate] }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Admin access required', code: 'FORBIDDEN' })
    }

    const sourceIds = await redis.smembers(HEALTH_INDEX_KEY)
    const sources   = await Promise.all(sourceIds.map(id => getSourceHealth(id)))

    const healthy  = sources.filter(s => s.status === 'healthy').length
    const degraded = sources.filter(s => s.status === 'degraded').length
    const dead     = sources.filter(s => s.status === 'dead').length
    const unknown  = sources.filter(s => s.status === 'unknown').length

    const totalSuccesses = sources.reduce((n, s) => n + s.successCount, 0)
    const totalErrors    = sources.reduce((n, s) => n + s.errorCount, 0)
    const overallRate    = (totalSuccesses + totalErrors) > 0
      ? totalSuccesses / (totalSuccesses + totalErrors)
      : 0

    return reply.send({
      success: true,
      data: {
        summary: {
          total: sources.length,
          healthy,
          degraded,
          dead,
          unknown,
          totalSuccesses,
          totalErrors,
          overallSuccessRate: Number(overallRate.toFixed(4)),
        },
        sources: sources.sort((a, b) => {
          // Dead first, then degraded, then unknown, then healthy
          const order = { dead: 0, degraded: 1, unknown: 2, healthy: 3 }
          return order[a.status] - order[b.status]
        }),
        generatedAt: new Date().toISOString(),
      },
    })
  })
}
