'use client'

/**
 * Full-Graph Explorer — Interactive Knowledge Graph Exploration Page
 *
 * Standalone full-screen page that loads top trending entities from the
 * WorldPulse Knowledge Graph API, fetches their neighborhoods, and renders
 * the merged result as a fully interactive force-directed graph.
 *
 * Features:
 *   - Auto-loads top 50 trending entities + their 1-hop neighborhoods
 *   - Full-screen Canvas 2D force simulation (ForceGraph component)
 *   - Entity detail sidebar on node click (name, type, mentions, signals)
 *   - Search bar to find and focus on specific entities
 *   - Entity type toggles to filter the visible graph
 *   - Depth controls to expand the neighborhood (1-hop, 2-hop)
 *   - Stats bar: total nodes, edges, entity type distribution
 *   - Link to entity detail page from sidebar
 *   - Keyboard shortcuts: Escape to deselect, / to focus search
 *   - Responsive: adapts to viewport, sidebar slides on mobile
 *
 * No competitor (Ground News, GDELT, WorldMonitor, Factiverse, Reuters,
 * AP Wire) offers an interactive full-graph entity exploration experience.
 *
 * Endpoints consumed:
 *   GET /api/v1/knowledge-graph/trending
 *   GET /api/v1/knowledge-graph/entities/:id/graph
 *   GET /api/v1/knowledge-graph/entities?search=...
 *   GET /api/v1/knowledge-graph/stats
 *
 * @module app/knowledge-graph/explorer/page
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'

const ForceGraph = dynamic(
  () => import('../../../components/knowledge-graph/ForceGraph'),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-500 text-sm">
        Loading graph visualization...
      </div>
    ),
  },
)

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EntityNode {
  id: string
  type: string
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
  source_name?: string
  source_type?: string
  target_name?: string
  target_type?: string
  first_seen: string
  last_seen: string
}

interface TrendingEntity {
  id: string
  type: string
  canonical_name: string
  mention_count: number
  spike_score: number
  recent_signal_count: number
}

interface GraphStats {
  total_entities: number
  total_edges: number
  entities_by_type: Record<string, number>
  edges_by_predicate: Record<string, number>
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

// ─── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

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

const MAX_TRENDING = 50
const DEFAULT_DEPTH = 1

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

function toGraphNode(entity: EntityNode | TrendingEntity): GraphNode {
  return {
    id: entity.id,
    type: entity.type,
    canonical_name: entity.canonical_name,
    mention_count: entity.mention_count,
  }
}

function toGraphEdge(edge: EntityEdge): GraphEdge {
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

// ─── Data Fetching Hooks ───────────────────────────────────────────────────────

function useTrendingEntities() {
  const [data, setData] = useState<TrendingEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/knowledge-graph/trending?limit=${MAX_TRENDING}&window_hours=168`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) setData(json.data ?? json.entities ?? json ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load trending')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}

function useGraphStats() {
  const [stats, setStats] = useState<GraphStats | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/knowledge-graph/stats`)
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setStats(json.data ?? json)
      } catch { /* non-critical */ }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return stats
}

async function fetchEntityGraph(entityId: string, depth: number = 1): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  try {
    const res = await fetch(`${API_BASE}/knowledge-graph/entities/${entityId}/graph?depth=${depth}`)
    if (!res.ok) return { nodes: [], edges: [] }
    const json = await res.json()
    const raw = json.data ?? json
    const nodes: GraphNode[] = (raw.nodes ?? []).map((n: EntityNode) => toGraphNode(n))
    const edges: GraphEdge[] = (raw.edges ?? []).map((e: EntityEdge) => toGraphEdge(e))
    return { nodes, edges }
  } catch {
    return { nodes: [], edges: [] }
  }
}

