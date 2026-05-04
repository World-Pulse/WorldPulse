'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectingEntity {
  name: string
  type: string
}

interface ConnectedSignal {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  reliabilityScore: number
  locationName: string | null
  createdAt: string | null
  connectedVia: ConnectingEntity[]
  connectionStrength: number
  sharedEntityCount: number
}

interface SignalEntity {
  id: string
  name: string
  type: string
  mentionCount: number
}

interface ConnectionsResponse {
  success: boolean
  data: {
    connections: ConnectedSignal[]
    entities: SignalEntity[]
    count: number
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#fbbf24',
  low:      '#8892a4',
  info:     '#5a6477',
}

const ENTITY_TYPE_ICON: Record<string, string> = {
  person:        '\u{1F464}',
  organisation:  '\u{1F3E2}',
  location:      '\u{1F4CD}',
  event:         '\u{1F4C5}',
  weapon_system: '\u{2694}',
  legislation:   '\u{1F4DC}',
  commodity:     '\u{1F4E6}',
  technology:    '\u{1F4BB}',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d: string | null): string {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ConnectionSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-4 bg-white/[0.07] rounded w-2/5 animate-pulse" />
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-2"
        >
          <div className="h-3 bg-white/[0.07] rounded animate-pulse" />
          <div className="h-2 bg-white/[0.07] rounded w-3/4 animate-pulse" />
          <div className="flex gap-1">
            <div className="h-4 w-16 bg-white/[0.05] rounded animate-pulse" />
            <div className="h-4 w-20 bg-white/[0.05] rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Entity Pill ──────────────────────────────────────────────────────────────

function EntityPill({ entity }: { entity: ConnectingEntity }) {
  const icon = ENTITY_TYPE_ICON[entity.type] ?? '\u{1F310}'
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono bg-[#00e676]/10 text-[#00e676] border border-[#00e676]/20">
      <span className="text-[8px]">{icon}</span>
      {entity.name}
    </span>
  )
}

// ─── Connection Card ──────────────────────────────────────────────────────────

function ConnectionCard({ signal }: { signal: ConnectedSignal }) {
  const color = SEVERITY_COLOR[signal.severity] ?? '#8892a4'

  return (
    <Link
      href={`/signals/${signal.id}`}
      className="block p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-all group"
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color }}>
          {signal.severity}
        </span>
        {signal.locationName && (
          <>
            <span className="font-mono text-[9px] text-wp-text3">&middot;</span>
            <span className="font-mono text-[9px] text-wp-text3 truncate">{signal.locationName}</span>
          </>
        )}
        <span className="font-mono text-[9px] text-wp-text3 ml-auto shrink-0">{timeAgo(signal.createdAt)}</span>
      </div>

      {/* Title */}
      <p className="text-[12px] text-wp-text2 group-hover:text-wp-text leading-[1.5] line-clamp-2 transition-colors mb-2">
        {signal.title}
      </p>

      {/* Connected via entities */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="font-mono text-[8px] uppercase tracking-widest text-wp-text3 mr-1">via</span>
        {signal.connectedVia.map((entity, i) => (
          <EntityPill key={`${entity.name}-${i}`} entity={entity} />
        ))}
        {signal.sharedEntityCount > signal.connectedVia.length && (
          <span className="text-[9px] text-wp-text3">
            +{signal.sharedEntityCount - signal.connectedVia.length} more
          </span>
        )}
      </div>
    </Link>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ConnectionWebProps {
  signalId: string
}

export function ConnectionWeb({ signalId }: ConnectionWebProps) {
  const [isOpen, setIsOpen] = useState(true) // Open by default — this is the wow factor
  const [connections, setConnections] = useState<ConnectedSignal[]>([])
  const [entities, setEntities] = useState<SignalEntity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function fetchConnections() {
      if (!isOpen) return

      try {
        setLoading(true)
        setError(null)
        const res = await fetch(
          `${API_BASE}/api/v1/signals/${encodeURIComponent(signalId)}/connections?limit=8`,
          { credentials: 'include' },
        )

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json = (await res.json()) as ConnectionsResponse
        if (!isMounted) return

        if (json.success) {
          setConnections(json.data.connections)
          setEntities(json.data.entities)
        } else {
          setError('Failed to load connections')
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch')
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    if (isOpen) fetchConnections()

    return () => { isMounted = false }
  }, [isOpen, signalId])

  // Don't render anything if no connections and not loading
  if (!loading && !error && connections.length === 0 && entities.length === 0 && !isOpen) {
    return null
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] transition-all text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
              Intelligence Web
            </div>
            {connections.length > 0 && !loading && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono text-[#00e676] bg-[#00e676]/10 border border-[#00e676]/20">
                {connections.length} connection{connections.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {entities.length > 0 && !loading && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {entities.slice(0, 4).map(e => (
                <span
                  key={e.id}
                  className="text-[9px] text-wp-text3 bg-white/[0.05] px-1.5 py-0.5 rounded capitalize"
                >
                  {ENTITY_TYPE_ICON[e.type] ?? ''} {e.name}
                </span>
              ))}
              {entities.length > 4 && (
                <span className="text-[9px] text-wp-text3">+{entities.length - 4} more</span>
              )}
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
          {loading && connections.length === 0 ? (
            <ConnectionSkeleton />
          ) : error ? (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-[12px] text-red-400">
              {error}
            </div>
          ) : connections.length === 0 ? (
            <div className="p-3 rounded-xl border border-white/[0.07] bg-white/[0.02]">
              <p className="text-[12px] text-wp-text3">
                No entity connections found yet. Connections emerge as the intelligence engine discovers shared entities across signals.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="font-mono text-[9px] uppercase tracking-widest text-wp-text3 px-1">
                Connected through shared entities
              </div>
              {connections.map(signal => (
                <ConnectionCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
