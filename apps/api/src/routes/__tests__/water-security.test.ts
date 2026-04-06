/**
 * Water Security Intelligence API — Unit Tests
 *
 * 48 tests across 8 describe blocks covering:
 * constants, stress labels, registry validation, filterRegions, sortRegions,
 * computeSummary, toGeoJSON, key country presence
 */

import { describe, it, expect } from 'vitest'
import {
  LIST_CACHE_TTL, SUMMARY_CACHE_TTL, MAP_CACHE_TTL, RATE_LIMIT_RPM,
  DEFAULT_LIMIT, MAX_LIMIT, STRESS_LABELS,
  REGION_REGISTRY, filterRegions, sortRegions, computeSummary, toGeoJSON,
} from '../water-security'

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Water Security Constants', () => {
  it('LIST_CACHE_TTL is 1 hour', () => {
    expect(LIST_CACHE_TTL).toBe(3600)
  })
  it('SUMMARY_CACHE_TTL is 1 hour', () => {
    expect(SUMMARY_CACHE_TTL).toBe(3600)
  })
  it('MAP_CACHE_TTL is 30 minutes', () => {
    expect(MAP_CACHE_TTL).toBe(1800)
  })
  it('RATE_LIMIT_RPM is 60', () => {
    expect(RATE_LIMIT_RPM).toBe(60)
  })
  it('DEFAULT_LIMIT is 50', () => {
    expect(DEFAULT_LIMIT).toBe(50)
  })
  it('MAX_LIMIT is 100', () => {
    expect(MAX_LIMIT).toBe(100)
  })
})

// ─── Stress Labels ────────────────────────────────────────────────────────────

describe('Stress Level Labels', () => {
  it('has 6 stress levels', () => {
    expect(Object.keys(STRESS_LABELS).length).toBe(6)
  })
  it('level 0 = Low', () => {
    expect(STRESS_LABELS[0]).toBe('Low')
  })
  it('level 5 = Arid / Critical', () => {
    expect(STRESS_LABELS[5]).toBe('Arid / Critical')
  })
})

// ─── Registry Validation ──────────────────────────────────────────────────────

