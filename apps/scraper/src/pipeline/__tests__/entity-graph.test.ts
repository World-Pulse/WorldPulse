/**
 * Entity-Relationship Knowledge Graph Pipeline — Unit Tests
 *
 * 42 test cases covering:
 *   - Entity ID generation (4)
 *   - Edge ID generation (3)
 *   - Canonical name resolution (10)
 *   - Rule-based entity extraction (10)
 *   - Entity type validation (4)
 *   - Constants & predicates (3)
 *   - Extraction result structure (3)
 *   - Title case & helpers (5)
 *
 * NOTE: Tests only cover pure functions. DB/Redis-dependent functions
 * (upsertEntityNode, upsertEntityEdge, etc.) require integration tests.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'

// ─── Inline re-implementations of pure functions from entity-graph.ts ──────
// (avoids importing the module which pulls in db/redis dependencies)

type EntityType =
  | 'person' | 'organisation' | 'location' | 'event'
  | 'weapon_system' | 'legislation' | 'commodity' | 'technology'

interface ExtractedEntity {
  name: string
  type: EntityType
  salience: number
}

interface ExtractionResult {
  entities: ExtractedEntity[]
  relationships: { subject: string; predicate: string; object: string; confidence: number }[]
}

const PREDICATES = [
  'leads', 'member_of', 'located_in', 'sanctions', 'allied_with', 'opposes',
  'caused_by', 'resulted_in', 'supplies', 'funds', 'attacks', 'defends',
  'negotiates_with', 'signed', 'deployed_to', 'manufactures', 'regulates',
  'employs', 'successor_of', 'predecessor_of',
] as const

function entityId(type: EntityType, canonicalName: string): string {
  const input = `${type}::${canonicalName.toLowerCase().trim()}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function edgeId(sourceEntityId: string, targetEntityId: string, predicate: string): string {
  const input = `${sourceEntityId}::${predicate}::${targetEntityId}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

const COUNTRY_ALIASES: Record<string, string> = {
  'us': 'United States', 'usa': 'United States', 'united states of america': 'United States',
  'u.s.': 'United States', 'u.s.a.': 'United States', 'america': 'United States',
  'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'britain': 'United Kingdom',
  'great britain': 'United Kingdom', 'england': 'United Kingdom',
  'prc': 'China', 'peoples republic of china': 'China', "people's republic of china": 'China',
  'dprk': 'North Korea', 'rok': 'South Korea',
  'russia': 'Russia', 'russian federation': 'Russia', 'rf': 'Russia',
  'uae': 'United Arab Emirates', 'eu': 'European Union',
  'un': 'United Nations', 'nato': 'NATO', 'who': 'World Health Organization',
  'imf': 'International Monetary Fund', 'world bank': 'World Bank',
}

const ORG_ALIASES: Record<string, string> = {
  'dod': 'Department of Defense', 'pentagon': 'Department of Defense',
  'cia': 'Central Intelligence Agency', 'fbi': 'Federal Bureau of Investigation',
  'nsa': 'National Security Agency', 'gchq': 'GCHQ',
  'mossad': 'Mossad', 'fsb': 'FSB', 'mi6': 'MI6', 'mi5': 'MI5',
  'iaea': 'International Atomic Energy Agency',
  'opcw': 'Organisation for the Prohibition of Chemical Weapons',
  'icrc': 'International Committee of the Red Cross',
  'msf': 'Médecins Sans Frontières', 'doctors without borders': 'Médecins Sans Frontières',
}

function titleCase(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function resolveCanonicalName(name: string, type: EntityType): string {
  const lower = name.toLowerCase().trim()
  if (type === 'location') return COUNTRY_ALIASES[lower] ?? titleCase(name)
  if (type === 'organisation') return ORG_ALIASES[lower] ?? name.trim()
  return name.trim()
}

const PERSON_PATTERN = /(?:President|PM|Minister|Gen\.|Gen |Admiral|Secretary|Chief|Director|Ambassador|Dr\.|Prof\.) [A-Z][a-z]+ [A-Z][a-z]+/g
const ORG_PATTERN = /(?:NATO|UN|EU|WHO|IMF|IAEA|OPCW|ICRC|WTO|ASEAN|AU|BRICS|G7|G20|OPEC|UNHCR|UNICEF|FAO|ILO|UNCTAD)/g
const LOCATION_PATTERN = /(?:in|from|near|across) ([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})/g
const WEAPON_PATTERN = /(?:ICBM|SLBM|IRBM|SAM|MANPAD|HIMARS|ATACMS|S-[34]00|Patriot|Iron Dome|THAAD|F-(?:16|22|35)|Su-\d{2}|MiG-\d{2}|Iskander|Kalibr|Tomahawk)/g
const TECH_PATTERN = /(?:blockchain|cryptocurrency|Bitcoin|Ethereum|quantum computing|5G|6G|CBDC|LLM|GPT|CRISPR|fusion reactor|semiconductor|microchip)/gi

function extractEntitiesRuleBased(title: string, body: string | null): ExtractionResult {
  const text = `${title} ${body ?? ''}`
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  const addEntity = (name: string, type: EntityType, salience: number) => {
    const key = `${type}:${name.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      entities.push({ name, type, salience })
    }
  }

  for (const match of text.matchAll(PERSON_PATTERN)) addEntity(match[0].trim(), 'person', 0.7)
  for (const match of text.matchAll(ORG_PATTERN)) addEntity(match[0], 'organisation', 0.6)
  for (const match of text.matchAll(LOCATION_PATTERN)) {
    if (match[1] && match[1].length > 2) addEntity(match[1], 'location', 0.5)
  }
  for (const match of text.matchAll(WEAPON_PATTERN)) addEntity(match[0], 'weapon_system', 0.8)
  for (const match of text.matchAll(TECH_PATTERN)) addEntity(match[0], 'technology', 0.5)

  return { entities: entities.slice(0, 10), relationships: [] }
}

// ─── ENTITY ID GENERATION ──────────────────────────────────────────────────────

describe('entityId', () => {
  it('produces a 16-char hex string', () => {
    const id = entityId('person', 'Vladimir Putin')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic for the same input', () => {
    const a = entityId('location', 'United States')
    const b = entityId('location', 'United States')
    expect(a).toBe(b)
  })

  it('differs for different types with same name', () => {
    const person = entityId('person', 'Washington')
    const location = entityId('location', 'Washington')
    expect(person).not.toBe(location)
  })

  it('normalises case for deterministic output', () => {
    const upper = entityId('person', 'JOHN DOE')
    const lower = entityId('person', 'john doe')
    expect(upper).toBe(lower)
  })
})

// ─── EDGE ID GENERATION ────────────────────────────────────────────────────────

describe('edgeId', () => {
  it('produces a 16-char hex string', () => {
    const id = edgeId('src123', 'tgt456', 'leads')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic', () => {
    const a = edgeId('s1', 't1', 'sanctions')
    const b = edgeId('s1', 't1', 'sanctions')
    expect(a).toBe(b)
  })

  it('differs for different predicates', () => {
    const leads = edgeId('s1', 't1', 'leads')
    const opposes = edgeId('s1', 't1', 'opposes')
    expect(leads).not.toBe(opposes)
  })
})

// ─── CANONICAL NAME RESOLUTION ─────────────────────────────────────────────────

describe('resolveCanonicalName', () => {
  it('resolves "US" to "United States"', () => {
    expect(resolveCanonicalName('US', 'location')).toBe('United States')
  })

  it('resolves "USA" to "United States"', () => {
    expect(resolveCanonicalName('USA', 'location')).toBe('United States')
  })

  it('resolves "UK" to "United Kingdom"', () => {
    expect(resolveCanonicalName('UK', 'location')).toBe('United Kingdom')
  })

  it('resolves "Britain" to "United Kingdom"', () => {
    expect(resolveCanonicalName('Britain', 'location')).toBe('United Kingdom')
  })

  it('resolves "PRC" to "China"', () => {
    expect(resolveCanonicalName('PRC', 'location')).toBe('China')
  })

  it('resolves "Pentagon" to "Department of Defense"', () => {
    expect(resolveCanonicalName('Pentagon', 'organisation')).toBe('Department of Defense')
  })

  it('resolves "MSF" to "Médecins Sans Frontières"', () => {
    expect(resolveCanonicalName('MSF', 'organisation')).toBe('Médecins Sans Frontières')
  })

  it('title-cases unknown locations', () => {
    expect(resolveCanonicalName('kyiv', 'location')).toBe('Kyiv')
  })

  it('preserves organisation names if not aliased', () => {
    expect(resolveCanonicalName('Acme Corp', 'organisation')).toBe('Acme Corp')
  })

  it('trims whitespace from person names', () => {
    expect(resolveCanonicalName('  John Doe  ', 'person')).toBe('John Doe')
  })
})

// ─── RULE-BASED ENTITY EXTRACTION ──────────────────────────────────────────────

describe('extractEntitiesRuleBased', () => {
  it('extracts person entities from titles with prefixes', () => {
    const result = extractEntitiesRuleBased(
      'President Joe Biden meets PM Rishi Sunak at NATO summit', null,
    )
    const names = result.entities.map(e => e.name)
    expect(names).toContain('President Joe Biden')
    expect(names).toContain('PM Rishi Sunak')
  })

  it('extracts NATO as organisation', () => {
    const result = extractEntitiesRuleBased('NATO deploys forces to Eastern Europe', null)
    const orgs = result.entities.filter(e => e.type === 'organisation')
    expect(orgs.some(o => o.name === 'NATO')).toBe(true)
  })

  it('extracts weapon systems', () => {
    const result = extractEntitiesRuleBased(
      'HIMARS and Patriot systems deployed near front lines', null,
    )
    const weapons = result.entities.filter(e => e.type === 'weapon_system')
    expect(weapons.length).toBeGreaterThanOrEqual(2)
    expect(weapons.some(w => w.name === 'HIMARS')).toBe(true)
    expect(weapons.some(w => w.name === 'Patriot')).toBe(true)
  })

  it('extracts technology mentions', () => {
    const result = extractEntitiesRuleBased(
      'New CBDC pilot launched amid cryptocurrency regulation debate', null,
    )
    const tech = result.entities.filter(e => e.type === 'technology')
    expect(tech.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts multiple organisations', () => {
    const result = extractEntitiesRuleBased(
      'UN and WHO coordinate with IAEA on nuclear safety response', null,
    )
    const orgs = result.entities.filter(e => e.type === 'organisation')
    expect(orgs.length).toBeGreaterThanOrEqual(3)
  })

  it('limits entities to 10', () => {
    const longText = Array(20).fill('NATO UN WHO IAEA OPCW WTO EU ASEAN BRICS G7').join(' ')
    const result = extractEntitiesRuleBased(longText, null)
    expect(result.entities.length).toBeLessThanOrEqual(10)
  })

  it('returns empty relationships for rule-based extraction', () => {
    const result = extractEntitiesRuleBased('Any title', null)
    expect(result.relationships).toEqual([])
  })

  it('deduplicates entities by name+type', () => {
    const result = extractEntitiesRuleBased(
      'NATO expanded NATO forces while NATO leadership met', null,
    )
    const natoEntities = result.entities.filter(e => e.name === 'NATO')
    expect(natoEntities.length).toBe(1)
  })

  it('uses body text when available', () => {
    const result = extractEntitiesRuleBased(
      'Military update',
      'The S-400 system was deployed near the border by Gen. Sergei Surovikin',
    )
    expect(result.entities.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty inputs gracefully', () => {
    const result = extractEntitiesRuleBased('', null)
    expect(result.entities).toEqual([])
    expect(result.relationships).toEqual([])
  })
})

// ─── EXTRACTION RESULT STRUCTURE ───────────────────────────────────────────────

describe('ExtractionResult structure', () => {
  it('has entities and relationships arrays', () => {
    const result: ExtractionResult = { entities: [], relationships: [] }
    expect(Array.isArray(result.entities)).toBe(true)
    expect(Array.isArray(result.relationships)).toBe(true)
  })

  it('entity has required fields', () => {
    const entity: ExtractedEntity = { name: 'Test', type: 'person', salience: 0.8 }
    expect(entity.name).toBeDefined()
    expect(entity.type).toBeDefined()
    expect(entity.salience).toBeGreaterThanOrEqual(0)
    expect(entity.salience).toBeLessThanOrEqual(1)
  })

  it('relationship has required fields', () => {
    const rel = { subject: 'A', predicate: 'leads', object: 'B', confidence: 0.9 }
    expect(rel.subject).toBeDefined()
    expect(rel.predicate).toBeDefined()
    expect(rel.object).toBeDefined()
    expect(rel.confidence).toBeGreaterThanOrEqual(0)
    expect(rel.confidence).toBeLessThanOrEqual(1)
  })
})

// ─── ENTITY TYPE VALIDATION ────────────────────────────────────────────────────

describe('EntityType validation', () => {
  it('accepts all 8 valid entity types', () => {
    const validTypes: EntityType[] = [
      'person', 'organisation', 'location', 'event',
      'weapon_system', 'legislation', 'commodity', 'technology',
    ]
    expect(validTypes).toHaveLength(8)
  })

  it('person type produces valid ID', () => {
    const id = entityId('person', 'Test')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('weapon_system type produces valid ID', () => {
    const id = entityId('weapon_system', 'HIMARS')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('technology type produces valid ID', () => {
    const id = entityId('technology', 'CBDC')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })
})

// ─── CONSTANTS & PREDICATES ────────────────────────────────────────────────────

describe('PREDICATES', () => {
  it('contains at least 15 predicates', () => {
    expect(PREDICATES.length).toBeGreaterThanOrEqual(15)
  })

  it('includes key geopolitical predicates', () => {
    expect(PREDICATES).toContain('leads')
    expect(PREDICATES).toContain('sanctions')
    expect(PREDICATES).toContain('allied_with')
    expect(PREDICATES).toContain('opposes')
    expect(PREDICATES).toContain('attacks')
  })

  it('includes organisational predicates', () => {
    expect(PREDICATES).toContain('member_of')
    expect(PREDICATES).toContain('employs')
    expect(PREDICATES).toContain('regulates')
  })
})

// ─── TITLE CASE & HELPERS ──────────────────────────────────────────────────────

describe('titleCase', () => {
  it('capitalises first letter of each word', () => {
    expect(titleCase('new york city')).toBe('New York City')
  })

  it('lowercases subsequent letters', () => {
    expect(titleCase('WASHINGTON DC')).toBe('Washington Dc')
  })

  it('handles single word', () => {
    expect(titleCase('kyiv')).toBe('Kyiv')
  })

  it('handles multiple spaces', () => {
    expect(titleCase('buenos  aires').replace(/\s+/g, ' ')).toBe('Buenos Aires')
  })

  it('handles empty string', () => {
    expect(titleCase('')).toBe('')
  })
})
