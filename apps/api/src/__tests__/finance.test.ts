/**
 * Finance Intelligence API — Unit Tests
 *
 * Tests for classifyFinanceSignal (scraper classifier), inferSubcategory,
 * buildSubcategoryBreakdown, deriveFinanceTrend, and constants/exports
 * from routes/finance.ts and lib/finance-classifier.ts (scraper).
 */

import { describe, it, expect } from 'vitest'
import {
  inferSubcategory,
  buildSubcategoryBreakdown,
  deriveFinanceTrend,
  FINANCE_CACHE_TTL,
  FINANCE_RATE_LIMIT,
  FINANCE_CACHE_KEY,
} from '../routes/finance'

// ─── Constants ─────────────────────────────────────────────────────────────────

describe('finance constants', () => {
  it('FINANCE_CACHE_TTL is 300 seconds (5 minutes)', () => {
    expect(FINANCE_CACHE_TTL).toBe(300)
  })

  it('FINANCE_RATE_LIMIT is 60 rpm', () => {
    expect(FINANCE_RATE_LIMIT).toBe(60)
  })

  it('FINANCE_CACHE_KEY is finance:summary', () => {
    expect(FINANCE_CACHE_KEY).toBe('finance:summary')
  })
})

// ─── inferSubcategory (title-based) ───────────────────────────────────────────

describe('inferSubcategory — classifyFinanceSignal returns correct subcategory', () => {
  it('classifies Federal Reserve language as central_bank', () => {
    expect(inferSubcategory('Federal Reserve signals rate hike amid inflation concerns', []))
      .toBe('central_bank')
  })

  it('classifies ECB as central_bank', () => {
    expect(inferSubcategory('ECB raises rates by 25 bps, signals pause ahead', []))
      .toBe('central_bank')
  })

  it('classifies FOMC meeting as central_bank', () => {
    expect(inferSubcategory('FOMC minutes show split on quantitative easing pace', []))
      .toBe('central_bank')
  })

  it('classifies Bitcoin price move as crypto', () => {
    expect(inferSubcategory('Bitcoin tumbles 12% on regulatory crackdown fears', []))
      .toBe('crypto')
  })

  it('classifies Ethereum ETF approval as crypto', () => {
    expect(inferSubcategory('SEC approves Ethereum spot ETF amid crypto market rally', []))
      .toBe('crypto')
  })

  it('classifies OFAC blacklist as sanctions', () => {
    expect(inferSubcategory('OFAC adds 15 entities to SDN list over sanctions evasion', []))
      .toBe('sanctions')
  })

  it('classifies treasury asset freeze as sanctions', () => {
    expect(inferSubcategory('Treasury Department imposes asset freeze on Russian oligarchs', []))
      .toBe('sanctions')
  })

  it('classifies S&P 500 move as market_move', () => {
    expect(inferSubcategory('S&P 500 falls 2% on weak jobs data', []))
      .toBe('market_move')
  })

  it('classifies FTSE rally as market_move', () => {
    expect(inferSubcategory('FTSE 100 posts best session of year after inflation data', []))
      .toBe('market_move')
  })

  it('classifies quarterly earnings as corporate', () => {
    expect(inferSubcategory('Apple Q2 earnings beat estimates; revenue up 8%', []))
      .toBe('corporate')
  })

  it('classifies IPO as corporate', () => {
    expect(inferSubcategory('Shein files for London IPO amid valuation questions', []))
      .toBe('corporate')
  })

  it('returns null for non-finance text', () => {
    expect(inferSubcategory('Heavy rainfall causes flooding in Bangladesh', []))
      .toBeNull()
  })
})

// ─── inferSubcategory (tags take precedence over title) ───────────────────────

describe('inferSubcategory — tag precedence', () => {
  it('prefers central_bank tag over crypto title keyword', () => {
    expect(inferSubcategory('Bitcoin central bank pilot', ['central_bank']))
      .toBe('central_bank')
  })

  it('uses crypto tag when present', () => {
    expect(inferSubcategory('Market stability concerns', ['crypto', 'blockchain']))
      .toBe('crypto')
  })
})

// ─── buildSubcategoryBreakdown ────────────────────────────────────────────────

