/**
 * Tests for the UN Comtrade strategic commodity flows OSINT source.
 * Covers commoditySeverity, buildSignalTitle, inferComtradeLocation,
 * comtradeDedupKey, and static exports.
 */

import { describe, it, expect } from 'vitest'
import {
  commoditySeverity,
  buildSignalTitle,
  inferComtradeLocation,
  comtradeDedupKey,
  STRATEGIC_COMMODITIES,
  COUNTRY_CENTROIDS,
} from '../comtrade'

// ─── commoditySeverity ───────────────────────────────────────────────────────

describe('commoditySeverity', () => {
  // critical: nuclear/radioactive (HS 2844) at any value
  it('returns critical for radioactive materials (HS 2844) at zero value', () => {
    expect(commoditySeverity('2844', 0)).toBe('critical')
  })

  it('returns critical for radioactive materials (HS 2844) at large value', () => {
    expect(commoditySeverity('2844', 5_000_000_000)).toBe('critical')
  })

  // critical: value > $10B for any commodity
  it('returns critical for crude oil flow exceeding $10B', () => {
    expect(commoditySeverity('2709', 10_000_000_001)).toBe('critical')
  })

  it('returns critical for iron ore flow at $15B', () => {
    expect(commoditySeverity('2601', 15_000_000_000)).toBe('critical')
  })

  it('returns critical for coal flow exceeding $10B threshold', () => {
    expect(commoditySeverity('2701', 11_000_000_000)).toBe('critical')
  })

  // high: semiconductors (HS 8542) regardless of value
  it('returns high for semiconductors (HS 8542) at $500M', () => {
    expect(commoditySeverity('8542', 500_000_000)).toBe('high')
  })

  it('returns high for semiconductors (HS 8542) even at low value', () => {
    expect(commoditySeverity('8542', 10_000_000)).toBe('high')
  })

  // high: crude oil (HS 2709) regardless of value (below $10B)
  it('returns high for crude petroleum (HS 2709) at $100M', () => {
    expect(commoditySeverity('2709', 100_000_000)).toBe('high')
  })

  it('returns high for crude petroleum (HS 2709) at $1M', () => {
    expect(commoditySeverity('2709', 1_000_000)).toBe('high')
  })

  // high: value > $1B for other commodities
  it('returns high for coal at $2B', () => {
    expect(commoditySeverity('2701', 2_000_000_000)).toBe('high')
  })

  it('returns high for manganese ore (HS 2602) at $1.5B', () => {
    expect(commoditySeverity('2602', 1_500_000_000)).toBe('high')
  })

  // medium: >$100M for other strategic commodities
  it('returns medium for coal at $500M', () => {
    expect(commoditySeverity('2701', 500_000_000)).toBe('medium')
  })

  it('returns medium for iron ore at $200M', () => {
    expect(commoditySeverity('2601', 200_000_000)).toBe('medium')
  })

  it('returns medium for niobium/tantalum (HS 2615) at $150M', () => {
    expect(commoditySeverity('2615', 150_000_000)).toBe('medium')
  })

  it('returns medium for petroleum products at $101M', () => {
    expect(commoditySeverity('2710', 101_000_000)).toBe('medium')
  })

  // low: small flows
  it('returns low for petroleum products below $100M', () => {
    expect(commoditySeverity('2710', 50_000_000)).toBe('low')
  })

  it('returns low for coal at minimal value', () => {
    expect(commoditySeverity('2701', 10_000_000)).toBe('low')
  })

  it('returns low for manganese ore at zero value', () => {
    expect(commoditySeverity('2602', 0)).toBe('low')
  })

  it('returns low for unknown HS code below thresholds', () => {
    expect(commoditySeverity('9999', 50_000_000)).toBe('low')
  })

  // boundary: exactly $10B is NOT critical (must exceed)
  it('returns high for crude oil at exactly $10B (not critical)', () => {
    expect(commoditySeverity('2709', 10_000_000_000)).toBe('high')
  })

  // boundary: exactly $1B is NOT high via value alone (must exceed)
  it('returns medium for coal at exactly $1B (value threshold is exclusive)', () => {
    expect(commoditySeverity('2701', 1_000_000_000)).toBe('medium')
  })
})

