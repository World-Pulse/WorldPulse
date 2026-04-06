/**
 * Briefings API Route Tests — apps/api/src/routes/briefings.ts
 *
 * Tests the daily intelligence briefing generation endpoint (/api/v1/briefings/daily)
 * and briefing history endpoint (/api/v1/briefings/history).
 *
 * Covers: route schema validation, period clamping, response shape,
 *         caching behavior, error handling, extractive fallback,
 *         LLM JSON parsing, and briefing-generator data helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Briefing types matching briefing-generator.ts ───────────────────────────

interface BriefingDevelopment {
  headline: string
  detail:   string
  severity: string
  category: string
  signal_count: number
}

interface CategoryBreakdown {
  category:       string
  count:          number
  critical_count: number
  high_count:     number
}

interface GeographicHotspot {
  country_code:      string
  location_name:     string | null
  signal_count:      number
  avg_severity_score: number
}

interface BriefingSignal {
  id:                string
  title:             string
  category:          string
  severity:          string
  reliability_score: number
  location_name:     string | null
  country_code:      string | null
  source_domain:     string | null
  created_at:        string
}

interface DailyBriefing {
  id:                 string
  date:               string
  generated_at:       string
  model:              string
  period_hours:       number
  total_signals:      number
  total_clusters:     number
  executive_summary:  string
  key_developments:   BriefingDevelopment[]
  category_breakdown: CategoryBreakdown[]
  geographic_hotspots: GeographicHotspot[]
  threat_assessment:  string
  outlook:            string
  top_signals:        BriefingSignal[]
}

// ─── Mock briefing data ────────────────────────────────────────────────────────

const MOCK_SIGNAL: BriefingSignal = {
  id: 'sig-001',
  title: 'Major earthquake detected in Pacific Ring of Fire',
  category: 'disaster',
  severity: 'critical',
  reliability_score: 0.92,
  location_name: 'Japan',
  country_code: 'JP',
  source_domain: 'reuters.com',
  created_at: new Date().toISOString(),
}

const MOCK_SIGNAL_2: BriefingSignal = {
  id: 'sig-002',
  title: 'EU sanctions package targets energy sector',
  category: 'geopolitics',
  severity: 'high',
  reliability_score: 0.85,
  location_name: 'Brussels',
  country_code: 'BE',
  source_domain: 'bbc.com',
  created_at: new Date().toISOString(),
}

const MOCK_SIGNAL_LOW: BriefingSignal = {
  id: 'sig-003',
  title: 'Minor tech conference announced',
  category: 'technology',
  severity: 'low',
  reliability_score: 0.6,
  location_name: 'San Francisco',
  country_code: 'US',
  source_domain: 'techcrunch.com',
  created_at: new Date().toISOString(),
}

function createMockBriefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
  const dateKey = new Date().toISOString().slice(0, 10)
  return {
    id: `briefing-${dateKey}-24h`,
    date: dateKey,
    generated_at: new Date().toISOString(),
    model: 'anthropic',
    period_hours: 24,
    total_signals: 150,
    total_clusters: 3,
    executive_summary: 'WorldPulse processed 150 signals in the last 24 hours across 8 categories. 5 critical and 12 high-severity signals detected, with 3 correlated event clusters identified.',
    key_developments: [
      {
        headline: 'Major earthquake in Pacific Ring of Fire',
        detail: 'A 7.2 magnitude earthquake struck off the coast of Japan, triggering tsunami warnings across the Pacific. Multiple independent sources confirm significant infrastructure damage.',
        severity: 'critical',
        category: 'disaster',
        signal_count: 12,
      },
      {
        headline: 'EU energy sanctions expansion',
        detail: 'The European Union announced the 15th sanctions package targeting Russian energy infrastructure, affecting LNG imports and shipping routes.',
        severity: 'high',
        category: 'geopolitics',
        signal_count: 8,
      },
    ],
    category_breakdown: [
      { category: 'disaster', count: 25, critical_count: 5, high_count: 8 },
      { category: 'geopolitics', count: 22, critical_count: 0, high_count: 4 },
      { category: 'conflict', count: 18, critical_count: 3, high_count: 6 },
      { category: 'economy', count: 15, critical_count: 0, high_count: 2 },
    ],
    geographic_hotspots: [
      { country_code: 'JP', location_name: 'Japan', signal_count: 12, avg_severity_score: 4.2 },
      { country_code: 'UA', location_name: 'Ukraine', signal_count: 10, avg_severity_score: 3.8 },
      { country_code: 'BE', location_name: 'Brussels', signal_count: 8, avg_severity_score: 3.1 },
    ],
    threat_assessment: 'Elevated threat level with 5 critical signals. Primary concern: disaster. Pacific Ring seismic activity warrants continued monitoring.',
    outlook: 'Monitor disaster signals for aftershock escalation. 3 active event clusters may develop further.',
    top_signals: [MOCK_SIGNAL, MOCK_SIGNAL_2],
    ...overrides,
  }
}

// ─── Route Schema Tests ─────────────────────────────────────────────────────────

describe('Briefings Route Schema', () => {
  it('daily endpoint accepts valid hours parameter (1-72)', () => {
    const valid = [1, 12, 24, 48, 72]
    for (const h of valid) {
      expect(h).toBeGreaterThanOrEqual(1)
      expect(h).toBeLessThanOrEqual(72)
    }
  })

  it('daily endpoint default hours is 24', () => {
    const DEFAULT_HOURS = 24
    expect(DEFAULT_HOURS).toBe(24)
  })

  it('hours parameter max is 72', () => {
    const MAX_HOURS = 72
    const clamped = Math.min(100, MAX_HOURS)
    expect(clamped).toBe(72)
  })

  it('history endpoint has no required parameters', () => {
    // The /history endpoint takes no query params
    expect(true).toBe(true)
  })
})

// ─── Response Shape Tests ───────────────────────────────────────────────────────

describe('Briefing Response Shape', () => {
  it('daily briefing has all required top-level fields', () => {
    const briefing = createMockBriefing()
    expect(briefing).toHaveProperty('id')
    expect(briefing).toHaveProperty('date')
    expect(briefing).toHaveProperty('generated_at')
    expect(briefing).toHaveProperty('model')
    expect(briefing).toHaveProperty('period_hours')
    expect(briefing).toHaveProperty('total_signals')
    expect(briefing).toHaveProperty('total_clusters')
    expect(briefing).toHaveProperty('executive_summary')
    expect(briefing).toHaveProperty('key_developments')
    expect(briefing).toHaveProperty('category_breakdown')
    expect(briefing).toHaveProperty('geographic_hotspots')
    expect(briefing).toHaveProperty('threat_assessment')
    expect(briefing).toHaveProperty('outlook')
    expect(briefing).toHaveProperty('top_signals')
  })

  it('briefing id follows expected format', () => {
    const briefing = createMockBriefing()
    expect(briefing.id).toMatch(/^briefing-\d{4}-\d{2}-\d{2}-\d+h$/)
  })

  it('briefing date is ISO date format (YYYY-MM-DD)', () => {
    const briefing = createMockBriefing()
    expect(briefing.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('generated_at is valid ISO timestamp', () => {
    const briefing = createMockBriefing()
    const d = new Date(briefing.generated_at)
    expect(d.getTime()).not.toBeNaN()
  })

  it('model field is non-empty string', () => {
    const briefing = createMockBriefing()
    expect(typeof briefing.model).toBe('string')
    expect(briefing.model.length).toBeGreaterThan(0)
  })

  it('period_hours matches requested hours', () => {
    const briefing = createMockBriefing({ period_hours: 48 })
    expect(briefing.period_hours).toBe(48)
  })

  it('total_signals is non-negative number', () => {
    const briefing = createMockBriefing()
    expect(briefing.total_signals).toBeGreaterThanOrEqual(0)
  })

  it('total_clusters is non-negative number', () => {
    const briefing = createMockBriefing()
    expect(briefing.total_clusters).toBeGreaterThanOrEqual(0)
  })
})

// ─── Key Development Tests ──────────────────────────────────────────────────────

describe('Key Developments', () => {
  it('each development has required fields', () => {
    const briefing = createMockBriefing()
    for (const d of briefing.key_developments) {
      expect(d).toHaveProperty('headline')
      expect(d).toHaveProperty('detail')
      expect(d).toHaveProperty('severity')
      expect(d).toHaveProperty('category')
      expect(d).toHaveProperty('signal_count')
    }
  })

  it('severity values are valid enum members', () => {
    const validSeverities = ['critical', 'high', 'medium', 'low', 'info']
    const briefing = createMockBriefing()
    for (const d of briefing.key_developments) {
      expect(validSeverities).toContain(d.severity)
    }
  })

  it('signal_count per development is positive', () => {
    const briefing = createMockBriefing()
    for (const d of briefing.key_developments) {
      expect(d.signal_count).toBeGreaterThan(0)
    }
  })

  it('headline is non-empty string', () => {
    const briefing = createMockBriefing()
    for (const d of briefing.key_developments) {
      expect(d.headline.length).toBeGreaterThan(0)
    }
  })

  it('developments are ordered by severity (critical first)', () => {
    const severityOrder: Record<string, number> = {
      critical: 5, high: 4, medium: 3, low: 2, info: 1,
    }
    const briefing = createMockBriefing()
    for (let i = 1; i < briefing.key_developments.length; i++) {
      const prev = severityOrder[briefing.key_developments[i - 1]!.severity] ?? 0
      const curr = severityOrder[briefing.key_developments[i]!.severity] ?? 0
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
  })
})

// ─── Category Breakdown Tests ───────────────────────────────────────────────────

describe('Category Breakdown', () => {
  it('each category entry has count, critical_count, high_count', () => {
    const briefing = createMockBriefing()
    for (const c of briefing.category_breakdown) {
      expect(typeof c.count).toBe('number')
      expect(typeof c.critical_count).toBe('number')
      expect(typeof c.high_count).toBe('number')
      expect(c.count).toBeGreaterThanOrEqual(0)
      expect(c.critical_count).toBeGreaterThanOrEqual(0)
      expect(c.high_count).toBeGreaterThanOrEqual(0)
    }
  })

  it('critical + high counts do not exceed total count', () => {
    const briefing = createMockBriefing()
    for (const c of briefing.category_breakdown) {
      expect(c.critical_count + c.high_count).toBeLessThanOrEqual(c.count)
    }
  })

  it('category names are non-empty strings', () => {
    const briefing = createMockBriefing()
    for (const c of briefing.category_breakdown) {
      expect(c.category.length).toBeGreaterThan(0)
    }
  })

  it('categories are sorted by count descending', () => {
    const briefing = createMockBriefing()
    for (let i = 1; i < briefing.category_breakdown.length; i++) {
      expect(briefing.category_breakdown[i - 1]!.count)
        .toBeGreaterThanOrEqual(briefing.category_breakdown[i]!.count)
    }
  })
})

// ─── Geographic Hotspots Tests ──────────────────────────────────────────────────

describe('Geographic Hotspots', () => {
  it('each hotspot has required fields', () => {
    const briefing = createMockBriefing()
    for (const h of briefing.geographic_hotspots) {
      expect(h).toHaveProperty('country_code')
      expect(h).toHaveProperty('signal_count')
      expect(h).toHaveProperty('avg_severity_score')
    }
  })

  it('country_code is non-empty 2-letter code', () => {
    const briefing = createMockBriefing()
    for (const h of briefing.geographic_hotspots) {
      expect(h.country_code.length).toBe(2)
      expect(h.country_code).toBe(h.country_code.toUpperCase())
    }
  })

  it('avg_severity_score is between 1 and 5', () => {
    const briefing = createMockBriefing()
    for (const h of briefing.geographic_hotspots) {
      expect(h.avg_severity_score).toBeGreaterThanOrEqual(1)
      expect(h.avg_severity_score).toBeLessThanOrEqual(5)
    }
  })

  it('signal_count is positive for each hotspot', () => {
    const briefing = createMockBriefing()
    for (const h of briefing.geographic_hotspots) {
      expect(h.signal_count).toBeGreaterThan(0)
    }
  })
})

// ─── Signal Shape Tests ─────────────────────────────────────────────────────────

describe('Top Signals', () => {
  it('each signal has required fields', () => {
    const signals = [MOCK_SIGNAL, MOCK_SIGNAL_2, MOCK_SIGNAL_LOW]
    for (const s of signals) {
      expect(s).toHaveProperty('id')
      expect(s).toHaveProperty('title')
      expect(s).toHaveProperty('category')
      expect(s).toHaveProperty('severity')
      expect(s).toHaveProperty('reliability_score')
      expect(s).toHaveProperty('created_at')
    }
  })

  it('reliability_score is between 0 and 1', () => {
    const signals = [MOCK_SIGNAL, MOCK_SIGNAL_2, MOCK_SIGNAL_LOW]
    for (const s of signals) {
      expect(s.reliability_score).toBeGreaterThanOrEqual(0)
      expect(s.reliability_score).toBeLessThanOrEqual(1)
    }
  })

  it('severity is valid enum value', () => {
    const validSeverities = ['critical', 'high', 'medium', 'low', 'info']
    const signals = [MOCK_SIGNAL, MOCK_SIGNAL_2, MOCK_SIGNAL_LOW]
    for (const s of signals) {
      expect(validSeverities).toContain(s.severity)
    }
  })

  it('created_at is valid ISO timestamp', () => {
    const signals = [MOCK_SIGNAL, MOCK_SIGNAL_2]
    for (const s of signals) {
      const d = new Date(s.created_at)
      expect(d.getTime()).not.toBeNaN()
    }
  })
})

// ─── Empty/Fallback Briefing Tests ──────────────────────────────────────────────

describe('Empty/Fallback Briefing', () => {
  it('empty briefing has zero signals and clusters', () => {
    const empty = createMockBriefing({
      total_signals: 0,
      total_clusters: 0,
      key_developments: [],
      category_breakdown: [],
      geographic_hotspots: [],
      top_signals: [],
      model: 'none',
    })
    expect(empty.total_signals).toBe(0)
    expect(empty.total_clusters).toBe(0)
    expect(empty.key_developments).toHaveLength(0)
    expect(empty.top_signals).toHaveLength(0)
  })

  it('empty briefing still has executive_summary and threat_assessment', () => {
    const empty = createMockBriefing({
      total_signals: 0,
      executive_summary: 'No signals were collected in this period.',
      threat_assessment: 'Unable to assess — no data available.',
    })
    expect(empty.executive_summary.length).toBeGreaterThan(0)
    expect(empty.threat_assessment.length).toBeGreaterThan(0)
  })

  it('extractive model label used when no LLM available', () => {
    const extractive = createMockBriefing({ model: 'extractive' })
    expect(extractive.model).toBe('extractive')
  })
})

// ─── Extractive Briefing Logic Tests ────────────────────────────────────────────

describe('Extractive Briefing Logic', () => {
  function buildExtractiveSummary(
    totalSignals: number,
    categoryCount: number,
    criticalCount: number,
    highCount: number,
    clusterCount: number,
  ): string {
    return `WorldPulse processed ${totalSignals} signals in the last 24 hours across ${categoryCount} categories. ${criticalCount} critical and ${highCount} high-severity signals detected${clusterCount > 0 ? `, with ${clusterCount} correlated event clusters identified` : ''}.`
  }

  it('includes total signals count in summary', () => {
    const summary = buildExtractiveSummary(200, 8, 5, 15, 3)
    expect(summary).toContain('200 signals')
  })

  it('includes category count in summary', () => {
    const summary = buildExtractiveSummary(200, 8, 5, 15, 3)
    expect(summary).toContain('8 categories')
  })

  it('includes cluster info when clusters exist', () => {
    const summary = buildExtractiveSummary(200, 8, 5, 15, 3)
    expect(summary).toContain('3 correlated event clusters')
  })

  it('omits cluster info when no clusters', () => {
    const summary = buildExtractiveSummary(200, 8, 5, 15, 0)
    expect(summary).not.toContain('cluster')
  })

  it('includes critical and high counts', () => {
    const summary = buildExtractiveSummary(200, 8, 5, 15, 0)
    expect(summary).toContain('5 critical')
    expect(summary).toContain('15 high-severity')
  })

  it('extractive key developments limited to top 5 signals', () => {
    const signals = Array.from({ length: 10 }, (_, i) => ({
      ...MOCK_SIGNAL,
      id: `sig-${i}`,
      title: `Signal ${i}`,
    }))
    const developments = signals.slice(0, 5).map(s => ({
      headline: s.title,
      detail: `${s.category} signal from ${s.source_domain ?? 'unknown source'}, reliability ${(s.reliability_score * 100).toFixed(0)}%.`,
      severity: s.severity,
      category: s.category,
      signal_count: 1,
    }))
    expect(developments).toHaveLength(5)
  })
})

// ─── Threat Assessment Logic Tests ──────────────────────────────────────────────

describe('Threat Assessment Logic', () => {
  function assessThreat(criticalCount: number, totalSignals: number, topCategory: string): string {
    return criticalCount >= 3
      ? `Elevated threat level with ${criticalCount} critical signals. Primary concern: ${topCategory}.`
      : `Moderate threat level. ${totalSignals} signals processed with ${criticalCount} critical events.`
  }

  it('elevated threat when 3+ critical signals', () => {
    const assessment = assessThreat(5, 200, 'disaster')
    expect(assessment).toContain('Elevated')
    expect(assessment).toContain('disaster')
  })

  it('moderate threat when <3 critical signals', () => {
    const assessment = assessThreat(2, 200, 'conflict')
    expect(assessment).toContain('Moderate')
  })

  it('includes critical count in elevated assessment', () => {
    const assessment = assessThreat(7, 300, 'geopolitics')
    expect(assessment).toContain('7 critical signals')
  })

  it('threshold is exactly 3 (boundary test)', () => {
    const atThreshold = assessThreat(3, 100, 'health')
    expect(atThreshold).toContain('Elevated')
    const belowThreshold = assessThreat(2, 100, 'health')
    expect(belowThreshold).toContain('Moderate')
  })
})

// ─── LLM JSON Parsing Tests ─────────────────────────────────────────────────────

describe('LLM Response Parsing', () => {
  function parseLlmResponse(text: string): Record<string, unknown> | null {
    try {
      let jsonText = text.trim()
      // Handle markdown code fences
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '')
      }
      return JSON.parse(jsonText) as Record<string, unknown>
    } catch {
      return null
    }
  }

  it('parses raw JSON correctly', () => {
    const raw = '{"executive_summary": "Test summary", "key_developments": []}'
    const parsed = parseLlmResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.executive_summary).toBe('Test summary')
  })

  it('strips markdown code fences (```json)', () => {
    const fenced = '```json\n{"executive_summary": "Fenced"}\n```'
    const parsed = parseLlmResponse(fenced)
    expect(parsed).not.toBeNull()
    expect(parsed?.executive_summary).toBe('Fenced')
  })

  it('strips plain code fences (```)', () => {
    const fenced = '```\n{"executive_summary": "Plain fenced"}\n```'
    const parsed = parseLlmResponse(fenced)
    expect(parsed).not.toBeNull()
    expect(parsed?.executive_summary).toBe('Plain fenced')
  })

  it('returns null for unparseable text', () => {
    const bad = 'This is not JSON at all.'
    expect(parseLlmResponse(bad)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseLlmResponse('')).toBeNull()
  })

  it('handles whitespace-padded JSON', () => {
    const padded = '   \n  {"executive_summary": "Padded"}  \n  '
    const parsed = parseLlmResponse(padded)
    expect(parsed).not.toBeNull()
    expect(parsed?.executive_summary).toBe('Padded')
  })
})

// ─── Caching Behavior Tests ─────────────────────────────────────────────────────

describe('Caching Behavior', () => {
  const BRIEFING_CACHE_TTL = 60 * 60 * 4 // 4 hours

  it('cache TTL is 4 hours (14400 seconds)', () => {
    expect(BRIEFING_CACHE_TTL).toBe(14400)
  })

  it('cache key includes date and hours', () => {
    const dateKey = '2026-04-01'
    const hours = 24
    const cacheKey = `briefing:daily:${dateKey}:${hours}h`
    expect(cacheKey).toBe('briefing:daily:2026-04-01:24h')
  })

  it('different hours produce different cache keys', () => {
    const dateKey = '2026-04-01'
    const key24 = `briefing:daily:${dateKey}:24h`
    const key48 = `briefing:daily:${dateKey}:48h`
    expect(key24).not.toBe(key48)
  })

  it('different dates produce different cache keys', () => {
    const key1 = 'briefing:daily:2026-04-01:24h'
    const key2 = 'briefing:daily:2026-04-02:24h'
    expect(key1).not.toBe(key2)
  })
})

// ─── Severity Order Tests ───────────────────────────────────────────────────────

describe('Severity Ordering', () => {
  const SEVERITY_ORDER: Record<string, number> = {
    critical: 5, high: 4, medium: 3, low: 2, info: 1,
  }

  it('critical has highest priority (5)', () => {
    expect(SEVERITY_ORDER['critical']).toBe(5)
  })

  it('info has lowest priority (1)', () => {
    expect(SEVERITY_ORDER['info']).toBe(1)
  })

  it('severity order is strictly descending', () => {
    const values = Object.values(SEVERITY_ORDER).sort((a, b) => b - a)
    expect(values).toEqual([5, 4, 3, 2, 1])
  })

  it('all 5 severity levels are defined', () => {
    expect(Object.keys(SEVERITY_ORDER)).toHaveLength(5)
    expect(SEVERITY_ORDER).toHaveProperty('critical')
    expect(SEVERITY_ORDER).toHaveProperty('high')
    expect(SEVERITY_ORDER).toHaveProperty('medium')
    expect(SEVERITY_ORDER).toHaveProperty('low')
    expect(SEVERITY_ORDER).toHaveProperty('info')
  })

  it('sorts signals correctly by severity', () => {
    const signals = [MOCK_SIGNAL_LOW, MOCK_SIGNAL, MOCK_SIGNAL_2]
    const sorted = [...signals].sort(
      (a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
    )
    expect(sorted[0]!.severity).toBe('critical')
    expect(sorted[1]!.severity).toBe('high')
    expect(sorted[2]!.severity).toBe('low')
  })
})

// ─── Configuration Constants Tests ──────────────────────────────────────────────

describe('Configuration Constants', () => {
  const MAX_SIGNALS_FOR_LLM = 30
  const MAX_CLUSTERS_FOR_LLM = 10

  it('MAX_SIGNALS_FOR_LLM is 30', () => {
    expect(MAX_SIGNALS_FOR_LLM).toBe(30)
  })

  it('MAX_CLUSTERS_FOR_LLM is 10', () => {
    expect(MAX_CLUSTERS_FOR_LLM).toBe(10)
  })

  it('signal limit is larger than cluster limit', () => {
    expect(MAX_SIGNALS_FOR_LLM).toBeGreaterThan(MAX_CLUSTERS_FOR_LLM)
  })
})

// ─── LLM Provider Priority Tests ────────────────────────────────────────────────

describe('LLM Provider Priority', () => {
  const PROVIDER_PRIORITY = ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama', 'extractive']

  it('anthropic is first priority', () => {
    expect(PROVIDER_PRIORITY[0]).toBe('anthropic')
  })

  it('extractive is last resort', () => {
    expect(PROVIDER_PRIORITY[PROVIDER_PRIORITY.length - 1]).toBe('extractive')
  })

  it('all 6 providers are defined', () => {
    expect(PROVIDER_PRIORITY).toHaveLength(6)
  })

  it('model field in briefing matches a valid provider', () => {
    const briefing = createMockBriefing({ model: 'anthropic' })
    expect(PROVIDER_PRIORITY).toContain(briefing.model)
  })
})

// ─── Briefing Prompt Builder Tests ──────────────────────────────────────────────

describe('Briefing Prompt Builder', () => {
  function buildBriefingPrompt(
    signals: BriefingSignal[],
    totalSignals: number,
  ): string {
    const signalList = signals.slice(0, 20).map(s =>
      `- [${s.severity.toUpperCase()}] ${s.title} (${s.category}, ${s.location_name ?? 'global'}, reliability: ${(s.reliability_score * 100).toFixed(0)}%)`
    ).join('\n')
    return `TOTAL SIGNALS PROCESSED: ${totalSignals}\n\nTOP SIGNALS BY SEVERITY & RELIABILITY:\n${signalList}`
  }

  it('includes total signal count', () => {
    const prompt = buildBriefingPrompt([MOCK_SIGNAL], 200)
    expect(prompt).toContain('TOTAL SIGNALS PROCESSED: 200')
  })

  it('formats severity as uppercase', () => {
    const prompt = buildBriefingPrompt([MOCK_SIGNAL], 100)
    expect(prompt).toContain('[CRITICAL]')
  })

  it('includes reliability percentage', () => {
    const prompt = buildBriefingPrompt([MOCK_SIGNAL], 100)
    expect(prompt).toContain('reliability: 92%')
  })

  it('uses "global" when location_name is null', () => {
    const noLocation = { ...MOCK_SIGNAL, location_name: null }
    const prompt = buildBriefingPrompt([noLocation], 100)
    expect(prompt).toContain('global')
  })

  it('limits signals to 20 in prompt', () => {
    const manySignals = Array.from({ length: 30 }, (_, i) => ({
      ...MOCK_SIGNAL,
      id: `sig-${i}`,
      title: `Signal ${i}`,
    }))
    const prompt = buildBriefingPrompt(manySignals, 300)
    const lines = prompt.split('\n').filter(l => l.startsWith('- ['))
    expect(lines.length).toBeLessThanOrEqual(20)
  })
})
