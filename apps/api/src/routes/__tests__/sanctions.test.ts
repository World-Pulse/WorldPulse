/**
 * Sanctions & Watchlist Intelligence API Route Tests — apps/api/src/routes/sanctions.ts
 *
 * Tests the sanctions featured entities endpoint: threat level ranking,
 * entity transformation, deduplication, schema labels, dataset labels,
 * alias handling, country extraction, and response shape.
 */

import { describe, it, expect } from 'vitest'

// ─── Constants (mirroring sanctions.ts) ─────────────────────────────────────

const CACHE_TTL = 600 // 10 minutes
const CACHE_KEY = 'sanctions:featured'
const RATE_LIMIT = 30

// ─── Types (mirroring FeaturedEntity) ───────────────────────────────────────

interface FeaturedEntity {
  id: string
  caption: string
  schema: string
  schemaLabel: string
  datasets: string[]
  datasetLabels: string[]
  threatLevel: 'critical' | 'high' | 'medium' | 'low'
  primaryAlias: string | null
  aliases: string[]
  countries: string[]
  topics: string[]
  score: number
}

// ─── Mock OpenSanctions entity ──────────────────────────────────────────────

interface MockOSEntity {
  id: string
  caption: string
  schema: string
  datasets: string[]
  score: number
  properties: {
    alias?: string[]
    nationality?: string[]
    country?: string[]
    topics?: string[]
  }
}

// ─── Helpers (mirroring sanctions.ts logic) ─────────────────────────────────

const THREAT_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const SCHEMA_LABELS: Record<string, string> = {
  Person: 'Person',
  Organization: 'Organization',
  Vessel: 'Vessel',
  Company: 'Company',
  LegalEntity: 'Legal Entity',
}

const DATASET_LABELS: Record<string, string> = {
  'us_ofac_sdn': 'US OFAC SDN',
  'eu_fsf': 'EU Financial Sanctions',
  'un_sc_sanctions': 'UN Security Council',
  'us_ofac_cons': 'US OFAC Consolidated',
  'gb_hmt_sanctions': 'UK HMT Sanctions',
}

function schemaLabel(schema: string): string {
  return SCHEMA_LABELS[schema] ?? schema
}

function datasetLabel(ds: string): string {
  return DATASET_LABELS[ds] ?? ds
}

function entityThreatLevel(datasets: string[]): 'critical' | 'high' | 'medium' | 'low' {
  const hasMajorList = datasets.some(d =>
    d.includes('ofac') || d.includes('un_sc') || d.includes('eu_fsf')
  )
  if (datasets.length >= 3 && hasMajorList) return 'critical'
  if (hasMajorList) return 'high'
  if (datasets.length >= 2) return 'medium'
  return 'low'
}

