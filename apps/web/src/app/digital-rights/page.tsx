'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DigitalRightsIndicators {
  internet_freedom_score: number
  surveillance_score: number
  censorship_level: 1 | 2 | 3 | 4 | 5
  data_protection_score: number
  digital_access_index: number
}

interface DigitalRightsCountry {
  code: string
  name: string
  region: string
  rights_status: 'free' | 'partly_free' | 'not_free'
  indicators: DigitalRightsIndicators
  trend: 'improving' | 'declining' | 'stable'
  trend_detail: string
  top_threats: string[]
  population_m: number
  related_signals: number
}

interface DigitalRightsSummary {
  total_countries: number
  free: number
  partly_free: number
  not_free: number
  avg_internet_freedom: number
  avg_surveillance_score: number
  total_population_surveilled_m: number
  internet_shutdowns_this_year: number
  most_restricted: { name: string; code: string; score: number }[]
  most_improved: { name: string; code: string; trend_detail: string }[]
  regional_breakdown: {
    region: string
    count: number
    avg_internet_freedom: number
    population_under_surveillance_m: number
  }[]
  recent_signals: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const STATUS_COLORS: Record<string, string> = {
  free:        'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  partly_free: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  not_free:    'bg-red-500/20 text-red-400 border-red-500/30',
}

const STATUS_LABELS: Record<string, string> = {
  free:        'Free',
  partly_free: 'Partly Free',
  not_free:    'Not Free',
}

const CENSORSHIP_LABELS: Record<number, string> = {
  1: 'Open',
  2: 'Monitored',
  3: 'Restricted',
  4: 'Heavily Restricted',
  5: 'Shutdown',
}

const CENSORSHIP_COLORS: Record<number, string> = {
  1: 'bg-emerald-500',
  2: 'bg-cyan-500',
  3: 'bg-amber-500',
  4: 'bg-orange-500',
  5: 'bg-red-600',
}

const TREND_ICONS: Record<string, string> = {
  improving: '📈',
  declining: '📉',
  stable:    '➡️',
}

const FLAG_MAP: Record<string, string> = {
  EE: '🇪🇪', IS: '🇮🇸', DE: '🇩🇪', FR: '🇫🇷', GB: '🇬🇧', NL: '🇳🇱', SE: '🇸🇪',
  CA: '🇨🇦', US: '🇺🇸', JP: '🇯🇵', AU: '🇦🇺', NZ: '🇳🇿',
  BR: '🇧🇷', IN: '🇮🇳', ID: '🇮🇩', PH: '🇵🇭', MY: '🇲🇾', MX: '🇲🇽',
  KE: '🇰🇪', ZA: '🇿🇦', NG: '🇳🇬', GH: '🇬🇭', ET: '🇪🇹',
  UA: '🇺🇦', TR: '🇹🇷', PK: '🇵🇰', BD: '🇧🇩', TH: '🇹🇭', SG: '🇸🇬',
  TN: '🇹🇳', AM: '🇦🇲', CN: '🇨🇳', RU: '🇷🇺', IR: '🇮🇷', KP: '🇰🇵',
  SA: '🇸🇦', AE: '🇦🇪', EG: '🇪🇬', KZ: '🇰🇿', UZ: '🇺🇿', AZ: '🇦🇿',
  MM: '🇲🇲', VN: '🇻🇳', CU: '🇨🇺', BY: '🇧🇾', KR: '🇰🇷', TW: '🇹🇼',
  AR: '🇦🇷', CO: '🇨🇴', IL: '🇮🇱',
}
function getFlag(code: string): string { return FLAG_MAP[code] ?? '🌐' }

function formatPop(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}B`
  return `${n.toFixed(0)}M`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DigitalRightsPage() {
  const [countries, setCountries] = useState<DigitalRightsCountry[]>([])
  const [summary, setSummary] = useState<DigitalRightsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'internet_freedom_score' | 'surveillance_score' | 'censorship_level' | 'data_protection_score' | 'name'>('internet_freedom_score')
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (regionFilter) params.set('region', regionFilter)
      if (statusFilter) params.set('rights_status', statusFilter)
      params.set('sortBy', sortBy)
      params.set('limit', '100')

      const [countriesRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/digital-rights/countries?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/digital-rights/summary`).then(r => r.json()),
      ])

      setCountries(countriesRes.data ?? [])
      setSummary(summaryRes.data ?? null)
    } catch {
      // API not available — will show empty state
    } finally {
      setLoading(false)
    }
  }, [search, regionFilter, statusFilter, sortBy])

  useEffect(() => { fetchData() }, [fetchData])

  const allRegions = Array.from(new Set(countries.map(c => c.region))).sort()

  return (
    <div className="min-h-screen bg-[#06070d] text-white">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-zinc-800">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-transparent to-indigo-900/20" />
        <div className="relative max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">🔐</span>
            <h1 className="text-3xl font-bold tracking-tight">Digital Rights Intelligence</h1>
          </div>
          <p className="text-zinc-400 text-lg max-w-2xl">
            Real-time monitoring of internet freedom, digital surveillance, censorship, and data protection
            across {summary?.total_countries ?? '50+'} countries.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Countries Tracked',            value: summary.total_countries,                            color: 'text-white' },
              { label: 'Free',                          value: summary.free,                                       color: 'text-emerald-400' },
              { label: 'Partly Free',                   value: summary.partly_free,                                color: 'text-amber-400' },
              { label: 'Not Free',                      value: summary.not_free,                                   color: 'text-red-400' },
              { label: 'Shutdowns This Year',           value: summary.internet_shutdowns_this_year,               color: 'text-orange-400' },
              { label: 'Under Surveillance (B)',        value: formatPop(summary.total_population_surveilled_m),   color: 'text-purple-400' },
            ].map(card => (
              <div key={card.label} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
                <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                <div className="text-xs text-zinc-500 mt-1">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Status Distribution & Regional Breakdown */}
        {summary && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-zinc-400 mb-4">Rights Status Distribution</h2>
              <div className="space-y-4">
                {[
                  { key: 'free',        count: summary.free,        color: 'bg-emerald-500' },
                  { key: 'partly_free', count: summary.partly_free, color: 'bg-amber-500' },
                  { key: 'not_free',    count: summary.not_free,    color: 'bg-red-500' },
                ].map(item => {
                  const pct = (item.count / summary.total_countries) * 100
                  return (
                    <div key={item.key}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-300">{STATUS_LABELS[item.key]}</span>
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
              <h2 className="text-sm font-semibold text-zinc-400 mb-4">By Region (Avg Internet Freedom)</h2>
              <div className="space-y-3">
                {summary.regional_breakdown.slice(0, 6).map(r => {
                  const maxFreedom = summary.regional_breakdown[0]?.avg_internet_freedom ?? 100
                  const pct = (r.avg_internet_freedom / maxFreedom) * 100
                  return (
                    <div key={r.region}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-300 truncate">{r.region}</span>
                        <span className="text-cyan-400 font-mono text-xs">
                          {r.count} countries · {r.avg_internet_freedom.toFixed(0)}/100
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Most Restricted & Countries Improving */}
        {summary && (summary.most_restricted.length > 0 || summary.most_improved.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {summary.most_restricted.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-red-400 mb-4">Most Restricted Countries</h2>
                <div className="space-y-2">
                  {summary.most_restricted.map((item, i) => (
                    <div key={item.code} className="flex items-center justify-between text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-600 w-5">#{i + 1}</span>
                        <span className="text-zinc-300">{getFlag(item.code)} {item.name}</span>
                      </div>
                      <span className="text-red-400 font-mono">{item.score}/100</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {summary.most_improved.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-emerald-400 mb-4">Countries Showing Improvement</h2>
                <div className="space-y-3">
                  {summary.most_improved.map(item => (
                    <div key={item.code} className="py-1">
                      <div className="flex items-center gap-2 text-sm mb-0.5">
                        <span className="text-emerald-400">📈</span>
                        <span className="text-zinc-300 font-medium">{getFlag(item.code)} {item.name}</span>
                      </div>
                      <p className="text-xs text-zinc-500 pl-5 line-clamp-2">{item.trend_detail}</p>
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
            placeholder="Search by country, region, or threat..."
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
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">All Statuses</option>
            <option value="free">Free</option>
            <option value="partly_free">Partly Free</option>
            <option value="not_free">Not Free</option>
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
          >
            <option value="internet_freedom_score">Sort: Internet Freedom</option>
            <option value="surveillance_score">Sort: Surveillance</option>
            <option value="censorship_level">Sort: Censorship</option>
            <option value="data_protection_score">Sort: Data Protection</option>
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
              onClick={() => { setSearch(''); setRegionFilter(''); setStatusFilter('') }}
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
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{getFlag(country.code)}</span>
                      <div>
                        <h3 className="text-base font-semibold text-white">{country.name}</h3>
                        <div className="text-xs text-zinc-500">{country.region}</div>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 text-xs rounded-full border ${STATUS_COLORS[country.rights_status] ?? ''}`}>
                      {STATUS_LABELS[country.rights_status] ?? country.rights_status}
                    </span>
                  </div>

                  {/* Censorship Level Bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-500">Censorship Level</span>
                      <span className="text-zinc-300 font-mono">
                        {country.indicators.censorship_level}/5 — {CENSORSHIP_LABELS[country.indicators.censorship_level]}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(lvl => (
                        <div
                          key={lvl}
                          className={`flex-1 h-2 rounded-sm ${lvl <= country.indicators.censorship_level ? CENSORSHIP_COLORS[country.indicators.censorship_level] : 'bg-zinc-800'}`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Key Metrics */}
                  <div className="space-y-1.5 mb-3">
                    {[
                      { label: 'Internet Freedom', value: country.indicators.internet_freedom_score, max: 100, color: 'bg-cyan-500', textColor: 'text-cyan-400' },
                      { label: 'Surveillance',      value: country.indicators.surveillance_score,     max: 100, color: 'bg-red-500',  textColor: 'text-red-400' },
                      { label: 'Data Protection',   value: country.indicators.data_protection_score,  max: 100, color: 'bg-indigo-500', textColor: 'text-indigo-400' },
                      { label: 'Digital Access',    value: country.indicators.digital_access_index,   max: 100, color: 'bg-purple-500', textColor: 'text-purple-400' },
                    ].map(metric => (
                      <div key={metric.label} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 w-28 flex-shrink-0">{metric.label}:</span>
                        <div className="flex items-center gap-2 flex-1">
                          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${metric.color} rounded-full`}
                              style={{ width: `${(metric.value / metric.max) * 100}%` }}
                            />
                          </div>
                          <span className={`${metric.textColor} font-mono w-8 text-right`}>{metric.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Trend + Signals */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    <span className="text-xs bg-zinc-800 text-zinc-400 rounded px-1.5 py-0.5">
                      {TREND_ICONS[country.trend]} {country.trend}
                    </span>
                    {country.related_signals > 0 && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 rounded px-1.5 py-0.5">
                        {country.related_signals} signals
                      </span>
                    )}
                  </div>

                  {/* Threats */}
                  {country.top_threats.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {country.top_threats.slice(0, 3).map(threat => (
                        <span key={threat} className="text-xs bg-red-500/10 text-red-400/80 rounded px-1.5 py-0.5 border border-red-500/20">
                          {threat}
                        </span>
                      ))}
                      {country.top_threats.length > 3 && (
                        <span className="text-xs text-zinc-600">+{country.top_threats.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3 text-sm">
                      <p className="text-zinc-400 text-xs leading-relaxed">{country.trend_detail}</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-zinc-500">Population:</span>{' '}
                          <span className="text-zinc-300">{formatPop(country.population_m)}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Region:</span>{' '}
                          <span className="text-zinc-300">{country.region}</span>
                        </div>
                      </div>
                      {country.top_threats.length > 3 && (
                        <div className="flex flex-wrap gap-1">
                          {country.top_threats.slice(3).map(threat => (
                            <span key={threat} className="text-xs bg-red-500/10 text-red-400/80 rounded px-1.5 py-0.5 border border-red-500/20">
                              {threat}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-zinc-600 italic">
                        Indicators sourced from Freedom House, Access Now, Ranking Digital Rights, EFF, Privacy International.
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pro CTA */}
        <div className="bg-gradient-to-r from-cyan-900/40 to-indigo-900/40 border border-cyan-500/30 rounded-lg p-6 text-center mt-8">
          <p className="text-sm text-zinc-300 mb-2">
            Deep digital rights analysis, real-time shutdown alerts, and OSINT-enriched surveillance signals for Pro members.
          </p>
          <button className="inline-block px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium text-white transition-colors">
            Upgrade to Pro
          </button>
        </div>

        {/* Attribution */}
        <div className="text-center text-xs text-zinc-600 pt-4 pb-8">
          Digital rights indicators: Freedom House (Freedom on the Net), Access Now (#KeepItOn), Ranking Digital Rights,
          Electronic Frontier Foundation, Privacy International, Reporters Without Borders.
          Updated by WorldPulse intelligence team.
        </div>
      </div>
    </div>
  )
}
