/**
 * Users Route — Unit Tests
 *
 * Tests for exported pure functions from apps/api/src/routes/users.ts:
 *   UpdateProfileSchema — Zod validation for profile update payload
 *   OnboardingSchema   — Zod validation for onboarding completion payload
 *
 * Also covers route-level business logic via Fastify inject:
 *   GET   /:handle        — profile lookup, 404 when not found
 *   POST  /:handle/follow — follow/unfollow toggle, self-follow guard
 *   PATCH /me/onboarding  — complete onboarding, save prefs, bulk-follow
 *   GET   /suggestions/follow — suggested accounts
 *
 * All DB / Redis / search dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

// ── Mock heavy deps before any route imports ─────────────────────────────────
vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../db/redis', () => ({
  redis: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}))
vi.mock('../lib/search', () => ({ indexUser: vi.fn() }))

// optionalAuth passes through; authenticate injects a test user
vi.mock('../middleware/auth', () => ({
  optionalAuth:  vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
  authenticate:  vi.fn((req: { user?: { id: string } }, _reply: unknown, done: () => void) => {
    req.user = { id: 'viewer-id' }
    done()
  }),
}))

import { UpdateProfileSchema, OnboardingSchema } from '../routes/users'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { registerUserRoutes } from '../routes/users'

// ─── UpdateProfileSchema ──────────────────────────────────────────────────────

describe('UpdateProfileSchema — validation', () => {
  it('accepts displayName only', () => {
    expect(UpdateProfileSchema.safeParse({ displayName: 'Jane Doe' }).success).toBe(true)
  })

  it('accepts bio only', () => {
    expect(UpdateProfileSchema.safeParse({ bio: 'Reporter at Reuters' }).success).toBe(true)
  })

  it('accepts location only', () => {
    expect(UpdateProfileSchema.safeParse({ location: 'London, UK' }).success).toBe(true)
  })

  it('accepts a valid website URL', () => {
    expect(UpdateProfileSchema.safeParse({ website: 'https://example.com' }).success).toBe(true)
  })

  it('accepts an empty string website (URL cleared)', () => {
    expect(UpdateProfileSchema.safeParse({ website: '' }).success).toBe(true)
  })

  it('rejects an invalid website URL', () => {
    expect(UpdateProfileSchema.safeParse({ website: 'not-a-url' }).success).toBe(false)
  })

  it('accepts all fields simultaneously', () => {
    expect(
      UpdateProfileSchema.safeParse({
        displayName: 'Jane',
        bio:         'Reporter',
        location:    'Paris',
        website:     'https://jane.dev',
      }).success,
    ).toBe(true)
  })

  it('rejects empty object — no fields to update', () => {
    const r = UpdateProfileSchema.safeParse({})
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.errors[0].message).toBe('No fields to update')
    }
  })

  it('rejects displayName longer than 100 characters', () => {
    expect(UpdateProfileSchema.safeParse({ displayName: 'x'.repeat(101) }).success).toBe(false)
  })

  it('rejects bio longer than 500 characters', () => {
    expect(UpdateProfileSchema.safeParse({ bio: 'x'.repeat(501) }).success).toBe(false)
  })

  it('rejects location longer than 100 characters', () => {
    expect(UpdateProfileSchema.safeParse({ location: 'x'.repeat(101) }).success).toBe(false)
  })

  it('rejects website URL longer than 255 characters', () => {
    const longUrl = 'https://example.com/' + 'x'.repeat(240)
    expect(UpdateProfileSchema.safeParse({ website: longUrl }).success).toBe(false)
  })
})

// ─── Route handler tests via Fastify inject ───────────────────────────────────

/** Build a Fastify instance with the user routes registered */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(registerUserRoutes, { prefix: '/' })
  await app.ready()
  return app
}

/** Helper: make db() return a chainable query builder stub */
function mockDbChain(finalValue: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'where', 'whereIn', 'whereNotIn', 'whereNot', 'whereNull',
    'first', 'select', 'pluck', 'insert', 'update', 'delete',
    'returning', 'orderBy', 'limit', 'offset', 'increment',
    'onConflict', 'ignore', 'leftJoin', 'join', 'count',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Terminal awaitable
  ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(finalValue).then(res)
  return chain
}

