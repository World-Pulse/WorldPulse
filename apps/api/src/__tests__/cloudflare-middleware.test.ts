/**
 * cloudflare-middleware.test.ts
 *
 * Unit tests for the WorldPulse Cloudflare middleware:
 *  - isCloudflareIp()       — CIDR membership checks for all known CF ranges
 *  - isValidCfRay()         — CF-Ray header format validation
 *  - isValidCfIp()          — CF-Connecting-IP sanity checks
 *  - buildCfAwareKeyGenerator() — rate-limit key priority logic
 *  - Plugin behaviour (req decoration, header passthrough, fallback logic)
 *
 * Integration Phase 1 — Cloudflare (cycle 72)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isCloudflareIp,
  isValidCfRay,
  isValidCfIp,
  buildCfAwareKeyGenerator,
  cloudflareMiddlewarePlugin,
} from '../middleware/cloudflare'
import Fastify from 'fastify'

// ─── isCloudflareIp ──────────────────────────────────────────────────────────

describe('isCloudflareIp', () => {
  it('returns true for IPs within known Cloudflare IPv4 ranges', () => {
    // 173.245.48.0/20 — first host
    expect(isCloudflareIp('173.245.48.1')).toBe(true)
    // 104.16.0.0/13
    expect(isCloudflareIp('104.16.0.1')).toBe(true)
    // 104.24.0.0/14
    expect(isCloudflareIp('104.25.0.1')).toBe(true)
    // 172.64.0.0/13
    expect(isCloudflareIp('172.64.1.1')).toBe(true)
    // 162.158.0.0/15
    expect(isCloudflareIp('162.158.100.50')).toBe(true)
    // 141.101.64.0/18
    expect(isCloudflareIp('141.101.100.1')).toBe(true)
    // 198.41.128.0/17
    expect(isCloudflareIp('198.41.200.5')).toBe(true)
    // 131.0.72.0/22
    expect(isCloudflareIp('131.0.72.10')).toBe(true)
  })

  it('returns false for IPs outside Cloudflare ranges', () => {
    expect(isCloudflareIp('1.2.3.4')).toBe(false)
    expect(isCloudflareIp('8.8.8.8')).toBe(false)
    expect(isCloudflareIp('192.168.1.1')).toBe(false)
    expect(isCloudflareIp('10.0.0.1')).toBe(false)
    expect(isCloudflareIp('100.100.100.100')).toBe(false)
  })

  it('returns false for loopback addresses', () => {
    expect(isCloudflareIp('127.0.0.1')).toBe(false)
    expect(isCloudflareIp('::1')).toBe(false)
  })

  it('returns false for IPv6 addresses (handled via CF-Ray trust, not CIDR)', () => {
    expect(isCloudflareIp('2606:4700::1')).toBe(false)
    expect(isCloudflareIp('2400:cb00::1')).toBe(false)
  })

  it('returns false for malformed inputs without throwing', () => {
    expect(isCloudflareIp('')).toBe(false)
    expect(isCloudflareIp('not-an-ip')).toBe(false)
  })
})

// ─── isValidCfRay ────────────────────────────────────────────────────────────

describe('isValidCfRay', () => {
  it('returns true for valid CF-Ray format', () => {
    expect(isValidCfRay('8a1b2c3d4e5f6789-LHR')).toBe(true)
    expect(isValidCfRay('abcdef1234567890-IAD')).toBe(true)
    expect(isValidCfRay('0000000000000000-SIN')).toBe(true)
    expect(isValidCfRay('ffffffffffffffff-AMS')).toBe(true)
    // 4-letter datacenter codes
    expect(isValidCfRay('1234567890abcdef-LHRX')).toBe(true)
  })

  it('returns false for undefined or empty', () => {
    expect(isValidCfRay(undefined)).toBe(false)
    expect(isValidCfRay('')).toBe(false)
  })

  it('returns false for malformed CF-Ray values', () => {
    // Too short hex
    expect(isValidCfRay('abcd-LHR')).toBe(false)
    // Missing datacenter
    expect(isValidCfRay('8a1b2c3d4e5f6789')).toBe(false)
    // Spaces
    expect(isValidCfRay('8a1b2c3d4e5f6789 LHR')).toBe(false)
    // Injection attempt
    expect(isValidCfRay('8a1b2c3d4e5f6789-LHR; DROP TABLE signals')).toBe(false)
  })
})

// ─── isValidCfIp ─────────────────────────────────────────────────────────────

describe('isValidCfIp', () => {
  it('returns true for valid IPv4 and IPv6 strings', () => {
    expect(isValidCfIp('1.2.3.4')).toBe(true)
    expect(isValidCfIp('192.168.0.1')).toBe(true)
    expect(isValidCfIp('2001:db8::1')).toBe(true)
    expect(isValidCfIp('::1')).toBe(true)
  })

  it('returns false for undefined or empty', () => {
    expect(isValidCfIp(undefined)).toBe(false)
    expect(isValidCfIp('')).toBe(false)
  })

  it('returns false for injection-like values', () => {
    expect(isValidCfIp('1.2.3.4; rm -rf /')).toBe(false)
    expect(isValidCfIp('$(whoami)')).toBe(false)
    expect(isValidCfIp('<script>alert(1)</script>')).toBe(false)
  })

  it('returns false for values exceeding 45 chars', () => {
    expect(isValidCfIp('1'.repeat(46))).toBe(false)
  })
})

// ─── buildCfAwareKeyGenerator ────────────────────────────────────────────────

describe('buildCfAwareKeyGenerator', () => {
  const makeReq = (overrides: Partial<{
    headers: Record<string, string>
    ip: string
    isBehindCloudflare: boolean
    cfClientIp: string
  }>) => ({
    headers: {},
    ip: '10.0.0.1',
    isBehindCloudflare: false,
    cfClientIp: '10.0.0.1',
    ...overrides,
  })

  it('returns user-scoped key when x-user-id header is present', () => {
    const req = makeReq({ headers: { 'x-user-id': 'user-abc-123' } })
    expect(buildCfAwareKeyGenerator(req as any)).toBe('user:user-abc-123')
  })

  it('returns CF client IP key when behind Cloudflare and CF IP is known', () => {
    const req = makeReq({
      isBehindCloudflare: true,
      cfClientIp: '203.0.113.42',
    })
    expect(buildCfAwareKeyGenerator(req as any)).toBe('ip:203.0.113.42')
  })

  it('user key takes priority over CF IP', () => {
    const req = makeReq({
      headers: { 'x-user-id': 'user-xyz' },
      isBehindCloudflare: true,
      cfClientIp: '203.0.113.42',
    })
    expect(buildCfAwareKeyGenerator(req as any)).toBe('user:user-xyz')
  })

  it('falls back to req.ip when not behind Cloudflare', () => {
    const req = makeReq({ ip: '5.6.7.8', isBehindCloudflare: false })
    expect(buildCfAwareKeyGenerator(req as any)).toBe('ip:5.6.7.8')
  })

  it('falls back to 0.0.0.0 when ip is undefined', () => {
    const req = makeReq({ ip: undefined as any, isBehindCloudflare: false })
    expect(buildCfAwareKeyGenerator(req as any)).toBe('ip:0.0.0.0')
  })
})

// ─── Plugin integration (Fastify) ────────────────────────────────────────────

describe('cloudflareMiddlewarePlugin', () => {
  async function buildApp() {
    const app = Fastify({ trustProxy: true })
    await app.register(cloudflareMiddlewarePlugin)
    app.get('/test', async (req) => ({
      cfClientIp: req.cfClientIp,
      cfRay: req.cfRay ?? null,
      isBehindCloudflare: req.isBehindCloudflare,
    }))
    return app
  }

  it('marks request as NOT behind Cloudflare when no CF headers present', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      remoteAddress: '203.0.113.1',
    })
    const body = JSON.parse(res.body)
    expect(body.isBehindCloudflare).toBe(false)
    expect(body.cfRay).toBeNull()
    expect(res.headers['x-real-client-ip']).toBeDefined()
  })

  it('extracts real client IP from CF-Connecting-IP when CF-Ray is valid', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-connecting-ip': '203.0.113.42',
        'cf-ray': '8a1b2c3d4e5f6789-LHR',
      },
    })
    const body = JSON.parse(res.body)
    expect(body.isBehindCloudflare).toBe(true)
    expect(body.cfClientIp).toBe('203.0.113.42')
    expect(body.cfRay).toBe('8a1b2c3d4e5f6789-LHR')
  })

  it('echoes CF-Ray in X-CF-Ray response header', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'cf-ray': 'ffffffffffffffff-AMS',
      },
    })
    expect(res.headers['x-cf-ray']).toBe('ffffffffffffffff-AMS')
  })

  it('does NOT set X-CF-Ray when CF-Ray is invalid', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'cf-ray': 'invalid-ray-value',
      },
    })
    expect(res.headers['x-cf-ray']).toBeUndefined()
  })

  it('falls back to req.ip when CF-Connecting-IP is invalid/missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-ray': '8a1b2c3d4e5f6789-LHR',
        // No CF-Connecting-IP
      },
    })
    const body = JSON.parse(res.body)
    expect(body.isBehindCloudflare).toBe(true) // CF-Ray is present
    // cfClientIp should fall back to req.ip (not a CF IP from CF-Connecting-IP)
    expect(body.cfClientIp).toBeTruthy()
    expect(body.cfClientIp).not.toBe('') // Should have SOME value
  })

  it('rejects injection attempts in CF-Connecting-IP with fallback', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-connecting-ip': '1.2.3.4; DROP TABLE users',
        'cf-ray': '8a1b2c3d4e5f6789-LHR',
      },
    })
    const body = JSON.parse(res.body)
    // Should NOT use the malicious CF-Connecting-IP
    expect(body.cfClientIp).not.toContain('DROP TABLE')
  })

  it('always sets X-Real-Client-IP response header', async () => {
    const app = await buildApp()
    // Without any CF headers
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['x-real-client-ip']).toBeDefined()
    expect(typeof res.headers['x-real-client-ip']).toBe('string')
  })
})

// ─── nginx cloudflare.conf existence check ────────────────────────────────────

describe('nginx/conf.d/cloudflare.conf', () => {
  it('should exist at the expected path', async () => {
    const fs = await import('fs/promises')
    const path = await import('path')
    // Resolve relative to the project root
    const root = path.resolve(__dirname, '../../../../..')
    const confPath = path.join(root, 'nginx', 'conf.d', 'cloudflare.conf')
    const content = await fs.readFile(confPath, 'utf-8')
    expect(content).toContain('real_ip_header')
    expect(content).toContain('CF-Connecting-IP')
    expect(content).toContain('set_real_ip_from')
    // All 15 IPv4 ranges
    expect(content).toContain('173.245.48.0/20')
    expect(content).toContain('104.16.0.0/13')
    expect(content).toContain('162.158.0.0/15')
    // IPv6 ranges
    expect(content).toContain('2606:4700::/32')
    expect(content).toContain('2400:cb00::/32')
    expect(content).toContain('real_ip_recursive  on')
  })
})
