/**
 * Tests for VerificationBadge pure helpers.
 * These functions live in apps/web/src/components/signals/VerificationBadge.tsx
 * but are tested here alongside the API layer to keep all unit tests co-located.
 * We inline the logic so the test file has no build dependencies.
 */

import { describe, it, expect } from 'vitest'

// ─── Inline the pure functions under test (mirrors VerificationBadge.tsx) ─────

type VerificationStatus = 'verified' | 'partial' | 'unverified' | 'disputed'

interface VerificationEntry {
  check_type: string
  result:     string
  confidence: number
}

const POSITIVE_RESULTS = new Set(['confirmed', 'pass', 'verified'])
const NEGATIVE_RESULTS = new Set(['refuted', 'fail', 'failed', 'disputed'])

function getVerificationScore(entries: VerificationEntry[]): number {
  if (entries.length === 0) return 0
  const weightedSum = entries.reduce((sum, e) => {
    const r = e.result.toLowerCase()
    const c = Math.max(0, Math.min(1, e.confidence))
    if (POSITIVE_RESULTS.has(r)) return sum + c
    if (NEGATIVE_RESULTS.has(r)) return sum - c
    return sum + (c > 0.6 ? c * 0.25 : 0)
  }, 0)
  return Math.max(0, Math.min(1, weightedSum / entries.length))
}

function computeVerificationStatusFromLog(entries: VerificationEntry[]): VerificationStatus {
  if (entries.length === 0) return 'unverified'
  const hasDisputed = entries.some(e => NEGATIVE_RESULTS.has(e.result.toLowerCase()))
  if (hasDisputed) return 'disputed'
  const score = getVerificationScore(entries)
  if (score >= 0.8) return 'verified'
  if (score >= 0.4) return 'partial'
  return 'unverified'
}

function computeVerificationStatus(
  signalStatus: string | undefined | null,
  reliabilityScore: number | undefined | null,
): VerificationStatus {
  const s = (signalStatus ?? '').toLowerCase()
  if (s === 'disputed' || s === 'false' || s === 'retracted') return 'disputed'
  if (s === 'verified') return 'verified'
  const r = reliabilityScore ?? 0
  if (r >= 0.75) return 'verified'
  if (r >= 0.40) return 'partial'
  return 'unverified'
}

interface BadgeConfig { label: string; icon: string; bg: string; border: string; color: string }

function getVerificationBadgeConfig(status: VerificationStatus): BadgeConfig {
  switch (status) {
    case 'verified':   return { label: 'VERIFIED',   icon: '✓', bg: 'rgba(0,230,118,0.12)',   border: 'rgba(0,230,118,0.35)',   color: '#00e676' }
    case 'partial':    return { label: 'PARTIAL',    icon: '◑', bg: 'rgba(245,166,35,0.12)',  border: 'rgba(245,166,35,0.35)',  color: '#f5a623' }
    case 'disputed':   return { label: 'DISPUTED',   icon: '✕', bg: 'rgba(255,59,92,0.12)',   border: 'rgba(255,59,92,0.35)',   color: '#ff3b5c' }
    case 'unverified': return { label: 'UNVERIFIED', icon: '○', bg: 'rgba(136,146,164,0.10)', border: 'rgba(136,146,164,0.25)', color: '#8892a4' }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getVerificationScore', () => {
  it('returns 0 for empty entries', () => {
    expect(getVerificationScore([])).toBe(0)
  })

  it('returns 1.0 for single confirmed at full confidence', () => {
    const entries: VerificationEntry[] = [{ check_type: 'ai', result: 'confirmed', confidence: 1.0 }]
    expect(getVerificationScore(entries)).toBe(1.0)
  })

  it('returns 0 for single refuted at full confidence', () => {
    const entries: VerificationEntry[] = [{ check_type: 'ai', result: 'refuted', confidence: 1.0 }]
    expect(getVerificationScore(entries)).toBe(0)
  })

  it('averages multiple positive results', () => {
    const entries: VerificationEntry[] = [
      { check_type: 'ai',     result: 'confirmed', confidence: 0.9 },
      { check_type: 'source', result: 'pass',      confidence: 0.8 },
    ]
    const score = getVerificationScore(entries)
    expect(score).toBeGreaterThan(0.8)
    expect(score).toBeLessThanOrEqual(1.0)
  })

  it('clamps confidence values above 1 to 1', () => {
    const entries: VerificationEntry[] = [{ check_type: 'ai', result: 'verified', confidence: 2.5 }]
    expect(getVerificationScore(entries)).toBe(1.0)
  })

  it('clamps confidence values below 0 to 0', () => {
    const entries: VerificationEntry[] = [{ check_type: 'ai', result: 'verified', confidence: -0.5 }]
    expect(getVerificationScore(entries)).toBe(0)
  })

  it('treats "pass" as positive result', () => {
    const entries: VerificationEntry[] = [{ check_type: 'source', result: 'pass', confidence: 1.0 }]
    expect(getVerificationScore(entries)).toBe(1.0)
  })

  it('treats "failed" as negative result (aliased)', () => {
    const entries: VerificationEntry[] = [{ check_type: 'ai', result: 'failed', confidence: 1.0 }]
    expect(getVerificationScore(entries)).toBe(0)
  })

  it('neutral result with high confidence yields small positive contribution', () => {
    const entries: VerificationEntry[] = [{ check_type: 'ai', result: 'pending', confidence: 0.9 }]
    const score = getVerificationScore(entries)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.5)
  })
})

