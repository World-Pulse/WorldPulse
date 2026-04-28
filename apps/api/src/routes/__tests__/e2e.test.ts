/**
 * WorldPulse API — End-to-End Tests
 *
 * Requires a running server at http://localhost:3001 with seeded data.
 * Run with: pnpm test (from apps/api) or vitest run src/routes/__tests__/e2e.test.ts
 *
 * Execution order matters: auth tests run first to obtain tokens used by
 * subsequent authenticated tests.
 */

import { describe, it, expect, beforeAll } from 'vitest'

const BASE = 'http://localhost:3001/api/v1'

// ─── SHARED STATE ─────────────────────────────────────────────────────────────
let accessToken  = ''
let testHandle   = `e2e_${Date.now()}`
let testPostId   = ''
let testSignalId = ''

function authHeader(): Record<string, string> {
  return {
    Authorization:  `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  it('creates a new user and returns tokens', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle:      testHandle,
        displayName: 'E2E Tester',
        email:       `${testHandle}@e2e.worldpulse.io`,
        password:    'E2eSecure123!',
      }),
    })
    expect(res.status).toBe(201)
    const data = await json(res)
    expect(data.success).toBe(true)
    const d = data.data as Record<string, unknown>
    expect((d.user as Record<string, unknown>).handle).toBe(testHandle)
    expect(d.accessToken).toBeTruthy()
    expect(d.refreshToken).toBeTruthy()
    expect(d.expiresIn).toBe(900)
    accessToken = d.accessToken as string
  })

  it('rejects duplicate handle', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle:      testHandle,
        displayName: 'Dupe',
        email:       `dupe_${testHandle}@e2e.worldpulse.io`,
        password:    'E2eSecure123!',
      }),
    })
    expect(res.status).toBe(409)
    const data = await json(res)
    expect(data.success).toBe(false)
    expect(data.code).toBe('DUPLICATE')
  })

  it('rejects invalid email', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'validhandle', displayName: 'X', email: 'not-an-email', password: 'pass12345' }),
    })
    expect(res.status).toBe(400)
    const data = await json(res)
    expect(data.code).toBe('VALIDATION_ERROR')
  })

  it('rejects handle with invalid characters (spaces / special chars)', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'bad handle!', displayName: 'X', email: 'x@x.com', password: 'pass12345' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects password shorter than 8 chars', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'validone', displayName: 'X', email: 'y@y.com', password: 'short' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing required fields', async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'onlyhandle' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /auth/login', () => {
  it('returns tokens for valid credentials', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:    `${testHandle}@e2e.worldpulse.io`,
        password: 'E2eSecure123!',
      }),
    })
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.success).toBe(true)
    const d = data.data as Record<string, unknown>
    expect(d.accessToken).toBeTruthy()
    expect(d.refreshToken).toBeTruthy()
    // Rotate to latest token for downstream tests
    accessToken = d.accessToken as string
  })

  it('rejects wrong password', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${testHandle}@e2e.worldpulse.io`, password: 'WrongPass!' }),
    })
    expect(res.status).toBe(401)
    const data = await json(res)
    expect(data.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects unknown email', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.io', password: 'anything123' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects missing body fields', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'only@email.com' }),
    })
    expect(res.status).toBe(400)
    const data = await json(res)
    expect(data.code).toBe('VALIDATION_ERROR')
  })
})

