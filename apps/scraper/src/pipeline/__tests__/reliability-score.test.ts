/**
 * A report's starting reliability score has no random part (Devon, Oct 20,
 * 2026: "fix this and remove it"). It added up to ±4 points at random, and a
 * "spread" from the tag count and language, so reports from one outlet never
 * tied; the score was noisy and could tip a story near the 65% verified line.
 */
import { describe, it, expect } from 'vitest'
import { computeReliabilityScore } from '../reliability-score'

const base = {
  baseReliability: 0.8, severity: 'medium', category: 'geopolitics', hasSummary: true,
  hasLocation: true, tagCount: 5, isStateMedia: false, sourceCount: 1, language: 'en',
}

describe('computeReliabilityScore', () => {
  it('gives the same report the same score, every time', () => {
    const scores = new Set(Array.from({ length: 50 }, () => computeReliabilityScore(base)))
    expect(scores.size).toBe(1)
  })

  it("starts from the outlet's rating, moved only by the report's own facts", () => {
    // 0.80 + summary 0.02 + place 0.02 + 3+ tags 0.01 − one outlet at medium 0.03
    expect(computeReliabilityScore(base)).toBe(0.82)
    // the tag count beyond three and the language no longer move it
    expect(computeReliabilityScore({ ...base, tagCount: 6, language: 'fr' })).toBe(0.82)
    // a state-run outlet on a sensitive topic loses 10 points
    expect(computeReliabilityScore({ ...base, isStateMedia: true })).toBe(0.72)
    // one outlet reporting something critical loses 15 instead of 3
    expect(computeReliabilityScore({ ...base, severity: 'critical' })).toBe(0.7)
    // never 0 or 1
    expect(computeReliabilityScore({ ...base, baseReliability: 1.2 })).toBe(0.99)
    expect(computeReliabilityScore({ ...base, baseReliability: -1 })).toBe(0.05)
  })
})