// ─── buildSignalTitle ────────────────────────────────────────────────────────

describe('buildSignalTitle', () => {
  it('formats exporter → importer with known HS code and $B value', () => {
    const title = buildSignalTitle('China', 'India', '8542', 2_300_000_000, '2024')
    expect(title).toBe('China → India Semiconductors Exports: $2.3B 2024')
  })

  it('formats crude oil flow with $M value', () => {
    const title = buildSignalTitle('Russia', 'India', '2709', 890_000_000, '2024')
    expect(title).toBe('Russia → India Crude Oil Exports: $890M 2024')
  })

  it('formats unknown HS code with fallback HS label', () => {
    const title = buildSignalTitle('USA', 'Germany', '9999', 100_000_000, '2023')
    expect(title).toBe('USA → Germany HS 9999 Exports: $100M 2023')
  })

  it('formats $K-range values', () => {
    const title = buildSignalTitle('Chile', 'Japan', '2615', 50_000, '2024')
    expect(title).toBe('Chile → Japan Niobium/Tantalum Ore Exports: $50K 2024')
  })

  it('formats iron ore with $B value and correct year', () => {
    const title = buildSignalTitle('Australia', 'China', '2601', 5_000_000_000, '2023')
    expect(title).toBe('Australia → China Iron Ore Exports: $5.0B 2023')
  })

  it('includes period as provided', () => {
    const title = buildSignalTitle('Saudi Arabia', 'South Korea', '2709', 3_200_000_000, '2022')
    expect(title).toContain('2022')
  })

  it('uses → arrow between exporter and importer', () => {
    const title = buildSignalTitle('Nigeria', 'France', '2601', 200_000_000, '2024')
    expect(title).toContain('Nigeria → France')
  })
})

// ─── inferComtradeLocation ───────────────────────────────────────────────────

describe('inferComtradeLocation', () => {
  it('returns Beijing coords for China (M49: 156)', () => {
    const loc = inferComtradeLocation(156)
    expect(loc).not.toBeNull()
    expect(loc?.name).toBe('China')
    expect(loc?.lat).toBe(39.90)
    expect(loc?.lon).toBe(116.41)
  })

  it('returns Washington DC coords for United States (M49: 840)', () => {
    const loc = inferComtradeLocation(840)
    expect(loc?.name).toBe('United States')
    expect(loc?.lat).toBe(38.90)
    expect(loc?.lon).toBe(-77.04)
  })

  it('returns Moscow coords for Russia (M49: 643)', () => {
    const loc = inferComtradeLocation(643)
    expect(loc?.name).toBe('Russia')
    expect(loc?.lat).toBe(55.76)
    expect(loc?.lon).toBe(37.62)
  })

  it('returns Riyadh coords for Saudi Arabia (M49: 682)', () => {
    const loc = inferComtradeLocation(682)
    expect(loc?.name).toBe('Saudi Arabia')
    expect(loc?.lat).toBe(24.71)
    expect(loc?.lon).toBe(46.68)
  })

  it('returns null for unknown country code', () => {
    expect(inferComtradeLocation(9999)).toBeNull()
  })

  it('returns null for code 0 (world aggregate)', () => {
    expect(inferComtradeLocation(0)).toBeNull()
  })

  it('returns Singapore coords (M49: 702)', () => {
    const loc = inferComtradeLocation(702)
    expect(loc?.name).toBe('Singapore')
    expect(loc?.lat).toBe(1.29)
    expect(loc?.lon).toBe(103.85)
  })

  it('returns Tokyo coords for Japan (M49: 392)', () => {
    const loc = inferComtradeLocation(392)
    expect(loc?.name).toBe('Japan')
    expect(loc?.lon).toBe(139.69)
  })

  it('returns negative latitude for Southern Hemisphere countries', () => {
    const brazil = inferComtradeLocation(76)
    expect(brazil?.lat).toBeLessThan(0)
    const australia = inferComtradeLocation(36)
    expect(australia?.lat).toBeLessThan(0)
    const chile = inferComtradeLocation(152)
    expect(chile?.lat).toBeLessThan(0)
  })

  it('COUNTRY_CENTROIDS map contains at least 30 trading nations', () => {
    expect(Object.keys(COUNTRY_CENTROIDS).length).toBeGreaterThanOrEqual(30)
  })
})

