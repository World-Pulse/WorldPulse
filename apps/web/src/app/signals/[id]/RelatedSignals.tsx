'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CorrelatedSignal {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  reliabilityScore: number
  locationName: string | null
  sourceId: string
  createdAt: string | null
}

interface EventCluster {
  id: string
  primarySignalId: string
  correlationType: string
  correlationScore: number
  categories: string[]
  sourceCount: number
  signalCount: number
  createdAt: string
}

interface CorrelatedResponse {
  success: boolean
  data: {
    cluster: EventCluster | null
    signals: CorrelatedSignal[]
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high: '#f5a623',
  medium: '#fbbf24',
  low: '#8892a4',
  info: '#5a6477',
}

const CORRELATION_TYPE_LABEL: Record<string, string> = {
  geo_temporal: 'Same Place & Time',
  causal_chain: 'Cause → Effect',
  keyword_overlap: 'Related Topics',
  multi_factor: 'Multi-Factor',
}

const CORRELATION_TYPE_ICON: Record<string, string> = {
  geo_temporal: '📍',
  causal_chain: '🔗',
  keyword_overlap: '🏷️',
  multi_factor: '🧩',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d: string | null): string {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ─── Skeleton Loading ──────────────────────────────────────────────────────────

function RelatedSignalsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-4 bg-white/[0.07] rounded w-1/3 animate-pulse" />
      {[1, 2].map(i => (
        <div
          key={i}
          className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-2"
        >
          <div className="h-3 bg-white/[0.07] rounded animate-pulse" />
          <div className="h-2 bg-white/[0.07] rounded w-4/5 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

// ─── Related Signal Card ───────────────────────────────────────────────────────

function RelatedSignalCard({ signal }: { signal: CorrelatedSignal }) {
  const color = SEVERITY_COLOR[signal.severity] ?? '#8892a4'

  return (
    <Link
      href={`/signals/${signal.id}`}
      className="block p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-all group"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color }}>
          {signal.severity}
        </span>
        {signal.locationName && (
          <>
            <span className="font-mono text-[9px] text-wp-text3">·</span>
            <span className="font-mono text-[9px] text-wp-text3 truncate">{signal.locationName}</span>
          </>
        )}
        <span className="font-mono text-[9px] text-wp-text3 ml-auto shrink-0">{timeAgo(signal.createdAt)}</span>
      </div>
      <p className="text-[12px] text-wp-text2 group-hover:text-wp-text leading-[1.5] line-clamp-2 transition-colors">
        {signal.title}
      </p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px] text-wp-text3 capitalize bg-white/[0.05] px-1.5 py-0.5 rounded">
          {signal.category}
        </span>
        <span className="text-[10px] text-wp-green font-mono">
          {Math.round(signal.reliabilityScore * 100)}%
        </span>
      </div>
    </Link>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface RelatedSignalsProps {
  signalId: string
}

export function RelatedSignals({ signalId }: RelatedSignalsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [cluster, setCluster] = useState<EventCluster | null>(null)
  const [signals, setSignals] = useState<CorrelatedSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch correlated signals
  useEffect(() => {
    let isMounted = true
    let refreshInterval: NodeJS.Timeout | null = null

    async function fetchCorrelated() {
      if (!isOpen) return

      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`${API_BASE}/api/v1/signals/${encodeURIComponent(signalId)}/correlated`, {
          credentials: 'include',
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json = (await res.json()) as CorrelatedResponse
        if (!isMounted) return

        if (json.success) {
          setCluster(json.data.cluster)
          setSignals(json.data.signals || [])
        } else {
          setError('Failed to load related signals')
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch')
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    if (isOpen) {
      fetchCorrelated()
      // Auto-refresh every 5 minutes
      refreshInterval = setInterval(fetchCorrelated, 5 * 60 * 1000)
    }

    return () => {
      isMounted = false
      if (refreshInterval) clearInterval(refreshInterval)
    }
  }, [isOpen, signalId])

  // Don't render if no cluster and not loading
  if (!cluster && !loading && !isOpen) {
    return null
  }

  const correlationLabel =
    CORRELATION_TYPE_LABEL[cluster?.correlationType ?? ''] ?? cluster?.correlationType ?? 'Related'
  const correlationIcon = CORRELATION_TYPE_ICON[cluster?.correlationType ?? ''] ?? '🔗'

  return (
    <div className="space-y-2">
      {/* Header button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] transition-all text-left"
      >
        <div className="flex-1">
          <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
            Related Signals
          </div>
          {cluster && !loading && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-wp-text2">
                {cluster.signalCount} signal{cluster.signalCount !== 1 ? 's' : ''} in cluster
              </span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-widest text-wp-text3 bg-white/[0.05]"
                title={correlationLabel}
              >
                {correlationIcon} {correlationLabel}
              </span>
            </div>
          )}
        </div>
        <div className="text-wp-text3 ml-2 transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : '' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="space-y-3">
          {loading && signals.length === 0 ? (
            <RelatedSignalsSkeleton />
          ) : error ? (
            <div className="p-3 rounded-xl border border-wp-red/30 bg-wp-red/10 text-[12px] text-wp-red">
              {error}
            </div>
          ) : signals.length === 0 ? (
            <div className="p-3 rounded-xl border border-white/[0.07] bg-white/[0.02]">
              <p className="text-[12px] text-wp-text3">No related signals found in this event cluster</p>
            </div>
          ) : (
            <>
              {/* Cluster info badge */}
              {cluster && (
                <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-2">
                  <div className="text-[10px] text-wp-text3 font-mono uppercase tracking-widest">
                    Event Cluster
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-wp-text2">
                      Correlation Score
                    </span>
                    <span className="text-[12px] font-mono font-bold" style={{ color: SEVERITY_COLOR.high }}>
                      {Math.round(cluster.correlationScore * 100)}%
                    </span>
                  </div>
                  {cluster.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-2">
                      {cluster.categories.slice(0, 3).map(cat => (
                        <span
                          key={cat}
                          className="text-[9px] text-wp-text3 bg-white/[0.07] px-1.5 py-0.5 rounded capitalize"
                        >
                          {cat}
                        </span>
                      ))}
                      {cluster.categories.length > 3 && (
                        <span className="text-[9px] text-wp-text3">+{cluster.categories.length - 3} more</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Related signals list */}
              <div className="space-y-2">
                <div className="font-mono text-[9px] uppercase tracking-widest text-wp-text3 px-1">
                  {signals.length} Related
                </div>
                {signals.map(signal => (
                  <RelatedSignalCard key={signal.id} signal={signal} />
                ))}
              </div>

              {/* Link to full clusters page */}
              <Link
                href="/clusters"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 text-[10px] font-mono text-wp-text3 hover:border-white/20 hover:text-wp-text2 transition-all"
              >
                View all clusters
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
