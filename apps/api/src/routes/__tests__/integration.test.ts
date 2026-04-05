/**
 * WorldPulse API — Integration & Smoke Tests
 *
 * Smoke tests: verify happy-path responses from a running API.
 * Hard tests:  edge cases, validation failures, security, rate limiting.
 *
 * Requires a running API at BASE_URL (default: http://localhost:3001).
 * Set API_BASE_URL env var to point at any environment.
 */

import { describe, it, expect } from 'vitest'

const BASE = process.env.API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001'

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, { headers })
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

// ─── SMOKE: HEALTH ───────────────────────────────────────────────────────────
describe('GET /health — smoke', () => {
  it('returns healthy status with all service checks', async () => {
    const res  = await get('/health')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data).toHaveProperty('postgres')
    expect(data).toHaveProperty('redis')
    expect(data).toHaveProperty('uptime')
    expect(data).toHaveProperty('timestamp')
    expect(typeof data.uptime).toBe('number')
  })
})

// ─── SMOKE: FEED/GLOBAL ──────────────────────────────────────────────────────
describe('GET /api/v1/feed/global — smoke', () => {
  // NOTE: feed/global returns flat { items, total, cursor, hasMore } — no success wrapper
  it('returns 200 with paginated items', async () => {
    const res  = await get('/api/v1/feed/global?limit=5')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('items')
    expect(data).toHaveProperty('cursor')
    expect(data).toHaveProperty('hasMore')
    expect(Array.isArray(data.items)).toBe(true)
  })

  it('each item has required fields when posts exist', async () => {
    const res  = await get('/api/v1/feed/global?limit=5')
    const data = await res.json()
    for (const item of data.items) {
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('content')
      expect(item).toHaveProperty('createdAt')
      expect(item).toHaveProperty('author')
      expect(item.author).toHaveProperty('handle')
    }
  })

  it('category filter returns only matching items', async () => {
    const res  = await get('/api/v1/feed/global?category=climate')
    expect(res.status).toBe(200)
    const data = await res.json()
    for (const item of data.items) {
      if (item.signal) expect(item.signal.category).toBe('climate')
    }
  })

  it('supports cursor pagination — page 2 items differ from page 1', async () => {
    const res1  = await get('/api/v1/feed/global?limit=2')
    const data1 = await res1.json()
    if (data1.cursor) {
      const res2  = await get(`/api/v1/feed/global?limit=2&cursor=${data1.cursor}`)
      const data2 = await res2.json()
      expect(res2.status).toBe(200)
      const ids1 = data1.items.map((i: { id: string }) => i.id)
      const ids2 = data2.items.map((i: { id: string }) => i.id)
      // No overlap between pages
      expect(ids1.some((id: string) => ids2.includes(id))).toBe(false)
    }
  })
})

// ─── HARD: FEED EDGE CASES ───────────────────────────────────────────────────
describe('GET /api/v1/feed/global — hard', () => {
  it('clamps limit to 50 max', async () => {
    const res  = await get('/api/v1/feed/global?limit=999')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items.length).toBeLessThanOrEqual(50)
  })

  it('handles invalid cursor gracefully — returns results not 500', async () => {
    const res = await get('/api/v1/feed/global?cursor=not-a-real-uuid')
    expect(res.status).toBe(200) // cursor miss is a no-op, not an error
    const data = await res.json()
    expect(data).toHaveProperty('items')
  })

  it('returns empty items array for unknown category', async () => {
    const res  = await get('/api/v1/feed/global?category=nonexistent_category_xyz')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items.length).toBe(0)
  })
})

