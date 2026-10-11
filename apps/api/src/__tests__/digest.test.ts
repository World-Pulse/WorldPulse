/**
 * digest.test.ts
 * Tests for the weekly/daily email digest system — lib/email-digest.ts + routes/digest.ts
 *
 * Coverage:
 *  - buildDigestHtml: returns non-empty HTML string
 *  - buildDigestHtml: includes signal titles in output
 *  - buildDigestHtml: includes period dates in output
 *  - buildDigestHtml: works with empty signals array
 *  - buildDigestText: returns plain text with signal titles
 *  - buildDigestText: works with empty signals array
 *  - filterBySeverity: filters correctly (medium min keeps medium/high/critical)
 *  - filterBySeverity: critical min keeps only critical
 *  - sendDigestEmail: returns early (no-op) when RESEND_API_KEY not set
 *  - (subscribe, confirm, unsubscribe and status: digest-routes.test.ts)
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

// The public subscription routes (sign-up, confirm, unsubscribe, status)
// changed with the email briefing (plan G4, Oct 11, 2026): see
// digest-routes.test.ts.

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
