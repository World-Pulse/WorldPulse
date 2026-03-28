'use client'

import { useEffect, useState, useCallback } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface BriefingDevelopment {
  headline: string
  detail: string
  severity: string
  category: string
  signal_count: number
}

interface CategoryBreakdown {
  category: string
  count: number
  critical_count: number
  high_count: number
}

interface GeographicHotspot {
  country_code: string
  location_name: string | null
  signal_count: number
  avg_severity_score: number
}

interface BriefingSignal {
  id: string
  title: string
  category: string
  severity: string
  reliability_score: number
  location_name: string | null
  source_domain: string | null
  created_at: string
}

interface DailyBriefing {
  id: string
  date: string
  generated_at: string
  model: string
  period_hours: number
  total_signals: number
  total_clusters: number
  executive_summary: string
  key_developments: BriefingDevelopment[]
  category_breakdown: CategoryBreakdown[]
  geographic_hotspots: GeographicHotspot[]
  threat_assessment: string
  outlook: string
  top_signals: BriefingSignal[]
}

// ─── Severity Helpers ────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info:     'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-500',
  medium:   'bg-yellow-500',
  low:      'bg-blue-500',
  info:     'bg-gray-500',
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[severity] ?? SEVERITY_DOT.info}`} />
      {severity.toUpperCase()}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
      {category}
    </span>
  )
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function BriefingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 bg-zinc-800 rounded" />
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
        <div className="h-4 w-full bg-zinc-800 rounded" />
        <div className="h-4 w-3/4 bg-zinc-800 rounded" />
        <div className="h-4 w-1/2 bg-zinc-800 rounded" />
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="h-4 w-48 bg-zinc-800 rounded mb-2" />
          <div className="h-3 w-full bg-zinc-800 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hours, setHours] = useState(24)

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

  const fetchBriefing = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/v1/briefings/daily?hours=${hours}`)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const json = await res.json()
      setBriefing(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }, [apiBase, hours])

  useEffect(() => {
    fetchBriefing()
    // Auto-refresh every 30 minutes
    const interval = setInterval(fetchBriefing, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchBriefing])

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Daily Intelligence Briefing
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              AI-generated summary of global signal intelligence
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm rounded-lg px-3 py-1.5 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value={12}>Last 12h</option>
              <option value={24}>Last 24h</option>
              <option value={48}>Last 48h</option>
              <option value={72}>Last 72h</option>
            </select>
            <button
              onClick={fetchBriefing}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              {loading ? 'Generating...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6">
            <p className="font-medium">Failed to load briefing</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && !briefing && <BriefingSkeleton />}

        {/* Briefing Content */}
        {briefing && (
          <div className="space-y-6">

            {/* Meta Bar */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              <span>Generated {timeAgo(briefing.generated_at)}</span>
              <span className="text-zinc-700">·</span>
              <span>{briefing.total_signals.toLocaleString()} signals processed</span>
              <span className="text-zinc-700">·</span>
              <span>{briefing.total_clusters} event clusters</span>
              <span className="text-zinc-700">·</span>
              <span className="text-zinc-600">Model: {briefing.model}</span>
            </div>

            {/* Executive Summary */}
            <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Executive Summary
              </h2>
              <p className="text-zinc-200 leading-relaxed">
                {briefing.executive_summary}
              </p>
            </section>

            {/* Key Developments */}
            {briefing.key_developments.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Key Developments
                </h2>
                <div className="space-y-3">
                  {briefing.key_developments.map((dev, i) => (
                    <div
                      key={i}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1.5">
                            <SeverityBadge severity={dev.severity} />
                            <CategoryBadge category={dev.category} />
                            {dev.signal_count > 1 && (
                              <span className="text-xs text-zinc-600">
                                {dev.signal_count} signals
                              </span>
                            )}
                          </div>
                          <h3 className="font-semibold text-zinc-100">{dev.headline}</h3>
                          <p className="text-sm text-zinc-400 mt-1">{dev.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Threat Assessment & Outlook */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Threat Assessment
                </h2>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {briefing.threat_assessment}
                </p>
              </section>
              <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Outlook (24-48h)
                </h2>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {briefing.outlook}
                </p>
              </section>
            </div>

            {/* Category Breakdown + Geographic Hotspots */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {briefing.category_breakdown.length > 0 && (
                <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                    Signal Categories
                  </h2>
                  <div className="space-y-2">
                    {briefing.category_breakdown.slice(0, 8).map((cat) => (
                      <div key={cat.category} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-300 capitalize">{cat.category}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500">{cat.count}</span>
                          {cat.critical_count > 0 && (
                            <span className="text-xs text-red-400">{cat.critical_count} crit</span>
                          )}
                          {cat.high_count > 0 && (
                            <span className="text-xs text-orange-400">{cat.high_count} high</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {briefing.geographic_hotspots.length > 0 && (
                <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                    Geographic Hotspots
                  </h2>
                  <div className="space-y-2">
                    {briefing.geographic_hotspots.slice(0, 8).map((spot, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-300">
                          {spot.country_code}
                          {spot.location_name && (
                            <span className="text-zinc-500 ml-1">({spot.location_name})</span>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500">{spot.signal_count} signals</span>
                          <span className={`w-2 h-2 rounded-full ${
                            spot.avg_severity_score >= 4 ? 'bg-red-500' :
                            spot.avg_severity_score >= 3 ? 'bg-orange-500' :
                            'bg-yellow-500'
                          }`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Top Signals */}
            {briefing.top_signals.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Top Signals
                </h2>
                <div className="space-y-2">
                  {briefing.top_signals.map((signal) => (
                    <a
                      key={signal.id}
                      href={`/signals/${signal.id}`}
                      className="block bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <SeverityBadge severity={signal.severity} />
                            <CategoryBadge category={signal.category} />
                          </div>
                          <h3 className="text-sm font-medium text-zinc-200 truncate">
                            {signal.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                            {signal.location_name && <span>{signal.location_name}</span>}
                            {signal.source_domain && <span>via {signal.source_domain}</span>}
                            <span>{timeAgo(signal.created_at)}</span>
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <div className={`font-mono ${
                            signal.reliability_score >= 0.8 ? 'text-green-400' :
                            signal.reliability_score >= 0.6 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {(signal.reliability_score * 100).toFixed(0)}%
                          </div>
                          <div className="text-zinc-600 mt-0.5">reliability</div>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Footer */}
            <div className="text-center text-xs text-zinc-600 pt-4 border-t border-zinc-800">
              WorldPulse Daily Intelligence Briefing — {briefing.date} — {briefing.period_hours}h window
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
