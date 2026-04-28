/**
 * Structured JSON request logging middleware for WorldPulse API.
 *
 * Attaches to Fastify's onRequest + onResponse lifecycle hooks and emits
 * structured pino log entries with:
 *   - requestId   (UUID from Fastify or generated)
 *   - userId      (from JWT claim if authenticated)
 *   - route       (Fastify route pattern, e.g. /api/v1/signals/:id)
 *   - method      (GET, POST, …)
 *   - statusCode  (response HTTP status)
 *   - latency_ms  (wall-clock duration)
 *   - ip          (client IP, respects x-forwarded-for via trustProxy)
 *   - userAgent   (first 120 chars)
 *
 * Usage: register in apps/api/src/index.ts before routes.
 */

import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'

declare module 'fastify' {
  interface FastifyRequest {
    requestStartMs: number
  }
}

export const requestLoggerPlugin: FastifyPluginAsync = async (app) => {
  // ── onRequest: stamp start time + assign requestId ──────────────────────
  app.addHook('onRequest', async (req) => {
    req.requestStartMs = Date.now()

    // Fastify generates a numeric id by default; upgrade to UUID for
    // cross-service correlation (e.g. to match Sentry / OTel trace IDs).
    if (!req.id || req.id === '1') {
      req.id = randomUUID()
    }
  })

  // ── onResponse: emit structured log line ────────────────────────────────
  app.addHook('onResponse', async (req, reply) => {
    const latency_ms = Date.now() - (req.requestStartMs ?? Date.now())

    // Attempt to extract userId from the JWT payload (non-fatal if absent)
    let userId: string | undefined
    try {
      // jwtVerify is injected by @fastify/jwt — skip on unauthenticated routes
      const decoded = req.user as { id?: string; sub?: string } | undefined
      userId = decoded?.id ?? decoded?.sub
    } catch {
      // Not authenticated — fine
    }

    // Skip internal endpoints to reduce noise
    const skipRoutes = new Set(['/health', '/metrics', '/api/docs', '/api/docs/'])
    if (skipRoutes.has(((req.url ?? '').split('?')[0]) ?? '')) return

    req.log.info({
      requestId:  req.id,
      userId:     userId ?? null,
      method:     req.method,
      route:      req.routeOptions?.url ?? req.url,
      url:        req.url,
      statusCode: reply.statusCode,
      latency_ms,
      ip:         req.ip,
      userAgent:  (req.headers['user-agent'] ?? '').slice(0, 120),
    }, 'request completed')
  })

  // ── onError: emit error details without leaking stack to client ──────────
  app.addHook('onError', async (req, _reply, error) => {
    req.log.error({
      requestId: req.id,
      method:    req.method,
      url:       req.url,
      errName:   error.name,
      errMsg:    error.message,
      statusCode: (error as { statusCode?: number }).statusCode ?? 500,
    }, 'request error')
  })
}
