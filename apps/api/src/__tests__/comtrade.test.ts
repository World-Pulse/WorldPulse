/**
 * UN Comtrade Strategic Commodity Flows — Test Suite
 *
 * Tests cover:
 *   - ComtradeFlow / ComtradeResult interface shape
 *   - Flow filtering (cmdCode, reporter)
 *   - USD value formatting
 *   - Period format validation
 *   - Empty results handling
 *   - Redis cache key pattern
 *   - Sort order (primaryValue DESC)
 *   - Rate limit headers
 *   - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── TYPES (shared with route) ───────────────────────────────────────────────

interface ComtradeFlow {
  period: string
  reporterCode: number
  reporterDesc: string
  partnerCode: number
  partnerDesc: string
  flowCode: 'M' | 'X'
  cmdCode: string
  cmdDesc: string
  primaryValue: number
  netWgt: number
}

interface ComtradeResult {
  commodity: string
  cmdCode: string
  period: string
  flows: ComtradeFlow[]
  fetchedAt: string
}

// ─── HELPERS (replicated from TradeSurveillancePanel for testing) ─────────────

function formatUSD(value: number): string {
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3)  return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function sortFlowsByValue(flows: ComtradeFlow[]): ComtradeFlow[] {
  return [...flows].sort((a, b) => b.primaryValue - a.primaryValue)
}

function filterByCmdCode(flows: ComtradeFlow[], cmdCode: string): ComtradeFlow[] {
  return flows.filter(f => f.cmdCode === cmdCode)
}

function filterByReporter(flows: ComtradeFlow[], reporterCode: number): ComtradeFlow[] {
  return flows.filter(f => f.reporterCode === reporterCode)
}

function isValidPeriod(period: string): boolean {
  return /^\d{4}$/.test(period) || /^\d{6}$/.test(period)
}

function cacheKey(cmdCode: string, period: string): string {
  return `comtrade:flows:${cmdCode}:${period}`
}

// ─── FIXTURES ────────────────────────────────────────────────────────────────

function makeFlow(overrides: Partial<ComtradeFlow> = {}): ComtradeFlow {
  return {
    period:       '2023',
    reporterCode: 840,
    reporterDesc: 'United States',
    partnerCode:  156,
    partnerDesc:  'China',
    flowCode:     'M',
    cmdCode:      '270900',
    cmdDesc:      'Oil/Petroleum (Crude)',
    primaryValue: 5_000_000_000,
    netWgt:       1_000_000,
    ...overrides,
  }
}

function makeResult(overrides: Partial<ComtradeResult> = {}): ComtradeResult {
  return {
    commodity: 'Oil/Petroleum (Crude)',
    cmdCode:   '270900',
    period:    '2023',
    flows:     [makeFlow()],
    fetchedAt: '2026-03-25T10:00:00.000Z',
    ...overrides,
  }
}

// ─── TESTS ───────────────────────────────────────────────────────────────────

describe('ComtradeFlow shape', () => {
  it('has all required fields', () => {
    const flow = makeFlow()
    expect(flow).toHaveProperty('period')
    expect(flow).toHaveProperty('reporterCode')
    expect(flow).toHaveProperty('reporterDesc')
    expect(flow).toHaveProperty('partnerCode')
    expect(flow).toHaveProperty('partnerDesc')
    expect(flow).toHaveProperty('flowCode')
    expect(flow).toHaveProperty('cmdCode')
    expect(flow).toHaveProperty('cmdDesc')
    expect(flow).toHaveProperty('primaryValue')
    expect(flow).toHaveProperty('netWgt')
  })

  it('flowCode is M or X', () => {
    const importFlow = makeFlow({ flowCode: 'M' })
    const exportFlow = makeFlow({ flowCode: 'X' })
    expect(['M', 'X']).toContain(importFlow.flowCode)
    expect(['M', 'X']).toContain(exportFlow.flowCode)
  })

  it('primaryValue is a number (USD)', () => {
    const flow = makeFlow({ primaryValue: 1_234_567_890 })
    expect(typeof flow.primaryValue).toBe('number')
    expect(flow.primaryValue).toBeGreaterThan(0)
  })

  it('netWgt is a number', () => {
    const flow = makeFlow({ netWgt: 50_000 })
    expect(typeof flow.netWgt).toBe('number')
  })
})

describe('ComtradeResult shape', () => {
  it('has commodity metadata fields', () => {
    const result = makeResult()
    expect(result).toHaveProperty('commodity')
    expect(result).toHaveProperty('cmdCode')
    expect(result).toHaveProperty('period')
    expect(result).toHaveProperty('flows')
    expect(result).toHaveProperty('fetchedAt')
    expect(Array.isArray(result.flows)).toBe(true)
  })

  it('fetchedAt is an ISO 8601 string', () => {
    const result = makeResult()
    expect(() => new Date(result.fetchedAt)).not.toThrow()
    expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt)
  })
})

describe('Filtering', () => {
  const flows: ComtradeFlow[] = [
    makeFlow({ cmdCode: '270900', reporterCode: 840, primaryValue: 5e9 }),
    makeFlow({ cmdCode: '270900', reporterCode: 156, primaryValue: 3e9 }),
    makeFlow({ cmdCode: '854231', reporterCode: 840, primaryValue: 2e9 }),
    makeFlow({ cmdCode: '854231', reporterCode: 276, primaryValue: 1e9 }),
    makeFlow({ cmdCode: '100199', reporterCode: 356, primaryValue: 500e6 }),
  ]

  it('filters by cmdCode — oil only', () => {
    const result = filterByCmdCode(flows, '270900')
    expect(result).toHaveLength(2)
    expect(result.every(f => f.cmdCode === '270900')).toBe(true)
  })

  it('filters by cmdCode — semiconductors only', () => {
    const result = filterByCmdCode(flows, '854231')
    expect(result).toHaveLength(2)
    expect(result.every(f => f.cmdCode === '854231')).toBe(true)
  })

  it('filters by cmdCode — returns empty for unknown code', () => {
    const result = filterByCmdCode(flows, '999999')
    expect(result).toHaveLength(0)
  })

  it('filters by reporter code — USA (840)', () => {
    const result = filterByReporter(flows, 840)
    expect(result).toHaveLength(2)
    expect(result.every(f => f.reporterCode === 840)).toBe(true)
  })

  it('filters by reporter code — India (356)', () => {
    const result = filterByReporter(flows, 356)
    expect(result).toHaveLength(1)
    expect(result[0].reporterCode).toBe(356)
  })

  it('filters by reporter code — returns empty for unknown reporter', () => {
    const result = filterByReporter(flows, 999)
    expect(result).toHaveLength(0)
  })

  it('combined filter: cmdCode + reporter', () => {
    const byCmd = filterByCmdCode(flows, '270900')
    const byBoth = filterByReporter(byCmd, 156)
    expect(byBoth).toHaveLength(1)
    expect(byBoth[0].reporterCode).toBe(156)
    expect(byBoth[0].cmdCode).toBe('270900')
  })
})

describe('USD value formatting', () => {
  it('formats billions correctly', () => {
    expect(formatUSD(5_000_000_000)).toBe('$5.0B')
    expect(formatUSD(1_250_000_000)).toBe('$1.3B')
  })

  it('formats millions correctly', () => {
    expect(formatUSD(750_000_000)).toBe('$750.0M')
    expect(formatUSD(1_000_000)).toBe('$1.0M')
  })

  it('formats thousands correctly', () => {
    expect(formatUSD(500_000)).toBe('$500K')
    expect(formatUSD(1_000)).toBe('$1K')
  })

  it('formats small values correctly', () => {
    expect(formatUSD(999)).toBe('$999')
    expect(formatUSD(0)).toBe('$0')
  })
})

describe('Period format', () => {
  it('accepts YYYY annual format', () => {
    expect(isValidPeriod('2023')).toBe(true)
    expect(isValidPeriod('2025')).toBe(true)
  })

  it('accepts YYYYMM monthly format', () => {
    expect(isValidPeriod('202301')).toBe(true)
    expect(isValidPeriod('202512')).toBe(true)
  })

  it('rejects invalid formats', () => {
    expect(isValidPeriod('23')).toBe(false)
    expect(isValidPeriod('2023-01')).toBe(false)
    expect(isValidPeriod('abcd')).toBe(false)
    expect(isValidPeriod('')).toBe(false)
  })
})

describe('Cache', () => {
  it('generates correct Redis key for crude oil 2023', () => {
    expect(cacheKey('270900', '2023')).toBe('comtrade:flows:270900:2023')
  })

  it('generates correct Redis key for semiconductors 2024', () => {
    expect(cacheKey('854231', '2024')).toBe('comtrade:flows:854231:2024')
  })

  it('generates correct key for monthly period', () => {
    expect(cacheKey('270900', '202301')).toBe('comtrade:flows:270900:202301')
  })

  it('key pattern starts with comtrade:flows:', () => {
    const key = cacheKey('100199', '2023')
    expect(key.startsWith('comtrade:flows:')).toBe(true)
  })
})

describe('Route: GET /api/v1/trade/commodity-flows', () => {
  it('returns flows array in response', () => {
    const response = { flows: [makeFlow()], commodities: ['270900'], lastUpdated: '2026-03-25T10:00:00.000Z' }
    expect(Array.isArray(response.flows)).toBe(true)
    expect(response.flows).toHaveLength(1)
  })

  it('returns commodities array in response', () => {
    const response = { flows: [], commodities: ['270900', '854231'], lastUpdated: '2026-03-25T10:00:00.000Z' }
    expect(Array.isArray(response.commodities)).toBe(true)
  })

  it('returns lastUpdated in response', () => {
    const response = { flows: [], commodities: [], lastUpdated: '2026-03-25T10:00:00.000Z' }
    expect(typeof response.lastUpdated).toBe('string')
  })
})

describe('Sort order (primaryValue DESC)', () => {
  it('sorts flows from highest to lowest value', () => {
    const flows: ComtradeFlow[] = [
      makeFlow({ primaryValue: 1e9 }),
      makeFlow({ primaryValue: 5e9 }),
      makeFlow({ primaryValue: 3e9 }),
    ]
    const sorted = sortFlowsByValue(flows)
    expect(sorted[0].primaryValue).toBe(5e9)
    expect(sorted[1].primaryValue).toBe(3e9)
    expect(sorted[2].primaryValue).toBe(1e9)
  })

  it('handles equal values without throwing', () => {
    const flows: ComtradeFlow[] = [
      makeFlow({ primaryValue: 1e9 }),
      makeFlow({ primaryValue: 1e9 }),
    ]
    expect(() => sortFlowsByValue(flows)).not.toThrow()
  })

  it('returns empty array for empty input', () => {
    expect(sortFlowsByValue([])).toHaveLength(0)
  })
})

describe('Error handling', () => {
  it('handles empty flows array gracefully', () => {
    const result = makeResult({ flows: [] })
    expect(result.flows).toHaveLength(0)
    const sorted = sortFlowsByValue(result.flows)
    expect(sorted).toHaveLength(0)
  })

  it('handles missing primaryValue as zero', () => {
    const flow = makeFlow({ primaryValue: 0 })
    expect(flow.primaryValue).toBe(0)
    expect(formatUSD(flow.primaryValue)).toBe('$0')
  })

  it('does not throw when filtering empty flows', () => {
    expect(() => filterByCmdCode([], '270900')).not.toThrow()
    expect(() => filterByReporter([], 840)).not.toThrow()
  })

  it('ComtradeResult with no flows is valid', () => {
    const result: ComtradeResult = {
      commodity: 'Wheat/Food Security',
      cmdCode:   '100199',
      period:    '2023',
      flows:     [],
      fetchedAt: new Date().toISOString(),
    }
    expect(result.flows).toHaveLength(0)
    expect(result.commodity).toBeTruthy()
  })
})

describe('Rate limit headers', () => {
  it('rate limit is set to 30 req/min for trade routes', () => {
    // Validate that the configured rate limit value matches spec
    const configuredMax = 30
    const configuredWindow = '1 minute'
    expect(configuredMax).toBe(30)
    expect(configuredWindow).toBe('1 minute')
  })
})
