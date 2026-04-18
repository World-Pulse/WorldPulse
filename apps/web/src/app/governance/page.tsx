'use client'

import { useState, useEffect, useCallback } from 'react'
import { Landmark, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface GovernanceIndicators {
  democracy_index: number
  freedom_score: number
  corruption_perception: number
  press_freedom_rank: number
}

interface Country {
  code: string
  name: string
  region: string
  regime_type: 'full_democracy' | 'flawed_democracy' | 'hybrid_regime' | 'authoritarian'
  indicators: GovernanceIndicators
  trend: 'improving' | 'declining' | 'stable'
  trend_magnitude: number
  related_signals: number
}

interface GovernanceSummary {
  total_countries: number
  full_democracy: number
  flawed_democracy: number
  hybrid_regime: number
  authoritarian: number
  avg_democracy_index: number
  avg_freedom_score: number
  avg_corruption_index: number
  most_improved: { name: string; code: string; change: number }[]
  most_declined: { name: string; code: string; change: number }[]
  regional_breakdown: { region: string; count: number; avg_democracy: number }[]
  recent_signals: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const REGIME_COLORS: Record<string, string> = {
  full_democracy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  flawed_democracy: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  hybrid_regime: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  authoritarian: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const REGIME_LABELS: Record<string, string> = {
  full_democracy: 'Full Democracy',
  flawed_democracy: 'Flawed Democracy',
  hybrid_regime: 'Hybrid Regime',
  authoritarian: 'Authoritarian',
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'improving') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400 inline-block" />
  if (trend === 'declining') return <TrendingDown className="w-3.5 h-3.5 text-red-400 inline-block" />
  return <ArrowRight className="w-3.5 h-3.5 text-zinc-400 inline-block" />
}

function formatScore(n: number, max: number = 10): string {
  return `${n.toFixed(1)}${max > 100 ? '' : '/' + max}`
}

const FLAG_MAP: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', FR: '🇫🇷', ES: '🇪🇸', DE: '🇩🇪', IT: '🇮🇹', PT: '🇵🇹',
  IE: '🇮🇪', NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮', SE: '🇸🇪', NL: '🇳🇱',
  BR: '🇧🇷', AR: '🇦🇷', CL: '🇨🇱', CO: '🇨🇴', VE: '🇻🇪', MX: '🇲🇽', CA: '🇨🇦',
  JP: '🇯🇵', SG: '🇸🇬', ID: '🇮🇩', PH: '🇵🇭', KR: '🇰🇷', TW: '🇹🇼', CN: '🇨🇳', IN: '🇮🇳',
  PK: '🇵🇰', BD: '🇧🇩', TH: '🇹🇭', MY: '🇲🇾', KP: '🇰🇵',
  AU: '🇦🇺', NZ: '🇳🇿', ZA: '🇿🇦', NG: '🇳🇬', KE: '🇰🇪', EG: '🇪🇬', ET: '🇪🇹', GH: '🇬🇭',
  IL: '🇮🇱', TR: '🇹🇷', SA: '🇸🇦', AE: '🇦🇪', IR: '🇮🇷', PL: '🇵🇱', CZ: '🇨🇿', HU: '🇭🇺', RO: '🇷🇴', UA: '🇺🇦', RU: '🇷🇺',
}
function getFlag(code: string): string { return FLAG_MAP[code] ?? '--' }

// ─── Component ──────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const [countries, setCountries] = useState<Country[]>([])
  const [summary, setSummary] = useState<GovernanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState<string>('')
  const [regimeFilter, setRegimeFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'name' | 'democracy_index' | 'freedom_score'>('democracy_index')
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (regionFilter) params.set('region', regionFilter)
      if (regimeFilter) params.set('regime_type', regimeFilter)
      params.set('sortBy', sortBy)
      params.set('limit', '100')

      const [countriesRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/governance/countries?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/governance/summary`).then(r => r.json()),
      ])

      setCountries(countriesRes.data || [])
      setSummary(summaryRes.data || null)
    } catch {
      // API not available — will show empty state
    } finally {
      setLoading(false)
    }
  }, [search, regionFilter, regimeFilter, sortBy])

  useEffect(() => { fetchData() }, [fetchData])

  // Unique regions for filter dropdown
  const allRegions = Array.from(new Set(countries.map(c => c.region))).sort()

  return (
    <div className="min-h-screen bg-[#06070d] text-white">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-zinc-800">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-blue-900/20" />
        <div className="relative max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-2">
            <Landmark className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl font-bold tracking-tight">Governance & Democracy Intelligence</h1>
          </div>
          <p className="text-zinc-400 text-lg max-w-2xl">
            Global governance indicators and democracy metrics — {summary?.total_countries ?? '...'} countries
            tracked with democracy index, freedom scores, corruption perception, and press freedom rankings.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Total Countries', value: summary.total_countries, color: 'text-white' },
              { label: 'Full Democracies', value: summary.full_democracy, color: 'text-emerald-400' },
              { label: 'Flawed Democracies', value: summary.flawed_democracy, color: 'text-cyan-400' },
              { label: 'Hybrid Regimes', value: summary.hybrid_regime, color: 'text-amber-400' },
              { label: 'Authoritarian', value: summary.authoritarian, color: 'text-red-400' },
              { label: 'Avg Democracy Index', value: formatScore(summary.avg_democracy_index), color: 'text-purple-400' },
            ].map(card => (
              <div key={card.label} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
                <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                <div className="text-xs text-zinc-500 mt-1">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Regime Type Distribution & Regional Breakdown */}
        {summary && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-zinc-400 mb-4">Regime Type Distribution</h2>
              <div className="space-y-4">
                {[
                  { type: 'full_democracy', count: summary.full_democracy, color: 'bg-emerald-500' },
                  { type: 'flawed_democracy', count: summary.flawed_democracy, color: 'bg-cyan-500' },
                  { type: 'hybrid_regime', count: summary.hybrid_regime, color: 'bg-amber-500' },
                  { type: 'authoritarian', count: summary.authoritarian, color: 'bg-red-500' },
                ].map(item => {
                  const pct = (item.count / summary.total_countries) * 100
                  return (
                    <div key={item.type}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-300">{REGIME_LABELS[item.type]}</span>
                        <span className="text-zinc-400 font-mono">{item.count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full ${item.color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-zinc-400 mb-4">By Region (Avg Democracy Index)</h2>
              <div className="space-y-3">
                {summary.regional_breakdown.slice(0, 6).map((r, i) => {
                  const maxDemocracy = summary.regional_breakdown[0]?.avg_democracy ?? 10
                  const pct = (r.avg_democracy / maxDemocracy) * 100
                  return (
                    <div key={r.region}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-300 truncate">{r.region}</span>
                        <span className="text-purple-400 font-mono">{r.count} countries, {formatScore(r.avg_democracy)}</span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Most Improved / Most Declined */}
        {summary && (summary.most_improved.length > 0 || summary.most_declined.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {summary.most_improved.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-emerald-400 mb-4">Most Improved</h2>
                <div className="space-y-2">
                  {summary.most_improved.map(item => (
                    <div key={item.code} className="flex items-center justify-between text-sm py-1">
                      <span className="text-zinc-300">{getFlag(item.code)} {item.name}</span>
                      <span className="text-emerald-400 font-mono">+{item.change.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {summary.most_declined.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-red-400 mb-4">Most Declined</h2>
                <div className="space-y-2">
                  {summary.most_declined.map(item => (
                    <div key={item.code} className="flex items-center justify-between text-sm py-1">
                      <span className="text-zinc-300">{getFlag(item.code)} {item.name}</span>
                      <span className="text-red-400 font-mono">{item.change.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search countries by name or code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
          />
          <select
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">All Regions</option>
            {allRegions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            value={regimeFilter}
            onChange={e => setRegimeFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">All Regimes</option>
            <option value="full_democracy">Full Democracy</option>
            <option value="flawed_democracy">Flawed Democracy</option>
            <option value="hybrid_regime">Hybrid Regime</option>
            <option value="authoritarian">Authoritarian</option>
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as 'name' | 'democracy_index' | 'freedom_score')}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="democracy_index">Sort: Democracy Index</option>
            <option value="freedom_score">Sort: Freedom Score</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>

        {/* Country Cards */}
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
        ) : countries.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <p className="text-lg">No countries match your filters.</p>
            <button
              onClick={() => { setSearch(''); setRegionFilter(''); setRegimeFilter('') }}
              className="mt-3 text-cyan-400 hover:text-cyan-300 text-sm"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {countries.map(country => {
              const isExpanded = expandedCountry === country.code
              return (
                <div
                  key={country.code}
                  className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors cursor-pointer"
                  onClick={() => setExpandedCountry(isExpanded ? null : country.code)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{getFlag(country.code)}</span>
                      <div>
                        <h3 className="text-base font-semibold text-white">{country.name}</h3>
                        <div className="text-xs text-zinc-500">{country.region}</div>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 text-xs rounded-full border ${REGIME_COLORS[country.regime_type] ?? ''}`}>
                      {REGIME_LABELS[country.regime_type] ?? country.regime_type}
                    </span>
                  </div>

                  {/* Key Indicators */}
                  <div className="space-y-2 mb-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Democracy:</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500 rounded-full"
                            style={{ width: `${(country.indicators.democracy_index / 10) * 100}%` }}
                          />
                        </div>
                        <span className="text-purple-400 font-mono w-8">{formatScore(country.indicators.democracy_index)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Freedom:</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-500 rounded-full"
                            style={{ width: `${(country.indicators.freedom_score / 100) * 100}%` }}
                          />
                        </div>
                        <span className="text-cyan-400 font-mono w-8">{country.indicators.freedom_score.toFixed(0)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Corruption:</span>
                      <span className="text-amber-400 font-mono">{country.indicators.corruption_perception.toFixed(0)}/100</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-2">
                    <span className="text-xs bg-zinc-800 text-zinc-400 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                      <TrendIcon trend={country.trend} /> {country.trend}
                    </span>
                    {country.related_signals > 0 && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 rounded px-1.5 py-0.5">
                        {country.related_signals} signals
                      </span>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3 text-sm">
                      <div>
                        <span className="text-zinc-500">Press Freedom Rank:</span>{' '}
                        <span className="text-zinc-300">#{country.indicators.press_freedom_rank} / 180</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Trend:</span>{' '}
                        <span className="text-zinc-300">
                          <span className="inline-flex items-center gap-1"><TrendIcon trend={country.trend} /> {country.trend} ({country.trend_magnitude > 0 ? '+' : ''}{country.trend_magnitude.toFixed(1)})</span>
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 italic">
                        Indicators updated quarterly. Recent governance signals tracked in system.
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pro CTA Banner */}
        <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/30 rounded-lg p-6 text-center mt-8">
          <p className="text-sm text-zinc-300 mb-2">
            Deep governance analysis, OSINT-enriched signals, and real-time alerts available to Pro members.
          </p>
          <button className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium text-white transition-colors">
            Upgrade to Pro
          </button>
        </div>

        {/* Attribution */}
        <div className="text-center text-xs text-zinc-600 pt-4 pb-8">
          Governance indicators: Economist Intelligence Unit (Democracy Index), Freedom House (Freedom Score),
          Transparency International (Corruption Index), Reporters Sans Frontières (Press Freedom Index).
          Updated by WorldPulse intelligence team.
        </div>
      </div>
    </div>
  )
}
