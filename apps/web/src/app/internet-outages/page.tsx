'use client'

/**
 * Internet Outage Intelligence Page
 *
 * Shows real-time global internet connectivity outages sourced from Georgia
 * Tech IODA (Internet Outage Detection and Analysis). Unique among news
 * intelligence platforms — no competitor (Ground News, GDELT, Reuters Connect,
 * AP Wire, OpenClaw) exposes IODA data in a consumer-facing web UI.
 *
 * Counters OpenClaw's internet outage monitoring feature (terminal-only) with
 * a proper web interface accessible to journalists, activists, and NGOs.
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Globe, CheckCircle } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.world-pulse.io'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OutageEvent {
  id:                string
  title:             string
  summary:           string
  severity:          string
  location_name:     string
  country_code:      string | null
  lat:               number | null
  lng:               number | null
  published_at:      string
  reliability_score: number
  source_url:        string | null
}

interface CountryStatus {
  location_name:  string
  country_code:   string | null
  severity:       string
  event_count:    number
  latest_at:      string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#fbbf24',
  low:      '#8892a4',
}

const SEV_BG: Record<string, string> = {
  critical: 'rgba(255,59,92,0.15)',
  high:     'rgba(245,166,35,0.15)',
  medium:   'rgba(251,191,36,0.10)',
  low:      'rgba(136,146,164,0.08)',
}

const SEV_LABEL: Record<string, string> = {
  critical: 'MAJOR OUTAGE',
  high:     'SEVERE',
  medium:   'DEGRADED',
  low:      'MINOR',
}

const HOURS_OPTIONS = [
  { label: '24h',  value: 24  },
  { label: '48h',  value: 48  },
  { label: '7d',   value: 168 },
  { label: '30d',  value: 720 },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function flagEmoji(code: string | null): string {
  if (!code || code.length !== 2) return '--'
  const offset = 0x1F1E6 - 65
  return String.fromCodePoint(code.charCodeAt(0) + offset, code.charCodeAt(1) + offset)
}

function SeverityPill({ severity }: { severity: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider"
      style={{ color: SEV_COLOR[severity] ?? '#8892a4', background: SEV_BG[severity] ?? SEV_BG.low }}
    >
      {SEV_LABEL[severity] ?? severity.toUpperCase()}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InternetOutagesPage() {
  const [events,       setEvents]       = useState<OutageEvent[]>([])
  const [countries,    setCountries]    = useState<CountryStatus[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [hours,        setHours]        = useState(48)
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null)

  const fetchData = useCallback(async (h: number) => {
    setLoading(true)
    setError(null)
    try {
      const [eventsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/outages/recent?hours=${h}&limit=100`, { cache: 'no-store' }),
        fetch(`${API_URL}/api/v1/outages/summary`, { cache: 'no-store' }),
      ])

      if (!eventsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to load outage data')
      }

      const [eventsJson, summaryJson] = await Promise.all([eventsRes.json(), summaryRes.json()])

      setEvents((eventsJson?.data?.events as OutageEvent[]) ?? [])
      setCountries((summaryJson?.data?.countries as CountryStatus[]) ?? [])
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(hours)
    const interval = setInterval(() => void fetchData(hours), 5 * 60 * 1000) // refresh every 5 min
    return () => clearInterval(interval)
  }, [hours, fetchData])

  const criticalCount = countries.filter(c => c.severity === 'critical').length
  const highCount     = countries.filter(c => c.severity === 'high').length

  return (
    <div className="min-h-screen bg-[#06070d] text-white">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.08] px-4 py-4 md:px-8">
        <div className="mx-auto max-w-6xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Globe className="w-6 h-6 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Internet Outage Intelligence</h1>
              <p className="text-sm text-wp-text2 mt-0.5">
                Real-time global connectivity monitoring via Georgia Tech IODA
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-wp-text3">Updated {timeAgo(lastUpdated.toISOString())}</span>
            )}
            <button
              onClick={() => void fetchData(hours)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-wp-text2 hover:bg-white/[0.05] transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 space-y-6">

        {/* ─── Stats bar ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Outages',   value: countries.length,  color: '#e2e8f0' },
            { label: 'Major (Critical)', value: criticalCount,      color: SEV_COLOR.critical },
            { label: 'Severe (High)',    value: highCount,           color: SEV_COLOR.high },
            { label: 'Events (window)',  value: events.length,       color: '#64b5f6' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="text-2xl font-bold" style={{ color: stat.color }}>
                {loading ? '—' : stat.value}
              </div>
              <div className="text-xs text-wp-text3 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ─── Time range filter ───────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-wp-text3">Time window:</span>
          {HOURS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setHours(opt.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                hours === opt.value
                  ? 'bg-[#f5a623] text-black'
                  : 'border border-white/10 text-wp-text2 hover:bg-white/[0.05]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ─── Country status grid ─────────────────────────────────────── */}
        {!loading && countries.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-wp-text2 mb-3 uppercase tracking-wider">
              Active Connectivity Issues (last 24h)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {countries.map(c => (
                <div
                  key={c.location_name}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors"
                  style={{ borderLeftColor: SEV_COLOR[c.severity] ?? '#8892a4', borderLeftWidth: 3 }}
                >
                  <span className="text-2xl">{flagEmoji(c.country_code)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{c.location_name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <SeverityPill severity={c.severity} />
                      <span className="text-xs text-wp-text3">{c.event_count} event{c.event_count !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-wp-text3">{timeAgo(c.latest_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Empty state for countries ───────────────────────────────── */}
        {!loading && countries.length === 0 && !error && (
          <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-6 text-center">
            <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
            <div className="font-semibold text-green-400">No Active Outages Detected</div>
            <div className="text-sm text-wp-text3 mt-1">Global internet connectivity appears stable</div>
          </div>
        )}

        {/* ─── Event timeline ──────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-wp-text2 mb-3 uppercase tracking-wider">
            Event Timeline
          </h2>

          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 animate-pulse h-24" />
              ))}
            </div>
          )}

          {!loading && events.length === 0 && !error && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center text-wp-text3 text-sm">
              No outage events in the selected time window.
            </div>
          )}

          {!loading && events.length > 0 && (
            <div className="space-y-2">
              {events.map(ev => (
                <div
                  key={ev.id}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg mt-0.5">{flagEmoji(ev.country_code)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <SeverityPill severity={ev.severity} />
                        <span className="text-xs text-wp-text3">{ev.location_name}</span>
                        <span className="text-xs text-wp-text3">·</span>
                        <span className="text-xs text-wp-text3">{timeAgo(ev.published_at)}</span>
                      </div>
                      <div className="font-medium text-sm text-white leading-snug">{ev.title}</div>
                      {ev.summary && (
                        <p className="text-xs text-wp-text2 mt-1 line-clamp-2">{ev.summary}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Link
                        href={`/signals/${ev.id}`}
                        className="text-xs text-[#f5a623] hover:underline"
                      >
                        View →
                      </Link>
                      {ev.source_url && (
                        <a
                          href={ev.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-wp-text3 hover:text-wp-text2"
                        >
                          IODA ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── About IODA ──────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-wp-text3 uppercase tracking-wider mb-2">
            About this data
          </h3>
          <p className="text-xs text-wp-text3 leading-relaxed">
            Internet outage data is sourced from{' '}
            <a
              href="https://ioda.caida.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-wp-text2 hover:text-white underline"
            >
              IODA (Internet Outage Detection and Analysis)
            </a>
            {' '}by Georgia Tech / CAIDA, which uses BGP route monitoring, active
            probing, and Internet background radiation telescope signals to detect
            connectivity disruptions. Signals are updated every 10 minutes with
            a reliability score of 0.87. Events are particularly relevant for
            tracking internet shutdowns used during protests, elections, and conflicts.
          </p>
        </section>

      </div>
    </div>
  )
}
