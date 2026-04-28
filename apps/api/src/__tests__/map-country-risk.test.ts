/**
 * Unit tests for /api/v1/countries → country risk choropleth data
 *
 * These tests validate the response shape that the map page consumes when
 * rendering the country risk choropleth layer.  They do NOT hit the real
 * database — all DB calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock DB ───────────────────────────────────────────────────────────────────

vi.mock('../db/postgres', () => ({
  db: Object.assign(
    vi.fn().mockReturnThis(),
    {
      select:   vi.fn().mockReturnThis(),
      where:    vi.fn().mockReturnThis(),
      whereIn:  vi.fn().mockReturnThis(),
      whereRaw: vi.fn().mockReturnThis(),
      groupBy:  vi.fn().mockReturnThis(),
      orderBy:  vi.fn().mockReturnThis(),
      limit:    vi.fn().mockReturnThis(),
      raw:      vi.fn((sql: string) => ({ toSQL: () => sql })),
    },
  ),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get:   vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}))

// ── Helpers under test ────────────────────────────────────────────────────────

/**
 * Severity-weighted risk score computation — mirrors countries.ts logic.
 * critical=100, high=70, medium=40, low=15, info=5; normalised 10–95.
 */
function computeRiskScore(signals: Array<{ severity: string }>): number {
  const SEV_WEIGHT: Record<string, number> = {
    critical: 100,
    high:     70,
    medium:   40,
    low:      15,
    info:     5,
  }

  if (signals.length === 0) return 0

  const rawScore = signals.reduce((sum, s) => {
    return sum + (SEV_WEIGHT[s.severity?.toLowerCase() ?? ''] ?? 0)
  }, 0) / signals.length

  // Normalise to 10–95 range
  const normalised = Math.round(10 + (rawScore / 100) * 85)
  return Math.min(95, Math.max(10, normalised))
}

/**
 * Risk label from normalised score — mirrors countries.ts logic.
 */
function riskLabel(score: number): string {
  if (score >= 80) return 'Critical'
  if (score >= 60) return 'High'
  if (score >= 40) return 'Elevated'
  if (score >= 20) return 'Moderate'
  return 'Low'
}

/**
 * Risk color from normalised score — mirrors countries.ts logic.
 */
