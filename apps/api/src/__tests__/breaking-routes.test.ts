/**
 * The breaking alerts routes. GET /alerts gives each story once, with its outlet count (Nov 9, 2026; Devon: "the
 * banner should always be accurate"). POST /alerts/:alertId/dismiss is admins' (Nov 8, 2026): anyone could remove a
 * breaking alert for everyone, and the banner did each one after 60 seconds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'

const h = vi.hoisted(() => ({ dismissed: [] as string[], alerts: [] as Array<Record<string, unknown>>, outletsAsked: [] as string[] }))

vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } }))
vi.mock('../lib/breaking-alerts', () => ({
  getActiveBreakingAlerts: vi.fn(async () => h.alerts),
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

const SENEGAL_1 = '11111111-1111-4111-8111-111111111111'
const SENEGAL_2 = '22222222-2222-4222-8222-222222222222'
const TYPHOON = '33333333-3333-4333-8333-333333333333'

async function build() {
  const app = Fastify({ logger: false })
  // the outlets route the list asks, as /api/v1/stories/outlets answers
  app.get('/api/v1/stories/outlets', async (req) => {
    h.outletsAsked.push(req.url)
    return {
      success: true,
      data: {
        stories: {
          [SENEGAL_1]: { storyId: 'senegal', outlets: 14, verified: true, countries: 13, canonicalId: SENEGAL_2 },
          [SENEGAL_2]: { storyId: 'senegal', outlets: 14, verified: true, countries: 13, canonicalId: SENEGAL_2 },
          [TYPHOON]: { storyId: TYPHOON, outlets: 1, verified: false, countries: 0, canonicalId: null },
        },
      },
    }
  })
  await app.register(registerBreakingRoutes, { prefix: '/api/v1/breaking' })
  return app
}

async function dismiss(user?: string) {
  const app = await build()
  return app.inject({ method: 'POST', url: '/api/v1/breaking/alerts/a1/dismiss', headers: user ? { 'x-test-user': user } : {} })
}

describe('GET /api/v1/breaking/alerts', () => {
  beforeEach(() => { h.alerts = []; h.outletsAsked = [] })

  it('gives each story once, as its newest alert, with its outlet count and its page', async () => {
    const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
    const until = new Date(Date.now() + 3_600_000).toISOString()
    h.alerts = [
      { alertId: 'a1', signalId: SENEGAL_1, title: '21 dead after migrant boat sinks off Senegal coast', severity: 'high', category: 'disaster', timestamp: at(90), expiresAt: until },
      { alertId: 'a2', signalId: TYPHOON, title: 'Typhoon Cempaka to enter PAR', severity: 'high', category: 'disaster', timestamp: at(60), expiresAt: until },
      { alertId: 'a3', signalId: SENEGAL_2, title: 'At least 35 killed in migrant boat sinking off Senegal', severity: 'high', category: 'disaster', timestamp: at(30), expiresAt: until },
      { alertId: 'a4', signalId: TYPHOON, title: 'Gone', severity: 'high', category: 'disaster', timestamp: at(500), expiresAt: at(10) },
    ]
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/api/v1/breaking/alerts' })
    expect(res.statusCode).toBe(200)
    const { alerts, count } = res.json().data
    expect(count).toBe(2)
    expect(alerts.map((a: { alertId: string }) => a.alertId)).toEqual(['a3', 'a2'])
    expect(alerts[0].story).toEqual({ id: 'senegal', outlets: 14, verified: true, countries: 13, page: SENEGAL_2 })
    expect(alerts[1].story).toEqual({ id: TYPHOON, outlets: 1, verified: false, countries: 0, page: TYPHOON })
    expect(h.outletsAsked).toEqual([`/api/v1/stories/outlets?ids=${SENEGAL_2},${TYPHOON},${SENEGAL_1}`])
  })

  it('still gives the alerts, story null, when the counts can\'t be had', async () => {
    h.alerts = [{ alertId: 'a9', signalId: 'not-a-report-id', title: 'Something happened', severity: 'high', category: 'disaster', timestamp: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }]
    const app = await build()
    const { alerts } = (await app.inject({ method: 'GET', url: '/api/v1/breaking/alerts' })).json().data
    expect(alerts).toHaveLength(1)
    expect(alerts[0].story).toBeNull()
    expect(h.outletsAsked).toEqual([])
  })
})

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
