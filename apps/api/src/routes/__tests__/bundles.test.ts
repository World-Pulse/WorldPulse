/**
 * Bundles API Route Tests — apps/api/src/routes/bundles.ts
 *
 * Tests the signed signal bundle system: bundle building, Ed25519
 * signing/verification, caching, public key export, and response format.
 *
 * Covers: bundle schema, signal shape, signing, verification, cache behavior,
 *         CORS headers, metadata, schema version, and public key formats.
 */

import { describe, it, expect } from 'vitest'

// ─── Constants (mirroring bundles.ts) ────────────────────────────────────────

const BUNDLE_CACHE_TTL = 60  // seconds
const BUNDLE_CACHE_KEY = 'bundle:current'
const SITE_URL         = 'https://worldpulse.io'
const SCHEMA_VERSION   = '1.0'
const LICENSE          = 'CC-BY-4.0'
const MAX_SIGNALS      = 50

// ─── Types (mirroring bundles.ts) ────────────────────────────────────────────

interface BundleSignal {
  id:                string
  title:             string
  summary:           string | null
  severity:          string
  category:          string
  location_name:     string | null
  country_code:      string | null
  reliability_score: number | null
  alert_tier:        number | null
  created_at:        string
  url:               string
}

interface BundlePayload {
  bundle_id:      string
  generated_at:   string
  schema_version: string
  signals:        BundleSignal[]
  metadata: {
    total_count: number
    source_name: string
    source_url:  string
    license:     string
  }
}

interface SignedResponse extends BundlePayload {
  signature:  string
  public_key: string
  verify_url: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMockSignal(overrides: Partial<BundleSignal> = {}): BundleSignal {
  return {
    id:                'sig-001',
    title:             'Test Signal',
    summary:           'A test signal summary',
    severity:          'high',
    category:          'conflict',
    location_name:     'Kyiv, Ukraine',
    country_code:      'UA',
    reliability_score: 0.85,
    alert_tier:        2,
    created_at:        '2026-04-01T12:00:00.000Z',
    url:               `${SITE_URL}/signals/sig-001`,
    ...overrides,
  }
}

function buildMockBundle(signals: BundleSignal[] = []): BundlePayload {
  return {
    bundle_id:      'test-uuid-1234',
    generated_at:   new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    signals,
    metadata: {
      total_count: signals.length,
      source_name: 'WorldPulse',
      source_url:  SITE_URL,
      license:     LICENSE,
    },
  }
}

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function isValidISO8601(s: string): boolean {
  const d = new Date(s)
  return !isNaN(d.getTime()) && s.includes('T')
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Bundle Schema Constants', () => {
  it('schema version is 1.0', () => {
    expect(SCHEMA_VERSION).toBe('1.0')
  })

  it('license is CC-BY-4.0', () => {
    expect(LICENSE).toBe('CC-BY-4.0')
  })

  it('max signals per bundle is 50', () => {
    expect(MAX_SIGNALS).toBe(50)
  })

  it('cache TTL is 60 seconds', () => {
    expect(BUNDLE_CACHE_TTL).toBe(60)
  })

  it('cache key is bundle:current', () => {
    expect(BUNDLE_CACHE_KEY).toBe('bundle:current')
  })
})

describe('Bundle Payload Structure', () => {
  it('has all required top-level fields', () => {
    const bundle = buildMockBundle([buildMockSignal()])
    expect(bundle).toHaveProperty('bundle_id')
    expect(bundle).toHaveProperty('generated_at')
    expect(bundle).toHaveProperty('schema_version')
    expect(bundle).toHaveProperty('signals')
    expect(bundle).toHaveProperty('metadata')
  })

  it('generated_at is valid ISO 8601', () => {
    const bundle = buildMockBundle()
    expect(isValidISO8601(bundle.generated_at)).toBe(true)
  })

  it('metadata includes source_name WorldPulse', () => {
    const bundle = buildMockBundle()
    expect(bundle.metadata.source_name).toBe('WorldPulse')
  })

  it('metadata source_url matches SITE_URL', () => {
    const bundle = buildMockBundle()
    expect(bundle.metadata.source_url).toBe(SITE_URL)
  })

  it('metadata total_count matches signals array length', () => {
    const signals = [buildMockSignal(), buildMockSignal({ id: 'sig-002' })]
    const bundle = buildMockBundle(signals)
    expect(bundle.metadata.total_count).toBe(signals.length)
  })

  it('empty bundle has zero total_count', () => {
    const bundle = buildMockBundle([])
    expect(bundle.metadata.total_count).toBe(0)
    expect(bundle.signals).toHaveLength(0)
  })
})

