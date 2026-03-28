/**
 * cloudflare.ts — Fastify Cloudflare integration middleware
 *
 * Responsibilities:
 *  1. Extract the real client IP from `CF-Connecting-IP` (set by Cloudflare edge)
 *     and attach it to the request as `req.cfClientIp`. Falls back to `req.ip`
 *     (which Fastify reads from X-Forwarded-For when trustProxy: true).
 *
 *  2. Expose `req.cfRay` — the Cloudflare trace ID — for logging and debugging.
 *     The same value is echoed back in the `X-CF-Ray` response header so that
 *     ops staff can match a request to a Cloudflare log entry.
 *
 *  3. Set `req.isBehindCloudflare` so downstream handlers can branch on this.
 *
 *  4. Override the rate-limit key to use the real client IP, preventing all
 *     traffic from appearing to come from a single Cloudflare edge node.
 *
 * Registration order: register BEFORE @fastify/rate-limit so the key generator
 * can read `req.cfClientIp` reliably.
 *
 * Integration Phase 1 — Cloudflare (cycle 72)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

// ─── Cloudflare IPv4 CIDR blocks (2026-03-28) ──────────────────────────────
// Source: https://www.cloudflare.com/ips-v4
const CF_IPV4_CIDRS: Array<[number, number, number]> = [
  // [startInt, endInt (inclusive), prefixLen] — precomputed for fast lookup
  ...parseCidrs([
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
  ]),
]

/** Parse an array of "a.b.c.d/prefix" strings into [start, end, prefix] tuples */
function parseCidrs(cidrs: string[]): Array<[number, number, number]> {
  return cidrs.map(cidr => {
    const [ip, prefix] = cidr.split('/') as [string, string]
    const prefixLen = parseInt(prefix, 10)
    const ipInt = ipv4ToInt(ip)
    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0
    const start = (ipInt & mask) >>> 0
    const end = (start | (~mask >>> 0)) >>> 0
    return [start, end, prefixLen]
  })
}

/** Convert dotted-decimal IPv4 to a 32-bit unsigned integer */
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.')
  return (
    ((parseInt(parts[0]!, 10) << 24) |
      (parseInt(parts[1]!, 10) << 16) |
      (parseInt(parts[2]!, 10) << 8) |
      parseInt(parts[3]!, 10)) >>>
    0
  )
}

/**
 * Check whether an IPv4 address string falls within any Cloudflare CIDR block.
 * Returns false for IPv6 addresses (handled separately — we trust CF-Connecting-IP
 * unconditionally when the CF-Ray header is present, regardless of edge IP version).
 */
export function isCloudflareIp(ip: string): boolean {
  // Skip IPv6 and loopback — treated as "not a CF edge IP" for CIDR matching
  if (ip.includes(':') || ip === '127.0.0.1' || ip === '::1') return false
  try {
    const n = ipv4ToInt(ip)
    return CF_IPV4_CIDRS.some(([start, end]) => n >= start && n <= end)
  } catch {
    return false
  }
}

/** Validate that a string looks like a plausible CF-Ray ID (hex + dash + datacenter) */
export function isValidCfRay(ray: string | undefined): boolean {
  if (!ray) return false
  // Format: 16 hex chars + dash + 3-4 datacenter letters, e.g. "8a1b2c3d4e5f6789-LHR"
  return /^[0-9a-f]{16}-[A-Z]{2,5}$/i.test(ray)
}

/** Validate CF-Connecting-IP is a plausible IP (basic sanity check, not full validation) */
export function isValidCfIp(ip: string | undefined): boolean {
  if (!ip) return false
  // Must look like an IPv4 or IPv6 address (no spaces, no injection)
  return /^[\d.:a-fA-F]+$/.test(ip) && ip.length <= 45
}

// ─── Module augmentation — extend FastifyRequest ───────────────────────────
declare module 'fastify' {
  interface FastifyRequest {
    /** Real client IP extracted from CF-Connecting-IP (or req.ip fallback) */
    cfClientIp: string
    /** Cloudflare trace ID from CF-Ray header, or undefined if not behind CF */
    cfRay: string | undefined
    /** True when the request arrived via Cloudflare edge */
    isBehindCloudflare: boolean
  }
}

// ─── Plugin ────────────────────────────────────────────────────────────────
const cloudflarePlugin: FastifyPluginAsync = async (app) => {
  // ── Decorate with defaults so TypeScript sees the properties everywhere ──
  app.decorateRequest('cfClientIp', '')
  app.decorateRequest('cfRay', undefined)
  app.decorateRequest('isBehindCloudflare', false)

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const cfConnectingIp = req.headers['cf-connecting-ip'] as string | undefined
    const cfRaw = req.headers['cf-ray'] as string | undefined

    // Determine whether this request came through Cloudflare:
    // - CF-Ray header is present AND looks valid, OR
    // - the connecting IP falls within a known Cloudflare CIDR
    const hasCfRay = isValidCfRay(cfRaw)
    const connectorIsCf = isCloudflareIp(req.socket?.remoteAddress ?? '')
    const behindCloudflare = hasCfRay || connectorIsCf

    req.isBehindCloudflare = behindCloudflare

    // Real client IP: prefer CF-Connecting-IP when behind Cloudflare, else req.ip
    if (behindCloudflare && isValidCfIp(cfConnectingIp)) {
      req.cfClientIp = cfConnectingIp!
    } else {
      req.cfClientIp = req.ip ?? '0.0.0.0'
    }

    // CF-Ray: only set when we trust it's genuine
    req.cfRay = hasCfRay ? cfRaw : undefined

    // Echo CF-Ray in response header for ops correlation (e.g. match to CF logs)
    if (req.cfRay) {
      void reply.header('X-CF-Ray', req.cfRay)
    }

    // Always echo the resolved real client IP back so downstream services
    // (e.g. Next.js, mobile app) can log/display it
    void reply.header('X-Real-Client-IP', req.cfClientIp)
  })
}

export const cloudflareMiddlewarePlugin: FastifyPluginAsync = cloudflarePlugin

/**
 * Build a rate-limit key generator that respects Cloudflare real IPs.
 *
 * Priority:
 *   1. Authenticated user ID  (fairest: each user gets their own bucket)
 *   2. CF-Connecting-IP       (real client when behind Cloudflare)
 *   3. req.ip                 (Fastify's trustProxy-aware IP, fallback)
 */
export function buildCfAwareKeyGenerator(
  req: FastifyRequest,
): string {
  const userId = req.headers['x-user-id'] as string | undefined
  if (userId) return `user:${userId}`
  if (req.isBehindCloudflare && req.cfClientIp) return `ip:${req.cfClientIp}`
  return `ip:${req.ip ?? '0.0.0.0'}`
}
