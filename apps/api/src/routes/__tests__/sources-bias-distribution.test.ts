/**
 * GET /api/v1/sources/bias-distribution (Nov 10, 2026): it counted the sources table's bias_label, a column
 * production never got, and answered 500. It now counts each active source's lean as /:id/bias gives it.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

const asked = vi.hoisted(() => ({ wheres: [] as unknown[][], selects: [] as unknown[][] }))

vi.mock('../../db/postgres', () => ({
  db: (table: string) => {
    const q = {
      where: (...a: unknown[]) => { asked.wheres.push([table, ...a]); return q },
      select: async (...a: unknown[]) => {
        asked.selects.push([table, ...a])
        return [{ url: 'https://www.reuters.com/' }, { url: 'https://apnews.com' }, { url: 'https://www.theguardian.com/world' }, { url: 'https://unknown.example' }, { url: null }]
      },
    }
    return q
  },
}))
vi.mock('../../db/redis', () => ({ redis: {} }))
vi.mock('../../middleware/auth', () => ({ optionalAuth: async () => {}, authenticate: async () => {} }))
vi.mock('../../lib/swr-cache', () => ({ staleWhileRevalidate: (_key: string, _opts: unknown, make: () => unknown) => make() }))
vi.mock('../../lib/source-bias', () => ({
  extractDomain: (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0],
  getSourceBias: async (u: string) => ({
    score: 0, confidence: 'high', method: 'seed',
    label: u.includes('theguardian') ? 'left' : u.includes('unknown') ? 'unknown' : 'center',
  }),
}))

import { registerSourceRoutes } from '../sources'

describe('GET /api/v1/sources/bias-distribution', () => {
  it("counts the active sources by their lean, as each source's bias gives it, leaving the unknown out", async () => {
    const app = Fastify()
    await app.register(registerSourceRoutes, { prefix: '/api/v1/sources' })
    const res = await app.inject({ method: 'GET', url: '/api/v1/sources/bias-distribution' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: { center: 2, left: 1 } })
    expect(asked.wheres).toContainEqual(['sources', 'active', true])
    // no bias_label column read
    expect(JSON.stringify(asked)).not.toContain('bias_label')
  })
})
