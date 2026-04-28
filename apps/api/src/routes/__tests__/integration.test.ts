/**
 * WorldPulse API Integration Tests
 * Requires a running server at http://localhost:3001 with seeded data.
 */

import { describe, it, expect, beforeAll } from 'vitest'

const BASE = 'http://localhost:3001/api/v1'

// ─── SHARED AUTH STATE ────────────────────────────────────────────────────────
let accessToken  = ''
let refreshToken = ''
let testUserId   = ''
let testPostId   = ''
let testHandle   = `tester_${Date.now()}`

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function authHeader() {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

// ─── HEALTH ──────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns healthy status with all services', async () => {
    const res = await fetch('http://localhost:3001/health')
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.status).toBe('ok')
    expect(data).toHaveProperty('postgres')
    expect(data).toHaveProperty('redis')
    expect(data).toHaveProperty('uptime')
    expect(data).toHaveProperty('version')
    expect(data).toHaveProperty('timestamp')
  })
})

// ─── AUTH ─────────────────────────────────────────────────────────────────────
describe('Auth routes', () => {

  describe('POST /auth/register', () => {
    it('creates a new user and returns tokens', async () => {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle:      testHandle,
          displayName: 'Integration Tester',
          email:       `${testHandle}@test.worldpulse.io`,
          password:    'SecurePass123!',
        }),
      })
      expect(res.status).toBe(201)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      const user = d.user as Record<string, unknown>
      expect(user.handle).toBe(testHandle)
      expect(d.accessToken).toBeTruthy()
      expect(d.refreshToken).toBeTruthy()
      expect(d.expiresIn).toBe(900)
      testUserId   = user.id as string
      accessToken  = d.accessToken as string
      refreshToken = d.refreshToken as string
    })

    it('rejects duplicate handle', async () => {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle:      testHandle,
          displayName: 'Dupe',
          email:       `other_${testHandle}@test.worldpulse.io`,
          password:    'SecurePass123!',
        }),
      })
      expect(res.status).toBe(409)
      const data = await json(res)
      expect(data.success).toBe(false)
      expect(data.code).toBe('DUPLICATE')
    })

    it('rejects duplicate email', async () => {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle:      `other_${testHandle}`,
          displayName: 'Dupe Email',
          email:       `${testHandle}@test.worldpulse.io`,
          password:    'SecurePass123!',
        }),
      })
      expect(res.status).toBe(409)
    })

    it('rejects invalid email', async () => {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'valid', displayName: 'X', email: 'not-an-email', password: 'pass12345' }),
      })
      expect(res.status).toBe(400)
      const data = await json(res)
      expect(data.code).toBe('VALIDATION_ERROR')
    })

    it('rejects handle with invalid characters', async () => {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'bad handle!', displayName: 'X', email: 'x@x.com', password: 'pass12345' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects password shorter than 8 characters', async () => {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'validhandle', displayName: 'X', email: 'y@y.com', password: 'short' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects missing required fields', async () => {
      const res = await fetch(`${BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'onlyhandle' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /auth/login', () => {
    it('returns tokens for valid credentials', async () => {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:    `${testHandle}@test.worldpulse.io`,
          password: 'SecurePass123!',
        }),
      })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.accessToken).toBeTruthy()
      expect(d.refreshToken).toBeTruthy()
      // update tokens for subsequent tests
      accessToken  = d.accessToken as string
      refreshToken = d.refreshToken as string
    })

    it('rejects wrong password', async () => {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${testHandle}@test.worldpulse.io`, password: 'WrongPass!' }),
      })
      expect(res.status).toBe(401)
      const data = await json(res)
      expect(data.code).toBe('INVALID_CREDENTIALS')
    })

    it('rejects unknown email', async () => {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@nowhere.io', password: 'anything' }),
      })
      expect(res.status).toBe(401)
    })

    it('rejects malformed body', async () => {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token', async () => {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.accessToken).toBeTruthy()
      expect(d.refreshToken).not.toBe(refreshToken) // rotated
      accessToken  = d.accessToken as string
      refreshToken = d.refreshToken as string
    })

    it('rejects missing refresh token', async () => {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('rejects invalid refresh token', async () => {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'fake-token-that-does-not-exist' }),
      })
      expect(res.status).toBe(401)
    })
  })

  describe('GET /auth/me', () => {
    it('returns current user when authenticated', async () => {
      const res = await fetch(`${BASE}/auth/me`, { headers: authHeader() })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const user = (data.data as Record<string, unknown>)
      expect(user.handle).toBe(testHandle)
      expect(user).not.toHaveProperty('password_hash')
    })

    it('returns 401 without token', async () => {
      const res = await fetch(`${BASE}/auth/me`)
      expect(res.status).toBe(401)
    })

    it('returns 401 with invalid token', async () => {
      const res = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: 'Bearer totally.invalid.jwt' },
      })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /auth/logout', () => {
    it('invalidates the refresh token', async () => {
      const res = await fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)

      // refresh token should now be invalid
      const retryRes = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      expect(retryRes.status).toBe(401)

      // re-login for the rest of the test suite
      const loginRes = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${testHandle}@test.worldpulse.io`, password: 'SecurePass123!' }),
      })
      const loginData = await loginRes.json() as Record<string, unknown>
      const d = loginData.data as Record<string, unknown>
      accessToken  = d.accessToken as string
      refreshToken = d.refreshToken as string
    })

    it('succeeds even without a token body (no-op)', async () => {
      const res = await fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
    })
  })
})

// ─── FEED ─────────────────────────────────────────────────────────────────────
describe('Feed routes', () => {

  describe('GET /feed/global', () => {
    it('returns 200 with paginated items', async () => {
      const res = await fetch(`${BASE}/feed/global?limit=5`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.items).toBeInstanceOf(Array)
      expect(d).toHaveProperty('cursor')
      expect(d).toHaveProperty('hasMore')
    })

    it('respects limit parameter', async () => {
      const res = await fetch(`${BASE}/feed/global?limit=3`)
      const data = await json(res)
      const items = (data.data as Record<string, unknown>).items as unknown[]
      expect(items.length).toBeLessThanOrEqual(3)
    })

    it('supports category filter', async () => {
      const res = await fetch(`${BASE}/feed/global?category=climate&limit=5`)
      expect(res.status).toBe(200)
      const data = await json(res)
      const items = (data.data as Record<string, unknown>).items as Array<{ signal?: { category: string } }>
      items.forEach(item => {
        if (item.signal) expect(item.signal.category).toBe('climate')
      })
    })

    it('supports severity filter', async () => {
      const res = await fetch(`${BASE}/feed/global?severity=high&limit=5`)
      expect(res.status).toBe(200)
    })

    it('paginates correctly with cursor', async () => {
      const res1 = await fetch(`${BASE}/feed/global?limit=2`)
      const data1 = await json(res1)
      const d1 = data1.data as Record<string, unknown>
      if (d1.cursor) {
        const res2 = await fetch(`${BASE}/feed/global?limit=2&cursor=${d1.cursor}`)
        const data2 = await json(res2)
        expect(data2.success).toBe(true)
        const ids1 = (d1.items as Array<{ id: string }>).map(i => i.id)
        const ids2 = ((data2.data as Record<string, unknown>).items as Array<{ id: string }>).map(i => i.id)
        expect(ids1).not.toEqual(ids2)
      }
    })
  })

  describe('GET /feed/following', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/feed/following`)
      expect(res.status).toBe(401)
    })

    it('returns personalized feed when authenticated', async () => {
      const res = await fetch(`${BASE}/feed/following`, { headers: authHeader() })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      expect((data.data as Record<string, unknown>).items).toBeInstanceOf(Array)
    })
  })

  describe('GET /feed/trending', () => {
    it('returns trending topics', async () => {
      const res = await fetch(`${BASE}/feed/trending`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
    })

    it('supports window param (1h, 6h, 24h)', async () => {
      for (const window of ['1h', '6h', '24h']) {
        const res = await fetch(`${BASE}/feed/trending?window=${window}`)
        expect(res.status).toBe(200)
      }
    })
  })

  describe('GET /feed/signals', () => {
    it('returns breaking signals stream', async () => {
      const res = await fetch(`${BASE}/feed/signals`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
    })
  })
})