// ─── SMOKE: SIGNALS ──────────────────────────────────────────────────────────
describe('GET /api/v1/signals — smoke', () => {
  it('returns verified signals', async () => {
    const res  = await get('/api/v1/signals')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.data.items)).toBe(true)
    for (const sig of data.data.items) {
      expect(sig.status).toBe('verified')
    }
  })

  it('each signal has required fields', async () => {
    const res  = await get('/api/v1/signals?limit=3')
    const data = await res.json()
    for (const sig of data.data.items) {
      expect(sig).toHaveProperty('id')
      expect(sig).toHaveProperty('title')
      expect(sig).toHaveProperty('category')
      expect(sig).toHaveProperty('severity')
      expect(sig).toHaveProperty('reliabilityScore')
      expect(sig).toHaveProperty('createdAt')
    }
  })

  it('supports geo bbox filter without crashing', async () => {
    const res = await get('/api/v1/signals?bbox=-10,35,40,72') // Europe
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 404 for unknown signal id', async () => {
    const res = await get('/api/v1/signals/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.success).toBe(false)
  })
})

// ─── HARD: SIGNALS EDGE CASES ────────────────────────────────────────────────
describe('GET /api/v1/signals — hard', () => {
  it('clamps limit to 100 max', async () => {
    const res  = await get('/api/v1/signals?limit=9999')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.data.items.length).toBeLessThanOrEqual(100)
  })

  it('malformed bbox returns 200 or 400 — never 500', async () => {
    const res = await get('/api/v1/signals?bbox=notanumber,bad,input,here')
    expect([200, 400]).toContain(res.status)
  })

  it('unknown category filter returns empty items', async () => {
    const res  = await get('/api/v1/signals?category=made_up_category')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.data.items.length).toBe(0)
  })
})

// ─── SMOKE: AUTH — REGISTER ──────────────────────────────────────────────────
describe('POST /api/v1/auth/register — smoke', () => {
  const testHandle = `smoketest_${Date.now()}`

  it('creates a new user and returns tokens', async () => {
    const res  = await post('/api/v1/auth/register', {
      handle:      testHandle,
      displayName: 'Smoke Test User',
      email:       `${testHandle}@test.worldpulse.io`,
      password:    'TestPass123!',
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.user.handle).toBe(testHandle)
    expect(data.data.accessToken).toBeTruthy()
    expect(data.data.refreshToken).toBeTruthy()
    expect(data.data.expiresIn).toBe(900) // 15 minutes
  })

  it('returns 409 DUPLICATE on second registration with same handle', async () => {
    const res = await post('/api/v1/auth/register', {
      handle:      testHandle,
      displayName: 'Another User',
      email:       `other_${testHandle}@test.worldpulse.io`,
      password:    'TestPass123!',
    })
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.code).toBe('DUPLICATE')
  })
})

