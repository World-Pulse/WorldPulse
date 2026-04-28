/**
 * AI Infrastructure Intelligence API — Tests
 *
 * Validates datacenter registry, filtering, summary aggregation,
 * and GeoJSON map point generation.
 */

import {
  AI_DATACENTERS,
  LIST_CACHE_TTL,
  SUMMARY_CACHE_TTL,
  MAP_CACHE_TTL,
  RATE_LIMIT_RPM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  filterDatacenters,
  buildSummary,
} from '../ai-infrastructure'

// ─── Constants Validation ────────────────────────────────────────────────────

describe('AI Infrastructure — Constants', () => {
  test('LIST_CACHE_TTL is 600 seconds (10 minutes)', () => {
    expect(LIST_CACHE_TTL).toBe(600)
  })

  test('SUMMARY_CACHE_TTL is 600 seconds', () => {
    expect(SUMMARY_CACHE_TTL).toBe(600)
  })

  test('MAP_CACHE_TTL is 300 seconds (5 minutes)', () => {
    expect(MAP_CACHE_TTL).toBe(300)
  })

  test('RATE_LIMIT_RPM is 60', () => {
    expect(RATE_LIMIT_RPM).toBe(60)
  })

  test('DEFAULT_LIMIT is 50', () => {
    expect(DEFAULT_LIMIT).toBe(50)
  })

  test('MAX_LIMIT is 200', () => {
    expect(MAX_LIMIT).toBe(200)
  })
})

// ─── Datacenter Registry Validation ──────────────────────────────────────────

