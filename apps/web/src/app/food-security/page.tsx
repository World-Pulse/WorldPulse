'use client'

import { useState, useEffect, useCallback } from 'react'
import { Wheat, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface FoodSecurityIndicators {
  hunger_index: number
  food_price_index: number
  ipc_phase: 1 | 2 | 3 | 4 | 5
  cropland_stress_pct: number
  population_food_insecure_m: number
}

interface FoodSecurityRegion {
  code: string
  name: string
  continent: string
  crisis_level: 'stable' | 'watch' | 'crisis' | 'emergency' | 'famine'
  indicators: FoodSecurityIndicators
  trend: 'improving' | 'declining' | 'stable'
  trend_detail: string
  top_threats: string[]
  population_m: number
  related_signals: number
}

interface FoodSecuritySummary {
  total_regions: number
  stable: number
  watch: number
  crisis: number
  emergency: number
  famine: number
  total_food_insecure_m: number
  avg_hunger_index: number
  avg_food_price_index: number
  most_affected: { code: string; name: string; crisis_level: string; hunger_index: number }[]
  most_improved: { code: string; name: string; trend: string; trend_detail: string }[]
  continent_breakdown: { continent: string; regions: number; avg_hunger_index: number; food_insecure_m: number }[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const CRISIS_COLORS: Record<string, string> = {
  stable: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  watch: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  crisis: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  emergency: 'bg-red-500/20 text-red-400 border-red-500/30',
  famine: 'bg-red-900/30 text-red-300 border-red-700/40',
}

const CRISIS_LABELS: Record<string, string> = {
  stable: 'Stable',
  watch: 'Watch',
  crisis: 'Crisis',
  emergency: 'Emergency',
  famine: 'Famine',
}

const IPC_LABELS: Record<number, string> = {
  1: 'Minimal',
  2: 'Stressed',
  3: 'Crisis',
  4: 'Emergency',
  5: 'Famine',
}

const IPC_COLORS: Record<number, string> = {
  1: 'bg-green-500',
  2: 'bg-yellow-500',
  3: 'bg-orange-500',
  4: 'bg-red-600',
  5: 'bg-red-900',
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'improving') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400 inline-block" />
  if (trend === 'declining') return <TrendingDown className="w-3.5 h-3.5 text-red-400 inline-block" />
  return <ArrowRight className="w-3.5 h-3.5 text-gray-400 inline-block" />
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function FoodSecurityPage() {
  const [regions, setRegions] = useState<FoodSecurityRegion[]>([])
  const [summary, setSummary] = useState<FoodSecuritySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterContinent, setFilterContinent] = useState('')
  const [filterCrisis, setFilterCrisis] = useState('')
  const [sortBy, setSortBy] = useState('hunger_index')
  const [expandedCode, setExpandedCode] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filterContinent) params.set('continent', filterContinent)
      if (filterCrisis) params.set('crisis_level', filterCrisis)
      if (sortBy) params.set('sort_by', sortBy)
      params.set('limit', '100')

      const [regionsRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/food-security/regions?${params}`),
        fetch(`${API_BASE}/api/v1/food-security/summary`),
      ])

      if (regionsRes.ok) {
        const rData = await regionsRes.json()
        setRegions(rData.data || [])
      }
      if (summaryRes.ok) {
        const sData = await summaryRes.json()
        setSummary(sData.data || null)
      }
    } catch {
      // API unavailable — use empty state
    } finally {
      setLoading(false)
    }
  }, [search, filterContinent, filterCrisis, sortBy])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const continents = ['Africa', 'Middle East', 'Asia', 'Americas', 'Europe', 'Oceania']

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-4 py-8 max-w-7xl mx-auto">
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-amber-400 flex items-center gap-3">
          <Wheat className="w-8 h-8" /> Food Security Intelligence
        </h1>
        <p className="text-gray-400 mt-2 max-w-2xl">
          Real-time monitoring of global food security — hunger indices, IPC classifications,
          food price inflation, and crisis alerts from FAO, FEWS NET, WFP, and IFPRI data.
        </p>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Countries Tracked</div>
            <div className="text-2xl font-bold text-gray-100 mt-1">{summary.total_regions}</div>
          </div>
          <div className="bg-gray-900 border border-red-900/30 rounded-lg p-4">
            <div className="text-xs text-red-400 uppercase tracking-wide">Famine</div>
            <div className="text-2xl font-bold text-red-400 mt-1">{summary.famine}</div>
          </div>
          <div className="bg-gray-900 border border-red-800/30 rounded-lg p-4">
            <div className="text-xs text-red-300 uppercase tracking-wide">Emergency</div>
            <div className="text-2xl font-bold text-red-300 mt-1">{summary.emergency}</div>
          </div>
          <div className="bg-gray-900 border border-orange-800/30 rounded-lg p-4">
            <div className="text-xs text-orange-400 uppercase tracking-wide">Crisis</div>
            <div className="text-2xl font-bold text-orange-400 mt-1">{summary.crisis}</div>
          </div>
          <div className="bg-gray-900 border border-yellow-800/30 rounded-lg p-4">
            <div className="text-xs text-yellow-400 uppercase tracking-wide">Watch</div>
            <div className="text-2xl font-bold text-yellow-400 mt-1">{summary.watch}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Food Insecure</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">{summary.total_food_insecure_m.toFixed(0)}M</div>
          </div>
        </div>
      )}

      {/* Global Indicators Row */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {/* Most Affected */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-red-400 mb-3">Most Affected Countries</h3>
            <div className="space-y-2">
              {summary.most_affected.map((r, i) => (
                <div key={r.code} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">
                    <span className="text-gray-500 mr-2">{i + 1}.</span>
                    {r.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded border ${CRISIS_COLORS[r.crisis_level] || 'text-gray-400'}`}>
                      {CRISIS_LABELS[r.crisis_level] || r.crisis_level}
                    </span>
                    <span className="text-amber-400 font-mono text-xs w-10 text-right">{r.hunger_index}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Regional Breakdown */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-amber-400 mb-3">Regional Breakdown</h3>
            <div className="space-y-2">
              {summary.continent_breakdown.map(c => (
                <div key={c.continent} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">{c.continent}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-gray-500">{c.regions} countries</span>
                    <span className="text-amber-400 font-mono w-12 text-right">GHI {c.avg_hunger_index}</span>
                    <span className="text-red-400 font-mono w-16 text-right">{c.food_insecure_m}M</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Most Improved */}
      {summary && summary.most_improved.length > 0 && (
        <div className="bg-gray-900 border border-emerald-900/30 rounded-lg p-4 mb-8">
          <h3 className="text-sm font-semibold text-emerald-400 mb-3">Countries Showing Improvement</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {summary.most_improved.map(r => (
              <div key={r.code} className="flex items-start gap-2 text-sm">
                <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <div>
                  <span className="text-gray-200 font-medium">{r.name}</span>
                  <p className="text-gray-500 text-xs mt-0.5">{r.trend_detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search countries, threats..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 w-64 focus:outline-none focus:border-amber-500"
        />
        <select
          value={filterContinent}
          onChange={(e) => setFilterContinent(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-500"
        >
          <option value="">All Regions</option>
          {continents.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterCrisis}
          onChange={(e) => setFilterCrisis(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-500"
        >
          <option value="">All Severity</option>
          <option value="famine">Famine</option>
          <option value="emergency">Emergency</option>
          <option value="crisis">Crisis</option>
          <option value="watch">Watch</option>
          <option value="stable">Stable</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-500"
        >
          <option value="hunger_index">Sort: Hunger Index</option>
          <option value="food_price_index">Sort: Food Prices</option>
          <option value="population_food_insecure">Sort: People Affected</option>
          <option value="ipc_phase">Sort: IPC Phase</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-gray-500">Loading food security data...</div>
      )}

      {/* Country Cards */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {regions.map(region => {
            const isExpanded = expandedCode === region.code
            return (
              <div
                key={region.code}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 cursor-pointer transition-colors"
                onClick={() => setExpandedCode(isExpanded ? null : region.code)}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-gray-100">{region.name}</span>
                    <span className="text-xs text-gray-500">{region.code}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border ${CRISIS_COLORS[region.crisis_level]}`}>
                    {CRISIS_LABELS[region.crisis_level]}
                  </span>
                </div>

                {/* IPC Phase Bar */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-gray-500">IPC Phase</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(phase => (
                      <div
                        key={phase}
                        className={`w-6 h-2 rounded-sm ${
                          phase <= region.indicators.ipc_phase
                            ? IPC_COLORS[phase]
                            : 'bg-gray-800'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-gray-400">
                    {IPC_LABELS[region.indicators.ipc_phase]}
                  </span>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div>
                    <span className="text-gray-500">Hunger Index</span>
                    <div className="text-amber-400 font-mono font-semibold">{region.indicators.hunger_index}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Food Price Index</span>
                    <div className="text-amber-400 font-mono font-semibold">{region.indicators.food_price_index}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Food Insecure</span>
                    <div className="text-red-400 font-mono font-semibold">{region.indicators.population_food_insecure_m}M</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Cropland Stress</span>
                    <div className="text-orange-400 font-mono font-semibold">{region.indicators.cropland_stress_pct}%</div>
                  </div>
                </div>

                {/* Trend */}
                <div className="flex items-center gap-2 text-xs">
                  <TrendIcon trend={region.trend} />
                  <span className="text-gray-400">{region.trend_detail}</span>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-4 pt-3 border-t border-gray-800">
                    <div className="text-xs text-gray-500 mb-2">Top Threats</div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {region.top_threats.map(threat => (
                        <span key={threat} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">
                          {threat}
                        </span>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Population</span>
                        <div className="text-gray-300 font-mono">{region.population_m}M</div>
                      </div>
                      <div>
                        <span className="text-gray-500">Related Signals</span>
                        <div className="text-gray-300 font-mono">{region.related_signals}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && regions.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No countries match your filters. Try adjusting the search criteria.
        </div>
      )}

      {/* Pro CTA */}
      <div className="bg-gradient-to-r from-amber-900/20 to-orange-900/20 border border-amber-800/30 rounded-lg p-6 text-center">
        <h3 className="text-lg font-semibold text-amber-400 mb-2">WorldPulse Pro — Food Security Alerts</h3>
        <p className="text-gray-400 text-sm mb-4">
          Get real-time IPC phase change alerts, commodity price notifications, and custom
          food security dashboards. Integrate with FAO and WFP data feeds via API.
        </p>
        <button className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          Upgrade to Pro
        </button>
      </div>

      {/* Data Sources */}
      <div className="mt-8 text-center text-xs text-gray-600">
        Data sources: FAO Food Price Index | FEWS NET | WFP Hunger Map | IPC Classification | Global Hunger Index (IFPRI)
      </div>
    </div>
  )
}
