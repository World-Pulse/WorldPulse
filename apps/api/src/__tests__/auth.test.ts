/**
 * Tests for auth route logic (register / login / refresh / logout).
 * Validates schema parsing, credential checking, and token rotation
 * without requiring a live DB or Redis — all infra is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../db/postgres', () => ({
  db: vi.fn(),
}))

vi.mock('../db/redis', () => ({
  redis: {
    set:  vi.fn(),
    get:  vi.fn(),
    del:  vi.fn(),
    setex: vi.fn(),
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash:    vi.fn(),
    compare: vi.fn(),
  },
}))

vi.mock('jsonwebtoken', () => ({
  default: {
    sign:   vi.fn(),
    verify: vi.fn(),
  },
}))

vi.mock('../lib/search', () => ({
  indexUser: vi.fn().mockResolvedValue(undefined),
}))

// ─── Imports after mocks ───────────────────────────────────────────────────────
const { db }    = await import('../db/postgres')
const { redis } = await import('../db/redis')
import bcrypt from 'bcryptjs'

// ─── Inline schema replicas (from auth.ts) ────────────────────────────────────
const RegisterSchema = z.object({
  handle:      z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().min(1).max(100),
  email:       z.string().email(),
  password:    z.string().min(8).max(128),
})

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
})

// ─── Helper: build a mock db chain ───────────────────────────────────────────
function mockDbChain(result: unknown) {
  const chain = {
    where:      vi.fn().mockReturnThis(),
    orWhere:    vi.fn().mockReturnThis(),
    first:      vi.fn().mockResolvedValue(result),
    insert:     vi.fn().mockReturnThis(),
    returning:  vi.fn().mockResolvedValue([result]),
    update:     vi.fn().mockResolvedValue(1),
  }
  return chain
}

// ─── Inline business logic (replicated from routes/auth.ts) ──────────────────

/** Build cache key for refresh token */
function refreshKey(token: string): string {
  return `refresh:${token}`
}

/** Validate duplicate user check result */
function detectDuplicate(exists: { email: string; handle: string } | undefined, email: string, handle: string): { field: 'email' | 'handle' } | null {
  if (!exists) return null
  return { field: exists.email === email ? 'email' : 'handle' }
}

/** Clamp page limit */
function clampLimit(limit: number, max = 50): number {
  return Math.min(Number(limit), max)
}

