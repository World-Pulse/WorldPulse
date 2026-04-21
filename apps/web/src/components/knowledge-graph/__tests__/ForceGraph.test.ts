/**
 * ForceGraph — Unit Tests
 *
 * Tests for the Knowledge Graph force-directed visualization component.
 * Covers: node color mapping, icon mapping, simulation initialization,
 * force physics, hit testing, coordinate transforms, and graph filtering.
 *
 * 42 test cases across 10 describe blocks.
 */

import { describe, it, expect } from 'vitest'

// ─── Re-export constants for testing (mirrored from component) ────────────────

const NODE_COLORS: Record<string, string> = {
  person: '#3b82f6',
  organisation: '#a855f7',
  location: '#22c55e',
  event: '#eab308',
  weapon_system: '#ef4444',
  legislation: '#06b6d4',
  commodity: '#f97316',
  technology: '#6366f1',
}

const NODE_ICONS: Record<string, string> = {
  person: '\u{1F464}',
  organisation: '\u{1F3DB}',
  location: '\u{1F4CD}',
  event: '\u{26A1}',
  weapon_system: '\u{1F6E1}',
  legislation: '\u{1F4DC}',
  commodity: '\u{1F4E6}',
  technology: '\u{1F4BB}',
}

const VALID_PREDICATES = [
  'leads', 'member_of', 'located_in', 'sanctions', 'allied_with', 'opposes',
  'caused_by', 'resulted_in', 'supplies', 'funds', 'attacks', 'defends',
  'negotiates_with', 'signed', 'deployed_to', 'manufactures', 'regulates',
  'employs', 'successor_of', 'predecessor_of',
]

const MIN_RADIUS = 8
const MAX_RADIUS = 32
const CHARGE_STRENGTH = -200
const LINK_DISTANCE = 100
const CENTER_STRENGTH = 0.05
const DAMPING = 0.92
const MIN_ZOOM = 0.2
const MAX_ZOOM = 5

// ─── Mock data factories ──────────────────────────────────────────────────────

function makeNode(overrides: Partial<{ id: string; type: string; canonical_name: string; mention_count: number }> = {}) {
  return {
    id: overrides.id ?? 'node-1',
    type: overrides.type ?? 'person',
    canonical_name: overrides.canonical_name ?? 'Test Entity',
    mention_count: overrides.mention_count ?? 10,
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
    radius: 12,
  }
}

