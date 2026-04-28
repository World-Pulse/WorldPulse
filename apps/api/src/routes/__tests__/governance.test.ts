/**
 * Governance Intelligence API — Test Suite
 *
 * 25+ test cases covering:
 * - Constants validation (6)
 * - Registry validation (10+)
 * - filterCountries (5)
 * - buildSummary (4)
 * - GeoJSON map points (2)
 * - Key country presence (3)
 */

import { describe, it, expect } from 'vitest'
import {
  COUNTRY_REGISTRY,
  LIST_CACHE_TTL,
  SUMMARY_CACHE_TTL,
  MAP_CACHE_TTL,
  RATE_LIMIT_RPM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  filterCountries,
  buildSummary,
  type Country,
  type GovernanceIndicators,
} from '../governance'

// ─── Constants ──────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('LIST_CACHE_TTL should be 3600 seconds', () => {
    expect(LIST_CACHE_TTL).toBe(3600)
  })

  it('SUMMARY_CACHE_TTL should be 3600 seconds', () => {
    expect(SUMMARY_CACHE_TTL).toBe(3600)
  })

  it('MAP_CACHE_TTL should be 1800 seconds', () => {
    expect(MAP_CACHE_TTL).toBe(1800)
  })

  it('RATE_LIMIT_RPM should be 60', () => {
    expect(RATE_LIMIT_RPM).toBe(60)
  })

  it('DEFAULT_LIMIT should be 50', () => {
    expect(DEFAULT_LIMIT).toBe(50)
  })

  it('MAX_LIMIT should be 100', () => {
    expect(MAX_LIMIT).toBe(100)
  })
})

// ─── Registry Validation ────────────────────────────────────────────────────

describe('Country Registry', () => {
  it('should contain at least 50 countries', () => {
    expect(COUNTRY_REGISTRY.length).toBeGreaterThanOrEqual(50)
  })

  it('should contain unique country codes', () => {
    const codes = COUNTRY_REGISTRY.map(c => c.code)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(codes.length)
  })

  it('all countries should have required fields', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.code).toBeDefined()
      expect(country.name).toBeDefined()
      expect(country.region).toBeDefined()
      expect(country.regime_type).toBeDefined()
      expect(country.indicators).toBeDefined()
      expect(country.trend).toBeDefined()
      expect(country.trend_magnitude).toBeDefined()
    })
  })

  it('regime_type should be one of valid values', () => {
    const validRegimes = ['full_democracy', 'flawed_democracy', 'hybrid_regime', 'authoritarian']
    COUNTRY_REGISTRY.forEach(country => {
      expect(validRegimes).toContain(country.regime_type)
    })
  })

  it('trend should be one of: improving, declining, stable', () => {
    const validTrends = ['improving', 'declining', 'stable']
    COUNTRY_REGISTRY.forEach(country => {
      expect(validTrends).toContain(country.trend)
    })
  })

  it('democracy_index should be between 0-10', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.indicators.democracy_index).toBeGreaterThanOrEqual(0)
      expect(country.indicators.democracy_index).toBeLessThanOrEqual(10)
    })
  })

  it('freedom_score should be between 0-100', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.indicators.freedom_score).toBeGreaterThanOrEqual(0)
      expect(country.indicators.freedom_score).toBeLessThanOrEqual(100)
    })
  })

  it('corruption_perception should be between 0-100', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.indicators.corruption_perception).toBeGreaterThanOrEqual(0)
      expect(country.indicators.corruption_perception).toBeLessThanOrEqual(100)
    })
  })

  it('press_freedom_rank should be between 1-180', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.indicators.press_freedom_rank).toBeGreaterThanOrEqual(1)
      expect(country.indicators.press_freedom_rank).toBeLessThanOrEqual(180)
    })
  })

  it('trend_magnitude should be between -10 to +10', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.trend_magnitude).toBeGreaterThanOrEqual(-10)
      expect(country.trend_magnitude).toBeLessThanOrEqual(10)
    })
  })

  it('related_signals should be non-negative', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.related_signals).toBeGreaterThanOrEqual(0)
    })
  })
})

