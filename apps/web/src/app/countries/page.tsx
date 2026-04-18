'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CountryRow {
  code:           string
  name:           string
  risk_score:     number
  risk_label:     string
  risk_color:     string
  signal_count:   number
  recent_6h:      number
  trend:          'rising' | 'stable' | 'falling'
  categories:     string[]
  avg_reliability: number | null
  latest_signal_at: string
}

interface CountryDetail {
  code:           string
  name:           string
  window:         string
  risk_score:     number
  risk_label:     string
  risk_color:     string
  total_signals:  number
  category_breakdown: Array<{
    category:       string
    count:          number
    max_severity:   string
    avg_reliability: number | null
  }>
  recent_signals: Array<{
    id:               string
    title:            string
    summary:          string | null
    severity:         string
    category:         string
    reliability_score: number | null
    source_count:     number | null
    created_at:       string
    location_name:    string | null
  }>
  hourly_trend: Array<{ hour: string; count: number }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-wp-red',
  high:     'text-orange-400',
  medium:   'text-wp-amber',
  low:      'text-yellow-300',
  info:     'text-wp-text3',
}

const TREND_ICON: Record<string, string> = {
  rising:  '↑',
  stable:  '→',
  falling: '↓',
}

const TREND_COLOR: Record<string, string> = {
  rising:  'text-wp-red',
  stable:  'text-wp-text3',
  falling: 'text-wp-green',
}

const WINDOW_OPTIONS = ['24h', '48h', '7d', '30d'] as const
type Window = typeof WINDOW_OPTIONS[number]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function reliabilityColor(score: number | null): string {
  if (score == null) return 'text-wp-text3'
  if (score >= 0.9)  return 'text-wp-green'
  if (score >= 0.75) return 'text-wp-cyan'
  if (score >= 0.55) return 'text-wp-amber'
  return 'text-wp-red'
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="w-8 h-4 bg-wp-s3 rounded" />
      <div className="w-6 h-6 bg-wp-s3 rounded" />
      <div className="flex-1 h-4 bg-wp-s3 rounded" />
      <div className="w-12 h-4 bg-wp-s3 rounded" />
      <div className="w-16 h-4 bg-wp-s3 rounded" />
      <div className="w-10 h-4 bg-wp-s3 rounded" />
    </div>
  )
}

// ─── Country Detail Panel ─────────────────────────────────────────────────────

