'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BriefingDevelopment {
  headline: string
  detail:   string
  severity: string
  category: string
  signal_count: number
}

interface CategoryBreakdown {
  category:       string
  count:          number
  critical_count: number
  high_count:     number
}

interface GeographicHotspot {
  country_code:      string
  location_name:     string | null
  signal_count:      number
  avg_severity_score: number
}

interface BriefingSignal {
  id:                string
  title:             string
  category:          string
  severity:          string
  reliability_score: number
  location_name:     string | null
  country_code:      string | null
  source_domain:     string | null
  created_at:        string
}

interface DailyBriefing {
  id:                 string
  date:               string
  generated_at:       string
  model:              string
  period_hours:       number
  total_signals:      number
  total_clusters:     number
  executive_summary:  string
  key_developments:   BriefingDevelopment[]
  category_breakdown: CategoryBreakdown[]
  geographic_hotspots: GeographicHotspot[]
  threat_assessment:  string
  outlook:            string
  top_signals:        BriefingSignal[]
}

interface BriefingHistoryItem {
  id:             string
  date:           string
  generated_at:   string
  total_signals:  number
  total_clusters: number
  model:          string
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-wp-red   bg-[rgba(255,59,92,0.12)] border-[rgba(255,59,92,0.25)]',
  high:     'text-[#ff8c00] bg-[rgba(255,140,0,0.12)] border-[rgba(255,140,0,0.25)]',
  medium:   'text-wp-amber bg-[rgba(245,166,35,0.12)] border-[rgba(245,166,35,0.25)]',
  low:      'text-wp-cyan  bg-[rgba(0,212,255,0.12)]  border-[rgba(0,212,255,0.25)]',
  info:     'text-wp-text3 bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.12)]',
}

const CATEGORY_ICONS: Record<string, string> = {
  conflict:    '⚔️',
  geopolitics: '🌐',
  climate:     '🌡️',
  health:      '🏥',
  economy:     '📈',
  technology:  '💻',
  science:     '🔬',
  security:    '🔒',
  elections:   '🗳️',
  disaster:    '🌊',
  breaking:    '🚨',
  culture:     '🎭',
  space:       '🚀',
  sports:      '⚽',
  other:       '🌍',
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return iso }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
  } catch { return '' }
}

function fmtRelative(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60)   return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