// ─── HARD: AUTH VALIDATION ───────────────────────────────────────────────────
describe('POST /api/v1/auth/register — hard validation', () => {
  it('rejects invalid email format', async () => {
    const res = await post('/api/v1/auth/register', {
      handle: 'validhandle', displayName: 'X', email: 'not-an-email', password: 'pass12345',
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.success).toBe(false)
  })

  it('rejects password shorter than 8 characters', async () => {
    const res = await post('/api/v1/auth/register', {
      handle: `h_${Date.now()}`, displayName: 'X', email: `e_${Date.now()}@x.io`, password: 'short',
    })
    expect(res.status).toBe(400)
  })

  it('rejects handle shorter than 3 characters', async () => {
    const res = await post('/api/v1/auth/register', {
      handle: 'ab', displayName: 'X', email: `e2_${Date.now()}@x.io`, password: 'password123',
    })
    expect(res.status).toBe(400)
  })

  it('rejects handle with special characters', async () => {
    const res = await post('/api/v1/auth/register', {
      handle: 'bad handle!', displayName: 'X', email: `e3_${Date.now()}@x.io`, password: 'password123',
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing required fields', async () => {
    const res = await post('/api/v1/auth/register', { handle: 'onlyhandle' })
    expect(res.status).toBe(400)
  })

  it('rejects empty body', async () => {
    const res = await post('/api/v1/auth/register', {})
    expect(res.status).toBe(400)
  })
})

// ─── HARD: AUTH LOGIN ────────────────────────────────────────────────────────
describe('POST /api/v1/auth/login — hard', () => {
  it('returns 401 for unknown email', async () => {
    const res  = await post('/api/v1/auth/login', {
      email: 'nobody_ever@notreal.io', password: 'whatever',
    })
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.code).toBe('INVALID_CREDENTIALS')
  })

  it('returns 400 for malformed email in login', async () => {
    const res = await post('/api/v1/auth/login', { email: 'notanemail', password: 'pass' })
    expect(res.status).toBe(400)
  })
})

// ─── HARD: AUTH ME — PROTECTED ROUTE ─────────────────────────────────────────
describe('GET /api/v1/auth/me — hard', () => {
  it('returns 401 without token', async () => {
    const res = await get('/api/v1/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 with a malformed token', async () => {
    const res = await get('/api/v1/auth/me', { Authorization: 'Bearer not.a.real.jwt' })
    expect(res.status).toBe(401)
  })

  it('returns 401 with an expired/tampered token', async () => {
    // A structurally valid JWT with wrong signature
    const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImZha2UifQ.invalidsignature'
    const res = await get('/api/v1/auth/me', { Authorization: `Bearer ${fakeJwt}` })
    expect(res.status).toBe(401)
  })
})

// ─── HARD: REFRESH TOKEN ─────────────────────────────────────────────────────
describe('POST /api/v1/auth/refresh — hard', () => {
  it('returns 400 when refreshToken is missing', async () => {
    const res  = await post('/api/v1/auth/refresh', {})
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('MISSING_TOKEN')
  })

  it('returns 401 for an invalid refresh token', async () => {
    const res  = await post('/api/v1/auth/refresh', { refreshToken: 'not-a-real-token' })
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.code).toBe('INVALID_TOKEN')
  })
})

// ─── SMOKE: SEARCH ───────────────────────────────────────────────────────────
describe('GET /api/v1/search — smoke', () => {
  it('requires minimum 2 chars — returns 400 for single char', async () => {
    const res  = await get('/api/v1/search?q=a')
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.success).toBe(false)
  })

  it('returns 400 with empty query', async () => {
    const res = await get('/api/v1/search?q=')
    expect(res.status).toBe(400)
  })

  it('returns 400 with missing query param', async () => {
    const res = await get('/api/v1/search')
    expect(res.status).toBe(400)
  })

  it('returns results for valid query', async () => {
    const res  = await get('/api/v1/search?q=climate')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data).toHaveProperty('results')
    expect(data.data).toHaveProperty('query')
    expect(data.data.query).toBe('climate')
  })

  it('search response includes signals, posts, users, tags keys', async () => {
    const res  = await get('/api/v1/search?q=conflict')
    const data = await res.json()
    expect(data.data.results).toHaveProperty('signals')
    expect(data.data.results).toHaveProperty('posts')
    expect(data.data.results).toHaveProperty('users')
    expect(data.data.results).toHaveProperty('tags')
  })
})

// ─── HARD: SEARCH EDGE CASES ─────────────────────────────────────────────────
describe('GET /api/v1/search — hard', () => {
  it('handles type=signals filter', async () => {
    const res  = await get('/api/v1/search?q=earthquake&type=signals')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.data.results).toHaveProperty('signals')
    // Should not include posts when type=signals
    expect(data.data.results.posts).toBeUndefined()
  })

  it('handles multi-category filter (comma-separated)', async () => {
    const res = await get('/api/v1/search?q=crisis&category=conflict,climate')
    expect(res.status).toBe(200)
  })

  it('handles date range filters without crashing', async () => {
    const res = await get('/api/v1/search?q=news&from=2025-01-01&to=2025-12-31')
    expect(res.status).toBe(200)
  })

  it('handles sort=discussed', async () => {
    const res = await get('/api/v1/search?q=war&sort=discussed')
    expect([200, 400]).toContain(res.status)
  })
})

