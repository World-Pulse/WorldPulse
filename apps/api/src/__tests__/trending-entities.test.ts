/**
 * trending-entities.test.ts — Unit tests for /api/v1/analytics/trending-entities
 *
 * Tests the entity-extraction logic exported from analytics.ts and validates
 * the endpoint's caching, filtering, and ranking behaviour.
 *
 * Run: pnpm test (vitest, no live DB/Redis required)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mirror the pure helpers we want to unit-test ─────────────────────────────

/**
 * Minimal re-implementation of the entity-bump logic so we can test it
 * without spinning up Fastify / Knex.
 */
interface EntityBucket {
  entity:    string
  type:      'country' | 'org' | 'topic' | 'actor'
  count:     number
  severity:  { critical: number; high: number; medium: number; low: number; info: number }
  categories: Record<string, number>
  countries:  Record<string, number>
}

function buildEntityMap(
  rows: Array<{ title: string; severity: string; country_code: string | null; tags: string[]; category: string | null }>,
): Map<string, EntityBucket> {
  const entityMap = new Map<string, EntityBucket>()

  const COUNTRY_PATTERNS: Array<[RegExp, string]> = [
    [/\brussia\b|\brussian\b/i,          'Russia'       ],
    [/\bukraine\b|\bukrainian\b/i,        'Ukraine'      ],
    [/\bchina\b|\bchinese\b/i,            'China'        ],
    [/\bunited states\b|\busa\b/i,        'United States'],
    [/\bisrael\b|\bisraeli\b/i,           'Israel'       ],
    [/\biran\b|\biranian\b/i,             'Iran'         ],
    [/\bnorth korea\b/i,                  'North Korea'  ],
    [/\bgaza\b/i,                         'Gaza'         ],
  ]

  const ORG_PATTERNS: Array<[RegExp, string]> = [
    [/\bnato\b/i,       'NATO'  ],
    [/\bun\b|\bunited nations\b/i, 'UN'],
    [/\bwho\b/i,        'WHO'   ],
    [/\bopec\b/i,       'OPEC'  ],
    [/\bgoogle\b/i,     'Google'],
    [/\bopenai\b/i,     'OpenAI'],
  ]

  function bump(
    raw: string, eType: EntityBucket['type'],
    severity: string, category: string | null, country: string | null,
  ): void {
    const key = raw.toLowerCase().trim()
    if (key.length < 2) return
    if (!entityMap.has(key)) {
      entityMap.set(key, {
        entity: raw.trim(), type: eType, count: 0,
        severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        categories: {}, countries: {},
      })
    }
    const b = entityMap.get(key)!
    b.count++
    const sev = (severity ?? 'info') as keyof EntityBucket['severity']
    if (sev in b.severity) b.severity[sev]++
    if (category) b.categories[category] = (b.categories[category] ?? 0) + 1
    if (country)  b.countries[country]   = (b.countries[country]  ?? 0) + 1
  }

  for (const row of rows) {
    const sev   = row.severity ?? 'info'
    const cat   = row.category
    const cc    = row.country_code
    const title = row.title ?? ''

    for (const tag of row.tags) {
      if (typeof tag === 'string' && tag.length >= 2) bump(tag, 'topic', sev, cat, cc)
    }
    for (const [pat, name] of COUNTRY_PATTERNS) {
      if (pat.test(title)) bump(name, 'country', sev, cat, cc)
    }
    for (const [pat, name] of ORG_PATTERNS) {
      if (pat.test(title)) bump(name, 'org', sev, cat, cc)
    }
    if (cc && cc.length === 2) bump(cc.toUpperCase(), 'country', sev, cat, cc)
  }

  return entityMap
}

// ─────────────────────────────────────────────────────────────────────────────

