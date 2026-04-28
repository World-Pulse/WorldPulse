'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ── Types ─────────────────────────────────────────────────────────────────────

type Window = '1h' | '6h' | '24h' | '7d'
type EntityType = 'all' | 'country' | 'org' | 'topic' | 'actor'

interface EntitySeverity {
  critical: number
  high:     number
  medium:   number
  low:      number
  info:     number
}

interface TrendingEntity {
  entity:          string
  type:            'country' | 'org' | 'topic' | 'actor'
  count:           number
  severity:        EntitySeverity
  top_categories:  { name: string; count: number }[]
  top_countries:   { code: string; count: number }[]
}

interface TrendingEntitiesData {
  window:                  string
  total_signals_analyzed:  number
  unique_entities:         number
  entities:                TrendingEntity[]
  generated_at:            string
}

// ── Severity helpers ──────────────────────────────────────────────────────────

/** Returns the dominant severity level based on highest non-zero count */
function dominantSeverity(sev: EntitySeverity): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (sev.critical > 0) return 'critical'
  if (sev.high     > 0) return 'high'
  if (sev.medium   > 0) return 'medium'
  if (sev.low      > 0) return 'low'
  return 'info'
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#00d4ff',
  low:      '#00e676',
  info:     'rgba(255,255,255,0.3)',
}

const SEVERITY_GLOW: Record<string, string> = {
  critical: '0 0 6px rgba(255,59,92,0.6)',
  high:     '0 0 6px rgba(245,166,35,0.6)',
  medium:   '0 0 6px rgba(0,212,255,0.4)',
  low:      '0 0 6px rgba(0,230,118,0.4)',
  info:     'none',
}

// ── Type badge ────────────────────────────────────────────────────────────────

const TYPE_BADGE_STYLES: Record<string, string> = {
  country: 'bg-[rgba(0,212,255,0.12)] text-wp-cyan border border-[rgba(0,212,255,0.2)]',
  org:     'bg-[rgba(245,166,35,0.12)] text-wp-amber border border-[rgba(245,166,35,0.2)]',
  topic:   'bg-[rgba(255,255,255,0.07)] text-wp-text2 border border-[rgba(255,255,255,0.1)]',
  actor:   'bg-[rgba(0,230,118,0.1)] text-wp-green border border-[rgba(0,230,118,0.2)]',
}

const TYPE_LABELS: Record<string, string> = {
  country: 'CTY',
  org:     'ORG',
  topic:   'TAG',
  actor:   'ACT',
}

// ── Window options ────────────────────────────────────────────────────────────

const WINDOWS: { id: Window; label: string }[] = [
  { id: '1h',  label: '1H'  },
  { id: '6h',  label: '6H'  },
  { id: '24h', label: '24H' },
  { id: '7d',  label: '7D'  },
]

// ── Entity type filters ───────────────────────────────────────────────────────

const TYPE_FILTERS: { id: EntityType; label: string }[] = [
  { id: 'all',     label: 'All'     },
  { id: 'country', label: 'Country' },
  { id: 'org',     label: 'Org'     },
  { id: 'topic',   label: 'Topic'   },
]

// ── Component ────────────────────────────────────────────────────────────────

