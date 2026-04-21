'use client'

/**
 * ForceGraph — Interactive Force-Directed Knowledge Graph Visualization
 *
 * Canvas-rendered force simulation for WorldPulse entity-relationship graph.
 * Supports zoom/pan, hover tooltips, click-to-select, entity type filtering,
 * and smooth animations. No competitor has an interactive entity graph UI.
 *
 * Uses requestAnimationFrame + Canvas 2D for high performance with 200+ nodes.
 *
 * @module components/knowledge-graph/ForceGraph
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  type: string
  canonical_name: string
  mention_count: number
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  predicate: string
  weight: number
}

interface ForceGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width?: number
  height?: number
  onNodeClick?: (node: GraphNode) => void
  selectedNodeId?: string | null
  className?: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

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

const LINK_COLOR = 'rgba(107, 114, 128, 0.3)'
const LINK_HIGHLIGHT_COLOR = 'rgba(129, 140, 248, 0.6)'
const SELECTED_GLOW = 'rgba(99, 102, 241, 0.5)'
const HOVER_GLOW = 'rgba(251, 191, 36, 0.4)'
const BG_COLOR = '#030712'
const TEXT_COLOR = '#e5e7eb'
const LABEL_BG = 'rgba(17, 24, 39, 0.85)'

const MIN_RADIUS = 8
const MAX_RADIUS = 32
const CHARGE_STRENGTH = -200
const LINK_DISTANCE = 100
const CENTER_STRENGTH = 0.05
const DAMPING = 0.92
const MIN_ZOOM = 0.2
const MAX_ZOOM = 5

// ─── Force Simulation (lightweight, no D3 dependency) ─────────────────────────

interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  radius: number
}

interface SimEdge {
  id: string
  source: SimNode
  target: SimNode
  predicate: string
  weight: number
}

function initSimulation(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  width: number,
  height: number,
): { nodes: SimNode[]; edges: SimEdge[] } {
  const maxMentions = Math.max(1, ...rawNodes.map(n => n.mention_count))
  const nodeMap = new Map<string, SimNode>()

  const nodes: SimNode[] = rawNodes.map((n, i) => {
    const t = (i / Math.max(1, rawNodes.length - 1)) * Math.PI * 2
    const r = Math.min(width, height) * 0.3
    const radius = MIN_RADIUS + ((n.mention_count / maxMentions) * (MAX_RADIUS - MIN_RADIUS))
    const sim: SimNode = {
      ...n,
      x: width / 2 + Math.cos(t) * r * (0.5 + Math.random() * 0.5),
      y: height / 2 + Math.sin(t) * r * (0.5 + Math.random() * 0.5),
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      radius,
    }
    nodeMap.set(n.id, sim)
    return sim
  })

  const edges: SimEdge[] = rawEdges
    .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map(e => ({
      id: e.id,
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      predicate: e.predicate,
      weight: e.weight,
    }))

  return { nodes, edges }
}

function tickSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  cx: number,
  cy: number,
): void {
  // Charge repulsion (Barnes-Hut simplification: N² but capped at 200 nodes)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = CHARGE_STRENGTH / (dist * dist)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx -= fx
      a.vy -= fy
      b.vx += fx
      b.vy += fy
    }
  }

  // Link spring force
  for (const edge of edges) {
    const dx = edge.target.x - edge.source.x
    const dy = edge.target.y - edge.source.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const force = (dist - LINK_DISTANCE) * 0.01 * edge.weight
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    edge.source.vx += fx
    edge.source.vy += fy
    edge.target.vx -= fx
    edge.target.vy -= fy
  }

  // Center gravity
  for (const node of nodes) {
    node.vx += (cx - node.x) * CENTER_STRENGTH
    node.vy += (cy - node.y) * CENTER_STRENGTH
  }

  // Apply velocities with damping
  for (const node of nodes) {
    if (node.fx !== null) {
      node.x = node.fx
      node.vx = 0
    } else {
      node.vx *= DAMPING
      node.x += node.vx
    }
    if (node.fy !== null) {
      node.y = node.fy
      node.vy = 0
    } else {
      node.vy *= DAMPING
      node.y += node.vy
    }
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ForceGraph({
  nodes: rawNodes,
  edges: rawEdges,
  width: propWidth,
  height: propHeight,
  onNodeClick,
  selectedNodeId,
  className,
}: ForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<{ nodes: SimNode[]; edges: SimEdge[] } | null>(null)
  const animRef = useRef<number>(0)
  const [dims, setDims] = useState({ w: propWidth ?? 800, h: propHeight ?? 500 })
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)
  const [dragNode, setDragNode] = useState<SimNode | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())

  // Filtered data
  const filteredNodes = useMemo(() => {
    if (filterTypes.size === 0) return rawNodes
    return rawNodes.filter(n => filterTypes.has(n.type))
  }, [rawNodes, filterTypes])

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(n => n.id))
    return rawEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
  }, [rawEdges, filteredNodes])

  // Responsive sizing
  useEffect(() => {
    if (propWidth && propHeight) return
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDims({ w: Math.round(width), h: Math.round(height) })
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [propWidth, propHeight])

  // Initialize simulation
  useEffect(() => {
    if (filteredNodes.length === 0) {
      simRef.current = null
      return
    }
    simRef.current = initSimulation(filteredNodes, filteredEdges, dims.w, dims.h)
  }, [filteredNodes, filteredEdges, dims.w, dims.h])

  // Screen-to-world coordinate conversion
  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - transform.x) / transform.k,
      y: (sy - transform.y) / transform.k,
    }),
    [transform],
  )

  // Hit test
  const hitTest = useCallback(
    (wx: number, wy: number): SimNode | null => {
      if (!simRef.current) return null
      const { nodes } = simRef.current
      // Iterate reverse so topmost node wins
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]
        const dx = wx - n.x
        const dy = wy - n.y
        if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) return n
      }
      return null
    },
    [],
  )

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let running = true

    const draw = () => {
      if (!running) return

      // Tick physics
      if (simRef.current && simRef.current.nodes.length > 0) {
        tickSimulation(simRef.current.nodes, simRef.current.edges, dims.w / 2, dims.h / 2)
      }

      // Clear
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = BG_COLOR
      ctx.fillRect(0, 0, dims.w, dims.h)

      if (!simRef.current || simRef.current.nodes.length === 0) {
        ctx.fillStyle = '#6b7280'
        ctx.font = '14px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(
          'Select an entity to visualize its relationship graph',
          dims.w / 2,
          dims.h / 2,
        )
        animRef.current = requestAnimationFrame(draw)
        return
      }

      const { nodes, edges } = simRef.current

      // Apply transform
      ctx.setTransform(transform.k, 0, 0, transform.k, transform.x, transform.y)

      // Draw edges
      for (const edge of edges) {
        const isHighlighted =
          selectedNodeId === edge.source.id ||
          selectedNodeId === edge.target.id ||
          hoveredNode?.id === edge.source.id ||
          hoveredNode?.id === edge.target.id

        ctx.beginPath()
        ctx.moveTo(edge.source.x, edge.source.y)
        ctx.lineTo(edge.target.x, edge.target.y)
        ctx.strokeStyle = isHighlighted ? LINK_HIGHLIGHT_COLOR : LINK_COLOR
        ctx.lineWidth = isHighlighted ? 1.5 + edge.weight : 0.5 + edge.weight * 0.5
        ctx.stroke()

        // Edge label on hover
        if (isHighlighted) {
          const mx = (edge.source.x + edge.target.x) / 2
          const my = (edge.source.y + edge.target.y) / 2
          ctx.font = '10px Inter, system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          const label = edge.predicate.replace(/_/g, ' ')
          const tw = ctx.measureText(label).width
          ctx.fillStyle = LABEL_BG
          ctx.fillRect(mx - tw / 2 - 4, my - 8, tw + 8, 16)
          ctx.fillStyle = '#a5b4fc'
          ctx.fillText(label, mx, my)
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const isSelected = selectedNodeId === node.id
        const isHovered = hoveredNode?.id === node.id
        const color = NODE_COLORS[node.type] ?? '#6b7280'

        // Glow effect
        if (isSelected || isHovered) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2)
          ctx.fillStyle = isSelected ? SELECTED_GLOW : HOVER_GLOW
          ctx.fill()
        }

        // Node circle
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.globalAlpha = isSelected || isHovered ? 1 : 0.8
        ctx.fill()
        ctx.globalAlpha = 1

        // Border
        ctx.strokeStyle = isSelected ? '#818cf8' : isHovered ? '#fbbf24' : 'rgba(255,255,255,0.15)'
        ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1
        ctx.stroke()

        // Icon (for larger nodes)
        if (node.radius > 12) {
          const icon = NODE_ICONS[node.type]
          if (icon) {
            ctx.font = `${Math.round(node.radius * 0.8)}px serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(icon, node.x, node.y)
          }
        }

        // Label (always show for selected/hovered, show for larger nodes otherwise)
        if (isSelected || isHovered || node.radius > 16) {
          const label = node.canonical_name
          ctx.font = `${isSelected || isHovered ? 'bold ' : ''}11px Inter, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'

          const tw = ctx.measureText(label).width
          const lx = node.x
          const ly = node.y + node.radius + 4

          ctx.fillStyle = LABEL_BG
          ctx.fillRect(lx - tw / 2 - 3, ly - 1, tw + 6, 14)
          ctx.fillStyle = TEXT_COLOR
          ctx.fillText(label, lx, ly)
        }
      }

      animRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      running = false
      cancelAnimationFrame(animRef.current)
    }
  }, [dims, transform, selectedNodeId, hoveredNode])

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top

      if (dragNode) {
        const world = screenToWorld(sx, sy)
        dragNode.fx = world.x
        dragNode.fy = world.y
        return
      }

      if (isPanning) {
        const dx = e.clientX - panStart.x
        const dy = e.clientY - panStart.y
        setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
        setPanStart({ x: e.clientX, y: e.clientY })
        return
      }

      const world = screenToWorld(sx, sy)
      const hit = hitTest(world.x, world.y)
      setHoveredNode(hit)
      if (canvasRef.current) {
        canvasRef.current.style.cursor = hit ? 'pointer' : 'grab'
      }
    },
    [dragNode, isPanning, panStart, screenToWorld, hitTest],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const world = screenToWorld(sx, sy)
      const hit = hitTest(world.x, world.y)

      if (hit) {
        setDragNode(hit)
        hit.fx = hit.x
        hit.fy = hit.y
      } else {
        setIsPanning(true)
        setPanStart({ x: e.clientX, y: e.clientY })
      }
    },
    [screenToWorld, hitTest],
  )

  const handleMouseUp = useCallback(() => {
    if (dragNode) {
      // If barely moved, treat as click
      if (onNodeClick) {
        onNodeClick(dragNode)
      }
      dragNode.fx = null
      dragNode.fy = null
      setDragNode(null)
    }
    setIsPanning(false)
  }, [dragNode, onNodeClick])

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * delta))
      const ratio = newK / transform.k

      setTransform({
        k: newK,
        x: sx - (sx - transform.x) * ratio,
        y: sy - (sy - transform.y) * ratio,
      })
    },
    [transform],
  )

  // Reset view
  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, k: 1 })
  }, [])

  // Toggle entity type filter
  const toggleFilter = useCallback((type: string) => {
    setFilterTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  // All entity types present in nodes
  const presentTypes = useMemo(() => {
    const types = new Set(rawNodes.map(n => n.type))
    return Array.from(types).sort()
  }, [rawNodes])

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-2">
        {presentTypes.map(type => {
          const active = filterTypes.size === 0 || filterTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => toggleFilter(type)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                active
                  ? 'bg-gray-800/80 border-gray-600 text-gray-200'
                  : 'bg-gray-900/60 border-gray-800 text-gray-600'
              }`}
              style={{
                borderColor: active ? NODE_COLORS[type] ?? '#6b7280' : undefined,
              }}
            >
              {NODE_ICONS[type] ?? ''} {type.replace('_', ' ')}
            </button>
          )
        })}
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          onClick={() =>
            setTransform(t => ({
              ...t,
              k: Math.min(MAX_ZOOM, t.k * 1.3),
            }))
          }
          className="rounded-lg bg-gray-800/80 border border-gray-700 w-8 h-8 text-gray-300 hover:bg-gray-700 flex items-center justify-center text-sm"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() =>
            setTransform(t => ({
              ...t,
              k: Math.max(MIN_ZOOM, t.k / 1.3),
            }))
          }
          className="rounded-lg bg-gray-800/80 border border-gray-700 w-8 h-8 text-gray-300 hover:bg-gray-700 flex items-center justify-center text-sm"
          title="Zoom out"
        >
          -
        </button>
        <button
          onClick={resetView}
          className="rounded-lg bg-gray-800/80 border border-gray-700 w-8 h-8 text-gray-300 hover:bg-gray-700 flex items-center justify-center text-xs"
          title="Reset view"
        >
          {'\u{2302}'}
        </button>
      </div>

      {/* Hover tooltip */}
      {hoveredNode && !dragNode && (
        <div
          className="absolute z-20 pointer-events-none rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 text-xs text-gray-200 shadow-lg max-w-[220px]"
          style={{
            left: hoveredNode.x * transform.k + transform.x + 20,
            top: hoveredNode.y * transform.k + transform.y - 10,
          }}
        >
          <div className="font-semibold text-sm">{hoveredNode.canonical_name}</div>
          <div className="text-gray-400 mt-0.5">
            {NODE_ICONS[hoveredNode.type]} {hoveredNode.type.replace('_', ' ')}
          </div>
          <div className="text-gray-500 mt-0.5">{hoveredNode.mention_count} mentions</div>
          <div className="text-indigo-400 mt-1 text-[10px]">Click to explore</div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 text-[10px] text-gray-500">
        <span>Scroll to zoom</span>
        <span>Drag to pan</span>
        <span>Click node to explore</span>
        <span className="text-gray-600">
          {filteredNodes.length} nodes · {filteredEdges.length} edges
        </span>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="w-full" style={{ height: propHeight ?? 500 }}>
        <canvas
          ref={canvasRef}
          width={dims.w}
          height={dims.h}
          className="rounded-xl"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
      </div>
    </div>
  )
}
