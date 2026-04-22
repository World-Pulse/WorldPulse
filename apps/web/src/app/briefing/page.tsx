'use client'

import { useEffect, useState, useCallback } from 'react'
import { Inbox, FileText, Clock, MapPin, RefreshCw, Share2, Check, Moon, TrendingUp, AlertTriangle, Globe } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PulseBriefing {
  id: string
  content: string
  created_at: string
  pulse_content_type: string
  tags: string[] | null
}

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

interface MorningBriefingEvent {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  reliabilityScore: number
  sourceCount: number
  locationName: string | null
  countryCode: string | null
  alertTier: string | null
  createdAt: string
  isEscalating: boolean
}

interface MorningBriefing {
  date: string
  generatedAt: string
  timezone: string
  overnightWindow: { start: string; end: string }
  executiveSummary: string
  eventCount: number
  events: MorningBriefingEvent[]
  escalatingStories: Array<{ category: string; region: string | null; reason: string | null }>
  severityBreakdown: { critical: number; high: number; medium: number; low: number }
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

/** Parse PULSE briefing content into structured sections */
function parseBriefingContent(raw: string): { header: string; body: string } {
  // Strip the leading header line (bracket or emoji format) and trailing signature
  const lines = raw.split('\n')
  let headerEnd = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (
      line.match(/^\[?(DAILY BRIEFING|FLASH BRIEF|ANALYSIS|MID-DAY UPDATE|EVENING WRAP|FACT CHECK)/i) ||
      line.match(/^(EXECUTIVE SUMMARY|SECTION)/i) ||
      line.match(/^[\u{1F4CB}\u{1F4CA}\u{26A1}\u{1F4DD}\u{1F50D}\u{1F504}\u{1F319}]/u)
    ) {
      headerEnd = i + 1
      continue
    }
    if (line.trim()) break
  }

  // Remove trailing signature line
  let bodyEnd = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.match(/^\u2014\s*PULSE/)) {
      bodyEnd = i
      break
    }
    if (lines[i]?.trim()) break
  }

  const header = lines.slice(0, Math.max(headerEnd, 1)).join('\n')
    .replace(/^[\u{1F4CB}\u{1F4CA}\u{1F4DD}\u{26A1}\u{1F50D}\u{1F504}\u{1F319}]\s*/u, '')
    .replace(/^\[.*?\]\s*/, '')
    .trim()
  const body = lines.slice(headerEnd, bodyEnd).join('\n').trim()

  return { header: header || 'Daily Intelligence Briefing', body }
}

/** Render markdown-like text with bold headers */
function BriefingBody({ text }: { text: string }) {
  const sections = text.split(/\n(?=\*\*[^*]+\*\*)/).filter(Boolean)

  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const headerMatch = section.match(/^\*\*([^*]+)\*\*\s*/)
        if (headerMatch) {
          const title = headerMatch[1]
          const content = section.slice(headerMatch[0].length).trim()
          return (
            <div key={i}>
              <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-2">
                {title}
              </h3>
              <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
                {content}
              </div>
            </div>
          )
        }
        // Bullet points or plain text
        return (
          <div key={i} className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
            {section}
          </div>
        )
      })}
    </div>
  )
}

// ─── Morning Briefing Card ───────────────────────────────────────────────────

