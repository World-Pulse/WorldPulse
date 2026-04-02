/**
 * Undersea Cable Intelligence API — Test Suite
 *
 * 25 test cases covering:
 * - Constants validation (6)
 * - Registry validation (10)
 * - filterCables (5)
 * - buildSummary (4)
 */

import { describe, it, expect } from 'vitest'
import {
  CABLE_REGISTRY,
  LIST_CACHE_TTL,
  SUMMARY_CACHE_TTL,
  MAP_CACHE_TTL,
  RATE_LIMIT_RPM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  filterCables,
  buildSummary,
  type SubmarineCable,
  type LandingPoint,
} from '../undersea-cables'

// ─── Constants ──────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('LIST_CACHE_TTL should be 600 seconds', () => {
    expect(LIST_CACHE_TTL).toBe(600)
  })

  it('SUMMARY_CACHE_TTL should be 600 seconds', () => {
    expect(SUMMARY_CACHE_TTL).toBe(600)
  })

  it('MAP_CACHE_TTL should be 300 seconds', () => {
    expect(MAP_CACHE_TTL).toBe(300)
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

describe('CABLE_REGISTRY', () => {
  it('should have at least 40 cables', () => {
    expect(CABLE_REGISTRY.length).toBeGreaterThanOrEqual(40)
  })

  it('all cables should have required fields', () => {
    for (const cable of CABLE_REGISTRY) {
      expect(cable.id).toBeTruthy()
      expect(cable.name).toBeTruthy()
      expect(cable.slug).toBeTruthy()
      expect(cable.owners.length).toBeGreaterThan(0)
      expect(cable.operators.length).toBeGreaterThan(0)
      expect(cable.landing_points.length).toBeGreaterThanOrEqual(2)
      expect(['active', 'under_construction', 'planned', 'decommissioned']).toContain(cable.status)
      expect(cable.route_coords.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('all cable IDs should be unique', () => {
    const ids = CABLE_REGISTRY.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('should connect at least 25 countries', () => {
    const countries = new Set<string>()
    for (const cable of CABLE_REGISTRY) {
      for (const lp of cable.landing_points) {
        countries.add(lp.country_code)
      }
    }
    expect(countries.size).toBeGreaterThanOrEqual(25)
  })

  it('should span at least 5 ocean regions', () => {
    // Check presence of cables landing in different hemispheres/regions
    const hasNorthAmerica = CABLE_REGISTRY.some(c => c.landing_points.some(lp => lp.country_code === 'US' || lp.country_code === 'CA'))
    const hasEurope = CABLE_REGISTRY.some(c => c.landing_points.some(lp => ['GB', 'FR', 'ES', 'DE', 'IT', 'PT', 'NO', 'DK', 'FI', 'IE'].includes(lp.country_code)))
    const hasAsia = CABLE_REGISTRY.some(c => c.landing_points.some(lp => ['JP', 'SG', 'KR', 'IN', 'CN', 'HK', 'TW', 'ID', 'PH'].includes(lp.country_code)))
    const hasAfrica = CABLE_REGISTRY.some(c => c.landing_points.some(lp => ['ZA', 'NG', 'KE', 'AO', 'DJ', 'EG', 'DZ', 'TN', 'TG'].includes(lp.country_code)))
    const hasSouthAmerica = CABLE_REGISTRY.some(c => c.landing_points.some(lp => ['BR', 'AR', 'CL', 'UY', 'CO'].includes(lp.country_code)))
    const hasOceania = CABLE_REGISTRY.some(c => c.landing_points.some(lp => ['AU', 'NZ', 'PG', 'SB'].includes(lp.country_code)))

    expect(hasNorthAmerica).toBe(true)
    expect(hasEurope).toBe(true)
    expect(hasAsia).toBe(true)
    expect(hasAfrica).toBe(true)
    expect(hasSouthAmerica).toBe(true)
    expect(hasOceania).toBe(true)
  })

  it('should include major tech company cables', () => {
    const owners = new Set(CABLE_REGISTRY.flatMap(c => c.owners))
    expect(owners.has('Google')).toBe(true)
    expect(owners.has('Meta')).toBe(true)
    expect(owners.has('Microsoft')).toBe(true)
    expect(owners.has('Amazon')).toBe(true)
  })

  it('all cables should have positive or null length_km', () => {
    for (const cable of CABLE_REGISTRY) {
      if (cable.length_km !== null) {
        expect(cable.length_km).toBeGreaterThan(0)
      }
    }
  })

  it('all cables should have positive or null capacity_tbps', () => {
    for (const cable of CABLE_REGISTRY) {
      if (cable.capacity_tbps !== null) {
        expect(cable.capacity_tbps).toBeGreaterThan(0)
      }
    }
  })

  it('all landing points should have valid coordinates', () => {
    for (const cable of CABLE_REGISTRY) {
      for (const lp of cable.landing_points) {
        expect(lp.lat).toBeGreaterThanOrEqual(-90)
        expect(lp.lat).toBeLessThanOrEqual(90)
        expect(lp.lng).toBeGreaterThanOrEqual(-180)
        expect(lp.lng).toBeLessThanOrEqual(180)
        expect(lp.country_code.length).toBe(2)
      }
    }
  })

  it('should have at least 3 under_construction or planned cables', () => {
    const future = CABLE_REGISTRY.filter(c => c.status === 'under_construction' || c.status === 'planned')
    expect(future.length).toBeGreaterThanOrEqual(3)
  })
})

// ─── filterCables ───────────────────────────────────────────────────────────

describe('filterCables', () => {
  it('should return all cables with no filter (up to DEFAULT_LIMIT)', () => {
    const result = filterCables(CABLE_REGISTRY, {})
    expect(result.length).toBeLessThanOrEqual(DEFAULT_LIMIT)
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by status', () => {
    const result = filterCables(CABLE_REGISTRY, { status: 'active' })
    for (const cable of result) {
      expect(cable.status).toBe('active')
    }
  })

  it('should filter by owner (case-insensitive)', () => {
    const result = filterCables(CABLE_REGISTRY, { owner: 'google' })
    for (const cable of result) {
      const allCompanies = [...cable.owners, ...cable.operators]
      expect(allCompanies.some(o => o.toLowerCase().includes('google'))).toBe(true)
    }
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by country', () => {
    const result = filterCables(CABLE_REGISTRY, { country: 'JP' })
    for (const cable of result) {
      expect(cable.landing_points.some(lp => lp.country_code === 'JP')).toBe(true)
    }
    expect(result.length).toBeGreaterThan(0)
  })

  it('should respect MAX_LIMIT', () => {
    const result = filterCables(CABLE_REGISTRY, { limit: 999 })
    expect(result.length).toBeLessThanOrEqual(MAX_LIMIT)
  })
})

// ─── buildSummary ───────────────────────────────────────────────────────────

describe('buildSummary', () => {
  const summary = buildSummary(CABLE_REGISTRY)

  it('total_cables should equal registry length', () => {
    expect(summary.total_cables).toBe(CABLE_REGISTRY.length)
  })

  it('status breakdown should sum to total', () => {
    const sum = summary.active + summary.under_construction + summary.planned + summary.decommissioned
    expect(sum).toBe(summary.total_cables)
  })

  it('should have positive total_length_km and total_capacity_tbps', () => {
    expect(summary.total_length_km).toBeGreaterThan(0)
    expect(summary.total_capacity_tbps).toBeGreaterThan(0)
  })

  it('top_owners should be sorted by count descending', () => {
    for (let i = 1; i < summary.top_owners.length; i++) {
      expect(summary.top_owners[i - 1]!.count).toBeGreaterThanOrEqual(summary.top_owners[i]!.count)
    }
  })
})
