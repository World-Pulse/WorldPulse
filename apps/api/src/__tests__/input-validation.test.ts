/**
 * Input validation tests for WorldPulse API schemas.
 *
 * Mirrors the Zod schemas defined in auth.ts and validates the exact
 * constraints the route handlers enforce, without spinning up a server.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ── Mirror of auth.ts RegisterSchema ──────────────────────────────────────────

const RegisterSchema = z.object({
  handle:      z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().min(1).max(100),
  email:       z.string().email(),
  password:    z.string().min(8).max(128),
})

// ── Mirror of auth.ts LoginSchema ─────────────────────────────────────────────

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
})

// ── RegisterSchema ────────────────────────────────────────────────────────────

describe('RegisterSchema', () => {
  const valid = {
    handle:      'worldpulse_user',
    displayName: 'World Pulse User',
    email:       'user@example.com',
    password:    'SecurePass123!',
  }

  it('accepts a fully valid payload', () => {
    expect(RegisterSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a handle shorter than 3 characters', () => {
    const r = RegisterSchema.safeParse({ ...valid, handle: 'ab' })
    expect(r.success).toBe(false)
  })

  it('rejects a handle longer than 50 characters', () => {
    const r = RegisterSchema.safeParse({ ...valid, handle: 'a'.repeat(51) })
    expect(r.success).toBe(false)
  })

  it('rejects a handle with spaces', () => {
    const r = RegisterSchema.safeParse({ ...valid, handle: 'hello world' })
    expect(r.success).toBe(false)
  })

  it('rejects a handle with special characters other than underscore', () => {
    const r = RegisterSchema.safeParse({ ...valid, handle: 'user@name' })
    expect(r.success).toBe(false)
  })

  it('accepts a handle with underscores', () => {
    const r = RegisterSchema.safeParse({ ...valid, handle: 'user_name_123' })
    expect(r.success).toBe(true)
  })

  it('rejects an invalid email address', () => {
    const r = RegisterSchema.safeParse({ ...valid, email: 'not-an-email' })
    expect(r.success).toBe(false)
  })

  it('rejects a password shorter than 8 characters', () => {
    const r = RegisterSchema.safeParse({ ...valid, password: 'short' })
    expect(r.success).toBe(false)
  })

  it('rejects a password longer than 128 characters', () => {
    const r = RegisterSchema.safeParse({ ...valid, password: 'a'.repeat(129) })
    expect(r.success).toBe(false)
  })

  it('rejects an empty displayName', () => {
    const r = RegisterSchema.safeParse({ ...valid, displayName: '' })
    expect(r.success).toBe(false)
  })

  it('rejects a displayName longer than 100 characters', () => {
    const r = RegisterSchema.safeParse({ ...valid, displayName: 'a'.repeat(101) })
    expect(r.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    const r = RegisterSchema.safeParse({ handle: 'testuser' })
    expect(r.success).toBe(false)
  })
})

// ── LoginSchema ───────────────────────────────────────────────────────────────

describe('LoginSchema', () => {
  const valid = {
    email:    'user@worldpulse.io',
    password: 'anypassword',
  }

  it('accepts a valid login payload', () => {
    expect(LoginSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const r = LoginSchema.safeParse({ ...valid, email: 'bademail' })
    expect(r.success).toBe(false)
  })

  it('accepts any non-empty password string', () => {
    const r = LoginSchema.safeParse({ ...valid, password: 'x' })
    expect(r.success).toBe(true)
  })

  it('rejects missing email', () => {
    const r = LoginSchema.safeParse({ password: 'secret' })
    expect(r.success).toBe(false)
  })

  it('rejects missing password', () => {
    const r = LoginSchema.safeParse({ email: 'user@example.com' })
    expect(r.success).toBe(false)
  })
})

// ── Signal-related pagination helpers ─────────────────────────────────────────

const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
})

describe('pagination schema (cursor + limit)', () => {
  it('defaults limit to 20 when omitted', () => {
    const r = PaginationSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.limit).toBe(20)
  })

  it('accepts a valid numeric limit', () => {
    const r = PaginationSchema.safeParse({ limit: '10' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.limit).toBe(10)
  })

  it('rejects limit > 50', () => {
    const r = PaginationSchema.safeParse({ limit: '51' })
    expect(r.success).toBe(false)
  })

  it('rejects limit < 1', () => {
    const r = PaginationSchema.safeParse({ limit: '0' })
    expect(r.success).toBe(false)
  })

  it('accepts an optional cursor string', () => {
    const r = PaginationSchema.safeParse({ cursor: '2026-03-01T00:00:00.000Z' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.cursor).toBe('2026-03-01T00:00:00.000Z')
  })

  it('cursor is absent when not provided', () => {
    const r = PaginationSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.cursor).toBeUndefined()
  })
})

// ── Signal severity ordering ───────────────────────────────────────────────────

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const
type SeverityLevel = (typeof SEVERITY_ORDER)[number]

function severityRank(s: SeverityLevel): number {
  return SEVERITY_ORDER.indexOf(s)
}

describe('severity ordering', () => {
  it('critical < high in severity rank (lower index = more severe)', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('high'))
  })

  it('high < medium', () => {
    expect(severityRank('high')).toBeLessThan(severityRank('medium'))
  })

  it('medium < low', () => {
    expect(severityRank('medium')).toBeLessThan(severityRank('low'))
  })

  it('low < info', () => {
    expect(severityRank('low')).toBeLessThan(severityRank('info'))
  })

  it('all five levels are represented', () => {
    expect(SEVERITY_ORDER).toHaveLength(5)
  })
})