describe('computeVerificationStatusFromLog', () => {
  it('returns unverified for empty log', () => {
    expect(computeVerificationStatusFromLog([])).toBe('unverified')
  })

  it('returns verified when all entries confirmed at high confidence', () => {
    const entries: VerificationEntry[] = [
      { check_type: 'ai',     result: 'confirmed', confidence: 0.95 },
      { check_type: 'source', result: 'verified',  confidence: 0.90 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('verified')
  })

  it('returns disputed when any entry has refuted result', () => {
    const entries: VerificationEntry[] = [
      { check_type: 'ai',     result: 'confirmed', confidence: 0.95 },
      { check_type: 'source', result: 'refuted',   confidence: 0.80 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('disputed')
  })

  it('returns disputed for "fail" result', () => {
    const entries: VerificationEntry[] = [{ check_type: 'ai', result: 'fail', confidence: 0.9 }]
    expect(computeVerificationStatusFromLog(entries)).toBe('disputed')
  })

  it('returns partial when score is between 0.4 and 0.8', () => {
    // confirmed@0.9 + pending@0.1 (no neutral bonus) → avg = 0.9/2 = 0.45 → partial
    const entries: VerificationEntry[] = [
      { check_type: 'ai',     result: 'confirmed', confidence: 0.9 },
      { check_type: 'source', result: 'pending',   confidence: 0.1 },
    ]
    const score = getVerificationScore(entries)
    expect(score).toBeGreaterThanOrEqual(0.4)
    expect(score).toBeLessThan(0.8)
    expect(computeVerificationStatusFromLog(entries)).toBe('partial')
  })

  it('returns unverified when score is below 0.4', () => {
    const entries: VerificationEntry[] = [
      { check_type: 'ai', result: 'pending', confidence: 0.1 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('unverified')
  })
})

describe('computeVerificationStatus (from signal-level fields)', () => {
  it('returns verified for status=verified regardless of score', () => {
    expect(computeVerificationStatus('verified', 0.1)).toBe('verified')
  })

  it('returns disputed for status=disputed', () => {
    expect(computeVerificationStatus('disputed', 0.9)).toBe('disputed')
  })

  it('returns disputed for status=false', () => {
    expect(computeVerificationStatus('false', 0.8)).toBe('disputed')
  })

  it('returns disputed for status=retracted', () => {
    expect(computeVerificationStatus('retracted', 0.8)).toBe('disputed')
  })

  it('returns verified for high reliabilityScore without explicit status', () => {
    expect(computeVerificationStatus(null, 0.85)).toBe('verified')
  })

  it('returns verified at exactly 0.75 threshold', () => {
    expect(computeVerificationStatus(null, 0.75)).toBe('verified')
  })

  it('returns partial for score between 0.40 and 0.74', () => {
    expect(computeVerificationStatus(null, 0.5)).toBe('partial')
  })

  it('returns unverified for score below 0.40', () => {
    expect(computeVerificationStatus(null, 0.3)).toBe('unverified')
  })

  it('returns unverified when both fields are null', () => {
    expect(computeVerificationStatus(null, null)).toBe('unverified')
  })

  it('returns unverified for pending status with low reliability', () => {
    expect(computeVerificationStatus('pending', 0.2)).toBe('unverified')
  })

  it('is case-insensitive for status strings', () => {
    expect(computeVerificationStatus('VERIFIED', 0.1)).toBe('verified')
    expect(computeVerificationStatus('DISPUTED', 0.9)).toBe('disputed')
  })
})

describe('getVerificationBadgeConfig', () => {
  it('verified returns green color and ✓ icon', () => {
    const cfg = getVerificationBadgeConfig('verified')
    expect(cfg.color).toBe('#00e676')
    expect(cfg.icon).toBe('✓')
    expect(cfg.label).toBe('VERIFIED')
  })

  it('partial returns amber color and ◑ icon', () => {
    const cfg = getVerificationBadgeConfig('partial')
    expect(cfg.color).toBe('#f5a623')
    expect(cfg.icon).toBe('◑')
    expect(cfg.label).toBe('PARTIAL')
  })

  it('disputed returns red color and ✕ icon', () => {
    const cfg = getVerificationBadgeConfig('disputed')
    expect(cfg.color).toBe('#ff3b5c')
    expect(cfg.icon).toBe('✕')
    expect(cfg.label).toBe('DISPUTED')
  })

  it('unverified returns muted color and ○ icon', () => {
    const cfg = getVerificationBadgeConfig('unverified')
    expect(cfg.color).toBe('#8892a4')
    expect(cfg.icon).toBe('○')
    expect(cfg.label).toBe('UNVERIFIED')
  })

  it('all statuses have bg, border, color, icon, label', () => {
    const statuses: VerificationStatus[] = ['verified', 'partial', 'unverified', 'disputed']
    for (const s of statuses) {
      const cfg = getVerificationBadgeConfig(s)
      expect(cfg.bg).toBeTruthy()
      expect(cfg.border).toBeTruthy()
      expect(cfg.color).toBeTruthy()
      expect(cfg.icon).toBeTruthy()
      expect(cfg.label).toBeTruthy()
    }
  })
})

describe('status boundary values', () => {
  it('score of exactly 0.8 maps to verified', () => {
    const entries: VerificationEntry[] = [
      { check_type: 'ai', result: 'confirmed', confidence: 0.8 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('verified')
  })

  it('score of exactly 0.4 maps to partial', () => {
    // We need exactly 0.4 score — single neutral entry at 0 won't give 0.4.
    // Use: 2 confirmed at 0.4 each = avg 0.4 → partial
    const entries: VerificationEntry[] = [
      { check_type: 'ai',     result: 'confirmed', confidence: 0.4 },
      { check_type: 'source', result: 'confirmed', confidence: 0.4 },
    ]
    const score = getVerificationScore(entries)
    expect(score).toBe(0.4)
    expect(computeVerificationStatusFromLog(entries)).toBe('partial')
  })

  it('mixed positive/negative: disputed wins over score', () => {
    const entries: VerificationEntry[] = [
      { check_type: 'ai',     result: 'confirmed', confidence: 1.0 },
      { check_type: 'source', result: 'confirmed', confidence: 1.0 },
      { check_type: 'geo',    result: 'refuted',   confidence: 0.1 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('disputed')
  })
})