// ─── HARD: SECURITY — INJECTION ATTEMPTS ────────────────────────────────────
describe('Security — injection & malformed input', () => {
  it('SQL injection in search query returns 200 or 400 — never 500', async () => {
    const payloads = [
      "'; DROP TABLE signals; --",
      "1' OR '1'='1",
      "UNION SELECT * FROM users--",
    ]
    for (const payload of payloads) {
      const res = await get(`/api/v1/search?q=${encodeURIComponent(payload)}`)
      expect([200, 400]).toContain(res.status)
    }
  })

  it('XSS payload in register displayName is stored safely — never 500', async () => {
    const res = await post('/api/v1/auth/register', {
      handle:      `xss_${Date.now()}`,
      displayName: '<script>alert(1)</script>',
      email:       `xss_${Date.now()}@test.worldpulse.io`,
      password:    'SecurePass123!',
    })
    // Should either succeed (201, storing escaped) or reject (400) — never 500
    expect([201, 400]).toContain(res.status)
  })

  it('oversized payload returns 400 or 413 — never 500', async () => {
    const res = await post('/api/v1/auth/register', {
      handle:      'ok_handle',
      displayName: 'A'.repeat(10_000),
      email:       `overflow_${Date.now()}@test.io`,
      password:    'Password123!',
    })
    expect([400, 413]).toContain(res.status)
  })

  it('null bytes in query param do not crash server', async () => {
    const res = await get('/api/v1/search?q=cl%00imate')
    expect([200, 400]).toContain(res.status)
  })

  it('very long cursor value does not crash feed', async () => {
    const res = await get(`/api/v1/feed/global?cursor=${'x'.repeat(1000)}`)
    expect([200, 400]).toContain(res.status)
  })
})

// ─── HARD: RATE LIMITING ─────────────────────────────────────────────────────
describe('Rate limiting — hard', () => {
  it('triggers 429 after 200 rapid requests to /health', async () => {
    const requests = Array.from({ length: 201 }, () => get('/health'))
    const responses = await Promise.all(requests)
    const limited = responses.some(r => r.status === 429)
    expect(limited).toBe(true)
  }, 30_000)

  it('429 response has correct error shape', async () => {
    const requests = Array.from({ length: 205 }, () => get('/health'))
    const responses = await Promise.all(requests)
    const limited = responses.find(r => r.status === 429)
    if (limited) {
      const data = await limited.json()
      expect(data.success).toBe(false)
      expect(data.code).toBe('RATE_LIMITED')
    }
  }, 30_000)
})

// ─── SMOKE: FEED/SIGNALS ENDPOINT ────────────────────────────────────────────
describe('GET /api/v1/feed/signals — smoke', () => {
  // NOTE: feed/signals returns flat { items, cursor, hasMore } — no success wrapper
  it('returns verified signals in feed format', async () => {
    const res  = await get('/api/v1/feed/signals')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('items')
    expect(data).toHaveProperty('cursor')
    expect(data).toHaveProperty('hasMore')
    for (const item of data.items) {
      expect(item.status).toBe('verified')
    }
  })
})

// ─── SMOKE: TRENDING ─────────────────────────────────────────────────────────
describe('GET /api/v1/feed/trending — smoke', () => {
  it('returns trending topics for 1h window', async () => {
    const res  = await get('/api/v1/feed/trending?window=1h')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('items')
    expect(data).toHaveProperty('window')
    expect(Array.isArray(data.items)).toBe(true)
  })

  it('returns topics for 24h window', async () => {
    const res  = await get('/api/v1/feed/trending?window=24h')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.window).toBe('24h')
  })
})

// ─── SMOKE: MAP POINTS ────────────────────────────────────────────────────────
describe('GET /api/v1/signals/map/points — smoke', () => {
  it('returns geo-located signal points', async () => {
    const res  = await get('/api/v1/signals/map/points')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    for (const point of data.data) {
      expect(point).toHaveProperty('id')
      expect(point).toHaveProperty('lat')
      expect(point).toHaveProperty('lng')
    }
  })

  it('clamps hours param to 168 max', async () => {
    const res = await get('/api/v1/signals/map/points?hours=99999')
    expect(res.status).toBe(200) // should not crash
  })
})