describe('GET /:handle — profile lookup', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 404 when user handle is not found', async () => {
    // db('users').where(...).first([...]) → null
    const chain = mockDbChain(null)
    ;(db as unknown as MockedFunction<() => typeof chain>).mockReturnValue(chain)

    const res = await app.inject({ method: 'GET', url: '/unknownuser' })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('User not found')
  })

  it('returns 200 with user data when handle exists', async () => {
    const fakeUser = {
      id:             'user-001',
      handle:         'janedoe',
      display_name:   'Jane Doe',
      bio:            'Reporter',
      avatar_url:     null,
      location:       'London',
      website:        'https://jane.dev',
      account_type:   'journalist',
      trust_score:    0.88,
      follower_count: 120,
      following_count: 30,
      signal_count:   15,
      verified:       true,
      created_at:     new Date('2023-01-01T00:00:00Z'),
    }
    const chain = mockDbChain(fakeUser)
    ;(db as unknown as MockedFunction<() => typeof chain>).mockReturnValue(chain)

    const res = await app.inject({ method: 'GET', url: '/janedoe' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean; data: { handle: string; trustScore: number } }
    expect(body.success).toBe(true)
    expect(body.data.handle).toBe('janedoe')
    expect(body.data.trustScore).toBe(0.88)
  })
})

describe('POST /:handle/follow — follow/unfollow toggle', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 404 when target user handle is not found', async () => {
    const chain = mockDbChain(null) // first() returns null → user not found
    ;(db as unknown as MockedFunction<() => typeof chain>).mockReturnValue(chain)

    const res = await app.inject({ method: 'POST', url: '/ghost/follow' })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { error: string }
    expect(body.error).toBe('User not found')
  })

  it('returns 400 when viewer tries to follow themselves', async () => {
    // The authenticate mock injects { id: 'viewer-id' }
    // Target user has the same id → self-follow
    const chain = mockDbChain({ id: 'viewer-id' })
    ;(db as unknown as MockedFunction<() => typeof chain>).mockReturnValue(chain)

    const res = await app.inject({ method: 'POST', url: '/selfuser/follow' })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as { error: string }
    expect(body.error).toBe('Cannot follow yourself')
  })
})

describe('GET /suggestions/follow', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 200 with an array of suggested users', async () => {
    const fakeUsers = [
      { id: 'u1', handle: 'reuters', display_name: 'Reuters', account_type: 'official', verified: true, follower_count: 5000 },
      { id: 'u2', handle: 'bbc',     display_name: 'BBC News', account_type: 'official', verified: true, follower_count: 4000 },
    ]
    const chain = mockDbChain(fakeUsers)
    ;(db as unknown as MockedFunction<() => typeof chain>).mockReturnValue(chain)

    const res = await app.inject({ method: 'GET', url: '/suggestions/follow' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean; data: unknown[] }
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })
})

// ─── OnboardingSchema — validation ───────────────────────────────────────────

describe('OnboardingSchema — validation', () => {
  it('accepts a fully populated payload', () => {
    const result = OnboardingSchema.safeParse({
      interests:     ['conflict', 'climate', 'technology'],
      regions:       ['Europe', 'North America'],
      followHandles: ['reuters', 'bbc'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.interests).toHaveLength(3)
      expect(result.data.regions).toHaveLength(2)
      expect(result.data.followHandles).toHaveLength(2)
    }
  })

  it('accepts an empty object — all fields default to []', () => {
    const result = OnboardingSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.interests).toEqual([])
      expect(result.data.regions).toEqual([])
      expect(result.data.followHandles).toEqual([])
    }
  })

  it('accepts partial payload — only interests', () => {
    const result = OnboardingSchema.safeParse({ interests: ['health'] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.interests).toEqual(['health'])
      expect(result.data.regions).toEqual([])
      expect(result.data.followHandles).toEqual([])
    }
  })

  it('rejects interests array exceeding 50 items', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `topic-${i}`)
    expect(OnboardingSchema.safeParse({ interests: tooMany }).success).toBe(false)
  })

  it('rejects regions array exceeding 20 items', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `region-${i}`)
    expect(OnboardingSchema.safeParse({ regions: tooMany }).success).toBe(false)
  })

  it('rejects followHandles array exceeding 100 items', () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => `user-${i}`)
    expect(OnboardingSchema.safeParse({ followHandles: tooMany }).success).toBe(false)
  })

  it('rejects individual interest strings exceeding 50 characters', () => {
    expect(OnboardingSchema.safeParse({ interests: ['x'.repeat(51)] }).success).toBe(false)
  })

  it('rejects non-string values in interests', () => {
    expect(OnboardingSchema.safeParse({ interests: [123] }).success).toBe(false)
  })
})

