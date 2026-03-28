import { describe, it, expect } from 'vitest'
import {
  generateKeyPair,
  signBundle,
  verifyBundle,
  publicKeyToRawBytes,
} from '../lib/source-pack'

// ─── generateKeyPair ─────────────────────────────────────────────────────────

describe('generateKeyPair()', () => {
  it('returns an object with privateKey and publicKey strings', () => {
    const kp = generateKeyPair()
    expect(typeof kp.privateKey).toBe('string')
    expect(typeof kp.publicKey).toBe('string')
    expect(kp.privateKey.length).toBeGreaterThan(0)
    expect(kp.publicKey.length).toBeGreaterThan(0)
  })

  it('produces base64url-encoded keys (no +, /, or = padding)', () => {
    const { privateKey, publicKey } = generateKeyPair()
    const b64urlPattern = /^[A-Za-z0-9_-]+$/
    expect(b64urlPattern.test(privateKey)).toBe(true)
    expect(b64urlPattern.test(publicKey)).toBe(true)
  })

  it('generates unique key pairs on each call', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    expect(kp1.privateKey).not.toBe(kp2.privateKey)
    expect(kp1.publicKey).not.toBe(kp2.publicKey)
  })
})

// ─── signBundle ──────────────────────────────────────────────────────────────

describe('signBundle()', () => {
  it('returns a non-empty base64url string', () => {
    const { privateKey } = generateKeyPair()
    const sig = signBundle({ hello: 'world' }, privateKey)
    expect(typeof sig).toBe('string')
    expect(sig.length).toBeGreaterThan(0)
  })

  it('produces base64url output (no +, /, or = padding)', () => {
    const { privateKey } = generateKeyPair()
    const sig = signBundle({ test: true }, privateKey)
    expect(/^[A-Za-z0-9_-]+$/.test(sig)).toBe(true)
  })

  it('produces an 86-character signature (64 bytes → base64url)', () => {
    // 64 bytes → ceil(64 * 4/3) = 86 chars (no padding)
    const { privateKey } = generateKeyPair()
    const sig = signBundle({ x: 1 }, privateKey)
    expect(sig.length).toBe(86)
  })
})

// ─── verifyBundle ─────────────────────────────────────────────────────────────

describe('verifyBundle()', () => {
  it('returns true for a valid signature', () => {
    const { privateKey, publicKey } = generateKeyPair()
    const payload = { bundle_id: 'abc', signals: [] }
    const sig = signBundle(payload, privateKey)
    expect(verifyBundle(payload, sig, publicKey)).toBe(true)
  })

  it('returns false for a tampered payload', () => {
    const { privateKey, publicKey } = generateKeyPair()
    const payload = { bundle_id: 'abc', signals: [] }
    const sig = signBundle(payload, privateKey)
    const tampered = { ...payload, bundle_id: 'tampered' }
    expect(verifyBundle(tampered, sig, publicKey)).toBe(false)
  })

  it('returns false for a wrong public key', () => {
    const { privateKey } = generateKeyPair()
    const { publicKey: wrongPublicKey } = generateKeyPair()
    const payload = { data: 42 }
    const sig = signBundle(payload, privateKey)
    expect(verifyBundle(payload, sig, wrongPublicKey)).toBe(false)
  })

  it('returns false for a corrupted signature', () => {
    const { privateKey, publicKey } = generateKeyPair()
    const payload = { hello: 'world' }
    const sig = signBundle(payload, privateKey)
    const corrupted = sig.slice(0, -4) + 'AAAA'
    // May or may not throw — verifyBundle must return false, not throw
    expect(verifyBundle(payload, corrupted, publicKey)).toBe(false)
  })

  it('returns false for an empty signature string', () => {
    const { privateKey, publicKey } = generateKeyPair()
    const payload = { hello: 'world' }
    signBundle(payload, privateKey)
    expect(verifyBundle(payload, '', publicKey)).toBe(false)
  })
})

// ─── Round-trip tests ─────────────────────────────────────────────────────────

describe('generate → sign → verify round-trip', () => {
  const cases: [string, unknown][] = [
    ['empty object',  {}],
    ['string value',  { msg: 'hello worldpulse' }],
    ['numeric value', { score: 0.987, tier: 3 }],
    ['nested array',  { signals: [{ id: '1', title: 'Test' }] }],
    ['unicode',       { title: '🌍 Global alert — тест' }],
  ]

  cases.forEach(([label, payload]) => {
    it(`round-trip: ${label}`, () => {
      const { privateKey, publicKey } = generateKeyPair()
      const sig = signBundle(payload, privateKey)
      expect(verifyBundle(payload, sig, publicKey)).toBe(true)
    })
  })
})

// ─── publicKeyToRawBytes ──────────────────────────────────────────────────────

describe('publicKeyToRawBytes()', () => {
  it('extracts exactly 32 raw bytes from an Ed25519 SPKI public key', () => {
    const { publicKey } = generateKeyPair()
    const raw = publicKeyToRawBytes(publicKey)
    expect(raw.length).toBe(32)
  })

  it('can be used as JWK x field (base64url, 43 chars)', () => {
    const { publicKey } = generateKeyPair()
    const raw = publicKeyToRawBytes(publicKey)
    const x = raw.toString('base64url')
    // 32 bytes → 43 base64url chars (no padding)
    expect(x.length).toBe(43)
    expect(/^[A-Za-z0-9_-]+$/.test(x)).toBe(true)
  })
})