// ─── Skeleton ───────────────────────────────────────────────────────────────────

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="h-4 w-3/4 bg-[rgba(255,255,255,0.08)] rounded mb-3" />
      <div className="h-3 w-full bg-[rgba(255,255,255,0.06)] rounded mb-2" />
      <div className="h-3 w-5/6 bg-[rgba(255,255,255,0.05)] rounded mb-2" />
      <div className="h-3 w-2/3 bg-[rgba(255,255,255,0.04)] rounded" />
    </div>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider border ${SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info}`}>
      {severity}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono text-wp-text2 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)]">
      {CATEGORY_ICONS[category] ?? '🌍'} {category}
    </span>
  )
}

// ─── Section Components ─────────────────────────────────────────────────────────

function ExecutiveSummarySection({ text }: { text: string }) {
  return (
    <section className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-amber mb-3">
        Executive Summary
      </h2>
      <p className="text-[14px] text-wp-text leading-relaxed whitespace-pre-wrap">
        {text}
      </p>
    </section>
  )
}

function KeyDevelopmentsSection({ developments }: { developments: BriefingDevelopment[] }) {
  if (!developments.length) return null
  return (
    <section className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-amber mb-4">
        Key Developments
      </h2>
      <div className="space-y-4">
        {developments.map((d, i) => (
          <div key={i} className="border-l-2 border-[rgba(255,255,255,0.1)] pl-4">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <SeverityBadge severity={d.severity} />
              <CategoryBadge category={d.category} />
              <span className="text-[10px] font-mono text-wp-text3">
                {d.signal_count} signal{d.signal_count !== 1 ? 's' : ''}
              </span>
            </div>
            <h3 className="text-[14px] font-semibold text-wp-text mb-1">{d.headline}</h3>
            <p className="text-[13px] text-wp-text2 leading-relaxed">{d.detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function CategoryBreakdownSection({ categories }: { categories: CategoryBreakdown[] }) {
  if (!categories.length) return null
  const maxCount = Math.max(...categories.map(c => c.count), 1)
  return (
    <section className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-amber mb-4">
        Category Breakdown
      </h2>
      <div className="space-y-3">
        {categories.map(c => (
          <div key={c.category}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] text-wp-text flex items-center gap-1.5">
                {CATEGORY_ICONS[c.category] ?? '🌍'} {c.category}
              </span>
              <div className="flex items-center gap-2">
                {c.critical_count > 0 && (
                  <span className="text-[10px] font-mono text-wp-red">{c.critical_count} critical</span>
                )}
                {c.high_count > 0 && (
                  <span className="text-[10px] font-mono text-[#ff8c00]">{c.high_count} high</span>
                )}
                <span className="text-[12px] font-mono text-wp-text2 w-8 text-right">{c.count}</span>
              </div>
            </div>
            <div className="h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-wp-cyan transition-all duration-500"
                style={{ width: `${(c.count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function GeographicHotspotsSection({ hotspots }: { hotspots: GeographicHotspot[] }) {
  if (!hotspots.length) return null
  return (
    <section className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-amber mb-4">
        Geographic Hotspots
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {hotspots.map((h, i) => {
          const sevColor = h.avg_severity_score >= 4 ? 'border-wp-red bg-[rgba(255,59,92,0.06)]'
            : h.avg_severity_score >= 3 ? 'border-[rgba(255,140,0,0.25)] bg-[rgba(255,140,0,0.06)]'
            : 'border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)]'
          return (
            <div key={i} className={`border rounded-lg p-3 ${sevColor}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] text-wp-text font-medium">
                  {h.location_name ?? h.country_code}
                </span>
                <span className="text-[10px] font-mono text-wp-text3">{h.country_code}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono text-wp-text2">
                <span>{h.signal_count} signal{h.signal_count !== 1 ? 's' : ''}</span>
                <span>severity {h.avg_severity_score.toFixed(1)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ThreatAssessmentSection({ text }: { text: string }) {
  if (!text) return null
  return (
    <section className="glass border border-[rgba(255,59,92,0.15)] rounded-xl p-6 bg-[rgba(255,59,92,0.03)]">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-red mb-3">
        Threat Assessment
      </h2>
      <p className="text-[13px] text-wp-text leading-relaxed whitespace-pre-wrap">{text}</p>
    </section>
  )
}

function OutlookSection({ text }: { text: string }) {
  if (!text) return null
  return (
    <section className="glass border border-[rgba(0,212,255,0.15)] rounded-xl p-6 bg-[rgba(0,212,255,0.03)]">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-cyan mb-3">
        Outlook &amp; Forecast
      </h2>
      <p className="text-[13px] text-wp-text leading-relaxed whitespace-pre-wrap">{text}</p>
    </section>
  )
}

function TopSignalsSection({ signals }: { signals: BriefingSignal[] }) {
  if (!signals.length) return null
  return (
    <section className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6">
      <h2 className="font-mono text-[11px] tracking-widest uppercase text-wp-amber mb-4">
        Top Signals
      </h2>
      <div className="space-y-2">
        {signals.slice(0, 15).map(s => (
          <Link
            key={s.id}
            href={`/signals/${s.id}`}
            className="flex items-start gap-3 p-3 rounded-lg border border-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.03)] transition-all group"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-wp-text group-hover:text-wp-amber transition-colors leading-tight truncate">
                {s.title}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <SeverityBadge severity={s.severity} />
                <CategoryBadge category={s.category} />
                {s.location_name && (
                  <span className="text-[10px] font-mono text-wp-text3">{s.location_name}</span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="flex gap-[2px]">
                {Array(5).fill(0).map((_, di) => (
                  <div
                    key={di}
                    className={`w-[4px] h-[4px] rounded-full ${di < Math.round(s.reliability_score * 5) ? 'bg-wp-green' : 'bg-wp-s3'}`}
                  />
                ))}
              </div>
              <p className="text-[10px] font-mono text-wp-text3 mt-1">
                {fmtRelative(s.created_at)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

// ─── History Sidebar ────────────────────────────────────────────────────────────

function HistorySidebar({ items, activeId, onSelect }: {
  items: BriefingHistoryItem[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
      <h3 className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-3">
        Previous Briefings
      </h3>
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {items.map(h => (
          <button
            key={h.id}
            onClick={() => onSelect(h.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all ${
              h.id === activeId
                ? 'bg-[rgba(245,166,35,0.12)] border border-[rgba(245,166,35,0.25)] text-wp-amber'
                : 'hover:bg-[rgba(255,255,255,0.05)] text-wp-text2 border border-transparent'
            }`}
          >
            <p className="font-medium">{fmtDate(h.date)}</p>
            <p className="font-mono text-[10px] text-wp-text3 mt-0.5">
              {h.total_signals} signals · {h.total_clusters} clusters
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Stat Cards ─────────────────────────────────────────────────────────────────

function BriefingStats({ briefing }: { briefing: DailyBriefing }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4 text-center">
        <p className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-1">Signals</p>
        <p className="font-mono text-[24px] font-bold text-wp-text">{briefing.total_signals}</p>
      </div>
      <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4 text-center">
        <p className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-1">Clusters</p>
        <p className="font-mono text-[24px] font-bold text-wp-text">{briefing.total_clusters}</p>
      </div>
      <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4 text-center">
        <p className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-1">Period</p>
        <p className="font-mono text-[24px] font-bold text-wp-text">{briefing.period_hours}h</p>
      </div>
      <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4 text-center">
        <p className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-1">Categories</p>
        <p className="font-mono text-[24px] font-bold text-wp-text">{briefing.category_breakdown.length}</p>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function BriefingsPage() {
  const [briefing, setBriefing]   = useState<DailyBriefing | null>(null)
  const [history, setHistory]     = useState<BriefingHistoryItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [hours, setHours]         = useState(24)
  const [generating, setGenerating] = useState(false)

  const fetchBriefing = useCallback(async (h: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/v1/briefings/daily?hours=${h}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `Failed to load briefing (${res.status})`)
      }
      const d = await res.json()
      setBriefing(d.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/briefings/history`)
      if (res.ok) {
        const d = await res.json()
        setHistory(d.data ?? [])
      }
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => {
    fetchBriefing(hours)
    fetchHistory()
  }, [fetchBriefing, fetchHistory, hours])

  const handleRefresh = async () => {
    setGenerating(true)
    await fetchBriefing(hours)
    await fetchHistory()
    setGenerating(false)
  }

  return (
    <div className="min-h-screen bg-wp-bg">
      {/* Header */}
      <div className="border-b border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="text-wp-text3 hover:text-wp-text text-[13px] transition-colors"
                >
                  ← Back
                </Link>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-wp-amber animate-pulse" />
                  <h1 className="font-mono text-[18px] font-bold text-wp-text tracking-tight">
                    Intelligence Briefing
                  </h1>
                </div>
              </div>
              {briefing && (
                <p className="text-[12px] text-wp-text3 mt-1 ml-[72px] sm:ml-0">
                  {fmtDate(briefing.date)} · Generated {fmtTime(briefing.generated_at)} · Model: {briefing.model}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Period selector */}
              <div className="flex rounded-lg border border-[rgba(255,255,255,0.1)] overflow-hidden">
                {[12, 24, 48, 72].map(h => (
                  <button
                    key={h}
                    onClick={() => setHours(h)}
                    className={`px-3 py-1.5 text-[11px] font-mono transition-all ${
                      hours === h
                        ? 'bg-wp-amber text-[#0d1117] font-bold'
                        : 'text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.06)]'
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>

              {/* Refresh button */}
              <button
                onClick={handleRefresh}
                disabled={generating || loading}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[rgba(245,166,35,0.15)] border border-[rgba(245,166,35,0.3)] text-wp-amber text-[12px] font-mono font-semibold hover:bg-[rgba(245,166,35,0.25)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className={generating ? 'animate-spin' : ''}>⟳</span>
                {generating ? 'Generating...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Main Content */}
          <div className="flex-1 min-w-0 space-y-6">
            {loading ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array(4).fill(0).map((_, i) => (
                    <div key={i} className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4 animate-pulse">
                      <div className="h-3 w-1/2 bg-[rgba(255,255,255,0.08)] rounded mx-auto mb-2" />
                      <div className="h-7 w-1/3 bg-[rgba(255,255,255,0.06)] rounded mx-auto" />
                    </div>
                  ))}
                </div>
                <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6">
                  <SkeletonBlock />
                </div>
                <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-6">
                  <SkeletonBlock />
                  <div className="mt-6"><SkeletonBlock /></div>
                </div>
              </>
            ) : error ? (
              <div className="glass border border-[rgba(255,59,92,0.2)] rounded-xl p-8 text-center">
                <p className="text-wp-red text-[14px] mb-3">{error}</p>
                <button
                  onClick={() => fetchBriefing(hours)}
                  className="px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.12)] text-wp-text text-[13px] hover:bg-[rgba(255,255,255,0.12)] transition-all"
                >
                  Retry
                </button>
              </div>
            ) : briefing ? (
              <>
                <BriefingStats briefing={briefing} />
                <ExecutiveSummarySection text={briefing.executive_summary} />
                <KeyDevelopmentsSection developments={briefing.key_developments} />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <CategoryBreakdownSection categories={briefing.category_breakdown} />
                  <GeographicHotspotsSection hotspots={briefing.geographic_hotspots} />
                </div>

                <ThreatAssessmentSection text={briefing.threat_assessment} />
                <OutlookSection text={briefing.outlook} />
                <TopSignalsSection signals={briefing.top_signals} />
              </>
            ) : (
              <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-8 text-center">
                <p className="text-[14px] text-wp-text2 mb-2">No briefing available</p>
                <p className="text-[12px] text-wp-text3">Click Refresh to generate today&apos;s intelligence briefing</p>
              </div>
            )}
          </div>

          {/* Sidebar — history */}
          <div className="w-full lg:w-[260px] shrink-0">
            <HistorySidebar
              items={history}
              activeId={briefing?.id ?? null}
              onSelect={(id) => {
                const found = history.find(h => h.id === id)
                if (found) {
                  // For now, refetch daily with the date's period
                  fetchBriefing(24)
                }
              }}
            />

            {/* Pro CTA */}
            <div className="mt-4 glass border border-[rgba(245,166,35,0.2)] rounded-xl p-4 bg-[rgba(245,166,35,0.04)]">
              <p className="font-mono text-[10px] tracking-widest uppercase text-wp-amber mb-2">
                WorldPulse Pro
              </p>
              <p className="text-[12px] text-wp-text2 mb-3 leading-relaxed">
                Get briefings for up to 72 hours, custom category filters, and email delivery every morning.
              </p>
              <Link
                href="/developers#pricing"
                className="inline-block px-4 py-1.5 rounded-lg bg-wp-amber text-[#0d1117] text-[11px] font-mono font-bold hover:brightness-110 transition-all"
              >
                Upgrade to Pro
              </Link>
            </div>

            {/* Open source callout */}
            <div className="mt-4 glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
              <p className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-2">
                Open Source
              </p>
              <p className="text-[12px] text-wp-text3 leading-relaxed">
                WorldPulse briefings are AI-generated from verified signals — fully transparent, auditable, and self-hostable.
                No other news intelligence platform offers this.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
