'use client'

import { useEffect, useState, useCallback } from 'react'
import { Inbox } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BriefingSignal {
  id: string
  title: string
  summary: string | null
  severity: string
  reliability_score: number
  location_name: string | null
  country_code: string | null
  category: string
  published_at: string
  source_count: number
}

interface BriefingSection {
  category: string
  signals: BriefingSignal[]
}

interface TopLocation {
  location_name: string
  count: number
}

interface SeverityBreakdown {
  critical: number
  high: number
  medium: number
  low: number
}

interface DailyBriefing {
  date: string
  generated_at: string
  headline_count: number
  sections: BriefingSection[]
  top_locations: TopLocation[]
  severity_breakdown: SeverityBreakdown
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const SEVERITY_BAR: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-500',
  medium:   'bg-yellow-500',
  low:      'bg-blue-400',
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS['info']!
  const dot = SEVERITY_DOT[severity] ?? SEVERITY_DOT['info']!
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {severity.toUpperCase()}
    </span>
  )
}

function ReliabilityDots({ score }: { score: number }) {
  const pct = Math.round(score * 5)
  return (
    <span className="inline-flex items-center gap-0.5" title={`${(score * 100).toFixed(0)}% reliability`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i <= pct
              ? score >= 0.8 ? 'bg-green-400' : score >= 0.6 ? 'bg-yellow-400' : 'bg-red-400'
              : 'bg-zinc-700'
          }`}
        />
      ))}
    </span>
  )
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BriefingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 flex-1 bg-zinc-800 rounded-xl" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="h-4 w-32 bg-zinc-800 rounded" />
          <div className="h-4 w-full bg-zinc-800 rounded" />
          <div className="h-3 w-3/4 bg-zinc-800 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, color,
}: { label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col items-center justify-center gap-1">
      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BriefingPage() {
  const [briefing, setBriefing]   = useState<DailyBriefing | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [category, setCategory]   = useState('')
  const [copied, setCopied]       = useState(false)

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

  const fetchBriefing = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      const res = await fetch(`${apiBase}/api/v1/briefing/daily?${params.toString()}`)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const json = await res.json() as { data: DailyBriefing }
      setBriefing(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }, [apiBase, category])

  useEffect(() => {
    fetchBriefing()
    const interval = setInterval(fetchBriefing, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchBriefing])

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }, [])

  const sb = briefing?.severity_breakdown

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-8">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <span>Daily Intelligence Briefing</span>
              <span className="text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                AI-Verified
              </span>
            </h1>
            {briefing ? (
              <p className="text-sm text-zinc-500 mt-1">
                {formatDate(briefing.date)} · generated {timeAgo(briefing.generated_at)}
              </p>
            ) : (
              <p className="text-sm text-zinc-500 mt-1">
                Structured intelligence from AI-verified signals
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Category filter */}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm rounded-lg px-3 py-1.5 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All categories</option>
              <option value="breaking">Breaking</option>
              <option value="conflict">Conflict</option>
              <option value="geopolitics">Geopolitics</option>
              <option value="climate">Climate</option>
              <option value="health">Health</option>
              <option value="economy">Economy</option>
              <option value="technology">Technology</option>
              <option value="security">Security</option>
              <option value="disaster">Disaster</option>
            </select>

            {/* Share button */}
            <button
              onClick={handleShare}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              {copied ? '✓ Copied' : '↗ Share Briefing'}
            </button>

            {/* Refresh button */}
            <button
              onClick={fetchBriefing}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6">
            <p className="font-medium">Failed to load briefing</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && !briefing && <BriefingSkeleton />}

        {/* ── No signals empty state ── */}
        {!loading && briefing && briefing.headline_count === 0 && (
          <div className="text-center py-16 text-zinc-500">
            <Inbox className="w-10 h-10 text-zinc-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-zinc-400">No signals for this period</p>
            <p className="text-sm mt-2">
              Try a different date or category, or check back later as new signals are verified.
            </p>
          </div>
        )}

        {/* ── Briefing Content ── */}
        {briefing && briefing.headline_count > 0 && (
          <div className="space-y-6">

            {/* Severity breakdown stats */}
            {sb && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Critical" value={sb.critical} color="text-red-400" />
                <StatCard label="High"     value={sb.high}     color="text-orange-400" />
                <StatCard label="Medium"   value={sb.medium}   color="text-yellow-400" />
                <StatCard label="Low"      value={sb.low}      color="text-blue-400" />
              </div>
            )}

            {/* Severity bar */}
            {sb && (
              <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5">
                {(
                  [
                    ['critical', sb.critical],
                    ['high',     sb.high],
                    ['medium',   sb.medium],
                    ['low',      sb.low],
                  ] as [string, number][]
                )
                  .filter(([, n]) => n > 0)
                  .map(([sev, n]) => (
                    <div
                      key={sev}
                      className={`${SEVERITY_BAR[sev] ?? 'bg-zinc-600'} h-full`}
                      style={{ flex: n }}
                      title={`${sev}: ${n}`}
                    />
                  ))}
              </div>
            )}

            {/* Top locations */}
            {briefing.top_locations.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Top Locations
                </h2>
                <div className="flex flex-wrap gap-2">
                  {briefing.top_locations.map((loc) => (
                    <span
                      key={loc.location_name}
                      className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-3 py-1 text-sm text-zinc-300"
                    >
                      <span className="text-zinc-500 text-xs">{loc.count}×</span>
                      {loc.location_name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sections by category */}
            {briefing.sections.map((section) => (
              <section key={section.category}>
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="capitalize">{section.category}</span>
                  <span className="bg-zinc-800 text-zinc-400 rounded-full px-2 py-0.5 text-xs font-mono">
                    {section.signals.length}
                  </span>
                </h2>
                <div className="space-y-3">
                  {section.signals.map((signal) => (
                    <a
                      key={signal.id}
                      href={`/signals/${signal.id}`}
                      className="block bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* Badges */}
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <SeverityBadge severity={signal.severity} />
                            {signal.source_count > 1 && (
                              <span className="text-xs text-zinc-500 bg-zinc-800 rounded-full px-2 py-0.5">
                                {signal.source_count} sources
                              </span>
                            )}
                          </div>
                          {/* Title */}
                          <h3 className="font-semibold text-zinc-100 leading-snug">
                            {signal.title}
                          </h3>
                          {/* Summary */}
                          {signal.summary && (
                            <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed line-clamp-2">
                              {signal.summary}
                            </p>
                          )}
                          {/* Meta */}
                          <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                            {signal.location_name && (
                              <span className="flex items-center gap-1">
                                <span>📍</span>{signal.location_name}
                              </span>
                            )}
                            <span>{timeAgo(signal.published_at)}</span>
                          </div>
                        </div>

                        {/* Reliability */}
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <ReliabilityDots score={signal.reliability_score} />
                          <span className={`text-xs font-mono ${
                            signal.reliability_score >= 0.8 ? 'text-green-400' :
                            signal.reliability_score >= 0.6 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {(signal.reliability_score * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            ))}

            {/* Subscribe CTA */}
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-indigo-300">Get the daily briefing in your inbox</h3>
                <p className="text-sm text-zinc-400 mt-0.5">
                  AI-verified intelligence delivered every morning at 07:00 UTC.
                </p>
              </div>
              <a
                href="/settings#notifications"
                className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Subscribe →
              </a>
            </div>

            {/* Footer */}
            <p className="text-center text-xs text-zinc-600 pt-2 border-t border-zinc-800">
              WorldPulse Daily Intelligence Briefing · {briefing.date} · {briefing.headline_count} signals
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
