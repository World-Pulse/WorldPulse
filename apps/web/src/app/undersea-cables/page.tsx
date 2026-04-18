'use client'

import { useState, useEffect, useCallback } from 'react'
import { Waves } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface LandingPoint {
  name: string
  country: string
  country_code: string
  lat: number
  lng: number
}

interface SubmarineCable {
  id: string
  name: string
  slug: string
  owners: string[]
  operators: string[]
  landing_points: LandingPoint[]
  rfs_year: number | null
  length_km: number | null
  capacity_tbps: number | null
  status: 'active' | 'under_construction' | 'planned' | 'decommissioned'
  technology: string | null
  notes: string | null
  related_signals: number
}

interface CableSummary {
  total_cables: number
  active: number
  under_construction: number
  planned: number
  decommissioned: number
  total_length_km: number
  total_capacity_tbps: number
  countries_connected: number
  landing_points_count: number
  top_owners: { name: string; count: number }[]
  top_countries: { country: string; country_code: string; count: number }[]
  recent_signals: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  under_construction: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  planned: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  decommissioned: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  under_construction: 'Under Construction',
  planned: 'Planned',
  decommissioned: 'Decommissioned',
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

const FLAG_MAP: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', FR: '🇫🇷', ES: '🇪🇸', DE: '🇩🇪', IT: '🇮🇹', PT: '🇵🇹',
  IE: '🇮🇪', NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮', SE: '🇸🇪', NL: '🇳🇱', MC: '🇲🇨',
  BR: '🇧🇷', AR: '🇦🇷', UY: '🇺🇾', CL: '🇨🇱', CO: '🇨🇴', PA: '🇵🇦', JM: '🇯🇲',
  JP: '🇯🇵', SG: '🇸🇬', ID: '🇮🇩', PH: '🇵🇭', KR: '🇰🇷', TW: '🇹🇼', CN: '🇨🇳', HK: '🇭🇰',
  IN: '🇮🇳', PK: '🇵🇰', BD: '🇧🇩', TH: '🇹🇭',
  AU: '🇦🇺', NZ: '🇳🇿', PG: '🇵🇬', SB: '🇸🇧', FM: '🇫🇲', NR: '🇳🇷', KI: '🇰🇮',
  ZA: '🇿🇦', NG: '🇳🇬', KE: '🇰🇪', AO: '🇦🇴', TG: '🇹🇬', DJ: '🇩🇯', EG: '🇪🇬', DZ: '🇩🇿', TN: '🇹🇳',
  SA: '🇸🇦', AE: '🇦🇪', OM: '🇴🇲', JO: '🇯🇴', QA: '🇶🇦',
  RU: '🇷🇺', EE: '🇪🇪', CA: '🇨🇦', MX: '🇲🇽',
}
function getFlag(code: string): string { return FLAG_MAP[code] ?? '--' }

// ─── Component ──────────────────────────────────────────────────────────────

