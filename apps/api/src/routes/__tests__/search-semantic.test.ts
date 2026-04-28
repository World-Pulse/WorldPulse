/**
 * search-semantic.test.ts
 *
 * Tests for semantic search (/api/v1/search/semantic) and
 * similar signals (/api/v1/signals/:id/similar) endpoints.
 *
 * Key design: all Pinecone/OpenAI calls are mocked so tests pass in CI
 * regardless of whether PINECONE_API_KEY / OPENAI_API_KEY are set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerSearchRoutes } from '../search'
import { registerSignalRoutes } from '../signals'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../db/postgres', () => ({
  db: vi.fn(),
}))

vi.mock('../../db/redis', () => ({
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    unlink: vi.fn().mockResolvedValue(1),
    scan:   vi.fn().mockResolvedValue(['0', []]),
  },
}))

vi.mock('../../lib/pinecone', () => ({
  isPineconeEnabled:   vi.fn().mockReturnValue(false),
  generateEmbedding:   vi.fn().mockResolvedValue(null),
  querySimilar:        vi.fn().mockResolvedValue([]),
  upsertSignalVector:  vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/search', () => ({
  meili:            { index: vi.fn().mockReturnValue({ search: vi.fn().mockResolvedValue({ hits: [] }) }) },
  setupSearchIndexes: vi.fn(),
  indexSignal:      vi.fn(),
  indexPost:        vi.fn(),
  removeSignal:     vi.fn(),
}))

vi.mock('../../lib/search-analytics',   () => ({ logSearchQuery:     vi.fn() }))
vi.mock('../../lib/opensanctions',      () => ({ searchEntities:     vi.fn() }))
vi.mock('../../utils/sanitize',         () => ({ sanitizeString:     vi.fn((s: string) => s) }))
vi.mock('../../lib/search-latency',     () => ({ recordSearchLatency: vi.fn(), maybeLogPercentiles: vi.fn() }))
vi.mock('../../lib/search-events',      () => ({ publishSignalUpsert: vi.fn(), publishSignalDelete: vi.fn() }))
vi.mock('../../lib/signal-summary',     () => ({ generateSignalSummary: vi.fn(), refreshSignalSummary: vi.fn() }))
vi.mock('../../lib/slop-detector',      () => ({ slopDetector: vi.fn() }))
vi.mock('../../lib/risk-score',         () => ({ computeRiskScore: vi.fn().mockReturnValue({ score: 0, level: 'low', label: 'Low' }) }))
vi.mock('../../lib/cib-detection',      () => ({ detectCIB: vi.fn() }))
vi.mock('../../lib/errors',             () => ({ sendError: vi.fn() }))
vi.mock('../../lib/source-bias',        () => ({ getSourceBias: vi.fn(), extractDomain: vi.fn() }))
vi.mock('../../middleware/auth', () => ({
  optionalAuth:  vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
  authenticate:  vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
}))

import { isPineconeEnabled, generateEmbedding, querySimilar } from '../../lib/pinecone'
import { db } from '../../db/postgres'

const mockPineconeEnabled   = isPineconeEnabled   as ReturnType<typeof vi.fn>
const mockGenerateEmbedding = generateEmbedding   as ReturnType<typeof vi.fn>
const mockQuerySimilar      = querySimilar         as ReturnType<typeof vi.fn>
const mockDb                = db                   as ReturnType<typeof vi.fn>

// ─── App builders ─────────────────────────────────────────────────────────────

async function buildSearchApp() {
  const app = Fastify()
  await app.register(registerSearchRoutes)
  await app.ready()
  return app
}

async function buildSignalsApp() {
  const app = Fastify()
  await app.register(registerSignalRoutes)
  await app.ready()
  return app
}

// ─── Semantic search tests ────────────────────────────────────────────────────

describe('GET /semantic', () => {
  let app: Awaited<ReturnType<typeof buildSearchApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPineconeEnabled.mockReturnValue(false)
    app = await buildSearchApp()
  })

  it('returns 200 with semantic: false when Pinecone not configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic?q=earthquake+tsunami' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.semantic).toBe(false)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.results)).toBe(true)
  })

  it('returns message when Pinecone not configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic?q=flood+warning' })
    const body = res.json()
    expect(body.message).toBeTruthy()
  })

  it('returns 400 when q is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic' })
    expect(res.statusCode).toBe(400)
    expect(res.json().success).toBe(false)
  })

  it('returns 400 when q is too short (1 char)', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic?q=x' })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/2 characters/i)
  })

  it('returns correct shape: { results, semantic, success }', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic?q=cyber+attack' })
    const body = res.json()
    expect(body).toHaveProperty('results')
    expect(body).toHaveProperty('semantic')
    expect(body).toHaveProperty('success')
  })

  it('returns semantic: false and empty results when embedding fails', async () => {
    mockPineconeEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue(null)

    const app2 = await buildSearchApp()
    const res = await app2.inject({ method: 'GET', url: '/semantic?q=wildfire+evacuation' })
    const body = res.json()
    expect(body.semantic).toBe(false)
    expect(body.results).toEqual([])
  })

  it('returns semantic: true with empty results when Pinecone returns no matches', async () => {
    mockPineconeEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1))
    mockQuerySimilar.mockResolvedValue([])

    const app2 = await buildSearchApp()
    const res = await app2.inject({ method: 'GET', url: '/semantic?q=hurricane+category5' })
    const body = res.json()
    expect(body.semantic).toBe(true)
    expect(body.results).toEqual([])
  })

  it('returns signals ordered by Pinecone score when matches exist', async () => {
    mockPineconeEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1))
    mockQuerySimilar.mockResolvedValue([
      { id: '1', score: 0.95 },
      { id: '2', score: 0.80 },
    ])

    const chain: Record<string, unknown> = {}
    const methods = ['select', 'whereIn', 'catch']
    for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
    ;(chain['catch'] as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '1', title: 'Signal A', category: 'conflict', severity: 'high', status: 'verified',
        reliability_score: 0.8, location_name: 'Ukraine', country_code: 'UA', tags: [],
        created_at: new Date(), alert_tier: 'PRIORITY' },
      { id: '2', title: 'Signal B', category: 'conflict', severity: 'medium', status: 'pending',
        reliability_score: 0.6, location_name: null, country_code: null, tags: [],
        created_at: new Date(), alert_tier: 'ROUTINE' },
    ])
    mockDb.mockReturnValue(chain)

    const app2 = await buildSearchApp()
    const res = await app2.inject({ method: 'GET', url: '/semantic?q=armed+conflict' })
    const body = res.json()
    expect(body.semantic).toBe(true)
    expect(body.results).toHaveLength(2)
    expect(body.results[0].id).toBe('1')
    expect(body.results[0].score).toBe(0.95)
  })

  it('respects limit parameter', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic?q=volcano+eruption&limit=5' })
    expect(res.statusCode).toBe(200)
  })

  it('clamps limit to max 50', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic?q=volcano+eruption&limit=999' })
    expect(res.statusCode).toBe(200)
  })

  it('accepts category filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/semantic?q=climate+crisis&category=climate' })
    expect(res.statusCode).toBe(200)
  })

  it('result items include expected fields when signals returned', async () => {
    mockPineconeEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1))
    mockQuerySimilar.mockResolvedValue([{ id: '42', score: 0.9 }])

    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'whereIn']) chain[m] = vi.fn().mockReturnValue(chain)
    ;(chain['whereIn'] as ReturnType<typeof vi.fn>).mockReturnValue({
      catch: vi.fn().mockResolvedValue([{
        id: '42', title: 'Test signal', summary: 'Summary', category: 'health',
        severity: 'medium', status: 'verified', reliability_score: 0.75,
        location_name: 'Geneva', country_code: 'CH', tags: ['who'],
        created_at: new Date('2026-01-01'), alert_tier: 'ROUTINE',
      }]),
    })
    mockDb.mockReturnValue(chain)

    const app2 = await buildSearchApp()
    const res = await app2.inject({ method: 'GET', url: '/semantic?q=disease+outbreak' })
    const signal = res.json().results[0]
    expect(signal).toHaveProperty('id')
    expect(signal).toHaveProperty('title')
    expect(signal).toHaveProperty('category')
    expect(signal).toHaveProperty('severity')
    expect(signal).toHaveProperty('reliabilityScore')
    expect(signal).toHaveProperty('score')
  })
})

// ─── Similar signals tests ─────────────────────────────────────────────────────

describe('GET /:id/similar', () => {
  let app: Awaited<ReturnType<typeof buildSignalsApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPineconeEnabled.mockReturnValue(false)
    app = await buildSignalsApp()
  })

  it('returns { similar: [], count: 0 } when Pinecone not configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/99/similar' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.similar).toEqual([])
    expect(body.count).toBe(0)
  })

  it('returns 404 when signal not found and Pinecone is enabled', async () => {
    mockPineconeEnabled.mockReturnValue(true)

    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'where', 'first', 'catch']) chain[m] = vi.fn().mockReturnValue(chain)
    ;(chain['catch'] as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    mockDb.mockReturnValue(chain)

    const app2 = await buildSignalsApp()
    const res = await app2.inject({ method: 'GET', url: '/999/similar' })
    expect(res.statusCode).toBe(404)
  })

  it('returns empty when embedding generation fails', async () => {
    mockPineconeEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue(null)

    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'where', 'first', 'catch']) chain[m] = vi.fn().mockReturnValue(chain)
    ;(chain['catch'] as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '1', title: 'Test', summary: 'Summary', category: 'conflict',
    })
    mockDb.mockReturnValue(chain)

    const app2 = await buildSignalsApp()
    const res = await app2.inject({ method: 'GET', url: '/1/similar' })
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.similar).toEqual([])
    expect(body.count).toBe(0)
  })

  it('excludes the source signal from results', async () => {
    mockPineconeEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1))
    // Pinecone returns the source signal itself in matches
    mockQuerySimilar.mockResolvedValue([
      { id: '5', score: 1.0 },  // source signal — must be excluded
      { id: '6', score: 0.8 },
    ])

    let callCount = 0
    mockDb.mockImplementation(() => {
      callCount++
      const chain: Record<string, unknown> = {}
      if (callCount === 1) {
        // First call: fetch the source signal
        for (const m of ['select', 'where', 'first', 'catch']) chain[m] = vi.fn().mockReturnValue(chain)
        ;(chain['catch'] as ReturnType<typeof vi.fn>).mockResolvedValue({
          id: '5', title: 'Source', summary: 'S', category: 'conflict',
        })
      } else {
        // Second call: fetch similar signals by IDs
        for (const m of ['select', 'whereIn']) chain[m] = vi.fn().mockReturnValue(chain)
        ;(chain['whereIn'] as ReturnType<typeof vi.fn>).mockReturnValue({
          catch: vi.fn().mockResolvedValue([{
            id: '6', title: 'Similar', summary: 'X', category: 'conflict',
            severity: 'high', status: 'verified', reliability_score: 0.8,
            location_name: null, country_code: null, tags: [],
            created_at: new Date(), alert_tier: 'PRIORITY',
          }]),
        })
      }
      return chain
    })

    const app2 = await buildSignalsApp()
    const res = await app2.inject({ method: 'GET', url: '/5/similar' })
    const body = res.json()
    expect(body.similar.map((s: { id: string }) => s.id)).not.toContain('5')
    expect(body.similar.map((s: { id: string }) => s.id)).toContain('6')
  })

  it('returns correct shape { similar, count }', async () => {
    const res = await app.inject({ method: 'GET', url: '/1/similar' })
    const body = res.json()
    expect(body).toHaveProperty('similar')
    expect(body).toHaveProperty('count')
  })

  it('respects limit parameter', async () => {
    const res = await app.inject({ method: 'GET', url: '/1/similar?limit=3' })
    expect(res.statusCode).toBe(200)
  })
})