// ─── PATCH /me/onboarding — complete onboarding ─────────────────────────────

describe('PATCH /me/onboarding — complete onboarding', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 200 and marks user as onboarded with interests and regions', async () => {
    // db('users').where('id', userId).update(...) → 1 row updated
    const updateChain = mockDbChain(1)
    ;(db as unknown as MockedFunction<() => typeof updateChain>).mockReturnValue(updateChain)

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: {
        interests:     ['conflict', 'climate'],
        regions:       ['Europe', 'Middle East'],
        followHandles: [],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean; data: { onboarded: boolean } }
    expect(body.success).toBe(true)
    expect(body.data.onboarded).toBe(true)

    // Verify Redis cache was invalidated
    expect(redis.del).toHaveBeenCalledWith('user:viewer-id')
  })

  it('returns 200 with empty arrays when skipping onboarding', async () => {
    const updateChain = mockDbChain(1)
    ;(db as unknown as MockedFunction<() => typeof updateChain>).mockReturnValue(updateChain)

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: {
        interests:     [],
        regions:       [],
        followHandles: [],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean; data: { onboarded: boolean } }
    expect(body.success).toBe(true)
    expect(body.data.onboarded).toBe(true)
  })

  it('returns 200 with no body — defaults kick in', async () => {
    const updateChain = mockDbChain(1)
    ;(db as unknown as MockedFunction<() => typeof updateChain>).mockReturnValue(updateChain)

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { success: boolean }
    expect(body.success).toBe(true)
  })

  it('bulk-follows selected handles during onboarding', async () => {
    // First call: db('users').where(...).update(...) → update onboarded
    // Second call: db('users').whereIn(handles).whereNot(self).select('id') → target ids
    // Third call: db('follows').insert(...).onConflict(...).ignore() → bulk insert
    const updateChain = mockDbChain(1)
    const targetChain = mockDbChain([{ id: 'target-1' }, { id: 'target-2' }])
    const insertChain = mockDbChain(undefined)

    let callCount = 0
    ;(db as unknown as MockedFunction<() => unknown>).mockImplementation(() => {
      callCount++
      if (callCount === 1) return updateChain  // UPDATE users SET onboarded
      if (callCount === 2) return targetChain   // SELECT id FROM users WHERE handle IN (...)
      return insertChain                        // INSERT INTO follows
    })

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: {
        interests:     ['technology'],
        regions:       ['East Asia'],
        followHandles: ['reuters', 'bbc'],
      },
    })

    expect(res.statusCode).toBe(200)
    // Should have called db at least 3 times (update + select targets + insert follows)
    expect(callCount).toBeGreaterThanOrEqual(3)
  })

  it('returns 400 for invalid payload — interests with wrong type', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: { interests: 'not-an-array' },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as { success: boolean; error: string; code: string }
    expect(body.success).toBe(false)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('invalidates Redis user cache after onboarding', async () => {
    const updateChain = mockDbChain(1)
    ;(db as unknown as MockedFunction<() => typeof updateChain>).mockReturnValue(updateChain)

    await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: {},
    })

    expect(redis.del).toHaveBeenCalledWith('user:viewer-id')
  })
})
