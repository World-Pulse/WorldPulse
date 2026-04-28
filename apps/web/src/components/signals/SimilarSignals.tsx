'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimilarSignal {
  id:               string
  title:            string
  category:         string
  severity:         string
  reliabilityScore: number
  createdAt:        string | null
  score:            number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#fbbf24',
  low:      '#8892a4',
  info:     '#5a6477',
}

function timeAgo(d: string | null): string {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] animate-pulse space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-white/10 flex-shrink-0" />
        <div className="h-2 w-12 bg-white/10 rounded" />
        <div className="h-2 w-10 bg-white/10 rounded ml-auto" />
      </div>
      <div className="h-3 bg-white/10 rounded w-full" />
      <div className="h-3 bg-white/10 rounded w-3/4" />
    </div>
  )
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SimilarCard({ signal }: { signal: SimilarSignal }) {
  const color = SEV_COLOR[signal.severity] ?? '#8892a4'
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
        <span
          className="font-mono text-[9px] uppercase tracking-widest text-wp-text3 border border-white/10 rounded px-1"
          style={{ borderColor: 'rgba(255,255,255,0.08)' }}
        >
          {signal.category}
        </span>
        <span className="font-mono text-[9px] text-wp-text3 ml-auto">{timeAgo(signal.createdAt)}</span>
      </div>
      <p className="text-[12px] text-wp-text2 group-hover:text-wp-text leading-[1.5] line-clamp-2 transition-colors">
        {signal.title}
      </p>
      <div className="flex items-center gap-2 mt-1.5">
        <div className="flex-1 h-0.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(signal.reliabilityScore * 100)}%`,
              background: signal.reliabilityScore >= 0.7
                ? '#00e676'
                : signal.reliabilityScore >= 0.4
                  ? '#f5a623'
                  : '#ff3b5c',
            }}
          />
        </div>
        <span className="font-mono text-[9px] text-wp-text3">
          {Math.round(signal.reliabilityScore * 100)}%
        </span>
      </div>
    </Link>
  )
}

// ─── SimilarSignals ───────────────────────────────────────────────────────────

export default function SimilarSignals({ signalId }: { signalId: string }) {
  const [signals, setSignals] = useState<SimilarSignal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
    fetch(`${apiBase}/api/v1/signals/${signalId}/similar?limit=5`)
      .then(r => r.json())
      .then((data: { success?: boolean; similar?: SimilarSignal[] }) => {
        if (data.success && Array.isArray(data.similar)) {
          setSignals(data.similar)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [signalId])

  return (
    <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-3">
      <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
        Similar Signals
      </div>

      {loading && (
        <div className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && signals.length === 0 && (
        <p className="text-[12px] text-wp-text3 py-2">No similar signals found</p>
      )}

      {!loading && signals.length > 0 && (
        <div className="space-y-2">
          {signals.map(s => <SimilarCard key={s.id} signal={s} />)}
        </div>
      )}
    </div>
  )
}
