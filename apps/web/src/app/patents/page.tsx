'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ScrollText, MapPin, SearchX } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatentSignal {
  id:               string
  title:            string
  summary:          string | null
  severity:         string
  category:         string
  reliability_score: number | null
  source_count:     number | null
  created_at:       string
  location_name:    string | null
  country_code:     string | null
}

interface CpcBreakdown {
  cpc_group: string
  label:     string
  count:     number
  max_severity: string
}

interface AssigneeRow {
  assignee:        string
  count:           number
  latest_severity: string
}

interface TimelinePoint {
  day:   string
  count: number
}

interface SeverityDist {
  severity: string
  count:    number
}

interface PatentsData {
  window:                string
  total_patents:         number
  severity_distribution: SeverityDist[]
  cpc_breakdown:         CpcBreakdown[]
  top_assignees:         AssigneeRow[]
  timeline:              TimelinePoint[]
  recent_patents:        PatentSignal[]
  generated_at:          string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-wp-red',
  high:     'text-orange-400',
  medium:   'text-wp-amber',
  low:      'text-yellow-300',
  info:     'text-wp-text3',
}

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-red-500/20 border-red-500/40 text-red-400',
  high:     'bg-orange-500/20 border-orange-500/40 text-orange-400',
  medium:   'bg-amber-500/20 border-amber-500/40 text-amber-400',
  low:      'bg-yellow-500/20 border-yellow-500/40 text-yellow-300',
  info:     'bg-zinc-500/20 border-zinc-500/40 text-zinc-400',
}

const CPC_LABELS: Record<string, string> = {
  'F41':    'WPN',   // Weapons
  'F42':    'AMM',   // Ammunition
  'B64C30': 'AIR',   // Military Aircraft
  'B64G':   'SPC',   // Space
  'B63G':   'NAV',   // Naval
  'F42B15': 'MSL',   // Missiles
  'G01S':   'RDR',   // Radar
  'G21':    'NUC',   // Nuclear
  'G21J':   'NUC',   // Nuclear Explosives
  'H04K':   'EW',    // Electronic Warfare
  'H04L9':  'CRY',   // Crypto
  'B64U':   'UAV',   // UAVs
  'H01S':   'LAS',   // Lasers
  'G01V':   'ISR',   // Surveillance
  'H04N7':  'CAM',   // Cameras
}

const WINDOW_OPTIONS = ['7d', '14d', '30d', '90d'] as const
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

function reliabilityDots(score: number | null): string {
  if (score == null) return '\u25cb\u25cb\u25cb\u25cb\u25cb'
  const filled = Math.round(score * 5)
  return '\u25cf'.repeat(filled) + '\u25cb'.repeat(5 - filled)
}

function reliabilityColor(score: number | null): string {
  if (score == null) return 'text-wp-text3'
  if (score >= 0.9)  return 'text-wp-green'
  if (score >= 0.75) return 'text-wp-cyan'
  if (score >= 0.55) return 'text-wp-amber'
  return 'text-wp-red'
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4 animate-pulse">
      <div className="h-4 bg-wp-s3 rounded w-3/4 mb-2" />
      <div className="h-3 bg-wp-s3 rounded w-1/2 mb-3" />
      <div className="h-3 bg-wp-s3 rounded w-full" />
    </div>
  )
}

function SkeletonBar() {
  return <div className="h-8 bg-wp-s3 rounded animate-pulse mb-2" />
}

// ─── Severity Badge ──────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border ${SEVERITY_BG[severity] ?? SEVERITY_BG.info}`}>
      {severity}
    </span>
  )
}

// ─── Timeline Chart (simple SVG bar chart) ───────────────────────────────────

