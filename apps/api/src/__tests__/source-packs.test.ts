/**
 * source-packs.test.ts
 *
 * Tests for Verified Source Packs — Ed25519-signed signal bundles.
 *
 * Coverage:
 *  1. buildSignedPack produces correct structure
 *  2. signPack + verifyPack round-trip succeeds
 *  3. verifyPack returns false for tampered payload
 *  4. GET /source-packs/latest returns 200 with valid JSON
 *  5. GET /source-packs/public-key returns public key
 *  6. GET /source-packs/category/conflict returns 200
 *  7. Cache hit returns X-Cache-Hit: true header
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'

// ─── Mock Redis ───────────────────────────────────────────────────────────────

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
}

vi.mock('../db/redis', () => ({ redis: redisMock }))

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockSignalRows = [
  {
    id:                'sig-001',
    title:             'Conflict in test region',
    summary:           'Test summary',
    severity:          'high',
    category:          'conflict',
    reliability_score: 0.85,
    location_name:     'Test City',
    country_code:      'TC',
    created_at:        '2026-03-26T00:00:00.000Z',
    source_url:        'https://example.com/article',
  },
]

const dbMock = vi.fn()
const qb: Record<string, unknown> = {}
const chainable = () => qb
qb.select   = chainable
qb.where    = chainable
qb.orderBy  = chainable
qb.limit    = vi.fn().mockResolvedValue(mockSignalRows)
const dbObj = Object.assign(dbMock, qb)
vi.mock('../db/postgres', () => ({ db: dbObj }))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const fastify = (require('fastify').default ?? require('fastify'))
  const app = fastify({ logger: false })
  const { registerSourcePacksRoutes } = require('../routes/source-packs')
  app.register(registerSourcePacksRoutes, { prefix: '/' })
  return app
}

// ─── Unit tests: lib/source-packs ─────────────────────────────────────────────

describe('source-packs lib', () => {
  beforeEach(() => vi.clearAllMocks())

  it('buildSignedPack produces correct structure', async () => {
    const { buildSignedPack } = await import('../lib/source-packs')

    const signals = mockSignalRows.map(r => ({ ...r, url: r.source_url ?? '' }))
    const pack    = buildSignedPack(signals, 'conflict')

    expect(pack.version).toBe('1')
    expect(pack.category).toBe('conflict')
    expect(pack.signal_count).toBe(1)
    expect(pack.signals).toHaveLength(1)
    expect(pack.signals[0]!.id).toBe('sig-001')
    expect(pack.signals[0]!.url).toBe('https://example.com/article')
    expect(pack.signature).toBeTruthy()
    expect(pack.public_key_pem).toBeTruthy()
    expect(pack.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('buildSignedPack defaults category to "all" when omitted', async () => {
    const { buildSignedPack } = await import('../lib/source-packs')
    const pack = buildSignedPack([])
    expect(pack.category).toBe('all')
    expect(pack.signal_count).toBe(0)
  })

  it('signPack + verifyPack round-trip succeeds', async () => {
    const { signPack, verifyPack, getOrCreateKeypair } = await import('../lib/source-packs')

    const payload   = JSON.stringify({ test: 'data', value: 42 })
    const signature = signPack(payload)
    const { publicKeyPem } = getOrCreateKeypair()

    expect(typeof signature).toBe('string')
    expect(signature.length).toBeGreaterThan(0)
    // base64url: no +, /, or = characters
    expect(signature).not.toMatch(/[+/=]/)

    const valid = verifyPack(payload, signature, publicKeyPem)
    expect(valid).toBe(true)
  })

  it('verifyPack returns false for tampered payload', async () => {
    const { signPack, verifyPack, getOrCreateKeypair } = await import('../lib/source-packs')

    const payload        = JSON.stringify({ test: 'original' })
    const tamperedPayload = JSON.stringify({ test: 'TAMPERED' })
    const signature       = signPack(payload)
    const { publicKeyPem } = getOrCreateKeypair()

    const valid = verifyPack(tamperedPayload, signature, publicKeyPem)
    expect(valid).toBe(false)
  })

  it('verifyPack returns false for invalid signature string', async () => {
    const { verifyPack, getOrCreateKeypair } = await import('../lib/source-packs')
    const { publicKeyPem } = getOrCreateKeypair()
    const valid = verifyPack('payload', 'not-a-valid-signature', publicKeyPem)
    expect(valid).toBe(false)
  })

  it('verifyPack returns false for wrong public key', async () => {
    const { signPack, verifyPack } = await import('../lib/source-packs')

    const payload   = JSON.stringify({ data: 'hello' })
    const signature = signPack(payload)

    // Generate a different keypair
    const { publicKey } = crypto.generateKeyPairSync('ed25519')
    const wrongPem = publicKey.export({ type: 'spki', format: 'pem' }) as string

    const valid = verifyPack(payload, signature, wrongPem)
    expect(valid).toBe(false)
  })
})

// ─── HTTP route tests ──────────────────────────────────────────────────────────

describe('GET /latest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with signed pack JSON on cache miss', async () => {
    redisMock.get.mockResolvedValueOnce(null)
    redisMock.set.mockResolvedValueOnce('OK')

    const app = makeApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/latest' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.data.version).toBe('1')
    expect(body.data.signature).toBeTruthy()
    expect(body.data.public_key_pem).toBeTruthy()
    expect(res.headers['x-cache-hit']).toBe('false')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('returns 200 from cache and sets X-Cache-Hit: true', async () => {
    const cached = JSON.stringify({
      success: true,
      data: {
        id: 'cached-pack', version: '1', category: 'all',
        generated_at: new Date().toISOString(), signal_count: 0,
        signals: [], signature: 'abc', public_key_pem: 'pem',
      },
    })
    redisMock.get.mockResolvedValueOnce(cached)

    const app = makeApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/latest' })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache-hit']).toBe('true')
    // DB should not have been called
    expect(dbMock).not.toHaveBeenCalled()
  })
})

describe('GET /category/:slug', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 for a valid category', async () => {
    redisMock.get.mockResolvedValueOnce(null)
    redisMock.set.mockResolvedValueOnce('OK')

    const app = makeApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/category/conflict' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.data.category).toBe('conflict')
  })

  it('returns 400 for an unknown category', async () => {
    const app = makeApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/category/unknowncategory999' })
    await app.close()

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
  })

  it('returns cache hit header when result is cached', async () => {
    const cached = JSON.stringify({
      success: true,
      data: {
        id: 'cached-pack', version: '1', category: 'conflict',
        generated_at: new Date().toISOString(), signal_count: 0,
        signals: [], signature: 'abc', public_key_pem: 'pem',
      },
    })
    redisMock.get.mockResolvedValueOnce(cached)

    const app = makeApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/category/conflict' })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache-hit']).toBe('true')
  })
})

describe('GET /public-key', () => {
  it('returns public key and algorithm', async () => {
    const app = makeApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/public-key' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.algorithm).toBe('Ed25519')
    expect(body.public_key_pem).toBeTruthy()
    expect(typeof body.public_key_pem).toBe('string')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })
})