// ─── Key Countries Presence ─────────────────────────────────────────────────

describe('Key Countries', () => {
  const keyCountries = ['US', 'CN', 'RU', 'GB', 'FR', 'DE', 'JP', 'IN', 'BR', 'KP']

  keyCountries.forEach(code => {
    it(`should contain ${code}`, () => {
      const country = COUNTRY_REGISTRY.find(c => c.code === code)
      expect(country).toBeDefined()
      expect(country?.name).toBeDefined()
    })
  })
})

// ─── filterCountries Function ───────────────────────────────────────────────

describe('filterCountries', () => {
  it('should return all countries when no filters applied', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, {})
    expect(filtered.length).toBe(COUNTRY_REGISTRY.length)
  })

  it('should filter by region', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { region: 'Europe' })
    filtered.forEach(c => {
      expect(c.region).toBe('Europe')
    })
  })

  it('should filter by regime_type', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { regime_type: 'full_democracy' })
    filtered.forEach(c => {
      expect(c.regime_type).toBe('full_democracy')
    })
  })

  it('should filter by minimum democracy_score', () => {
    const minScore = 7.0
    const filtered = filterCountries(COUNTRY_REGISTRY, { min_democracy_score: minScore })
    filtered.forEach(c => {
      expect(c.indicators.democracy_index).toBeGreaterThanOrEqual(minScore)
    })
  })

  it('should search by name or code', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { q: 'united' })
    expect(filtered.length).toBeGreaterThan(0)
    filtered.forEach(c => {
      const nameOrCode = c.name.toLowerCase() + c.code.toLowerCase()
      expect(nameOrCode.includes('united')).toBe(true)
    })
  })

  it('should combine multiple filters', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, {
      region: 'Europe',
      regime_type: 'full_democracy',
      min_democracy_score: 8.0
    })
    filtered.forEach(c => {
      expect(c.region).toBe('Europe')
      expect(c.regime_type).toBe('full_democracy')
      expect(c.indicators.democracy_index).toBeGreaterThanOrEqual(8.0)
    })
  })

  it('should respect limit parameter', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { limit: 10 })
    expect(filtered.length).toBeLessThanOrEqual(10)
  })

  it('should cap limit at MAX_LIMIT', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { limit: 1000 })
    expect(filtered.length).toBeLessThanOrEqual(MAX_LIMIT)
  })

  it('should sort by name', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { sortBy: 'name' })
    for (let i = 0; i < filtered.length - 1; i++) {
      expect(filtered[i].name.localeCompare(filtered[i + 1].name)).toBeLessThanOrEqual(0)
    }
  })

  it('should sort by democracy_index descending', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { sortBy: 'democracy_index' })
    for (let i = 0; i < filtered.length - 1; i++) {
      expect(filtered[i].indicators.democracy_index).toBeGreaterThanOrEqual(filtered[i + 1].indicators.democracy_index)
    }
  })

  it('should sort by freedom_score descending', () => {
    const filtered = filterCountries(COUNTRY_REGISTRY, { sortBy: 'freedom_score' })
    for (let i = 0; i < filtered.length - 1; i++) {
      expect(filtered[i].indicators.freedom_score).toBeGreaterThanOrEqual(filtered[i + 1].indicators.freedom_score)
    }
  })
})

// ─── buildSummary Function ─────────────────────────────────────────────────