function MorningBriefingCard({ briefing }: { briefing: MorningBriefing }) {
  return (
    <div className="space-y-4 mb-8">
      {/* Executive Summary Card */}
      <div className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-indigo-950/30 border border-indigo-500/20 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <Moon className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-bold text-zinc-100">What Happened While You Slept</h2>
          <span className="text-xs text-zinc-500 ml-auto">
            {briefing.timezone} &middot; {briefing.eventCount} events
          </span>
        </div>
        {briefing.executiveSummary && (
          <p className="text-sm text-zinc-300 leading-relaxed mb-4">
            {briefing.executiveSummary}
          </p>
        )}

        {/* Severity mini-stats */}
        <div className="flex gap-3 text-xs">
          {briefing.severityBreakdown.critical > 0 && (
            <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-2.5 py-0.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {briefing.severityBreakdown.critical} Critical
            </span>
          )}
          {briefing.severityBreakdown.high > 0 && (
            <span className="inline-flex items-center gap-1 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-full px-2.5 py-0.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              {briefing.severityBreakdown.high} High
            </span>
          )}
          {briefing.severityBreakdown.medium > 0 && (
            <span className="inline-flex items-center gap-1 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-full px-2.5 py-0.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              {briefing.severityBreakdown.medium} Medium
            </span>
          )}
        </div>
      </div>

      {/* Escalating Stories */}
      {briefing.escalatingStories.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-red-400" />
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Escalating Stories</span>
          </div>
          <div className="space-y-1.5">
            {briefing.escalatingStories.map((story, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="text-zinc-300">
                  <span className="capitalize font-medium text-red-300">{story.category}</span>
                  {story.region && <span className="text-zinc-500"> in {story.region}</span>}
                  {story.reason && <span className="text-zinc-500"> — {story.reason}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overnight Events */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
          Overnight Events
          <span className="bg-zinc-800 text-zinc-400 rounded-full px-2 py-0.5 text-xs font-mono">
            {briefing.events.length}
          </span>
        </h3>
        {briefing.events.map((event) => (
          <a
            key={event.id}
            href={`/signals/${event.id}`}
            className="block bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <SeverityBadge severity={event.severity} />
                  {event.isEscalating && (
                    <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-2 py-0.5 text-xs font-semibold">
                      <TrendingUp className="w-3 h-3" />
                      ESCALATING
                    </span>
                  )}
                  {event.sourceCount > 1 && (
                    <span className="text-xs text-zinc-500 bg-zinc-800 rounded-full px-2 py-0.5">
                      {event.sourceCount} sources
                    </span>
                  )}
                </div>
                <h4 className="font-semibold text-zinc-100 leading-snug text-sm">
                  {event.title}
                </h4>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                  {event.locationName && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{event.locationName}
                    </span>
                  )}
                  <span>{timeAgo(event.createdAt)}</span>
                  <span className="capitalize">{event.category}</span>
                </div>
              </div>
              <div className="shrink-0">
                <ReliabilityDots score={event.reliabilityScore} />
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BriefingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Narrative skeleton */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div className="h-5 w-48 bg-zinc-800 rounded" />
        <div className="h-3 w-full bg-zinc-800 rounded" />
        <div className="h-3 w-full bg-zinc-800 rounded" />
        <div className="h-3 w-3/4 bg-zinc-800 rounded" />
        <div className="h-3 w-full bg-zinc-800 rounded" />
        <div className="h-3 w-5/6 bg-zinc-800 rounded" />
      </div>
      {/* Stats skeleton */}
      <div className="flex gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 flex-1 bg-zinc-800 rounded-xl" />
        ))}
      </div>
      {/* Signals skeleton */}
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
  const [morningBriefing, setMorningBriefing] = useState<MorningBriefing | null>(null)
  const [pulseBriefing, setPulseBriefing] = useState<PulseBriefing | null>(null)
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
      // Fetch morning briefing, PULSE narrative, and signal breakdown in parallel
      const params = new URLSearchParams()
      if (category) params.set('category', category)

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

      const [morningRes, pulseRes, signalRes] = await Promise.all([
        fetch(`${apiBase}/api/v1/pulse/briefing?tz=${encodeURIComponent(tz)}`).catch(() => null),
        fetch(`${apiBase}/api/v1/pulse/latest?content_type=daily_briefing`).catch(() => null),
        fetch(`${apiBase}/api/v1/briefing/daily?${params.toString()}`),
      ])

      // Parse morning briefing (non-critical)
      if (morningRes?.ok) {
        try {
          const morningJson = await morningRes.json()
          if (morningJson.success && morningJson.briefing) {
            setMorningBriefing(morningJson.briefing)
          }
        } catch { /* non-critical */ }
      }

      // Parse PULSE narrative (non-critical — page works without it)
      if (pulseRes?.ok) {
        const pulseJson = await pulseRes.json()
        if (pulseJson.success && pulseJson.data) {
          setPulseBriefing(pulseJson.data)
        }
      }

      // Parse signal breakdown
      if (!signalRes.ok) throw new Error(`API returned ${signalRes.status}`)
      const json = await signalRes.json() as { data: DailyBriefing }
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
  const parsed = pulseBriefing ? parseBriefingContent(pulseBriefing.content) : null

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-8">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <span>Daily Intelligence Briefing</span>
              <span className="text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                AI-Generated
              </span>
            </h1>
            {pulseBriefing ? (
              <p className="text-sm text-zinc-500 mt-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Generated {timeAgo(pulseBriefing.created_at)} by PULSE AI Bureau
              </p>
            ) : briefing ? (
              <p className="text-sm text-zinc-500 mt-1">
                {formatDate(briefing.date)} · generated {timeAgo(briefing.generated_at)}
              </p>
            ) : (
              <p className="text-sm text-zinc-500 mt-1">
                AI-authored intelligence from verified global signals
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
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Share2 className="w-3.5 h-3.5" /> Share</>}
            </button>

            {/* Refresh button */}
            <button
              onClick={fetchBriefing}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Loading...' : 'Refresh'}
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
        {loading && !briefing && !pulseBriefing && <BriefingSkeleton />}

        {/* ── No content empty state ── */}
        {!loading && !pulseBriefing && briefing && briefing.headline_count === 0 && (
          <div className="text-center py-16 text-zinc-500">
            <Inbox className="w-10 h-10 text-zinc-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-zinc-400">No signals for this period</p>
            <p className="text-sm mt-2">
              Try a different date or category, or check back later as new signals are verified.
            </p>
          </div>
        )}

        {/* ── Morning Briefing — "What happened while you slept" ── */}
        {morningBriefing && morningBriefing.events.length > 0 && (
          <MorningBriefingCard briefing={morningBriefing} />
        )}

        {/* ── PULSE Narrative Briefing ── */}
        {parsed && parsed.body ? (
          <div className="bg-zinc-900 border border-indigo-500/20 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-zinc-100">PULSE Briefing</h2>
              <span className="text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full font-medium">
                AI-Authored
              </span>
            </div>
            <BriefingBody text={parsed.body} />
          </div>
        ) : pulseBriefing && !loading ? (
          <div className="bg-zinc-900 border border-indigo-500/20 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-zinc-100">PULSE Briefing</h2>
              <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-medium">
                Generating
              </span>
            </div>
            <p className="text-sm text-zinc-400">
              PULSE is composing today&apos;s intelligence briefing. This typically takes a few minutes — refresh shortly.
            </p>
          </div>
        ) : null}

        {/* ── Signal Breakdown ── */}
        {briefing && briefing.headline_count > 0 && (
          <div className="space-y-6">

            {/* Section header for signals */}
            {parsed && (
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2 pt-2">
                Signal Breakdown
                <span className="bg-zinc-800 text-zinc-400 rounded-full px-2 py-0.5 text-xs font-mono">
                  {briefing.headline_count}
                </span>
              </h2>
            )}

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
                      <span className="text-zinc-500 text-xs">{loc.count}x</span>
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
                                <MapPin className="w-3 h-3" />{signal.location_name}
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
                Subscribe
              </a>
            </div>

            {/* Footer */}
            <p className="text-center text-xs text-zinc-600 pt-2 border-t border-zinc-800">
              WorldPulse Daily Intelligence Briefing · {briefing.date} · {briefing.headline_count} signals · Powered by PULSE AI
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
