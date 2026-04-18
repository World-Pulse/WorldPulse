'use client'

/**
 * Space Weather Intelligence Page
 *
 * Displays real-time space weather data from NOAA Space Weather Prediction
 * Center (geomagnetic storms, solar radiation, radio blackouts) and CelesTrak
 * satellite activity (launches, re-entries, decay events).
 *
 * Data is served by /api/v1/space-weather/{recent,summary}.
 */

import { useEffect, useState, useCallback } from 'react'
import { Satellite } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.world-pulse.io'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpaceWeatherEvent {
  id:                string
  title:             string
  summary:           string
  severity:          string
  published_at:      string
  reliability_score: number
  source_slug:       string
  source_url:        string | null
  lat:               number | null
  lng:               number | null
}

interface SpaceWeatherSummary {
  geomagnetic_level:     number
  solar_radiation_level: number
  radio_blackout_level:  number
  active_events:         number
  latest_at:             string | null
  satellite_events_24h:  number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HOURS_OPTIONS = [
  { label: '24h', value: 24  },
  { label: '48h', value: 48  },
  { label: '7d',  value: 168 },
]

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
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
}

/** Human-readable labels for G/R/S scale levels */
const SCALE_LABEL: Record<number, string> = {
  0: 'None',
  1: 'Minor',
  2: 'Moderate',
  3: 'Strong',
  4: 'Severe',
  5: 'Extreme',
}

/** Color for a given scale level 0–5 */
function levelColor(level: number): string {
  if (level === 0) return '#4ade80'     // green
  if (level <= 2)  return '#fbbf24'     // yellow
  if (level === 3) return '#f5a623'     // orange
  return '#ff3b5c'                      // red (4-5)
}

function levelBg(level: number): string {
  if (level === 0) return 'rgba(74,222,128,0.10)'
  if (level <= 2)  return 'rgba(251,191,36,0.10)'
  if (level === 3) return 'rgba(245,166,35,0.12)'
  return 'rgba(255,59,92,0.12)'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityPill({ severity }: { severity: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider"
      style={{
        color:      SEV_COLOR[severity] ?? '#8892a4',
        background: SEV_BG[severity]    ?? SEV_BG.low,
      }}
    >
      {SEV_LABEL[severity] ?? severity.toUpperCase()}
    </span>
  )
}

function SourceBadge({ slug }: { slug: string }) {
  const label  = slug === 'celestrak' ? 'CelesTrak' : 'NOAA'
  const color  = slug === 'celestrak' ? '#64b5f6' : '#a78bfa'
  const bg     = slug === 'celestrak' ? 'rgba(100,181,246,0.10)' : 'rgba(167,139,250,0.10)'
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  )
}

