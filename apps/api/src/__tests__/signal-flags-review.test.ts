/**
 * What a reader's flag does (plan C5; Devon, Oct 21, 2026: "Show it + review
 * list"): the signal page's count and reasons (never notes or who), and the
 * review list of reports 3 or more readers flagged, for admins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'

const h = vi.hoisted(() => ({
  grouped: [] as Array<{ reason: string; n: string }>,
  rows: [] as Array<Record<string, unknown>>,
  sql: '' as string,
  params: [] as unknown[],
  user: null as { id: string; accountType: string } | null,
}))

vi.mock('../db/postgres', () => {
  const chain = {
    where: () => chain,
    select: () => chain,
    count: () => chain,
    groupBy: async () => h.grouped,
  }
  return {
    db: Object.assign(() => chain, {
      raw: async (sql: string, params: unknown[]) => { h.sql = sql; h.params = params; return { rows: h.rows } },
    }),
  }
})
vi.mock('../db/redis', () => ({ redis: { get: async () => null, setex: async () => 'OK', set: async () => 'OK', smembers: async () => [], hgetall: async () => ({}) } }))
vi.mock('../middleware/auth', () => ({
  authenticate: async (req: FastifyRequest) => { (req as unknown as { user: typeof h.user }).user = h.user },
}))
vi.mock('../lib/security', () => ({ getSecurityMetrics: async () => null }))
vi.mock('../lib/search-backfill', () => ({ runFullReindex: async () => null, syncRecentSignalsOnStartup: async () => null }))

import { flagSummary, flagReviewList, REVIEW_AT } from '../lib/signal-flags'
import { registerAdminRoutes } from '../routes/admin'

beforeEach(() => { h.grouped = []; h.rows = []; h.user = null })

describe('flagSummary', () => {
  it('counts the readers and their reasons, nothing else', async () => {
    h.grouped = [{ reason: 'inaccurate', n: '2' }, { reason: 'misinformation', n: '1' }, { reason: 'something-old', n: '1' }]
    expect(await flagSummary('s1')).toEqual({ count: 4, reasons: { inaccurate: 2, misinformation: 1 } })
  })
  it('none', async () => {
    expect(await flagSummary('s1')).toEqual({ count: 0, reasons: {} })
  })
})

describe('flagReviewList', () => {
  it('asks for 3+ readers in 30 days and reads the rows', async () => {
    h.rows = [{
      id: 'a1', title: 'A flagged story', status: 'verified', created_at: '2026-10-21T10:00:00Z',
      flags: '3', last_flag_at: '2026-10-21T15:00:00Z', notes: ['fake quote', 'wrong city'],
      reasons: { inaccurate: 2, misinformation: 1, junk: 5 },
    }]
    const list = await flagReviewList(500)
    expect(h.params).toEqual([30, 30, REVIEW_AT, 200])
    expect(h.sql).toMatch(/HAVING count\(\*\) >= \?/)
    expect(list).toEqual([{
      id: 'a1', title: 'A flagged story', status: 'verified', createdAt: '2026-10-21T10:00:00.000Z',
      flags: 3, reasons: { inaccurate: 2, misinformation: 1 }, lastFlagAt: '2026-10-21T15:00:00.000Z',
      notes: ['fake quote', 'wrong city'],
    }])
  })
})

describe('GET /api/v1/admin/flags', () => {
  it('admins only', async () => {
    const app = Fastify()
    await app.register(registerAdminRoutes, { prefix: '/api/v1/admin' })
    h.user = { id: 'u2', accountType: 'user' }
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/flags' })).statusCode).toBe(403)
    h.user = { id: 'u1', accountType: 'admin' }
    h.rows = []
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/flags' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ minFlags: 3, days: 30, items: [] })
  })
})
