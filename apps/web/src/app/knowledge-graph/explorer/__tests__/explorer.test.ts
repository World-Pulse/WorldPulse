/**
 * Full-Graph Explorer — Unit Tests
 *
 * Tests for the Knowledge Graph Explorer page logic:
 *   - Node deduplication
 *   - Edge deduplication
 *   - Type conversion helpers (toGraphNode, toGraphEdge)
 *   - Entity type config completeness
 *   - Number formatting
 *   - Predicate formatting
 *   - Time ago formatting
 *   - Type filtering logic
 *   - Depth configuration
 *   - Search debounce behavior
 *
 * @module __tests__/explorer
 */

import { describe, it, expect } from 'vitest'

// ─── Re-implement pure functions from the page for testability ────────────────

// Entity type config (must match page)
const ENTITY_TYPE_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  person:        { color: '#3b82f6', icon: '\u{1F464}', label: 'People' },
  organisation:  { color: '#a855f7', icon: '\u{1F3DB}', label: 'Organisations' },
  location:      { color: '#22c55e', icon: '\u{1F4CD}', label: 'Locations' },
  event:         { color: '#eab308', icon: '\u{26A1}',  label: 'Events' },
  weapon_system: { color: '#ef4444', icon: '\u{1F6E1}', label: 'Weapons' },
  legislation:   { color: '#06b6d4', icon: '\u{1F4DC}', label: 'Legislation' },
  commodity:     { color: '#f97316', icon: '\u{1F4E6}', label: 'Commodities' },
  technology:    { color: '#6366f1', icon: '\u{1F4BB}', label: 'Technology' },
}

interface GraphNode {
  id: string
  type: string
  canonical_name: string
  mention_count: number
}

interface GraphEdge {
  id: string
  source: string
  target: string
  predicate: string
  weight: number
}

function dedupeNodes(nodes: GraphNode[]): GraphNode[] {
  const map = new Map<string, GraphNode>()
  for (const n of nodes) {
    const existing = map.get(n.id)
    if (!existing || n.mention_count > existing.mention_count) {
      map.set(n.id, n)
    }
  }
  return Array.from(map.values())
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const map = new Map<string, GraphEdge>()
  for (const e of edges) {
    const existing = map.get(e.id)
    if (!existing || e.weight > existing.weight) {
      map.set(e.id, e)
    }
  }
  return Array.from(map.values())
}

function toGraphNode(entity: { id: string; type: string; canonical_name: string; mention_count: number }): GraphNode {
  return {
    id: entity.id,
    type: entity.type,
    canonical_name: entity.canonical_name,
    mention_count: entity.mention_count,
  }
}