function TimelineChart({ data }: { data: TimelinePoint[] }) {
  if (data.length === 0) return <div className="text-wp-text3 text-xs py-8 text-center">No timeline data</div>

  const maxCount = Math.max(...data.map(d => d.count), 1)
  const barWidth = Math.max(4, Math.floor(600 / data.length) - 2)

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${data.length * (barWidth + 2)} 120`} className="w-full h-28" preserveAspectRatio="none">
        {data.map((d, i) => {
          const h = (d.count / maxCount) * 100
          return (
            <g key={d.day}>
              <rect
                x={i * (barWidth + 2)}
                y={110 - h}
                width={barWidth}
                height={h}
                rx={2}
                className="fill-cyan-500/60"
              />
              <title>{d.day}: {d.count} patents</title>
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-wp-text3 mt-1 px-1">
        <span>{data[0]?.day?.slice(5) ?? ''}</span>
        <span>{data[data.length - 1]?.day?.slice(5) ?? ''}</span>
      </div>
    </div>
  )
}

// ─── Severity Distribution Bar ───────────────────────────────────────────────

function SeverityBar({ distribution, total }: { distribution: SeverityDist[]; total: number }) {
  if (total === 0) return null

  const colors: Record<string, string> = {
    critical: '#ef4444',
    high:     '#f97316',
    medium:   '#eab308',
    low:      '#facc15',
    info:     '#71717a',
  }

  return (
    <div className="flex rounded-full overflow-hidden h-3 bg-wp-s3">
      {distribution.map(d => {
        const pct = (d.count / total) * 100
        if (pct < 0.5) return null
        return (
          <div
            key={d.severity}
            className="h-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: colors[d.severity] ?? '#71717a' }}
            title={`${d.severity}: ${d.count} (${pct.toFixed(1)}%)`}
          />
        )
      })}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PatentsPage() {
  const [data, setData] = useState<PatentsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [window, setWindow] = useState<Window>('30d')
  const [severityFilter, setSeverityFilter] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ window, limit: '100' })
      if (severityFilter) params.set('severity', severityFilter)
      const res = await fetch(`${API_URL}/api/v1/patents?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json() as PatentsData
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patent data')
    } finally {
      setLoading(false)
    }
  }, [window, severityFilter])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(fetchData, 300_000)
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      {/* Header */}
      <div className="border-b border-[rgba(255,255,255,0.07)] bg-wp-surface/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <ScrollText className="w-6 h-6 text-cyan-400" />
                <h1 className="font-display text-xl tracking-wide text-wp-text">Patent Intelligence</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-widest bg-cyan-500/20 border border-cyan-500/40 text-cyan-400">
                  DEFENSE & DUAL-USE
                </span>
              </div>
              <p className="text-wp-text3 text-sm mt-1 ml-10">
                USPTO defense, aerospace, military, and dual-use technology patent monitoring
              </p>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Window selector */}
              <div className="flex bg-wp-s2 rounded-lg border border-[rgba(255,255,255,0.06)] overflow-hidden">
                {WINDOW_OPTIONS.map(w => (
                  <button
                    key={w}
                    onClick={() => setWindow(w)}
                    className={`px-3 py-1.5 text-xs font-mono transition-colors ${
                      window === w
                        ? 'bg-wp-cyan/20 text-wp-cyan'
                        : 'text-wp-text3 hover:text-wp-text hover:bg-wp-s3'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>

              {/* Severity filter */}
              <div className="flex bg-wp-s2 rounded-lg border border-[rgba(255,255,255,0.06)] overflow-hidden">
                <button
                  onClick={() => setSeverityFilter(null)}
                  className={`px-3 py-1.5 text-xs font-mono transition-colors ${
                    !severityFilter
                      ? 'bg-wp-cyan/20 text-wp-cyan'
                      : 'text-wp-text3 hover:text-wp-text hover:bg-wp-s3'
                  }`}
                >
                  All
                </button>
                {['critical', 'high', 'medium', 'low'].map(s => (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className={`px-3 py-1.5 text-xs font-mono capitalize transition-colors ${
                      severityFilter === s
                        ? 'bg-wp-cyan/20 text-wp-cyan'
                        : 'text-wp-text3 hover:text-wp-text hover:bg-wp-s3'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {loading ? (
            <>
              <SkeletonBar />
              <SkeletonBar />
              <SkeletonBar />
              <SkeletonBar />
            </>
          ) : data ? (
            <>
              <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                <div className="text-wp-text3 text-[10px] font-mono uppercase tracking-widest mb-1">Total Patents</div>
                <div className="text-2xl font-display text-wp-text">{data.total_patents.toLocaleString()}</div>
                <div className="text-wp-text3 text-xs mt-1">in {data.window} window</div>
              </div>
              <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                <div className="text-wp-text3 text-[10px] font-mono uppercase tracking-widest mb-1">Critical</div>
                <div className="text-2xl font-display text-wp-red">
                  {data.severity_distribution.find(d => d.severity === 'critical')?.count ?? 0}
                </div>
                <div className="text-wp-text3 text-xs mt-1">WMD / nuclear / cyber</div>
              </div>
              <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                <div className="text-wp-text3 text-[10px] font-mono uppercase tracking-widest mb-1">CPC Categories</div>
                <div className="text-2xl font-display text-wp-cyan">{data.cpc_breakdown.length}</div>
                <div className="text-wp-text3 text-xs mt-1">defense technology areas</div>
              </div>
              <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                <div className="text-wp-text3 text-[10px] font-mono uppercase tracking-widest mb-1">Assignees</div>
                <div className="text-2xl font-display text-wp-amber">{data.top_assignees.length}</div>
                <div className="text-wp-text3 text-xs mt-1">defense contractors tracked</div>
              </div>
            </>
          ) : null}
        </div>

        {/* Severity Distribution */}
        {data && (
          <div className="mb-6">
            <SeverityBar distribution={data.severity_distribution} total={data.total_patents} />
            <div className="flex gap-4 mt-2 flex-wrap">
              {data.severity_distribution.map(d => (
                <div key={d.severity} className="flex items-center gap-1.5 text-xs">
                  <span className={`w-2 h-2 rounded-full ${
                    d.severity === 'critical' ? 'bg-red-500' :
                    d.severity === 'high' ? 'bg-orange-500' :
                    d.severity === 'medium' ? 'bg-amber-500' :
                    d.severity === 'low' ? 'bg-yellow-500' : 'bg-zinc-500'
                  }`} />
                  <span className="text-wp-text3 capitalize">{d.severity}</span>
                  <span className="text-wp-text font-mono">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column — Timeline + CPC Breakdown */}
          <div className="lg:col-span-1 space-y-6">
            {/* Timeline */}
            <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
              <h2 className="text-[11px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Patent Activity Timeline</h2>
              {loading ? (
                <div className="space-y-2">
                  <SkeletonBar />
                  <SkeletonBar />
                  <SkeletonBar />
                </div>
              ) : data ? (
                <TimelineChart data={data.timeline} />
              ) : null}
            </div>

            {/* CPC Breakdown */}
            <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
              <h2 className="text-[11px] font-mono text-wp-text3 uppercase tracking-widest mb-3">CPC Category Breakdown</h2>
              {loading ? (
                <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <SkeletonBar key={i} />)}</div>
              ) : data && data.cpc_breakdown.length > 0 ? (
                <div className="space-y-2">
                  {data.cpc_breakdown.map(cpc => (
                    <div key={cpc.cpc_group} className="flex items-center gap-2 group">
                      <span className="text-[9px] font-mono font-bold w-6 text-center text-wp-cyan">{CPC_LABELS[cpc.cpc_group] ?? '---'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-wp-text truncate">{cpc.label}</span>
                          <SeverityBadge severity={cpc.max_severity} />
                        </div>
                        <div className="text-[10px] font-mono text-wp-text3">{cpc.cpc_group}</div>
                      </div>
                      <span className="text-sm font-mono text-wp-cyan">{cpc.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-wp-text3 text-xs py-4 text-center">No CPC data available</div>
              )}
            </div>

            {/* Top Assignees */}
            <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
              <h2 className="text-[11px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Top Defense Contractors</h2>
              {loading ? (
                <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <SkeletonBar key={i} />)}</div>
              ) : data && data.top_assignees.length > 0 ? (
                <div className="space-y-2">
                  {data.top_assignees.slice(0, 10).map((a, i) => (
                    <div key={a.assignee} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-wp-text3 w-4 text-right">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-wp-text truncate block">{a.assignee}</span>
                      </div>
                      <SeverityBadge severity={a.latest_severity} />
                      <span className="text-sm font-mono text-wp-cyan">{a.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-wp-text3 text-xs py-4 text-center">No assignee data available</div>
              )}
            </div>
          </div>

          {/* Right Column — Recent Patents */}
          <div className="lg:col-span-2">
            <div className="bg-wp-s2 border border-[rgba(255,255,255,0.06)] rounded-xl">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                <h2 className="text-[11px] font-mono text-wp-text3 uppercase tracking-widest">Recent Patent Signals</h2>
                {data && (
                  <span className="text-[10px] font-mono text-wp-text3">
                    Updated {timeAgo(data.generated_at)} ago
                  </span>
                )}
              </div>

              <div className="divide-y divide-[rgba(255,255,255,0.04)]">
                {loading ? (
                  <div className="p-4 space-y-4">
                    {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
                  </div>
                ) : data && data.recent_patents.length > 0 ? (
                  data.recent_patents.map(p => (
                    <Link
                      key={p.id}
                      href={`/signals/${p.id}`}
                      className="block px-4 py-3 hover:bg-wp-s3/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Title */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <SeverityBadge severity={p.severity} />
                            {p.country_code && (
                              <span className="text-[10px] font-mono text-wp-text3 px-1.5 py-0.5 rounded bg-wp-s3">
                                {p.country_code}
                              </span>
                            )}
                            <span className="text-[10px] text-wp-text3">{timeAgo(p.created_at)}</span>
                          </div>
                          <h3 className="text-sm text-wp-text leading-snug mb-1">{p.title}</h3>

                          {/* Summary */}
                          {p.summary && (
                            <p className="text-xs text-wp-text3 line-clamp-2 mb-2">{p.summary}</p>
                          )}

                          {/* Meta row */}
                          <div className="flex items-center gap-3 text-[10px] text-wp-text3">
                            <span className={`font-mono ${reliabilityColor(p.reliability_score)}`}>
                              {reliabilityDots(p.reliability_score)}
                            </span>
                            {p.location_name && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 opacity-50" />
                                {p.location_name}
                              </span>
                            )}
                            {p.source_count != null && p.source_count > 0 && (
                              <span>{p.source_count} source{p.source_count !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="py-16 text-center">
                    <SearchX className="w-10 h-10 text-wp-text3 mx-auto mb-3" />
                    <div className="text-wp-text3 text-sm">No patent signals found for this window</div>
                    <div className="text-wp-text3 text-xs mt-1">Try a longer time window or clear severity filter</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
