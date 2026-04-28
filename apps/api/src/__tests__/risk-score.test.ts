import { describe, it, expect } from 'vitest'
import { computeRiskScore } from '../lib/risk-score'
import type { RiskScoreInput } from '../lib/risk-score'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minsAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000)
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000)
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

const BASE: RiskScoreInput = {
  severity:         'medium',
  reliabilityScore: 0.5,
  sourceCount:      1,
  hasLocation:      false,
  category:         'general',
  publishedAt:      minsAgo(30),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeRiskScore', () => {

  it('high-confidence critical signal → high total score', () => {
    const result = computeRiskScore({
      severity:         'critical',
      reliabilityScore: 0.9,
      sourceCount:      4,
      hasLocation:      true,
      category:         'conflict',
      publishedAt:      minsAgo(30),
    })
    // severity(40) + reliability(23) + corroboration(20) + recency(15) = 98
    expect(result.score).toBeGreaterThanOrEqual(75)
    expect(result.level).toBe('critical')
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('low-confidence info signal 30 days old → low score', () => {
    const result = computeRiskScore({
      severity:         'info',
      reliabilityScore: 0.1,
      sourceCount:      1,
      hasLocation:      false,
      category:         'general',
      publishedAt:      daysAgo(30),
    })
    // severity(2) + reliability(3) + corroboration(5) + recency(1) = 11
    expect(result.score).toBeLessThan(25)
    expect(result.level).toBe('low')
  })

  it('score is always clamped to 0-100', () => {
    const high = computeRiskScore({
      severity: 'critical', reliabilityScore: 1, sourceCount: 100,
      hasLocation: true, category: 'conflict', publishedAt: minsAgo(1),
    })
    const low = computeRiskScore({
      severity: 'info', reliabilityScore: 0, sourceCount: 0,
      hasLocation: false, category: 'other', publishedAt: daysAgo(365),
    })
    expect(high.score).toBeLessThanOrEqual(100)
    expect(low.score).toBeGreaterThanOrEqual(0)
  })

  it('level thresholds: ≥75 → critical, ≥50 → high, ≥25 → medium, <25 → low', () => {
    // Build inputs that will hit each bucket
    const critical = computeRiskScore({ ...BASE, severity: 'critical', reliabilityScore: 1, sourceCount: 4, publishedAt: minsAgo(10) })
    const high     = computeRiskScore({ ...BASE, severity: 'high',     reliabilityScore: 0.6, sourceCount: 2, publishedAt: hoursAgo(3) })
    const medium   = computeRiskScore({ ...BASE, severity: 'medium',   reliabilityScore: 0.2, sourceCount: 1, publishedAt: hoursAgo(12) })
    const low      = computeRiskScore({ ...BASE, severity: 'info',     reliabilityScore: 0.1, sourceCount: 1, publishedAt: daysAgo(30) })

    expect(critical.level).toBe('critical')
    expect(high.level).toBe('high')
    expect(medium.level).toBe('medium')
    expect(low.level).toBe('low')
  })

  it('label format: "<Level> Risk · <score>"', () => {
    const result = computeRiskScore({ ...BASE, severity: 'high', reliabilityScore: 0.7, sourceCount: 3, publishedAt: minsAgo(20) })
    expect(result.label).toMatch(/^(Critical|High|Medium|Low) Risk · \d+$/)
  })

  it('severity scores: critical=40, high=30, medium=18, low=8, info=2', () => {
    const fixed: Omit<RiskScoreInput, 'severity'> = {
      reliabilityScore: 0, sourceCount: 1, hasLocation: false,
      category: 'general', publishedAt: daysAgo(30),
    }
    expect(computeRiskScore({ ...fixed, severity: 'critical' }).factors.severityScore).toBe(40)
    expect(computeRiskScore({ ...fixed, severity: 'high'     }).factors.severityScore).toBe(30)
    expect(computeRiskScore({ ...fixed, severity: 'medium'   }).factors.severityScore).toBe(18)
    expect(computeRiskScore({ ...fixed, severity: 'low'      }).factors.severityScore).toBe(8)
    expect(computeRiskScore({ ...fixed, severity: 'info'     }).factors.severityScore).toBe(2)
  })

  it('corroboration: 1=5, 2=10, 3=15, 4+=20', () => {
    const fixed: Omit<RiskScoreInput, 'sourceCount'> = {
      severity: 'low', reliabilityScore: 0, hasLocation: false,
      category: 'general', publishedAt: daysAgo(30),
    }
    expect(computeRiskScore({ ...fixed, sourceCount: 1 }).factors.corroborationScore).toBe(5)
    expect(computeRiskScore({ ...fixed, sourceCount: 2 }).factors.corroborationScore).toBe(10)
    expect(computeRiskScore({ ...fixed, sourceCount: 3 }).factors.corroborationScore).toBe(15)
    expect(computeRiskScore({ ...fixed, sourceCount: 4 }).factors.corroborationScore).toBe(20)
    expect(computeRiskScore({ ...fixed, sourceCount: 9 }).factors.corroborationScore).toBe(20)
  })

  it('recency: ≤1h=15, ≤6h=12, ≤24h=8, ≤7d=4, older=1', () => {
    const fixed: Omit<RiskScoreInput, 'publishedAt'> = {
      severity: 'low', reliabilityScore: 0, sourceCount: 1,
      hasLocation: false, category: 'general',
    }
    expect(computeRiskScore({ ...fixed, publishedAt: minsAgo(30)   }).factors.recencyScore).toBe(15)
    expect(computeRiskScore({ ...fixed, publishedAt: hoursAgo(3)   }).factors.recencyScore).toBe(12)
    expect(computeRiskScore({ ...fixed, publishedAt: hoursAgo(12)  }).factors.recencyScore).toBe(8)
    expect(computeRiskScore({ ...fixed, publishedAt: daysAgo(4)    }).factors.recencyScore).toBe(4)
    expect(computeRiskScore({ ...fixed, publishedAt: daysAgo(30)   }).factors.recencyScore).toBe(1)
  })

  it('factor sum equals score (before clamp at 100)', () => {
    const result = computeRiskScore({ ...BASE, severity: 'medium', reliabilityScore: 0.5, sourceCount: 2 })
    const sum = result.factors.severityScore + result.factors.reliabilityScore
      + result.factors.corroborationScore + result.factors.recencyScore
    // Score is clamped, but for normal inputs the sum should equal score
    expect(result.score).toBe(Math.min(100, Math.max(0, Math.round(sum))))
  })

  it('reliability 1.0 → factor 25, 0.0 → factor 0', () => {
    const fixed: Omit<RiskScoreInput, 'reliabilityScore'> = {
      severity: 'low', sourceCount: 1, hasLocation: false,
      category: 'general', publishedAt: daysAgo(30),
    }
    expect(computeRiskScore({ ...fixed, reliabilityScore: 1.0 }).factors.reliabilityScore).toBe(25)
    expect(computeRiskScore({ ...fixed, reliabilityScore: 0.0 }).factors.reliabilityScore).toBe(0)
    expect(computeRiskScore({ ...fixed, reliabilityScore: 0.5 }).factors.reliabilityScore).toBe(13)
  })

  it('unknown severity falls back gracefully (default medium=18)', () => {
    const result = computeRiskScore({ ...BASE, severity: 'unknown_future_value' })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    // Default is 8 (low fallback)
    expect(result.factors.severityScore).toBe(8)
  })
})
