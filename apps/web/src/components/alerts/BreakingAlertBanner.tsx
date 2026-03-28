'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface BreakingAlert {
  alertId: string
  signalId: string
  title: string
  severity: 'critical' | 'high'
  category: string
  locationName?: string
  countryCode?: string
  sourceUrl?: string
  timestamp: string
  expiresAt: string
}

interface WSMessage {
  event: string
  data: BreakingAlert
  timestamp?: string
  id?: string
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

const API_URL = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001')
  : 'http://localhost:3001'

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function wsUrl(): string {
  try {
    const u = new URL(API_URL)
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/ws`
  } catch {
    return 'ws://localhost:3001/ws'
  }
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; dot: string; badge: string }> = {
  critical: {
    bg: 'bg-red-950/95',
    border: 'border-b-2 border-red-500',
    dot: 'bg-red-500',
    badge: 'bg-red-600 text-white',
  },
  high: {
    bg: 'bg-orange-950/95',
    border: 'border-b-2 border-orange-500',
    dot: 'bg-orange-500',
    badge: 'bg-orange-600 text-white',
  },
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────

export function BreakingAlertBanner() {
  const router = useRouter()
  const [alerts, setAlerts] = useState<BreakingAlert[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [visible, setVisible] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const mountedRef = useRef(true)

  // ─── Fetch active alerts from REST API ──────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/breaking/alerts`)
      if (!res.ok) return
      const body = (await res.json()) as { success: boolean; data: { alerts: BreakingAlert[]; count: number } }
      if (!body.success || !Array.isArray(body.data?.alerts)) return
      const now = Date.now()
      const active = body.data.alerts.filter((a) => new Date(a.expiresAt).getTime() > now)
      if (!mountedRef.current) return
      setAlerts(active)
      setCurrentIdx(0)
      setVisible(active.length > 0)
    } catch {
      // Silent — banner simply won't show
    }
  }, [])

  // ─── Dismiss an alert ──────────────────────────────────────────────────
  const dismiss = useCallback((alertId: string) => {
    setAlerts((prev) => {
      const next = prev.filter((a) => a.alertId !== alertId)
      if (next.length === 0) setVisible(false)
      return next
    })
    setCurrentIdx(0)
    // Fire-and-forget server dismiss
    fetch(`${API_URL}/api/v1/breaking/alerts/${alertId}/dismiss`, { method: 'POST' }).catch(() => {})
  }, [])

  // ─── WebSocket connection ──────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (!mountedRef.current) return
    try {
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        attemptsRef.current = 0
      }

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as WSMessage
          if (msg.event === 'alert.breaking' && msg.data?.alertId) {
            const alert = msg.data
            if (!mountedRef.current) return
            setAlerts((prev) => {
              // Don't duplicate
              if (prev.some((a) => a.alertId === alert.alertId)) return prev
              const next = [alert, ...prev].slice(0, 20)
              setVisible(true)
              return next
            })
          }
        } catch {
          // Ignore parse errors
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        if (!mountedRef.current) return
        const delay = Math.min(1000 * 2 ** attemptsRef.current, 30_000)
        attemptsRef.current++
        reconnectRef.current = setTimeout(connectWS, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      // WebSocket not available (SSR)
    }
  }, [])

  // ─── Lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    fetchAlerts()
    connectWS()

    return () => {
      mountedRef.current = false
      wsRef.current?.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (rotateRef.current) clearInterval(rotateRef.current)
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current)
    }
  }, [fetchAlerts, connectWS])

  // ─── Auto-rotate through alerts ─────────────────────────────────────
  useEffect(() => {
    if (rotateRef.current) clearInterval(rotateRef.current)
    if (alerts.length <= 1) return

    rotateRef.current = setInterval(() => {
      setCurrentIdx((prev) => (prev + 1) % alerts.length)
    }, 8_000)

    return () => {
      if (rotateRef.current) clearInterval(rotateRef.current)
    }
  }, [alerts.length])

  // ─── Auto-dismiss after 60s ──────────────────────────────────────────
  useEffect(() => {
    if (autoDismissRef.current) clearTimeout(autoDismissRef.current)
    const current = alerts[currentIdx]
    if (!current) return

    autoDismissRef.current = setTimeout(() => {
      dismiss(current.alertId)
    }, 60_000)

    return () => {
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current)
    }
  }, [currentIdx, alerts, dismiss])

  // ─── Render ────────────────────────────────────────────────────────────
  if (!visible || alerts.length === 0) return null

  const alert = alerts[currentIdx % alerts.length]
  if (!alert) return null

  const styles = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.high

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] ${styles.bg} ${styles.border} backdrop-blur-sm shadow-lg animate-in slide-in-from-top duration-300`}
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto max-w-7xl px-3 py-2 flex items-center gap-3">
        {/* Pulsing dot + BREAKING label */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${styles.dot} opacity-75`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${styles.dot}`} />
          </span>
          <span className="text-[11px] font-bold tracking-wider text-white uppercase">
            Breaking
          </span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${styles.badge} uppercase`}>
            {alert.severity}
          </span>
        </div>

        {/* Title — clickable to signal detail */}
        <button
          onClick={() => router.push(`/signals/${alert.signalId}`)}
          className="flex-1 text-left text-sm font-medium text-white truncate hover:underline cursor-pointer min-w-0"
          title={alert.title}
        >
          {alert.title}
        </button>

        {/* Metadata badges */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/10 text-white/80 uppercase">
            {alert.category}
          </span>
          {alert.locationName && (
            <span className="hidden md:inline text-[10px] text-white/60 truncate max-w-[120px]">
              {alert.locationName}
            </span>
          )}
          <span className="text-[10px] text-white/50">
            {formatTimeAgo(alert.timestamp)}
          </span>
        </div>

        {/* Alert count indicator */}
        {alerts.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            {alerts.map((_, i) => (
              <span
                key={alerts[i]?.alertId ?? i}
                className={`w-1.5 h-1.5 rounded-full ${i === currentIdx % alerts.length ? 'bg-white' : 'bg-white/30'}`}
              />
            ))}
          </div>
        )}

        {/* Dismiss button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            dismiss(alert.alertId)
          }}
          className="shrink-0 p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          aria-label="Dismiss alert"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
