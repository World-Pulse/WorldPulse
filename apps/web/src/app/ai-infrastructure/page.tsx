'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

// Inline SVG icons (avoid lucide-react dependency)
const Server = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
)
const Zap = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>
)
const Globe = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
)
const Search = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
)
const DollarSign = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
)
const Cpu = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
)

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.world-pulse.io'

// ─── Types ────────────────────────────────────────────────────────────────────

type DCStatus = 'operational' | 'under_construction' | 'announced' | 'planned'

interface AIDatacenter {
  id:              string
  name:            string
  operator:        string
  country:         string
  country_code:    string
  region:          string
  city:            string
  lat:             number
  lng:             number
  capacity_mw:     number | null
  status:          DCStatus
  ai_focus:        string[]
  gpu_type:        string | null
  gpu_count:       number | null
  energy_source:   string | null
  opened_year:     number | null
  estimated_completion: string | null
  investment_usd:  number | null
  notes:           string | null
  related_signals: number
}

interface Summary {
  total_datacenters:    number
  operational:          number
  under_construction:   number
  announced:            number
  planned:              number
  total_capacity_mw:    number
  countries_count:      number
  top_operators:        { operator: string; count: number }[]
  top_countries:        { country: string; country_code: string; count: number }[]
  total_investment_usd: number
  related_signals_24h:  number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<DCStatus, { label: string; className: string; dot: string }> = {
  operational:        { label: 'OPERATIONAL',        className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40', dot: 'bg-emerald-400' },
  under_construction: { label: 'UNDER CONSTRUCTION', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',     dot: 'bg-amber-400' },
  announced:          { label: 'ANNOUNCED',          className: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',         dot: 'bg-blue-400' },
  planned:            { label: 'PLANNED',            className: 'bg-gray-500/20 text-gray-400 border border-gray-500/40',         dot: 'bg-gray-400' },
}

function formatMW(mw: number | null): string {
  if (mw === null) return 'N/A'
  return mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${mw} MW`
}

function formatUSD(usd: number | null): string {
  if (usd === null) return 'N/A'
  if (usd >= 1_000_000_000_000) return `$${(usd / 1_000_000_000_000).toFixed(1)}T`
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(0)}M`
  return `$${usd.toLocaleString()}`
}

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('')
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function AIInfrastructurePage() {
  const [datacenters, setDatacenters] = useState<AIDatacenter[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<DCStatus | 'all'>('all')
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'capacity' | 'investment' | 'name'>('capacity')

  // Detail panel
  const [selectedDC, setSelectedDC] = useState<AIDatacenter | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dcRes, sumRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/ai-infrastructure/datacenters?limit=200`),
        fetch(`${API_URL}/api/v1/ai-infrastructure/summary`),
      ])

      if (!dcRes.ok || !sumRes.ok) throw new Error('API error')

      const dcData = await dcRes.json()
      const sumData = await sumRes.json()

      setDatacenters(dcData.data ?? [])
      setSummary(sumData.data ?? null)
    } catch {
      setError('Failed to load AI infrastructure data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Filtering & Sorting ─────────────────────────────────
  const filtered = datacenters
    .filter(dc => {
      if (statusFilter !== 'all' && dc.status !== statusFilter) return false
      if (regionFilter !== 'all' && dc.region !== regionFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          dc.name.toLowerCase().includes(q) ||
          dc.operator.toLowerCase().includes(q) ||
          dc.city.toLowerCase().includes(q) ||
          dc.country.toLowerCase().includes(q) ||
          (dc.gpu_type ?? '').toLowerCase().includes(q) ||
          dc.ai_focus.some(f => f.toLowerCase().includes(q))
        )
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'capacity') return (b.capacity_mw ?? 0) - (a.capacity_mw ?? 0)
      if (sortBy === 'investment') return (b.investment_usd ?? 0) - (a.investment_usd ?? 0)
      return a.name.localeCompare(b.name)
    })

  const regions = [...new Set(datacenters.map(d => d.region))].sort()

  // ─── Render ──────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#06070d] text-white">
      {/* Hero */}
      <div className="border-b border-white/10 bg-gradient-to-b from-violet-950/30 to-transparent">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-2">
            <Cpu className="h-8 w-8 text-violet-400" />
            <h1 className="text-3xl font-bold tracking-tight">AI Infrastructure Tracker</h1>
          </div>
          <p className="text-gray-400 max-w-2xl">
            Global intelligence on AI datacenter construction, GPU deployments, and compute capacity.
            Tracking {summary?.total_datacenters ?? '...'} facilities across {summary?.countries_count ?? '...'} countries.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            <StatCard icon={<Server className="h-5 w-5 text-violet-400" />} label="Total Facilities" value={summary.total_datacenters.toString()} />
            <StatCard icon={<div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />} label="Operational" value={summary.operational.toString()} />
            <StatCard icon={<div className="h-2.5 w-2.5 rounded-full bg-amber-400" />} label="Under Construction" value={summary.under_construction.toString()} />
            <StatCard icon={<Zap className="h-5 w-5 text-yellow-400" />} label="Total Capacity" value={formatMW(summary.total_capacity_mw)} />
            <StatCard icon={<DollarSign className="h-5 w-5 text-green-400" />} label="Total Investment" value={formatUSD(summary.total_investment_usd)} />
            <StatCard icon={<Globe className="h-5 w-5 text-cyan-400" />} label="Countries" value={summary.countries_count.toString()} />
          </div>
        )}

        {/* Top Operators & Countries */}
        {summary && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            {/* Top Operators */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Top Operators</h3>
              <div className="space-y-2">
                {summary.top_operators.slice(0, 8).map(op => (
                  <div key={op.operator} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">{op.operator}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded-full bg-violet-500/30" style={{ width: `${Math.max(20, (op.count / (summary.top_operators[0]?.count ?? 1)) * 120)}px` }}>
                        <div className="h-full rounded-full bg-violet-500" style={{ width: '100%' }} />
                      </div>
                      <span className="text-xs text-gray-500 w-6 text-right">{op.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Countries */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Top Countries</h3>
              <div className="space-y-2">
                {summary.top_countries.slice(0, 8).map(c => (
                  <div key={c.country_code} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">{countryFlag(c.country_code)} {c.country}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded-full bg-cyan-500/30" style={{ width: `${Math.max(20, (c.count / (summary.top_countries[0]?.count ?? 1)) * 120)}px` }}>
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: '100%' }} />
                      </div>
                      <span className="text-xs text-gray-500 w-6 text-right">{c.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search datacenters, operators, GPUs..."
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as DCStatus | 'all')}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="operational">Operational</option>
            <option value="under_construction">Under Construction</option>
            <option value="announced">Announced</option>
            <option value="planned">Planned</option>
          </select>

          {/* Region filter */}
          <select
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none"
          >
            <option value="all">All Regions</option>
            {regions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as 'capacity' | 'investment' | 'name')}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none"
          >
            <option value="capacity">Sort: Capacity</option>
            <option value="investment">Sort: Investment</option>
            <option value="name">Sort: Name</option>
          </select>

          <span className="text-xs text-gray-500">{filtered.length} facilities</span>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 rounded-xl border border-white/10 bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
            <p className="text-red-400">{error}</p>
            <button onClick={fetchData} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-300 hover:bg-red-500/30">
              Retry
            </button>
          </div>
        )}

        {/* Datacenter Grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(dc => (
              <button
                key={dc.id}
                onClick={() => setSelectedDC(selectedDC?.id === dc.id ? null : dc)}
                className={`text-left rounded-xl border p-4 transition-all hover:border-violet-500/40 hover:bg-white/[0.04] ${
                  selectedDC?.id === dc.id
                    ? 'border-violet-500/60 bg-violet-500/[0.06]'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{dc.name}</h3>
                    <p className="text-xs text-gray-400">{dc.operator}</p>
                  </div>
                  <span className={`shrink-0 ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[dc.status].className}`}>
                    {STATUS_BADGE[dc.status].label}
                  </span>
                </div>

                {/* Location */}
                <p className="text-xs text-gray-500 mb-3">
                  {countryFlag(dc.country_code)} {dc.city}, {dc.country}
                </p>

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase">Capacity</p>
                    <p className="text-sm font-semibold text-yellow-400">{formatMW(dc.capacity_mw)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase">Investment</p>
                    <p className="text-sm font-semibold text-green-400">{formatUSD(dc.investment_usd)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase">GPU</p>
                    <p className="text-xs font-medium text-violet-300 truncate">{dc.gpu_type ?? 'N/A'}</p>
                  </div>
                </div>

                {/* AI Focus Tags */}
                <div className="flex flex-wrap gap-1">
                  {dc.ai_focus.slice(0, 3).map(focus => (
                    <span key={focus} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300 border border-violet-500/20">
                      {focus}
                    </span>
                  ))}
                  {dc.ai_focus.length > 3 && (
                    <span className="text-[10px] text-gray-500">+{dc.ai_focus.length - 3}</span>
                  )}
                </div>

                {/* Expanded Detail */}
                {selectedDC?.id === dc.id && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                    {dc.energy_source && (
                      <DetailRow label="Energy" value={dc.energy_source} />
                    )}
                    {dc.gpu_count && (
                      <DetailRow label="GPU Count" value={dc.gpu_count.toLocaleString()} />
                    )}
                    {dc.opened_year && (
                      <DetailRow label="Opened" value={dc.opened_year.toString()} />
                    )}
                    {dc.estimated_completion && (
                      <DetailRow label="Est. Completion" value={dc.estimated_completion} />
                    )}
                    {dc.related_signals > 0 && (
                      <DetailRow label="Related Signals (30d)" value={dc.related_signals.toString()} />
                    )}
                    {dc.notes && (
                      <p className="text-xs text-gray-400 italic">{dc.notes}</p>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      {dc.lat.toFixed(4)}, {dc.lng.toFixed(4)}
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-12 text-center">
            <Server className="mx-auto h-12 w-12 text-gray-600 mb-3" />
            <p className="text-gray-400">No datacenters match your filters.</p>
            <button
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); setRegionFilter('all') }}
              className="mt-3 text-sm text-violet-400 hover:text-violet-300"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center">
          <p className="text-xs text-gray-500">
            Data compiled from public disclosures, satellite imagery, and regulatory filings.
            Updated periodically. For corrections, contact{' '}
            <a href="mailto:intel@worldpulse.io" className="text-violet-400 hover:text-violet-300">intel@worldpulse.io</a>.
          </p>
          <div className="flex justify-center gap-4 mt-2">
            <Link href="/map" className="text-xs text-violet-400 hover:text-violet-300">View on Map</Link>
            <Link href="/cyber" className="text-xs text-violet-400 hover:text-violet-300">Cyber Threats</Link>
            <Link href="/countries/resilience" className="text-xs text-violet-400 hover:text-violet-300">Country Resilience</Link>
          </div>
        </div>
      </div>
    </main>
  )
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-medium">{value}</span>
    </div>
  )
}
