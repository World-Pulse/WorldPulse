/**
 * Nov 25, 2026: GET /api/v1/threads/active, named in the routes' header, answered 500 ("Something went
 * wrong on our side"): "active" went to Postgres as a thread's UUID. An id that is not a UUID is now
 * no thread (404), and the count by status is at /active/summary.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

const h = vi.hoisted(() => ({ asked: [] as string[] }))

vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../db/postgres', () => {
  const chain = (table: string): any => {
    const q: any = {
      where: (_c: string, v: string) => { h.asked.push(`${table}:${v}`); return q },
      first: async () => undefined,
      select: () => q,
      count: () => q,
      groupBy: async () => [{ status: 'developing', count: '525' }, { status: 'escalating', count: '1321' }],
    }
    return q
  }
  return { db: Object.assign((t: string) => chain(t), { raw: vi.fn() }) }
})

import { registerThreadRoutes, THREAD_ID } from '../threads'

describe('thread ids', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = Fastify()
    await app.register(registerThreadRoutes, { prefix: '/api/v1/threads' })
  })
  afterAll(async () => { await app.close() })

  it('an id that is not a UUID is no thread (404), and the database is not asked', async () => {
    h.asked = []
    for (const id of ['active', 'wp-admin', '1%20OR%201=1']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/threads/${id}` })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ success: false, error: 'Thread not found' })
    }
    expect(h.asked).toEqual([])
  })

  it('a UUID is looked up as before (404 when there is no such thread)', async () => {
    h.asked = []
    const id = 'd27301b4-5ba4-4dac-a48c-1c131fa6c4f6'
    const res = await app.inject({ method: 'GET', url: `/api/v1/threads/${id}` })
    expect(res.statusCode).toBe(404)
    expect(h.asked).toEqual([`event_threads:${id}`])
    expect(THREAD_ID.test(id.toUpperCase())).toBe(true)
  })

  it('the count by status stays at /active/summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/threads/active/summary' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true, developing: 525, escalating: 1321, total_active: 1846 })
  })
})
