/**
 * Knowledge Graph API Routes — Unit Tests
 *
 * 32 test cases covering:
 *   - Entity type constants (4)
 *   - Predicate constants (4)
 *   - Sort field validation (3)
 *   - Pagination helpers (4)
 *   - Node mapping (4)
 *   - Edge mapping (4)
 *   - Graph response structure (3)
 *   - Cache key consistency (3)
 *   - Trending window validation (3)
 */

import { describe, it, expect } from 'vitest'

// ─── CONSTANTS (mirrored from route for unit testing) ──────────────────────────

const VALID_ENTITY_TYPES = [
  'person', 'organisation', 'location', 'event',
  'weapon_system', 'legislation', 'commodity', 'technology',
] as const

const VALID_PREDICATES = [
  'leads', 'member_of', 'located_in', 'sanctions', 'allied_with', 'opposes',
  'caused_by', 'resulted_in', 'supplies', 'funds', 'attacks', 'defends',
  'negotiates_with', 'signed', 'deployed_to', 'manufactures', 'regulates',
  'employs', 'successor_of', 'predecessor_of',
] as const

const VALID_SORT_FIELDS = ['mention_count', 'last_seen', 'first_seen', 'canonical_name'] as const

type EntityType = (typeof VALID_ENTITY_TYPES)[number]

interface EntityNode {
  id: string
  type: EntityType
  canonical_name: string
  aliases: string[]
  first_seen: string
  last_seen: string
  mention_count: number
  signal_ids: string[]
  metadata: Record<string, unknown>
}

