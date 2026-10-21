/**
 * Readers report a post or a community (plan C6; Devon, Oct 21, 2026: "Yes,
 * add the table"): once each, with a reason; 3 or more reports in 30 days
 * put it on Devon's review list. The review list's SQL was tried on
 * PostgreSQL 16 (a spam post with 3 reports and a note, a community with 3
 * recent and 1 old, a post with 1: only the first two listed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  existing: new Set<string>(),
  reports: [] as Array<Record<string, unknown>>,
  user: { id: 'u-1', accountType: 'user' as string },
}))

vi.mock('../db/postgres', () => {
  const db = (table: string) => {
    const where: Record<string, unknown> = {}
    const q: Record<string, unknown> = {}
    q.where = (k: string, v: unknown) => { where[k] = v; return q }
    q.whereNull = () => q
    q.first = async () => (h.existing.has(`${table}:${where.id}`) ? { id: where.id } : undefined)
    let row: Record<string, unknown> = {}
    q.insert = (r: Record<string, unknown>) => { row = r; return q }
    q.onConflict = () => q
    q.ignore = () => q
    q.returning = async () => {
      const dup = h.reports.some(x => x.target_type === row.target_type && x.target_id === row.target_id && x.reporter_id === row.reporter_id)
      if (dup) return []
      h.reports.push(row)
      return [{ id: `r-${h.reports.length}` }]
    }
    return q
  }
  return { db: Object.assign(db, { raw: async () => ({ rows: [] }) }) }
})
vi.mock('../middleware/auth', () => ({
  authenticate: vi.fn((req: { user?: unknown }, _reply: unknown, done: () => void) => { req.user = h.user; done() }),
  optionalAuth: vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
}))

import Fastify from 'fastify'
import { reportContent, ensureContentReportsTable, isReportReason } from '../lib/content-reports'
import { registerPostRoutes } from '../routes/posts'

const POST = '10000000-0000-4000-8000-000000000001'

beforeEach(() => { h.existing.clear(); h.reports = []; h.user = { id: 'u-1', accountType: 'user' } })

describe('a reader\'s report', () => {
  it('once each: reported, then already; nothing to report is not found', async () => {
    h.existing.add(`posts:${POST}`)
    expect(await reportContent('post', POST, 'u-1', 'spam', '  links to a follower shop  ')).toBe('reported')
    expect(h.reports[0]).toMatchObject({ target_type: 'post', target_id: POST, reporter_id: 'u-1', reason: 'spam', note: 'links to a follower shop' })
    expect(await reportContent('post', POST, 'u-1', 'abuse')).toBe('already')
    expect(await reportContent('post', POST, 'u-2', 'abuse')).toBe('reported')
    expect(await reportContent('community', POST, 'u-1', 'spam')).toBe('not_found')
  })
  it('the reasons', () => {
    expect(['spam', 'abuse', 'misinformation', 'other'].every(isReportReason)).toBe(true)
    expect(isReportReason('boring')).toBe(false)
  })
})

describe('POST /api/v1/posts/:id/report', () => {
  async function app() {
    await ensureContentReportsTable()
    const a = Fastify()
    await a.register(registerPostRoutes, { prefix: '/api/v1/posts' })
    return a
  }
  it('201 the first time, 409 the second, 404 for no such post, 400 for an unknown reason', async () => {
    h.existing.add(`posts:${POST}`)
    const a = await app()
    const send = (body: unknown, id = POST) => a.inject({ method: 'POST', url: `/api/v1/posts/${id}/report`, payload: body as object })
    expect((await send({ reason: 'spam' })).statusCode).toBe(201)
    expect((await send({ reason: 'spam' })).statusCode).toBe(409)
    expect((await send({ reason: 'spam' }, '10000000-0000-4000-8000-000000000009')).statusCode).toBe(404)
    expect((await send({ reason: 'spam' }, 'not-a-uuid')).statusCode).toBe(404)
    expect((await send({ reason: 'boring' })).statusCode).toBe(400)
    await a.close()
  })
})
