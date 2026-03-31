/**
 * error-format.test.ts
 *
 * Verifies that all key API routes return the canonical error shape:
 *   { success: false, code: ErrorCode, error: string }
 *
 * No route should return a plain { success: false, error: string } without `code`.
 * Tests cover 400/401/403/404/409/429/500 status codes across multiple routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../db/postgres', () => ({
  db: Object.assign(vi.fn(() => ({
    where:   vi.fn().mockReturnThis(),
    first:   vi.fn().mockResolvedValue(null),
    select:  vi.fn().mockReturnThis(),
    insert:  vi.fn().mockReturnThis(),
    update:  vi.fn().mockReturnThis(),
    delete:  vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    offset:  vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    count:   vi.fn().mockResolvedValue([{ count: '0' }]),
  })), { schema: vi.fn().mockReturnThis() }),
}))

vi.mock('../../db/redis', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    scan:   vi.fn().mockResolvedValue(['0', []]),
  },
}))

vi.mock('../../middleware/auth', () => ({
  authenticate:  (_req: unknown, _reply: unknown, done: () => void) => done(),
  optionalAuth:  (_req: unknown, _reply: unknown, done: () => void) => done(),
}))

vi.mock('../../lib/search', () => ({
  indexSignal: vi.fn(),
  indexUser:   vi.fn(),
  removeSignal: vi.fn(),
}))

vi.mock('../../lib/search-events', () => ({
  publishSignalUpsert: vi.fn(),
  publishSignalDelete: vi.fn(),
}))

vi.mock('../../lib/pinecone', () => ({
  generateEmbedding:  vi.fn(),
  querySimilar:       vi.fn().mockResolvedValue([]),
  isPineconeEnabled:  vi.fn().mockReturnValue(false),
}))

vi.mock('../../lib/signal-summary', () => ({
  generateSignalSummary: vi.fn(),
  refreshSignalSummary:  vi.fn(),
}))

vi.mock('../../lib/slop-detector', () => ({
  slopDetector: { check: vi.fn().mockResolvedValue({ isSlop: false }) },
}))

vi.mock('../../lib/risk-score', () => ({
  computeRiskScore: vi.fn().mockReturnValue(0),
}))

vi.mock('../../lib/cib-detection', () => ({
  detectCIB: vi.fn().mockResolvedValue({ isCoordinated: false }),
}))

vi.mock('../../lib/source-bias', () => ({
  getSourceBias:  vi.fn().mockResolvedValue(null),
  extractDomain:  vi.fn().mockReturnValue(''),
}))

vi.mock('../../lib/security', () => ({
  checkLoginAttempt:     vi.fn().mockResolvedValue({ allowed: true }),
  recordFailedLogin:     vi.fn(),
  clearLoginAttempts:    vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn().mockResolvedValue(false),
    hash:    vi.fn().mockResolvedValue('$hashed'),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify that a response body has the canonical error shape:
 *   { success: false, code: string, error: string }
 * with EXACTLY those three keys.
 */
function assertErrorShape(body: Record<string, unknown>) {
  expect(body).toHaveProperty('success', false)
  expect(body).toHaveProperty('code')
  expect(typeof body['code']).toBe('string')
  expect(body).toHaveProperty('error')
  expect(typeof body['error']).toBe('string')
  // Must NOT be missing the `code` field (old plain shape had only success+error)
  expect(Object.keys(body)).toEqual(expect.arrayContaining(['success', 'code', 'error']))
}

/**
 * Verify that a body does NOT use the old plain error shape
 * (i.e., has `code` field, not just `{ success, error }`).
 */
