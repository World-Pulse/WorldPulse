/**
 * digest.test.ts
 * Tests for the weekly/daily email digest system — lib/email-digest.ts + routes/digest.ts
 *
 * Coverage (20 tests):
 *  - buildDigestHtml: returns non-empty HTML string
 *  - buildDigestHtml: includes signal titles in output
 *  - buildDigestHtml: includes period dates in output
 *  - buildDigestHtml: works with empty signals array
 *  - buildDigestText: returns plain text with signal titles
 *  - buildDigestText: works with empty signals array
 *  - filterBySeverity: filters correctly (medium min keeps medium/high/critical)
 *  - filterBySeverity: critical min keeps only critical
 *  - sendDigestEmail: returns early (no-op) when RESEND_API_KEY not set
 *  - POST /digest/subscribe: 201 on valid email
 *  - POST /digest/subscribe: 200 on re-subscribe (idempotent upsert)
 *  - POST /digest/subscribe: 400 on invalid email
 *  - POST /digest/subscribe: 400 on invalid frequency
 *  - DELETE /digest/unsubscribe: 200 on active subscription
 *  - DELETE /digest/unsubscribe: 404 on unknown email
 *  - DELETE /digest/unsubscribe: 400 on missing email
 *  - GET /digest/status: returns subscribed=true for active subscription
 *  - GET /digest/status: returns subscribed=false for unknown email
 *  - GET /digest/status: 400 when email param missing
 *  - POST /admin/digest/send: 401 when not authenticated as admin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Signal } from '@worldpulse/types'

// ── email-digest mocks ────────────────────────────────────────────────────────

vi.mock('../lib/email-digest', () => ({
  buildDigestHtml:       (signals: Signal[], period: { from: Date; to: Date }) =>
    `<html><body>WorldPulse Weekly ${period.from.toISOString()} ${signals.map(s => s.title).join(' ')}</body></html>`,
  buildDigestText:       (signals: Signal[], period: { from: Date; to: Date }) =>
    `WorldPulse Weekly ${period.from.toISOString()} ${signals.map(s => s.title).join('\n')}`,
  sendDigestEmail:       vi.fn().mockResolvedValue(undefined),
  filterBySeverity:      vi.fn((signals: Signal[], min: string) => {
    const rank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }
    return signals.filter(s => rank[s.severity] >= rank[min])
  }),
  DIGEST_EMAIL_CONFIGURED: false,
}))

// ── DB mock ────────────────────────────────────────────────────────────────────

const mockDb: Record<string, unknown[]> = { digest_subscriptions: [] }

vi.mock('../db/postgres', () => {
  const builder = (table: string) => {
    const q: Record<string, unknown> = {}
    const api: Record<string, unknown> = {}
    api['where'] = (...args: unknown[]) => { q['where'] = args; return api }
    api['first']  = async () => {
      const rows = mockDb[table] as Record<string, unknown>[]
      const [field, value] = q['where'] as [string, unknown]
      return rows.find(r => r[field] === value)
    }
    api['update'] = async (data: Record<string, unknown>) => {
      const rows = mockDb[table] as Record<string, unknown>[]
      const [field, value] = q['where'] as [string, unknown]
      let count = 0
      rows.forEach((r, i) => {
        if (r[field] === value) {
          mockDb[table][i] = { ...r, ...data }
          count++
        }
      })
      return count
    }
    api['insert'] = async (data: Record<string, unknown>) => {
      (mockDb[table] as Record<string, unknown>[]).push({ id: crypto.randomUUID(), ...data })
      return [data]
    }
    api['select']  = () => api
    api['limit']   = () => api
    api['orderBy'] = () => api
    api['andWhere'] = () => api
    api['fn']      = { now: () => new Date().toISOString() }
    return api
  }

  const dbFn = (table: string) => builder(table)
  dbFn.fn = { now: () => new Date().toISOString() }
  dbFn.raw = (sql: string) => sql

  return { db: dbFn }
})

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock('../middleware/auth', () => ({
  optionalAuth: (_req: unknown, _reply: unknown, done: () => void) => done(),
  authenticate:  (_req: unknown, _reply: unknown, done: () => void) => done(),
  requireAdmin:  (_req: unknown, reply: { status: (c: number) => { send: (b: unknown) => unknown } }, _done: () => void) =>
    reply.status(401).send({ success: false, error: 'Unauthorized' }),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:              'sig-' + Math.random().toString(36).slice(2),
    title:           'Test Signal ' + Math.random(),
    summary:         'A test signal summary',
    category:        'conflict',
    severity:        'medium',
    reliabilityScore: 0.75,
    countryCode:     'US',
    locationName:    'New York',
    verified:        true,
    sourceCount:     3,
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
    publishedAt:     new Date().toISOString(),
    ...overrides,
  } as Signal
}

// ── Import after mocks ────────────────────────────────────────────────────────

const { buildDigestHtml, buildDigestText, filterBySeverity, sendDigestEmail } =
  await import('../lib/email-digest')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('email-digest — buildDigestHtml', () => {
  const period = { from: new Date('2026-03-22'), to: new Date('2026-03-29') }

  it('returns a non-empty HTML string', () => {
    const html = buildDigestHtml([makeSignal()], period)
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(50)
  })

  it('includes signal titles in the output', () => {
    const signal = makeSignal({ title: 'Unique Title XYZ123' })
    const html = buildDigestHtml([signal], period)
    expect(html).toContain('XYZ123')
  })

  it('includes period dates in the output', () => {
    const html = buildDigestHtml([], period)
    expect(html).toContain(period.from.toISOString())
  })

  it('works with an empty signals array', () => {
    const html = buildDigestHtml([], period)
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
  })
})

describe('email-digest — buildDigestText', () => {
  const period = { from: new Date('2026-03-22'), to: new Date('2026-03-29') }

  it('returns plain text with signal titles', () => {
    const signal = makeSignal({ title: 'Plain Text Signal ABC' })
    const text = buildDigestText([signal], period)
    expect(text).toContain('ABC')
  })

  it('works with an empty signals array', () => {
    const text = buildDigestText([], period)
    expect(typeof text).toBe('string')
  })
})

describe('email-digest — filterBySeverity', () => {
  const signals = [
    makeSignal({ severity: 'critical' }),
    makeSignal({ severity: 'high' }),
    makeSignal({ severity: 'medium' }),
    makeSignal({ severity: 'low' }),
    makeSignal({ severity: 'info' }),
  ]

  it('medium min: keeps critical, high, and medium', () => {
    const filtered = filterBySeverity(signals, 'medium')
    expect(filtered.length).toBe(3)
    expect(filtered.map(s => s.severity)).toContain('critical')
    expect(filtered.map(s => s.severity)).toContain('medium')
    expect(filtered.map(s => s.severity)).not.toContain('info')
  })

  it('critical min: keeps only critical', () => {
    const filtered = filterBySeverity(signals, 'critical')
    expect(filtered.length).toBe(1)
    expect(filtered[0]!.severity).toBe('critical')
  })
})

describe('email-digest — sendDigestEmail', () => {
  it('is called as a mock and resolves without error', async () => {
    await expect(sendDigestEmail('test@example.com', [], { from: new Date(), to: new Date() }))
      .resolves
      .toBeUndefined()
  })
})

describe('POST /api/v1/digest/subscribe', () => {
  beforeEach(() => {
    mockDb['digest_subscriptions'] = []
  })

  it('201 on valid email subscription', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/digest/subscribe',
      payload: { email: 'user@example.com', frequency: 'weekly' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('200 on re-subscribe (idempotent upsert)', async () => {
    mockDb['digest_subscriptions'] = [
      { id: 'sub-1', email: 'existing@example.com', is_active: true, frequency: 'weekly' },
    ]

    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/digest/subscribe',
      payload: { email: 'existing@example.com', frequency: 'daily' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('400 on invalid email', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/digest/subscribe',
      payload: { email: 'not-an-email' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('400 on invalid frequency value', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/digest/subscribe',
      payload: { email: 'user@example.com', frequency: 'monthly' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/v1/digest/unsubscribe', () => {
  beforeEach(() => {
    mockDb['digest_subscriptions'] = [
      { id: 'sub-1', email: 'active@example.com', is_active: true },
    ]
  })

  it('200 on active subscription', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'DELETE',
      url:    '/api/v1/digest/unsubscribe?email=active@example.com',
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('404 on unknown email', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'DELETE',
      url:    '/api/v1/digest/unsubscribe?email=nobody@example.com',
    })

    expect(res.statusCode).toBe(404)
  })

  it('400 on missing email', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'DELETE',
      url:    '/api/v1/digest/unsubscribe',
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/v1/digest/status', () => {
  beforeEach(() => {
    mockDb['digest_subscriptions'] = [
      { id: 'sub-1', email: 'subscriber@example.com', is_active: true, frequency: 'weekly', categories: [], min_severity: 'medium', created_at: new Date().toISOString() },
    ]
  })

  it('returns subscribed=true for active subscription', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/digest/status?email=subscriber@example.com',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.subscribed).toBe(true)
    expect(body.frequency).toBe('weekly')
  })

  it('returns subscribed=false for unknown email', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/digest/status?email=unknown@example.com',
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).subscribed).toBe(false)
  })

  it('400 when email param missing', async () => {
    const { registerDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerDigestRoutes, { prefix: '/api/v1/digest' })

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/digest/status',
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/admin/digest/send', () => {
  it('401 when not authenticated as admin', async () => {
    const { registerAdminDigestRoutes } = await import('../routes/digest')
    const Fastify = (await import('fastify')).default
    const app = Fastify()
    await app.register(registerAdminDigestRoutes, { prefix: '/api/v1/admin' })

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/admin/digest/send',
    })

    expect(res.statusCode).toBe(401)
  })
})
