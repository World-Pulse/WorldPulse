/**
 * Escalation Index — Unit Tests
 *
 * Tests for the GDELT Conflict Escalation Index logic.
 * These are pure unit tests covering exported helper functions.
 *
 * Run: pnpm test (from Windows, or via `pnpm vitest run` in the api package)
 */

import { describe, it, expect } from 'vitest'
import {
  computeEscalationScore,
  escalationLevel,
  escalationColor,
  escalationTrend,
  parseWindowHours,
  type SeverityCounts,
  type EscalationLevel,
} from '../routes/analytics'

// ─── computeEscalationScore ────────────────────────────────────────────────

describe('computeEscalationScore', () => {
  it('returns 0 when currentCount is 0', () => {
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    expect(computeEscalationScore(0, 0, counts)).toBe(0)
    expect(computeEscalationScore(0, 10, counts)).toBe(0)
  })

  it('caps volumeRatio at 3x (prevents runaway scores)', () => {
    // 30 current vs 1 previous → ratio would be 30x without cap; capped at 3x
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 30, low: 0, info: 0 }
    const uncapped = computeEscalationScore(30, 1, counts)
    const capped   = computeEscalationScore(9, 1, counts)  // 9/1 = 9x → still capped to 3
    // Both should give same volume points (capped)
    expect(uncapped).toBe(capped)
  })

  it('gives full volume score when ratio is exactly 3x', () => {
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 3, low: 0, info: 0 }
    const score3x = computeEscalationScore(3, 1, counts)
    const score6x = computeEscalationScore(6, 1, counts)
    // Both should produce the same volume points (capped at 3x)
    expect(score3x).toBe(score6x)
  })

  it('returns high score when all signals are critical', () => {
    const counts: SeverityCounts = { critical: 10, high: 0, medium: 0, low: 0, info: 0 }
    const score = computeEscalationScore(10, 5, counts)  // 2x volume ratio
    // severity 100% critical → 60 severity points; 2x volume → 26.67 → 27 volume points
    // total ≈ 87
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('returns lower score when all signals are low severity', () => {
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 10, info: 0 }
    const score = computeEscalationScore(10, 5, counts)
    expect(score).toBeLessThan(50)
  })

  it('produces score in range [0, 100]', () => {
    const counts: SeverityCounts = { critical: 100, high: 50, medium: 30, low: 10, info: 5 }
    const score = computeEscalationScore(195, 1, counts)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('treats previousCount=0 as 1 to avoid division by zero', () => {
    const counts: SeverityCounts = { critical: 5, high: 0, medium: 0, low: 0, info: 0 }
    // Should not throw
    expect(() => computeEscalationScore(5, 0, counts)).not.toThrow()
  })

  it('returns an integer (Math.round applied)', () => {
    const counts: SeverityCounts = { critical: 3, high: 2, medium: 1, low: 1, info: 0 }
    const score = computeEscalationScore(7, 4, counts)
    expect(Number.isInteger(score)).toBe(true)
  })
})

// ─── escalationLevel ──────────────────────────────────────────────────────

describe('escalationLevel', () => {
  it('returns Calm when score < 20', () => {
    expect(escalationLevel(0)).toBe('Calm')
    expect(escalationLevel(19)).toBe('Calm')
  })

  it('returns Moderate when score is 20–39', () => {
    expect(escalationLevel(20)).toBe('Moderate')
    expect(escalationLevel(39)).toBe('Moderate')
  })

  it('returns Elevated when score is 40–59', () => {
    expect(escalationLevel(40)).toBe('Elevated')
    expect(escalationLevel(59)).toBe('Elevated')
  })

  it('returns High when score is 60–79', () => {
    expect(escalationLevel(60)).toBe('High')
    expect(escalationLevel(79)).toBe('High')
  })

  it('returns Critical when score >= 80', () => {
    expect(escalationLevel(80)).toBe('Critical')
    expect(escalationLevel(100)).toBe('Critical')
  })
})

// ─── escalationColor ──────────────────────────────────────────────────────

describe('escalationColor', () => {
  const cases: Array<[EscalationLevel, string]> = [
    ['Critical', '#ff3b5c'],
    ['High',     '#ff6b35'],
    ['Elevated', '#f5a623'],
    ['Moderate', '#00d4ff'],
    ['Calm',     '#00e676'],
  ]

  for (const [level, expectedColor] of cases) {
    it(`returns ${expectedColor} for ${level}`, () => {
      expect(escalationColor(level)).toBe(expectedColor)
    })
  }
})

// ─── escalationTrend ──────────────────────────────────────────────────────

describe('escalationTrend', () => {
  it('returns rising when current > previous + 5', () => {
    expect(escalationTrend(60, 50)).toBe('rising')
    expect(escalationTrend(80, 70)).toBe('rising')
  })

  it('returns falling when current < previous - 5', () => {
    expect(escalationTrend(40, 50)).toBe('falling')
    expect(escalationTrend(10, 20)).toBe('falling')
  })

  it('returns stable when difference is <= 5', () => {
    expect(escalationTrend(50, 50)).toBe('stable')
    expect(escalationTrend(55, 50)).toBe('stable')
    expect(escalationTrend(50, 55)).toBe('stable')
    expect(escalationTrend(45, 50)).toBe('stable')
  })

  it('returns stable at exact boundary (diff = 5)', () => {
    expect(escalationTrend(55, 50)).toBe('stable')
    expect(escalationTrend(45, 50)).toBe('stable')
  })
})

// ─── parseWindowHours ──────────────────────────────────────────────────────

describe('parseWindowHours', () => {
  it('returns 24 for 24h (default)', () => {
    expect(parseWindowHours('24h')).toBe(24)
  })

  it('returns 48 for 48h', () => {
    expect(parseWindowHours('48h')).toBe(48)
  })

  it('returns 168 for 7d', () => {
    expect(parseWindowHours('7d')).toBe(168)
  })

  it('falls back to 24 for invalid input', () => {
    expect(parseWindowHours('invalid')).toBe(24)
    expect(parseWindowHours('')).toBe(24)
    expect(parseWindowHours('30d')).toBe(24)
  })
})
