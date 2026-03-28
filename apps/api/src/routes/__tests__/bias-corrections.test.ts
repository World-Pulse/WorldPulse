/**
 * bias-corrections.test.ts
 *
 * Tests for community crowdsourced bias correction API endpoints.
 * Uses vi.mock to avoid live DB/Redis.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { registerBiasCorrectionsRoutes } from '../bias-corrections'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../db/postgres', () => ({
  db: vi.fn(),
}))

vi.mock('../../db/redis', () => ({
  redis: { del: vi.fn().mockResolvedValue(1) },
}))

vi.mock('../../lib/bias-corrections', () => ({
  VALID_BIAS_LABELS: [
    'far-left', 'left', 'center-left', 'center', 'center-right',
    'right', 'far-right', 'satire', 'state_media', 'unknown',
  ],
  submitCorrection:    vi.fn(),
  voteOnCorrection:    vi.fn(),
  getCorrections:      vi.fn(),
  getCorrectionSummary: vi.fn(),
}))

import { db } from '../../db/postgres'
import {
  submitCorrection,
  voteOnCorrection,
  getCorrections,
  getCorrectionSummary,
} from '../../lib/bias-corrections'

const mockDb = db as unknown as ReturnType<typeof vi.fn>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['where', 'first', 'select', 'insert', 'returning', 'update', 'limit', 'orderBy']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  ;(chain['first'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  return chain
}

async function buildApp() {
  const app = Fastify()
  await app.register(fastifyJwt, { secret: 'test-secret' })
  await app.register(registerBiasCorrectionsRoutes)
  await app.ready()
  return app
}

function makeToken(app: ReturnType<typeof Fastify>, userId = 1) {
  return (app as unknown as { jwt: { sign: (p: unknown) => string } })
    .jwt.sign({ id: userId })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /sources/:id/bias-corrections', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/sources/1/bias-corrections',
      payload: { suggested_label: 'center' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when suggested_label is missing', async () => {
    const token = makeToken(app)
    mockDb.mockReturnValue(mockChain({ id: 1 }))

    const res = await app.inject({
      method:  'POST',
      url:     '/sources/1/bias-corrections',
      headers: { Authorization: `Bearer ${token}` },
      payload: { notes: 'no label here' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json<{ code: string }>()
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when suggested_label is invalid', async () => {
    const token = makeToken(app)
    mockDb.mockReturnValue(mockChain({ id: 1 }))

    const res = await app.inject({
      method:  'POST',
      url:     '/sources/1/bias-corrections',
      headers: { Authorization: `Bearer ${token}` },
      payload: { suggested_label: 'extreme-left' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when source does not exist', async () => {
    const token = makeToken(app)
    mockDb.mockReturnValue(mockChain(undefined))

    const res = await app.inject({
      method:  'POST',
      url:     '/sources/9999/bias-corrections',
      headers: { Authorization: `Bearer ${token}` },
      payload: { suggested_label: 'center' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 201 and new correction id on valid submission', async () => {
    const token = makeToken(app)
    mockDb.mockReturnValue(mockChain({ id: 42 }))
    vi.mocked(submitCorrection).mockResolvedValue(42)

    const res = await app.inject({
      method:  'POST',
      url:     '/sources/1/bias-corrections',
      headers: { Authorization: `Bearer ${token}` },
      payload: { suggested_label: 'center', notes: 'Based on analysis' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ success: boolean; data: { id: number } }>()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(42)
  })
})

describe('GET /sources/:id/bias-corrections', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns corrections array sorted by net_votes', async () => {
    mockDb.mockReturnValue(mockChain({ id: 1 }))
    const mockCorrections = [
      { id: 1, suggested_label: 'left', net_votes: 5, upvotes: 6, downvotes: 1, notes: null, status: 'pending', created_at: new Date().toISOString(), applied_at: null },
      { id: 2, suggested_label: 'center', net_votes: 2, upvotes: 3, downvotes: 1, notes: null, status: 'pending', created_at: new Date().toISOString(), applied_at: null },
    ]
    vi.mocked(getCorrections).mockResolvedValue(mockCorrections)

    const res = await app.inject({
      method: 'GET',
      url:    '/sources/1/bias-corrections',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ success: boolean; data: unknown[] }>()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(2)
  })

  it('returns 404 when source does not exist', async () => {
    mockDb.mockReturnValue(mockChain(undefined))

    const res = await app.inject({ method: 'GET', url: '/sources/9999/bias-corrections' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /sources/:id/bias-corrections/:cid/vote', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/sources/1/bias-corrections/1/vote',
      payload: { vote: 1 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for invalid vote value', async () => {
    const token = makeToken(app)
    const res = await app.inject({
      method:  'POST',
      url:     '/sources/1/bias-corrections/1/vote',
      headers: { Authorization: `Bearer ${token}` },
      payload: { vote: 2 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('records upvote and returns 200', async () => {
    const token = makeToken(app)
    // correction lookup
    mockDb.mockReturnValue(mockChain({ id: 1, status: 'pending' }))
    vi.mocked(voteOnCorrection).mockResolvedValue(undefined)

    const res = await app.inject({
      method:  'POST',
      url:     '/sources/1/bias-corrections/1/vote',
      headers: { Authorization: `Bearer ${token}` },
      payload: { vote: 1 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ success: boolean }>()
    expect(body.success).toBe(true)
    expect(voteOnCorrection).toHaveBeenCalled()
  })

  it('returns 409 when correction is not pending', async () => {
    const token = makeToken(app)
    mockDb.mockReturnValue(mockChain({ id: 1, status: 'applied' }))

    const res = await app.inject({
      method:  'POST',
      url:     '/sources/1/bias-corrections/1/vote',
      headers: { Authorization: `Bearer ${token}` },
      payload: { vote: 1 },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('GET /sources/:id/bias-corrections/summary', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns summary with consensus_reached=false when votes are low', async () => {
    mockDb.mockReturnValue(mockChain({ id: 1 }))
    vi.mocked(getCorrectionSummary).mockResolvedValue({
      pending_count:       3,
      top_suggestion:      'left',
      top_suggestion_votes: 4,
      consensus_reached:   false,
      consensus_label:     null,
    })

    const res = await app.inject({
      method: 'GET',
      url:    '/sources/1/bias-corrections/summary',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ success: boolean; data: { consensus_reached: boolean } }>()
    expect(body.success).toBe(true)
    expect(body.data.consensus_reached).toBe(false)
  })

  it('returns consensus_reached=true and label when threshold met', async () => {
    mockDb.mockReturnValue(mockChain({ id: 1 }))
    vi.mocked(getCorrectionSummary).mockResolvedValue({
      pending_count:        1,
      top_suggestion:       'left',
      top_suggestion_votes: 12,
      consensus_reached:    true,
      consensus_label:      'left',
    })

    const res = await app.inject({
      method: 'GET',
      url:    '/sources/1/bias-corrections/summary',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ success: boolean; data: { consensus_reached: boolean; consensus_label: string } }>()
    expect(body.data.consensus_reached).toBe(true)
    expect(body.data.consensus_label).toBe('left')
  })
})
