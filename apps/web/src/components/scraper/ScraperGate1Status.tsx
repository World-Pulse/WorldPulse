'use client'

/**
 * ScraperGate1Status
 *
 * Self-polling component that shows the Gate 1 scraper stability clock.
 * Polls GET /api/v1/admin/scraper/stability every 60 seconds.
 *
 * Gate 1 requires 336 consecutive clean hours (14 days) before launch.
 * A clean hour = ≥70% of OSINT sources active + zero unhandled exceptions.
 */

import { useState, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const POLL_INTERVAL_MS = 60_000

export interface StabilityData {
  consecutive_clean_hours:   number
  target_hours:              number
  percent_to_gate:           number
  status:                    'stable' | 'degraded' | 'failed'
  last_failure_at:           string | null
  estimated_gate_clear_date: string | null
}

const STATUS_COLOR: Record<StabilityData['status'], string> = {
  stable:   'text-[#00e676]',
  degraded: 'text-wp-amber',
  failed:   'text-wp-red',
}

const STATUS_BAR_COLOR: Record<StabilityData['status'], string> = {
  stable:   'bg-[#00e676]',
  degraded: 'bg-wp-amber',
  failed:   'bg-wp-red',
}

const STATUS_BORDER: Record<StabilityData['status'], string> = {
  stable:   'border-[rgba(0,230,118,0.25)]',
  degraded: 'border-[rgba(255,255,255,0.07)]',
  failed:   'border-[rgba(255,59,92,0.3)]',
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSec < 60)    return `${diffSec}s ago`
  if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

interface Props {
  /** Bearer token for the admin API. If omitted, the component renders a login prompt. */
  token?: string | null
  /** Optional CSS class added to the outermost container. */
  className?: string
}

export function ScraperGate1Status({ token, className = '' }: Props) {
  const [data,       setData]       = useState<StabilityData | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [lastPolled, setLastPolled] = useState<Date | null>(null)

  const fetchStability = useCallback(async () => {
    if (!token) { setLoading(false); return }
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/scraper/stability`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; data: StabilityData; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stability data')
    } finally {
      setLoading(false)
      setLastPolled(new Date())
    }
  }, [token])

  // Initial fetch
  useEffect(() => { fetchStability() }, [fetchStability])

  // Poll every 60 seconds
  useEffect(() => {
    const id = setInterval(fetchStability, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStability])

  // ── No token ───────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className={`glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 ${className}`}>
        <p className="text-[13px] text-wp-text2">Admin token required to view Gate 1 status.</p>
      </div>
    )
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 animate-pulse ${className}`}>
        <div className="h-3 w-1/3 bg-[rgba(255,255,255,0.08)] rounded mb-4" />
        <div className="h-2.5 w-full bg-[rgba(255,255,255,0.06)] rounded-full mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 h-16" />
          ))}
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={`glass border border-[rgba(255,59,92,0.3)] rounded-xl px-5 py-4 ${className}`}>
        <p className="text-[13px] text-wp-red">{error}</p>
        <button
          onClick={fetchStability}
          className="mt-2 text-[12px] font-mono text-wp-amber hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const statusColor  = STATUS_COLOR[data.status]
  const barColor     = STATUS_BAR_COLOR[data.status]
  const borderColor  = STATUS_BORDER[data.status]
  const hoursLeft    = Math.max(0, data.target_hours - data.consecutive_clean_hours)

  return (
    <div className={`glass border ${borderColor} rounded-xl p-5 ${className}`}>

      {/* Header row */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-wp-text3 uppercase tracking-widest">
            Gate 1 — Stability Clock
          </span>
          {/* Status badge */}
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border ${statusColor} ${borderColor}`}
            role="status"
            aria-label={`Stability status: ${data.status}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${barColor}`} />
            {data.status.toUpperCase()}
          </span>
        </div>
        {lastPolled && (
          <span className="text-[10px] font-mono text-wp-text3">
            polled {timeAgo(lastPolled.toISOString())}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-4" role="progressbar" aria-valuenow={data.percent_to_gate} aria-valuemin={0} aria-valuemax={100}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[12px] font-mono text-wp-text2">
            {data.consecutive_clean_hours} / {data.target_hours} clean hours
          </span>
          <span className={`text-[12px] font-mono font-semibold ${statusColor}`}>
            {data.percent_to_gate}%
          </span>
        </div>
        <div className="h-2.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-700`}
            style={{ width: `${data.percent_to_gate}%` }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

        <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
          <p className="text-[10px] font-mono text-wp-text3 uppercase tracking-wider mb-1">Clean Hours</p>
          <p className="text-[22px] font-mono font-semibold text-wp-text leading-none">
            {data.consecutive_clean_hours}
          </p>
          <p className="text-[10px] font-mono text-wp-text3 mt-0.5">of {data.target_hours} target</p>
        </div>

        <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
          <p className="text-[10px] font-mono text-wp-text3 uppercase tracking-wider mb-1">Hours Left</p>
          <p className={`text-[22px] font-mono font-semibold leading-none ${hoursLeft === 0 ? 'text-[#00e676]' : 'text-wp-text'}`}>
            {hoursLeft}
          </p>
          <p className="text-[10px] font-mono text-wp-text3 mt-0.5">
            {hoursLeft === 0 ? 'GATE CLEARED' : `≈ ${Math.ceil(hoursLeft / 24)}d remaining`}
          </p>
        </div>

        <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
          <p className="text-[10px] font-mono text-wp-text3 uppercase tracking-wider mb-1">Est. Gate Clear</p>
          <p className="text-[12px] font-mono text-wp-text leading-snug mt-1">
            {fmtDate(data.estimated_gate_clear_date)}
          </p>
        </div>

        <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
          <p className="text-[10px] font-mono text-wp-text3 uppercase tracking-wider mb-1">Last Failure</p>
          <p className="text-[12px] font-mono text-wp-text leading-snug mt-1">
            {timeAgo(data.last_failure_at)}
          </p>
        </div>

      </div>
    </div>
  )
}
