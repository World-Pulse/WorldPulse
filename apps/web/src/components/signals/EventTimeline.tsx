'use client'

import { useState, useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c', high: '#f5a623', medium: '#fbbf24',
  low: '#8892a4', info: '#5a6477',
}

interface TimelineEvent {
  id: string
  title: string
  severity: string
  source_count: number
  published_at: string
  category: string
}

function timeLabel(d: string): string {
  const date = new Date(d)
  const now = Date.now()
  const diffM = Math.floor((now - date.getTime()) / 60000)
  if (diffM < 60) return `${diffM}m ago`
  const h = Math.floor(diffM / 60)
  if (h < 24) return `${h}h ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Event Timeline — shows how a story developed over time.
 * Fetches related signals and renders them as a vertical timeline.
 */
export function EventTimeline({ signalId, category }: { signalId: string; category: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_access_token') : null
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    fetch(`${API_URL}/api/v1/signals/${signalId}/correlated`, { headers })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.data?.signals) {
          const sorted = data.data.signals
            .sort((a: TimelineEvent, b: TimelineEvent) =>
              new Date(a.published_at).getTime() - new Date(b.published_at).getTime()
            )
          setEvents(sorted)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [signalId])

  if (loading) return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">Event Timeline</div>
      <div className="h-[60px] shimmer rounded-xl" />
    </div>
  )

  if (events.length === 0) return null

  return (
    <div>
      <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 mb-3">
        Event Timeline — {events.length} development{events.length !== 1 ? 's' : ''}
      </div>
      <div className="relative pl-6 space-y-0">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/[0.08]" />

        {events.map((event, i) => {
          const color = SEV_COLOR[event.severity] ?? '#8892a4'
          const isFirst = i === 0
          const isLast = i === events.length - 1

          return (
            <div key={event.id} className="relative pb-4 last:pb-0">
              {/* Dot */}
              <div
                className="absolute left-[-19px] top-1.5 w-[11px] h-[11px] rounded-full border-2"
                style={{
                  borderColor: color,
                  background: isLast ? color : 'var(--wp-bg)',
                }}
              />

              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="font-mono text-[9px] uppercase tracking-wider font-semibold"
                      style={{ color }}
                    >
                      {event.severity}
                    </span>
                    <span className="font-mono text-[9px] text-wp-text3">
                      {timeLabel(event.published_at)}
                    </span>
                    {event.source_count >= 2 && (
                      <span className="font-mono text-[9px] text-wp-green">
                        {event.source_count} sources
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-wp-text2 leading-[1.5] line-clamp-2">
                    {event.title}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
