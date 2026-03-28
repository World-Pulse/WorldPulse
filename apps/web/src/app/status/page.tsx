'use client'

import { useEffect, useState, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type ServiceStatus = 'operational' | 'degraded' | 'outage'

interface ServiceCheck {
  status: ServiceStatus
  latency_ms?: number
  message?: string
}

interface StatusResponse {
  overall: ServiceStatus
  checked_at: string
  version: string
  uptime_seconds: number
  services: {
    api:       ServiceCheck
    database:  ServiceCheck
    redis:     ServiceCheck
    search:    ServiceCheck
    scraper:   ServiceCheck
    websocket: ServiceCheck
  }
}

const SERVICE_META: Record<string, { label: string; icon: string; description: string }> = {
  api:       { label: 'API',         icon: '⚡', description: 'REST API server' },
  database:  { label: 'Database',    icon: '🗄️', description: 'PostgreSQL' },
  redis:     { label: 'Cache',       icon: '⚡', description: 'Redis cache & pub/sub' },
  search:    { label: 'Search',      icon: '🔍', description: 'Meilisearch full-text' },
  scraper:   { label: 'Data Scraper',icon: '📡', description: 'Signal ingestion pipeline' },
  websocket: { label: 'WebSocket',   icon: '🔌', description: 'Real-time feed' },
}

const STATUS_CONFIG: Record<ServiceStatus, { label: string; dot: string; bg: string; text: string }> = {
  operational: { label: 'Operational', dot: 'bg-emerald-400',  bg: 'bg-emerald-500/10',  text: 'text-emerald-400'  },
  degraded:    { label: 'Degraded',    dot: 'bg-yellow-400',   bg: 'bg-yellow-500/10',   text: 'text-yellow-400'   },
  outage:      { label: 'Outage',      dot: 'bg-red-500',      bg: 'bg-red-500/10',      text: 'text-red-400'      },
}

const BANNER_CONFIG: Record<ServiceStatus, { label: string; bg: string; border: string; text: string; pulse: string }> = {
  operational: {
    label:  'All Systems Operational',
    bg:     'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text:   'text-emerald-400',
    pulse:  'bg-emerald-400',
  },
  degraded: {
    label:  'Partial Degradation',
    bg:     'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    text:   'text-yellow-400',
    pulse:  'bg-yellow-400',
  },
  outage: {
    label:  'Service Outage',
    bg:     'bg-red-500/10',
    border: 'border-red-500/30',
    text:   'text-red-400',
    pulse:  'bg-red-500',
  },
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const REFRESH_INTERVAL = 30

export default function StatusPage() {
  const [data, setData]       = useState<StatusResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [countdown, setCountdown]   = useState(REFRESH_INTERVAL)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/status`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: StatusResponse = await res.json()
      setData(json)
      setError(null)
      setSecondsAgo(0)
      setCountdown(REFRESH_INTERVAL)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + auto-refresh every 30s
  useEffect(() => {
    fetchStatus()
    const refresh = setInterval(fetchStatus, REFRESH_INTERVAL * 1000)
    return () => clearInterval(refresh)
  }, [fetchStatus])

  // Live countdown + seconds-ago ticker
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsAgo(s => s + 1)
      setCountdown(c => (c <= 1 ? REFRESH_INTERVAL : c - 1))
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  const overall  = data?.overall ?? 'operational'
  const banner   = BANNER_CONFIG[overall]

  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <div className="max-w-3xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[10px] tracking-[3px] text-wp-text3 uppercase">WorldPulse</span>
          </div>
          <h1 className="text-2xl font-bold text-wp-text">System Status</h1>
          <p className="text-sm text-wp-text3 mt-1">
            Real-time operational health of all WorldPulse infrastructure.
          </p>
        </div>

        {/* Overall status banner */}
        {!loading && !error && data && (
          <div
            className={`rounded-xl border px-6 py-5 mb-8 flex items-center gap-4 ${banner.bg} ${banner.border}`}
            role="status"
            aria-live="polite"
          >
            <span className="relative flex h-4 w-4 flex-shrink-0">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-50 ${banner.pulse}`} />
              <span className={`relative inline-flex rounded-full h-4 w-4 ${banner.pulse}`} />
            </span>
            <span className={`text-lg font-semibold ${banner.text}`}>{banner.label}</span>
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-wp-surface px-6 py-5 mb-8 animate-pulse">
            <div className="h-5 w-48 bg-wp-s2 rounded" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-5 mb-8 text-red-400">
            <strong>Error fetching status:</strong> {error}
          </div>
        )}

        {/* Service cards */}
        <div className="space-y-2 mb-8">
          <div className="font-mono text-[10px] tracking-[2px] text-wp-text3 uppercase mb-3">Services</div>

          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-wp-surface px-5 py-4 flex items-center gap-4 animate-pulse"
                >
                  <div className="h-8 w-8 rounded-lg bg-wp-s2" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 bg-wp-s2 rounded" />
                    <div className="h-2 w-40 bg-wp-s2 rounded" />
                  </div>
                  <div className="h-3 w-20 bg-wp-s2 rounded" />
                </div>
              ))
            : data && Object.entries(data.services).map(([key, check]) => {
                const meta   = SERVICE_META[key] ?? { label: key, icon: '●', description: '' }
                const config = STATUS_CONFIG[check.status]
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-wp-surface px-5 py-4 flex items-center gap-4 transition-colors hover:border-[rgba(255,255,255,0.12)]"
                  >
                    {/* Icon */}
                    <div className="w-9 h-9 rounded-lg bg-wp-s2 flex items-center justify-center text-base flex-shrink-0">
                      {meta.icon}
                    </div>

                    {/* Name + description */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-wp-text">{meta.label}</div>
                      <div className="text-xs text-wp-text3 truncate">
                        {check.message ?? meta.description}
                      </div>
                    </div>

                    {/* Latency */}
                    {check.latency_ms != null && (
                      <span className="font-mono text-xs text-wp-text3 flex-shrink-0 hidden sm:block">
                        {check.latency_ms}ms
                      </span>
                    )}

                    {/* Status badge */}
                    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 ${config.bg} ${config.text}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
                      {config.label}
                    </div>
                  </div>
                )
              })
          }
        </div>

        {/* Meta info */}
        {data && (
          <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-wp-surface px-5 py-4 flex flex-wrap gap-x-8 gap-y-2 text-xs text-wp-text3 font-mono">
            <div>
              <span className="text-wp-text2">Version</span>{' '}
              <span className="text-wp-amber">{data.version}</span>
            </div>
            <div>
              <span className="text-wp-text2">Uptime</span>{' '}
              <span className="text-wp-text">{formatUptime(data.uptime_seconds)}</span>
            </div>
            <div>
              <span className="text-wp-text2">Last checked</span>{' '}
              <span className="text-wp-text">{new Date(data.checked_at).toLocaleTimeString()}</span>
            </div>
          </div>
        )}

        {/* Footer: last-updated countdown */}
        <div className="mt-6 flex items-center justify-between text-xs text-wp-text3">
          <span>
            Updated{' '}
            <span className="text-wp-text2">
              {secondsAgo === 0 ? 'just now' : `${secondsAgo}s ago`}
            </span>
          </span>
          <span>
            Next refresh in{' '}
            <span className="text-wp-amber font-mono">{countdown}s</span>
          </span>
        </div>

      </div>
    </div>
  )
}