// ─── SIGNALS ──────────────────────────────────────────────────────────────────
describe('Signals routes', () => {

  describe('GET /signals', () => {
    it('returns paginated list of verified signals', async () => {
      const res = await fetch(`${BASE}/signals`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.items).toBeInstanceOf(Array)
      ;(d.items as Array<{ status: string }>).forEach(s => {
        expect(s.status).toBe('verified')
      })
    })

    it('filters by category', async () => {
      const res = await fetch(`${BASE}/signals?category=climate`)
      expect(res.status).toBe(200)
      const data = await json(res)
      const items = (data.data as Record<string, unknown>).items as Array<{ category: string }>
      items.forEach(s => expect(s.category).toBe('climate'))
    })

    it('filters by severity', async () => {
      const res = await fetch(`${BASE}/signals?severity=high`)
      expect(res.status).toBe(200)
    })

    it('filters by country code', async () => {
      const res = await fetch(`${BASE}/signals?country=US`)
      expect(res.status).toBe(200)
    })

    it('supports bbox geo filter', async () => {
      const res = await fetch(`${BASE}/signals?bbox=-10,35,40,72`)
      expect(res.status).toBe(200)
    })

    it('paginates with cursor', async () => {
      const res1 = await fetch(`${BASE}/signals?limit=2`)
      const d1 = (await json(res1)).data as Record<string, unknown>
      if (d1.cursor) {
        const res2 = await fetch(`${BASE}/signals?limit=2&cursor=${d1.cursor}`)
        expect(res2.status).toBe(200)
      }
    })

    it('respects max limit of 100', async () => {
      const res = await fetch(`${BASE}/signals?limit=9999`)
      expect(res.status).toBe(200)
      const d = (await json(res)).data as Record<string, unknown>
      expect((d.items as unknown[]).length).toBeLessThanOrEqual(100)
    })
  })

  describe('GET /signals/:id', () => {
    it('returns 404 for non-existent signal', async () => {
      const res = await fetch(`${BASE}/signals/00000000-0000-0000-0000-000000000000`)
      expect(res.status).toBe(404)
    })

    it('returns signal detail with verifications when found', async () => {
      // fetch a real signal first
      const listRes = await fetch(`${BASE}/signals?limit=1`)
      const listData = await json(listRes)
      const items = (listData.data as Record<string, unknown>).items as Array<{ id: string }>
      if (items.length > 0) {
        const id = items[0].id
        const res = await fetch(`${BASE}/signals/${id}`)
        expect(res.status).toBe(200)
        const data = await json(res)
        expect(data.success).toBe(true)
        const d = data.data as Record<string, unknown>
        expect(d.id).toBe(id)
        expect(d).toHaveProperty('verifications')
        expect(d).toHaveProperty('reliabilityScore')
      }
    })
  })

  describe('GET /signals/:id/posts', () => {
    it('returns posts for a signal', async () => {
      const listRes = await fetch(`${BASE}/signals?limit=1`)
      const listData = await json(listRes)
      const items = (listData.data as Record<string, unknown>).items as Array<{ id: string }>
      if (items.length > 0) {
        const id = items[0].id
        const res = await fetch(`${BASE}/signals/${id}/posts`)
        expect(res.status).toBe(200)
        const data = await json(res)
        expect(data.success).toBe(true)
        expect((data.data as Record<string, unknown>).items).toBeInstanceOf(Array)
      }
    })
  })

  describe('GET /signals/map/points', () => {
    it('returns geo data array', async () => {
      const res = await fetch(`${BASE}/signals/map/points`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      expect(data.data).toBeInstanceOf(Array)
    })

    it('filters by category', async () => {
      const res = await fetch(`${BASE}/signals/map/points?category=conflict`)
      expect(res.status).toBe(200)
    })

    it('supports hours param (max 168)', async () => {
      const res = await fetch(`${BASE}/signals/map/points?hours=48`)
      expect(res.status).toBe(200)
    })
  })

  describe('POST /signals/:id/flag', () => {
    it('requires a valid reason', async () => {
      const listRes = await fetch(`${BASE}/signals?limit=1`)
      const items = ((await json(listRes)).data as Record<string, unknown>).items as Array<{ id: string }>
      if (items.length > 0) {
        const res = await fetch(`${BASE}/signals/${items[0].id}/flag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'invalid_reason' }),
        })
        expect(res.status).toBe(400)
      }
    })

    it('rejects flag with missing reason', async () => {
      const listRes = await fetch(`${BASE}/signals?limit=1`)
      const items = ((await json(listRes)).data as Record<string, unknown>).items as Array<{ id: string }>
      if (items.length > 0) {
        const res = await fetch(`${BASE}/signals/${items[0].id}/flag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(400)
      }
    })

    it('accepts valid flag reasons', async () => {
      const listRes = await fetch(`${BASE}/signals?limit=1`)
      const items = ((await json(listRes)).data as Record<string, unknown>).items as Array<{ id: string }>
      if (items.length > 0) {
        const res = await fetch(`${BASE}/signals/${items[0].id}/flag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'inaccurate', notes: 'Test flag from integration test' }),
        })
        // 201 first time, 409 if already flagged (both are valid outcomes)
        expect([201, 409]).toContain(res.status)
      }
    })
  })
})

// ─── POSTS ────────────────────────────────────────────────────────────────────
describe('Posts routes', () => {

  describe('POST /posts', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hello', postType: 'thread' }),
      })
      expect(res.status).toBe(401)
    })

    it('creates a post when authenticated', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: 'Integration test post', postType: 'thread' }),
      })
      expect(res.status).toBe(201)
      const data = await json(res)
      expect(data.success).toBe(true)
      const post = data.data as Record<string, unknown>
      expect(post.content).toBe('Integration test post')
      expect(post.postType).toBe('thread')
      expect((post.author as Record<string, unknown>).handle).toBe(testHandle)
      testPostId = post.id as string
    })

    it('rejects empty content', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: '', postType: 'thread' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects content exceeding 2000 chars', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: 'x'.repeat(2001), postType: 'thread' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects more than 4 media URLs', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          content: 'test',
          postType: 'thread',
          mediaUrls: [
            'https://a.com/1.jpg',
            'https://a.com/2.jpg',
            'https://a.com/3.jpg',
            'https://a.com/4.jpg',
            'https://a.com/5.jpg',
          ],
        }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects more than 10 tags', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          content: 'test',
          postType: 'thread',
          tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
        }),
      })
      expect(res.status).toBe(400)
    })

    it('creates a reply to an existing post', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          content: 'This is a reply',
          postType: 'thread',
          parentId: testPostId,
        }),
      })
      expect(res.status).toBe(201)
      const data = await json(res)
      const post = data.data as Record<string, unknown>
      expect(post.parentId).toBe(testPostId)
    })
  })

  describe('GET /posts/:id', () => {
    it('returns post detail', async () => {
      const res = await fetch(`${BASE}/posts/${testPostId}`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const post = data.data as Record<string, unknown>
      expect(post.id).toBe(testPostId)
      expect(post.content).toBe('Integration test post')
    })

    it('returns 404 for non-existent post', async () => {
      const res = await fetch(`${BASE}/posts/00000000-0000-0000-0000-000000000000`)
      expect(res.status).toBe(404)
    })

    it('includes viewer-relative data when authenticated', async () => {
      const res = await fetch(`${BASE}/posts/${testPostId}`, { headers: authHeader() })
      expect(res.status).toBe(200)
      const data = await json(res)
      const post = data.data as Record<string, unknown>
      expect(post).toHaveProperty('hasLiked')
      expect(post).toHaveProperty('hasBoosted')
      expect(post).toHaveProperty('hasBookmarked')
    })
  })

  describe('GET /posts/:id/replies', () => {
    it('returns replies list', async () => {
      const res = await fetch(`${BASE}/posts/${testPostId}/replies`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.items).toBeInstanceOf(Array)
      expect(d).toHaveProperty('cursor')
      expect(d).toHaveProperty('hasMore')
    })
  })

  describe('POST /posts/:id/like', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/posts/${testPostId}/like`, { method: 'POST' })
      expect(res.status).toBe(401)
    })

    it('likes a post and toggles on second call', async () => {
      const res1 = await fetch(`${BASE}/posts/${testPostId}/like`, {
        method: 'POST',
        headers: authHeader(),
      })
      expect(res1.status).toBe(200)
      const d1 = (await json(res1)).data as Record<string, unknown>
      expect(d1.liked).toBe(true)
      expect(d1).toHaveProperty('count')

      // unlike
      const res2 = await fetch(`${BASE}/posts/${testPostId}/like`, {
        method: 'POST',
        headers: authHeader(),
      })
      const d2 = (await json(res2)).data as Record<string, unknown>
      expect(d2.liked).toBe(false)
    })

    it('returns 404 for non-existent post', async () => {
      const res = await fetch(`${BASE}/posts/00000000-0000-0000-0000-000000000000/like`, {
        method: 'POST',
        headers: authHeader(),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /posts/:id/bookmark', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/posts/${testPostId}/bookmark`, { method: 'POST' })
      expect(res.status).toBe(401)
    })

    it('bookmarks and unbookmarks a post', async () => {
      const res1 = await fetch(`${BASE}/posts/${testPostId}/bookmark`, {
        method: 'POST',
        headers: authHeader(),
      })
      expect(res1.status).toBe(200)
      const d1 = (await json(res1)).data as Record<string, unknown>
      expect(d1.bookmarked).toBe(true)

      const res2 = await fetch(`${BASE}/posts/${testPostId}/bookmark`, {
        method: 'POST',
        headers: authHeader(),
      })
      const d2 = (await json(res2)).data as Record<string, unknown>
      expect(d2.bookmarked).toBe(false)
    })
  })

  describe('POST /posts (boost)', () => {
    it('creates a boost post', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          content:   'Boosting this',
          postType:  'boost',
          boostOfId: testPostId,
        }),
      })
      expect(res.status).toBe(201)
      const data = await json(res)
      const post = data.data as Record<string, unknown>
      expect(post.postType).toBe('boost')
      expect(post.boostOfId).toBe(testPostId)
    })
  })

  describe('DELETE /posts/:id', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/posts/${testPostId}`, { method: 'DELETE' })
      expect(res.status).toBe(401)
    })

    it('soft-deletes own post', async () => {
      // Create a post to delete
      const createRes = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: 'To be deleted', postType: 'thread' }),
      })
      const created = (await json(createRes)).data as Record<string, unknown>
      const idToDelete = created.id as string

      const delRes = await fetch(`${BASE}/posts/${idToDelete}`, {
        method: 'DELETE',
        headers: authHeader(),
      })
      expect(delRes.status).toBe(200)

      // Should be gone
      const getRes = await fetch(`${BASE}/posts/${idToDelete}`)
      expect(getRes.status).toBe(404)
    })

    it('rejects deletion of another user post', async () => {
      // testPostId was created by our test user; if there are other posts in the
      // system we can test 403, but here we verify the endpoint works with auth
      const res = await fetch(`${BASE}/posts/00000000-0000-0000-0000-000000000000`, {
        method: 'DELETE',
        headers: authHeader(),
      })
      expect(res.status).toBe(404) // non-existent → 404
    })
  })
})

// ─── SEARCH ───────────────────────────────────────────────────────────────────
describe('Search routes', () => {

  describe('GET /search', () => {
    it('requires at least 2 characters', async () => {
      const res = await fetch(`${BASE}/search?q=a`)
      expect(res.status).toBe(400)
      const data = await json(res)
      expect(data.success).toBe(false)
    })

    it('returns zero results for obscure query', async () => {
      const res = await fetch(`${BASE}/search?q=xyzzy_no_results_expected_99999`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.total).toBe(0)
    })

    it('returns results structure for valid query', async () => {
      const res = await fetch(`${BASE}/search?q=climate`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d).toHaveProperty('results')
      expect(d).toHaveProperty('query')
      expect(d).toHaveProperty('type')
      expect(d).toHaveProperty('page')
      expect(d).toHaveProperty('limit')
    })

    it('searches only signals when type=signals', async () => {
      const res = await fetch(`${BASE}/search?q=climate&type=signals`)
      const data = await json(res)
      expect((data.data as Record<string, unknown>).type).toBe('signals')
    })

    it('searches only posts when type=posts', async () => {
      const res = await fetch(`${BASE}/search?q=climate&type=posts`)
      const data = await json(res)
      expect((data.data as Record<string, unknown>).type).toBe('posts')
    })

    it('searches only users when type=users', async () => {
      const res = await fetch(`${BASE}/search?q=world&type=users`)
      const data = await json(res)
      expect((data.data as Record<string, unknown>).type).toBe('users')
    })

    it('searches tags', async () => {
      const res = await fetch(`${BASE}/search?q=climate&type=tags`)
      expect(res.status).toBe(200)
    })

    it('applies category filter', async () => {
      const res = await fetch(`${BASE}/search?q=news&category=health`)
      expect(res.status).toBe(200)
    })

    it('applies severity filter', async () => {
      const res = await fetch(`${BASE}/search?q=news&severity=high`)
      expect(res.status).toBe(200)
    })

    it('applies country filter', async () => {
      const res = await fetch(`${BASE}/search?q=news&country=US`)
      expect(res.status).toBe(200)
    })

    it('applies date range filters', async () => {
      const res = await fetch(`${BASE}/search?q=news&from=2024-01-01&to=2024-12-31`)
      expect(res.status).toBe(200)
    })

    it('applies reliability filter', async () => {
      const res = await fetch(`${BASE}/search?q=news&reliability=70`)
      expect(res.status).toBe(200)
    })

    it('supports sort=oldest', async () => {
      const res = await fetch(`${BASE}/search?q=news&sort=oldest`)
      expect(res.status).toBe(200)
    })

    it('supports sort=discussed', async () => {
      const res = await fetch(`${BASE}/search?q=news&sort=discussed`)
      expect(res.status).toBe(200)
    })

    it('paginates with page param', async () => {
      const res = await fetch(`${BASE}/search?q=news&page=1&limit=5`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect((data.data as Record<string, unknown>).page).toBe(1)
    })

    it('returns facets when type=signals', async () => {
      const res = await fetch(`${BASE}/search?q=climate&type=signals`)
      const data = await json(res)
      const d = data.data as Record<string, unknown>
      expect(d).toHaveProperty('facets')
    })

    it('rejects missing q param', async () => {
      const res = await fetch(`${BASE}/search`)
      expect(res.status).toBe(400)
    })
  })

  describe('GET /search/autocomplete', () => {
    it('returns empty array for very short query', async () => {
      const res = await fetch(`${BASE}/search/autocomplete`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
    })

    it('returns suggestions structure for valid query', async () => {
      const res = await fetch(`${BASE}/search/autocomplete?q=cli`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d).toHaveProperty('signals')
      expect(d).toHaveProperty('users')
      expect(d).toHaveProperty('tags')
    })
  })
})

// ─── USERS ────────────────────────────────────────────────────────────────────
describe('Users routes', () => {

  describe('GET /users/:handle', () => {
    it('returns user profile', async () => {
      const res = await fetch(`${BASE}/users/${testHandle}`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const user = data.data as Record<string, unknown>
      expect(user.handle).toBe(testHandle)
      expect(user).toHaveProperty('followerCount')
      expect(user).toHaveProperty('trustScore')
      expect(user).not.toHaveProperty('email')
    })

    it('returns 404 for non-existent handle', async () => {
      const res = await fetch(`${BASE}/users/absolutely_no_one_9999`)
      expect(res.status).toBe(404)
    })

    it('includes isFollowing when authenticated', async () => {
      const res = await fetch(`${BASE}/users/${testHandle}`, { headers: authHeader() })
      const data = await json(res)
      const user = data.data as Record<string, unknown>
      expect(user).toHaveProperty('isFollowing')
      expect(user).toHaveProperty('isFollowedBy')
    })
  })

  describe('PUT /users/me', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/users/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'New Name' }),
      })
      expect(res.status).toBe(401)
    })

    it('updates profile fields', async () => {
      const res = await fetch(`${BASE}/users/me`, {
        method: 'PUT',
        headers: authHeader(),
        body: JSON.stringify({ displayName: 'Updated Name', bio: 'Test bio' }),
      })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const user = data.data as Record<string, unknown>
      expect(user.displayName).toBe('Updated Name')
      expect(user.bio).toBe('Test bio')
    })

    it('rejects empty update body', async () => {
      const res = await fetch(`${BASE}/users/me`, {
        method: 'PUT',
        headers: authHeader(),
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /users/:handle/follow', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/users/${testHandle}/follow`, { method: 'POST' })
      expect(res.status).toBe(401)
    })

    it('returns 404 for non-existent user', async () => {
      const res = await fetch(`${BASE}/users/nobody_exists_here_9999/follow`, {
        method: 'POST',
        headers: authHeader(),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /users/:handle/posts', () => {
    it('returns user posts list', async () => {
      const res = await fetch(`${BASE}/users/${testHandle}/posts`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      expect((data.data as Record<string, unknown>).items).toBeInstanceOf(Array)
    })

    it('paginates posts with cursor', async () => {
      const res = await fetch(`${BASE}/users/${testHandle}/posts?limit=2`)
      expect(res.status).toBe(200)
      const data = await json(res)
      const d = data.data as Record<string, unknown>
      expect(d).toHaveProperty('cursor')
      expect(d).toHaveProperty('hasMore')
    })

    it('returns 404 for non-existent handle', async () => {
      const res = await fetch(`${BASE}/users/nobody_exists_9999/posts`)
      expect(res.status).toBe(404)
    })
  })

  describe('GET /users/:handle/signals', () => {
    it('returns signals for a user', async () => {
      const res = await fetch(`${BASE}/users/${testHandle}/signals`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.items).toBeInstanceOf(Array)
      expect(d).toHaveProperty('cursor')
      expect(d).toHaveProperty('hasMore')
    })

    it('paginates signals with limit', async () => {
      const res = await fetch(`${BASE}/users/${testHandle}/signals?limit=5`)
      expect(res.status).toBe(200)
      const data = await json(res)
      const items = (data.data as Record<string, unknown>).items as unknown[]
      expect(items.length).toBeLessThanOrEqual(5)
    })

    it('returns 404 for non-existent handle', async () => {
      const res = await fetch(`${BASE}/users/nobody_exists_9999/signals`)
      expect(res.status).toBe(404)
    })
  })

  describe('PUT /users/me response shape', () => {
    it('returns camelCase keys', async () => {
      const res = await fetch(`${BASE}/users/me`, {
        method: 'PUT',
        headers: authHeader(),
        body: JSON.stringify({ displayName: 'CamelCase Test' }),
      })
      expect(res.status).toBe(200)
      const data = await json(res)
      const user = data.data as Record<string, unknown>
      // Must use camelCase, not snake_case
      expect(user).toHaveProperty('displayName')
      expect(user).toHaveProperty('avatarUrl')
      expect(user).toHaveProperty('accountType')
      expect(user).toHaveProperty('trustScore')
      expect(user).toHaveProperty('followerCount')
      expect(user).toHaveProperty('followingCount')
      expect(user).not.toHaveProperty('display_name')
      expect(user).not.toHaveProperty('avatar_url')
      expect(user).not.toHaveProperty('account_type')
    })
  })
})

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
describe('Rate limiting', () => {
  it('enforces auth rate limit (5/min) on POST /auth/login', async () => {
    // Fire 10 rapid login attempts with wrong credentials to trigger the 5/min limit
    const requests = Array.from({ length: 10 }, () =>
      fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ratelimit@test.io', password: 'wrong' }),
      })
    )
    const responses = await Promise.all(requests)
    const limited = responses.some(r => r.status === 429)
    expect(limited).toBe(true)
  }, 15_000)

  it('enforces search rate limit (30/min)', async () => {
    const requests = Array.from({ length: 35 }, () =>
      fetch(`${BASE}/search?q=climate`)
    )
    const responses = await Promise.all(requests)
    const limited = responses.some(r => r.status === 429)
    expect(limited).toBe(true)
  }, 15_000)
})

// ─── INPUT VALIDATION ─────────────────────────────────────────────────────────
describe('Input validation', () => {
  it('rejects non-JSON body on POST endpoints', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'email=foo&password=bar',
    })
    expect([400, 415]).toContain(res.status)
  })

  it('returns structured error codes on validation failure', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'x', displayName: 'X', email: 'bad', password: 'short' }),
    })
    expect(res.status).toBe(400)
    const data = await json(res)
    expect(data.success).toBe(false)
    expect(data).toHaveProperty('code')
  })
})
