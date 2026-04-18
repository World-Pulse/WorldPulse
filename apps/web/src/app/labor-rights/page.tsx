'use client'

import { useState, useEffect, useCallback } from 'react'
import { Hammer } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface LaborRightsIndicators {
  ituc_rating: 1 | 2 | 3 | 4 | 5
  union_density_pct: number
  min_wage_adequacy_pct: number
  workplace_fatality_rate: number
  forced_labor_prevalence: number
}

interface LaborRightsCountry {
  code: string
  name: string
  continent: string
  rights_level: 'strong' | 'moderate' | 'weak' | 'poor' | 'critical'
  indicators: LaborRightsIndicators
  trend: 'improving' | 'declining' | 'stable'
  trend_detail: string
  top_issues: string[]
  population_m: number
  workforce_m: number
  related_signals: number
}

interface LaborRightsSummary {
  total_countries: number
  strong: number
  moderate: number
  weak: number
  poor: number
  critical: number
  total_workforce_m: number
  avg_ituc_rating: number
  avg_union_density: number
  most_at_risk: { code: string; name: string; rights_level: string; ituc_rating: number }[]
  most_improved: { code: string; name: string; trend: string; trend_detail: string }[]
  continent_breakdown: { continent: string; countries: number; avg_ituc_rating: number; workforce_m: number }[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const RIGHTS_COLORS: Record<string, string> = {
  strong: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  moderate: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  weak: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  poor: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  critical: 'bg-red-900/30 text-red-300 border-red-700/40',
}

const RIGHTS_LABELS: Record<string, string> = {
  strong: 'Strong Rights',
  moderate: 'Moderate',
  weak: 'Weak',
  poor: 'Poor',
  critical: 'Critical',
}

const ITUC_LABELS: Record<number, string> = {
  1: 'Irregular Violations',
  2: 'Repeated Violations',
  3: 'Regular Violations',
  4: 'Systematic Violations',
  5: 'No Guarantee of Rights',
}

const TREND_ICONS: Record<string, string> = {
  improving: '↗',
  declining: '↘',
  stable: '→',
}

const TREND_COLORS: Record<string, string> = {
  improving: 'text-emerald-400',
  declining: 'text-red-400',
  stable: 'text-slate-400',
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LaborRightsPage() {
  const [countries, setCountries]   = useState<LaborRightsCountry[]>([])
  const [summary, setSummary]       = useState<LaborRightsSummary | null>(null)
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [continent, setContinent]   = useState('')
  const [rightsLevel, setRightsLevel] = useState('')
  const [sort, setSort]             = useState('ituc_rating')
  const [expanded, setExpanded]     = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (continent) params.set('continent', continent)
      if (rightsLevel) params.set('rights_level', rightsLevel)
      if (sort) params.set('sort', sort)
      params.set('limit', '100')

      const [countriesRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/labor-rights/countries?${params}`),
        fetch(`${API_BASE}/api/v1/labor-rights/summary`),
      ])

      if (countriesRes.ok) {
        const cData = await countriesRes.json()
        setCountries(cData.data || [])
      }
      if (summaryRes.ok) {
        const sData = await summaryRes.json()
        setSummary(sData.data || null)
      }
    } catch {
      /* API may be offline in dev */
    } finally {
      setLoading(false)
    }
  }, [search, continent, rightsLevel, sort])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleExpand = (code: string) => {
    setExpanded(prev => (prev === code ? null : code))
  }

  return (
    <div className="min-h-screen bg-[#06070d] text-white">
      {/* Hero */}
      <div className="border-b border-white/10 bg-gradient-to-r from-[#06070d] via-[#1a0f0f] to-[#06070d]">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="flex items-center gap-3 mb-2">
            <Hammer className="w-8 h-8 text-amber-400" />
            <h1 className="text-3xl font-bold tracking-tight">Labor Rights Intelligence</h1>
            <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/30">
              NEW
            </span>
          </div>
          <p className="text-slate-400 max-w-2xl">
            Monitoring worker protections, union freedoms, forced labor risk, and workplace safety
            across 45+ countries. Data sourced from ILO, ITUC Global Rights Index, Global Slavery
            Index, and labor rights organizations worldwide.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <SummaryCard label="Countries Tracked" value={summary.total_countries} color="text-white" />
            <SummaryCard label="Critical" value={summary.critical} color="text-red-400" />
            <SummaryCard label="Poor" value={summary.poor} color="text-orange-400" />
            <SummaryCard label="Weak" value={summary.weak} color="text-yellow-400" />
            <SummaryCard label="Moderate" value={summary.moderate} color="text-blue-400" />
            <SummaryCard label="Strong Rights" value={summary.strong} color="text-emerald-400" />
          </div>
        )}

        {/* Workforce & Key Stats */}
        {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Global Workforce Tracked</p>
              <p className="text-2xl font-bold text-cyan-400">{(summary.total_workforce_m / 1000).toFixed(1)}B</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Avg ITUC Rating</p>
              <p className="text-2xl font-bold text-amber-400">{summary.avg_ituc_rating.toFixed(1)} / 5</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Avg Union Density</p>
              <p className="text-2xl font-bold text-purple-400">{summary.avg_union_density.toFixed(1)}%</p>
            </div>
          </div>
        )}

        {/* Most At-Risk Countries */}
        {summary && summary.most_at_risk.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold mb-4">Most At-Risk Countries</h2>
            <div className="space-y-2">
              {summary.most_at_risk.map((c, i) => (
                <div key={c.code} className="flex items-center gap-3">
                  <span className="text-slate-500 w-6 text-right text-sm">{i + 1}.</span>
                  <span className="font-medium w-40">{c.name}</span>
                  <span className={`px-2 py-0.5 rounded text-xs border ${RIGHTS_COLORS[c.rights_level] ?? ''}`}>
                    {RIGHTS_LABELS[c.rights_level] ?? c.rights_level}
                  </span>
                  <span className="text-sm text-slate-400 ml-auto">
                    ITUC: {c.ituc_rating} — {ITUC_LABELS[c.ituc_rating] ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Regional Breakdown */}
        {summary && summary.continent_breakdown.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold mb-4">Regional Breakdown</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.continent_breakdown.map(cb => (
                <div key={cb.continent} className="rounded border border-white/10 bg-white/5 p-3">
                  <p className="font-medium text-sm">{cb.continent}</p>
                  <div className="flex justify-between mt-1 text-xs text-slate-400">
                    <span>{cb.countries} countries</span>
                    <span>Avg ITUC: {cb.avg_ituc_rating}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Workforce: {cb.workforce_m.toFixed(1)}M</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Countries Showing Improvement */}
        {summary && summary.most_improved.length > 0 && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-900/10 p-6">
            <h2 className="text-lg font-semibold mb-4 text-emerald-400">Countries Showing Improvement</h2>
            <div className="space-y-2">
              {summary.most_improved.map(c => (
                <div key={c.code} className="flex items-center gap-3 text-sm">
                  <span className="text-emerald-400">↗</span>
                  <span className="font-medium w-36">{c.name}</span>
                  <span className="text-slate-400">{c.trend_detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search country or issue..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
          />
          <select
            value={continent}
            onChange={e => setContinent(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">All Regions</option>
            <option value="Africa">Africa</option>
            <option value="Americas">Americas</option>
            <option value="Asia">Asia</option>
            <option value="Europe">Europe</option>
            <option value="Middle East">Middle East</option>
            <option value="Oceania">Oceania</option>
          </select>
          <select
            value={rightsLevel}
            onChange={e => setRightsLevel(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">All Levels</option>
            <option value="critical">Critical</option>
            <option value="poor">Poor</option>
            <option value="weak">Weak</option>
            <option value="moderate">Moderate</option>
            <option value="strong">Strong</option>
          </select>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="ituc_rating">ITUC Rating</option>
            <option value="union_density_pct">Union Density</option>
            <option value="workplace_fatality_rate">Fatality Rate</option>
            <option value="forced_labor_prevalence">Forced Labor</option>
            <option value="workforce_m">Workforce Size</option>
            <option value="name">Name</option>
          </select>
        </div>

        {/* Country Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-4 animate-pulse h-32" />
            ))}
          </div>
        ) : countries.length === 0 ? (
          <div className="text-center py-12 text-slate-500">No countries match your filters.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {countries.map(c => (
              <button
                key={c.code}
                onClick={() => toggleExpand(c.code)}
                className="rounded-lg border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{c.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs border ${RIGHTS_COLORS[c.rights_level] ?? ''}`}>
                    {RIGHTS_LABELS[c.rights_level] ?? c.rights_level}
                  </span>
                </div>

                {/* ITUC Rating Bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>ITUC Rating: {c.indicators.ituc_rating}/5</span>
                    <span>{ITUC_LABELS[c.indicators.ituc_rating] ?? ''}</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        c.indicators.ituc_rating <= 1 ? 'bg-emerald-500' :
                        c.indicators.ituc_rating <= 2 ? 'bg-blue-500' :
                        c.indicators.ituc_rating <= 3 ? 'bg-yellow-500' :
                        c.indicators.ituc_rating <= 4 ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${(c.indicators.ituc_rating / 5) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Trend */}
                <div className="flex items-center gap-1 text-sm mb-2">
                  <span className={TREND_COLORS[c.trend] ?? ''}>{TREND_ICONS[c.trend] ?? ''}</span>
                  <span className={`text-xs ${TREND_COLORS[c.trend] ?? ''}`}>{c.trend}</span>
                </div>

                {/* Expanded detail */}
                {expanded === c.code && (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500">Union Density</span>
                        <p className="text-purple-400 font-medium">{c.indicators.union_density_pct}%</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Min Wage Adequacy</span>
                        <p className="text-cyan-400 font-medium">{c.indicators.min_wage_adequacy_pct}%</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Fatality Rate</span>
                        <p className="text-red-400 font-medium">{c.indicators.workplace_fatality_rate}/100K</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Forced Labor</span>
                        <p className="text-orange-400 font-medium">{c.indicators.forced_labor_prevalence}/1K pop</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Population</span>
                        <p className="text-white font-medium">{c.population_m}M</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Workforce</span>
                        <p className="text-white font-medium">{c.workforce_m}M</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 italic">{c.trend_detail}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.top_issues.map(issue => (
                        <span key={issue} className="px-2 py-0.5 rounded-full bg-white/10 text-xs text-slate-300">
                          {issue}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Pro CTA */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-center">
          <p className="text-amber-400 font-semibold mb-1">WorldPulse Pro — Labor Rights Alerts</p>
          <p className="text-sm text-slate-400">
            Get real-time alerts on labor rights violations, supply chain risks, and regulatory changes.
            Monitor your supply chain countries with custom watchlists.
          </p>
        </div>

        {/* Data Sources Footer */}
        <div className="text-center text-xs text-slate-600 pt-4 pb-8 border-t border-white/5">
          Data sourced from ITUC Global Rights Index, ILO ILOSTAT, Global Slavery Index,
          Clean Clothes Campaign, IndustriALL Global Union, Equal Times, and labor rights
          organizations worldwide. Updated quarterly.
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
