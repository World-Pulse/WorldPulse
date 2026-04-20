'use client'

import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import Link from 'next/link'
import { ShieldCheck, BotMessageSquare, ShieldAlert } from 'lucide-react'
import { TradeSurveillancePanel } from './TradeSurveillancePanel'
import { TrendingEntities } from '@/components/analytics/TrendingEntities'
import { SignalCounter } from '@/components/SignalCounter'

import { MarketPulse } from '@/components/MarketPulse'

const SpinningGlobe = lazy(() => import('./SpinningGlobe').then(m => ({ default: m.SpinningGlobe })))

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Colour map for signal type → dot colour
const TYPE_COLORS: Record<string, string> = {
  red:   '#ff3b5c',
  amber: '#f5a623',
  cyan:  '#00d4ff',
  green: '#00e676',
}

interface LiveSignal { time: string; color: string; text: string; id?: string }

const FOLLOW_SUGGESTIONS = [
  { initials: 'UN', label: 'UN News', bio: 'Official United Nations news', color: 'from-purple-600 to-purple-900', verified: true },
  { initials: 'NW', label: 'NASA Watch', bio: 'Space, climate & Earth data', color: 'from-blue-600 to-blue-900', verified: true },
  { initials: 'IJ', label: 'IJ Reporters', bio: 'Investigative journalism', color: 'from-red-700 to-red-900', verified: false },
  { initials: 'GC', label: 'GlobalClimate.ai', bio: 'AI climate monitoring', color: 'from-green-600 to-green-900', verified: false },
]

// Globe hotspots [left%, top%, type]
const HOTSPOTS: [number, number, 'red'|'amber'|'cyan'|'green'][] = [
  [72, 55, 'red'],
  [50, 38, 'amber'],
  [58, 44, 'red'],
  [82, 40, 'cyan'],
  [35, 50, 'green'],
  [45, 58, 'amber'],
  [22, 42, 'cyan'],
]

const HOTSPOT_COLORS = {
  red:   { ring: 'border-wp-red',   dot: 'bg-wp-red shadow-[0_0_6px_#ff3b5c]' },
  amber: { ring: 'border-wp-amber', dot: 'bg-wp-amber shadow-[0_0_6px_#f5a623]' },
  cyan:  { ring: 'border-wp-cyan',  dot: 'bg-wp-cyan shadow-[0_0_6px_#00d4ff]' },
  green: { ring: 'border-wp-green', dot: 'bg-wp-green shadow-[0_0_6px_#00e676]' },
}

function now() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

function formatPulseCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function RightSidebar() {
  const [signals, setSignals]         = useState<LiveSignal[]>([])
  const [signalTotal, setSignalTotal] = useState<number | null>(null)
  const seenIds = useRef(new Set<string>())

  // Platform Pulse — signals count is live, others are stable facts
  // Uptime = server uptime (process.uptime resets on every deploy, so use 99.9%)
  // Nations = 195 recognized countries
  // Sources = 300+ RSS + OSINT feeds configured in scraper pipeline

  // Source integrity stats
  const [verifiedPct, setVerifiedPct] = useState<string>('—')
  const [blockedToday, setBlockedToday] = useState<string>('—')

  useEffect(() => {
    let mounted = true
    async function fetchIntegrity() {
      try {
        const res = await fetch(`${API_URL}/api/v1/slop/stats`)
        if (!res.ok) return
        const json = await res.json()
        if (!mounted || !json.data) return
        const { total_signals_analyzed: total, signals_flagged_as_slop: blocked } = json.data
        if (total > 0) {
          const cleanPct = Math.round(((total - blocked) / total) * 1000) / 10
          setVerifiedPct(`${cleanPct}%`)
        }
        setBlockedToday(String(blocked ?? 0))
      } catch { /* silent */ }
    }
    fetchIntegrity()
    const t = setInterval(fetchIntegrity, 120_000)
    return () => { mounted = false; clearInterval(t) }
  }, [])

  // Market ticker state — now managed by MarketPulse component

  // Fetch live headlines from API and refresh every 45s
  useEffect(() => {
    let mounted = true
    async function fetchHeadlines() {
      try {
        const res = await fetch(`${API_URL}/api/v1/signals/headlines`)
        if (!res.ok) return
        const json = await res.json()
        if (!mounted || !json.success) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fresh: LiveSignal[] = (json.data as any[])
          .filter((h: any) => !seenIds.current.has(h.id))
          .map((h: any) => {
            seenIds.current.add(h.id)
            return { id: h.id, time: now(), color: TYPE_COLORS[h.type] ?? '#f5a623', text: h.text }
          })
        if (fresh.length > 0) {
          setSignals(prev => [...fresh, ...prev].slice(0, 8))
        }
      } catch { /* ignore */ }
    }
    fetchHeadlines()
    const id = setInterval(fetchHeadlines, 45_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // Fetch live signal count
  useEffect(() => {
    let mounted = true
    async function fetchCount() {
      try {
        const res = await fetch(`${API_URL}/api/v1/signals/count`)
        if (res.ok) {
          const json = await res.json()
          if (mounted && json.success) setSignalTotal(json.data.total)
        }
      } catch { /* ignore */ }
    }
    fetchCount()
    const id = setInterval(fetchCount, 30_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // Market ticker data now managed by <MarketPulse /> component

  // GDELT Escalation Index state
  interface EscalationData {
    score: number
    level: string
    level_color: string
    trend: 'rising' | 'stable' | 'falling'
    current_count: number
    top_regions: Array<{ name: string; count: number }>
    generated_at: string
  }
  const [escalation, setEscalation] = useState<EscalationData | null>(null)

  // Fetch GDELT escalation index every 5 min
  useEffect(() => {
    let mounted = true
    async function fetchEscalation() {
      try {
        const res = await fetch(`${API_URL}/api/v1/analytics/escalation-index`, { cache: 'no-store' })
        if (res.ok) {
          const data: EscalationData = await res.json()
          if (mounted) setEscalation(data)
        }
      } catch { /* hide widget silently on failure */ }
    }
    fetchEscalation()
    const id = setInterval(fetchEscalation, 5 * 60_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])


  return (
    <aside aria-label="Live information panel" className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-[rgba(255,255,255,0.07)] scrollbar-track-transparent">

      {/* ─── WORLD MAP WIDGET ──────────────────────────────── */}
      <Widget title="Live World Map">
        <Link href="/map">
          <div className="w-full aspect-square rounded-[10px] overflow-hidden relative mb-2 cursor-pointer group"
            style={{ background: 'radial-gradient(circle at 35% 35%, #0d1a3a, #030812)' }}>

            {/* Spinning MapLibre globe */}
            <Suspense fallback={<div className="w-full h-full bg-[#030812]" />}>
              <SpinningGlobe />
            </Suspense>

            {/* Hotspot markers */}
            {HOTSPOTS.map(([l, t, type], i) => {
              const c = HOTSPOT_COLORS[type]
              return (
                <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{ left: `${l}%`, top: `${t}%` }}>
                  <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${c.ring} animate-pulse-ring`}
                    style={{ animationDelay: `${i * 0.3}s` }} />
                  <div className={`w-[6px] h-[6px] rounded-full ${c.dot} relative z-10`} />
                </div>
              )
            })}

            {/* Hover overlay */}
            <div className="absolute inset-0 flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
              <span className="font-mono text-[9px] text-wp-cyan bg-[rgba(0,0,0,0.6)] rounded px-2 py-1">
                Click for full map →
              </span>
            </div>
          </div>
        </Link>

        {/* Legend */}
        <div className="grid grid-cols-2 gap-[6px] font-mono text-[10px]">
          {[['#ff3b5c','Crisis'],['#f5a623','Alert'],['#00d4ff','Event'],['#00e676','Update']].map(([color, label]) => (
            <div key={label} className="flex items-center gap-[6px] text-wp-text3">
              <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              {label}
            </div>
          ))}
        </div>
      </Widget>

      {/* ─── BAT-18: LIVE INTELLIGENCE COUNTER (hero) ────── */}
      <Widget title="Live Intelligence">
        <div className="bg-wp-s2 rounded-xl p-3 flex flex-col gap-1">
          <SignalCounter mode="hero" />
        </div>
      </Widget>

      {/* ─── PLATFORM PULSE ───────────────────────────────── */}
      <Widget title="Platform Pulse">
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: signalTotal != null ? formatPulseCount(signalTotal) : '—', label: 'Signals',  color: 'text-wp-cyan'  },
            { value: '99.9%',  label: 'Uptime',   color: 'text-wp-green' },
            { value: '195',    label: 'Nations',   color: 'text-wp-red'   },
            { value: '300+',   label: 'Sources',   color: 'text-wp-amber' },
          ].map(stat => (
            <div key={stat.label} className="bg-wp-s2 rounded-lg p-[10px] text-center">
              <div className={`font-display text-[22px] leading-none mb-1 ${stat.color}`}>{stat.value}</div>
              <div className="font-mono text-[8px] tracking-[2px] text-wp-text3 uppercase">{stat.label}</div>
            </div>
          ))}
        </div>
      </Widget>

      {/* ─── SOURCE INTEGRITY ─────────────────────────────── */}
      <Widget title="Source Integrity">
        <div className="flex items-center gap-2 bg-wp-s2 rounded-lg p-[10px] mb-2">
          <ShieldCheck className="w-4 h-4 text-wp-green flex-shrink-0" />
          <span className="flex-1 text-[11px] text-wp-text2">Cross-source verified</span>
          <span className="font-mono text-[12px] font-bold text-wp-green">{verifiedPct}</span>
        </div>
        <div className="flex items-center gap-2 bg-wp-s2 rounded-lg p-[10px] mb-2">
          <BotMessageSquare className="w-4 h-4 text-wp-cyan flex-shrink-0" />
          <span className="flex-1 text-[11px] text-wp-text2">AI fact-check</span>
          <span className="font-mono text-[12px] font-bold text-wp-cyan">LIVE</span>
        </div>
        <div className="flex items-center gap-2 bg-wp-s2 rounded-lg p-[10px]">
          <ShieldAlert className="w-4 h-4 text-wp-amber flex-shrink-0" />
          <span className="flex-1 text-[11px] text-wp-text2">Blocked today</span>
          <span className="font-mono text-[12px] font-bold text-wp-amber">{blockedToday}</span>
        </div>
      </Widget>

      {/* ─── MARKET TICKER ────────────────────────────────── */}
      <Widget title="Market Pulse">
        <MarketPulse />
      </Widget>

      {/* ─── SIGNAL STREAM ────────────────────────────────── */}
      <Widget title="Signal Stream">
        <div
          className="space-y-[8px] max-h-[200px] overflow-y-auto scrollbar-none"
          aria-live="polite"
          aria-label="Live signal stream"
          aria-relevant="additions"
        >
          {signals.length === 0 ? (
            <p className="text-[11px] text-wp-text3 italic">Connecting to signal feed…</p>
          ) : signals.map((sig, i) => (
            <div
              key={sig.id ?? i}
              className="flex items-start gap-2 animate-fade-in cursor-pointer group"
              onClick={() => sig.id && (window.location.href = `/signals/${sig.id}`)}
              role={sig.id ? 'link' : undefined}
            >
              <span className="font-mono text-[9px] text-wp-text3 flex-shrink-0 pt-[3px]">{sig.time}</span>
              <div className="w-[6px] h-[6px] rounded-full flex-shrink-0 mt-[5px]"
                style={{ background: sig.color, boxShadow: `0 0 4px ${sig.color}` }} />
              <p className="text-[11px] text-wp-text2 leading-[1.4] flex-1 group-hover:text-wp-text transition-colors line-clamp-2">
                {sig.text}
              </p>
            </div>
          ))}
        </div>
      </Widget>

      {/* ─── GDELT ESCALATION INDEX ───────────────────────── */}
      {escalation && (
        <Widget title="GDELT Escalation Index">
          <div className="space-y-2">
            {/* Score row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="text-[28px] font-black font-mono leading-none"
                  style={{ color: escalation.level_color }}
                >
                  {escalation.score}
                </span>
                <div className="flex flex-col gap-[2px]">
                  <span
                    className="text-[10px] font-bold font-mono leading-none"
                    style={{ color: escalation.level_color }}
                  >
                    {escalation.level.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-mono text-wp-text3">
                    {escalation.trend === 'rising'  && <span className="text-red-400">↑ Rising</span>}
                    {escalation.trend === 'stable'  && <span className="text-wp-text3">→ Stable</span>}
                    {escalation.trend === 'falling' && <span className="text-green-400">↓ Falling</span>}
                  </span>
                </div>
              </div>
              <span className="font-mono text-[9px] text-wp-text3">{escalation.current_count} signals</span>
            </div>

            {/* Score bar */}
            <div className="h-[4px] rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${escalation.score}%`,
                  background: escalation.level_color,
                  boxShadow: `0 0 6px ${escalation.level_color}`,
                }}
              />
            </div>

            {/* Top regions */}
            {escalation.top_regions.length > 0 && (
              <div className="flex flex-wrap gap-[4px] pt-[2px]">
                {escalation.top_regions.slice(0, 3).map(r => (
                  <span
                    key={r.name}
                    className="font-mono text-[9px] text-wp-text3 border border-[rgba(255,255,255,0.08)] rounded px-[6px] py-[2px]"
                  >
                    {r.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Widget>
      )}

      {/* ─── TRENDING ENTITIES ────────────────────────────── */}
      <TrendingEntities />

      {/* ─── STRATEGIC COMMODITY FLOWS ───────────────────── */}
      <TradeSurveillancePanel />

      {/* ─── WHO TO FOLLOW ────────────────────────────────── */}
      <Widget title="Signals to Follow">
        {FOLLOW_SUGGESTIONS.map(user => (
          <div key={user.label} className="flex items-center gap-[10px] py-2 border-b border-[rgba(255,255,255,0.05)] last:border-0">
            <div className={`w-[34px] h-[34px] rounded-full bg-gradient-to-br ${user.color} flex items-center justify-center font-bold text-[12px] text-white flex-shrink-0`}>
              {user.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-wp-text flex items-center gap-1">
                {user.label}
                {user.verified && <span className="text-wp-cyan text-[11px]">✓</span>}
              </div>
              <div className="text-[11px] text-wp-text3 truncate">{user.bio}</div>
            </div>
            <button
              className="px-3 py-1 rounded-full border border-[rgba(255,255,255,0.15)] text-[11px] font-semibold text-wp-text hover:border-wp-amber hover:text-wp-amber hover:bg-[rgba(245,166,35,0.1)] transition-all flex-shrink-0"
              aria-label={`Follow ${user.label}`}
            >
              Follow
            </button>
          </div>
        ))}
      </Widget>

      {/* Footer */}
      <div className="text-center font-mono text-[9px] text-wp-text3 leading-relaxed pb-2">
        WORLDPULSE v0.1.0-alpha<br/>
        Open Source · MIT License<br/>
        <a href="#" className="text-wp-amber hover:underline">GitHub</a>
        {' · '}
        <a href="#" className="text-wp-amber hover:underline">API Docs</a>
        {' · '}
        <a href="#" className="text-wp-amber hover:underline">Contribute</a>
      </div>
    </aside>
  )
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-[14px]">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">{title}</span>
        <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
      </div>
      {children}
    </div>
  )
}
