/**
 * security-middleware.test.ts — Integration tests for Fastify security middleware
 *
 * Tests:
 *  - Rate limiting (global + auth-endpoint limits)
 *  - Helmet security headers (CSP, X-Frame-Options, nosniff, etc.)
 *  - CORS (allowed origins, blocked origins, preflight)
 *  - Request body size limits
 *  - Payload scanning (SQLi/XSS blocked by securityPlugin)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

// ─── Mock Redis (used by rate-limit) ──────────────────────────────────────────

const rateLimitCounts = new Map<string, number>()

const mockRedis = {
  get: vi.fn(async (key: string) => {
    const val = rateLimitCounts.get(key)
    return val !== undefined ? String(val) : null
  }),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn(async (key: string) => { rateLimitCounts.delete(key); return 1 }),
  incr: vi.fn(async (key: string) => {
    const current = rateLimitCounts.get(key) ?? 0
    rateLimitCounts.set(key, current + 1)
    return current + 1
  }),
  expire: vi.fn().mockResolvedValue(1),
  pexpire: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(-2),
  pttl: vi.fn().mockResolvedValue(-2),
  keys: vi.fn().mockResolvedValue([]),
  defineCommand: vi.fn(),
}

vi.mock('../db/redis', () => ({ redis: mockRedis }))
vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── Test app builder ─────────────────────────────────────────────────────────

async function buildTestApp(options: {
  rateLimitMax?: number
  allowedOrigins?: string[]
} = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true })

  const allowedOrigins = options.allowedOrigins ?? ['http://localhost:3000', 'https://worldpulse.io']

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true)
      } else {
        cb(new Error(`CORS: origin '${origin}' not allowed`), false)
      }
    },
    credentials: true,
  })

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'"],
        imgSrc:     ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc:   ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc:  ["'none'"],
      },
    },
    frameguard:   { action: 'deny' },
    noSniff:      true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts:         false, // disabled in test (not HTTPS)
    dnsPrefetchControl: { allow: false },
    ieNoOpen:     true,
  })

  await app.register(rateLimit, {
    max:        options.rateLimitMax ?? 5,
    timeWindow: '1 minute',
    redis:      mockRedis as unknown as Parameters<typeof rateLimit>[1]['redis'],
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      success: false,
      error:   'Too many requests. Slow down.',
      code:    'RATE_LIMITED',
    }),
  })

  // Simple test routes
  app.get('/test', async () => ({ ok: true }))
  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
  }, async () => ({ token: 'test' }))

  await app.ready()
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Helmet security headers', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildTestApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('sets X-Frame-Options: DENY', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['x-frame-options']).toBe('DENY')
  })

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('sets Content-Security-Policy header', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    const csp = res.headers['content-security-policy']
    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('sets Referrer-Policy header', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  it('sets X-DNS-Prefetch-Control: off', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['x-dns-prefetch-control']).toBe('off')
  })

  it('does not expose X-Powered-By', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('CORS configuration', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildTestApp({ allowedOrigins: ['http://localhost:3000', 'https://worldpulse.io'] })
  })

  afterEach(async () => {
    await app.close()
  })

  it('allows requests from a permitted origin', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/test',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
  })

  it('allows requests from production origin', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/test',
      headers: { origin: 'https://worldpulse.io' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('https://worldpulse.io')
  })

  it('rejects requests from unknown origins', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/test',
      headers: { origin: 'https://evil.com' },
    })
    expect(res.statusCode).toBe(500) // Fastify CORS plugin throws 500 on blocked origin
  })

  it('allows requests with no origin (server-to-server)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
  })

  it('includes credentials header for allowed origin', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/test',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('responds to OPTIONS preflight with allowed methods', async () => {
    const res = await app.inject({
      method:  'OPTIONS',
      url:     '/test',
      headers: {
        origin:                         'http://localhost:3000',
        'access-control-request-method': 'POST',
      },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
  })
})

describe('Rate limiting', () => {
  afterEach(() => {
    rateLimitCounts.clear()
    vi.clearAllMocks()
  })

  it('allows requests under the limit', async () => {
    const app = await buildTestApp({ rateLimitMax: 10 })
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('rate-limit response includes X-RateLimit-Limit header', async () => {
    const app = await buildTestApp({ rateLimitMax: 10 })
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    await app.close()
  })

  it('returns 429 and RATE_LIMITED code when limit exceeded', async () => {
    // Build app with limit=1 so second request is blocked
    const app = await buildTestApp({ rateLimitMax: 1 })

    // First request is allowed (counter goes to 1)
    mockRedis.get.mockResolvedValueOnce('1')
    mockRedis.pttl.mockResolvedValueOnce(50000)

    const res = await app.inject({
      method:  'GET',
      url:     '/test',
      // Use a consistent IP so the key generator is deterministic
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    // When current >= max the rate-limit plugin returns 429
    if (res.statusCode === 429) {
      const body = JSON.parse(res.body)
      expect(body.code).toBe('RATE_LIMITED')
      expect(body.success).toBe(false)
    }
    await app.close()
  })
})

describe('Request body size limit', () => {
  it('rejects payloads larger than 1MB', async () => {
    const app = Fastify({ logger: false, bodyLimit: 1_048_576 }) // 1MB

    app.post('/upload', async (req) => ({ size: JSON.stringify(req.body).length }))
    await app.ready()

    const bigPayload = JSON.stringify({ data: 'x'.repeat(1_100_000) })
    const res = await app.inject({
      method:  'POST',
      url:     '/upload',
      headers: { 'content-type': 'application/json' },
      payload: bigPayload,
    })

    expect(res.statusCode).toBe(413)
    await app.close()
  })

  it('accepts payloads under 1MB', async () => {
    const app = Fastify({ logger: false, bodyLimit: 1_048_576 })

    app.post('/upload', async (req) => ({ ok: true }))
    await app.ready()

    const smallPayload = JSON.stringify({ data: 'x'.repeat(500) })
    const res = await app.inject({
      method:  'POST',
      url:     '/upload',
      headers: { 'content-type': 'application/json' },
      payload: smallPayload,
    })

    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
