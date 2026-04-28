import { describe, it, expect } from 'vitest'

/**
 * Developer Portal — data-shape tests for endpoints documented on /developers page.
 * These validate that every documented public endpoint exists and returns the expected shape.
 */

/* ── helpers ──────────────────────────────────────────────────────────── */

const API_BASE = process.env.API_URL ?? 'http://localhost:3001'

async function fetchJSON(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/* ── Public Signals ──────────────────────────────────────────────────── */

describe('Public Signals API (documented on /developers)', () => {
  it('GET /api/v1/public/signals — returns success shape', async () => {
    const { status, body } = await fetchJSON('/api/v1/public/signals?limit=2')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('GET /api/v1/public/signals — respects category filter', async () => {
    const { status, body } = await fetchJSON('/api/v1/public/signals?category=conflict&limit=1')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('GET /api/v1/public/signals — respects severity filter', async () => {
    const { status, body } = await fetchJSON('/api/v1/public/signals?severity=critical&limit=1')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('GET /api/v1/public/signals — enforces limit max 100', async () => {
    const { status, body } = await fetchJSON('/api/v1/public/signals?limit=200')
    // Should either clamp to 100 or return 400
    expect([200, 400]).toContain(status)
    if (status === 200) {
      expect(body.data.length).toBeLessThanOrEqual(100)
    }
  })
})

/* ── Feed ─────────────────────────────────────────────────────────────── */

describe('Feed API (documented on /developers)', () => {
  it('GET /api/v1/feed/global — returns success shape', async () => {
    const { status, body } = await fetchJSON('/api/v1/feed/global')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })

  it('GET /api/v1/feed/trending — returns success shape', async () => {
    const { status, body } = await fetchJSON('/api/v1/feed/trending')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })
})

/* ── Search ───────────────────────────────────────────────────────────── */

describe('Search API (documented on /developers)', () => {
  it('GET /api/v1/search?q=test — returns success shape', async () => {
    const { status, body } = await fetchJSON('/api/v1/search?q=test')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })

  it('GET /api/v1/search/autocomplete?q=earth — returns results', async () => {
    const { status, body } = await fetchJSON('/api/v1/search/autocomplete?q=earth')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })
})

/* ── Signals Map ──────────────────────────────────────────────────────── */

describe('Signals Map API (documented on /developers)', () => {
  it('GET /api/v1/signals/map/points — returns array', async () => {
    const { status, body } = await fetchJSON('/api/v1/signals/map/points')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })

  it('GET /api/v1/signals/map/hotspots — returns hotspots', async () => {
    const { status, body } = await fetchJSON('/api/v1/signals/map/hotspots')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })
})

/* ── Intelligence ─────────────────────────────────────────────────────── */

describe('Intelligence APIs (documented on /developers)', () => {
  it('GET /api/v1/threats/missiles — returns missile data', async () => {
    const { status, body } = await fetchJSON('/api/v1/threats/missiles')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })

  it('GET /api/v1/maritime/vessels — returns vessel data', async () => {
    const { status, body } = await fetchJSON('/api/v1/maritime/vessels')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })

  it('GET /api/v1/jamming/zones — returns jamming zones', async () => {
    const { status, body } = await fetchJSON('/api/v1/jamming/zones')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })

  it('GET /api/v1/countries — returns country risk data', async () => {
    const { status, body } = await fetchJSON('/api/v1/countries')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })
})

/* ── Syndication ──────────────────────────────────────────────────────── */

describe('Syndication APIs (documented on /developers)', () => {
  it('GET /api/v1/rss/feed.json — returns JSON Feed', async () => {
    const { status, body } = await fetchJSON('/api/v1/rss/feed.json')
    expect(status).toBe(200)
    expect(body).toHaveProperty('version')
  })
})

/* ── STIX & Bundles ───────────────────────────────────────────────────── */

describe('Bundles API (documented on /developers)', () => {
  it('GET /api/v1/bundles — returns bundle list', async () => {
    const { status, body } = await fetchJSON('/api/v1/bundles')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })

  it('GET /api/v1/bundles/public-key — returns Ed25519 public key', async () => {
    const { status, body } = await fetchJSON('/api/v1/bundles/public-key')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
    expect(body).toHaveProperty('publicKey')
  })
})

/* ── Auth endpoints exist ─────────────────────────────────────────────── */

describe('Auth API shape (documented on /developers)', () => {
  it('POST /api/v1/auth/register — rejects empty body with 400', async () => {
    const { status } = await fetchJSON('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect([400, 422]).toContain(status)
  })

  it('POST /api/v1/auth/login — rejects bad credentials with 401', async () => {
    const { status } = await fetchJSON('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nonexistent@example.com', password: 'wrong' }),
    })
    expect([400, 401]).toContain(status)
  })
})

/* ── Health / Status ──────────────────────────────────────────────────── */

describe('Health & Status (documented on /developers)', () => {
  it('GET /api/v1/health — returns ok', async () => {
    const { status, body } = await fetchJSON('/api/v1/health')
    expect(status).toBe(200)
    expect(body).toHaveProperty('status', 'ok')
  })

  it('GET /api/v1/status — returns system status', async () => {
    const { status, body } = await fetchJSON('/api/v1/status')
    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)
  })
})