async function searchEntities(query: string): Promise<EntityNode[]> {
  try {
    const res = await fetch(`${API_BASE}/knowledge-graph/entities?search=${encodeURIComponent(query)}&limit=10`)
    if (!res.ok) return []
    const json = await res.json()
    return json.data ?? json.entities ?? json ?? []
  } catch {
    return []
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function KnowledgeGraphExplorerPage() {
  // Graph data
  const [allNodes, setAllNodes] = useState<GraphNode[]>([])
  const [allEdges, setAllEdges] = useState<GraphEdge[]>([])
  const [loadingGraph, setLoadingGraph] = useState(true)
  const [loadedEntityIds, setLoadedEntityIds] = useState<Set<string>>(new Set())

  // Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<EntityNode | null>(null)
  const [neighborEdges, setNeighborEdges] = useState<EntityEdge[]>([])

  // Filters
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(Object.keys(ENTITY_TYPE_CONFIG)))
  const [depth, setDepth] = useState(DEFAULT_DEPTH)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<EntityNode[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Trending + stats
  const { data: trending, loading: trendingLoading, error: trendingError } = useTrendingEntities()
  const graphStats = useGraphStats()

  // ─── Load initial graph from trending entities ─────────────────────────────

  useEffect(() => {
    if (trendingLoading || trending.length === 0) return
    let cancelled = false

    async function buildGraph() {
      setLoadingGraph(true)
      const batchSize = 10
      let mergedNodes: GraphNode[] = trending.map(t => toGraphNode(t as any))
      let mergedEdges: GraphEdge[] = []
      const loaded = new Set<string>()

      // Fetch neighborhoods for top entities in parallel batches
      for (let i = 0; i < Math.min(trending.length, MAX_TRENDING); i += batchSize) {
        const batch = trending.slice(i, i + batchSize)
        const results = await Promise.allSettled(
          batch.map(t => fetchEntityGraph(t.id, depth))
        )
        for (const result of results) {
          if (result.status === 'fulfilled') {
            mergedNodes = [...mergedNodes, ...result.value.nodes]
            mergedEdges = [...mergedEdges, ...result.value.edges]
          }
        }
        for (const t of batch) loaded.add(t.id)
      }

      if (!cancelled) {
        setAllNodes(dedupeNodes(mergedNodes))
        setAllEdges(dedupeEdges(mergedEdges))
        setLoadedEntityIds(loaded)
        setLoadingGraph(false)
      }
    }

    buildGraph()
    return () => { cancelled = true }
  }, [trending, trendingLoading, depth])

  // ─── Filtered graph (by type toggles) ──────────────────────────────────────

  const filteredNodes = useMemo(() => {
    return allNodes.filter(n => typeFilters.has(n.type))
  }, [allNodes, typeFilters])

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes])

  const filteredEdges = useMemo(() => {
    return allEdges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
  }, [allEdges, filteredNodeIds])

  // ─── Node click handler ────────────────────────────────────────────────────

  const handleNodeClick = useCallback(async (node: GraphNode) => {
    setSelectedNodeId(node.id)
    setSidebarOpen(true)

    // Fetch full entity detail
    try {
      const res = await fetch(`${API_BASE}/knowledge-graph/entities/${node.id}`)
      if (res.ok) {
        const json = await res.json()
        setSelectedEntity(json.data ?? json)
      }
    } catch { /* non-critical */ }

    // Fetch edges for detail panel
    try {
      const res = await fetch(`${API_BASE}/knowledge-graph/edges?entity_id=${node.id}&limit=20`)
      if (res.ok) {
        const json = await res.json()
        setNeighborEdges(json.data ?? json.edges ?? json ?? [])
      }
    } catch { /* non-critical */ }

    // Expand graph with this entity's neighborhood if not already loaded
    if (!loadedEntityIds.has(node.id)) {
      const { nodes: newNodes, edges: newEdges } = await fetchEntityGraph(node.id, depth)
      setAllNodes(prev => dedupeNodes([...prev, ...newNodes]))
      setAllEdges(prev => dedupeEdges([...prev, ...newEdges]))
      setLoadedEntityIds(prev => new Set([...prev, node.id]))
    }
  }, [loadedEntityIds, depth])

  // ─── Search ────────────────────────────────────────────────────────────────

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (value.trim().length < 2) {
      setSearchResults([])
      return
    }
    searchTimeoutRef.current = setTimeout(async () => {
      const results = await searchEntities(value)
      setSearchResults(results)
    }, 300)
  }, [])

  const handleSearchSelect = useCallback(async (entity: EntityNode) => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])

    // Add this entity to the graph
    const graphNode = toGraphNode(entity)
    const { nodes: newNodes, edges: newEdges } = await fetchEntityGraph(entity.id, depth)
    setAllNodes(prev => dedupeNodes([...prev, graphNode, ...newNodes]))
    setAllEdges(prev => dedupeEdges([...prev, ...newEdges]))
    setLoadedEntityIds(prev => new Set([...prev, entity.id]))

    // Select it
    setSelectedNodeId(entity.id)
    setSelectedEntity(entity)
    setSidebarOpen(true)
  }, [depth])

  // ─── Type filter toggles ──────────────────────────────────────────────────

  const toggleTypeFilter = useCallback((type: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  const toggleAllTypes = useCallback(() => {
    setTypeFilters(prev => {
      if (prev.size === Object.keys(ENTITY_TYPE_CONFIG).length) {
        return new Set()
      }
      return new Set(Object.keys(ENTITY_TYPE_CONFIG))
    })
  }, [])

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          setSearchResults([])
        } else {
          setSelectedNodeId(null)
          setSelectedEntity(null)
          setSidebarOpen(false)
        }
      }
      if (e.key === '/' && !searchOpen && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchOpen])

  // ─── Entity type distribution from current graph ───────────────────────────

  const typeDistribution = useMemo(() => {
    const dist: Record<string, number> = {}
    for (const n of filteredNodes) {
      dist[n.type] = (dist[n.type] ?? 0) + 1
    }
    return dist
  }, [filteredNodes])

  // ─── Render ────────────────────────────────────────────────────────────────

  const isLoading = trendingLoading || loadingGraph

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-gray-950 text-gray-100">
      {/* ── Main Graph Area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm z-10">
          <div className="flex items-center gap-3">
            <a href="/knowledge-graph" className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </a>
            <h1 className="text-lg font-semibold tracking-tight">
              Knowledge Graph Explorer
            </h1>
            <span className="px-2 py-0.5 text-xs font-medium bg-indigo-500/20 text-indigo-300 rounded-full border border-indigo-500/30">
              INTERACTIVE
            </span>
          </div>

          {/* Search */}
          <div className="relative">
            <button
              onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-gray-400 text-sm hover:border-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search entities...
              <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-gray-800 text-gray-500 rounded border border-gray-700">/</kbd>
            </button>

            {searchOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50">
                <div className="p-3">
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => handleSearchChange(e.target.value)}
                    placeholder="Search by name, alias, or type..."
                    className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                </div>
                {searchResults.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border-t border-gray-800">
                    {searchResults.map(entity => (
                      <button
                        key={entity.id}
                        onClick={() => handleSearchSelect(entity)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-800 transition-colors"
                      >
                        <span className="text-lg">{ENTITY_TYPE_CONFIG[entity.type]?.icon ?? '?'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-100 truncate">{entity.canonical_name}</div>
                          <div className="text-xs text-gray-500">{ENTITY_TYPE_CONFIG[entity.type]?.label ?? entity.type} &middot; {entity.mention_count} mentions</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {searchQuery.length >= 2 && searchResults.length === 0 && (
                  <div className="px-4 py-3 text-sm text-gray-500 border-t border-gray-800">No entities found</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Type Filter Bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/50 bg-gray-950/60 overflow-x-auto">
          <button
            onClick={toggleAllTypes}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              typeFilters.size === Object.keys(ENTITY_TYPE_CONFIG).length
                ? 'bg-white/10 text-white'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            All
          </button>
          {Object.entries(ENTITY_TYPE_CONFIG).map(([type, config]) => (
            <button
              key={type}
              onClick={() => toggleTypeFilter(type)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                typeFilters.has(type)
                  ? 'text-white'
                  : 'bg-gray-800/50 text-gray-600 hover:text-gray-400'
              }`}
              style={typeFilters.has(type) ? { backgroundColor: config.color + '25', borderColor: config.color + '50' } : undefined}
            >
              <span>{config.icon}</span>
              {config.label}
              {typeDistribution[type] ? (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-white/10">{typeDistribution[type]}</span>
              ) : null}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <span>Depth:</span>
            {[1, 2].map(d => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`px-2 py-0.5 rounded ${depth === d ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
              >
                {d}-hop
              </button>
            ))}
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-4 px-4 py-1.5 border-b border-gray-800/30 text-xs text-gray-500">
          <span>{formatNumber(filteredNodes.length)} nodes</span>
          <span>{formatNumber(filteredEdges.length)} edges</span>
          {graphStats && (
            <>
              <span className="text-gray-700">|</span>
              <span>Global: {formatNumber(graphStats.total_entities)} entities, {formatNumber(graphStats.total_edges)} relationships</span>
            </>
          )}
          {isLoading && (
            <span className="flex items-center gap-1 text-amber-400">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading graph...
            </span>
          )}
        </div>

        {/* Graph Canvas */}
        <div className="flex-1 relative">
          {trendingError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-red-400 text-lg mb-2">Failed to load graph data</div>
                <div className="text-gray-500 text-sm">{trendingError}</div>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-500 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <ForceGraph
              nodes={filteredNodes}
              edges={filteredEdges}
              onNodeClick={handleNodeClick as any}
              selectedNodeId={selectedNodeId}
              className="w-full h-full"
            />
          )}
        </div>
      </div>

      {/* ── Detail Sidebar ───────────────────────────────────────────────── */}
      <div
        className={`absolute right-0 top-0 h-full w-80 bg-gray-900 border-l border-gray-800 shadow-2xl transform transition-transform duration-300 z-20 overflow-y-auto ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {selectedEntity ? (
          <div className="p-4">
            {/* Close Button */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg">{ENTITY_TYPE_CONFIG[selectedEntity.type]?.icon ?? '?'}</span>
              <button
                onClick={() => { setSidebarOpen(false); setSelectedNodeId(null); setSelectedEntity(null) }}
                className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Entity Name */}
            <h2 className="text-xl font-bold text-white mb-1">{selectedEntity.canonical_name}</h2>
            <div className="flex items-center gap-2 mb-4">
              <span
                className="px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: (ENTITY_TYPE_CONFIG[selectedEntity.type]?.color ?? '#666') + '25',
                  color: ENTITY_TYPE_CONFIG[selectedEntity.type]?.color ?? '#999',
                }}
              >
                {ENTITY_TYPE_CONFIG[selectedEntity.type]?.label ?? selectedEntity.type}
              </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-800">
                <div className="text-lg font-bold text-white">{formatNumber(selectedEntity.mention_count)}</div>
                <div className="text-xs text-gray-500">Mentions</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-800">
                <div className="text-lg font-bold text-white">{selectedEntity.signal_ids?.length ?? 0}</div>
                <div className="text-xs text-gray-500">Signals</div>
              </div>
            </div>

            {/* Aliases */}
            {selectedEntity.aliases && selectedEntity.aliases.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Also Known As</div>
                <div className="flex flex-wrap gap-1">
                  {selectedEntity.aliases.slice(0, 8).map((alias, i) => (
                    <span key={i} className="px-2 py-0.5 text-xs bg-gray-800 text-gray-400 rounded">
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
              <div>
                <div className="text-gray-600">First Seen</div>
                <div className="text-gray-400">{selectedEntity.first_seen ? timeAgo(selectedEntity.first_seen) : '—'}</div>
              </div>
              <div>
                <div className="text-gray-600">Last Seen</div>
                <div className="text-gray-400">{selectedEntity.last_seen ? timeAgo(selectedEntity.last_seen) : '—'}</div>
              </div>
            </div>

            {/* Relationships */}
            {neighborEdges.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  Relationships ({neighborEdges.length})
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {neighborEdges.map(edge => {
                    const isSource = edge.source_entity_id === selectedEntity.id
                    const otherName = isSource ? edge.target_name : edge.source_name
                    const otherType = isSource ? edge.target_type : edge.source_type
                    return (
                      <div key={edge.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-800/30 text-xs">
                        <span>{ENTITY_TYPE_CONFIG[otherType ?? '']?.icon ?? '?'}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-gray-300 truncate block">{otherName ?? 'Unknown'}</span>
                          <span className="text-gray-600">{formatPredicate(edge.predicate)}</span>
                        </div>
                        <span className="text-gray-700 text-[10px]">w:{edge.weight}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2">
              <a
                href={`/knowledge-graph?entity=${selectedEntity.id}`}
                className="block w-full text-center px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
              >
                View Full Entity Detail
              </a>
              <button
                onClick={async () => {
                  const { nodes: newNodes, edges: newEdges } = await fetchEntityGraph(selectedEntity.id, 2)
                  setAllNodes(prev => dedupeNodes([...prev, ...newNodes]))
                  setAllEdges(prev => dedupeEdges([...prev, ...newEdges]))
                  setLoadedEntityIds(prev => new Set([...prev, selectedEntity.id]))
                }}
                className="block w-full text-center px-4 py-2 rounded-lg border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Expand 2-Hop Neighborhood
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-gray-500 text-sm">
            <div className="mt-8">Click a node to see details</div>
          </div>
        )}
      </div>

      {/* ── Legend Overlay (bottom-left) ──────────────────────────────────── */}
      <div className="absolute bottom-4 left-4 bg-gray-900/90 border border-gray-800 rounded-xl p-3 backdrop-blur-sm z-10">
        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">Legend</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {Object.entries(ENTITY_TYPE_CONFIG).map(([type, config]) => (
            <div key={type} className="flex items-center gap-1.5 text-xs text-gray-400">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }} />
              {config.label}
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-gray-800 text-[10px] text-gray-600">
          Scroll to zoom &middot; Drag to pan &middot; Click node to explore &middot; Press / to search
        </div>
      </div>
    </div>
  )
}
