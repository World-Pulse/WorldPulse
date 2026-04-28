/**
 * Food Security Intelligence API — Test Suite
 *
 * 45 test cases covering:
 * - Constants validation (6)
 * - Registry validation (12)
 * - filterRegions (8)
 * - sortRegions (5)
 * - computeSummary (8)
 * - toGeoJSON (3)
 * - Key country presence (3)
 */

import { describe, it, expect } from 'vitest'
import {
  FOOD_SECURITY_REGISTRY,
  LIST_CACHE_TTL,
  SUMMARY_CACHE_TTL,
  MAP_CACHE_TTL,
  RATE_LIMIT_RPM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  IPC_LABELS,
  filterRegions,
  sortRegions,
  computeSummary,
  toGeoJSON,
  type FoodSecurityRegion,
  type CrisisLevel,
  type IPCPhase,
} from '../food-security'

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

// ─── IPC Labels ─────────────────────────────────────────────────────────────

describe('IPC Phase Labels', () => {
  it('should have all 5 IPC phases', () => {
    expect(Object.keys(IPC_LABELS)).toHaveLength(5)
  })

  it('Phase 1 should be Minimal', () => {
    expect(IPC_LABELS[1 as IPCPhase]).toBe('Minimal')
  })

  it('Phase 5 should be Famine', () => {
    expect(IPC_LABELS[5 as IPCPhase]).toBe('Famine')
  })
})

// ─── Registry Validation ────────────────────────────────────────────────────

describe('Food Security Registry', () => {
  it('should contain at least 40 countries', () => {
    expect(FOOD_SECURITY_REGISTRY.length).toBeGreaterThanOrEqual(40)
  })

  it('all entries should have unique codes', () => {
    const codes = FOOD_SECURITY_REGISTRY.map(r => r.code)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })

  it('all entries should have a valid code (2 uppercase letters)', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.code).toMatch(/^[A-Z]{2}$/)
    })
  })

  it('all entries should have a non-empty name', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.name.length).toBeGreaterThan(0)
    })
  })

  it('all entries should have a non-empty continent', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.continent.length).toBeGreaterThan(0)
    })
  })

  it('all crisis_level values should be valid', () => {
    const valid: CrisisLevel[] = ['stable', 'watch', 'crisis', 'emergency', 'famine']
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(valid).toContain(r.crisis_level)
    })
  })

  it('all IPC phases should be between 1 and 5', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.indicators.ipc_phase).toBeGreaterThanOrEqual(1)
      expect(r.indicators.ipc_phase).toBeLessThanOrEqual(5)
    })
  })

  it('hunger_index should be between 0 and 100', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.indicators.hunger_index).toBeGreaterThanOrEqual(0)
      expect(r.indicators.hunger_index).toBeLessThanOrEqual(100)
    })
  })

  it('cropland_stress_pct should be between 0 and 100', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.indicators.cropland_stress_pct).toBeGreaterThanOrEqual(0)
      expect(r.indicators.cropland_stress_pct).toBeLessThanOrEqual(100)
    })
  })

  it('all entries should have at least one top_threat', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.top_threats.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('population_m should be positive for all entries', () => {
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(r.population_m).toBeGreaterThan(0)
    })
  })

  it('trend should be one of improving, declining, stable', () => {
    const validTrends = ['improving', 'declining', 'stable']
    FOOD_SECURITY_REGISTRY.forEach(r => {
      expect(validTrends).toContain(r.trend)
    })
  })
})

// ─── filterRegions ──────────────────────────────────────────────────────────

describe('filterRegions', () => {
  it('should return all entries when no filters applied', () => {
    const result = filterRegions(FOOD_SECURITY_REGISTRY, {})
    expect(result.length).toBe(FOOD_SECURITY_REGISTRY.length)
  })

  it('should filter by continent', () => {
    const result = filterRegions(FOOD_SECURITY_REGISTRY, { continent: 'Africa' })
    result.forEach(r => {
      expect(r.continent).toBe('Africa')
    })
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by continent case-insensitively', () => {
    const result = filterRegions(FOOD_SECURITY_REGISTRY, { continent: 'africa' })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(r => {
      expect(r.continent.toLowerCase()).toBe('africa')
    })
  })

  it('should filter by crisis_level', () => {
    const result = filterRegions(FOOD_SECURITY_REGISTRY, { crisis_level: 'famine' })
    result.forEach(r => {
      expect(r.crisis_level).toBe('famine')
    })
  })

  it('should filter by min_hunger_index', () => {
    const threshold = 40
    const result = filterRegions(FOOD_SECURITY_REGISTRY, { min_hunger_index: threshold })
    result.forEach(r => {
      expect(r.indicators.hunger_index).toBeGreaterThanOrEqual(threshold)
    })
  })

  it('should filter by search query matching name', () => {
    const result = filterRegions(FOOD_SECURITY_REGISTRY, { search: 'Somalia' })
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].code).toBe('SO')
  })

  it('should filter by search query matching threat', () => {
    const result = filterRegions(FOOD_SECURITY_REGISTRY, { search: 'drought' })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(r => {
      const matchesThreat = r.top_threats.some(t => t.toLowerCase().includes('drought'))
      const matchesName = r.name.toLowerCase().includes('drought')
      expect(matchesThreat || matchesName).toBe(true)
    })
  })

  it('should combine multiple filters', () => {
    const result = filterRegions(FOOD_SECURITY_REGISTRY, {
      continent: 'Africa',
      crisis_level: 'emergency',
    })
    result.forEach(r => {
      expect(r.continent).toBe('Africa')
      expect(r.crisis_level).toBe('emergency')
    })
  })
})