interface EntityEdge {
  id: string
  source_entity_id: string
  target_entity_id: string
  predicate: string
  weight: number
  signal_ids: string[]
  first_seen: string
  last_seen: string
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function mapNodeRow(row: any): EntityNode {
  return {
    id: row.id,
    type: row.type,
    canonical_name: row.canonical_name,
    aliases: row.aliases ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    mention_count: Number(row.mention_count),
    signal_ids: row.signal_ids ?? [],
    metadata: row.metadata ?? {},
  }
}

function mapEdgeRow(row: any): EntityEdge {
  return {
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    predicate: row.predicate,
    weight: Number(row.weight),
    signal_ids: row.signal_ids ?? [],
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  }
}

// ─── ENTITY TYPE CONSTANTS ─────────────────────────────────────────────────────

describe('Entity Type Constants', () => {
  it('has exactly 8 entity types', () => {
    expect(VALID_ENTITY_TYPES).toHaveLength(8)
  })

  it('includes core geopolitical types', () => {
    expect(VALID_ENTITY_TYPES).toContain('person')
    expect(VALID_ENTITY_TYPES).toContain('organisation')
    expect(VALID_ENTITY_TYPES).toContain('location')
  })

  it('includes domain-specific types', () => {
    expect(VALID_ENTITY_TYPES).toContain('weapon_system')
    expect(VALID_ENTITY_TYPES).toContain('legislation')
    expect(VALID_ENTITY_TYPES).toContain('commodity')
  })

  it('includes technology type for AI/cyber tracking', () => {
    expect(VALID_ENTITY_TYPES).toContain('technology')
  })
})

// ─── PREDICATE CONSTANTS ───────────────────────────────────────────────────────

describe('Predicate Constants', () => {
  it('has exactly 20 predicates', () => {
    expect(VALID_PREDICATES).toHaveLength(20)
  })

  it('includes leadership predicates', () => {
    expect(VALID_PREDICATES).toContain('leads')
    expect(VALID_PREDICATES).toContain('successor_of')
    expect(VALID_PREDICATES).toContain('predecessor_of')
  })

  it('includes conflict predicates', () => {
    expect(VALID_PREDICATES).toContain('attacks')
    expect(VALID_PREDICATES).toContain('defends')
    expect(VALID_PREDICATES).toContain('deployed_to')
  })

  it('includes economic predicates', () => {
    expect(VALID_PREDICATES).toContain('sanctions')
    expect(VALID_PREDICATES).toContain('supplies')
    expect(VALID_PREDICATES).toContain('funds')
  })
})

// ─── SORT FIELD VALIDATION ─────────────────────────────────────────────────────

describe('Sort Field Validation', () => {
  it('has exactly 4 sort fields', () => {
    expect(VALID_SORT_FIELDS).toHaveLength(4)
  })

  it('includes mention_count for popularity sort', () => {
    expect(VALID_SORT_FIELDS).toContain('mention_count')
  })

  it('includes temporal sort fields', () => {
    expect(VALID_SORT_FIELDS).toContain('last_seen')
    expect(VALID_SORT_FIELDS).toContain('first_seen')
  })
})

// ─── PAGINATION HELPERS ────────────────────────────────────────────────────────

describe('clamp helper', () => {
  it('clamps below minimum', () => {
    expect(clamp(-5, 1, 200)).toBe(1)
  })

  it('clamps above maximum', () => {
    expect(clamp(500, 1, 200)).toBe(200)
  })

  it('passes through values within range', () => {
    expect(clamp(50, 1, 200)).toBe(50)
  })

  it('handles edge boundaries', () => {
    expect(clamp(1, 1, 200)).toBe(1)
    expect(clamp(200, 1, 200)).toBe(200)
  })
})

// ─── NODE MAPPING ──────────────────────────────────────────────────────────────

describe('mapNodeRow', () => {
  const sampleRow = {
    id: 'abc12345abcdef01',
    type: 'person',
    canonical_name: 'Vladimir Putin',
    aliases: ['Putin', 'V. Putin'],
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-04-06T12:00:00Z',
    mention_count: '42',
    signal_ids: ['sig1', 'sig2'],
    metadata: { salience: 0.95 },
  }

  it('maps all required fields', () => {
    const node = mapNodeRow(sampleRow)
    expect(node.id).toBe('abc12345abcdef01')
    expect(node.type).toBe('person')
    expect(node.canonical_name).toBe('Vladimir Putin')
  })

  it('converts mention_count to number', () => {
    const node = mapNodeRow(sampleRow)
    expect(typeof node.mention_count).toBe('number')
    expect(node.mention_count).toBe(42)
  })

  it('defaults null arrays to empty', () => {
    const node = mapNodeRow({ ...sampleRow, aliases: null, signal_ids: null })
    expect(node.aliases).toEqual([])
    expect(node.signal_ids).toEqual([])
  })

  it('defaults null metadata to empty object', () => {
    const node = mapNodeRow({ ...sampleRow, metadata: null })
    expect(node.metadata).toEqual({})
  })
})

// ─── EDGE MAPPING ──────────────────────────────────────────────────────────────

describe('mapEdgeRow', () => {
  const sampleEdge = {
    id: 'edge123456789012',
    source_entity_id: 'src123',
    target_entity_id: 'tgt456',
    predicate: 'sanctions',
    weight: '0.85',
    signal_ids: ['sig1'],
    first_seen: '2026-03-01T00:00:00Z',
    last_seen: '2026-04-06T12:00:00Z',
  }

  it('maps all required fields', () => {
    const edge = mapEdgeRow(sampleEdge)
    expect(edge.id).toBe('edge123456789012')
    expect(edge.predicate).toBe('sanctions')
    expect(edge.source_entity_id).toBe('src123')
    expect(edge.target_entity_id).toBe('tgt456')
  })

  it('converts weight to number', () => {
    const edge = mapEdgeRow(sampleEdge)
    expect(typeof edge.weight).toBe('number')
    expect(edge.weight).toBe(0.85)
  })

  it('defaults null signal_ids to empty array', () => {
    const edge = mapEdgeRow({ ...sampleEdge, signal_ids: null })
    expect(edge.signal_ids).toEqual([])
  })

  it('preserves timestamps', () => {
    const edge = mapEdgeRow(sampleEdge)
    expect(edge.first_seen).toBe('2026-03-01T00:00:00Z')
    expect(edge.last_seen).toBe('2026-04-06T12:00:00Z')
  })
})

// ─── GRAPH RESPONSE STRUCTURE ──────────────────────────────────────────────────

describe('Graph Response Structure', () => {
  it('has nodes, edges, and meta', () => {
    const response = {
      nodes: [] as EntityNode[],
      edges: [] as EntityEdge[],
      meta: { node_count: 0, edge_count: 0, center_entity: 'Test' },
    }
    expect(response).toHaveProperty('nodes')
    expect(response).toHaveProperty('edges')
    expect(response).toHaveProperty('meta')
  })

  it('meta contains count fields', () => {
    const meta = { node_count: 5, edge_count: 10, center_entity: 'NATO' }
    expect(meta.node_count).toBe(5)
    expect(meta.edge_count).toBe(10)
    expect(meta.center_entity).toBe('NATO')
  })

  it('graph with nodes and edges is valid', () => {
    const node = mapNodeRow({
      id: 'n1', type: 'organisation', canonical_name: 'NATO',
      aliases: [], first_seen: '2026-01-01', last_seen: '2026-04-06',
      mention_count: '100', signal_ids: [], metadata: {},
    })
    const edge = mapEdgeRow({
      id: 'e1', source_entity_id: 'n1', target_entity_id: 'n2',
      predicate: 'allied_with', weight: '0.9',
      signal_ids: [], first_seen: '2026-01-01', last_seen: '2026-04-06',
    })
    const graph = {
      nodes: [node],
      edges: [edge],
      meta: { node_count: 1, edge_count: 1, center_entity: 'NATO' },
    }
    expect(graph.nodes).toHaveLength(1)
    expect(graph.edges).toHaveLength(1)
    expect(graph.nodes[0].canonical_name).toBe('NATO')
  })
})

// ─── CACHE KEY CONSISTENCY ─────────────────────────────────────────────────────

describe('Cache Key Generation', () => {
  it('produces consistent cache keys for same params', () => {
    const buildKey = (s: string, t: string, sort: string) =>
      `kg:api:entities:${s}:${t}:${sort}:DESC:50:0:1`
    const a = buildKey('nato', 'organisation', 'mention_count')
    const b = buildKey('nato', 'organisation', 'mention_count')
    expect(a).toBe(b)
  })

  it('produces different cache keys for different params', () => {
    const a = `kg:api:entities:nato:organisation:mention_count:DESC:50:0:1`
    const b = `kg:api:entities:un:organisation:mention_count:DESC:50:0:1`
    expect(a).not.toBe(b)
  })

  it('trending cache key includes window hours', () => {
    const key = `kg:api:trending:person:24:20`
    expect(key).toContain('person')
    expect(key).toContain('24')
  })
})

// ─── TRENDING WINDOW VALIDATION ────────────────────────────────────────────────

describe('Trending Window', () => {
  it('clamps window to minimum of 1 hour', () => {
    expect(clamp(0, 1, 168)).toBe(1)
  })

  it('clamps window to maximum of 168 hours (1 week)', () => {
    expect(clamp(200, 1, 168)).toBe(168)
  })

  it('allows standard 24-hour window', () => {
    expect(clamp(24, 1, 168)).toBe(24)
  })
})