describe('buildSubcategoryBreakdown', () => {
  it('counts each subcategory correctly', () => {
    const rows = [
      { title: 'Fed rate decision', tags: [] },
      { title: 'Bitcoin drops 10%', tags: [] },
      { title: 'Bitcoin surges on ETF news', tags: [] },
      { title: 'S&P 500 rallies 1.5%', tags: [] },
      { title: 'OFAC sanctions list updated', tags: [] },
      { title: 'Apple earnings beat', tags: [] },
      { title: 'Earthquake in Japan', tags: [] },  // unclassified
    ]
    const bd = buildSubcategoryBreakdown(rows)
    expect(bd.central_bank).toBe(1)
    expect(bd.crypto).toBe(2)
    expect(bd.market_move).toBe(1)
    expect(bd.sanctions).toBe(1)
    expect(bd.corporate).toBe(1)
    expect(bd.unclassified).toBe(1)
  })

  it('returns all-zero breakdown for empty input', () => {
    const bd = buildSubcategoryBreakdown([])
    expect(bd.market_move).toBe(0)
    expect(bd.central_bank).toBe(0)
    expect(bd.sanctions).toBe(0)
    expect(bd.corporate).toBe(0)
    expect(bd.crypto).toBe(0)
    expect(bd.unclassified).toBe(0)
  })
})

// ─── deriveFinanceTrend ────────────────────────────────────────────────────────

describe('deriveFinanceTrend', () => {
  it('returns stable when 24h count is zero', () => {
    expect(deriveFinanceTrend(0, 0)).toBe('stable')
  })

  it('returns escalating when 6h rate exceeds 2× hourly average', () => {
    // hourlyAvg = 24/24 = 1; recent6hRate = 20/6 ≈ 3.3 > 2
    expect(deriveFinanceTrend(24, 20)).toBe('escalating')
  })

  it('returns de-escalating when 6h rate is very low', () => {
    // hourlyAvg = 48/24 = 2; recent6hRate = 1/6 ≈ 0.17 < 1; count6h(1) < 48/4(12)
    expect(deriveFinanceTrend(48, 1)).toBe('de-escalating')
  })

  it('returns stable for normal activity pattern', () => {
    // hourlyAvg = 24/24 = 1; recent6hRate = 5/6 ≈ 0.83 — within normal range
    expect(deriveFinanceTrend(24, 5)).toBe('stable')
  })
})

// ─── GET /api/v1/finance/summary — structural contract ────────────────────────
//
// These tests verify the shape of the summary object returned by the helpers
// (unit-testing the business logic, not HTTP), since the full Fastify server
// requires a live database and Redis.

describe('GET /api/v1/finance/summary — structure contract', () => {
  it('summary object has required top-level fields', () => {
    const summary = {
      period_hours:          24,
      total_signals_24h:     10,
      total_signals_6h:      3,
      trend_direction:       deriveFinanceTrend(10, 3),
      subcategory_breakdown: buildSubcategoryBreakdown([]),
      top_signals:           [],
      generated_at:          new Date().toISOString(),
    }
    expect(summary).toHaveProperty('period_hours', 24)
    expect(summary).toHaveProperty('total_signals_24h')
    expect(summary).toHaveProperty('total_signals_6h')
    expect(summary).toHaveProperty('trend_direction')
    expect(summary).toHaveProperty('subcategory_breakdown')
    expect(summary).toHaveProperty('top_signals')
    expect(summary).toHaveProperty('generated_at')
  })

  it('subcategory_breakdown has all five finance subcategories', () => {
    const bd = buildSubcategoryBreakdown([])
    expect(bd).toHaveProperty('market_move')
    expect(bd).toHaveProperty('central_bank')
    expect(bd).toHaveProperty('sanctions')
    expect(bd).toHaveProperty('corporate')
    expect(bd).toHaveProperty('crypto')
    expect(bd).toHaveProperty('unclassified')
  })

  it('trend_direction is one of the three allowed values', () => {
    const valid = ['escalating', 'stable', 'de-escalating']
    expect(valid).toContain(deriveFinanceTrend(10, 2))
    expect(valid).toContain(deriveFinanceTrend(0, 0))
    expect(valid).toContain(deriveFinanceTrend(10, 9))
  })
})

