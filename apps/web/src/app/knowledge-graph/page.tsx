'use client'

/**
 * Knowledge Graph Intelligence Dashboard
 *
 * Interactive exploration of the WorldPulse Entity-Relationship Knowledge Graph.
 * Shows trending entities, relationship networks, and entity search — directly
 * countering GDELT 5.0's Gemini-powered knowledge graphs.
 *
 * Endpoints consumed:
 *   GET /api/v1/knowledge-graph/entities
 *   GET /api/v1/knowledge-graph/entities/:id
 *   GET /api/v1/knowledge-graph/entities/:id/graph
 *   GET /api/v1/knowledge-graph/trending
 *   GET /api/v1/knowledge-graph/stats
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'

const ForceGraph = dynamic(
  () => import('../../components/knowledge-graph/ForceGraph'),
  { ssr: false, loading: () => <div className="h-[500px] rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center text-gray-500 text-sm">Loading graph visualization...</div> },
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
  entity: EntityNode
  spike_ratio: number
  recent_mentions: number
  daily_avg: number
}

interface GraphStats {
  entities: {
    total: number
    total_mentions: number
    last_updated: string
    by_type: Record<string, number>
  }
  edges: {
    total: number
    avg_weight: string
    by_predicate: Record<string, number>
  }
  generated_at: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

const ENTITY_TYPE_ICONS: Record<string, string> = {
  person: '\u{1F464}',
  organisation: '\u{1F3DB}',
  location: '\u{1F4CD}',
  event: '\u{26A1}',
  weapon_system: '\u{1F6E1}',
  legislation: '\u{1F4DC}',
  commodity: '\u{1F4E6}',
  technology: '\u{1F4BB}',
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  organisation: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  location: 'bg-green-500/20 text-green-400 border-green-500/30',
  event: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  weapon_system: 'bg-red-500/20 text-red-400 border-red-500/30',
  legislation: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  commodity: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  technology: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
}

const PREDICATE_LABELS: Record<string, string> = {
  leads: 'leads',
  member_of: 'member of',
  located_in: 'located in',
  sanctions: 'sanctions',
  allied_with: 'allied with',
  opposes: 'opposes',
  caused_by: 'caused by',
  resulted_in: 'resulted in',
  supplies: 'supplies',
  funds: 'funds',
  attacks: 'attacks',
  defends: 'defends',
  negotiates_with: 'negotiates with',
  signed: 'signed',
  deployed_to: 'deployed to',
  manufactures: 'manufactures',
  regulates: 'regulates',
  employs: 'employs',
  successor_of: 'successor of',
  predecessor_of: 'predecessor of',
}

// ─── API Helpers ───────────────────────────────────────────────────────────────

async function fetchJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function KnowledgeGraphPage() {
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [trending, setTrending] = useState<TrendingEntity[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<string>('')
  const [searchResults, setSearchResults] = useState<EntityNode[]>([])
  const [selectedEntity, setSelectedEntity] = useState<EntityNode | null>(null)
  const [entityEdges, setEntityEdges] = useState<EntityEdge[]>([])
  const [entityNeighbors, setEntityNeighbors] = useState<EntityNode[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch initial data
  useEffect(() => {
    Promise.all([
      fetchJSON<GraphStats>('/api/v1/knowledge-graph/stats'),
      fetchJSON<{ trending: TrendingEntity[] }>('/api/v1/knowledge-graph/trending?limit=15'),
    ]).then(([s, t]) => {
      setStats(s)
      setTrending(t?.trending ?? [])
      setLoading(false)
    })
  }, [])

  // Search entities
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    const typeParam = searchType ? `&type=${searchType}` : ''
    const data = await fetchJSON<{ data: EntityNode[] }>(
      `/api/v1/knowledge-graph/entities?search=${encodeURIComponent(searchQuery)}${typeParam}&limit=30`,
    )
    setSearchResults(data?.data ?? [])
  }, [searchQuery, searchType])

  // Select entity and load its graph
  const selectEntity = useCallback(async (entity: EntityNode) => {
    setSelectedEntity(entity)
    const graph = await fetchJSON<{
      nodes: EntityNode[]
      edges: EntityEdge[]
    }>(`/api/v1/knowledge-graph/entities/${entity.id}/graph?depth=1&limit=30`)
    setEntityNeighbors(graph?.nodes?.filter(n => n.id !== entity.id) ?? [])
    setEntityEdges(graph?.edges ?? [])
  }, [])

  // Format relative time
  const relTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const h = Math.floor(diff / 3600000)
    if (h < 1) return 'just now'
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Hero */}
      <section className="border-b border-gray-800 bg-gradient-to-r from-gray-900 via-indigo-950/30 to-gray-900 px-6 py-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">{'\u{1F578}'}</span>
            <h1 className="text-3xl font-bold tracking-tight">Knowledge Graph</h1>
            <span className="rounded-full bg-indigo-500/20 px-3 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/30">
              NEW
            </span>
          </div>
          <p className="text-gray-400 mt-2 max-w-2xl">
            AI-extracted entities and relationships across all WorldPulse signals.
            Explore who connects to whom, track trending entities, and discover hidden
            patterns in global intelligence — powered by real-time knowledge graph analysis.
          </p>
          <a
            href="/knowledge-graph/explorer"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Open Full Graph Explorer
            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-white/20 rounded">NEW</span>
          </a>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Entities" value={stats.entities.total.toLocaleString()} />
            <StatCard label="Total Mentions" value={stats.entities.total_mentions.toLocaleString()} />
            <StatCard label="Relationships" value={stats.edges.total.toLocaleString()} />
            <StatCard label="Avg Edge Weight" value={stats.edges.avg_weight} />
          </div>
        )}

        {/* Entity Type Breakdown */}
        {stats && Object.keys(stats.entities.by_type).length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4">Entity Distribution</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(stats.entities.by_type)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <div
                    key={type}
                    className={`rounded-lg border p-3 ${ENTITY_TYPE_COLORS[type] ?? 'bg-gray-800 text-gray-300 border-gray-700'}`}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{ENTITY_TYPE_ICONS[type] ?? '\u{2753}'}</span>
                      <span className="capitalize">{type.replace('_', ' ')}</span>
                    </div>
                    <div className="text-2xl font-bold mt-1">{count.toLocaleString()}</div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <h2 className="text-lg font-semibold mb-4">Search Entities</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search by name (e.g. NATO, Putin, HIMARS)..."
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <select
              value={searchType}
              onChange={e => setSearchType(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-gray-300"
            >
              <option value="">All types</option>
              {Object.keys(ENTITY_TYPE_ICONS).map(t => (
                <option key={t} value={t}>
                  {ENTITY_TYPE_ICONS[t]} {t.replace('_', ' ')}
                </option>
              ))}
            </select>
            <button
              onClick={handleSearch}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition"
            >
              Search
            </button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-4 grid gap-2">
              {searchResults.map(entity => (
                <button
                  key={entity.id}
                  onClick={() => selectEntity(entity)}
                  className={`text-left rounded-lg border border-gray-700 p-3 hover:border-indigo-500/50 hover:bg-gray-800/80 transition ${
                    selectedEntity?.id === entity.id ? 'border-indigo-500 bg-gray-800' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{ENTITY_TYPE_ICONS[entity.type] ?? '\u{2753}'}</span>
                      <span className="font-medium">{entity.canonical_name}</span>
                      <span className={`rounded px-2 py-0.5 text-xs border ${ENTITY_TYPE_COLORS[entity.type] ?? ''}`}>
                        {entity.type.replace('_', ' ')}
                      </span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {entity.mention_count} mentions · {relTime(entity.last_seen)}
                    </span>
                  </div>
                  {entity.aliases.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      Also known as: {entity.aliases.slice(0, 5).join(', ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Entity Detail */}
        {selectedEntity && (
          <div className="rounded-xl border border-indigo-500/30 bg-gray-900/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">{ENTITY_TYPE_ICONS[selectedEntity.type]}</span>
              <div>
                <h2 className="text-xl font-bold">{selectedEntity.canonical_name}</h2>
                <p className="text-sm text-gray-400">
                  {selectedEntity.type.replace('_', ' ')} · {selectedEntity.mention_count} mentions ·
                  First seen {relTime(selectedEntity.first_seen)} · Last seen {relTime(selectedEntity.last_seen)}
                </p>
              </div>
            </div>

            {/* Relationship Edges */}
            {entityEdges.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                  Relationships ({entityEdges.length})
                </h3>
                <div className="grid gap-2">
                  {entityEdges.map(edge => {
                    const isSource = edge.source_entity_id === selectedEntity.id
                    const otherName = isSource ? edge.target_name : edge.source_name
                    const direction = isSource ? '\u{2192}' : '\u{2190}'
                    return (
                      <div
                        key={edge.id}
                        className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-2 text-sm"
                      >
                        <span className="font-medium text-indigo-400">
                          {selectedEntity.canonical_name}
                        </span>
                        <span className="text-gray-500">{direction}</span>
                        <span className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                          {PREDICATE_LABELS[edge.predicate] ?? edge.predicate}
                        </span>
                        <span className="text-gray-500">{direction}</span>
                        <span className="font-medium">{otherName ?? 'Unknown'}</span>
                        <span className="ml-auto text-xs text-gray-600">
                          weight: {edge.weight.toFixed(2)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Neighbors */}
            {entityNeighbors.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                  Connected Entities ({entityNeighbors.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {entityNeighbors.map(n => (
                    <button
                      key={n.id}
                      onClick={() => selectEntity(n)}
                      className={`rounded-lg border px-3 py-1.5 text-sm hover:border-indigo-500/50 transition ${
                        ENTITY_TYPE_COLORS[n.type] ?? 'border-gray-700 text-gray-300'
                      }`}
                    >
                      {ENTITY_TYPE_ICONS[n.type]} {n.canonical_name}
                      <span className="ml-1 text-xs opacity-60">({n.mention_count})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Interactive Force Graph Visualization */}
        {selectedEntity && (entityNeighbors.length > 0 || entityEdges.length > 0) && (
          <div className="rounded-xl border border-indigo-500/20 bg-gray-900/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {'\u{1F578}'} Relationship Graph
                <span className="text-sm text-gray-500 font-normal ml-2">
                  {entityNeighbors.length + 1} nodes · {entityEdges.length} edges
                </span>
              </h2>
              <span className="rounded-full bg-indigo-500/20 px-3 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/30">
                INTERACTIVE
              </span>
            </div>
            <ForceGraph
              nodes={[
                {
                  id: selectedEntity.id,
                  type: selectedEntity.type,
                  canonical_name: selectedEntity.canonical_name,
                  mention_count: selectedEntity.mention_count,
                },
                ...entityNeighbors.map(n => ({
                  id: n.id,
                  type: n.type,
                  canonical_name: n.canonical_name,
                  mention_count: n.mention_count,
                })),
              ]}
              edges={entityEdges.map(e => ({
                id: e.id,
                source: e.source_entity_id,
                target: e.target_entity_id,
                predicate: e.predicate,
                weight: e.weight,
              }))}
              selectedNodeId={selectedEntity.id}
              onNodeClick={(node) => {
                const fullEntity = entityNeighbors.find(n => n.id === node.id)
                if (fullEntity) selectEntity(fullEntity)
              }}
              height={500}
              className="rounded-xl overflow-hidden"
            />
          </div>
        )}

        {/* Trending Entities */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <h2 className="text-lg font-semibold mb-4">
            {'\u{1F525}'} Trending Entities <span className="text-sm text-gray-500 font-normal">(24h)</span>
          </h2>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading trending entities...</p>
          ) : trending.length === 0 ? (
            <p className="text-gray-500 text-sm">No trending entities detected yet. The knowledge graph builds as signals are processed.</p>
          ) : (
            <div className="grid gap-2">
              {trending.map((item, idx) => (
                <button
                  key={item.entity.id}
                  onClick={() => selectEntity(item.entity)}
                  className="text-left flex items-center gap-3 rounded-lg border border-gray-700 p-3 hover:border-indigo-500/50 hover:bg-gray-800/80 transition"
                >
                  <span className="text-lg font-bold text-gray-600 w-8 text-right">
                    {idx + 1}
                  </span>
                  <span>{ENTITY_TYPE_ICONS[item.entity.type]}</span>
                  <div className="flex-1">
                    <span className="font-medium">{item.entity.canonical_name}</span>
                    <span className={`ml-2 rounded px-2 py-0.5 text-xs border ${ENTITY_TYPE_COLORS[item.entity.type] ?? ''}`}>
                      {item.entity.type.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-gray-300">{item.entity.mention_count} mentions</div>
                    {item.spike_ratio > 1.5 && (
                      <div className="text-red-400 text-xs font-semibold">
                        {'\u{2191}'} {item.spike_ratio.toFixed(1)}x spike
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Predicate Breakdown */}
        {stats && Object.keys(stats.edges.by_predicate).length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4">Relationship Types</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(stats.edges.by_predicate)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 12)
                .map(([pred, count]) => (
                  <div key={pred} className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
                    <div className="text-sm text-gray-400">{PREDICATE_LABELS[pred] ?? pred}</div>
                    <div className="text-xl font-bold text-gray-200">{count.toLocaleString()}</div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Data Sources */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-6">
          <h3 className="text-sm font-semibold text-gray-500 mb-2">Data Sources & Methodology</h3>
          <p className="text-xs text-gray-600 leading-relaxed">
            Entities and relationships are extracted from WorldPulse signals using AI-powered
            Named Entity Recognition (NER) and relationship inference. The knowledge graph
            updates in real-time as new signals are processed. Entity resolution uses canonical
            name matching with alias tracking. Trending detection uses spike-over-baseline
            analysis with a 24-hour window. Sources: WorldPulse Signal Pipeline, Gemini Flash /
            GPT-4o-mini for LLM extraction, rule-based NER fallback for offline operation.
          </p>
        </div>

        {/* Pro CTA */}
        <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 to-purple-950/40 p-6 text-center">
          <h3 className="text-lg font-semibold text-indigo-300 mb-2">
            WorldPulse Pro — Full Graph API Access
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Get programmatic access to entity search, graph traversal, and trending alerts
            via the Knowledge Graph API. Build custom intelligence dashboards and automated
            monitoring workflows.
          </p>
          <a
            href="/pricing"
            className="inline-block rounded-lg bg-indigo-600 px-8 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    </main>
  )
}

// ─── Stat Card Component ───────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-100 mt-1">{value}</div>
    </div>
  )
}