function CountryDetailPanel({
  code, window, onClose
}: { code: string; window: Window; onClose: () => void }) {
  const [detail, setDetail] = useState<CountryDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_URL}/api/v1/countries/${code}?window=${window}&limit=8`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(e.error ?? 'Error')))
      .then((data: CountryDetail) => { setDetail(data); setLoading(false) })
      .catch((e: string) => { setError(e); setLoading(false) })
  }, [code, window])

  return (
    <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-wp-surface border border-[rgba(255,255,255,0.1)] sm:rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 glass border-b border-[rgba(255,255,255,0.07)] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-wp-text3 tracking-widest uppercase">Country Intel</span>
            {detail && (
              <>
                <span className="text-wp-text font-display text-[18px] tracking-wide">{detail.name}</span>
                <span
                  className="font-mono text-[11px] px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${detail.risk_color}22`, color: detail.risk_color, border: `1px solid ${detail.risk_color}44` }}
                >
                  {detail.risk_label.toUpperCase()} · {detail.risk_score}
                </span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-wp-s2 text-[16px]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          {loading && (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-4 bg-wp-s3 rounded animate-pulse" style={{ width: `${80 - i * 10}%` }} />
              ))}
            </div>
          )}

          {error && (
            <p className="text-wp-red text-[13px] text-center py-8">{error}</p>
          )}

          {detail && !loading && (
            <div className="space-y-6">
              {/* Risk gauge bar */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase">Risk Score</span>
                  <span className="font-mono text-[11px]" style={{ color: detail.risk_color }}>{detail.risk_score}/100</span>
                </div>
                <div className="h-2 bg-wp-s3 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${detail.risk_score}%`, backgroundColor: detail.risk_color }}
                  />
                </div>
              </div>

              {/* Hourly sparkline */}
              {detail.hourly_trend.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase mb-2">Signal Volume (24h)</div>
                  <div className="flex items-end gap-0.5 h-12">
                    {(() => {
                      const max = Math.max(...detail.hourly_trend.map(h => h.count), 1)
                      return detail.hourly_trend.map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-sm bg-wp-amber/60 hover:bg-wp-amber transition-all"
                          style={{ height: `${Math.max(2, (h.count / max) * 48)}px` }}
                          title={`${h.count} signals`}
                        />
                      ))
                    })()}
                  </div>
                </div>
              )}

              {/* Category breakdown */}
              <div>
                <div className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase mb-3">Category Breakdown</div>
                <div className="space-y-2">
                  {detail.category_breakdown.map(cat => (
                    <div key={cat.category} className="flex items-center gap-3">
                      <span className={`font-mono text-[10px] uppercase w-16 flex-shrink-0 ${SEVERITY_COLOR[cat.max_severity] ?? 'text-wp-text3'}`}>
                        {cat.max_severity.slice(0, 4).toUpperCase()}
                      </span>
                      <span className="text-wp-text2 text-[13px] capitalize flex-1">{cat.category}</span>
                      <span className="font-mono text-[11px] text-wp-text3">{cat.count}</span>
                      {cat.avg_reliability != null && (
                        <span className={`font-mono text-[10px] ${reliabilityColor(cat.avg_reliability)}`}>
                          {Math.round(cat.avg_reliability * 100)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent signals */}
              {detail.recent_signals.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase mb-3">Recent Signals</div>
                  <div className="space-y-2">
                    {detail.recent_signals.map(sig => (
                      <Link
                        key={sig.id}
                        href={`/?signal=${sig.id}`}
                        className="block p-3 bg-wp-s2 border border-[rgba(255,255,255,0.05)] rounded-xl hover:border-[rgba(255,255,255,0.15)] transition-all no-underline"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className={`font-mono text-[9px] uppercase flex-shrink-0 ${SEVERITY_COLOR[sig.severity] ?? 'text-wp-text3'}`}>
                            {sig.severity}
                          </span>
                          <span className="font-mono text-[10px] text-wp-text3 flex-shrink-0">{timeAgo(sig.created_at)}</span>
                        </div>
                        <p className="text-wp-text text-[13px] leading-relaxed line-clamp-2">{sig.title}</p>
                        {sig.location_name && (
                          <p className="text-wp-text3 text-[11px] mt-1">📍 {sig.location_name}</p>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-center">
                <Link
                  href={`/?category=all&country=${detail.code}`}
                  className="inline-block px-4 py-2 rounded-lg bg-wp-amber text-black text-[12px] font-bold hover:bg-[#ffb84d] transition-all no-underline"
                >
                  View all signals from {detail.name} →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CountriesPage() {
  const [countries, setCountries]   = useState<CountryRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [window, setWindow]         = useState<Window>('24h')
  const [sortBy, setSortBy]         = useState<'risk' | 'signals' | 'trend'>('risk')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchCountries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/v1/countries?window=${window}&limit=120`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: { countries: CountryRow[] } = await res.json()
      setCountries(data.countries)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load country data')
    } finally {
      setLoading(false)
    }
  }, [window])

  useEffect(() => {
    fetchCountries()
    const interval = setInterval(fetchCountries, 5 * 60 * 1000) // refresh every 5 min
    return () => clearInterval(interval)
  }, [fetchCountries])

  // Sort and filter
  const filtered = countries
    .filter(c =>
      !searchTerm ||
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'signals') return b.signal_count - a.signal_count
      if (sortBy === 'trend')   return (b.recent_6h / (b.signal_count || 1)) - (a.recent_6h / (a.signal_count || 1))
      return b.risk_score - a.risk_score // default: risk
    })

  const sortedBySeverityLabel = [...new Set(countries.map(c => c.risk_label))]
    .sort((a, b) => ['Critical','High','Elevated','Moderate','Low'].indexOf(a) - ['Critical','High','Elevated','Moderate','Low'].indexOf(b))

  const riskCounts = countries.reduce<Record<string, number>>((acc, c) => {
    acc[c.risk_label] = (acc[c.risk_label] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="min-h-[calc(100vh-52px)] bg-wp-bg">
      {/* Page header */}
      <div className="sticky top-[52px] glass border-b border-[rgba(255,255,255,0.07)] z-50 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <h1 className="font-display text-[22px] tracking-[2px] text-wp-text">
                COUNTRY <span className="text-wp-amber">INTELLIGENCE</span>
              </h1>
              <p className="text-wp-text3 text-[12px] mt-0.5">
                Composite risk index · {countries.length} countries tracked
                {lastUpdated && <span className="ml-2 opacity-60">· updated {timeAgo(lastUpdated.toISOString())} ago</span>}
              </p>
            </div>

            {/* Window selector */}
            <div className="flex gap-1">
              {WINDOW_OPTIONS.map(w => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={`px-3 py-1.5 rounded-lg font-mono text-[11px] transition-all ${
                    window === w
                      ? 'bg-wp-amber text-black font-bold'
                      : 'bg-wp-s2 text-wp-text2 hover:bg-wp-s3'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {/* Summary risk distribution */}
          {!loading && countries.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {['Critical','High','Elevated','Moderate','Low'].map(label => {
                const count = riskCounts[label] ?? 0
                if (count === 0) return null
                const colors: Record<string, string> = {
                  Critical: '#ff3b5c', High: '#ff6b35', Elevated: '#f5a623', Moderate: '#ffd700', Low: '#00e676',
                }
                return (
                  <span
                    key={label}
                    className="font-mono text-[10px] px-2 py-1 rounded-full"
                    style={{ backgroundColor: `${colors[label]}22`, color: colors[label], border: `1px solid ${colors[label]}44` }}
                  >
                    {count} {label}
                  </span>
                )
              })}
            </div>
          )}

          {/* Search + sort */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="search"
              placeholder="Search country…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="flex-1 min-w-[180px] max-w-xs bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-lg px-3 py-1.5 text-[13px] text-wp-text placeholder:text-wp-text3 focus:outline-none focus:border-wp-amber/50"
            />
            <div className="flex gap-1">
              {(['risk', 'signals', 'trend'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`px-3 py-1.5 rounded-lg font-mono text-[11px] transition-all capitalize ${
                    sortBy === s
                      ? 'bg-wp-cyan/20 text-wp-cyan border border-wp-cyan/40'
                      : 'bg-wp-s2 text-wp-text3 hover:text-wp-text2'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="max-w-6xl mx-auto px-2 sm:px-6 py-6">
        {error && (
          <div className="text-center py-16">
            <p className="text-wp-red text-[14px] mb-3">{error}</p>
            <button onClick={fetchCountries} className="px-4 py-2 rounded-lg bg-wp-s2 text-wp-text2 text-[12px] hover:bg-wp-s3">
              Retry
            </button>
          </div>
        )}

        {!error && (
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[2rem_3rem_1fr_6rem_5rem_5rem_4rem] items-center gap-3 px-4 py-2 border-b border-[rgba(255,255,255,0.07)] font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">
              <span>#</span>
              <span></span>
              <span>Country</span>
              <span>Risk</span>
              <span>Signals</span>
              <span>Trend</span>
              <span>Reliability</span>
            </div>

            {loading && (
              <div>
                {[...Array(12)].map((_, i) => <SkeletonRow key={i} />)}
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <p className="text-center text-wp-text3 text-[13px] py-12">
                {searchTerm ? `No countries matching "${searchTerm}"` : 'No country data for this window'}
              </p>
            )}

            {!loading && filtered.map((country, idx) => (
              <button
                key={country.code}
                onClick={() => setSelectedCode(country.code)}
                className="w-full text-left group sm:grid grid-cols-[2rem_3rem_1fr_6rem_5rem_5rem_4rem] flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[rgba(255,255,255,0.04)] hover:bg-wp-s2 transition-all last:border-b-0"
              >
                {/* Rank */}
                <span className="font-mono text-[11px] text-wp-text3 w-8 text-right flex-shrink-0">{idx + 1}</span>

                {/* Flag emoji (using code to get flag) */}
                <span className="text-[20px] w-8 text-center flex-shrink-0" aria-hidden="true">
                  {String.fromCodePoint(...country.code.split('').map(c => 0x1F1E0 - 65 + c.charCodeAt(0)))}
                </span>

                {/* Name + categories */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-wp-text font-medium text-[14px] group-hover:text-wp-amber transition-colors">
                      {country.name}
                    </span>
                    <Link
                      href={`/countries/${country.code.toLowerCase()}`}
                      onClick={e => e.stopPropagation()}
                      className="font-mono text-[9px] text-wp-cyan hover:text-wp-amber transition-colors no-underline hidden sm:inline"
                    >
                      full profile →
                    </Link>
                  </div>
                  {country.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {country.categories.slice(0, 3).map(cat => (
                        <span key={cat} className="font-mono text-[9px] text-wp-text3 capitalize">{cat}</span>
                      ))}
                      {country.categories.length > 3 && (
                        <span className="font-mono text-[9px] text-wp-text3">+{country.categories.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Risk score */}
                <div className="flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-wp-s3 rounded-full overflow-hidden hidden sm:block">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${country.risk_score}%`, backgroundColor: country.risk_color }}
                      />
                    </div>
                    <span
                      className="font-mono text-[11px] font-bold"
                      style={{ color: country.risk_color }}
                    >
                      {country.risk_score}
                    </span>
                  </div>
                  <span className="font-mono text-[9px]" style={{ color: country.risk_color }}>
                    {country.risk_label.toUpperCase()}
                  </span>
                </div>

                {/* Signal count */}
                <div className="flex-shrink-0 text-right sm:text-left">
                  <span className="font-mono text-[13px] text-wp-text">{country.signal_count.toLocaleString()}</span>
                  <div className="font-mono text-[9px] text-wp-text3">signals</div>
                </div>

                {/* Trend */}
                <div className="flex-shrink-0">
                  <span className={`font-mono text-[16px] font-bold ${TREND_COLOR[country.trend] ?? 'text-wp-text3'}`}>
                    {TREND_ICON[country.trend]}
                  </span>
                  <div className="font-mono text-[9px] text-wp-text3 capitalize">{country.trend}</div>
                </div>

                {/* Reliability */}
                <div className="flex-shrink-0 hidden sm:block">
                  {country.avg_reliability != null && (
                    <span className={`font-mono text-[11px] ${reliabilityColor(country.avg_reliability)}`}>
                      {Math.round(country.avg_reliability * 100)}%
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <p className="text-center text-wp-text3 text-[11px] font-mono mt-4">
            {filtered.length} countries · {window} window · Click any row for full intelligence profile
          </p>
        )}
      </div>

      {/* Detail panel */}
      {selectedCode && (
        <CountryDetailPanel
          code={selectedCode}
          window={window}
          onClose={() => setSelectedCode(null)}
        />
      )}
    </div>
  )
}