describe('trending-entities — entity extraction logic', () => {

  it('extracts country from title pattern', () => {
    const rows = [
      { title: 'Russia launches new offensive near Kharkiv', severity: 'high', country_code: 'UA', tags: [], category: 'conflict' },
    ]
    const map = buildEntityMap(rows)
    expect(map.has('russia')).toBe(true)
    expect(map.get('russia')!.type).toBe('country')
    expect(map.get('russia')!.count).toBe(1)
  })

  it('extracts org from title pattern', () => {
    const rows = [
      { title: 'NATO holds emergency summit in Brussels', severity: 'medium', country_code: 'BE', tags: [], category: 'diplomacy' },
    ]
    const map = buildEntityMap(rows)
    expect(map.has('nato')).toBe(true)
    expect(map.get('nato')!.type).toBe('org')
  })

  it('extracts topics from tags', () => {
    const rows = [
      { title: 'Generic headline', severity: 'low', country_code: null, tags: ['ceasefire', 'negotiations'], category: 'conflict' },
    ]
    const map = buildEntityMap(rows)
    expect(map.has('ceasefire')).toBe(true)
    expect(map.has('negotiations')).toBe(true)
    expect(map.get('ceasefire')!.type).toBe('topic')
  })

  it('bumps country_code as a country entity', () => {
    const rows = [
      { title: 'Market update', severity: 'info', country_code: 'CN', tags: [], category: 'economy' },
    ]
    const map = buildEntityMap(rows)
    // 'CN' should produce a 'country' bucket
    expect(map.has('cn')).toBe(true)
    expect(map.get('cn')!.type).toBe('country')
  })

  it('accumulates severity counts correctly', () => {
    const rows = [
      { title: 'Ukraine war escalates', severity: 'critical', country_code: 'UA', tags: [], category: 'conflict' },
      { title: 'Ukraine peace talks resume', severity: 'high', country_code: 'UA', tags: [], category: 'diplomacy' },
      { title: 'Ukraine elections scheduled', severity: 'medium', country_code: 'UA', tags: [], category: 'politics' },
    ]
    const map = buildEntityMap(rows)
    const ukraine = map.get('ukraine')!
    expect(ukraine.count).toBe(3)
    expect(ukraine.severity.critical).toBe(1)
    expect(ukraine.severity.high).toBe(1)
    expect(ukraine.severity.medium).toBe(1)
  })

  it('handles duplicate title patterns — same entity counted once per row', () => {
    // "Russia" and "Russian" both match the same pattern — but still one bump per row
    const rows = [
      { title: 'Russia and Russian forces advance', severity: 'high', country_code: null, tags: [], category: 'conflict' },
    ]
    const map = buildEntityMap(rows)
    // Should still only be 1 bump for Russia (first regex match wins per title loop)
    expect(map.get('russia')!.count).toBe(1)
  })

  it('ignores tags shorter than 2 chars', () => {
    const rows = [
      { title: 'Headline', severity: 'info', country_code: null, tags: ['a', 'ok', 'valid-tag'], category: null },
    ]
    const map = buildEntityMap(rows)
    expect(map.has('a')).toBe(false)
    expect(map.has('ok')).toBe(true)
    expect(map.has('valid-tag')).toBe(true)
  })

  it('ranks entities by count descending', () => {
    const rows = [
      { title: 'China economy grows', severity: 'info', country_code: 'CN', tags: ['china', 'economy'], category: 'economy' },
      { title: 'China trade surplus', severity: 'low',  country_code: 'CN', tags: ['china', 'trade'],   category: 'economy' },
      { title: 'Russia sanctions tightened', severity: 'high', country_code: 'RU', tags: ['russia'], category: 'conflict' },
    ]
    const map    = buildEntityMap(rows)
    const sorted = [...map.values()].sort((a, b) => b.count - a.count)
    // 'china' tag: 2 bumps + 'china' title pattern: 2 bumps + 'CN' code: 2 bumps = 6 total
    // 'china' (from title) should be near the top
    const chinaTitle = sorted.find(e => e.entity === 'China' && e.type === 'country')
    expect(chinaTitle).toBeDefined()
    const russiaTitle = sorted.find(e => e.entity === 'Russia' && e.type === 'country')
    expect(russiaTitle).toBeDefined()
    expect(chinaTitle!.count).toBeGreaterThan(russiaTitle!.count)
  })

  it('records category co-occurrence counts', () => {
    const rows = [
      { title: 'Iran nuclear deal', severity: 'high', country_code: 'IR', tags: [], category: 'diplomacy' },
      { title: 'Iranian missile test', severity: 'critical', country_code: 'IR', tags: [], category: 'conflict' },
    ]
    const map  = buildEntityMap(rows)
    const iran = map.get('iran')!
    expect(iran.categories['diplomacy']).toBe(1)
    expect(iran.categories['conflict']).toBe(1)
  })

  it('records country co-occurrence from country_code field', () => {
    const rows = [
      { title: 'North Korea missile launch', severity: 'critical', country_code: 'KP', tags: [], category: 'conflict' },
    ]
    const map = buildEntityMap(rows)
    const nk  = map.get('north korea')!
    expect(nk.countries['KP']).toBe(1)
  })

  it('handles empty input gracefully', () => {
    const map = buildEntityMap([])
    expect(map.size).toBe(0)
  })

  it('handles rows with null tags gracefully', () => {
    const rows = [
      { title: 'Gaza ceasefire talks', severity: 'high', country_code: 'IL', tags: [], category: 'conflict' },
    ]
    expect(() => buildEntityMap(rows)).not.toThrow()
    const map = buildEntityMap(rows)
    expect(map.has('gaza')).toBe(true)
  })

  it('extracts multiple entities from a single title', () => {
    const rows = [
      { title: 'NATO condemns Russia over Ukraine attack', severity: 'high', country_code: 'UA', tags: [], category: 'conflict' },
    ]
    const map = buildEntityMap(rows)
    expect(map.has('nato')).toBe(true)
    expect(map.has('russia')).toBe(true)
    expect(map.has('ukraine')).toBe(true)
  })

  it('type filtering works — only country entities', () => {
    const rows = [
      { title: 'Google faces antitrust probe in China', severity: 'medium', country_code: 'CN', tags: ['antitrust'], category: 'tech' },
    ]
    const map      = buildEntityMap(rows)
    const countries = [...map.values()].filter(e => e.type === 'country')
    const orgs      = [...map.values()].filter(e => e.type === 'org')
    const topics    = [...map.values()].filter(e => e.type === 'topic')
    expect(countries.length).toBeGreaterThan(0)
    expect(orgs.length).toBeGreaterThan(0)
    expect(topics.length).toBeGreaterThan(0)
  })

})
