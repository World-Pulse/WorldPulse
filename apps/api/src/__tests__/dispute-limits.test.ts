/**
 * H-0056 part 3: limits on POST /signals/:id/dispute.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  store: new Map<string, number>(), down: false, inserted: 0, updates: [] as unknown[], pending: 3,
}))

vi.mock('../db/redis', () => ({
  redis: {
    get: async (k: string) => { if (h.down) throw new Error('down'); return h.store.has(k) ? String(h.store.get(k)) : null },
    incr: async (k: string) => { if (h.down) throw new Error('down'); const v = (h.store.get(k) || 0) + 1; h.store.set(k, v); return v },
    expire: async () => 1,
  },
}))
vi.mock('../middleware/auth', () => ({
  authenticate: async (req: { user?: unknown }) => { req.user = { id: 'user-1' } },
  optionalAuth: async () => {},
}))
vi.mock('../db/postgres', () => {
  const db: any = (table: string) => {
    const q: any = {
      where: () => q,
      first: async () => (table === 'signals' ? { id: 's', category: 'other', severity: 'low', location_name: 'x' } : undefined),
      insert: () => ({ returning: async () => { h.inserted++; return [{ id: 'd1' }] } }),
      count: async () => [{ count: h.pending }],
      update: async (v: unknown) => { h.updates.push({ table, v }); return 1 },
    }
    return q
  }
  db.raw = () => 'NOW()'
  return { db }
})

import { registerDisputeRoutes } from '../routes/disputes'
import { DISPUTES_PER_DAY, disputeKey, correctableValue } from '../lib/dispute-guard'

const SID = '11111111-1111-4111-8111-111111111111'

async function post(body: unknown, id = SID) {
  const app = Fastify()
  await app.register(registerDisputeRoutes)
  const r = await app.inject({ method: 'POST', url: `/signals/${id}/dispute`, payload: body as any })
  await app.close()
  return r
}

describe('dispute limits', () => {
  beforeEach(() => { h.store.clear(); h.down = false; h.inserted = 0; h.updates = []; h.pending = 3 })

  it('stores a valid dispute and counts it', async () => {
    const r = await post({ type: 'wrong_category', suggested_value: 'conflict' })
    expect(r.statusCode).toBe(201)
    expect(h.store.get(disputeKey('user-1'))).toBe(1)
  })

  it('refuses an unknown type, a bad signal id and overlong text', async () => {
    expect((await post({ type: 'nonsense' })).statusCode).toBe(400)
    expect((await post({ type: 'spam' }, 'not-a-uuid')).statusCode).toBe(400)
    expect((await post({ type: 'spam', reason: 'x'.repeat(1001) })).statusCode).toBe(400)
    expect((await post({ type: 'spam', reason: 5 })).statusCode).toBe(400)
    expect(h.inserted).toBe(0)
  })

  it('refuses with 429 once the daily cap is reached', async () => {
    h.store.set(disputeKey('user-1'), DISPUTES_PER_DAY)
    expect((await post({ type: 'spam' })).statusCode).toBe(429)
    expect(h.inserted).toBe(0)
  })

  it('still accepts if Redis is down', async () => {
    h.down = true
    expect((await post({ type: 'spam' })).statusCode).toBe(201)
  })

  it('auto-corrects only to a category or severity that exists', async () => {
    await post({ type: 'wrong_category', suggested_value: 'not-a-category' })
    expect(h.updates.filter((u: any) => u.table === 'signals')).toHaveLength(0)
    await post({ type: 'wrong_severity', suggested_value: 'High' })
    expect(h.updates.find((u: any) => u.table === 'signals')).toEqual({ table: 'signals', v: { severity: 'high' } })
  })

  it('correctableValue ignores other dispute types and non-text', () => {
    expect(correctableValue('wrong_location', 'Paris')).toBeNull()
    expect(correctableValue('wrong_category', 7)).toBeNull()
    expect(correctableValue('wrong_category', 'conflict')).toBe('conflict')
  })
})