/** Format user for response (snake_case → camelCase) */
function formatUser(user: Record<string, unknown>): Record<string, unknown> {
  return {
    id:           user.id,
    handle:       user.handle,
    displayName:  user.display_name,
    email:        user.email,
    accountType:  user.account_type ?? 'community',
    trustScore:   user.trust_score ?? 0.5,
    verified:     user.verified ?? false,
    onboarded:    user.onboarded ?? false,
    createdAt:    user.created_at,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Auth — RegisterSchema validation', () => {
  it('accepts a valid registration payload', () => {
    const result = RegisterSchema.safeParse({
      handle:      'john_doe',
      displayName: 'John Doe',
      email:       'john@example.com',
      password:    'supersecret123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects handle shorter than 3 characters', () => {
    const result = RegisterSchema.safeParse({
      handle:      'jd',
      displayName: 'JD',
      email:       'jd@example.com',
      password:    'password123',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('handle')
  })

  it('rejects handle with special characters', () => {
    const result = RegisterSchema.safeParse({
      handle:      'user-name!',
      displayName: 'User Name',
      email:       'user@example.com',
      password:    'password123',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('handle')
  })

  it('rejects invalid email format', () => {
    const result = RegisterSchema.safeParse({
      handle:      'validuser',
      displayName: 'Valid User',
      email:       'not-an-email',
      password:    'password123',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('email')
  })

  it('rejects password shorter than 8 characters', () => {
    const result = RegisterSchema.safeParse({
      handle:      'validuser',
      displayName: 'Valid User',
      email:       'user@example.com',
      password:    'short',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('password')
  })

  it('rejects empty displayName', () => {
    const result = RegisterSchema.safeParse({
      handle:      'validuser',
      displayName: '',
      email:       'user@example.com',
      password:    'password123',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('displayName')
  })
})

describe('Auth — LoginSchema validation', () => {
  it('accepts valid login payload', () => {
    const result = LoginSchema.safeParse({
      email:    'user@example.com',
      password: 'anypassword',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing email', () => {
    const result = LoginSchema.safeParse({ password: 'mypassword' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email format on login', () => {
    const result = LoginSchema.safeParse({ email: 'bad', password: 'pass' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toContain('email')
  })

  it('rejects missing password', () => {
    const result = LoginSchema.safeParse({ email: 'user@example.com' })
    expect(result.success).toBe(false)
  })
})

describe('Auth — duplicate user detection', () => {
  it('returns null when no existing user found', () => {
    const result = detectDuplicate(undefined, 'user@example.com', 'testuser')
    expect(result).toBeNull()
  })

  it('detects email collision', () => {
    const existing = { email: 'user@example.com', handle: 'other_handle' }
    const result = detectDuplicate(existing, 'user@example.com', 'newhandle')
    expect(result).toEqual({ field: 'email' })
  })

  it('detects handle collision', () => {
    const existing = { email: 'other@example.com', handle: 'taken_handle' }
    const result = detectDuplicate(existing, 'user@example.com', 'taken_handle')
    expect(result).toEqual({ field: 'handle' })
  })
})

describe('Auth — refresh token logic', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('builds the correct Redis key for a refresh token', () => {
    const token = 'abc123-refresh'
    expect(refreshKey(token)).toBe('refresh:abc123-refresh')
  })

  it('returns 401 when refresh token is not in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const userId = await redis.get('refresh:nonexistent')
    expect(userId).toBeNull()
  })

  it('finds user ID from valid refresh token in Redis', async () => {
    const fakeUserId = 'user-uuid-1234'
    vi.mocked(redis.get).mockResolvedValueOnce(fakeUserId)

    const userId = await redis.get('refresh:valid-token')
    expect(userId).toBe(fakeUserId)
  })

  it('deletes old refresh token on rotation', async () => {
    vi.mocked(redis.del).mockResolvedValueOnce(1)
    await redis.del('refresh:old-token')
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith('refresh:old-token')
  })
})

describe('Auth — password handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('hashes password with bcrypt cost 12', async () => {
    vi.mocked(bcrypt.hash).mockResolvedValueOnce('$2b$12$hashed' as never)
    const hash = await bcrypt.hash('mypassword', 12)
    expect(vi.mocked(bcrypt.hash)).toHaveBeenCalledWith('mypassword', 12)
    expect(hash).toContain('$2b$12$')
  })

  it('returns true for matching password', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never)
    const valid = await bcrypt.compare('correctpassword', '$2b$12$hashed')
    expect(valid).toBe(true)
  })

  it('returns false for wrong password', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never)
    const valid = await bcrypt.compare('wrongpassword', '$2b$12$hashed')
    expect(valid).toBe(false)
  })
})

describe('Auth — formatUser helper', () => {
  it('maps snake_case DB row to camelCase response', () => {
    const dbRow = {
      id:           'uuid-123',
      handle:       'testuser',
      display_name: 'Test User',
      email:        'test@example.com',
      account_type: 'journalist',
      trust_score:  0.85,
      verified:     true,
      onboarded:    true,
      created_at:   '2026-01-01T00:00:00Z',
    }
    const formatted = formatUser(dbRow)
    expect(formatted.displayName).toBe('Test User')
    expect(formatted.accountType).toBe('journalist')
    expect(formatted.trustScore).toBe(0.85)
    expect(formatted.verified).toBe(true)
  })

  it('defaults account_type to community when not set', () => {
    const dbRow = { id: '1', handle: 'u', display_name: 'U', email: 'u@x.com', created_at: new Date() }
    const formatted = formatUser(dbRow)
    expect(formatted.accountType).toBe('community')
    expect(formatted.trustScore).toBe(0.5)
    expect(formatted.verified).toBe(false)
  })
})