// ─── sortRegions ────────────────────────────────────────────────────────────

describe('sortRegions', () => {
  it('should sort by hunger_index descending by default', () => {
    const result = sortRegions(FOOD_SECURITY_REGISTRY)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].indicators.hunger_index).toBeGreaterThanOrEqual(
        result[i].indicators.hunger_index
      )
    }
  })

  it('should sort by hunger_index ascending', () => {
    const result = sortRegions(FOOD_SECURITY_REGISTRY, 'hunger_index', 'asc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].indicators.hunger_index).toBeLessThanOrEqual(
        result[i].indicators.hunger_index
      )
    }
  })

  it('should sort by name ascending', () => {
    const result = sortRegions(FOOD_SECURITY_REGISTRY, 'name', 'asc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].name.localeCompare(result[i].name)).toBeLessThanOrEqual(0)
    }
  })

  it('should sort by ipc_phase descending', () => {
    const result = sortRegions(FOOD_SECURITY_REGISTRY, 'ipc_phase', 'desc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].indicators.ipc_phase).toBeGreaterThanOrEqual(
        result[i].indicators.ipc_phase
      )
    }
  })

  it('should sort by population_food_insecure descending', () => {
    const result = sortRegions(FOOD_SECURITY_REGISTRY, 'population_food_insecure', 'desc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].indicators.population_food_insecure_m).toBeGreaterThanOrEqual(
        result[i].indicators.population_food_insecure_m
      )
    }
  })
})

// ─── computeSummary ─────────────────────────────────────────────────────────

describe('computeSummary', () => {
  const summary = computeSummary(FOOD_SECURITY_REGISTRY)

  it('total_regions should match registry length', () => {
    expect(summary.total_regions).toBe(FOOD_SECURITY_REGISTRY.length)
  })

  it('crisis level counts should sum to total', () => {
    const sum = summary.stable + summary.watch + summary.crisis + summary.emergency + summary.famine
    expect(sum).toBe(summary.total_regions)
  })

  it('avg_hunger_index should be reasonable (5-60)', () => {
    expect(summary.avg_hunger_index).toBeGreaterThanOrEqual(5)
    expect(summary.avg_hunger_index).toBeLessThanOrEqual(60)
  })

  it('avg_food_price_index should be reasonable (100-300)', () => {
    expect(summary.avg_food_price_index).toBeGreaterThanOrEqual(100)
    expect(summary.avg_food_price_index).toBeLessThanOrEqual(300)
  })

  it('total_food_insecure_m should be positive', () => {
    expect(summary.total_food_insecure_m).toBeGreaterThan(0)
  })

  it('most_affected should have at most 5 entries', () => {
    expect(summary.most_affected.length).toBeLessThanOrEqual(5)
    expect(summary.most_affected.length).toBeGreaterThan(0)
  })

  it('most_affected should be sorted by hunger_index descending', () => {
    for (let i = 1; i < summary.most_affected.length; i++) {
      expect(summary.most_affected[i - 1].hunger_index).toBeGreaterThanOrEqual(
        summary.most_affected[i].hunger_index
      )
    }
  })

  it('continent_breakdown should have at least 3 continents', () => {
    expect(summary.continent_breakdown.length).toBeGreaterThanOrEqual(3)
  })
})

// ─── toGeoJSON ──────────────────────────────────────────────────────────────

describe('toGeoJSON', () => {
  const geojson = toGeoJSON(FOOD_SECURITY_REGISTRY)

  it('should return a FeatureCollection', () => {
    expect(geojson.type).toBe('FeatureCollection')
  })

  it('should have features array', () => {
    expect(Array.isArray(geojson.features)).toBe(true)
    expect(geojson.features.length).toBeGreaterThan(0)
  })

  it('each feature should have Point geometry with valid coordinates', () => {
    geojson.features.forEach(f => {
      expect(f.type).toBe('Feature')
      expect(f.geometry.type).toBe('Point')
      expect(f.geometry.coordinates).toHaveLength(2)
      const [lng, lat] = f.geometry.coordinates
      expect(lng).toBeGreaterThanOrEqual(-180)
      expect(lng).toBeLessThanOrEqual(180)
      expect(lat).toBeGreaterThanOrEqual(-90)
      expect(lat).toBeLessThanOrEqual(90)
    })
  })
})

// ─── Key Country Presence ───────────────────────────────────────────────────

describe('Key Country Presence', () => {
  it('should include Somalia (highest hunger index in Africa)', () => {
    const so = FOOD_SECURITY_REGISTRY.find(r => r.code === 'SO')
    expect(so).toBeDefined()
    expect(so!.crisis_level).toBe('famine')
  })

  it('should include Yemen (MENA crisis)', () => {
    const ye = FOOD_SECURITY_REGISTRY.find(r => r.code === 'YE')
    expect(ye).toBeDefined()
    expect(ye!.crisis_level).toBe('famine')
  })

  it('should include India (largest food insecure population)', () => {
    const india = FOOD_SECURITY_REGISTRY.find(r => r.code === 'IN')
    expect(india).toBeDefined()
    expect(india!.indicators.population_food_insecure_m).toBeGreaterThan(100)
  })
})
