/**
 * Digital Rights Intelligence API — Test Suite
 *
 * 45+ test cases covering:
 * - Constants (6)
 * - Censorship Level Labels (3)
 * - Registry Validation (12)
 * - filterCountries (8)
 * - sortCountries (5)
 * - computeSummary (8)
 * - toGeoJSON (3)
 * - Key Country Presence (3)
 */

import { describe, it, expect } from 'vitest'
import {
  COUNTRY_REGISTRY,
  CENSORSHIP_LEVEL_LABELS,
  LIST_CACHE_TTL,
  SUMMARY_CACHE_TTL,
  MAP_CACHE_TTL,
  RATE_LIMIT_RPM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  filterCountries,
  sortCountries,
  computeSummary,
  toGeoJSON,
  type DigitalRightsCountry,
  type DigitalRightsIndicators,
} from '../digital-rights'

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

// ─── Censorship Level Labels ─────────────────────────────────────────────────

describe('Censorship Level Labels', () => {
  it('should have exactly 5 levels', () => {
    expect(Object.keys(CENSORSHIP_LEVEL_LABELS).length).toBe(5)
  })

  it('Level 1 should be "Open"', () => {
    expect(CENSORSHIP_LEVEL_LABELS[1]).toBe('Open')
  })

  it('Level 5 should be "Shutdown"', () => {
    expect(CENSORSHIP_LEVEL_LABELS[5]).toBe('Shutdown')
  })
})

// ─── Registry Validation ────────────────────────────────────────────────────

describe('Registry Validation', () => {
  it('should contain at least 40 countries', () => {
    expect(COUNTRY_REGISTRY.length).toBeGreaterThanOrEqual(40)
  })

  it('should contain unique country codes', () => {
    const codes = COUNTRY_REGISTRY.map(c => c.code)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(codes.length)
  })

  it('all country codes should be 2 uppercase letters', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(c.code).toMatch(/^[A-Z]{2}$/)
    })
  })

  it('all countries should have required fields', () => {
    COUNTRY_REGISTRY.forEach(country => {
      expect(country.code).toBeDefined()
      expect(country.name).toBeDefined()
      expect(country.region).toBeDefined()
      expect(country.rights_status).toBeDefined()
      expect(country.indicators).toBeDefined()
      expect(country.trend).toBeDefined()
      expect(country.trend_detail).toBeDefined()
      expect(Array.isArray(country.top_threats)).toBe(true)
      expect(typeof country.population_m).toBe('number')
    })
  })

  it('rights_status should be one of: free, partly_free, not_free', () => {
    const valid = ['free', 'partly_free', 'not_free']
    COUNTRY_REGISTRY.forEach(c => {
      expect(valid).toContain(c.rights_status)
    })
  })

  it('censorship_level should be between 1 and 5', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(c.indicators.censorship_level).toBeGreaterThanOrEqual(1)
      expect(c.indicators.censorship_level).toBeLessThanOrEqual(5)
    })
  })

  it('internet_freedom_score should be between 0 and 100', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(c.indicators.internet_freedom_score).toBeGreaterThanOrEqual(0)
      expect(c.indicators.internet_freedom_score).toBeLessThanOrEqual(100)
    })
  })

  it('surveillance_score should be between 0 and 100', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(c.indicators.surveillance_score).toBeGreaterThanOrEqual(0)
      expect(c.indicators.surveillance_score).toBeLessThanOrEqual(100)
    })
  })

  it('data_protection_score should be between 0 and 100', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(c.indicators.data_protection_score).toBeGreaterThanOrEqual(0)
      expect(c.indicators.data_protection_score).toBeLessThanOrEqual(100)
    })
  })

  it('digital_access_index should be between 0 and 100', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(c.indicators.digital_access_index).toBeGreaterThanOrEqual(0)
      expect(c.indicators.digital_access_index).toBeLessThanOrEqual(100)
    })
  })

  it('top_threats should be an array', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(Array.isArray(c.top_threats)).toBe(true)
    })
  })

  it('trend should be one of: improving, declining, stable', () => {
    const validTrends = ['improving', 'declining', 'stable']
    COUNTRY_REGISTRY.forEach(c => {
      expect(validTrends).toContain(c.trend)
    })
  })

  it('population_m should be non-negative', () => {
    COUNTRY_REGISTRY.forEach(c => {
      expect(c.population_m).toBeGreaterThanOrEqual(0)
    })
  })
})

