/**
 * POST /api/v1/breaking/alerts/:alertId/dismiss is admins' (Nov 8, 2026): anyone could remove a breaking alert for
 * everyone, and the banner did each one after 60 seconds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'

const h = vi.hoisted(() => ({ dismissed: [] as string[] }))

vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } }))
vi.mock('../lib/breaking-alerts', () => ({
  getActiveBreakingAlerts: vi.fn(async () => []),
  dismissBreakingAlert: vi.fn(async (id: string) => { h.dismissed.push(id) }),
  BREAKING_ALERT_RATE_LIMIT: 8,
  BREAKING_ALERT_WINDOW_S: 3600,
}))
// signed in as the x-test-user header says, or 401
vi.mock('../middleware/auth', () => ({
  authenticate: vi.fn(async (req: FastifyRequest, reply: FastifyReply) => {
    const who = req.headers['x-test-user']
    if (!who) return reply.status(401).send({ success: false, error: 'Sign-in required' })
    ;(req as unknown as { user: unknown }).user = { id: 'u1', accountType: String(who) }
  }),
}))

import { registerBreakingRoutes } from '../routes/breaking'

async function dismiss(user?: string) {
  const app = Fastify({ logger: false })
  await app.register(registerBreakingRoutes, { prefix: '/api/v1/breaking' })
  return app.inject({ method: 'POST', url: '/api/v1/breaking/alerts/a1/dismiss', headers: user ? { 'x-test-user': user } : {} })
}

describe('POST /api/v1/breaking/alerts/:alertId/dismiss', () => {
  beforeEach(() => { h.dismissed = [] })

  it('is refused to a visitor and to a member, and dismisses for an admin', async () => {
    expect((await dismiss()).statusCode).toBe(401)
    expect((await dismiss('free')).statusCode).toBe(403)
    expect(h.dismissed).toEqual([])
    const ok = await dismiss('admin')
    expect(ok.statusCode).toBe(200)
    expect(h.dismissed).toEqual(['a1'])
  })
})