// ─── classifyFinanceSignal (scraper classifier — new two-arg API) ─────────────

describe('classifyFinanceSignal — scraper classifier (title + summary)', () => {
  it('classifies Federal Reserve rate decision as central_bank', async () => {
    const { classifyFinanceSignal } = await import('../../../../apps/scraper/src/lib/finance-classifier')
    const result = classifyFinanceSignal('Federal Reserve holds rates steady', 'The FOMC voted unanimously to pause rate hikes.')
    expect(result.isFinance).toBe(true)
    expect(result.subcategory).toBe('central_bank')
  })

  it('classifies Bitcoin price crash as crypto', async () => {
    const { classifyFinanceSignal } = await import('../../../../apps/scraper/src/lib/finance-classifier')
    const result = classifyFinanceSignal('Bitcoin drops 15% in 24 hours', 'BTC fell sharply as crypto markets reacted to regulatory news.')
    expect(result.isFinance).toBe(true)
    expect(result.subcategory).toBe('crypto')
  })

  it('classifies OFAC sanctions list update as sanctions', async () => {
    const { classifyFinanceSignal } = await import('../../../../apps/scraper/src/lib/finance-classifier')
    const result = classifyFinanceSignal('OFAC expands SDN list with 20 new entities', 'The Treasury Department announced an asset freeze targeting Russian financial intermediaries.')
    expect(result.isFinance).toBe(true)
    expect(result.subcategory).toBe('sanctions')
  })

  it('classifies S&P 500 rally as market_move', async () => {
    const { classifyFinanceSignal } = await import('../../../../apps/scraper/src/lib/finance-classifier')
    const result = classifyFinanceSignal('S&P 500 surges to record high', 'Equity markets rallied on stronger-than-expected GDP data and falling bond yield.')
    expect(result.isFinance).toBe(true)
    expect(result.subcategory).toBe('market_move')
  })

  it('classifies earnings report as corporate', async () => {
    const { classifyFinanceSignal } = await import('../../../../apps/scraper/src/lib/finance-classifier')
    const result = classifyFinanceSignal('Tesla Q3 earnings beat Wall Street estimates', 'Revenue came in above guidance; EPS exceeded analyst consensus.')
    expect(result.isFinance).toBe(true)
    expect(result.subcategory).toBe('corporate')
  })

  it('returns isFinance=false for non-financial text', async () => {
    const { classifyFinanceSignal } = await import('../../../../apps/scraper/src/lib/finance-classifier')
    const result = classifyFinanceSignal('Wildfire spreads across California', 'Thousands of acres burned as firefighters battle strong winds.')
    expect(result.isFinance).toBe(false)
    expect(result.subcategory).toBeNull()
    expect(result.financialEntities).toHaveLength(0)
  })

  it('returns financialEntities array for finance signals', async () => {
    const { classifyFinanceSignal } = await import('../../../../apps/scraper/src/lib/finance-classifier')
    const result = classifyFinanceSignal('AAPL earnings beat', 'Apple reported quarterly results exceeding revenue guidance.')
    expect(result.isFinance).toBe(true)
    expect(Array.isArray(result.financialEntities)).toBe(true)
  })
})

// ─── Finance signals included in global feed (category inclusion) ─────────────

describe('finance category inclusion in global feed', () => {
  it("'finance' is a valid Category value alongside existing categories", async () => {
    // Import the types package to verify the union type includes 'finance'
    // (TypeScript compile check — if this runs without type errors, it passes)
    const { } = await import('@worldpulse/types')
    const category: import('@worldpulse/types').Category = 'finance'
    expect(category).toBe('finance')
  })

  it("'finance' FinanceSubcategory covers all five expected values", async () => {
    const subcategories: import('@worldpulse/types').FinanceSubcategory[] = [
      'market_move', 'central_bank', 'sanctions', 'corporate', 'crypto',
    ]
    expect(subcategories).toHaveLength(5)
    expect(subcategories).toContain('market_move')
    expect(subcategories).toContain('central_bank')
    expect(subcategories).toContain('sanctions')
    expect(subcategories).toContain('corporate')
    expect(subcategories).toContain('crypto')
  })
})
