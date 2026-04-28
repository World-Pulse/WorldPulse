/**
 * security.ts — Gate 6: Security Hardening Module
 *
 * Provides:
 * 1. SSRF protection for outbound requests (scraper, webhooks)
 * 2. Request fingerprinting for abuse detection
 * 3. Brute-force login protection (account lockout)
 * 4. Suspicious payload detection (SQLi, XSS, path traversal)
 * 5. Security event logging
 */

import { redis } from '../db/redis'
import { logger } from './logger'
import { createHash } from 'crypto'
import { URL } from 'url'
import net from 'net'

// ─── SSRF PROTECTION ──────────────────────────────────────────────────────────

/** Private/internal IP ranges that must never be fetched by the server */
const PRIVATE_RANGES = [
  // IPv4 private
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  // Loopback
  { start: '127.0.0.0', end: '127.255.255.255' },
  // Link-local
  { start: '169.254.0.0', end: '169.254.255.255' },
  // Multicast
  { start: '224.0.0.0', end: '239.255.255.255' },
  // AWS metadata
  { start: '169.254.169.254', end: '169.254.169.254' },
  // Docker bridge
  { start: '172.17.0.0', end: '172.17.255.255' },
]

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)
}

function isPrivateIP(ip: string): boolean {
  // IPv6 loopback
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd00:')) {
    return true
  }
  // IPv4-mapped IPv6
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7)
  }
  if (!net.isIPv4(ip)) return false
  const ipInt = ipToInt(ip)
  return PRIVATE_RANGES.some(r => ipInt >= ipToInt(r.start) && ipInt <= ipToInt(r.end))
}

/** Blocked URL schemes */
const BLOCKED_SCHEMES = new Set(['file:', 'ftp:', 'gopher:', 'data:', 'javascript:', 'vbscript:'])

/** Maximum URL length to prevent ReDoS on URL parsing */
const MAX_URL_LENGTH = 4096

export interface SSRFCheckResult {
  safe: boolean
  reason?: string
}

/**
 * Validate that a URL is safe to fetch (no SSRF).
 * Call this before ANY outbound HTTP request in the scraper or webhook dispatcher.
 */
export function checkSSRF(urlString: string): SSRFCheckResult {
  if (urlString.length > MAX_URL_LENGTH) {
    return { safe: false, reason: 'url_too_long' }
  }

  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return { safe: false, reason: 'invalid_url' }
  }

  if (BLOCKED_SCHEMES.has(parsed.protocol)) {
    return { safe: false, reason: `blocked_scheme:${parsed.protocol}` }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `unsupported_scheme:${parsed.protocol}` }
  }

  // Block IP-literal hostnames in private ranges
  const host = parsed.hostname
  if (net.isIP(host) && isPrivateIP(host)) {
    return { safe: false, reason: 'private_ip' }
  }

  // Block common internal hostnames
  const lowerHost = host.toLowerCase()
  const internalHosts = ['localhost', 'metadata.google.internal', 'metadata.internal', '0.0.0.0']
  if (internalHosts.includes(lowerHost)) {
    return { safe: false, reason: 'internal_hostname' }
  }

  // Block credentials in URL
  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'credentials_in_url' }
  }

  return { safe: true }
}

// ─── BRUTE-FORCE PROTECTION ───────────────────────────────────────────────────

const LOGIN_ATTEMPT_PREFIX = 'security:login_attempts:'
const LOCKOUT_PREFIX = 'security:lockout:'
const MAX_LOGIN_ATTEMPTS = 10
const LOCKOUT_DURATION_S = 900 // 15 minutes
const ATTEMPT_WINDOW_S = 600   // 10 minutes

export interface LoginAttemptResult {
  allowed: boolean
  attemptsRemaining: number
  lockoutEndsAt?: number // epoch ms
}

/**
 * Check if a login attempt is allowed for a given identifier (email or IP).
 */
export async function checkLoginAttempt(identifier: string): Promise<LoginAttemptResult> {
  const lockoutKey = `${LOCKOUT_PREFIX}${identifier}`
  const lockoutTTL = await redis.ttl(lockoutKey)

  if (lockoutTTL > 0) {
    return {
      allowed: false,
      attemptsRemaining: 0,
      lockoutEndsAt: Date.now() + lockoutTTL * 1000,
    }
  }

  const attemptKey = `${LOGIN_ATTEMPT_PREFIX}${identifier}`
  const attempts = parseInt(await redis.get(attemptKey) ?? '0', 10)

  return {
    allowed: attempts < MAX_LOGIN_ATTEMPTS,
    attemptsRemaining: Math.max(0, MAX_LOGIN_ATTEMPTS - attempts),
  }
}

/**
 * Record a failed login attempt. Locks out the identifier after MAX_LOGIN_ATTEMPTS.
 */
export async function recordFailedLogin(identifier: string): Promise<void> {
  const attemptKey = `${LOGIN_ATTEMPT_PREFIX}${identifier}`
  const attempts = await redis.incr(attemptKey)

  // Set TTL on first attempt
  if (attempts === 1) {
    await redis.expire(attemptKey, ATTEMPT_WINDOW_S)
  }

  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    const lockoutKey = `${LOCKOUT_PREFIX}${identifier}`
    await redis.setex(lockoutKey, LOCKOUT_DURATION_S, '1')
    await redis.del(attemptKey) // Clean up attempts counter

    logSecurityEvent('account_lockout', {
      identifier: hashIdentifier(identifier),
      attempts,
    })
  }
}

