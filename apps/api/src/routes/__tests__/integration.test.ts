/**
 * WorldPulse API Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'

// ─── FEED ROUTE TESTS ────────────────────────────────────────────────────
describe('GET /api/v1/feed/global', () => {
  it('returns 200 with paginated items', async () => {
    const res = await fetch('http://localhost:3001/api/v1/feed/global?limit=5')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.items).toBeInstanceOf(Array)
    expect(data.data).toHaveProperty('cursor')
    expect(data.data).toHaveProperty('hasMore')
  })

  it('supports category filtering', async () => {
    const res = await fetch('http://localhost:3001/api/v1/feed/global?category=climate')
    expect(res.status).toBe(200)
    const data = await res.json()
    if (data.data.items.length > 0) {
      data.data.items.forEach((item: { signal?: { category: string } }) => {
        if (item.signal) expect(item.signal.category).toBe('climate')
      })
    }
  })

  it('returns cursor for pagination', async () => {
    const res1 = await fetch('http://localhost:3001/api/v1/feed/global?limit=2')
    const data1 = await res1.json()
    if (data1.data.cursor) {
      const res2 = await fetch(`http://localhost:3001/api/v1/feed/global?limit=2&cursor=${data1.data.cursor}`)
      const data2 = await res2.json()
      expect(data2.success).toBe(true)
      // Items should be different
      const ids1 = data1.data.items.map((i: { id: string }) => i.id)
      const ids2 = data2.data.items.map((i: { id: string }) => i.id)
      expect(ids1).not.toEqual(ids2)
    }
  })
})

// ─── HEALTH CHECK ────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns healthy status', async () => {
    const res = await fetch('http://localhost:3001/health')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data).toHaveProperty('postgres')
    expect(data).toHaveProperty('redis')
    expect(data).toHaveProperty('uptime')
  })
})

// ─── AUTH TESTS ──────────────────────────────────────────────────────────
describe('POST /api/v1/auth/register', () => {
  const testHandle = `test_${Date.now()}`

  it('creates a new user', async () => {
    const res = await fetch('http://localhost:3001/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle:      testHandle,
        displayName: 'Test User',
        email:       `${testHandle}@test.worldpulse.io`,
        password:    'TestPass123!',
      }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.user.handle).toBe(testHandle)
    expect(data.data.accessToken).toBeTruthy()
    expect(data.data.refreshToken).toBeTruthy()
  })

  it('rejects duplicate handle', async () => {
    const res = await fetch('http://localhost:3001/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle:      testHandle,
        displayName: 'Another User',
        email:       `other_${testHandle}@test.worldpulse.io`,
        password:    'TestPass123!',
      }),
    })
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.code).toBe('DUPLICATE')
  })

  it('rejects invalid email', async () => {
    const res = await fetch('http://localhost:3001/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'valid', displayName: 'X', email: 'not-an-email', password: 'pass12345' }),
    })
    expect(res.status).toBe(400)
  })
})

// ─── SIGNALS TESTS ───────────────────────────────────────────────────────
describe('GET /api/v1/signals', () => {
  it('returns verified signals', async () => {
    const res = await fetch('http://localhost:3001/api/v1/signals')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    data.data.items.forEach((signal: { status: string }) => {
      expect(signal.status).toBe('verified')
    })
  })

  it('supports geo bbox filter', async () => {
    // Bounding box for Europe
    const bbox = '-10,35,40,72'
    const res = await fetch(`http://localhost:3001/api/v1/signals?bbox=${bbox}`)
    expect(res.status).toBe(200)
  })
})

// ─── SEARCH TESTS ────────────────────────────────────────────────────────
describe('GET /api/v1/search', () => {
  it('requires minimum 2 chars', async () => {
    const res = await fetch('http://localhost:3001/api/v1/search?q=a')
    expect(res.status).toBe(400)
  })

  it('returns results for valid query', async () => {
    const res = await fetch('http://localhost:3001/api/v1/search?q=climate')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data).toHaveProperty('results')
  })
})

// ─── RATE LIMITING TESTS ─────────────────────────────────────────────────
describe('Rate limiting', () => {
  it('enforces rate limit after 200 requests', async () => {
    // Make 201 rapid requests
    const requests = Array.from({ length: 201 }, () =>
      fetch('http://localhost:3001/health')
    )
    const responses = await Promise.all(requests)
    const limited = responses.some(r => r.status === 429)
    expect(limited).toBe(true)
  }, 30_000)
})