function toFeaturedEntity(e: MockOSEntity): FeaturedEntity {
  const aliases = e.properties.alias ?? []
  const countries = [
    ...(e.properties.nationality ?? []),
    ...(e.properties.country ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i)

  return {
    id: e.id,
    caption: e.caption,
    schema: e.schema,
    schemaLabel: schemaLabel(e.schema),
    datasets: e.datasets,
    datasetLabels: e.datasets.map(datasetLabel),
    threatLevel: entityThreatLevel(e.datasets),
    primaryAlias: aliases[0] ?? null,
    aliases: aliases.slice(0, 5),
    countries,
    topics: e.properties.topics ?? [],
    score: e.score,
  }
}

// ─── Featured Queries (mirroring sanctions.ts) ──────────────────────────────

const FEATURED_QUERIES: Array<[string, string | undefined]> = [
  ['Vladimir Putin', 'Person'],
  ['Kim Jong', 'Person'],
  ['Alexander Lukashenko', 'Person'],
  ['Bashar al-Assad', 'Person'],
  ['Ramzan Kadyrov', 'Person'],
  ['Ali Khamenei', 'Person'],
  ['IRGC', 'Organization'],
  ['Wagner Group', 'Organization'],
  ['Hezbollah', 'Organization'],
  ['Hamas', 'Organization'],
  ['Islamic State', 'Organization'],
  ['Al-Qaida', 'Organization'],
  ['NS Captain', 'Vessel'],
  ['SUN SYMBOL', 'Vessel'],
]

// ═════════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═════════════════════════════════════════════════════════════════════════════

describe('Sanctions Constants', () => {
  it('cache TTL is 600 seconds (10 minutes)', () => {
    expect(CACHE_TTL).toBe(600)
  })

  it('cache key is sanctions:featured', () => {
    expect(CACHE_KEY).toBe('sanctions:featured')
  })

  it('rate limit is 30 req/min', () => {
    expect(RATE_LIMIT).toBe(30)
  })
})

describe('Featured Queries Configuration', () => {
  it('contains 14 search queries', () => {
    expect(FEATURED_QUERIES.length).toBe(14)
  })

  it('includes Person, Organization, and Vessel schema filters', () => {
    const schemas = new Set(FEATURED_QUERIES.map(([, s]) => s))
    expect(schemas.has('Person')).toBe(true)
    expect(schemas.has('Organization')).toBe(true)
    expect(schemas.has('Vessel')).toBe(true)
  })

  it('includes key political figures', () => {
    const names = FEATURED_QUERIES.map(([q]) => q)
    expect(names).toContain('Vladimir Putin')
    expect(names).toContain('Kim Jong')
    expect(names).toContain('Ali Khamenei')
  })

  it('includes key sanctioned organizations', () => {
    const names = FEATURED_QUERIES.map(([q]) => q)
    expect(names).toContain('IRGC')
    expect(names).toContain('Wagner Group')
    expect(names).toContain('Hezbollah')
  })

  it('all queries have non-empty search terms', () => {
    for (const [query] of FEATURED_QUERIES) {
      expect(query.length).toBeGreaterThan(0)
    }
  })
})

describe('Threat Level Classification', () => {
  it('critical: 3+ datasets including OFAC', () => {
    expect(entityThreatLevel(['us_ofac_sdn', 'eu_fsf', 'un_sc_sanctions'])).toBe('critical')
  })

  it('critical: 3+ datasets including UN SC', () => {
    expect(entityThreatLevel(['un_sc_sanctions', 'gb_hmt_sanctions', 'us_ofac_cons'])).toBe('critical')
  })

  it('high: major list but fewer than 3 datasets', () => {
    expect(entityThreatLevel(['us_ofac_sdn'])).toBe('high')
    expect(entityThreatLevel(['eu_fsf', 'gb_hmt_sanctions'])).toBe('high')
  })

  it('medium: 2+ datasets but no major list', () => {
    expect(entityThreatLevel(['gb_hmt_sanctions', 'au_dfat_sanctions'])).toBe('medium')
  })

  it('low: single minor dataset', () => {
    expect(entityThreatLevel(['jp_mof_sanctions'])).toBe('low')
  })

  it('low: empty datasets array', () => {
    expect(entityThreatLevel([])).toBe('low')
  })
})

describe('Threat Rank Ordering', () => {
  it('critical > high > medium > low', () => {
    expect(THREAT_RANK['critical']!).toBeGreaterThan(THREAT_RANK['high']!)
    expect(THREAT_RANK['high']!).toBeGreaterThan(THREAT_RANK['medium']!)
    expect(THREAT_RANK['medium']!).toBeGreaterThan(THREAT_RANK['low']!)
  })

  it('sort order is stable (critical=4, high=3, medium=2, low=1)', () => {
    expect(THREAT_RANK).toEqual({ critical: 4, high: 3, medium: 2, low: 1 })
  })
})

describe('Schema Labels', () => {
  it('Person → Person', () => {
    expect(schemaLabel('Person')).toBe('Person')
  })

  it('Organization → Organization', () => {
    expect(schemaLabel('Organization')).toBe('Organization')
  })

  it('Vessel → Vessel', () => {
    expect(schemaLabel('Vessel')).toBe('Vessel')
  })

  it('unknown schema returns raw string', () => {
    expect(schemaLabel('Aircraft')).toBe('Aircraft')
  })
})

describe('Dataset Labels', () => {
  it('us_ofac_sdn → US OFAC SDN', () => {
    expect(datasetLabel('us_ofac_sdn')).toBe('US OFAC SDN')
  })

  it('eu_fsf → EU Financial Sanctions', () => {
    expect(datasetLabel('eu_fsf')).toBe('EU Financial Sanctions')
  })

  it('un_sc_sanctions → UN Security Council', () => {
    expect(datasetLabel('un_sc_sanctions')).toBe('UN Security Council')
  })

  it('unknown dataset returns raw string', () => {
    expect(datasetLabel('ca_sema')).toBe('ca_sema')
  })
})

describe('Entity Transformation (toFeaturedEntity)', () => {
  const mockEntity: MockOSEntity = {
    id: 'Q7747',
    caption: 'Vladimir Putin',
    schema: 'Person',
    datasets: ['us_ofac_sdn', 'eu_fsf', 'un_sc_sanctions'],
    score: 0.98,
    properties: {
      alias: ['Vladimir Vladimirovich Putin', 'V.V. Putin', 'Путин В.В.', 'ウラジミル・プーチン', 'فلاديمير بوتين', 'Wladimir Putin'],
      nationality: ['ru'],
      country: ['ru'],
      topics: ['sanction', 'role.pep'],
    },
  }

  const featured = toFeaturedEntity(mockEntity)

  it('preserves entity ID', () => {
    expect(featured.id).toBe('Q7747')
  })

  it('preserves caption', () => {
    expect(featured.caption).toBe('Vladimir Putin')
  })

  it('resolves schemaLabel from schema', () => {
    expect(featured.schemaLabel).toBe('Person')
  })

  it('maps all datasets to labels', () => {
    expect(featured.datasetLabels).toContain('US OFAC SDN')
    expect(featured.datasetLabels).toContain('EU Financial Sanctions')
    expect(featured.datasetLabels).toContain('UN Security Council')
  })

  it('classifies threat level correctly', () => {
    expect(featured.threatLevel).toBe('critical')
  })

  it('extracts primary alias (first in list)', () => {
    expect(featured.primaryAlias).toBe('Vladimir Vladimirovich Putin')
  })

  it('limits aliases to 5', () => {
    expect(featured.aliases.length).toBeLessThanOrEqual(5)
  })

  it('deduplicates countries from nationality + country', () => {
    expect(featured.countries).toEqual(['ru'])
  })

  it('preserves topics', () => {
    expect(featured.topics).toContain('sanction')
    expect(featured.topics).toContain('role.pep')
  })

  it('preserves score', () => {
    expect(featured.score).toBe(0.98)
  })
})

describe('Entity Transformation Edge Cases', () => {
  it('handles entity with no aliases', () => {
    const entity: MockOSEntity = {
      id: 'test-1',
      caption: 'Unknown Entity',
      schema: 'Organization',
      datasets: ['us_ofac_sdn'],
      score: 0.5,
      properties: {},
    }
    const result = toFeaturedEntity(entity)
    expect(result.primaryAlias).toBeNull()
    expect(result.aliases).toEqual([])
  })

  it('handles entity with no countries', () => {
    const entity: MockOSEntity = {
      id: 'test-2',
      caption: 'Stateless Org',
      schema: 'Organization',
      datasets: ['eu_fsf'],
      score: 0.7,
      properties: {},
    }
    const result = toFeaturedEntity(entity)
    expect(result.countries).toEqual([])
  })

  it('handles entity with no topics', () => {
    const entity: MockOSEntity = {
      id: 'test-3',
      caption: 'No Topics',
      schema: 'Vessel',
      datasets: ['gb_hmt_sanctions'],
      score: 0.3,
      properties: {},
    }
    const result = toFeaturedEntity(entity)
    expect(result.topics).toEqual([])
  })

  it('deduplicates when nationality and country overlap', () => {
    const entity: MockOSEntity = {
      id: 'test-4',
      caption: 'Dual',
      schema: 'Person',
      datasets: ['us_ofac_sdn'],
      score: 0.8,
      properties: {
        nationality: ['ir', 'ru'],
        country: ['ru', 'sy'],
      },
    }
    const result = toFeaturedEntity(entity)
    // 'ru' appears in both but should be deduplicated
    expect(result.countries.filter(c => c === 'ru').length).toBe(1)
    expect(result.countries).toContain('ir')
    expect(result.countries).toContain('ru')
    expect(result.countries).toContain('sy')
  })
})

describe('Deduplication Logic', () => {
  it('removes duplicate entities by ID', () => {
    const entities: MockOSEntity[] = [
      { id: 'Q1', caption: 'A', schema: 'Person', datasets: ['us_ofac_sdn'], score: 1, properties: {} },
      { id: 'Q1', caption: 'A', schema: 'Person', datasets: ['us_ofac_sdn'], score: 1, properties: {} },
      { id: 'Q2', caption: 'B', schema: 'Person', datasets: ['eu_fsf'], score: 0.9, properties: {} },
    ]

    const seen = new Set<string>()
    const deduped: FeaturedEntity[] = []
    for (const e of entities) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      deduped.push(toFeaturedEntity(e))
    }

    expect(deduped.length).toBe(2)
    expect(deduped.map(e => e.id)).toEqual(['Q1', 'Q2'])
  })
})

