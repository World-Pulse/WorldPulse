/**
 * Labor Rights Intelligence API — Test Suite
 *
 * 48 test cases covering:
 * - Constants validation (6)
 * - ITUC Labels (3)
 * - Registry validation (12)
 * - filterCountries (8)
 * - sortCountries (5)
 * - computeSummary (8)
 * - toGeoJSON (3)
 * - Key country presence (3)
 */

import { describe, it, expect } from 'vitest'
import {
  LABOR_RIGHTS_REGISTRY,
  LIST_CACHE_TTL,
  SUMMARY_CACHE_TTL,
  MAP_CACHE_TTL,
  RATE_LIMIT_RPM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ITUC_LABELS,
  filterCountries,
  sortCountries,
  computeSummary,
  toGeoJSON,
  type LaborRightsCountry,
  type RightsLevel,
  type ITUCRating,
} from '../labor-rights'

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

// ─── ITUC Labels ────────────────────────────────────────────────────────────

describe('ITUC Labels', () => {
  it('should have 5 labels', () => {
    expect(Object.keys(ITUC_LABELS)).toHaveLength(5)
  })

  it('Rating 1 should be Irregular Violations', () => {
    expect(ITUC_LABELS[1]).toBe('Irregular Violations')
  })

  it('Rating 5 should be No Guarantee of Rights', () => {
    expect(ITUC_LABELS[5]).toBe('No Guarantee of Rights')
  })
})

// ─── Registry Validation ────────────────────────────────────────────────────

describe('Registry Validation', () => {
  it('should have at least 45 countries', () => {
    expect(LABOR_RIGHTS_REGISTRY.length).toBeGreaterThanOrEqual(45)
  })

  it('all country codes should be unique', () => {
    const codes = LABOR_RIGHTS_REGISTRY.map(c => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('all country codes should be valid 2-letter ISO codes', () => {
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(c.code).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('all countries should have a non-empty name', () => {
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(c.name.length).toBeGreaterThan(0)
    }
  })

  it('all countries should have a valid continent', () => {
    const validContinents = ['Africa', 'Americas', 'Asia', 'Europe', 'Middle East', 'Oceania']
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(validContinents).toContain(c.continent)
    }
  })

  it('all countries should have a valid rights_level', () => {
    const validLevels: RightsLevel[] = ['strong', 'moderate', 'weak', 'poor', 'critical']
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(validLevels).toContain(c.rights_level)
    }
  })

  it('all ITUC ratings should be 1-5', () => {
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(c.indicators.ituc_rating).toBeGreaterThanOrEqual(1)
      expect(c.indicators.ituc_rating).toBeLessThanOrEqual(5)
    }
  })

  it('all union_density_pct should be 0-100', () => {
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(c.indicators.union_density_pct).toBeGreaterThanOrEqual(0)
      expect(c.indicators.union_density_pct).toBeLessThanOrEqual(100)
    }
  })

  it('all countries should have at least one top_issue', () => {
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(c.top_issues.length).toBeGreaterThan(0)
    }
  })

  it('all countries should have positive population', () => {
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(c.population_m).toBeGreaterThan(0)
    }
  })

  it('all countries should have valid trend values', () => {
    const validTrends = ['improving', 'declining', 'stable']
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(validTrends).toContain(c.trend)
    }
  })

  it('workforce should be less than or equal to population', () => {
    for (const c of LABOR_RIGHTS_REGISTRY) {
      expect(c.workforce_m).toBeLessThanOrEqual(c.population_m)
    }
  })
})

// ─── filterCountries ────────────────────────────────────────────────────────

describe('filterCountries', () => {
  it('should return all countries with no filters', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, {})
    expect(result.length).toBe(LABOR_RIGHTS_REGISTRY.length)
  })

  it('should filter by continent', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, { continent: 'Europe' })
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.continent).toBe('Europe')
    }
  })

  it('should filter case-insensitively by continent', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, { continent: 'europe' })
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by rights_level', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, { rights_level: 'critical' })
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.rights_level).toBe('critical')
    }
  })

  it('should filter by max_ituc_rating', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, { max_ituc_rating: 2 })
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.indicators.ituc_rating).toBeLessThanOrEqual(2)
    }
  })

  it('should filter by search on name', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, { search: 'Bangladesh' })
    expect(result.length).toBe(1)
    expect(result[0]?.code).toBe('BD')
  })

  it('should filter by search on top_issues', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, { search: 'forced labor' })
    expect(result.length).toBeGreaterThan(0)
  })

  it('should combine multiple filters', () => {
    const result = filterCountries(LABOR_RIGHTS_REGISTRY, {
      continent: 'Asia',
      rights_level: 'poor',
    })
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.continent).toBe('Asia')
      expect(c.rights_level).toBe('poor')
    }
  })
})

// ─── sortCountries ──────────────────────────────────────────────────────────