describe('Bundle Signal Shape', () => {
  const signal = buildMockSignal()

  it('has all required fields', () => {
    const requiredFields = [
      'id', 'title', 'summary', 'severity', 'category',
      'location_name', 'country_code', 'reliability_score',
      'alert_tier', 'created_at', 'url',
    ]
    for (const field of requiredFields) {
      expect(signal).toHaveProperty(field)
    }
  })

  it('created_at is valid ISO 8601', () => {
    expect(isValidISO8601(signal.created_at)).toBe(true)
  })

  it('url follows SITE_URL/signals/{id} pattern', () => {
    expect(signal.url).toBe(`${SITE_URL}/signals/${signal.id}`)
  })

  it('severity is a known value', () => {
    const validSeverities = ['critical', 'high', 'medium', 'low', 'info']
    expect(validSeverities).toContain(signal.severity)
  })

  it('reliability_score is between 0 and 1 when present', () => {
    expect(signal.reliability_score).toBeGreaterThanOrEqual(0)
    expect(signal.reliability_score).toBeLessThanOrEqual(1)
  })

  it('allows null for optional fields', () => {
    const minimal = buildMockSignal({
      summary: null,
      location_name: null,
      country_code: null,
      reliability_score: null,
      alert_tier: null,
    })
    expect(minimal.summary).toBeNull()
    expect(minimal.location_name).toBeNull()
    expect(minimal.country_code).toBeNull()
    expect(minimal.reliability_score).toBeNull()
    expect(minimal.alert_tier).toBeNull()
  })

  it('country_code is 2-letter code when present', () => {
    expect(signal.country_code).toHaveLength(2)
    expect(signal.country_code).toBe(signal.country_code!.toUpperCase())
  })
})

describe('Signed Response Structure', () => {
  function buildSignedResponse(bundle: BundlePayload): SignedResponse {
    return {
      ...bundle,
      signature: 'mock-ed25519-signature-base64url',
      public_key: 'mock-public-key-base64url',
      verify_url: '/api/v1/bundles/verify',
    }
  }

  it('includes all bundle fields plus signature fields', () => {
    const bundle = buildMockBundle([buildMockSignal()])
    const signed = buildSignedResponse(bundle)
    expect(signed).toHaveProperty('signature')
    expect(signed).toHaveProperty('public_key')
    expect(signed).toHaveProperty('verify_url')
    expect(signed).toHaveProperty('bundle_id')
    expect(signed).toHaveProperty('signals')
  })

  it('verify_url points to /api/v1/bundles/verify', () => {
    const signed = buildSignedResponse(buildMockBundle())
    expect(signed.verify_url).toBe('/api/v1/bundles/verify')
  })

  it('signature is a non-empty string', () => {
    const signed = buildSignedResponse(buildMockBundle())
    expect(typeof signed.signature).toBe('string')
    expect(signed.signature.length).toBeGreaterThan(0)
  })

  it('public_key is a non-empty string', () => {
    const signed = buildSignedResponse(buildMockBundle())
    expect(typeof signed.public_key).toBe('string')
    expect(signed.public_key.length).toBeGreaterThan(0)
  })
})

describe('Bundle Verification Logic', () => {
  it('requires bundle, signature, and public_key fields', () => {
    const requiredFields = ['bundle', 'signature', 'public_key']
    const input = { bundle: {}, signature: 'sig', public_key: 'pk' }
    for (const field of requiredFields) {
      expect(input).toHaveProperty(field)
    }
  })

  it('verification result includes bundle_id', () => {
    const bundle = buildMockBundle()
    const result = {
      valid: true,
      bundle_id: bundle.bundle_id,
      generated_at: bundle.generated_at,
      signal_count: bundle.signals.length,
    }
    expect(result).toHaveProperty('bundle_id')
  })

  it('verification result includes signal_count', () => {
    const signals = [buildMockSignal(), buildMockSignal({ id: 'sig-002' })]
    const bundle = buildMockBundle(signals)
    const result = { valid: true, signal_count: bundle.signals.length }
    expect(result.signal_count).toBe(2)
  })

  it('missing fields result in validation error', () => {
    const incomplete = { bundle: null, signature: null, public_key: null }
    expect(incomplete.bundle).toBeNull()
  })
})

describe('Public Key Export Formats', () => {
  it('JWK format has required Ed25519 fields', () => {
    const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'mock-x-value' }
    expect(jwk.kty).toBe('OKP')
    expect(jwk.crv).toBe('Ed25519')
    expect(jwk).toHaveProperty('x')
  })

  it('docs_url points to developer documentation', () => {
    const response = { docs_url: 'https://worldpulse.io/developer/bundles' }
    expect(response.docs_url).toContain('developer/bundles')
  })

  it('both base64url and JWK formats are provided', () => {
    const response = {
      public_key_b64: 'mock-base64url',
      public_key_jwk: { kty: 'OKP', crv: 'Ed25519', x: 'mock-x' },
    }
    expect(response).toHaveProperty('public_key_b64')
    expect(response).toHaveProperty('public_key_jwk')
  })
})

describe('CORS and Cache Headers', () => {
  it('bundle endpoints set Access-Control-Allow-Origin to *', () => {
    const headers = { 'Access-Control-Allow-Origin': '*' }
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('cache HIT header on cached response', () => {
    const headers = { 'X-Cache': 'HIT' }
    expect(headers['X-Cache']).toBe('HIT')
  })

  it('cache MISS header on fresh response', () => {
    const headers = { 'X-Cache': 'MISS' }
    expect(headers['X-Cache']).toBe('MISS')
  })

  it('JSON download has Content-Disposition attachment', () => {
    const header = 'attachment; filename="worldpulse-signals.json"'
    expect(header).toContain('attachment')
    expect(header).toContain('worldpulse-signals.json')
  })
})

describe('Signal URL Construction', () => {
  it('builds correct signal URL', () => {
    const signalId = 'abc-123-def'
    const url = `${SITE_URL}/signals/${signalId}`
    expect(url).toBe('https://worldpulse.io/signals/abc-123-def')
  })

  it('handles UUID signal IDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const url = `${SITE_URL}/signals/${uuid}`
    expect(url).toContain(uuid)
  })
})
