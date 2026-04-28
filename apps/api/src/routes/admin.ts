import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'
import { getSecurityMetrics } from '../lib/security'
import { runFullReindex } from '../lib/search-backfill'
import { sendError } from '../lib/errors'

// ─── Stability keys (mirror apps/scraper/src/lib/stability-tracker.ts) ───────
const STABILITY_KEYS = {
  CONSECUTIVE_CLEAN_HOURS: 'scraper:stability:consecutive_clean_hours',
  LAST_FAILURE_AT:         'scraper:stability:last_failure_at',
  STATUS:                  'scraper:stability:status',
} as const

const STABILITY_TARGET_HOURS = 336 // 14 days × 24 h
const STABILITY_CACHE_KEY    = 'cache:admin:scraper:stability'
const STABILITY_CACHE_TTL    = 5 * 60 // 5 minutes

// ─── Redis key helpers (must match apps/scraper/src/health.ts) ──────────────
const HEALTH_KEY  = (sourceId: string) => `scraper:health:${sourceId}`
const HEALTH_INDEX_KEY = 'scraper:health:index'
const DEAD_THRESHOLD_MS = 30 * 60 * 1_000

// ─── Process health keys (must match apps/scraper/src/lib/process-health.ts) ─
const PROCESS_KEY    = 'scraper:process'
const LAST_CRASH_KEY = 'scraper:last_crash'
const ALIVE_THRESHOLD_MS = 90 * 1_000

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
  /** stale = no signal for >30 min; failed = success rate <50% with ≥5 attempts */
  status: 'healthy' | 'stale' | 'failed' | 'unknown'
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

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['admin']
    routeOptions.schema.security = routeOptions.schema.security ?? [{ bearerAuth: [] }]
  })

  // ─── GET /api/v1/admin/scraper/health ──────────────────────────────────────
  app.get('/scraper/health', { preHandler: [authenticate] }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    const sourceIds = await redis.smembers(HEALTH_INDEX_KEY)
    const sources   = await Promise.all(sourceIds.map(id => getSourceHealth(id)))

    const healthy = sources.filter(s => s.status === 'healthy').length
    const stale   = sources.filter(s => s.status === 'stale').length
    const failed  = sources.filter(s => s.status === 'failed').length
    const unknown = sources.filter(s => s.status === 'unknown').length

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
          stale,
          failed,
          unknown,
          totalSuccesses,
          totalErrors,
          overallSuccessRate: Number(overallRate.toFixed(4)),
        },
        sources: sources.sort((a, b) => {
          // Stale first, then failed, then unknown, then healthy
          const order: Record<SourceHealth['status'], number> = { stale: 0, failed: 1, unknown: 2, healthy: 3 }
          return order[a.status] - order[b.status]
        }),
        generatedAt: new Date().toISOString(),
      },
    })
  })

  // ─── GET /api/v1/admin/scraper/process ─────────────────────────────────────
  app.get('/scraper/process', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    const raw        = await redis.hgetall(PROCESS_KEY)
    const lastCrashRaw = await redis.get(LAST_CRASH_KEY)

    const lastHeartbeat = raw['last_heartbeat'] ?? null
    const isAlive = lastHeartbeat !== null
      && (Date.now() - new Date(lastHeartbeat).getTime()) < ALIVE_THRESHOLD_MS

    const processInfo = Object.keys(raw).length === 0 ? null : {
      pid:            raw['pid']            ?? null,
      hostname:       raw['hostname']       ?? null,
      started_at:     raw['started_at']     ?? null,
      last_heartbeat: lastHeartbeat,
      status:         raw['status']         ?? null,
      version:        raw['version']        ?? null,
      is_alive:       isAlive,
    }

    const lastCrash = lastCrashRaw ? (JSON.parse(lastCrashRaw) as Record<string, unknown>) : null

    return reply.send({
      success: true,
      data: {
        process:    processInfo,
        last_crash: lastCrash,
      },
    })
  })

  // ─── GET /api/v1/admin/signals/stats ───────────────────────────────────────
  app.get('/signals/stats', { preHandler: [authenticate] }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    const [totalRow] = await db('signals').count('id as count')
    const [last24hRow] = await db('signals')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .count('id as count')
    const [lastHourRow] = await db('signals')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'"))
      .count('id as count')

    const severityRows = await db('signals')
      .select('severity')
      .count('id as count')
      .groupBy('severity')

    const statusRows = await db('signals')
      .select('status')
      .count('id as count')
      .groupBy('status')

    const bySeverity: Record<string, number> = {}
    for (const row of severityRows) {
      bySeverity[row.severity as string] = Number(row.count)
    }

    const byStatus: Record<string, number> = {}
    for (const row of statusRows) {
      byStatus[row.status as string] = Number(row.count)
    }

    return reply.send({
      success: true,
      data: {
        total:      Number(totalRow?.count ?? 0),
        last24h:    Number(last24hRow?.count ?? 0),
        lastHour:   Number(lastHourRow?.count ?? 0),
        bySeverity: {
          critical: bySeverity['critical'] ?? 0,
          high:     bySeverity['high']     ?? 0,
          medium:   bySeverity['medium']   ?? 0,
          low:      bySeverity['low']      ?? 0,
          info:     bySeverity['info']     ?? 0,
        },
        byStatus: {
          verified:  byStatus['verified']  ?? 0,
          pending:   byStatus['pending']   ?? 0,
          disputed:  byStatus['disputed']  ?? 0,
          false:     byStatus['false']     ?? 0,
          retracted: byStatus['retracted'] ?? 0,
        },
        generatedAt: new Date().toISOString(),
      },
    })
  })

  // ─── GET /api/v1/admin/scraper/stability ────────────────────────────────────
  // Gate 1 prerequisite: 336 consecutive clean hours (14 days) of scraper stability.
  // Response is cached for 5 minutes in Redis.
  app.get('/scraper/stability', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    // Check 5-minute cache
    const cached = await redis.get(STABILITY_CACHE_KEY)
    if (cached) {
      return reply.send({ success: true, data: JSON.parse(cached) })
    }

    const [streakRaw, lastFailureAt, statusRaw] = await Promise.all([
      redis.get(STABILITY_KEYS.CONSECUTIVE_CLEAN_HOURS),
      redis.get(STABILITY_KEYS.LAST_FAILURE_AT),
      redis.get(STABILITY_KEYS.STATUS),
    ])

    const consecutive_clean_hours = Math.max(0, parseInt(streakRaw ?? '0', 10))
    const status = (statusRaw ?? 'degraded') as 'stable' | 'degraded' | 'failed'
    const percent_to_gate = Number(
      Math.min(100, (consecutive_clean_hours / STABILITY_TARGET_HOURS) * 100).toFixed(2),
    )

    const hoursRemaining = Math.max(0, STABILITY_TARGET_HOURS - consecutive_clean_hours)
    const estimated_gate_clear_date = hoursRemaining === 0
      ? new Date().toISOString()
      : new Date(Date.now() + hoursRemaining * 3_600_000).toISOString()

    const data = {
      consecutive_clean_hours,
      target_hours:              STABILITY_TARGET_HOURS,
      percent_to_gate,
      status,
      last_failure_at:           lastFailureAt ?? null,
      estimated_gate_clear_date,
      generatedAt:               new Date().toISOString(),
    }

    await redis.setex(STABILITY_CACHE_KEY, STABILITY_CACHE_TTL, JSON.stringify(data))

    return reply.send({ success: true, data })
  })

  // ─── GET /llm-status ─────────────────────────────────────────────────────────
  // Returns which LLM providers are configured and which is the active priority provider
  app.get('/llm-status', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
  }, async (_req, reply) => {
    interface ProviderInfo {
      id:         string
      label:      string
      model:      string
      configured: boolean
      active:     boolean
    }

    const providers: ProviderInfo[] = [
      {
        id:         'anthropic',
        label:      'Claude (Anthropic)',
        model:      process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
        configured: !!process.env.ANTHROPIC_API_KEY,
        active:     false,
      },
      {
        id:         'openai',
        label:      'GPT-4o mini',
        model:      process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        configured: !!process.env.OPENAI_API_KEY,
        active:     false,
      },
      {
        id:         'gemini',
        label:      'Gemini Flash',
        model:      process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
        configured: !!process.env.GEMINI_API_KEY,
        active:     false,
      },
      {
        id:         'openrouter',
        label:      'OpenRouter',
        model:      process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.2-3b-instruct:free',
        configured: !!process.env.OPENROUTER_API_KEY,
        active:     false,
      },
      {
        id:         'ollama',
        label:      'Local AI (Ollama)',
        model:      process.env.OLLAMA_MODEL ?? 'llama3.2',
        configured: !!process.env.OLLAMA_URL,
        active:     false,
      },
      {
        id:         'extractive',
        label:      'Auto-summary',
        model:      'extractive',
        configured: true, // always available, no key needed
        active:     false,
      },
    ]

    // Mark the first configured provider as active (matches signal-summary.ts priority chain)
    const firstConfigured = providers.find(p => p.configured)
    if (firstConfigured) firstConfigured.active = true

    return reply.send({
      success: true,
      data: {
        activeProvider: firstConfigured?.id ?? 'extractive',
        providers,
        generatedAt: new Date().toISOString(),
      },
    })
  })

  // ─── SECURITY DASHBOARD (Gate 6) ─────────────────────────
  app.get('/security', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['admin'],
      summary: 'Security metrics — blocked requests, lockouts, threat events (last 24h)',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }
    try {
      const metrics = await getSecurityMetrics()
      return reply.send({ success: true, data: metrics })
    } catch (err) {
      req.log.error(err)
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error')
    }
  })

  // ─── POST /api/v1/admin/search/reindex ────────────────────
  /**
   * Trigger a full Meilisearch reindex from PostgreSQL.
   * Wipes and rebuilds the signals, posts, and users indexes in parallel.
   * Long-running — returns immediately with a 202 and the results are logged.
   * Admin-only.
   */
  app.post('/search/reindex', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
    schema: {
      tags:     ['admin'],
      summary:  'Full Meilisearch reindex — wipe + rebuild all search indexes from PostgreSQL',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    // Fire-and-forget so the HTTP response returns immediately; the actual work
    // may take minutes on large datasets.  Results are emitted to the logger.
    runFullReindex().catch(err => {
      req.log.error({ err }, 'Background reindex failed')
    })

    return reply.status(202).send({
      success: true,
      data: {
        message:    'Full reindex started — check server logs for progress',
        startedAt:  new Date().toISOString(),
      },
    })
  })

  // ─── GET /api/v1/admin/search/stats ───────────────────────
  /**
   * Returns per-index document counts from Meilisearch.
   * Admin-only.
   */
  app.get('/search/stats', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags:     ['admin'],
      summary:  'Meilisearch index document counts',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    if (!req.user || req.user.accountType !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    const { meili } = await import('../lib/search.js')

    try {
      const [signals, posts, users] = await Promise.all([
        meili.index('signals').getStats(),
        meili.index('posts').getStats(),
        meili.index('users').getStats(),
      ])

      return reply.send({
        success: true,
        data: {
          signals: { documents: signals.numberOfDocuments, isIndexing: signals.isIndexing },
          posts:   { documents: posts.numberOfDocuments,   isIndexing: posts.isIndexing   },
          users:   { documents: users.numberOfDocuments,   isIndexing: users.isIndexing   },
          fetchedAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      req.log.error({ err }, 'Failed to fetch Meilisearch stats')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Meilisearch unavailable')
    }
  })
}