function StormLevelCard({
  label,
  scale,
  level,
  loading,
}: {
  label:   string
  scale:   string
  level:   number
  loading: boolean
}) {
  const color = levelColor(level)
  const bg    = levelBg(level)
  return (
    <div
      className="rounded-xl border border-white/[0.08] p-5 flex flex-col gap-2"
      style={{ background: bg, borderColor: level > 0 ? `${color}30` : undefined }}
    >
      <div className="text-xs font-semibold text-wp-text3 uppercase tracking-wider">{label}</div>
      {loading ? (
        <div className="h-10 w-16 rounded animate-pulse bg-white/[0.06]" />
      ) : (
        <div className="flex items-end gap-3">
          <span className="text-5xl font-bold font-mono" style={{ color }}>
            {scale}{level}
          </span>
          <span className="text-sm pb-1" style={{ color }}>
            {SCALE_LABEL[level] ?? 'Unknown'}
          </span>
        </div>
      )}
      {!loading && level === 0 && (
        <div className="text-[11px] text-green-400">All clear</div>
      )}
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 animate-pulse h-20" />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpaceWeatherPage() {
  const [events,      setEvents]      = useState<SpaceWeatherEvent[]>([])
  const [summary,     setSummary]     = useState<SpaceWeatherSummary | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [hours,       setHours]       = useState(48)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async (h: number) => {
    setLoading(true)
    setError(null)
    try {
      const [recentRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/space-weather/recent?hours=${h}&limit=100`, { cache: 'no-store' }),
        fetch(`${API_URL}/api/v1/space-weather/summary`, { cache: 'no-store' }),
      ])
      if (!recentRes.ok || !summaryRes.ok) {
        throw new Error('Failed to load space weather data')
      }
      const [recentJson, summaryJson] = await Promise.all([recentRes.json(), summaryRes.json()])
      setEvents((recentJson?.data?.events as SpaceWeatherEvent[]) ?? [])
      setSummary((summaryJson?.data as SpaceWeatherSummary) ?? null)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(hours)
    const interval = setInterval(() => void fetchData(hours), 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [hours, fetchData])

  const spaceweatherEvents = events.filter(e => e.source_slug === 'spaceweather')
  const celestrakEvents    = events.filter(e => e.source_slug === 'celestrak')
  const allClear = !loading && events.length === 0

  return (
    <div className="min-h-screen bg-[#06070d] text-white">

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.08] px-4 py-4 md:px-8">
        <div className="mx-auto max-w-6xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Satellite className="w-6 h-6 text-cyan-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Space Weather Intelligence</h1>
              <p className="text-sm text-wp-text2 mt-0.5">
                Real-time geomagnetic storms, solar radiation & satellite activity via NOAA SWPC
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

        {/* ─── Storm Level Dashboard ────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold text-wp-text3 uppercase tracking-wider mb-3">
            Current Storm Levels
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StormLevelCard
              label="Geomagnetic"
              scale="G"
              level={summary?.geomagnetic_level ?? 0}
              loading={loading}
            />
            <StormLevelCard
              label="Solar Radiation"
              scale="S"
              level={summary?.solar_radiation_level ?? 0}
              loading={loading}
            />
            <StormLevelCard
              label="Radio Blackout"
              scale="R"
              level={summary?.radio_blackout_level ?? 0}
              loading={loading}
            />
          </div>
        </section>

        {/* ─── Stats bar ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Events (24h)',  value: summary?.active_events ?? 0,         color: '#e2e8f0' },
            { label: 'NOAA Alerts',          value: spaceweatherEvents.length,            color: '#a78bfa' },
            { label: 'Satellite Events',     value: summary?.satellite_events_24h ?? 0,  color: '#64b5f6' },
            { label: 'Events in Window',     value: events.length,                        color: '#f5a623' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="text-2xl font-bold font-mono" style={{ color: stat.color }}>
                {loading ? '—' : stat.value}
              </div>
              <div className="text-xs text-wp-text3 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ─── Time window selector ─────────────────────────────────────── */}
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

        {/* ─── All Clear state ──────────────────────────────────────────── */}
        {allClear && !error && (
          <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-6 text-center">
            <div className="text-3xl mb-2">🌟</div>
            <div className="font-semibold text-green-400">Space Weather All Clear</div>
            <div className="text-sm text-wp-text3 mt-1">
              No active geomagnetic storms, solar radiation events, or radio blackouts detected
            </div>
          </div>
        )}

        {/* ─── Event Timeline (NOAA) ────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-wp-text2 mb-3 uppercase tracking-wider">
            Event Timeline
          </h2>

          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          )}

          {!loading && spaceweatherEvents.length === 0 && !error && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center text-wp-text3 text-sm">
              No NOAA space weather events in the selected time window.
            </div>
          )}

          {!loading && spaceweatherEvents.length > 0 && (
            <div className="space-y-2">
              {spaceweatherEvents.map(ev => (
                <div
                  key={ev.id}
                  className={`rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 transition-colors ${
                    ev.source_url ? 'hover:bg-white/[0.05] cursor-pointer' : ''
                  }`}
                  onClick={() => ev.source_url && window.open(ev.source_url, '_blank', 'noopener,noreferrer')}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg mt-0.5">🌞</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <SeverityPill severity={ev.severity} />
                        <SourceBadge slug={ev.source_slug} />
                        <span className="text-xs text-wp-text3">{timeAgo(ev.published_at)}</span>
                        {ev.reliability_score > 0 && (
                          <span className="text-xs text-wp-text3">
                            · {Math.round(ev.reliability_score * 100)}% confidence
                          </span>
                        )}
                      </div>
                      <div className="font-medium text-sm text-white leading-snug">{ev.title}</div>
                      {ev.summary && (
                        <p className="text-xs text-wp-text2 mt-1 line-clamp-2">{ev.summary}</p>
                      )}
                    </div>
                    {ev.source_url && (
                      <span className="text-xs text-wp-text3 hover:text-wp-text2 shrink-0 mt-0.5">
                        ↗
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── Satellite Activity ───────────────────────────────────────── */}
        {(loading || celestrakEvents.length > 0) && (
          <section>
            <h2 className="text-sm font-semibold text-wp-text2 mb-3 uppercase tracking-wider">
              Satellite Activity (CelesTrak)
            </h2>

            {loading && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            )}

            {!loading && celestrakEvents.length > 0 && (
              <div className="space-y-2">
                {celestrakEvents.map(ev => (
                  <div
                    key={ev.id}
                    className={`rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 transition-colors ${
                      ev.source_url ? 'hover:bg-white/[0.05] cursor-pointer' : ''
                    }`}
                    onClick={() => ev.source_url && window.open(ev.source_url, '_blank', 'noopener,noreferrer')}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-lg mt-0.5">🛰️</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <SeverityPill severity={ev.severity} />
                          <SourceBadge slug={ev.source_slug} />
                          <span className="text-xs text-wp-text3">{timeAgo(ev.published_at)}</span>
                        </div>
                        <div className="font-medium text-sm text-white leading-snug">{ev.title}</div>
                        {ev.summary && (
                          <p className="text-xs text-wp-text2 mt-1 line-clamp-2">{ev.summary}</p>
                        )}
                      </div>
                      {ev.source_url && (
                        <span className="text-xs text-wp-text3 hover:text-wp-text2 shrink-0 mt-0.5">
                          ↗
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ─── About NOAA SWPC ─────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-wp-text3 uppercase tracking-wider mb-2">
            About this data
          </h3>
          <p className="text-xs text-wp-text3 leading-relaxed">
            Space weather data is sourced from the{' '}
            <a
              href="https://www.swpc.noaa.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-wp-text2 hover:text-white underline"
            >
              NOAA Space Weather Prediction Center (SWPC)
            </a>
            , which monitors and forecasts solar and geophysical events. Geomagnetic storms
            (G1–G5) can disrupt power grids, satellites, and HF radio communications. Solar
            radiation storms (S1–S5) affect spacecraft and high-latitude aviation. Radio
            blackouts (R1–R5) impact shortwave and GPS signals. Satellite tracking data
            (launches, re-entries, decay) is provided by{' '}
            <a
              href="https://celestrak.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-wp-text2 hover:text-white underline"
            >
              CelesTrak
            </a>
            .
          </p>
        </section>

      </div>
    </div>
  )
}
