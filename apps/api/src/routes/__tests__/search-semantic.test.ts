/**
 * search-semantic.test.ts
 *
 * Search by meaning (/api/v1/search/semantic) and similar reports
 * (/api/v1/signals/:id/similar), on the in-house fingerprints
 * (lib/fingerprint-search.ts, mocked here: the database part is tested
 * against the real model in lib/__tests__/fingerprint.test.ts).
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

vi.mock('../../lib/fingerprint-search', () => ({
  searchByMeaning: vi.fn().mockResolvedValue(null),
  similarReports:  vi.fn().mockResolvedValue([]),
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
vi.mock('../../lib/source-bias',        () => ({ getSourceBias: vi.fn(), extractDomain: vi.fn() }))
vi.mock('../../middleware/auth', () => ({
  optionalAuth:  vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
  authenticate:  vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
}))

import { searchByMeaning, similarReports } from '../../lib/fingerprint-search'
import { db } from '../../db/postgres'

const mockSearch  = searchByMeaning as ReturnType<typeof vi.fn>
const mockSimilar = similarReports  as ReturnType<typeof vi.fn>
const mockDb      = db              as ReturnType<typeof vi.fn>

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

function rowsChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {}
  chain.select  = vi.fn().mockReturnValue(chain)
  chain.whereIn = vi.fn().mockReturnValue(chain)
  chain.catch   = vi.fn().mockResolvedValue(rows)
  return chain
}

function signalRow(id: string, title: string) {
  return {
    id, title, summary: 'Summary', category: 'conflict', severity: 'high', status: 'verified',
    reliability_score: 0.8, location_name: 'Ukraine', country_code: 'UA', tags: [],
    created_at: new Date('2026-10-16T08:00:00Z'), alert_tier: 'PRIORITY',
  }
}

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

// ─── Search by meaning ────────────────────────────────────────────────────────

describe('GET /semantic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearch.mockResolvedValue(null)
  })

  it('answers semantic: false with a message while the model is not available', async () => {
    const app = await buildSearchApp()
    const res = await app.inject({ method: 'GET', url: '/semantic?q=earthquake+tsunami' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.semantic).toBe(false)
    expect(body.results).toEqual([])
    expect(body.message).toBeTruthy()
  })

  it('returns 400 when q is missing', async () => {
    const app = await buildSearchApp()
    const res = await app.inject({ method: 'GET', url: '/semantic' })
    expect(res.statusCode).toBe(400)
    expect(res.json().success).toBe(false)
  })

  it('returns 400 when q is too short (1 char)', async () => {
    const app = await buildSearchApp()
    const res = await app.inject({ method: 'GET', url: '/semantic?q=x' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/2 characters/i)
  })

  it('answers semantic: true and no results when nothing is close', async () => {
    mockSearch.mockResolvedValue([])
    const app = await buildSearchApp()
    const res = await app.inject({ method: 'GET', url: '/semantic?q=hurricane+category5' })
    const body = res.json()
    expect(body.semantic).toBe(true)
    expect(body.results).toEqual([])
  })

  it('returns reports in order of closeness, with their scores and fields', async () => {
    mockSearch.mockResolvedValue([{ id: ID_A, score: 0.71 }, { id: ID_B, score: 0.52 }])
    // the database returns them in another order
    mockDb.mockReturnValue(rowsChain([signalRow(ID_B, 'Signal B'), signalRow(ID_A, 'Signal A')]))
    const app = await buildSearchApp()
    const res = await app.inject({ method: 'GET', url: '/semantic?q=armed+conflict' })
    const body = res.json()
    expect(body.semantic).toBe(true)
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([ID_A, ID_B])
    expect(body.results[0].score).toBe(0.71)
    for (const k of ['id', 'title', 'category', 'severity', 'reliabilityScore', 'createdAt', 'score']) {
      expect(body.results[0]).toHaveProperty(k)
    }
  })

  it('passes the limit and the category on', async () => {
    mockSearch.mockResolvedValue([])
    const app = await buildSearchApp()
    await app.inject({ method: 'GET', url: '/semantic?q=climate+crisis&limit=5&category=climate' })
    expect(mockSearch).toHaveBeenCalledWith('climate crisis', { limit: 5, category: 'climate' })
  })

  it('refuses a limit over 50', async () => {
    const app = await buildSearchApp()
    const res = await app.inject({ method: 'GET', url: '/semantic?q=volcano+eruption&limit=999' })
    expect(res.statusCode).toBe(400)
  })
})

// ─── Similar reports ──────────────────────────────────────────────────────────

describe('GET /:id/similar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSimilar.mockResolvedValue([])
  })

  it('returns { similar: [], count: 0 } when the report has no close ones', async () => {
    const app = await buildSignalsApp()
    const res = await app.inject({ method: 'GET', url: `/${ID_A}/similar` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, similar: [], count: 0 })
  })

  it('returns 404 for an id that is not a report id', async () => {
    const app = await buildSignalsApp()
    const res = await app.inject({ method: 'GET', url: '/not-an-id/similar' })
    expect(res.statusCode).toBe(404)
    expect(mockSimilar).not.toHaveBeenCalled()
  })

  it('returns the close reports with their scores, closest first', async () => {
    mockSimilar.mockResolvedValue([{ id: ID_B, score: 0.83 }, { id: ID_A, score: 0.61 }])
    mockDb.mockReturnValue(rowsChain([signalRow(ID_A, 'A'), signalRow(ID_B, 'B')]))
    const app = await buildSignalsApp()
    const res = await app.inject({ method: 'GET', url: '/33333333-3333-4333-8333-333333333333/similar' })
    const body = res.json()
    expect(body.count).toBe(2)
    expect(body.similar.map((s: { id: string; score: number }) => [s.id, s.score])).toEqual([[ID_B, 0.83], [ID_A, 0.61]])
  })

  it('asks for at most 20 and at least 1', async () => {
    const app = await buildSignalsApp()
    await app.inject({ method: 'GET', url: `/${ID_A}/similar?limit=999` })
    expect(mockSimilar).toHaveBeenLastCalledWith(ID_A, 20)
    await app.inject({ method: 'GET', url: `/${ID_A}/similar?limit=0` })
    expect(mockSimilar).toHaveBeenLastCalledWith(ID_A, 5)
    await app.inject({ method: 'GET', url: `/${ID_A}/similar?limit=3` })
    expect(mockSimilar).toHaveBeenLastCalledWith(ID_A, 3)
  })
})
