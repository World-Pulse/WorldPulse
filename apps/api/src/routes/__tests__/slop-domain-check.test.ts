/**
 * Tests for GET /api/v1/slop/check
 *
 * Tests domain extraction, verdict logic, AI farm detection, and warning generation.
 * All infra dependencies (DB, Redis) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../db/postgres', () => ({
  db: Object.assign(
    vi.fn(),
    {
      raw:   vi.fn(),
    },
  ),
}))

vi.mock('../../db/redis', () => ({
  redis: {
    get:   vi.fn(),
    setex: vi.fn(),
  },
}))

vi.mock('../../lib/slop-detector', () => ({
  slopDetector: { scoreSignal: vi.fn() },
}))

vi.mock('../../lib/ai-content-farms', () => ({
  KNOWN_AI_CONTENT_FARMS: [
    'dailytrendingnews.net',
    'thenewsglobe.net',
    'fakefarms.info',
  ],
}))

vi.mock('../../lib/api-keys', () => ({
  hashKey: vi.fn((k: string) => `hash:${k}`),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  extractDomainFromInput,
  computeDomainVerdict,
  computeAiFarmConfidence,
  buildDomainWarnings,
} from '../slop'

// ─── extractDomainFromInput ───────────────────────────────────────────────────

describe('extractDomainFromInput', () => {
  it('extracts domain from a full https URL', () => {
    expect(extractDomainFromInput('https://fakefarms.info/article/foo')).toBe('fakefarms.info')
  })

  it('extracts domain from a full http URL', () => {
    expect(extractDomainFromInput('http://example.com/path?q=1')).toBe('example.com')
  })

  it('strips www. prefix from URLs', () => {
    expect(extractDomainFromInput('https://www.bbc.com/news')).toBe('bbc.com')
  })

  it('accepts a bare domain without protocol', () => {
    expect(extractDomainFromInput('reuters.com')).toBe('reuters.com')
  })

  it('strips www. prefix from bare domains', () => {
    expect(extractDomainFromInput('www.example.com')).toBe('example.com')
  })

  it('accepts a bare domain with a path (uses only the host part)', () => {
    expect(extractDomainFromInput('example.com/some/path')).toBe('example.com')
  })

  it('returns null for a string with no dot', () => {
    expect(extractDomainFromInput('notadomain')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(extractDomainFromInput('')).toBeNull()
  })
})

// ─── computeDomainVerdict ─────────────────────────────────────────────────────

describe('computeDomainVerdict', () => {
  it('returns "unreliable" when domain is an AI farm', () => {
    expect(computeDomainVerdict(true, null)).toBe('unreliable')
  })

  it('returns "unreliable" when domain is an AI farm even with a good reliability score', () => {
    expect(computeDomainVerdict(true, 0.9)).toBe('unreliable')
  })

  it('returns "unreliable" when reliability_score < 0.4', () => {
    expect(computeDomainVerdict(false, 0.2)).toBe('unreliable')
  })

  it('returns "unreliable" when reliability_score is exactly 0', () => {
    expect(computeDomainVerdict(false, 0)).toBe('unreliable')
  })

  it('returns "caution" when reliability_score is 0.4 (boundary)', () => {
    expect(computeDomainVerdict(false, 0.4)).toBe('caution')
  })

  it('returns "caution" when reliability_score is between 0.4 and 0.65', () => {
    expect(computeDomainVerdict(false, 0.55)).toBe('caution')
  })

  it('returns "caution" when reliability_score is just below 0.65', () => {
    expect(computeDomainVerdict(false, 0.649)).toBe('caution')
  })

  it('returns "trusted" when reliability_score is exactly 0.65 (boundary)', () => {
    expect(computeDomainVerdict(false, 0.65)).toBe('trusted')
  })

  it('returns "trusted" when reliability_score >= 0.65', () => {
    expect(computeDomainVerdict(false, 0.9)).toBe('trusted')
  })

  it('returns "unknown" when not an AI farm and not in sources (null score)', () => {
    expect(computeDomainVerdict(false, null)).toBe('unknown')
  })
})

// ─── computeAiFarmConfidence ──────────────────────────────────────────────────

describe('computeAiFarmConfidence', () => {
  it('returns "confirmed" for a known AI farm', () => {
    expect(computeAiFarmConfidence(true, null)).toBe('confirmed')
  })

  it('returns "suspected" for non-farm domain with low reliability score', () => {
    expect(computeAiFarmConfidence(false, 0.3)).toBe('suspected')
  })

  it('returns "clean" for non-farm domain with acceptable score', () => {
    expect(computeAiFarmConfidence(false, 0.8)).toBe('clean')
  })

  it('returns "clean" for non-farm domain not in sources (null score)', () => {
    expect(computeAiFarmConfidence(false, null)).toBe('clean')
  })
})

// ─── buildDomainWarnings ──────────────────────────────────────────────────────

describe('buildDomainWarnings', () => {
  it('includes AI farm warnings when domain is a confirmed farm', () => {
    const warnings = buildDomainWarnings(true, null, 'fakefarms.info')
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('fakefarms.info')
    expect(warnings[1]).toContain('AI-generated')
  })

  it('includes low reliability score warning when score < 0.4', () => {
    const warnings = buildDomainWarnings(false, 0.25, 'bad-source.com')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('0.25')
  })

  it('includes caution warning when score is between 0.4 and 0.65', () => {
    const warnings = buildDomainWarnings(false, 0.5, 'ok-source.com')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('verify claims')
  })

  it('returns empty warnings array for a trusted domain', () => {
    const warnings = buildDomainWarnings(false, 0.9, 'reuters.com')
    expect(warnings).toHaveLength(0)
  })

  it('returns empty warnings array for unknown domain (null score, not farm)', () => {
    const warnings = buildDomainWarnings(false, null, 'unknown-domain.com')
    expect(warnings).toHaveLength(0)
  })

  it('accumulates both AI farm and low-score warnings for a farm with a known score', () => {
    const warnings = buildDomainWarnings(true, 0.1, 'fakefarms.info')
    // Farm warnings (2) + low score warning (1) = 3
    expect(warnings).toHaveLength(3)
  })
})