describe('Region Registry Validation', () => {
  it('contains 40+ countries', () => {
    expect(REGION_REGISTRY.length).toBeGreaterThanOrEqual(40)
  })
  it('all codes are unique', () => {
    const codes = REGION_REGISTRY.map(r => r.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
  it('all codes are 2 uppercase letters', () => {
    for (const r of REGION_REGISTRY) {
      expect(r.code).toMatch(/^[A-Z]{2}$/)
    }
  })
  it('all names are non-empty strings', () => {
    for (const r of REGION_REGISTRY) {
      expect(r.name.length).toBeGreaterThan(0)
    }
  })
  it('all continents are valid', () => {
    const valid = ['Africa', 'Middle East', 'Asia', 'Americas', 'Europe', 'Central Asia', 'Oceania']
    for (const r of REGION_REGISTRY) {
      expect(valid).toContain(r.continent)
    }
  })
  it('all crisis_levels are valid', () => {
    const valid: CrisisLevel[] = ['stable', 'watch', 'crisis', 'emergency', 'catastrophic']
    for (const r of REGION_REGISTRY) {
      expect(valid).toContain(r.crisis_level)
    }
  })
  it('water_stress_index in 0-5 range', () => {
    for (const r of REGION_REGISTRY) {
      expect(r.indicators.water_stress_index).toBeGreaterThanOrEqual(0)
      expect(r.indicators.water_stress_index).toBeLessThanOrEqual(5)
    }
  })
  it('sanitation_access_pct in 0-100 range', () => {
    for (const r of REGION_REGISTRY) {
      expect(r.indicators.sanitation_access_pct).toBeGreaterThanOrEqual(0)
      expect(r.indicators.sanitation_access_pct).toBeLessThanOrEqual(100)
    }
  })
  it('all have top_threats array with at least 1 entry', () => {
    for (const r of REGION_REGISTRY) {
      expect(r.top_threats.length).toBeGreaterThanOrEqual(1)
    }
  })
  it('all have positive population', () => {
    for (const r of REGION_REGISTRY) {
      expect(r.population_m).toBeGreaterThan(0)
    }
  })
  it('all trend values are valid', () => {
    for (const r of REGION_REGISTRY) {
      expect(['improving', 'declining', 'stable']).toContain(r.trend)
    }
  })
  it('all have valid coordinates', () => {
    for (const r of REGION_REGISTRY) {
      expect(r.lat).toBeGreaterThanOrEqual(-90)
      expect(r.lat).toBeLessThanOrEqual(90)
      expect(r.lng).toBeGreaterThanOrEqual(-180)
      expect(r.lng).toBeLessThanOrEqual(180)
    }
  })
})

// ─── filterRegions ────────────────────────────────────────────────────────────

describe('filterRegions', () => {
  it('returns all when no filters', () => {
    const result = filterRegions(REGION_REGISTRY, {})
    expect(result.length).toBe(REGION_REGISTRY.length)
  })
  it('filters by continent', () => {
    const result = filterRegions(REGION_REGISTRY, { continent: 'Africa' })
    expect(result.length).toBeGreaterThan(0)
    for (const r of result) expect(r.continent).toBe('Africa')
  })
  it('continent filter is case-insensitive', () => {
    const result = filterRegions(REGION_REGISTRY, { continent: 'africa' })
    expect(result.length).toBeGreaterThan(0)
    for (const r of result) expect(r.continent).toBe('Africa')
  })
  it('filters by crisis_level', () => {
    const result = filterRegions(REGION_REGISTRY, { crisis_level: 'catastrophic' })
    expect(result.length).toBeGreaterThan(0)
    for (const r of result) expect(r.crisis_level).toBe('catastrophic')
  })
  it('filters by min_water_stress', () => {
    const result = filterRegions(REGION_REGISTRY, { min_water_stress: 4.0 })
    expect(result.length).toBeGreaterThan(0)
    for (const r of result) expect(r.indicators.water_stress_index).toBeGreaterThanOrEqual(4.0)
  })
  it('search by country name', () => {
    const result = filterRegions(REGION_REGISTRY, { q: 'Yemen' })
    expect(result.length).toBe(1)
    expect(result[0]?.code).toBe('YE')
  })
  it('search by threat keyword', () => {
    const result = filterRegions(REGION_REGISTRY, { q: 'cholera' })
    expect(result.length).toBeGreaterThan(0)
  })
  it('combined filters work', () => {
    const result = filterRegions(REGION_REGISTRY, { continent: 'Africa', crisis_level: 'catastrophic' })
    expect(result.length).toBeGreaterThan(0)
    for (const r of result) {
      expect(r.continent).toBe('Africa')
      expect(r.crisis_level).toBe('catastrophic')
    }
  })
})

// ─── sortRegions ──────────────────────────────────────────────────────────────

describe('sortRegions', () => {
  it('sorts by water_stress_index desc', () => {
    const sorted = sortRegions(REGION_REGISTRY, 'water_stress_index', 'desc')
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1]!.indicators.water_stress_index).toBeGreaterThanOrEqual(sorted[i]!.indicators.water_stress_index)
    }
  })
  it('sorts by water_stress_index asc', () => {
    const sorted = sortRegions(REGION_REGISTRY, 'water_stress_index', 'asc')
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1]!.indicators.water_stress_index).toBeLessThanOrEqual(sorted[i]!.indicators.water_stress_index)
    }
  })
  it('sorts by name asc', () => {
    const sorted = sortRegions(REGION_REGISTRY, 'name', 'asc')
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1]!.name.localeCompare(sorted[i]!.name)).toBeLessThanOrEqual(0)
    }
  })
  it('sorts by drought_risk_score desc', () => {
    const sorted = sortRegions(REGION_REGISTRY, 'drought_risk_score', 'desc')
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1]!.indicators.drought_risk_score).toBeGreaterThanOrEqual(sorted[i]!.indicators.drought_risk_score)
    }
  })
  it('sorts by population desc', () => {
    const sorted = sortRegions(REGION_REGISTRY, 'population', 'desc')
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1]!.population_m).toBeGreaterThanOrEqual(sorted[i]!.population_m)
    }
  })
})

