/**
 * GET /api/v1/signals/count: besides the totals, the last 24 hours'
 * verified signals, countries and outlets, so the home page's right column
 * shows live figures (plan P7, Oct 11, 2026: "99.9% uptime", "195 nations"
 * and "300+ sources" were typed in, and "Cross-source verified: 100%" was
 * the share of signals not flagged as AI slop).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
}))

vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../../db/postgres', () => {
  function builder() {
    const own: string[] = []
    let firstRow: unknown = null
    const b: Record<string, unknown> = {}
    for (const m of ['whereIn', 'where', 'whereRaw', 'select', 'groupBy', 'count']) {
      b[m] = (...args: unknown[]) => { own.push(m); h.calls.push({ method: m, args }); return b }
    }
    b.first = (...args: unknown[]) => {
      h.calls.push({ method: 'first', args })
      firstRow = { verified: 413, countries: 152, outlets: 980 }
      return b
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const value = firstRow
        ?? (own.includes('groupBy') ? [{ severity: 'high', count: '5' }, { severity: 'low', count: '7' }] : [{ count: '6127' }])
      return Promise.resolve(value).then(res, rej)
    }
    return b
  }
  const db = Object.assign(vi.fn(() => builder()), {
    raw: vi.fn((sql: string, bindings?: unknown[]) => ({ toString: () => sql, sql, bindings })),
  })
  return { db }
})

import { registerSignalRoutes } from '../signals'

describe('GET /api/v1/signals/count', () => {
  beforeEach(() => { h.calls.length = 0 })

  it("adds the last 24 hours' verified signals, countries and outlets", async () => {
    const server = Fastify({ logger: false })
    await server.register(registerSignalRoutes, { prefix: '/api/v1/signals' })
    const res = await server.inject({ method: 'GET', url: '/api/v1/signals/count' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      total: 6127, last24h: 6127, lastHour: 6127,
      verified24h: 413, countries24h: 152, outlets24h: 980,
      bySeverity: { high: 5, low: 7 },
    })

    // One query for the day's figures; the outlet is the website of each signal's article
    const first = h.calls.find(c => c.method === 'first')
    const raws = (first?.args ?? []) as Array<{ sql: string; bindings?: unknown[] }>
    expect(raws.map(r => r.sql).join(' ')).toMatch(/FILTER \(WHERE status = 'verified'\).*count\(DISTINCT country_code\).*original_urls\[1\]/)
    // the address pattern goes to Postgres as a value (a "?" in knex's SQL is a placeholder)
    expect(raws[2]?.bindings).toEqual(['^https?://([^/:?#]+)', '^www\\.'])
  })
})