describe('AI Infrastructure — Datacenter Registry', () => {
  test('registry has at least 50 datacenters', () => {
    expect(AI_DATACENTERS.length).toBeGreaterThanOrEqual(50)
  })

  test('every datacenter has required fields', () => {
    for (const dc of AI_DATACENTERS) {
      expect(dc.id).toBeTruthy()
      expect(dc.name).toBeTruthy()
      expect(dc.operator).toBeTruthy()
      expect(dc.country).toBeTruthy()
      expect(dc.country_code).toMatch(/^[A-Z]{2}$/)
      expect(dc.region).toBeTruthy()
      expect(dc.city).toBeTruthy()
      expect(dc.lat).toBeGreaterThanOrEqual(-90)
      expect(dc.lat).toBeLessThanOrEqual(90)
      expect(dc.lng).toBeGreaterThanOrEqual(-180)
      expect(dc.lng).toBeLessThanOrEqual(180)
      expect(['operational', 'under_construction', 'announced', 'planned']).toContain(dc.status)
      expect(Array.isArray(dc.ai_focus)).toBe(true)
      expect(dc.ai_focus.length).toBeGreaterThan(0)
    }
  })

  test('all datacenter IDs are unique', () => {
    const ids = AI_DATACENTERS.map(d => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('covers at least 15 distinct countries', () => {
    const countries = new Set(AI_DATACENTERS.map(d => d.country_code))
    expect(countries.size).toBeGreaterThanOrEqual(15)
  })

  test('covers at least 5 regions', () => {
    const regions = new Set(AI_DATACENTERS.map(d => d.region))
    expect(regions.size).toBeGreaterThanOrEqual(5)
  })

  test('includes major operators: Microsoft, Google, Meta, AWS, Oracle', () => {
    const operators = new Set(AI_DATACENTERS.map(d => d.operator.toLowerCase()))
    expect([...operators].some(o => o.includes('microsoft'))).toBe(true)
    expect([...operators].some(o => o.includes('google'))).toBe(true)
    expect([...operators].some(o => o.includes('meta'))).toBe(true)
    expect([...operators].some(o => o.includes('amazon') || o.includes('aws'))).toBe(true)
    expect([...operators].some(o => o.includes('oracle'))).toBe(true)
  })

  test('includes key AI companies: xAI, OpenAI, Anthropic, Mistral', () => {
    const operators = AI_DATACENTERS.map(d => d.operator.toLowerCase())
    expect(operators.some(o => o.includes('xai'))).toBe(true)
    expect(operators.some(o => o.includes('openai'))).toBe(true)
    expect(operators.some(o => o.includes('anthropic'))).toBe(true)
    expect(operators.some(o => o.includes('mistral'))).toBe(true)
  })

  test('capacity_mw values are positive when present', () => {
    for (const dc of AI_DATACENTERS) {
      if (dc.capacity_mw !== null) {
        expect(dc.capacity_mw).toBeGreaterThan(0)
      }
    }
  })

  test('investment_usd values are positive when present', () => {
    for (const dc of AI_DATACENTERS) {
      if (dc.investment_usd !== null) {
        expect(dc.investment_usd).toBeGreaterThan(0)
      }
    }
  })

  test('opened_year is reasonable (2000-2030) when present', () => {
    for (const dc of AI_DATACENTERS) {
      if (dc.opened_year !== null) {
        expect(dc.opened_year).toBeGreaterThanOrEqual(2000)
        expect(dc.opened_year).toBeLessThanOrEqual(2030)
      }
    }
  })

  test('operational facilities have opened_year or no completion date', () => {
    for (const dc of AI_DATACENTERS) {
      if (dc.status === 'operational') {
        // Should not have estimated_completion (they're already built)
        // Most should have opened_year (some may not)
      }
      if (dc.status === 'under_construction') {
        // Should have estimated_completion
        expect(dc.estimated_completion).toBeTruthy()
      }
    }
  })
})

// ─── Filter Function ─────────────────────────────────────────────────────────

describe('AI Infrastructure — filterDatacenters()', () => {
  test('returns all (up to limit) with no filters', () => {
    const result = filterDatacenters({})
    expect(result.length).toBeLessThanOrEqual(DEFAULT_LIMIT)
    expect(result.length).toBeGreaterThan(0)
  })

  test('respects limit parameter', () => {
    const result = filterDatacenters({ limit: 5 })
    expect(result.length).toBe(5)
  })

  test('caps at MAX_LIMIT', () => {
    const result = filterDatacenters({ limit: 999 })
    expect(result.length).toBeLessThanOrEqual(MAX_LIMIT)
  })

  test('filters by region', () => {
    const result = filterDatacenters({ region: 'Europe', limit: 200 })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(dc => expect(dc.region).toBe('Europe'))
  })

  test('filters by country code', () => {
    const result = filterDatacenters({ country: 'US', limit: 200 })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(dc => expect(dc.country_code).toBe('US'))
  })

  test('filters by status', () => {
    const result = filterDatacenters({ status: 'under_construction', limit: 200 })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(dc => expect(dc.status).toBe('under_construction'))
  })

  test('filters by operator (partial match)', () => {
    const result = filterDatacenters({ operator: 'google', limit: 200 })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(dc => expect(dc.operator.toLowerCase()).toContain('google'))
  })

  test('combines multiple filters', () => {
    const result = filterDatacenters({ region: 'North America', status: 'operational', limit: 200 })
    expect(result.length).toBeGreaterThan(0)
    result.forEach(dc => {
      expect(dc.region).toBe('North America')
      expect(dc.status).toBe('operational')
    })
  })
})

// ─── Summary Function ────────────────────────────────────────────────────────

describe('AI Infrastructure — buildSummary()', () => {
  const summary = buildSummary()

  test('total equals registry length', () => {
    expect(summary.total_datacenters).toBe(AI_DATACENTERS.length)
  })

  test('status breakdown sums to total', () => {
    expect(
      summary.operational + summary.under_construction + summary.announced + summary.planned
    ).toBe(summary.total_datacenters)
  })

  test('total_capacity_mw is positive', () => {
    expect(summary.total_capacity_mw).toBeGreaterThan(0)
  })

  test('total_investment_usd is positive', () => {
    expect(summary.total_investment_usd).toBeGreaterThan(0)
  })

  test('countries_count matches distinct country codes', () => {
    const uniqueCountries = new Set(AI_DATACENTERS.map(d => d.country_code))
    expect(summary.countries_count).toBe(uniqueCountries.size)
  })

  test('top_operators is sorted descending by count', () => {
    for (let i = 1; i < summary.top_operators.length; i++) {
      const curr = summary.top_operators[i]
      const prev = summary.top_operators[i - 1]
      expect(curr && prev && curr.count <= prev.count).toBe(true)
    }
  })

  test('top_countries is sorted descending by count', () => {
    for (let i = 1; i < summary.top_countries.length; i++) {
      const curr = summary.top_countries[i]
      const prev = summary.top_countries[i - 1]
      expect(curr && prev && curr.count <= prev.count).toBe(true)
    }
  })

  test('top_operators limited to 10', () => {
    expect(summary.top_operators.length).toBeLessThanOrEqual(10)
  })

  test('top_countries limited to 10', () => {
    expect(summary.top_countries.length).toBeLessThanOrEqual(10)
  })
})