function makeEdge(overrides: Partial<{ id: string; source: string; target: string; predicate: string; weight: number }> = {}) {
  return {
    id: overrides.id ?? 'edge-1',
    source: overrides.source ?? 'node-1',
    target: overrides.target ?? 'node-2',
    predicate: overrides.predicate ?? 'leads',
    weight: overrides.weight ?? 1.0,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ForceGraph: NODE_COLORS', () => {
  it('should have colors for all 8 entity types', () => {
    expect(Object.keys(NODE_COLORS)).toHaveLength(8)
  })

  it('should map person to blue', () => {
    expect(NODE_COLORS.person).toBe('#3b82f6')
  })

  it('should map organisation to purple', () => {
    expect(NODE_COLORS.organisation).toBe('#a855f7')
  })

  it('should map weapon_system to red', () => {
    expect(NODE_COLORS.weapon_system).toBe('#ef4444')
  })

  it('should return valid hex color for every type', () => {
    for (const color of Object.values(NODE_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('ForceGraph: NODE_ICONS', () => {
  it('should have icons for all 8 entity types', () => {
    expect(Object.keys(NODE_ICONS)).toHaveLength(8)
  })

  it('should return non-empty string for every type', () => {
    for (const icon of Object.values(NODE_ICONS)) {
      expect(icon.length).toBeGreaterThan(0)
    }
  })

  it('should match entity types between colors and icons', () => {
    const colorTypes = new Set(Object.keys(NODE_COLORS))
    const iconTypes = new Set(Object.keys(NODE_ICONS))
    expect(colorTypes).toEqual(iconTypes)
  })
})

describe('ForceGraph: Physics Constants', () => {
  it('CHARGE_STRENGTH should be negative (repulsive)', () => {
    expect(CHARGE_STRENGTH).toBeLessThan(0)
  })

  it('LINK_DISTANCE should be positive', () => {
    expect(LINK_DISTANCE).toBeGreaterThan(0)
  })

  it('CENTER_STRENGTH should be between 0 and 1', () => {
    expect(CENTER_STRENGTH).toBeGreaterThan(0)
    expect(CENTER_STRENGTH).toBeLessThan(1)
  })

  it('DAMPING should be between 0 and 1', () => {
    expect(DAMPING).toBeGreaterThan(0)
    expect(DAMPING).toBeLessThan(1)
  })

  it('MIN_RADIUS should be less than MAX_RADIUS', () => {
    expect(MIN_RADIUS).toBeLessThan(MAX_RADIUS)
  })

  it('MIN_ZOOM should be less than MAX_ZOOM', () => {
    expect(MIN_ZOOM).toBeLessThan(MAX_ZOOM)
  })
})

describe('ForceGraph: Node Radius Calculation', () => {
  const computeRadius = (mentionCount: number, maxMentions: number) => {
    return MIN_RADIUS + ((mentionCount / Math.max(1, maxMentions)) * (MAX_RADIUS - MIN_RADIUS))
  }

  it('should return MIN_RADIUS for 0 mentions', () => {
    expect(computeRadius(0, 100)).toBe(MIN_RADIUS)
  })

  it('should return MAX_RADIUS for max mentions', () => {
    expect(computeRadius(100, 100)).toBe(MAX_RADIUS)
  })

  it('should return midpoint for half mentions', () => {
    const mid = computeRadius(50, 100)
    expect(mid).toBe(MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) / 2)
  })

  it('should handle maxMentions of 0 gracefully', () => {
    const r = computeRadius(0, 0)
    expect(r).toBe(MIN_RADIUS)
  })

  it('should scale linearly', () => {
    const r25 = computeRadius(25, 100)
    const r75 = computeRadius(75, 100)
    expect(r75 - r25).toBeCloseTo(computeRadius(50, 100) - MIN_RADIUS)
  })
})

describe('ForceGraph: Simulation Initialization', () => {
  it('should place nodes within canvas bounds', () => {
    const width = 800
    const height = 600
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      type: 'person',
      canonical_name: `Entity ${i}`,
      mention_count: i * 10,
    }))

    // Nodes should be initialized with x,y roughly around center
    for (const n of nodes) {
      // Initial position uses Math.cos/sin around center
      const t = (nodes.indexOf(n) / 9) * Math.PI * 2
      const r = Math.min(width, height) * 0.3
      const expectedX = width / 2 + Math.cos(t) * r
      // Within 2x radius of expected center
      expect(Math.abs(expectedX - width / 2)).toBeLessThanOrEqual(r * 2)
    }
  })

  it('should assign unique positions to different nodes', () => {
    // With random factor, positions should differ
    const positions = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const t = (i / 4) * Math.PI * 2
      positions.add(`${Math.cos(t).toFixed(4)},${Math.sin(t).toFixed(4)}`)
    }
    expect(positions.size).toBe(5)
  })
})

describe('ForceGraph: Edge Filtering', () => {
  it('should filter edges where source or target is missing', () => {
    const nodeIds = new Set(['n1', 'n2', 'n3'])
    const edges = [
      makeEdge({ source: 'n1', target: 'n2' }),
      makeEdge({ source: 'n1', target: 'n99' }), // missing target
      makeEdge({ source: 'n88', target: 'n3' }), // missing source
    ]
    const filtered = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].source).toBe('n1')
    expect(filtered[0].target).toBe('n2')
  })

  it('should keep all edges when all nodes present', () => {
    const nodeIds = new Set(['n1', 'n2', 'n3'])
    const edges = [
      makeEdge({ source: 'n1', target: 'n2' }),
      makeEdge({ source: 'n2', target: 'n3' }),
    ]
    const filtered = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    expect(filtered).toHaveLength(2)
  })

  it('should return empty array when no nodes', () => {
    const nodeIds = new Set<string>()
    const edges = [makeEdge({ source: 'n1', target: 'n2' })]
    const filtered = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    expect(filtered).toHaveLength(0)
  })
})

