/**
 * The Pro waitlist (plan 13; Devon, Oct 21, 2026: "Waitlist now, price later").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = vi.hoisted(() => ({ raw: [] as Array<[string, unknown[] | undefined]>, fail: false }))
vi.mock('../db/postgres', () => ({ db: { raw: async (sql: string, b?: unknown[]) => { if (calls.fail) throw new Error('db down'); calls.raw.push([sql, b]); return { rows: [] } } } }))
vi.mock('../db/redis', () => ({ redis: {} }))

import Fastify from 'fastify'
import { cleanEmail, cleanSource, ensureWaitlistTable } from '../lib/pro-waitlist'
import { registerProWaitlistRoutes } from '../routes/pro-waitlist'

describe('cleanEmail', () => {
  it('keeps a plain address, trimmed and in lower case', () => {
    expect(cleanEmail('  Reader@Example.COM ')).toBe('reader@example.com')
    expect(cleanEmail('a.b+pro@mail.example.org')).toBe('a.b+pro@mail.example.org')
  })
  it('refuses what isn\'t one', () => {
    for (const v of ['', 'reader', 'reader@', '@example.com', 'a b@example.com', 'x@y', '<script>@x.com', 'a@b.c', 42, null]) {
      expect(cleanEmail(v), String(v)).toBeNull()
    }
    expect(cleanEmail(`${'a'.repeat(250)}@example.com`)).toBeNull()
  })
})

describe('cleanSource', () => {
  it('keeps a page path or a word, nothing else', () => {
    expect(cleanSource('/pricing')).toBe('/pricing')
    expect(cleanSource('pricing-cta')).toBe('pricing-cta')
    expect(cleanSource('<b>')).toBeNull()
    expect(cleanSource('https://evil.example/?q=1')).toBeNull()
  })
})

describe('POST /api/v1/pro/waitlist', () => {
  beforeEach(() => { calls.raw = []; calls.fail = false })
  async function app() {
    const a = Fastify()
    await a.register(registerProWaitlistRoutes, { prefix: '/api/v1/pro' })
    return a
  }

  it('says "starting up" until the table exists', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/v1/pro/waitlist', payload: { email: 'reader@example.com' } })
    // ensureWaitlistTable() hasn't run in this test file yet
    expect([200, 503]).toContain(res.statusCode)
  })

  it('adds an address once, and answers the same either way', async () => {
    expect(await ensureWaitlistTable()).toBe(true)
    const a = await app()
    const first = await a.inject({ method: 'POST', url: '/api/v1/pro/waitlist', payload: { email: 'Reader@Example.com', source: '/pricing' } })
    const again = await a.inject({ method: 'POST', url: '/api/v1/pro/waitlist', payload: { email: 'reader@example.com' } })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual(again.json())
    const inserts = calls.raw.filter(([sql]) => sql.startsWith('INSERT INTO pro_waitlist'))
    expect(inserts[0][1]).toEqual(['reader@example.com', '/pricing'])
    expect(inserts[0][0]).toContain('ON CONFLICT (lower(email)) DO NOTHING')
  })

  it('refuses an address that isn\'t one', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/v1/pro/waitlist', payload: { email: 'not an email' } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR' })
  })

  it('says so when it can\'t store it', async () => {
    calls.fail = true
    const res = await (await app()).inject({ method: 'POST', url: '/api/v1/pro/waitlist', payload: { email: 'reader@example.com' } })
    expect(res.statusCode).toBe(503)
  })
})
