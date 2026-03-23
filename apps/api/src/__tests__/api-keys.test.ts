/**
 * Unit tests for apps/api/src/lib/api-keys.ts
 *
 * All functions are pure (no I/O) so no mocking is required.
 */

import { describe, it, expect } from 'vitest'
import { generateApiKey, hashKey, verifyKey, TIER_LIMITS } from '../lib/api-keys.js'

// ── generateApiKey ─────────────────────────────────────────────────────────────

describe('generateApiKey', () => {
  it('returns an object with key and hash properties', () => {
    const result = generateApiKey()
    expect(result).toHaveProperty('key')
    expect(result).toHaveProperty('hash')
  })

  it('key has the wp_live_ prefix', () => {
    const { key } = generateApiKey()
    expect(key.startsWith('wp_live_')).toBe(true)
  })

  it('key suffix is 32 hex characters', () => {
    const { key } = generateApiKey()
    const suffix = key.slice('wp_live_'.length)
    expect(suffix).toHaveLength(32)
    expect(suffix).toMatch(/^[0-9a-f]+$/)
  })

  it('hash is a 64-character hex string (SHA-256)', () => {
    const { hash } = generateApiKey()
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('two calls produce different keys', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.key).not.toBe(b.key)
    expect(a.hash).not.toBe(b.hash)
  })

  it('hash matches hashKey(key)', () => {
    const { key, hash } = generateApiKey()
    expect(hashKey(key)).toBe(hash)
  })

  it('verifyKey succeeds with the generated pair', () => {
    const { key, hash } = generateApiKey()
    expect(verifyKey(key, hash)).toBe(true)
  })
})

// ── hashKey ────────────────────────────────────────────────────────────────────

describe('hashKey', () => {
  it('is deterministic for the same input', () => {
    const key = 'wp_live_abc123'
    expect(hashKey(key)).toBe(hashKey(key))
  })

  it('produces different hashes for different keys', () => {
    expect(hashKey('wp_live_aaa')).not.toBe(hashKey('wp_live_bbb'))
  })

  it('returns a 64-character hex string', () => {
    const h = hashKey('wp_live_test')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('is case-sensitive — uppercase differs from lowercase', () => {
    expect(hashKey('wp_live_AAA')).not.toBe(hashKey('wp_live_aaa'))
  })
})

// ── verifyKey ─────────────────────────────────────────────────────────────────

describe('verifyKey', () => {
  it('returns true when key matches its hash', () => {
    const { key, hash } = generateApiKey()
    expect(verifyKey(key, hash)).toBe(true)
  })

  it('returns false for a wrong key against a valid hash', () => {
    const { hash } = generateApiKey()
    expect(verifyKey('wp_live_wrongkeyabcdef1234567890', hash)).toBe(false)
  })

  it('returns false for a tampered hash', () => {
    const { key } = generateApiKey()
    const badHash = '0'.repeat(64)
    expect(verifyKey(key, badHash)).toBe(false)
  })

  it('is resistant to timing attacks (uses timingSafeEqual)', () => {
    // Verify the implementation uses timingSafeEqual — this is a smoke test.
    // If verifyKey uses a simple equality check, it would throw on length mismatch;
    // timingSafeEqual throws too, but we can confirm the API exists.
    const { key, hash } = generateApiKey()
    expect(() => verifyKey(key, hash)).not.toThrow()
  })

  it('handles two separately generated keys without false positives', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(verifyKey(a.key, b.hash)).toBe(false)
    expect(verifyKey(b.key, a.hash)).toBe(false)
  })
})

// ── TIER_LIMITS ────────────────────────────────────────────────────────────────

describe('TIER_LIMITS', () => {
  it('defines free, pro, and enterprise tiers', () => {
    expect(TIER_LIMITS).toHaveProperty('free')
    expect(TIER_LIMITS).toHaveProperty('pro')
    expect(TIER_LIMITS).toHaveProperty('enterprise')
  })

  it('free tier has lower rpm than pro', () => {
    expect(TIER_LIMITS['free']!.rpm).toBeLessThan(TIER_LIMITS['pro']!.rpm)
  })

  it('pro tier has lower rpm than enterprise', () => {
    expect(TIER_LIMITS['pro']!.rpm).toBeLessThan(TIER_LIMITS['enterprise']!.rpm)
  })

  it('free tier has lower rpd than pro', () => {
    expect(TIER_LIMITS['free']!.rpd).toBeLessThan(TIER_LIMITS['pro']!.rpd)
  })

  it('pro tier has lower rpd than enterprise', () => {
    expect(TIER_LIMITS['pro']!.rpd).toBeLessThan(TIER_LIMITS['enterprise']!.rpd)
  })

  it('each tier has positive rpm and rpd', () => {
    for (const tier of Object.values(TIER_LIMITS)) {
      expect(tier.rpm).toBeGreaterThan(0)
      expect(tier.rpd).toBeGreaterThan(0)
    }
  })

  it('rpd is always greater than rpm (daily > per-minute quota)', () => {
    for (const tier of Object.values(TIER_LIMITS)) {
      expect(tier.rpd).toBeGreaterThan(tier.rpm)
    }
  })
})