// ─── FEED ──────────────────────────────────────────────────────────────────────
describe('GET /feed', () => {
  describe('GET /feed/global', () => {
    it('returns paginated posts without auth', async () => {
      const res = await fetch(`${BASE}/feed/global`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(Array.isArray(data.items)).toBe(true)
      expect(typeof data.hasMore).toBe('boolean')
      expect('cursor' in data).toBe(true)
    })

    it('respects the limit query param (max 50)', async () => {
      const res = await fetch(`${BASE}/feed/global?limit=5`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect((data.items as unknown[]).length).toBeLessThanOrEqual(5)
    })

    it('accepts category filter', async () => {
      const res = await fetch(`${BASE}/feed/global?category=politics`)
      expect(res.status).toBe(200)
    })

    it('accepts severity filter', async () => {
      const res = await fetch(`${BASE}/feed/global?severity=critical`)
      expect(res.status).toBe(200)
    })

    it('returns viewer-enriched data when authenticated', async () => {
      const res = await fetch(`${BASE}/feed/global`, { headers: authHeader() })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(Array.isArray(data.items)).toBe(true)
    })
  })

  describe('GET /feed/trending', () => {
    it('returns trending topics', async () => {
      const res = await fetch(`${BASE}/feed/trending`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(Array.isArray(data.items)).toBe(true)
      expect(data).toHaveProperty('window')
    })

    it('accepts window param', async () => {
      const res = await fetch(`${BASE}/feed/trending?window=6h`)
      expect(res.status).toBe(200)
    })
  })

  describe('GET /feed/signals', () => {
    it('returns signals feed', async () => {
      const res = await fetch(`${BASE}/feed/signals`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(Array.isArray(data.items)).toBe(true)
    })
  })
})

// ─── SIGNALS ───────────────────────────────────────────────────────────────────
describe('GET /signals', () => {
  describe('GET /signals (list)', () => {
    it('returns paginated signals', async () => {
      const res = await fetch(`${BASE}/signals`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(Array.isArray(d.items)).toBe(true)
      expect(typeof d.hasMore).toBe('boolean')

      // Capture a signal id for detail test
      const items = d.items as Array<Record<string, unknown>>
      if (items.length > 0) {
        testSignalId = items[0].id as string
      }
    })

    it('filters by category', async () => {
      const res = await fetch(`${BASE}/signals?category=conflict`)
      expect(res.status).toBe(200)
      const data = await json(res)
      const items = (data.data as Record<string, unknown>).items as Array<Record<string, unknown>>
      items.forEach(item => {
        expect(item.category).toBe('conflict')
      })
    })

    it('filters by severity', async () => {
      const res = await fetch(`${BASE}/signals?severity=critical`)
      expect(res.status).toBe(200)
      const data = await json(res)
      const items = (data.data as Record<string, unknown>).items as Array<Record<string, unknown>>
      items.forEach(item => {
        expect(item.severity).toBe('critical')
      })
    })

    it('respects the limit param', async () => {
      const res = await fetch(`${BASE}/signals?limit=3`)
      expect(res.status).toBe(200)
      const data = await json(res)
      const items = (data.data as Record<string, unknown>).items as unknown[]
      expect(items.length).toBeLessThanOrEqual(3)
    })
  })

  describe('GET /signals/:id', () => {
    it('returns 404 for unknown signal', async () => {
      const res = await fetch(`${BASE}/signals/00000000-0000-0000-0000-000000000000`)
      expect(res.status).toBe(404)
      const data = await json(res)
      expect(data.success).toBe(false)
    })

    it('returns signal detail for a valid id', async () => {
      if (!testSignalId) {
        console.warn('Skipping signal detail test — no signals in DB')
        return
      }
      const res = await fetch(`${BASE}/signals/${testSignalId}`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.id).toBe(testSignalId)
      expect(d).toHaveProperty('title')
      expect(d).toHaveProperty('category')
      expect(d).toHaveProperty('severity')
      expect(d).toHaveProperty('status')
      expect(Array.isArray(d.verifications)).toBe(true)
    })
  })

  describe('GET /signals/map/points', () => {
    it('returns geo points for map rendering', async () => {
      const res = await fetch(`${BASE}/signals/map/points`)
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      expect(Array.isArray(data.data)).toBe(true)
    })

    it('accepts hours param (max 168)', async () => {
      const res = await fetch(`${BASE}/signals/map/points?hours=48`)
      expect(res.status).toBe(200)
    })

    it('filters by category', async () => {
      const res = await fetch(`${BASE}/signals/map/points?category=natural_disaster`)
      expect(res.status).toBe(200)
    })
  })
})

// ─── SEARCH ────────────────────────────────────────────────────────────────────
describe('GET /search', () => {
  it('returns results for a valid query', async () => {
    const res = await fetch(`${BASE}/search?q=crisis`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.success).toBe(true)
    const d = data.data as Record<string, unknown>
    expect(d).toHaveProperty('query', 'crisis')
    expect(d).toHaveProperty('results')
    expect(typeof d.total).toBe('number')
  })

  it('returns zero-results response (not an error) for obscure query', async () => {
    const res = await fetch(`${BASE}/search?q=xyzxyzxyzobscure999notaword`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.success).toBe(true)
    const d = data.data as Record<string, unknown>
    expect(d.total).toBe(0)
  })

  it('rejects query shorter than 2 characters', async () => {
    const res = await fetch(`${BASE}/search?q=a`)
    expect(res.status).toBe(400)
    const data = await json(res)
    expect(data.success).toBe(false)
  })

  it('rejects missing query param', async () => {
    const res = await fetch(`${BASE}/search`)
    expect(res.status).toBe(400)
  })

  it('accepts type=signals filter', async () => {
    const res = await fetch(`${BASE}/search?q=earthquake&type=signals`)
    expect(res.status).toBe(200)
    const data = await json(res)
    const d = data.data as Record<string, unknown>
    const results = d.results as Record<string, unknown>
    expect(results).toHaveProperty('signals')
    expect(results).not.toHaveProperty('posts')
    expect(results).not.toHaveProperty('users')
  })

  it('accepts type=posts filter', async () => {
    const res = await fetch(`${BASE}/search?q=breaking&type=posts`)
    expect(res.status).toBe(200)
    const data = await json(res)
    const d = data.data as Record<string, unknown>
    const results = d.results as Record<string, unknown>
    expect(results).toHaveProperty('posts')
  })

  it('accepts category and severity filters', async () => {
    const res = await fetch(`${BASE}/search?q=flood&type=signals&category=natural_disaster&severity=high`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.success).toBe(true)
  })

  it('accepts from/to date filters', async () => {
    const res = await fetch(`${BASE}/search?q=election&from=2024-01-01&to=2025-12-31`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.success).toBe(true)
  })

  it('accepts sort=discussed', async () => {
    const res = await fetch(`${BASE}/search?q=war&sort=discussed`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.success).toBe(true)
  })

  it('returns facets when type=signals', async () => {
    const res = await fetch(`${BASE}/search?q=conflict&type=signals`)
    expect(res.status).toBe(200)
    const data = await json(res)
    const d = data.data as Record<string, unknown>
    // facets may be empty but must be present
    expect(d).toHaveProperty('facets')
  })

  it('paginates results with page param', async () => {
    const [page0, page1] = await Promise.all([
      fetch(`${BASE}/search?q=news&page=0&limit=5`).then(r => r.json() as Promise<Record<string, unknown>>),
      fetch(`${BASE}/search?q=news&page=1&limit=5`).then(r => r.json() as Promise<Record<string, unknown>>),
    ])
    expect((page0 as Record<string, unknown>).success).toBe(true)
    expect((page1 as Record<string, unknown>).success).toBe(true)
  })
})

// ─── POSTS ─────────────────────────────────────────────────────────────────────
describe('POST /posts', () => {
  describe('POST /posts (create)', () => {
    it('requires authentication', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Unauthenticated post attempt' }),
      })
      expect(res.status).toBe(401)
    })

    it('rejects empty content', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method:  'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: '' }),
      })
      expect(res.status).toBe(400)
      const data = await json(res)
      expect(data.success).toBe(false)
      expect(data.code).toBe('VALIDATION')
    })

    it('rejects content over 2000 chars', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method:  'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: 'x'.repeat(2001) }),
      })
      expect(res.status).toBe(400)
    })

    it('creates a new post and returns it', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method:  'POST',
        headers: authHeader(),
        body: JSON.stringify({
          content:  'E2E test post — please ignore.',
          postType: 'thread',
          tags:     ['e2e', 'test'],
        }),
      })
      expect(res.status).toBe(201)
      const data = await json(res)
      expect(data.success).toBe(true)
      const post = data.data as Record<string, unknown>
      expect(post).toHaveProperty('id')
      expect(post.content).toBe('E2E test post — please ignore.')
      expect(post).toHaveProperty('author')
      testPostId = post.id as string
    })

    it('rejects invalid postType', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method:  'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: 'Valid content', postType: 'not_a_type' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects non-URL mediaUrls', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method:  'POST',
        headers: authHeader(),
        body: JSON.stringify({ content: 'Valid content', mediaUrls: ['not-a-url'] }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects more than 4 media attachments', async () => {
      const res = await fetch(`${BASE}/posts`, {
        method:  'POST',
        headers: authHeader(),
        body: JSON.stringify({
          content:   'Valid content',
          mediaUrls: [
            'https://example.com/1.jpg',
            'https://example.com/2.jpg',
            'https://example.com/3.jpg',
            'https://example.com/4.jpg',
            'https://example.com/5.jpg',
          ],
        }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /posts/:id/like', () => {
    it('requires authentication', async () => {
      if (!testPostId) return
      const res = await fetch(`${BASE}/posts/${testPostId}/like`, { method: 'POST' })
      expect(res.status).toBe(401)
    })

    it('likes a post', async () => {
      if (!testPostId) return
      const res = await fetch(`${BASE}/posts/${testPostId}/like`, {
        method:  'POST',
        headers: authHeader(),
      })
      expect(res.status).toBe(200)
      const data = await json(res)
      expect(data.success).toBe(true)
      const d = data.data as Record<string, unknown>
      expect(d.liked).toBe(true)
      expect(typeof d.count).toBe('number')
    })

    it('unlikes a post on second call (toggle)', async () => {
      if (!testPostId) return
      const res = await fetch(`${BASE}/posts/${testPostId}/like`, {
        method:  'POST',
        headers: authHeader(),
      })
      expect(res.status).toBe(200)
      const data = await json(res)
      const d = data.data as Record<string, unknown>
      expect(d.liked).toBe(false)
    })

    it('returns 404 for non-existent post', async () => {
      const res = await fetch(`${BASE}/posts/00000000-0000-0000-0000-000000000000/like`, {
        method:  'POST',
        headers: authHeader(),
      })
      expect(res.status).toBe(404)
    })
  })
})

// ─── RATE LIMIT HEADERS ────────────────────────────────────────────────────────
describe('Rate-limit headers are present', () => {
  it('GET /feed/global includes X-RateLimit headers', async () => {
    const res = await fetch(`${BASE}/feed/global`)
    expect(res.status).toBe(200)
    // @fastify/rate-limit sets these headers
    expect(res.headers.get('x-ratelimit-limit') ?? res.headers.get('ratelimit-limit')).toBeTruthy()
  })

  it('POST /auth/login includes X-RateLimit headers', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'check@headers.io', password: 'checkit123' }),
    })
    // 401 is fine — we're checking headers, not body
    expect([200, 401]).toContain(res.status)
    expect(res.headers.get('x-ratelimit-limit') ?? res.headers.get('ratelimit-limit')).toBeTruthy()
  })
})
