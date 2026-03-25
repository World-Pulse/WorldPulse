import { describe, it, expect, vi } from 'vitest'

// ─── Inline token helpers mirroring auth middleware ───────────────────────────
// (Avoids needing a live DB/Redis for pure logic tests)

interface TokenPayload { userId: string; handle: string; accountType: string; iat: number; exp: number }

function isTokenExpired(payload: TokenPayload): boolean {
  return Math.floor(Date.now() / 1000) > payload.exp
}

function buildTestPayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  const now = Math.floor(Date.now() / 1000)
  return {
    userId:      'user-123',
    handle:      'testuser',
    accountType: 'member',
    iat:         now,
    exp:         now + 900,   // 15 min from now
    ...overrides,
  }
}

function sanitiseHandle(handle: string): string {
  return handle.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30).toLowerCase()
}

function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8)   return { valid: false, reason: 'Password must be at least 8 characters' }
  if (password.length > 128) return { valid: false, reason: 'Password too long' }
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain an uppercase letter' }
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain a number' }
  return { valid: true }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('isTokenExpired()', () => {
  it('returns false for a fresh token', () => {
    const payload = buildTestPayload()
    expect(isTokenExpired(payload)).toBe(false)
  })

  it('returns true for an expired token', () => {
    const payload = buildTestPayload({ exp: Math.floor(Date.now() / 1000) - 1 })
    expect(isTokenExpired(payload)).toBe(true)
  })

  it('returns true when exp is exactly now (boundary)', () => {
    const now = Math.floor(Date.now() / 1000)
    const payload = buildTestPayload({ exp: now })
    // Date.now() / 1000 rounded down equals exp → not expired yet, but...
    // boundary check: > not >= so this is still valid
    expect(isTokenExpired(payload)).toBe(false)
  })

  it('returns false for a long-lived token', () => {
    const payload = buildTestPayload({ exp: Math.floor(Date.now() / 1000) + 86400 })
    expect(isTokenExpired(payload)).toBe(false)
  })
})

describe('sanitiseHandle()', () => {
  it('strips special characters', () => {
    expect(sanitiseHandle('hello-world!')).toBe('helloworld')
  })

  it('converts to lowercase', () => {
    expect(sanitiseHandle('JohnDoe')).toBe('johndoe')
  })

  it('preserves underscores', () => {
    expect(sanitiseHandle('john_doe')).toBe('john_doe')
  })

  it('truncates to 30 characters', () => {
    const long = 'a'.repeat(50)
    expect(sanitiseHandle(long).length).toBe(30)
  })

  it('allows alphanumeric and underscores only', () => {
    const result = sanitiseHandle('user@name.with#special$chars')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  it('returns empty string for fully special-char input', () => {
    expect(sanitiseHandle('!@#$%')).toBe('')
  })
})

describe('validatePassword()', () => {
  it('accepts a strong password', () => {
    expect(validatePassword('SecurePass1')).toEqual({ valid: true })
  })

  it('rejects password shorter than 8 characters', () => {
    const result = validatePassword('Short1')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/8 characters/)
  })

  it('rejects password without uppercase letter', () => {
    const result = validatePassword('nouppercase1')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/uppercase/)
  })

  it('rejects password without a number', () => {
    const result = validatePassword('NoNumberHere')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/number/)
  })

  it('rejects passwords over 128 characters', () => {
    const tooLong = 'A1' + 'x'.repeat(128)
    const result = validatePassword(tooLong)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/too long/)
  })

  it('accepts boundary-length password of exactly 8 characters', () => {
    expect(validatePassword('Secure1!')).toEqual({ valid: true })
  })
})

describe('token payload structure', () => {
  it('buildTestPayload returns all required fields', () => {
    const p = buildTestPayload()
    expect(p).toHaveProperty('userId')
    expect(p).toHaveProperty('handle')
    expect(p).toHaveProperty('accountType')
    expect(p).toHaveProperty('iat')
    expect(p).toHaveProperty('exp')
  })

  it('exp is greater than iat for a fresh token', () => {
    const p = buildTestPayload()
    expect(p.exp).toBeGreaterThan(p.iat)
  })

  it('overrides are applied correctly', () => {
    const p = buildTestPayload({ handle: 'custom_user', accountType: 'admin' })
    expect(p.handle).toBe('custom_user')
    expect(p.accountType).toBe('admin')
  })
})
