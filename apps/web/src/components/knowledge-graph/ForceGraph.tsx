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
  /** Always label this many of the most-mentioned nodes (others on hover) */
  labelCount?: number
  /** Its own type filter and hints; off when the page has its own (the explorer) */
  chrome?: boolean
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

const MIN_RADIUS = 6
const MAX_RADIUS = 26
/**
 * The layout is d3's force model, written out: nodes repel each other
 * (falling off with distance, bigger nodes harder), links pull like springs,
 * a pull toward the middle keeps the graph on screen, and nodes never overlap.
 * It cools down and stops, so names hold still to be read; dragging a node
 * warms it up again. (The first version pulled everything to the middle and
 * repelled only up close, so it never settled and the nodes piled up.)
 */
const CHARGE = -90
const LINK_DISTANCE = 50
const LINK_STRENGTH = 0.06
/** Of each node's speed kept from one frame to the next */
const VELOCITY_KEEP = 0.6
/** Cooling per frame: from 1 to the stop in about 300 frames (5 seconds) */
const ALPHA_DECAY = 0.0228
const ALPHA_MIN = 0.002
/** Room between nodes beyond their radii */
const NODE_GAP = 8
/** How far out from the middle the graph spreads, as a share of the canvas (links and gaps push a little further) */
const SPREAD_X = 0.38
const SPREAD_Y = 0.46
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

interface Simulation {
  nodes: SimNode[]
  edges: SimEdge[]
  /** The layout's temperature: 1 when new, it cools each frame and stops near 0 */
  alpha: number
}

const chargeOf = (n: SimNode) => CHARGE * (0.6 + n.radius / 15)