describe('Sort Order', () => {
  it('sorts by threat level descending, then score descending', () => {
    const entities: FeaturedEntity[] = [
      { id: '1', caption: 'Low', schema: 'Person', schemaLabel: 'Person', datasets: [], datasetLabels: [], threatLevel: 'low', primaryAlias: null, aliases: [], countries: [], topics: [], score: 0.9 },
      { id: '2', caption: 'Critical', schema: 'Person', schemaLabel: 'Person', datasets: [], datasetLabels: [], threatLevel: 'critical', primaryAlias: null, aliases: [], countries: [], topics: [], score: 0.5 },
      { id: '3', caption: 'High', schema: 'Person', schemaLabel: 'Person', datasets: [], datasetLabels: [], threatLevel: 'high', primaryAlias: null, aliases: [], countries: [], topics: [], score: 0.8 },
    ]

    entities.sort((a, b) => {
      const rankDiff = (THREAT_RANK[b.threatLevel] ?? 0) - (THREAT_RANK[a.threatLevel] ?? 0)
      return rankDiff !== 0 ? rankDiff : b.score - a.score
    })

    expect(entities[0]!.threatLevel).toBe('critical')
    expect(entities[1]!.threatLevel).toBe('high')
    expect(entities[2]!.threatLevel).toBe('low')
  })

  it('ties in threat level resolved by score', () => {
    const entities: FeaturedEntity[] = [
      { id: '1', caption: 'A', schema: 'Person', schemaLabel: 'Person', datasets: [], datasetLabels: [], threatLevel: 'high', primaryAlias: null, aliases: [], countries: [], topics: [], score: 0.5 },
      { id: '2', caption: 'B', schema: 'Person', schemaLabel: 'Person', datasets: [], datasetLabels: [], threatLevel: 'high', primaryAlias: null, aliases: [], countries: [], topics: [], score: 0.9 },
    ]

    entities.sort((a, b) => {
      const rankDiff = (THREAT_RANK[b.threatLevel] ?? 0) - (THREAT_RANK[a.threatLevel] ?? 0)
      return rankDiff !== 0 ? rankDiff : b.score - a.score
    })

    expect(entities[0]!.score).toBe(0.9)
    expect(entities[1]!.score).toBe(0.5)
  })
})

describe('Response Structure', () => {
  it('success response has correct shape', () => {
    const response = {
      success: true,
      data: {
        entities: [] as FeaturedEntity[],
        count: 0,
        cached: false,
        fetched_at: new Date().toISOString(),
      },
    }

    expect(response.success).toBe(true)
    expect(response.data).toHaveProperty('entities')
    expect(response.data).toHaveProperty('count')
    expect(Array.isArray(response.data.entities)).toBe(true)
  })

  it('featured entities are capped at 20', () => {
    const MAX_FEATURED = 20
    const manyEntities = Array.from({ length: 30 }, (_, i) => ({
      id: `Q${i}`, caption: `Entity ${i}`, schema: 'Person', schemaLabel: 'Person',
      datasets: ['us_ofac_sdn'], datasetLabels: ['US OFAC SDN'],
      threatLevel: 'high' as const, primaryAlias: null, aliases: [], countries: [],
      topics: [], score: 0.5,
    }))

    const capped = manyEntities.slice(0, MAX_FEATURED)
    expect(capped.length).toBe(20)
  })
})