// ─── comtradeDedupKey ────────────────────────────────────────────────────────

describe('comtradeDedupKey', () => {
  it('generates correct osint:comtrade prefix and format', () => {
    expect(comtradeDedupKey(156, 356, '8542', '2024'))
      .toBe('osint:comtrade:156:356:8542:2024')
  })

  it('generates unique keys for different periods', () => {
    const k1 = comtradeDedupKey(156, 356, '8542', '2023')
    const k2 = comtradeDedupKey(156, 356, '8542', '2024')
    expect(k1).not.toBe(k2)
  })

  it('generates unique keys for different commodity codes', () => {
    const k1 = comtradeDedupKey(156, 356, '2709', '2024')
    const k2 = comtradeDedupKey(156, 356, '8542', '2024')
    expect(k1).not.toBe(k2)
  })

  it('generates unique keys for different reporter countries', () => {
    const k1 = comtradeDedupKey(156, 356, '8542', '2024')
    const k2 = comtradeDedupKey(840, 356, '8542', '2024')
    expect(k1).not.toBe(k2)
  })

  it('generates unique keys for different partner countries', () => {
    const k1 = comtradeDedupKey(156, 356, '8542', '2024')
    const k2 = comtradeDedupKey(156, 276, '8542', '2024')
    expect(k1).not.toBe(k2)
  })

  it('starts with osint:comtrade: prefix', () => {
    const key = comtradeDedupKey(840, 156, '2844', '2024')
    expect(key.startsWith('osint:comtrade:')).toBe(true)
  })
})

// ─── STRATEGIC_COMMODITIES static export ─────────────────────────────────────

describe('STRATEGIC_COMMODITIES', () => {
  it('contains all 8 required HS codes', () => {
    expect(Object.keys(STRATEGIC_COMMODITIES)).toHaveLength(8)
  })

  it('includes crude petroleum (HS 2709)', () => {
    expect(STRATEGIC_COMMODITIES['2709']).toBe('Crude Oil')
  })

  it('includes petroleum products (HS 2710)', () => {
    expect(STRATEGIC_COMMODITIES['2710']).toBe('Petroleum Products')
  })

  it('includes iron ore (HS 2601)', () => {
    expect(STRATEGIC_COMMODITIES['2601']).toBe('Iron Ore')
  })

  it('includes coal (HS 2701)', () => {
    expect(STRATEGIC_COMMODITIES['2701']).toBe('Coal')
  })

  it('includes radioactive materials (HS 2844)', () => {
    expect(STRATEGIC_COMMODITIES['2844']).toBe('Radioactive Materials')
  })

  it('includes semiconductors (HS 8542)', () => {
    expect(STRATEGIC_COMMODITIES['8542']).toBe('Semiconductors')
  })

  it('includes manganese ore (HS 2602)', () => {
    expect(STRATEGIC_COMMODITIES['2602']).toBe('Manganese Ore')
  })

  it('includes niobium/tantalum ore (HS 2615)', () => {
    expect(STRATEGIC_COMMODITIES['2615']).toBe('Niobium/Tantalum Ore')
  })
})