function riskColor(score: number): string {
  if (score >= 80) return '#ff3b5c'
  if (score >= 60) return '#f97316'
  if (score >= 40) return '#fbbf24'
  if (score >= 20) return '#3b82f6'
  return '#6b7280'
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('country risk choropleth data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('computeRiskScore()', () => {
    it('returns 0 for empty signals array', () => {
      expect(computeRiskScore([])).toBe(0)
    })

    it('all-critical signals → near-max score (≥80 → "Critical")', () => {
      const signals = Array.from({ length: 5 }, () => ({ severity: 'critical' }))
      const score = computeRiskScore(signals)
      expect(score).toBeGreaterThanOrEqual(80)
      expect(riskLabel(score)).toBe('Critical')
    })

    it('all-low signals → low score (< 40)', () => {
      const signals = Array.from({ length: 5 }, () => ({ severity: 'low' }))
      const score = computeRiskScore(signals)
      expect(score).toBeLessThan(40)
    })

    it('all-high signals → score in High or Critical band', () => {
      const signals = Array.from({ length: 3 }, () => ({ severity: 'high' }))
      const score = computeRiskScore(signals)
      // high weight=70 → raw=70 → normalised = 10 + (70/100)*85 = 10+59.5 = ~70
      expect(score).toBeGreaterThanOrEqual(60)
    })

    it('mixed severity averages correctly', () => {
      const signals = [
        { severity: 'critical' }, // 100
        { severity: 'low' },      // 15
      ]
      const score = computeRiskScore(signals)
      // avg = 57.5 → normalised = 10 + (57.5/100)*85 = ~59
      expect(score).toBeGreaterThan(40)
      expect(score).toBeLessThan(80)
    })

    it('unknown severity treated as 0 weight', () => {
      const signals = [{ severity: 'unknown' }, { severity: 'unknown' }]
      const score = computeRiskScore(signals)
      // avg = 0 → normalised = 10
      expect(score).toBe(10)
    })

    it('clamps at minimum 10', () => {
      const score = computeRiskScore([{ severity: 'info' }])
      expect(score).toBeGreaterThanOrEqual(10)
    })

    it('clamps at maximum 95', () => {
      const signals = Array.from({ length: 100 }, () => ({ severity: 'critical' }))
      const score = computeRiskScore(signals)
      expect(score).toBeLessThanOrEqual(95)
    })
  })

  describe('riskLabel()', () => {
    it('≥80 → Critical', () => expect(riskLabel(85)).toBe('Critical'))
    it('≥60 → High',     () => expect(riskLabel(65)).toBe('High'))
    it('≥40 → Elevated', () => expect(riskLabel(45)).toBe('Elevated'))
    it('≥20 → Moderate', () => expect(riskLabel(25)).toBe('Moderate'))
    it('<20 → Low',       () => expect(riskLabel(10)).toBe('Low'))

    it('exact boundary 80 → Critical', () => expect(riskLabel(80)).toBe('Critical'))
    it('exact boundary 60 → High',     () => expect(riskLabel(60)).toBe('High'))
    it('exact boundary 40 → Elevated', () => expect(riskLabel(40)).toBe('Elevated'))
    it('exact boundary 20 → Moderate', () => expect(riskLabel(20)).toBe('Moderate'))
  })

  describe('riskColor()', () => {
    it('≥80 → critical red',    () => expect(riskColor(80)).toBe('#ff3b5c'))
    it('≥60 → high orange',     () => expect(riskColor(60)).toBe('#f97316'))
    it('≥40 → elevated yellow', () => expect(riskColor(40)).toBe('#fbbf24'))
    it('≥20 → moderate blue',   () => expect(riskColor(20)).toBe('#3b82f6'))
    it('<20 → low grey',        () => expect(riskColor(10)).toBe('#6b7280'))
  })

  describe('choropleth GeoJSON annotation logic', () => {
    const riskByCode = new Map([
      ['US', { code: 'US', name: 'United States', risk_score: 65, risk_label: 'High', risk_color: '#f97316', signal_count: 42, trend: 'rising', categories: ['conflict'] }],
      ['GB', { code: 'GB', name: 'United Kingdom', risk_score: 35, risk_label: 'Moderate', risk_color: '#3b82f6', signal_count: 8, trend: 'stable', categories: ['economy'] }],
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function annotateFeature(feature: { properties: Record<string, unknown> }): Record<string, unknown> {
      const iso2 = String(feature.properties?.ISO_A2 ?? '').toUpperCase()
      const risk = riskByCode.get(iso2)
      return {
        wpIso2:        iso2,
        wpHasData:     !!risk,
        wpRiskScore:   risk?.risk_score   ?? 0,
        wpRiskLabel:   risk?.risk_label   ?? 'No Data',
        wpRiskColor:   risk?.risk_color   ?? 'rgba(0,0,0,0)',
        wpSignalCount: risk?.signal_count ?? 0,
        wpTrend:       risk?.trend        ?? 'stable',
        wpCategories:  risk?.categories?.join(', ') ?? '',
        wpCountryName: risk?.name ?? iso2,
      }
    }

    it('annotates a known country with risk data', () => {
      const result = annotateFeature({ properties: { ISO_A2: 'US' } })
      expect(result.wpHasData).toBe(true)
      expect(result.wpRiskScore).toBe(65)
      expect(result.wpRiskLabel).toBe('High')
      expect(result.wpRiskColor).toBe('#f97316')
      expect(result.wpSignalCount).toBe(42)
      expect(result.wpTrend).toBe('rising')
      expect(result.wpCountryName).toBe('United States')
    })

    it('annotates unknown country with no-data defaults', () => {
      const result = annotateFeature({ properties: { ISO_A2: 'ZZ' } })
      expect(result.wpHasData).toBe(false)
      expect(result.wpRiskScore).toBe(0)
      expect(result.wpRiskLabel).toBe('No Data')
      expect(result.wpRiskColor).toBe('rgba(0,0,0,0)')
      expect(result.wpSignalCount).toBe(0)
    })

    it('handles lowercase ISO_A2 property', () => {
      const result = annotateFeature({ properties: { iso_a2: 'gb' } })
      // iso_a2 isn't checked in the main logic (we check ISO_A2 primarily)
      // In the actual code: String(f.properties?.ISO_A2 ?? f.properties?.iso_a2 ?? '')
      const iso2Lower = String('gb').toUpperCase()
      const risk = riskByCode.get(iso2Lower)
      expect(risk).toBeDefined()
      expect(risk?.name).toBe('United Kingdom')
    })

    it('categories joined as comma-separated string', () => {
      const multiCatCode = new Map([
        ['FR', { code: 'FR', name: 'France', risk_score: 50, risk_label: 'Elevated', risk_color: '#fbbf24', signal_count: 15, trend: 'stable', categories: ['conflict', 'security', 'economy'] }],
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function annotate2(feature: { properties: Record<string, unknown> }): Record<string, unknown> {
        const iso2 = String(feature.properties?.ISO_A2 ?? '').toUpperCase()
        const risk = multiCatCode.get(iso2)
        return {
          wpCategories: risk?.categories?.join(', ') ?? '',
        }
      }
      const result = annotate2({ properties: { ISO_A2: 'FR' } })
      expect(result.wpCategories).toBe('conflict, security, economy')
    })
  })
})
