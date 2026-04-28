/**
 * security.ts — Fastify security middleware
 *
 * Gate 6: Integrates payload scanning, fingerprinting, and security event logging
 * into the request lifecycle. Registered as a Fastify plugin.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import {
  scanPayload,
  fingerprintRequest,
  logSecurityEvent,
  type ThreatType,
} from '../lib/security'

/** Routes to skip payload scanning (e.g., health check, swagger) */
const SKIP_PATHS = new Set(['/health', '/api/docs', '/api/docs/json'])

/** Maximum body size to scan (avoid scanning huge uploads) */
const MAX_SCAN_BODY_SIZE = 10_000 // 10KB

/**
 * Recursively extract all string values from an object for scanning.
 */
function extractStrings(obj: unknown, maxDepth = 5): string[] {
  if (maxDepth <= 0) return []
  if (typeof obj === 'string') return [obj]
  if (Array.isArray(obj)) {
    return obj.flatMap(item => extractStrings(item, maxDepth - 1))
  }
  if (obj && typeof obj === 'object') {
    return Object.values(obj).flatMap(val => extractStrings(val, maxDepth - 1))
  }
  return []
}

const securityMiddlewarePlugin: FastifyPluginAsync = async (app) => {
  // ─── onRequest: Fingerprint every request ──────────────────────────────────
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const ip = req.ip ?? '0.0.0.0'
    const ua = (req.headers['user-agent'] as string) ?? ''
    // Attach fingerprint for downstream use (abuse tracking, rate limiting)
    ;(req as unknown as Record<string, unknown>).securityFingerprint = fingerprintRequest(ip, ua)
  })

  // ─── preHandler: Scan query params + body for suspicious patterns ──────────
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = ((req.url ?? '').split('?')[0]) ?? ''
    if (SKIP_PATHS.has(path)) return

    const stringsToScan: string[] = []

    // Scan query params
    if (req.query && typeof req.query === 'object') {
      stringsToScan.push(...extractStrings(req.query))
    }

    // Scan URL params
    if (req.params && typeof req.params === 'object') {
      stringsToScan.push(...extractStrings(req.params))
    }

    // Scan body (only for JSON bodies under size limit)
    if (req.body && typeof req.body === 'object') {
      const bodyStr = JSON.stringify(req.body)
      if (bodyStr.length <= MAX_SCAN_BODY_SIZE) {
        stringsToScan.push(...extractStrings(req.body))
      }
    }

    // Scan each string
    const detectedThreats = new Set<ThreatType>()
    for (const str of stringsToScan) {
      const result = scanPayload(str)
      if (!result.clean) {
        for (const threat of result.threats) {
          detectedThreats.add(threat)
        }
      }
    }

    if (detectedThreats.size > 0) {
      const threats = Array.from(detectedThreats)
      const fingerprint = (req as unknown as Record<string, unknown>).securityFingerprint as string

      for (const threat of threats) {
        const eventType = threat === 'sqli' ? 'sqli_detected'
          : threat === 'xss' ? 'xss_detected'
          : 'path_traversal_detected'

        logSecurityEvent(eventType, {
          path,
          method: req.method,
          fingerprint,
          ip_hash: fingerprint.slice(0, 8),
        })
      }

      // Block the request with a generic error (don't leak detection details)
      return reply.status(400).send({
        success: false,
        error: 'Bad request — input contains disallowed characters.',
        code: 'SECURITY_BLOCKED',
      })
    }
  })
}

export const securityPlugin: FastifyPluginAsync = securityMiddlewarePlugin