export function TrendingEntities() {
  const [data,       setData]       = useState<TrendingEntitiesData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(false)
  const [window_,    setWindow_]    = useState<Window>('24h')
  const [typeFilter, setTypeFilter] = useState<EntityType>('all')

  const fetchEntities = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ window: window_, limit: '12', type: typeFilter })
      const res = await fetch(`${API_URL}/api/v1/analytics/trending-entities?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.success) setData(json)
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [window_, typeFilter])

  // Fetch on mount and whenever filter changes
  useEffect(() => {
    fetchEntities()
  }, [fetchEntities])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(fetchEntities, 5 * 60_000)
    return () => clearInterval(id)
  }, [fetchEntities])

  const entities = data?.entities ?? []
  const maxCount = entities.length > 0 ? Math.max(...entities.map(e => e.count)) : 1

  return (
    <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-[14px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">Trending Entities</span>
        <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
        {data && (
          <span className="font-mono text-[8px] text-wp-text3 whitespace-nowrap">
            {(data.total_signals_analyzed ?? 0).toLocaleString()} signals
          </span>
        )}
      </div>

      {/* Window selector */}
      <div className="flex items-center gap-1 mb-[10px]">
        {WINDOWS.map(w => (
          <button
            key={w.id}
            onClick={() => setWindow_(w.id)}
            className={`px-2 py-0.5 rounded font-mono text-[9px] tracking-wider transition-all
              ${window_ === w.id
                ? 'bg-[rgba(245,166,35,0.2)] text-wp-amber border border-[rgba(245,166,35,0.4)]'
                : 'text-wp-text3 border border-transparent hover:text-wp-text2 hover:border-[rgba(255,255,255,0.1)]'
              }`}
          >
            {w.label}
          </button>
        ))}
        <div className="flex-1" />
        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as EntityType)}
          className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded text-[9px] font-mono text-wp-text3 px-1.5 py-0.5 outline-none cursor-pointer hover:border-[rgba(255,255,255,0.2)] transition-all"
          aria-label="Filter entity type"
        >
          {TYPE_FILTERS.map(f => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Entity list */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-[28px] h-[14px] rounded bg-[rgba(255,255,255,0.06)] animate-pulse flex-shrink-0" />
              <div className="flex-1 h-[10px] rounded bg-[rgba(255,255,255,0.06)] animate-pulse" style={{ width: `${60 + (i * 7) % 40}%` }} />
              <div className="w-[20px] h-[10px] rounded bg-[rgba(255,255,255,0.06)] animate-pulse flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-4">
          <div className="text-wp-text3 text-[11px] mb-2">Unable to load entities</div>
          <button
            onClick={fetchEntities}
            className="text-wp-amber text-[10px] font-mono hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && entities.length === 0 && (
        <div className="text-center py-4 text-wp-text3 text-[11px]">
          No entities in this window
        </div>
      )}

      {!loading && !error && entities.length > 0 && (
        <div className="space-y-[6px]">
          {entities.slice(0, 10).map((entity, idx) => {
            const sev    = dominantSeverity(entity.severity)
            const color  = SEVERITY_COLORS[sev]
            const glow   = SEVERITY_GLOW[sev]
            const barPct = Math.max(4, Math.round((entity.count / maxCount) * 100))

            return (
              <div key={`${entity.entity}-${idx}`} className="group">
                <div className="flex items-center gap-[6px] mb-[3px]">
                  {/* Rank */}
                  <span className="font-mono text-[8px] text-wp-text3 w-[14px] text-right flex-shrink-0">
                    {idx + 1}
                  </span>
                  {/* Type badge */}
                  <span className={`font-mono text-[7px] px-[4px] py-[1px] rounded-[3px] flex-shrink-0 ${TYPE_BADGE_STYLES[entity.type] ?? ''}`}>
                    {TYPE_LABELS[entity.type] ?? entity.type.toUpperCase().slice(0, 3)}
                  </span>
                  {/* Entity name */}
                  <span
                    className="flex-1 text-[11px] font-semibold text-wp-text truncate min-w-0"
                    title={entity.entity}
                  >
                    {entity.entity}
                  </span>
                  {/* Count */}
                  <span
                    className="font-mono text-[10px] flex-shrink-0 font-bold"
                    style={{ color }}
                  >
                    {entity.count}
                  </span>
                </div>
                {/* Frequency bar */}
                <div className="ml-[20px] h-[3px] rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width:     `${barPct}%`,
                      background: color,
                      boxShadow:  glow,
                    }}
                  />
                </div>
                {/* Top category tags on hover */}
                {entity.top_categories.length > 0 && (
                  <div className="ml-[20px] mt-[3px] hidden group-hover:flex flex-wrap gap-1">
                    {entity.top_categories.slice(0, 3).map(cat => (
                      <span
                        key={cat.name}
                        className="font-mono text-[7px] text-wp-text3 px-[4px] py-[1px] rounded bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.07)]"
                      >
                        {cat.name} ×{cat.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer: link to full analytics */}
      <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.05)] flex items-center justify-between">
        <span className="font-mono text-[8px] text-wp-text3 uppercase tracking-wider">
          {data ? `${data.unique_entities} unique entities` : 'Entity intelligence'}
        </span>
        <Link
          href="/analytics?tab=entities"
          className="font-mono text-[9px] text-wp-amber hover:underline flex items-center gap-1"
        >
          Full view →
        </Link>
      </div>
    </div>
  )
}