describe('sortCountries', () => {
  it('should sort by ituc_rating descending by default', () => {
    const result = sortCountries(LABOR_RIGHTS_REGISTRY)
    for (let i = 1; i < result.length; i++) {
      expect((result[i - 1] as LaborRightsCountry).indicators.ituc_rating)
        .toBeGreaterThanOrEqual((result[i] as LaborRightsCountry).indicators.ituc_rating)
    }
  })

  it('should sort by ituc_rating ascending', () => {
    const result = sortCountries(LABOR_RIGHTS_REGISTRY, 'ituc_rating', 'asc')
    for (let i = 1; i < result.length; i++) {
      expect((result[i - 1] as LaborRightsCountry).indicators.ituc_rating)
        .toBeLessThanOrEqual((result[i] as LaborRightsCountry).indicators.ituc_rating)
    }
  })

  it('should sort by name ascending', () => {
    const result = sortCountries(LABOR_RIGHTS_REGISTRY, 'name', 'asc')
    for (let i = 1; i < result.length; i++) {
      expect((result[i - 1] as LaborRightsCountry).name.localeCompare((result[i] as LaborRightsCountry).name))
        .toBeLessThanOrEqual(0)
    }
  })

  it('should sort by workplace_fatality_rate descending', () => {
    const result = sortCountries(LABOR_RIGHTS_REGISTRY, 'workplace_fatality_rate', 'desc')
    for (let i = 1; i < result.length; i++) {
      expect((result[i - 1] as LaborRightsCountry).indicators.workplace_fatality_rate)
        .toBeGreaterThanOrEqual((result[i] as LaborRightsCountry).indicators.workplace_fatality_rate)
    }
  })

  it('should sort by workforce descending', () => {
    const result = sortCountries(LABOR_RIGHTS_REGISTRY, 'workforce_m', 'desc')
    for (let i = 1; i < result.length; i++) {
      expect((result[i - 1] as LaborRightsCountry).workforce_m)
        .toBeGreaterThanOrEqual((result[i] as LaborRightsCountry).workforce_m)
    }
  })
})

// ─── computeSummary ─────────────────────────────────────────────────────────

describe('computeSummary', () => {
  const summary = computeSummary(LABOR_RIGHTS_REGISTRY)

  it('total should equal registry length', () => {
    expect(summary.total_countries).toBe(LABOR_RIGHTS_REGISTRY.length)
  })

  it('rights level counts should sum to total', () => {
    expect(summary.strong + summary.moderate + summary.weak + summary.poor + summary.critical)
      .toBe(summary.total_countries)
  })

  it('avg_ituc_rating should be between 1 and 5', () => {
    expect(summary.avg_ituc_rating).toBeGreaterThanOrEqual(1)
    expect(summary.avg_ituc_rating).toBeLessThanOrEqual(5)
  })

  it('avg_union_density should be between 0 and 100', () => {
    expect(summary.avg_union_density).toBeGreaterThanOrEqual(0)
    expect(summary.avg_union_density).toBeLessThanOrEqual(100)
  })

  it('total_workforce_m should be positive', () => {
    expect(summary.total_workforce_m).toBeGreaterThan(0)
  })

  it('most_at_risk should have at most 10 entries', () => {
    expect(summary.most_at_risk.length).toBeLessThanOrEqual(10)
    expect(summary.most_at_risk.length).toBeGreaterThan(0)
  })

  it('most_at_risk should be sorted by highest ituc_rating first', () => {
    for (let i = 1; i < summary.most_at_risk.length; i++) {
      expect((summary.most_at_risk[i - 1] as { ituc_rating: number }).ituc_rating)
        .toBeGreaterThanOrEqual((summary.most_at_risk[i] as { ituc_rating: number }).ituc_rating)
    }
  })

  it('continent_breakdown should cover all continents', () => {
    const continents = new Set(LABOR_RIGHTS_REGISTRY.map(c => c.continent))
    expect(summary.continent_breakdown.length).toBe(continents.size)
  })
})

// ─── toGeoJSON ──────────────────────────────────────────────────────────────

describe('toGeoJSON', () => {
  const geojson = toGeoJSON(LABOR_RIGHTS_REGISTRY)

  it('should return a FeatureCollection', () => {
    expect(geojson.type).toBe('FeatureCollection')
  })

  it('should have features array', () => {
    expect(Array.isArray(geojson.features)).toBe(true)
    expect(geojson.features.length).toBeGreaterThan(0)
  })

  it('all features should have valid coordinates', () => {
    for (const f of geojson.features) {
      const coords = (f.geometry as { coordinates: [number, number] }).coordinates
      expect(coords[0]).toBeGreaterThanOrEqual(-180) // lng
      expect(coords[0]).toBeLessThanOrEqual(180)
      expect(coords[1]).toBeGreaterThanOrEqual(-90)  // lat
      expect(coords[1]).toBeLessThanOrEqual(90)
    }
  })
})

// ─── Key Country Presence ───────────────────────────────────────────────────

describe('Key Country Presence', () => {
  it('should include Bangladesh (poor — garment sector)', () => {
    const bd = LABOR_RIGHTS_REGISTRY.find(c => c.code === 'BD')
    expect(bd).toBeDefined()
    expect(bd?.rights_level).toBe('poor')
  })

  it('should include Denmark (strong — flexicurity model)', () => {
    const dk = LABOR_RIGHTS_REGISTRY.find(c => c.code === 'DK')
    expect(dk).toBeDefined()
    expect(dk?.rights_level).toBe('strong')
    expect(dk?.indicators.ituc_rating).toBe(1)
  })

  it('should include Saudi Arabia (critical — no right to organize)', () => {
    const sa = LABOR_RIGHTS_REGISTRY.find(c => c.code === 'SA')
    expect(sa).toBeDefined()
    expect(sa?.rights_level).toBe('critical')
    expect(sa?.indicators.union_density_pct).toBe(0)
  })
})