// ─── filterCountries ────────────────────────────────────────────────────────

describe('filterCountries', () => {
  it('should return all countries when no filters applied', () => {
    const result = filterCountries(COUNTRY_REGISTRY, {})
    expect(result.length).toBe(Math.min(COUNTRY_REGISTRY.length, DEFAULT_LIMIT))
  })

  it('should filter by region (case-insensitive)', () => {
    const result = filterCountries(COUNTRY_REGISTRY, { region: 'europe' })
    result.forEach(c => {
      expect(c.region.toLowerCase()).toBe('europe')
    })
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by rights_status', () => {
    const result = filterCountries(COUNTRY_REGISTRY, { rights_status: 'free' })
    result.forEach(c => {
      expect(c.rights_status).toBe('free')
    })
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by min_internet_freedom', () => {
    const min = 70
    const result = filterCountries(COUNTRY_REGISTRY, { min_internet_freedom: min })
    result.forEach(c => {
      expect(c.indicators.internet_freedom_score).toBeGreaterThanOrEqual(min)
    })
  })

  it('should search by country name', () => {
    const result = filterCountries(COUNTRY_REGISTRY, { q: 'united' })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(c => {
      const searchable = c.name.toLowerCase() + c.code.toLowerCase() + c.top_threats.join(' ').toLowerCase()
      expect(searchable.includes('united')).toBe(true)
    })
  })

  it('should search by top_threats', () => {
    const result = filterCountries(COUNTRY_REGISTRY, { q: 'surveillance' })
    expect(result.length).toBeGreaterThan(0)
  })

  it('should combine multiple filters', () => {
    const result = filterCountries(COUNTRY_REGISTRY, {
      rights_status: 'not_free',
      min_internet_freedom: 0,
    })
    result.forEach(c => {
      expect(c.rights_status).toBe('not_free')
    })
  })

  it('should respect limit and offset', () => {
    const page1 = filterCountries(COUNTRY_REGISTRY, { limit: 5, offset: 0 })
    const page2 = filterCountries(COUNTRY_REGISTRY, { limit: 5, offset: 5 })
    expect(page1.length).toBeLessThanOrEqual(5)
    expect(page2.length).toBeLessThanOrEqual(5)
    if (page1.length > 0 && page2.length > 0) {
      expect(page1[0].code).not.toBe(page2[0].code)
    }
  })
})

// ─── sortCountries ───────────────────────────────────────────────────────────

describe('sortCountries', () => {
  it('should sort by internet_freedom_score descending', () => {
    const result = sortCountries(COUNTRY_REGISTRY, 'internet_freedom_score', 'desc')
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].indicators.internet_freedom_score).toBeGreaterThanOrEqual(result[i + 1].indicators.internet_freedom_score)
    }
  })

  it('should sort by internet_freedom_score ascending', () => {
    const result = sortCountries(COUNTRY_REGISTRY, 'internet_freedom_score', 'asc')
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].indicators.internet_freedom_score).toBeLessThanOrEqual(result[i + 1].indicators.internet_freedom_score)
    }
  })

  it('should sort by name ascending', () => {
    const result = sortCountries(COUNTRY_REGISTRY, 'name', 'asc')
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].name.localeCompare(result[i + 1].name)).toBeLessThanOrEqual(0)
    }
  })

  it('should sort by censorship_level descending', () => {
    const result = sortCountries(COUNTRY_REGISTRY, 'censorship_level', 'desc')
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].indicators.censorship_level).toBeGreaterThanOrEqual(result[i + 1].indicators.censorship_level)
    }
  })

  it('should sort by surveillance_score descending', () => {
    const result = sortCountries(COUNTRY_REGISTRY, 'surveillance_score', 'desc')
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].indicators.surveillance_score).toBeGreaterThanOrEqual(result[i + 1].indicators.surveillance_score)
    }
  })
})