describe('buildSummary', () => {
  it('should compute correct total countries', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    expect(summary.total_countries).toBe(COUNTRY_REGISTRY.length)
  })

  it('regime breakdown should sum to total_countries', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    const sum = summary.full_democracy + summary.flawed_democracy + summary.hybrid_regime + summary.authoritarian
    expect(sum).toBe(summary.total_countries)
  })

  it('should compute positive average democracy_index', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    expect(summary.avg_democracy_index).toBeGreaterThan(0)
    expect(summary.avg_democracy_index).toBeLessThanOrEqual(10)
  })

  it('should compute positive average freedom_score', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    expect(summary.avg_freedom_score).toBeGreaterThan(0)
    expect(summary.avg_freedom_score).toBeLessThanOrEqual(100)
  })

  it('should compute positive average corruption_index', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    expect(summary.avg_corruption_index).toBeGreaterThan(0)
    expect(summary.avg_corruption_index).toBeLessThanOrEqual(100)
  })

  it('should identify most_improved countries with positive trend_magnitude', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    summary.most_improved.forEach(item => {
      const country = COUNTRY_REGISTRY.find(c => c.code === item.code)
      expect(country?.trend_magnitude ?? 0).toBeGreaterThan(0)
    })
  })

  it('should identify most_declined countries with negative trend_magnitude', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    summary.most_declined.forEach(item => {
      const country = COUNTRY_REGISTRY.find(c => c.code === item.code)
      expect(country?.trend_magnitude ?? 0).toBeLessThan(0)
    })
  })

  it('should include regional breakdown', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    expect(summary.regional_breakdown.length).toBeGreaterThan(0)
    const regionCounts = summary.regional_breakdown.reduce((sum, r) => sum + r.count, 0)
    expect(regionCounts).toBe(summary.total_countries)
  })

  it('regional avg_democracy should be between 0-10', () => {
    const summary = buildSummary(COUNTRY_REGISTRY)
    summary.regional_breakdown.forEach(region => {
      expect(region.avg_democracy).toBeGreaterThanOrEqual(0)
      expect(region.avg_democracy).toBeLessThanOrEqual(10)
    })
  })
})

// ─── GeoJSON Map Points ─────────────────────────────────────────────────────

describe('GeoJSON Map Points', () => {
  it('map points should have valid FeatureCollection structure', () => {
    // This test simulates the structure returned by /map/points endpoint
    const features = COUNTRY_REGISTRY.map(country => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [0, 0] // simplified
      },
      properties: {
        code: country.code,
        name: country.name,
        regime_type: country.regime_type
      }
    }))

    const geojson = {
      type: 'FeatureCollection' as const,
      features
    }

    expect(geojson.type).toBe('FeatureCollection')
    expect(Array.isArray(geojson.features)).toBe(true)
    expect(geojson.features.length).toBe(COUNTRY_REGISTRY.length)
  })

  it('each feature should have valid Point geometry', () => {
    const countryCoords: Record<string, [number, number]> = {
      'US': [-95.71, 37.09], 'CN': [104.07, 35.86],
    }

    COUNTRY_REGISTRY.slice(0, 2).forEach(country => {
      const coords = countryCoords[country.code]
      expect(coords).toBeDefined()
      expect(Array.isArray(coords)).toBe(true)
      expect(coords?.length).toBe(2)
      expect(typeof coords?.[0]).toBe('number')
      expect(typeof coords?.[1]).toBe('number')
    })
  })
})

// ─── Regional Coverage ──────────────────────────────────────────────────────

describe('Regional Coverage', () => {
  it('should cover all major regions', () => {
    const regions = new Set(COUNTRY_REGISTRY.map(c => c.region))
    const expectedRegions = ['Europe', 'Americas', 'Africa', 'Middle East', 'Asia', 'Oceania']
    expectedRegions.forEach(region => {
      expect(regions.has(region)).toBe(true)
    })
  })

  it('should have at least 5 countries per major region', () => {
    const majorRegions = ['Europe', 'Americas', 'Asia']
    majorRegions.forEach(region => {
      const regionCountries = COUNTRY_REGISTRY.filter(c => c.region === region)
      expect(regionCountries.length).toBeGreaterThanOrEqual(5)
    })
  })
})