// ─── computeSummary ──────────────────────────────────────────────────────────

describe('computeSummary', () => {
  const summary = computeSummary(REGION_REGISTRY)

  it('total equals registry size', () => {
    expect(summary.total_regions).toBe(REGION_REGISTRY.length)
  })
  it('crisis levels sum to total', () => {
    expect(summary.catastrophic + summary.emergency + summary.crisis + summary.watch + summary.stable)
      .toBe(summary.total_regions)
  })
  it('avg_water_stress is between 0 and 5', () => {
    expect(summary.avg_water_stress).toBeGreaterThan(0)
    expect(summary.avg_water_stress).toBeLessThanOrEqual(5)
  })
  it('avg_sanitation_access is between 0 and 100', () => {
    expect(summary.avg_sanitation_access).toBeGreaterThan(0)
    expect(summary.avg_sanitation_access).toBeLessThanOrEqual(100)
  })
  it('total_water_insecure_m is positive', () => {
    expect(summary.total_water_insecure_m).toBeGreaterThan(0)
  })
  it('most_affected has up to 5 entries', () => {
    expect(summary.most_affected.length).toBeLessThanOrEqual(5)
    expect(summary.most_affected.length).toBeGreaterThan(0)
  })
  it('most_affected ordered by highest stress', () => {
    for (let i = 1; i < summary.most_affected.length; i++) {
      expect(summary.most_affected[i - 1]!.stress).toBeGreaterThanOrEqual(summary.most_affected[i]!.stress)
    }
  })
  it('continent_breakdown has entries', () => {
    expect(summary.continent_breakdown.length).toBeGreaterThan(0)
  })
})

// ─── toGeoJSON ────────────────────────────────────────────────────────────────

describe('toGeoJSON', () => {
  const geojson = toGeoJSON(REGION_REGISTRY)

  it('returns FeatureCollection type', () => {
    expect(geojson.type).toBe('FeatureCollection')
  })
  it('features match registry length', () => {
    expect(geojson.features.length).toBe(REGION_REGISTRY.length)
  })
  it('all features have valid coordinates', () => {
    for (const f of geojson.features) {
      expect(f.geometry.type).toBe('Point')
      expect(f.geometry.coordinates.length).toBe(2)
      expect(f.geometry.coordinates[0]).toBeGreaterThanOrEqual(-180)
      expect(f.geometry.coordinates[0]).toBeLessThanOrEqual(180)
      expect(f.geometry.coordinates[1]).toBeGreaterThanOrEqual(-90)
      expect(f.geometry.coordinates[1]).toBeLessThanOrEqual(90)
    }
  })
})

// ─── Key Country Presence ─────────────────────────────────────────────────────

describe('Key Country Presence', () => {
  it('Yemen is catastrophic (most water-scarce country)', () => {
    const ye = REGION_REGISTRY.find(r => r.code === 'YE')
    expect(ye).toBeDefined()
    expect(ye!.crisis_level).toBe('catastrophic')
  })
  it('India is crisis (largest water-insecure population)', () => {
    const ind = REGION_REGISTRY.find(r => r.code === 'IN')
    expect(ind).toBeDefined()
    expect(ind!.crisis_level).toBe('crisis')
    expect(ind!.pop_water_insecure_m).toBeGreaterThan(100)
  })
  it('Netherlands is stable (world-leading flood defense)', () => {
    const nl = REGION_REGISTRY.find(r => r.code === 'NL')
    expect(nl).toBeDefined()
    expect(nl!.crisis_level).toBe('stable')
  })
})