// ─── computeSummary ──────────────────────────────────────────────────────────

describe('computeSummary', () => {
  it('should compute correct total countries', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    expect(summary.total_countries).toBe(COUNTRY_REGISTRY.length)
  })

  it('rights status breakdown should sum to total_countries', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    const sum = summary.free + summary.partly_free + summary.not_free
    expect(sum).toBe(summary.total_countries)
  })

  it('should compute positive avg_internet_freedom', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    expect(summary.avg_internet_freedom).toBeGreaterThan(0)
    expect(summary.avg_internet_freedom).toBeLessThanOrEqual(100)
  })

  it('should compute positive avg_surveillance_score', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    expect(summary.avg_surveillance_score).toBeGreaterThan(0)
    expect(summary.avg_surveillance_score).toBeLessThanOrEqual(100)
  })

  it('should compute total_population_surveilled_m as non-negative', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    expect(summary.total_population_surveilled_m).toBeGreaterThanOrEqual(0)
  })

  it('most_restricted should be ordered by internet_freedom_score ascending', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    expect(summary.most_restricted.length).toBeGreaterThan(0)
    for (let i = 0; i < summary.most_restricted.length - 1; i++) {
      expect(summary.most_restricted[i].score).toBeLessThanOrEqual(summary.most_restricted[i + 1].score)
    }
  })

  it('most_restricted count should be at most 5', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    expect(summary.most_restricted.length).toBeLessThanOrEqual(5)
  })

  it('should include regional breakdown summing to total', () => {
    const summary = computeSummary(COUNTRY_REGISTRY)
    expect(summary.regional_breakdown.length).toBeGreaterThan(0)
    const regionSum = summary.regional_breakdown.reduce((acc, r) => acc + r.count, 0)
    expect(regionSum).toBe(summary.total_countries)
  })
})

// ─── toGeoJSON ───────────────────────────────────────────────────────────────

describe('toGeoJSON', () => {
  it('should return a FeatureCollection', () => {
    const geojson = toGeoJSON(COUNTRY_REGISTRY)
    expect(geojson.type).toBe('FeatureCollection')
  })

  it('should return an array of features', () => {
    const geojson = toGeoJSON(COUNTRY_REGISTRY)
    expect(Array.isArray(geojson.features)).toBe(true)
    expect(geojson.features.length).toBeGreaterThan(0)
  })

  it('each feature should have valid Point geometry with numeric coordinates', () => {
    const geojson = toGeoJSON(COUNTRY_REGISTRY)
    geojson.features.forEach(f => {
      expect(f.type).toBe('Feature')
      expect(f.geometry.type).toBe('Point')
      expect(Array.isArray(f.geometry.coordinates)).toBe(true)
      expect(f.geometry.coordinates.length).toBe(2)
      expect(typeof f.geometry.coordinates[0]).toBe('number')
      expect(typeof f.geometry.coordinates[1]).toBe('number')
    })
  })
})

// ─── Key Country Presence ────────────────────────────────────────────────────

describe('Key Country Presence', () => {
  it('China (CN) should be present and not_free', () => {
    const cn = COUNTRY_REGISTRY.find(c => c.code === 'CN')
    expect(cn).toBeDefined()
    expect(cn?.rights_status).toBe('not_free')
    expect(cn?.indicators.internet_freedom_score).toBeLessThan(20)
  })

  it('Iran (IR) should be present and not_free', () => {
    const ir = COUNTRY_REGISTRY.find(c => c.code === 'IR')
    expect(ir).toBeDefined()
    expect(ir?.rights_status).toBe('not_free')
  })

  it('Estonia (EE) should be present and free (digital rights leader)', () => {
    const ee = COUNTRY_REGISTRY.find(c => c.code === 'EE')
    expect(ee).toBeDefined()
    expect(ee?.rights_status).toBe('free')
    expect(ee?.indicators.internet_freedom_score).toBeGreaterThan(80)
  })
})