/**
 * Clear login attempts on successful login.
 */
export async function clearLoginAttempts(identifier: string): Promise<void> {
  const attemptKey = `${LOGIN_ATTEMPT_PREFIX}${identifier}`
  await redis.del(attemptKey)
}

// ─── SUSPICIOUS PAYLOAD DETECTION ─────────────────────────────────────────────

/** SQL injection patterns */
const SQLI_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\b.*\b(FROM|INTO|TABLE|SET|WHERE|ALL)\b)/i,
  /('|\s|;)\s*(OR|AND)\s+[\d'"].*=/i,
  /;\s*(DROP|DELETE|UPDATE|INSERT)\b/i,
  /\/\*[\s\S]*?\*\//,
  /\bCHAR\s*\(/i,
  /\bCONVERT\s*\(/i,
  /\bCAST\s*\(/i,
  /\bWAITFOR\s+DELAY\b/i,
  /\bBENCHMARK\s*\(/i,
  /\bSLEEP\s*\(/i,
]

/** XSS patterns */
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*['"]/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<svg[\s>].*?on\w+/i,
  /\beval\s*\(/i,
  /\bdocument\.cookie\b/i,
  /\bdocument\.write\b/i,
]

/** Path traversal patterns */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[/\\]/,
  /%2e%2e[/\\%]/i,
  /\.\.%2f/i,
  /\.\.%5c/i,
  /%252e%252e/i,
]

export type ThreatType = 'sqli' | 'xss' | 'path_traversal'

export interface PayloadScanResult {
  clean: boolean
  threats: ThreatType[]
}

/**
 * Scan a string value for suspicious patterns (SQLi, XSS, path traversal).
 * Returns the list of detected threat types.
 */
export function scanPayload(value: string): PayloadScanResult {
  const threats: ThreatType[] = []

  if (SQLI_PATTERNS.some(p => p.test(value))) threats.push('sqli')
  if (XSS_PATTERNS.some(p => p.test(value))) threats.push('xss')
  if (PATH_TRAVERSAL_PATTERNS.some(p => p.test(value))) threats.push('path_traversal')

  return { clean: threats.length === 0, threats }
}

// ─── REQUEST FINGERPRINTING ───────────────────────────────────────────────────

/**
 * Generate a fingerprint for abuse tracking (not PII — hashed).
 */
export function fingerprintRequest(ip: string, userAgent: string): string {
  return createHash('sha256')
    .update(`${ip}::${userAgent}`)
    .digest('hex')
    .slice(0, 16) // 16-char hex = 64-bit — enough for abuse correlation
}

// ─── SECURITY EVENT LOGGING ───────────────────────────────────────────────────

export type SecurityEventType =
  | 'ssrf_blocked'
  | 'sqli_detected'
  | 'xss_detected'
  | 'path_traversal_detected'
  | 'account_lockout'
  | 'brute_force_attempt'
  | 'suspicious_payload'
  | 'rate_limit_exceeded'
  | 'unauthorized_admin_access'

/**
 * Log a security event to structured logs + Redis counter for monitoring.
 */
export function logSecurityEvent(
  eventType: SecurityEventType,
  details: Record<string, unknown> = {},
): void {
  logger.warn({
    msg: `[SECURITY] ${eventType}`,
    security_event: eventType,
    ...details,
    timestamp: new Date().toISOString(),
  })

  // Increment counter in Redis for monitoring (hourly buckets)
  const hour = new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
  const counterKey = `security:events:${eventType}:${hour}`
  redis.incr(counterKey).catch(() => { /* best-effort */ })
  redis.expire(counterKey, 86_400 * 7).catch(() => { /* 7-day TTL */ })
}

// ─── SECURITY METRICS ─────────────────────────────────────────────────────────

export interface SecurityMetrics {
  events_last_24h: Record<string, number>
  active_lockouts: number
  total_blocked_requests: number
}

/**
 * Collect security metrics for the /health or /admin endpoint.
 */
export async function getSecurityMetrics(): Promise<SecurityMetrics> {
  const now = new Date()
  const eventTypes: SecurityEventType[] = [
    'ssrf_blocked', 'sqli_detected', 'xss_detected',
    'path_traversal_detected', 'account_lockout', 'brute_force_attempt',
    'suspicious_payload', 'rate_limit_exceeded', 'unauthorized_admin_access',
  ]

  const events: Record<string, number> = {}
  let totalBlocked = 0

  // Collect last 24 hours of events
  for (const eventType of eventTypes) {
    let count = 0
    for (let h = 0; h < 24; h++) {
      const d = new Date(now.getTime() - h * 3_600_000)
      const hour = d.toISOString().slice(0, 13)
      const val = await redis.get(`security:events:${eventType}:${hour}`)
      count += parseInt(val ?? '0', 10)
    }
    events[eventType] = count
    totalBlocked += count
  }

  // Count active lockouts
  const lockoutKeys = await redis.keys(`${LOCKOUT_PREFIX}*`)
  const activeLockouts = lockoutKeys.length

  return {
    events_last_24h: events,
    active_lockouts: activeLockouts,
    total_blocked_requests: totalBlocked,
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function hashIdentifier(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12)
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

export {
  isPrivateIP,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_S,
  ATTEMPT_WINDOW_S,
}
