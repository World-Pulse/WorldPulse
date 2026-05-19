'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface ThreadSignal {
  id: string
  title: string
  category: string
  severity: string
  location_name: string | null
  reliability_score: number
  source_count: number
  published_at: string
  created_at: string
  role: string | null
}

interface ThreadDetail {
  id: string
  title: string
  summary: string | null
  category: string
  region: string | null
  status: string
  peak_severity: string
  signal_count: number
  severity_trajectory: Array<{ timestamp: string; avg_severity_rank: number; signal_count: number }>
  related_entities: string[]
  last_updated: string
  created_at: string
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 border-red-400/30 bg-red-400/10',
  high:     'text-orange-400 border-orange-400/30 bg-orange-400/10',
  medium:   'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  low:      'text-green-400 border-green-400/30 bg-green-400/10',
}

const STATUS_COLORS: Record<string, string> = {
  escalating: 'text-red-400 bg-red-400/10 border-red-400/30',
  developing: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  stable:     'text-blue-400 bg-blue-400/10 border-blue-400/30',
  resolved:   'text-green-400 bg-green-400/10 border-green-400/30',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-green-400',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function ThreadDetailPage() {
  const params = useParams()
  const id = params?.id as string

  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [signals, setSignals] = useState<ThreadSignal[]>([])
  const [timeline, setTimeline] = useState<{ first_signal: string | null; latest_signal: string | null; duration_hours: number }>({
    first_signal: null, latest_signal: null, duration_hours: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`${API_URL}/api/v1/threads/${id}`)
      .then(res => {
        if (!res.ok) throw new Error('Thread not found')
        return res.json()
      })
      .then(data => {
        setThread(data.thread)
        setSignals(data.signals ?? [])
        setTimeline(data.timeline ?? { first_signal: null, latest_signal: null, duration_hours: 0 })
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-wp-bg flex items-center justify-center">
        <div className="text-wp-text3 text-sm font-mono">Loading thread...</div>
      </div>
    )
  }

  if (error || !thread) {
    return (
      <div className="min-h-screen bg-wp-bg flex flex-col items-center justify-center gap-4">
        <div className="text-wp-text3 text-sm">Thread not found</div>
        <Link href="/" className="text-wp-cyan text-sm hover:underline">Back to feed</Link>
      </div>
    )
  }

  const durationLabel = timeline.duration_hours < 24
    ? `${timeline.duration_hours}h`
    : `${Math.round(timeline.duration_hours / 24)}d`

  return (
    <div className="min-h-screen bg-wp-bg">
      {/* Header */}
      <div className="border-b border-[rgba(255,255,255,0.07)] bg-[rgba(0,0,0,0.3)]">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Link href="/" className="text-wp-text3 text-[12px] hover:text-wp-cyan transition-colors mb-3 inline-block">
            ← Back to feed
          </Link>

          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_COLORS[thread.status] ?? STATUS_COLORS.developing}`}>
              {thread.status.toUpperCase()}
            </span>
            <span className={`text-[10px] font-mono ${SEVERITY_COLORS[thread.peak_severity]?.split(' ')[0] ?? 'text-wp-text3'}`}>
              {thread.peak_severity.toUpperCase()}
            </span>
            {thread.region && (
              <span className="text-[11px] text-wp-text3 font-mono">{thread.region}</span>
            )}
            <span className="text-[11px] text-wp-text3 font-mono ml-auto">
              {thread.signal_count} signals · {durationLabel}
            </span>
          </div>

          <h1 className="text-[20px] font-semibold text-wp-text1 leading-tight mb-2">
            {thread.title}
          </h1>

          {thread.summary && (
            <p className="text-[14px] text-wp-text2 leading-relaxed">
              {thread.summary}
            </p>
          )}

          {/* Entities */}
          {thread.related_entities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {thread.related_entities.slice(0, 10).map((entity, i) => (
                <span key={i} className="text-[10px] text-wp-cyan bg-[rgba(0,212,255,0.08)] border border-[rgba(0,212,255,0.2)] px-2 py-0.5 rounded-full">
                  {entity}
                </span>
              ))}
            </div>
          )}

          {/* Severity trajectory mini-chart */}
          {thread.severity_trajectory.length >= 2 && (
            <div className="mt-4 flex items-end gap-[2px] h-8">
              {thread.severity_trajectory.slice(-20).map((point, i) => {
                const maxRank = 4
                const height = Math.max(4, (point.avg_severity_rank / maxRank) * 32)
                const color = point.avg_severity_rank >= 3 ? 'bg-red-400' :
                              point.avg_severity_rank >= 2 ? 'bg-orange-400' :
                              point.avg_severity_rank >= 1 ? 'bg-yellow-400' : 'bg-green-400'
                return (
                  <div key={i} className={`flex-1 rounded-sm ${color} opacity-70`}
                    style={{ height: `${height}px` }}
                    title={`${formatDate(point.timestamp)}: severity ${point.avg_severity_rank.toFixed(1)}, ${point.signal_count} signals`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Signal timeline */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h2 className="text-[13px] font-semibold text-wp-text1 uppercase tracking-wide mb-4">
          Signal Timeline
        </h2>

        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-[rgba(255,255,255,0.07)]" />

          <div className="space-y-1">
            {signals.map((signal, i) => {
              const isFirst = i === 0
              const isLast = i === signals.length - 1

              return (
                <Link
                  key={signal.id}
                  href={`/signals/${signal.id}`}
                  className="block group"
                >
                  <div className="flex items-start gap-3 py-2 pl-0 pr-3 rounded-lg hover:bg-[rgba(255,255,255,0.03)] transition-colors">
                    {/* Timeline dot */}
                    <div className="flex-shrink-0 w-6 flex justify-center pt-1.5 relative z-10">
                      <div className={`w-3 h-3 rounded-full border-2 border-wp-bg ${SEVERITY_DOT[signal.severity] ?? 'bg-gray-400'}`} />
                    </div>

                    {/* Signal content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[signal.severity] ?? ''}`}>
                          {signal.severity.toUpperCase()}
                        </span>
                        <span className="text-[9px] text-wp-text3 font-mono uppercase">
                          {signal.category}
                        </span>
                        {signal.location_name && (
                          <span className="text-[10px] text-wp-text3 truncate">
                            {signal.location_name}
                          </span>
                        )}
                        <span className="text-[10px] text-wp-text3 font-mono ml-auto flex-shrink-0">
                          {formatDate(signal.published_at || signal.created_at)}
                        </span>
                      </div>
                      <p className="text-[13px] text-wp-text1 leading-snug group-hover:text-wp-cyan transition-colors line-clamp-2">
                        {signal.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-wp-text3 font-mono">
                          {signal.source_count} source{signal.source_count !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] text-wp-text3 font-mono">
                          {Math.round((signal.reliability_score ?? 0) * 100)}% reliable
                        </span>
                        {signal.role && (
                          <span className="text-[10px] text-wp-cyan font-mono">
                            {signal.role}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        {signals.length === 0 && (
          <div className="text-center text-wp-text3 text-sm py-8">
            No signals linked to this thread yet.
          </div>
        )}

        {/* Thread metadata footer */}
        <div className="mt-8 pt-4 border-t border-[rgba(255,255,255,0.07)] text-[11px] text-wp-text3 font-mono flex flex-wrap gap-4">
          <span>Thread ID: {thread.id.slice(0, 8)}</span>
          <span>Created: {formatDate(thread.created_at)}</span>
          <span>Last updated: {timeAgo(thread.last_updated)}</span>
          {timeline.first_signal && <span>First signal: {formatDate(timeline.first_signal)}</span>}
        </div>
      </div>
    </div>
  )
}