function initSimulation(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  width: number,
  height: number,
): Simulation {
  const maxMentions = Math.max(1, ...rawNodes.map(n => n.mention_count))
  const nodeMap = new Map<string, SimNode>()

  const nodes: SimNode[] = rawNodes.map((n, i) => {
    const t = (i / Math.max(1, rawNodes.length - 1)) * Math.PI * 2
    // Log scale: one entity with thousands of mentions shouldn't shrink all the rest to dots
    const radius = MIN_RADIUS + (Math.log1p(n.mention_count) / Math.log1p(maxMentions)) * (MAX_RADIUS - MIN_RADIUS)
    const spread = 0.2 + Math.random() * 0.8
    const sim: SimNode = {
      ...n,
      x: width / 2 + Math.cos(t) * width * SPREAD_X * 0.8 * spread,
      y: height / 2 + Math.sin(t) * height * SPREAD_Y * 0.8 * spread,
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

  return { nodes, edges, alpha: 1 }
}

function tickSimulation(sim: Simulation, width: number, height: number): void {
  const { nodes, edges } = sim
  const alpha = sim.alpha
  const cx = width / 2
  const cy = height / 2

  // Repulsion (d3's many-body force: each pair pushes apart by charge × alpha / distance)
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let l2 = dx * dx + dy * dy
      if (l2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; l2 = dx * dx + dy * dy + 0.01 }
      const toA = (chargeOf(b) * alpha) / l2
      const toB = (chargeOf(a) * alpha) / l2
      a.vx += dx * toA
      a.vy += dy * toA
      b.vx -= dx * toB
      b.vy -= dy * toB
    }
  }

  // Links: springs toward a rest length that leaves room for both nodes
  for (const edge of edges) {
    const s = edge.source
    const t = edge.target
    let dx = t.x + t.vx - s.x - s.vx
    let dy = t.y + t.vy - s.y - s.vy
    const l = Math.sqrt(dx * dx + dy * dy) || 1
    const k = ((l - (LINK_DISTANCE + s.radius + t.radius)) / l) * alpha * LINK_STRENGTH
    dx *= k
    dy *= k
    t.vx -= dx * 0.5
    t.vy -= dy * 0.5
    s.vx += dx * 0.5
    s.vy += dy * 0.5
  }

  // Toward the middle, as strong as the repulsion of all the nodes at SPREAD_X/SPREAD_Y of the canvas
  // (so the graph fills a wide screen instead of a circle in its middle)
  let charge = 0
  for (const node of nodes) charge += Math.abs(chargeOf(node))
  const gx = charge / Math.max(1, (width * SPREAD_X) ** 2)
  const gy = charge / Math.max(1, (height * SPREAD_Y) ** 2)
  for (const node of nodes) {
    node.vx += (cx - node.x) * gx * alpha
    node.vy += (cy - node.y) * gy * alpha
  }

  // Move
  for (const node of nodes) {
    if (node.fx !== null) { node.x = node.fx; node.vx = 0 } else { node.vx *= VELOCITY_KEEP; node.x += node.vx }
    if (node.fy !== null) { node.y = node.fy; node.vy = 0 } else { node.vy *= VELOCITY_KEEP; node.y += node.vy }
  }

  // No overlaps: pairs closer than their radii and a gap are pushed apart
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const min = a.radius + b.radius + NODE_GAP
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy
      if (l2 >= min * min) continue
      const l = Math.sqrt(l2) || 0.01
      const push = ((min - l) / l) * 0.5
      const aFixed = a.fx !== null
      const bFixed = b.fx !== null
      if (!aFixed) { a.x -= dx * push * (bFixed ? 2 : 1); a.y -= dy * push * (bFixed ? 2 : 1) }
      if (!bFixed) { b.x += dx * push * (aFixed ? 2 : 1); b.y += dy * push * (aFixed ? 2 : 1) }
    }
  }

  sim.alpha = alpha * (1 - ALPHA_DECAY)
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
  labelCount = 0,
  chrome = true,
}: ForceGraphProps) {
  // The names drawn without hovering: the most-mentioned nodes
  const labelled = useMemo(() => new Set(
    [...rawNodes].sort((a, b) => b.mention_count - a.mention_count).slice(0, labelCount).map(n => n.id),
  ), [rawNodes, labelCount])
  const labelledRef = useRef(labelled)
  labelledRef.current = labelled
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<Simulation | null>(null)
  const animRef = useRef<number>(0)
  const [dims, setDims] = useState({ w: propWidth ?? 800, h: propHeight ?? 500 })
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)
  const [dragNode, setDragNode] = useState<SimNode | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  /** Where a press on a node started, to tell a click from a drag */
  const pressRef = useRef<{ x: number; y: number } | null>(null)

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

      // Tick physics until the layout has cooled (a dragged node keeps it warm)
      const sim = simRef.current
      if (sim && sim.nodes.length > 0) {
        if (sim.nodes.some(n => n.fx !== null)) sim.alpha = Math.max(sim.alpha, 0.3)
        if (sim.alpha >= ALPHA_MIN) tickSimulation(sim, dims.w, dims.h)
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

        // What links the two, on hover ("co-occurs with", the only kind so far, says nothing)
        if (isHighlighted && hoveredNode && edge.predicate !== 'co_occurs_with') {
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
      }

      // Names, over all the nodes: the selected and hovered ones first, then the
      // most-mentioned; a name that would overlap one already drawn is skipped
      const named = nodes
        .filter(n => n.id === selectedNodeId || n.id === hoveredNode?.id
          || (labelledRef.current.size > 0 ? labelledRef.current.has(n.id) : n.radius > 16))
        .sort((a, b) => Number(b.id === hoveredNode?.id || b.id === selectedNodeId) - Number(a.id === hoveredNode?.id || a.id === selectedNodeId)
          || b.mention_count - a.mention_count)
      const placed: Array<[number, number, number, number]> = []
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (const node of named) {
        const strong = node.id === selectedNodeId || node.id === hoveredNode?.id
        const label = node.canonical_name
        ctx.font = `${strong ? 'bold ' : ''}11px Inter, system-ui, sans-serif`
        const tw = ctx.measureText(label).width
        const box: [number, number, number, number] = [node.x - tw / 2 - 3, node.y + node.radius + 3, tw + 6, 14]
        const clash = placed.some(([x, y, w, h]) => box[0] < x + w && x < box[0] + box[2] && box[1] < y + h && y < box[1] + box[3])
        if (clash && !strong) continue
        placed.push(box)
        ctx.fillStyle = LABEL_BG
        ctx.fillRect(box[0], box[1], box[2], box[3])
        ctx.fillStyle = TEXT_COLOR
        ctx.fillText(label, node.x, box[1] + 1)
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
        pressRef.current = { x: e.clientX, y: e.clientY }
        hit.fx = hit.x
        hit.fy = hit.y
      } else {
        setIsPanning(true)
        setPanStart({ x: e.clientX, y: e.clientY })
      }
    },
    [screenToWorld, hitTest],
  )

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragNode) {
      // A press that barely moved is a click; a drag only moves the node
      const press = pressRef.current
      const moved = press ? Math.hypot(e.clientX - press.x, e.clientY - press.y) : 0
      if (onNodeClick && moved < 5) {
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
      {chrome && <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-2">
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
      </div>}

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
{chrome && (
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 text-[10px] text-gray-500">
        <span>Scroll to zoom</span>
        <span>Drag to pan</span>
        <span>Click node to explore</span>
        <span className="text-gray-600">
          {filteredNodes.length} nodes · {filteredEdges.length} edges
        </span>
      </div>
      )}

      {/* Canvas */}
      {/* A given height, or the whole of the parent (the explorer is full-screen) */}
      <div ref={containerRef} className={propHeight ? 'w-full' : 'w-full h-full min-h-[360px]'} style={propHeight ? { height: propHeight } : undefined}>
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