export default function UnderseaCablesPage() {
  const [cables, setCables] = useState<SubmarineCable[]>([])
  const [summary, setSummary] = useState<CableSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [ownerFilter, setOwnerFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'name' | 'capacity' | 'length'>('capacity')
  const [expandedCable, setExpandedCable] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (statusFilter) params.set('status', statusFilter)
      if (ownerFilter) params.set('owner', ownerFilter)
      params.set('limit', '100')

      const [cablesRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/undersea-cables/cables?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/undersea-cables/summary`).then(r => r.json()),
      ])

      let sorted = cablesRes.data || []
      if (sortBy === 'capacity') {
        sorted = [...sorted].sort((a: SubmarineCable, b: SubmarineCable) => (b.capacity_tbps ?? 0) - (a.capacity_tbps ?? 0))
      } else if (sortBy === 'length') {
        sorted = [...sorted].sort((a: SubmarineCable, b: SubmarineCable) => (b.length_km ?? 0) - (a.length_km ?? 0))
      } else {
        sorted = [...sorted].sort((a: SubmarineCable, b: SubmarineCable) => a.name.localeCompare(b.name))
      }

      setCables(sorted)
      setSummary(summaryRes.data || null)
    } catch {
      // API not available — will show empty state
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, ownerFilter, sortBy])

  useEffect(() => { fetchData() }, [fetchData])

  // Unique owners for filter dropdown
  const allOwners = Array.from(new Set(cables.flatMap(c => c.owners))).sort()

  return (
    <div className="min-h-screen bg-[#06070d] text-white">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-zinc-800">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-transparent to-blue-900/20" />
        <div className="relative max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-2">
            <Waves className="w-8 h-8 text-cyan-400" />
            <h1 className="text-3xl font-bold tracking-tight">Undersea Cable Intelligence</h1>
          </div>
          <p className="text-zinc-400 text-lg max-w-2xl">
            Global submarine fiber-optic cable infrastructure — {summary?.total_cables ?? '...'} cables
            connecting {summary?.countries_connected ?? '...'} countries with{' '}
            {summary ? formatNumber(summary.total_capacity_tbps) : '...'} Tbps total capacity.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Total Cables', value: summary.total_cables, color: 'text-white' },
              { label: 'Active', value: summary.active, color: 'text-emerald-400' },
              { label: 'Under Construction', value: summary.under_construction, color: 'text-amber-400' },
              { label: 'Planned', value: summary.planned, color: 'text-blue-400' },
              { label: 'Total Length', value: `${formatNumber(summary.total_length_km)} km`, color: 'text-cyan-400' },
              { label: 'Total Capacity', value: `${formatNumber(summary.total_capacity_tbps)} Tbps`, color: 'text-purple-400' },
            ].map(card => (
              <div key={card.label} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
                <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                <div className="text-xs text-zinc-500 mt-1">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Top Owners Bar Chart */}
        {summary && summary.top_owners.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-zinc-400 mb-4">Top Cable Owners</h2>
              <div className="space-y-3">
                {summary.top_owners.slice(0, 8).map((owner, i) => {
                  const maxCount = summary.top_owners[0]?.count ?? 1
                  const pct = (owner.count / maxCount) * 100
                  return (
                    <div key={owner.name} className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500 w-4">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-zinc-300 truncate">{owner.name}</span>
                          <span className="text-cyan-400 font-mono">{owner.count}</span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-zinc-400 mb-4">Top Connected Countries</h2>
              <div className="space-y-3">
                {summary.top_countries.slice(0, 8).map((c, i) => {
                  const maxCount = summary.top_countries[0]?.count ?? 1
                  const pct = (c.count / maxCount) * 100
                  return (
                    <div key={c.country_code} className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500 w-4">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-zinc-300 truncate">
                            {getFlag(c.country_code)} {c.country}
                          </span>
                          <span className="text-blue-400 font-mono">{c.count} cables</span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search cables, owners, routes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="under_construction">Under Construction</option>
            <option value="planned">Planned</option>
            <option value="decommissioned">Decommissioned</option>
          </select>
          <select
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">All Owners</option>
            {allOwners.slice(0, 20).map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as 'name' | 'capacity' | 'length')}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="capacity">Sort: Capacity</option>
            <option value="length">Sort: Length</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>

        {/* Cable Cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-5 animate-pulse">
                <div className="h-5 bg-zinc-800 rounded w-3/4 mb-3" />
                <div className="h-3 bg-zinc-800 rounded w-1/2 mb-2" />
                <div className="h-3 bg-zinc-800 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : cables.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <p className="text-lg">No cables match your filters.</p>
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); setOwnerFilter('') }}
              className="mt-3 text-cyan-400 hover:text-cyan-300 text-sm"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {cables.map(cable => {
              const isExpanded = expandedCable === cable.id
              return (
                <div
                  key={cable.id}
                  className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors cursor-pointer"
                  onClick={() => setExpandedCable(isExpanded ? null : cable.id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-base font-semibold text-white">{cable.name}</h3>
                    <span className={`px-2 py-0.5 text-xs rounded-full border ${STATUS_COLORS[cable.status] ?? ''}`}>
                      {STATUS_LABELS[cable.status] ?? cable.status}
                    </span>
                  </div>

                  <div className="text-xs text-zinc-400 mb-2">
                    {cable.owners.slice(0, 3).join(', ')}
                    {cable.owners.length > 3 ? ` +${cable.owners.length - 3} more` : ''}
                  </div>

                  <div className="flex flex-wrap gap-1 mb-3">
                    {cable.landing_points.slice(0, 5).map(lp => (
                      <span key={`${cable.id}-${lp.name}`} className="text-xs bg-zinc-800 text-zinc-400 rounded px-1.5 py-0.5">
                        {getFlag(lp.country_code)} {lp.name}
                      </span>
                    ))}
                    {cable.landing_points.length > 5 && (
                      <span className="text-xs text-zinc-500">+{cable.landing_points.length - 5} more</span>
                    )}
                  </div>

                  <div className="flex gap-4 text-xs text-zinc-500">
                    {cable.capacity_tbps != null && (
                      <span className="text-cyan-400">{cable.capacity_tbps} Tbps</span>
                    )}
                    {cable.length_km != null && (
                      <span>{formatNumber(cable.length_km)} km</span>
                    )}
                    {cable.rfs_year != null && (
                      <span>RFS {cable.rfs_year}</span>
                    )}
                    {cable.related_signals > 0 && (
                      <span className="text-amber-400">{cable.related_signals} signals</span>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3 text-sm">
                      {cable.technology && (
                        <div>
                          <span className="text-zinc-500">Technology:</span>{' '}
                          <span className="text-zinc-300">{cable.technology}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-zinc-500">Landing Points ({cable.landing_points.length}):</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {cable.landing_points.map(lp => (
                            <span key={`${cable.id}-detail-${lp.name}`} className="text-xs bg-zinc-800/80 text-zinc-300 rounded px-2 py-1">
                              {getFlag(lp.country_code)} {lp.name}, {lp.country}
                            </span>
                          ))}
                        </div>
                      </div>
                      {cable.notes && (
                        <div className="text-xs text-zinc-400 italic">{cable.notes}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Attribution */}
        <div className="text-center text-xs text-zinc-600 pt-4 pb-8">
          Submarine cable data compiled from TeleGeography, ISCPC, and public filings.
          Updated by WorldPulse intelligence team.
        </div>
      </div>
    </div>
  )
}