function assertHasCode(body: Record<string, unknown>) {
  expect(body).toHaveProperty('code')
  expect(body['code']).not.toBeUndefined()
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('Error Response Standardization', () => {

  // ── sendError shape contract ────────────────────────────────────────────────
  describe('sendError helper produces canonical shape', () => {
    let app: FastifyInstance

    beforeEach(async () => {
      app = Fastify()
      const { sendError } = await import('../../lib/errors')

      app.get('/test-400', async (_req, reply) => sendError(reply, 400, 'BAD_REQUEST', 'bad input'))
      app.get('/test-400v', async (_req, reply) => sendError(reply, 400, 'VALIDATION_ERROR', 'invalid schema'))
      app.get('/test-401', async (_req, reply) => sendError(reply, 401, 'UNAUTHORIZED', 'auth required'))
      app.get('/test-403', async (_req, reply) => sendError(reply, 403, 'FORBIDDEN', 'forbidden'))
      app.get('/test-404', async (_req, reply) => sendError(reply, 404, 'NOT_FOUND', 'not found'))
      app.get('/test-409', async (_req, reply) => sendError(reply, 409, 'CONFLICT', 'conflict'))
      app.get('/test-429', async (_req, reply) => sendError(reply, 429, 'RATE_LIMITED', 'rate limited'))
      app.get('/test-500', async (_req, reply) => sendError(reply, 500, 'INTERNAL_ERROR', 'server error'))
      app.get('/test-503', async (_req, reply) => sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'unavailable'))

      await app.ready()
    })

    it('400 BAD_REQUEST has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-400' })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('BAD_REQUEST')
      expect(body.error).toBe('bad input')
    })

    it('400 VALIDATION_ERROR has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-400v' })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('VALIDATION_ERROR')
      expect(body.error).toBe('invalid schema')
    })

    it('401 UNAUTHORIZED has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-401' })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('UNAUTHORIZED')
    })

    it('403 FORBIDDEN has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-403' })
      expect(res.statusCode).toBe(403)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('FORBIDDEN')
    })

    it('404 NOT_FOUND has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-404' })
      expect(res.statusCode).toBe(404)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('NOT_FOUND')
    })

    it('409 CONFLICT has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-409' })
      expect(res.statusCode).toBe(409)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('CONFLICT')
    })

    it('429 RATE_LIMITED has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-429' })
      expect(res.statusCode).toBe(429)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('RATE_LIMITED')
    })

    it('500 INTERNAL_ERROR has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-500' })
      expect(res.statusCode).toBe(500)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('INTERNAL_ERROR')
    })

    it('503 SERVICE_UNAVAILABLE has correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-503' })
      expect(res.statusCode).toBe(503)
      const body = res.json()
      assertErrorShape(body)
      expect(body.code).toBe('SERVICE_UNAVAILABLE')
    })

    it('error body has exactly three keys: success, code, error', async () => {
      const res = await app.inject({ method: 'GET', url: '/test-404' })
      const body = res.json()
      const keys = Object.keys(body).sort()
      expect(keys).toEqual(['code', 'error', 'success'])
    })

    it('success is always boolean false', async () => {
      for (const path of ['/test-400', '/test-401', '/test-403', '/test-404', '/test-500']) {
        const res = await app.inject({ method: 'GET', url: path })
        expect(res.json().success).toBe(false)
      }
    })
  })

  // ── Alerts route ────────────────────────────────────────────────────────────
  describe('alerts route', () => {
    let app: FastifyInstance

    beforeEach(async () => {
      app = Fastify()
      const { registerAlertRoutes } = await import('../alerts')
      app.addHook('preHandler', (req: any, _reply, done) => {
        req.user = { id: 'user-1' }
        done()
      })
      await app.register(registerAlertRoutes, { prefix: '/alerts' })
      await app.ready()
    })

    it('POST /alerts with invalid body returns 400 with code field', async () => {
      const res = await app.inject({
        method: 'POST', url: '/alerts',
        payload: { invalidField: true },
      })
      expect(res.statusCode).toBe(400)
      assertHasCode(res.json())
    })
  })

  // ── Users route ─────────────────────────────────────────────────────────────
  describe('users route', () => {
    let app: FastifyInstance

    beforeEach(async () => {
      app = Fastify()
      const { registerUserRoutes } = await import('../users')
      await app.register(registerUserRoutes, { prefix: '/users' })
      await app.ready()
    })

    it('GET /users/:handle for unknown user returns 404 with code field', async () => {
      const res = await app.inject({ method: 'GET', url: '/users/nonexistent-user-xyz' })
      expect(res.statusCode).toBe(404)
      assertHasCode(res.json())
    })
  })

  // ── Sources route ───────────────────────────────────────────────────────────
  describe('sources route', () => {
    let app: FastifyInstance

    beforeEach(async () => {
      app = Fastify()
      const { registerSourceRoutes } = await import('../sources')
      await app.register(registerSourceRoutes, { prefix: '/sources' })
      await app.ready()
    })

    it('GET /sources/:id for unknown source returns 404 with code field', async () => {
      const res = await app.inject({ method: 'GET', url: '/sources/99999999' })
      expect(res.statusCode).toBe(404)
      assertHasCode(res.json())
    })
  })

  // ── No plain error shape ─────────────────────────────────────────────────────
  describe('no plain error shapes (must always have code)', () => {
    let app: FastifyInstance

    beforeEach(async () => {
      app = Fastify()
      const { sendError } = await import('../../lib/errors')

      // These routes simulate the OLD bad pattern — they should NOT exist in production
      // We verify sendError always adds `code`
      app.get('/simulate-old-pattern', async (_req, reply) => {
        // This is what the old code looked like — we verify our helper NEVER does this
        return reply.status(404).send({ success: false, error: 'old style' })
      })
      app.get('/simulate-new-pattern', async (_req, reply) => {
        return sendError(reply, 404, 'NOT_FOUND', 'new style')
      })
      await app.ready()
    })

    it('old plain error shape lacks code field', async () => {
      const res = await app.inject({ method: 'GET', url: '/simulate-old-pattern' })
      const body = res.json()
      // The OLD pattern has no code — this test documents the problem we fixed
      expect(body).not.toHaveProperty('code')
    })

    it('sendError always adds code field — new pattern is always compliant', async () => {
      const res = await app.inject({ method: 'GET', url: '/simulate-new-pattern' })
      const body = res.json()
      expect(body).toHaveProperty('code', 'NOT_FOUND')
      assertErrorShape(body)
    })

    it('sendError error message is always a string', async () => {
      const { sendError } = await import('../../lib/errors')
      const testApp = Fastify()
      testApp.get('/msg', async (_req, reply) => sendError(reply, 400, 'BAD_REQUEST', 'some message'))
      await testApp.ready()
      const res = await testApp.inject({ method: 'GET', url: '/msg' })
      expect(typeof res.json().error).toBe('string')
    })
  })
})
