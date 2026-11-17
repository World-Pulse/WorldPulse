/**
 * H-0056 part 4: a daily cap on POST /polls per account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({ store: new Map<string, number>(), down: false, inserted: 0 }))

vi.mock('../db/redis', () => ({
  redis: {
    get: async (k: string) => { if (h.down) throw new Error('down'); return h.store.has(k) ? String(h.store.get(k)) : null },
    incr: async (k: string) => { if (h.down) throw new Error('down'); const v = (h.store.get(k) || 0) + 1; h.store.set(k, v); return v },
    expire: async () => 1,
    del: async () => 1,
  },
}))
vi.mock('../middleware/auth', () => ({
  authenticate: async (req: { user?: unknown }) => { req.user = { id: 'user-1' } },
  optionalAuth: async () => {},
}))
vi.mock('../db/postgres', () => {
  const db: any = () => {
    const q: any = {
      where: () => q,
      first: async () => undefined,
      insert: () => ({ returning: async () => { h.inserted++; return [{ id: 'p1', question: 'q', created_at: new Date(), options: '[{"text":"a","votes":0},{"text":"b","votes":0}]' }] } }),
    }
    return q
  }
  return { db }
})

import { registerPollRoutes } from '../routes/polls'
import { POLLS_PER_DAY, pollKey } from '../lib/poll-guard'

async function create() {
  const app = Fastify()
  await app.register(registerPollRoutes)
  const r = await app.inject({ method: 'POST', url: '/', payload: { question: 'Q?', options: ['a', 'b'] } })
  await app.close()
  return r
}

describe('poll limits', () => {
  beforeEach(() => { h.store.clear(); h.down = false; h.inserted = 0 })

  it('creates a poll and counts it', async () => {
    expect((await create()).statusCode).toBe(201)
    expect(h.store.get(pollKey('user-1'))).toBe(1)
  })

  it('refuses with 429 once the daily cap is reached', async () => {
    h.store.set(pollKey('user-1'), POLLS_PER_DAY)
    expect((await create()).statusCode).toBe(429)
    expect(h.inserted).toBe(0)
  })

  it('still accepts if Redis is down', async () => {
    h.down = true
    expect((await create()).statusCode).toBe(201)
  })
})
