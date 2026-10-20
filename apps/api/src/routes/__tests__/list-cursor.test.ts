/**
 * A list's cursor is the previous page's (an item id). Oct 19, 2026: a date
 * as the cursor of GET /api/v1/signals answered 500 (the database refused it
 * as a uuid); so did nine other lists, and a signal's posts for an id that
 * isn't one. Now 400 (or 404 for the id), before the database is asked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerSignalRoutes } from '../signals'
import { BAD_CURSOR, isUuid } from '../../lib/cursor'

const mockRedis = { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') }
vi.mock('../../db/redis', () => ({ get redis() { return mockRedis } }))
// any query at all fails the test: these answers must come before the database
const mockDb = vi.fn(() => { throw new Error('the database was asked') })
vi.mock('../../db/postgres', () => ({ get db() { return mockDb } }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(registerSignalRoutes, { prefix: '/api/v1/signals' })
  return app
}

describe("a list's cursor", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('is an id (a uuid), never a date or a word', () => {
    expect(isUuid('95ff2fea-cf26-4a45-bc4b-03f13b5a44f8')).toBe(true)
    expect(isUuid('95FF2FEA-CF26-4A45-BC4B-03F13B5A44F8')).toBe(true)
    for (const v of ['2026-10-19T23:12:55.687Z', 'abc', '', '95ff2fea-cf26-4a45-bc4b-03f13b5a44f8x', undefined, null, 42]) expect(isUuid(v)).toBe(false)
  })

  it('GET /signals with a date as cursor answers 400, not 500, without asking the database', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals?cursor=2026-10-19T23:12:55.687Z' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ success: false, code: 'VALIDATION_ERROR', error: BAD_CURSOR })
    expect(mockDb).not.toHaveBeenCalled()
  })

  it("GET /signals/:id/posts for an id that isn't one answers 404 without asking the database", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/signals/not-an-id/posts' })
    expect(res.statusCode).toBe(404)
    expect(mockDb).not.toHaveBeenCalled()
  })
})