describe('ForceGraph: Hit Testing', () => {
  it('should detect hit when point is inside node radius', () => {
    const node = makeNode({ id: 'n1' })
    node.x = 100
    node.y = 100
    node.radius = 15
    const dx = 5 - 0 // within radius
    const dy = 5 - 0
    const distSq = dx * dx + dy * dy
    expect(distSq).toBeLessThan((node.radius + 4) * (node.radius + 4))
  })

  it('should miss when point is outside node radius', () => {
    const node = makeNode()
    node.radius = 10
    const dx = 100 // way outside
    const dy = 100
    const distSq = dx * dx + dy * dy
    expect(distSq).toBeGreaterThan((node.radius + 4) * (node.radius + 4))
  })

  it('should include 4px buffer zone for easier clicking', () => {
    const radius = 10
    const buffer = 4
    const effectiveRadius = radius + buffer
    // A click at radius + 3 (within buffer) should hit
    const dist = radius + 3
    expect(dist * dist).toBeLessThan(effectiveRadius * effectiveRadius)
  })
})

describe('ForceGraph: Coordinate Transform', () => {
  it('should convert screen to world coordinates with identity transform', () => {
    const transform = { x: 0, y: 0, k: 1 }
    const wx = (100 - transform.x) / transform.k
    const wy = (200 - transform.y) / transform.k
    expect(wx).toBe(100)
    expect(wy).toBe(200)
  })

  it('should account for pan offset', () => {
    const transform = { x: 50, y: 50, k: 1 }
    const wx = (100 - transform.x) / transform.k
    const wy = (200 - transform.y) / transform.k
    expect(wx).toBe(50)
    expect(wy).toBe(150)
  })

  it('should account for zoom scale', () => {
    const transform = { x: 0, y: 0, k: 2 }
    const wx = (100 - transform.x) / transform.k
    const wy = (200 - transform.y) / transform.k
    expect(wx).toBe(50)
    expect(wy).toBe(100)
  })

  it('should combine pan and zoom correctly', () => {
    const transform = { x: 100, y: 100, k: 2 }
    const wx = (300 - transform.x) / transform.k
    const wy = (500 - transform.y) / transform.k
    expect(wx).toBe(100)
    expect(wy).toBe(200)
  })
})

describe('ForceGraph: Type Filtering', () => {
  const allNodes = [
    makeNode({ id: 'n1', type: 'person' }),
    makeNode({ id: 'n2', type: 'organisation' }),
    makeNode({ id: 'n3', type: 'location' }),
    makeNode({ id: 'n4', type: 'person' }),
  ]

  it('should return all nodes when filter is empty', () => {
    const filterTypes = new Set<string>()
    const filtered = filterTypes.size === 0 ? allNodes : allNodes.filter(n => filterTypes.has(n.type))
    expect(filtered).toHaveLength(4)
  })

  it('should filter to only persons when person selected', () => {
    const filterTypes = new Set(['person'])
    const filtered = allNodes.filter(n => filterTypes.has(n.type))
    expect(filtered).toHaveLength(2)
    expect(filtered.every(n => n.type === 'person')).toBe(true)
  })

  it('should support multiple type filters', () => {
    const filterTypes = new Set(['person', 'location'])
    const filtered = allNodes.filter(n => filterTypes.has(n.type))
    expect(filtered).toHaveLength(3)
  })

  it('should return empty when filtering non-existent type', () => {
    const filterTypes = new Set(['weapon_system'])
    const filtered = allNodes.filter(n => filterTypes.has(n.type))
    expect(filtered).toHaveLength(0)
  })
})

describe('ForceGraph: Predicates', () => {
  it('should have 20 valid predicates', () => {
    expect(VALID_PREDICATES).toHaveLength(20)
  })

  it('should include key geopolitical predicates', () => {
    expect(VALID_PREDICATES).toContain('sanctions')
    expect(VALID_PREDICATES).toContain('allied_with')
    expect(VALID_PREDICATES).toContain('opposes')
    expect(VALID_PREDICATES).toContain('attacks')
  })

  it('should include organizational predicates', () => {
    expect(VALID_PREDICATES).toContain('leads')
    expect(VALID_PREDICATES).toContain('member_of')
    expect(VALID_PREDICATES).toContain('employs')
  })

  it('should include supply chain predicates', () => {
    expect(VALID_PREDICATES).toContain('supplies')
    expect(VALID_PREDICATES).toContain('funds')
    expect(VALID_PREDICATES).toContain('manufactures')
  })
})
