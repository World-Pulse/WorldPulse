'use client'

/**
 * BAT-18 — SignalCounter
 *
 * Animated live signal counter. Three display modes:
 *  - "hero"   → large stat with label + last-hour sub-label  (RightSidebar / dashboard)
 *  - "badge"  → compact bottom-bar pill  (map page)
 *  - "inline" → just the formatted number  (embed in prose)
 *
 * The component can either manage its own WebSocket subscription (default) or
 * accept an `externalNewCount` prop (a monotonically increasing integer) from a
 * parent that already owns a WS connection — in which case the internal WS is
 * skipped to avoid duplicate connections.
 */

import { useEffect, useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? API_URL.replace(/^http/, 'ws')

// CSS keyframes injected once into <head>
const KEYFRAMES = `
@keyframes sc-roll-up {
  0%   { transform: translateY(100%); opacity: 0; }
  20%  { transform: translateY(0%);   opacity: 1; }
  80%  { transform: translateY(0%);   opacity: 1; }
  100% { transform: translateY(-100%);opacity: 0; }
}
@keyframes sc-ring-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(0,230,118,0.6); }
  70%  { box-shadow: 0 0 0 8px rgba(0,230,118,0); }
  100% { box-shadow: 0 0 0 0 rgba(0,230,118,0); }
}
`

let keyframesInjected = false
function ensureKeyframes() {
  if (typeof document === 'undefined' || keyframesInjected) return
  const style = document.createElement('style')
  style.textContent = KEYFRAMES
  document.head.appendChild(style)
  keyframesInjected = true
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface SignalCounterProps {
  /** Display variant */
  mode?: 'hero' | 'badge' | 'inline'
  /** Tailwind className overrides */
  className?: string
  /**
   * Pass the parent's cumulative new-signal count (monotonically increasing) to
   * avoid a duplicate WebSocket connection when the parent already has one.
   * If omitted, the component opens its own WS subscription.
   */
  externalNewCount?: number
}

// ─── Component ────────────────────────────────────────────────────────────

export function SignalCounter({ mode = 'hero', className = '', externalNewCount }: SignalCounterProps) {
  const [total,    setTotal]    = useState<number | null>(null)
  const [lastHour, setLastHour] = useState<number>(0)
  const [pulsing,  setPulsing]  = useState(false)
  const [wsOnline, setWsOnline] = useState(false)
  const prevExtRef = useRef(0)
  const wsRef      = useRef<WebSocket | null>(null)

  // Inject CSS keyframes once
  useEffect(() => { ensureKeyframes() }, [])

  // ── Fetch initial count ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/api/v1/signals/count`)
      .then(r => r.json())
      .then((json: { data?: { total?: number; lastHour?: number } }) => {
        if (json?.data?.total != null) {
          setTotal(json.data.total)
          setLastHour(json.data.lastHour ?? 0)
        }
      })
      .catch(() => { /* non-fatal */ })
  }, [])

  // ── Internal WS subscription (skipped when externalNewCount is used) ─────
  useEffect(() => {
    if (externalNewCount !== undefined) return   // parent owns the WS

    let unmounted = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let delay = 1000

    function connect() {
      if (unmounted) return
      const ws = new WebSocket(`${WS_URL}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        if (unmounted) { ws.close(); return }
        delay = 1000
        setWsOnline(true)
        ws.send(JSON.stringify({ type: 'subscribe', payload: { channels: ['all'] } }))
      }

      ws.onmessage = (evt: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(evt.data) as { event?: string }
          if (msg.event === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
            return
          }
          if (msg.event === 'signal.new') {
            setTotal(n => (n ?? 0) + 1)
            setLastHour(n => n + 1)
            triggerPulse()
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = () => {
        if (unmounted) return
        setWsOnline(false)
        reconnectTimer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30_000)
      }
      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      unmounted = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close() }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])   // intentionally empty — only run once

  // ── React to external new-signal count ───────────────────────────────────
  useEffect(() => {
    if (externalNewCount === undefined) return
    const delta = externalNewCount - prevExtRef.current
    if (delta > 0) {
      prevExtRef.current = externalNewCount
      setTotal(n => (n ?? 0) + delta)
      setLastHour(n => n + delta)
      triggerPulse()
    }
  }, [externalNewCount])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function triggerPulse() {
    setPulsing(true)
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
    pulseTimerRef.current = setTimeout(() => setPulsing(false), 700)
  }

  const formatted = total != null ? new Intl.NumberFormat('en-US').format(total) : '…'
  // wsOnline is true when internal WS is live; treat externalNewCount presence as implicitly live
  const isLive    = externalNewCount !== undefined ? true : wsOnline

  // ── Render: badge ─────────────────────────────────────────────────────────
  if (mode === 'badge') {
    return (
      <div
        className={`flex items-center gap-1.5 font-mono text-[10px] border rounded-lg px-2 py-[4px] flex-shrink-0 transition-all duration-150 ${
          pulsing
            ? 'border-[rgba(0,230,118,0.4)] bg-[rgba(0,230,118,0.08)] text-wp-green'
            : 'border-[rgba(255,255,255,0.07)] bg-transparent text-wp-text2'
        } ${className}`}
        style={pulsing ? { animation: 'sc-ring-pulse 0.7s ease-out' } : undefined}
        title={`${formatted} total intelligence signals · ${isLive ? 'Live feed connected' : 'Connecting…'}`}
      >
        <span
          className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${isLive ? 'bg-wp-green animate-live-pulse' : 'bg-wp-amber'}`}
        />
        <span className={`transition-all duration-150 ${pulsing ? 'font-semibold' : ''}`}>
          {formatted}
        </span>
        <span className="text-wp-text3">signals</span>
        {pulsing && (
          <span
            className="text-wp-green text-[9px] font-bold"
            style={{ animation: 'sc-roll-up 0.7s ease-out forwards' }}
          >
            +1
          </span>
        )}
        <span className={`hidden sm:inline text-wp-text3 ml-0.5 ${isLive ? 'text-wp-green' : ''}`}>
          · {isLive ? '🟢 Live' : '🟡'}
        </span>
      </div>
    )
  }

  // ── Render: inline ────────────────────────────────────────────────────────
  if (mode === 'inline') {
    return (
      <span
        className={`font-mono font-bold transition-colors duration-200 ${
          pulsing ? 'text-wp-green' : 'text-wp-cyan'
        } ${className}`}
      >
        {formatted}
      </span>
    )
  }

  // ── Render: hero ──────────────────────────────────────────────────────────
  return (
    <div className={`${className}`}>
      {/* Main count with overflow-clip so we can do digit roll animations */}
      <div className="flex items-baseline gap-2 overflow-hidden">
        <span
          className={`text-2xl font-bold font-mono tracking-tight transition-all duration-200 ${
            pulsing ? 'text-wp-green' : 'text-wp-cyan'
          }`}
          style={pulsing ? { animation: 'sc-ring-pulse 0.7s ease-out' } : undefined}
        >
          {formatted}
        </span>
        {pulsing && (
          <span
            className="text-[11px] font-mono font-bold text-wp-green"
            style={{ animation: 'sc-roll-up 0.7s ease-out forwards' }}
          >
            +1
          </span>
        )}
      </div>

      {/* Label row */}
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[11px] text-wp-text3">intelligence signals tracked</span>
        <span
          className={`w-[5px] h-[5px] rounded-full ${isLive ? 'bg-wp-green animate-live-pulse' : 'bg-wp-amber'}`}
          title={isLive ? 'Live feed connected' : 'Connecting…'}
        />
      </div>

      {/* Last-hour sub-stat */}
      {lastHour > 0 && (
        <div className={`text-[10px] font-mono mt-1 transition-colors duration-200 ${
          pulsing ? 'text-wp-green' : 'text-wp-text3'
        }`}>
          +{new Intl.NumberFormat('en-US').format(lastHour)} in the last hour
        </div>
      )}
    </div>
  )
}

export default SignalCounter