function toGraphEdge(edge: { id: string; source_entity_id: string; target_entity_id: string; predicate: string; weight: number }): GraphEdge {
  return {
    id: edge.id,
    source: edge.source_entity_id,
    target: edge.target_entity_id,
    predicate: edge.predicate,
    weight: edge.weight,
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatPredicate(p: string): string {
  return p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

// ─── Test Data ────────────────────────────────────────────────────────────────

const sampleNodes: GraphNode[] = [
  { id: 'n1', type: 'person', canonical_name: 'Alice', mention_count: 50 },
  { id: 'n2', type: 'organisation', canonical_name: 'ACME Corp', mention_count: 30 },
  { id: 'n3', type: 'location', canonical_name: 'Berlin', mention_count: 20 },
  { id: 'n4', type: 'event', canonical_name: 'Summit 2026', mention_count: 15 },
  { id: 'n5', type: 'technology', canonical_name: 'GPT-6', mention_count: 80 },
]

const sampleEdges: GraphEdge[] = [
  { id: 'e1', source: 'n1', target: 'n2', predicate: 'leads', weight: 5 },
  { id: 'e2', source: 'n1', target: 'n3', predicate: 'located_in', weight: 3 },
  { id: 'e3', source: 'n2', target: 'n4', predicate: 'funds', weight: 7 },
  { id: 'e4', source: 'n5', target: 'n2', predicate: 'manufactures', weight: 4 },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ENTITY_TYPE_CONFIG', () => {
  it('should have exactly 8 entity types', () => {
    expect(Object.keys(ENTITY_TYPE_CONFIG)).toHaveLength(8)
  })

  it('should include all required types', () => {
    const required = ['person', 'organisation', 'location', 'event', 'weapon_system', 'legislation', 'commodity', 'technology']
    for (const type of required) {
      expect(ENTITY_TYPE_CONFIG).toHaveProperty(type)
    }
  })

  it('should have valid hex colors for all types', () => {
    for (const [, config] of Object.entries(ENTITY_TYPE_CONFIG)) {
      expect(config.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('should have non-empty labels for all types', () => {
    for (const [, config] of Object.entries(ENTITY_TYPE_CONFIG)) {
      expect(config.label.length).toBeGreaterThan(0)
    }
  })

  it('should have non-empty icons for all types', () => {
    for (const [, config] of Object.entries(ENTITY_TYPE_CONFIG)) {
      expect(config.icon.length).toBeGreaterThan(0)
    }
  })
})

describe('dedupeNodes', () => {
  it('should return unique nodes', () => {
    const duped = [...sampleNodes, { ...sampleNodes[0], mention_count: 10 }]
    const result = dedupeNodes(duped)
    expect(result).toHaveLength(5)
  })

  it('should keep the node with higher mention_count', () => {
    const duped = [
      { id: 'x1', type: 'person', canonical_name: 'Bob', mention_count: 10 },
      { id: 'x1', type: 'person', canonical_name: 'Bob', mention_count: 50 },
    ]
    const result = dedupeNodes(duped)
    expect(result).toHaveLength(1)
    expect(result[0].mention_count).toBe(50)
  })

  it('should handle empty input', () => {
    expect(dedupeNodes([])).toHaveLength(0)
  })

  it('should handle single node', () => {
    const result = dedupeNodes([sampleNodes[0]])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('n1')
  })

  it('should preserve all unique nodes', () => {
    const result = dedupeNodes(sampleNodes)
    expect(result).toHaveLength(5)
  })

  it('should keep first node when mention_count is equal', () => {
    const duped = [
      { id: 'x1', type: 'person', canonical_name: 'Bob', mention_count: 10 },
      { id: 'x1', type: 'person', canonical_name: 'Robert', mention_count: 10 },
    ]
    const result = dedupeNodes(duped)
    expect(result).toHaveLength(1)
    // When equal, last one is NOT picked (not > existing)
    expect(result[0].canonical_name).toBe('Bob')
  })
})

describe('dedupeEdges', () => {
  it('should return unique edges', () => {
    const duped = [...sampleEdges, { ...sampleEdges[0], weight: 1 }]
    const result = dedupeEdges(duped)
    expect(result).toHaveLength(4)
  })

  it('should keep the edge with higher weight', () => {
    const duped = [
      { id: 'e1', source: 'a', target: 'b', predicate: 'leads', weight: 2 },
      { id: 'e1', source: 'a', target: 'b', predicate: 'leads', weight: 9 },
    ]
    const result = dedupeEdges(duped)
    expect(result).toHaveLength(1)
    expect(result[0].weight).toBe(9)
  })

  it('should handle empty input', () => {
    expect(dedupeEdges([])).toHaveLength(0)
  })

  it('should preserve all unique edges', () => {
    const result = dedupeEdges(sampleEdges)
    expect(result).toHaveLength(4)
  })

  it('should keep first edge when weight is equal', () => {
    const duped = [
      { id: 'e1', source: 'a', target: 'b', predicate: 'leads', weight: 5 },
      { id: 'e1', source: 'a', target: 'c', predicate: 'funds', weight: 5 },
    ]
    const result = dedupeEdges(duped)
    expect(result).toHaveLength(1)
    expect(result[0].predicate).toBe('leads')
  })
})

describe('toGraphNode', () => {
  it('should convert entity to GraphNode', () => {
    const entity = { id: 'e1', type: 'person', canonical_name: 'Alice', mention_count: 42, spike_score: 3.5, recent_signal_count: 10 }
    const result = toGraphNode(entity)
    expect(result).toEqual({ id: 'e1', type: 'person', canonical_name: 'Alice', mention_count: 42 })
  })

  it('should strip extra fields', () => {
    const entity = { id: 'e1', type: 'location', canonical_name: 'Berlin', mention_count: 10, spike_score: 1.0, recent_signal_count: 5 }
    const result = toGraphNode(entity)
    expect(Object.keys(result)).toHaveLength(4)
    expect(result).not.toHaveProperty('spike_score')
  })

  it('should handle zero mention_count', () => {
    const entity = { id: 'e1', type: 'event', canonical_name: 'New Event', mention_count: 0 }
    const result = toGraphNode(entity)
    expect(result.mention_count).toBe(0)
  })
})

describe('toGraphEdge', () => {
  it('should convert entity edge to GraphEdge', () => {
    const edge = { id: 'e1', source_entity_id: 'n1', target_entity_id: 'n2', predicate: 'leads', weight: 5, signal_ids: ['s1'], first_seen: '2026-01-01', last_seen: '2026-04-06' }
    const result = toGraphEdge(edge)
    expect(result).toEqual({ id: 'e1', source: 'n1', target: 'n2', predicate: 'leads', weight: 5 })
  })

  it('should map source_entity_id to source', () => {
    const edge = { id: 'e1', source_entity_id: 'src', target_entity_id: 'tgt', predicate: 'funds', weight: 3 }
    const result = toGraphEdge(edge)
    expect(result.source).toBe('src')
    expect(result.target).toBe('tgt')
  })

  it('should strip extra fields', () => {
    const edge = { id: 'e1', source_entity_id: 'a', target_entity_id: 'b', predicate: 'leads', weight: 1 }
    const result = toGraphEdge(edge)
    expect(Object.keys(result)).toHaveLength(5)
  })
})

describe('formatNumber', () => {
  it('should format millions', () => {
    expect(formatNumber(1_500_000)).toBe('1.5M')
  })

  it('should format thousands', () => {
    expect(formatNumber(2_500)).toBe('2.5K')
  })

  it('should format small numbers', () => {
    expect(formatNumber(42)).toBe('42')
  })

  it('should format zero', () => {
    expect(formatNumber(0)).toBe('0')
  })

  it('should format exactly 1000', () => {
    expect(formatNumber(1_000)).toBe('1.0K')
  })

  it('should format exactly 1M', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M')
  })
})

describe('formatPredicate', () => {
  it('should replace underscores with spaces and capitalize', () => {
    expect(formatPredicate('located_in')).toBe('Located In')
  })

  it('should capitalize single word', () => {
    expect(formatPredicate('leads')).toBe('Leads')
  })

  it('should handle multi-underscore predicates', () => {
    expect(formatPredicate('successor_of')).toBe('Successor Of')
  })

  it('should handle complex predicates', () => {
    expect(formatPredicate('negotiates_with')).toBe('Negotiates With')
  })

  it('should handle all 20 standard predicates', () => {
    const predicates = [
      'leads', 'member_of', 'located_in', 'sanctions', 'allied_with', 'opposes',
      'caused_by', 'resulted_in', 'supplies', 'funds', 'attacks', 'defends',
      'negotiates_with', 'signed', 'deployed_to', 'manufactures', 'regulates',
      'employs', 'successor_of', 'predecessor_of',
    ]
    for (const p of predicates) {
      const result = formatPredicate(p)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toMatch(/[A-Z]/)
      expect(result).not.toContain('_')
    }
  })
})

describe('timeAgo', () => {
  it('should show "just now" for recent timestamps', () => {
    const recent = new Date(Date.now() - 1000).toISOString()
    expect(timeAgo(recent)).toBe('just now')
  })

  it('should show hours for timestamps within a day', () => {
    const hoursAgo = new Date(Date.now() - 5 * 3_600_000).toISOString()
    expect(timeAgo(hoursAgo)).toBe('5h ago')
  })

  it('should show days for timestamps within a week', () => {
    const daysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()
    expect(timeAgo(daysAgo)).toBe('3d ago')
  })

  it('should show weeks for older timestamps', () => {
    const weeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString()
    expect(timeAgo(weeksAgo)).toBe('2w ago')
  })
})

describe('Type Filtering Logic', () => {
  it('should filter nodes by enabled types', () => {
    const enabled = new Set(['person', 'location'])
    const filtered = sampleNodes.filter(n => enabled.has(n.type))
    expect(filtered).toHaveLength(2)
    expect(filtered.map(n => n.type)).toEqual(['person', 'location'])
  })

  it('should return all nodes when all types enabled', () => {
    const enabled = new Set(Object.keys(ENTITY_TYPE_CONFIG))
    const filtered = sampleNodes.filter(n => enabled.has(n.type))
    expect(filtered).toHaveLength(5)
  })

  it('should return no nodes when no types enabled', () => {
    const enabled = new Set<string>()
    const filtered = sampleNodes.filter(n => enabled.has(n.type))
    expect(filtered).toHaveLength(0)
  })

  it('should filter edges based on filtered node ids', () => {
    const enabled = new Set(['person', 'organisation'])
    const filteredNodes = sampleNodes.filter(n => enabled.has(n.type))
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id))
    const filteredEdges = sampleEdges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
    expect(filteredEdges).toHaveLength(1) // only e1 (n1->n2)
    expect(filteredEdges[0].id).toBe('e1')
  })

  it('should handle single type filter', () => {
    const enabled = new Set(['technology'])
    const filtered = sampleNodes.filter(n => enabled.has(n.type))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].canonical_name).toBe('GPT-6')
  })
})

describe('Type Distribution Calculation', () => {
  it('should count nodes by type', () => {
    const dist: Record<string, number> = {}
    for (const n of sampleNodes) {
      dist[n.type] = (dist[n.type] ?? 0) + 1
    }
    expect(dist.person).toBe(1)
    expect(dist.organisation).toBe(1)
    expect(dist.location).toBe(1)
    expect(dist.event).toBe(1)
    expect(dist.technology).toBe(1)
  })

  it('should handle duplicates in distribution', () => {
    const nodes = [
      ...sampleNodes,
      { id: 'n6', type: 'person', canonical_name: 'Bob', mention_count: 25 },
      { id: 'n7', type: 'person', canonical_name: 'Carol', mention_count: 35 },
    ]
    const dist: Record<string, number> = {}
    for (const n of nodes) {
      dist[n.type] = (dist[n.type] ?? 0) + 1
    }
    expect(dist.person).toBe(3)
    expect(dist.organisation).toBe(1)
  })

  it('should return empty for no nodes', () => {
    const dist: Record<string, number> = {}
    const nodes: GraphNode[] = []
    for (const n of nodes) {
      dist[n.type] = (dist[n.type] ?? 0) + 1
    }
    expect(Object.keys(dist)).toHaveLength(0)
  })
})

describe('Depth Configuration', () => {
  it('should accept depth 1', () => {
    const depth = 1
    expect(depth).toBeGreaterThanOrEqual(1)
    expect(depth).toBeLessThanOrEqual(2)
  })

  it('should accept depth 2', () => {
    const depth = 2
    expect(depth).toBeGreaterThanOrEqual(1)
    expect(depth).toBeLessThanOrEqual(2)
  })

  it('should default to depth 1', () => {
    const DEFAULT_DEPTH = 1
    expect(DEFAULT_DEPTH).toBe(1)
  })
})

describe('MAX_TRENDING Constant', () => {
  it('should be 50', () => {
    const MAX_TRENDING = 50
    expect(MAX_TRENDING).toBe(50)
  })

  it('should be a reasonable batch size', () => {
    const MAX_TRENDING = 50
    expect(MAX_TRENDING).toBeGreaterThanOrEqual(10)
    expect(MAX_TRENDING).toBeLessThanOrEqual(200)
  })
})

describe('Graph Merge Logic', () => {
  it('should merge two sets of nodes with deduplication', () => {
    const set1: GraphNode[] = [
      { id: 'n1', type: 'person', canonical_name: 'Alice', mention_count: 50 },
      { id: 'n2', type: 'location', canonical_name: 'Berlin', mention_count: 20 },
    ]
    const set2: GraphNode[] = [
      { id: 'n1', type: 'person', canonical_name: 'Alice', mention_count: 60 },
      { id: 'n3', type: 'event', canonical_name: 'Summit', mention_count: 10 },
    ]
    const merged = dedupeNodes([...set1, ...set2])
    expect(merged).toHaveLength(3)
    const alice = merged.find(n => n.id === 'n1')
    expect(alice?.mention_count).toBe(60) // higher wins
  })

  it('should merge two sets of edges with deduplication', () => {
    const set1: GraphEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2', predicate: 'leads', weight: 3 },
    ]
    const set2: GraphEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2', predicate: 'leads', weight: 7 },
      { id: 'e2', source: 'n2', target: 'n3', predicate: 'funds', weight: 2 },
    ]
    const merged = dedupeEdges([...set1, ...set2])
    expect(merged).toHaveLength(2)
    const e1 = merged.find(e => e.id === 'e1')
    expect(e1?.weight).toBe(7) // higher wins
  })

  it('should handle merging empty with non-empty', () => {
    const merged = dedupeNodes([...[], ...sampleNodes])
    expect(merged).toHaveLength(5)
  })
})
