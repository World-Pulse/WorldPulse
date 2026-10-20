'use client'

import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import Link from 'next/link'
import { ShieldCheck, Hourglass } from 'lucide-react'
// TradeSurveillancePanel moved to /finance only
import { TrendingEntities } from '@/components/analytics/TrendingEntities'
import { SignalCounter } from '@/components/SignalCounter'

import { MarketPulse } from '@/components/MarketPulse'
import { SEVERITY_COLOR } from '@/lib/map-style'

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

/** The day's figures from GET /api/v1/signals/count */
interface DayCounts {
  total: number
  last24h: number
  /** null while the API doesn't send it (shown as a placeholder, never as 0) */
  verified24h: number | null
  countries24h: number | null
  outlets24h: number | null
}

const countOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The World Map widget's legend: the map's own severity colours */
const GLOBE_LEGEND: Array<[string, string]> = [
  [SEVERITY_COLOR.critical!, 'Critical'],
  [SEVERITY_COLOR.high!, 'High'],
  [SEVERITY_COLOR.medium!, 'Medium'],
]

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
  // Live figures only (Oct 11, 2026: "99.9% uptime", "195 nations", "300+
  // sources" and "AI fact-check: LIVE" were typed in, and "Cross-source
  // verified" showed the share not flagged as AI slop: 100%)
  const [counts, setCounts]           = useState<DayCounts | null>(null)
  const [hotspotCount, setHotspotCount] = useState<number | null>(null)
  const seenIds = useRef(new Set<string>())

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
          if (mounted && json.success && json.data) {
            const d = json.data
            setCounts({
              total:        Number(d.total) || 0,
              last24h:      Number(d.last24h) || 0,
              verified24h:  countOrNull(d.verified24h),
              countries24h: countOrNull(d.countries24h),
              outlets24h:   countOrNull(d.outlets24h),
            })
          }
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

            {/* The World Map's dark globe with the day's convergence hotspots */}
            <Suspense fallback={<div className="w-full h-full bg-[#030812]" />}>
              <SpinningGlobe onHotspots={setHotspotCount} />
            </Suspense>

            {/* Hover overlay */}
            <div className="absolute inset-0 flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
              <span className="font-mono text-[9px] text-wp-cyan bg-[rgba(0,0,0,0.6)] rounded px-2 py-1">
                Click for full map →
              </span>
            </div>
          </div>
        </Link>

        {/* Legend: what the dots are */}
        <div className="flex items-center gap-3 font-mono text-[10px] text-wp-text3">
          {GLOBE_LEGEND.map(([color, label]) => (
            <span key={label} className="flex items-center gap-[6px]">
              <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              {label}
            </span>
          ))}
        </div>
        <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-wp-text3">
          {hotspotCount ? `${hotspotCount} places` : 'Places'} where several kinds of news meet, last 24h
          <br />© OpenFreeMap · © OpenStreetMap
        </p>
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
            { value: counts ? formatPulseCount(counts.total) : null,        label: 'Signals',   color: 'text-wp-cyan',  title: 'Signals on WorldPulse, all time' },
            { value: counts ? formatPulseCount(counts.last24h) : null,      label: 'Last 24h',  color: 'text-wp-green', title: 'New signals in the last 24 hours' },
            { value: counts?.countries24h != null ? String(counts.countries24h) : null,          label: 'Countries', color: 'text-wp-red',   title: 'Countries the last 24 hours\' signals are in' },
            { value: counts?.outlets24h != null ? formatPulseCount(counts.outlets24h) : null,   label: 'Outlets',   color: 'text-wp-amber', title: 'News websites that reported them, last 24 hours' },
          ].map(stat => (
            <div key={stat.label} className="bg-wp-s2 rounded-lg p-[10px] text-center" title={stat.title}>
              {stat.value != null
                ? <div className={`font-display text-[22px] leading-none mb-1 ${stat.color}`}>{stat.value}</div>
                : <div className="h-[22px] w-12 mx-auto mb-1 rounded bg-white/5 animate-pulse" aria-hidden="true" />}
              <div className="font-mono text-[8px] tracking-[2px] text-wp-text3 uppercase">{stat.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[9px] text-wp-text3">Countries and outlets: last 24 hours</p>
      </Widget>

      {/* ─── SOURCE INTEGRITY ─────────────────────────────── */}
      <Widget title="Source Integrity">
        <div className="flex items-center gap-2 bg-wp-s2 rounded-lg p-[10px] mb-2">
          <ShieldCheck className="w-4 h-4 text-wp-green flex-shrink-0" />
          <span className="flex-1 text-[11px] text-wp-text2">Verified: two different outlets</span>
          {counts?.verified24h != null
            ? <span className="font-mono text-[12px] font-bold text-wp-green">{counts.verified24h.toLocaleString()}</span>
            : <span className="h-[12px] w-10 rounded bg-white/5 animate-pulse" aria-hidden="true" />}
        </div>
        <div className="flex items-center gap-2 bg-wp-s2 rounded-lg p-[10px]">
          <Hourglass className="w-4 h-4 text-wp-amber flex-shrink-0" />
          <span className="flex-1 text-[11px] text-wp-text2">Waiting for a second outlet</span>
          {counts?.verified24h != null
            ? <span className="font-mono text-[12px] font-bold text-wp-amber">{Math.max(0, counts.last24h - counts.verified24h).toLocaleString()}</span>
            : <span className="h-[12px] w-10 rounded bg-white/5 animate-pulse" aria-hidden="true" />}
        </div>
        <p className="mt-2 font-mono text-[9px] leading-relaxed text-wp-text3">
          Last 24 hours. A story is verified when two or more outlets report it and its reliability score reaches 65%.
        </p>
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
            <div className="space-y-[10px] py-1" aria-hidden="true">
              {[88, 72, 80].map(w => <div key={w} className="h-[9px] rounded bg-white/5 animate-pulse" style={{ width: `${w}%` }} />)}
            </div>
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

      {/* Footer */}
      <div className="text-center font-mono text-[9px] text-wp-text3 leading-relaxed pb-2">
        WORLDPULSE v0.1.0-alpha<br/>
        Open Source · MIT License<br/>
        <a href="https://github.com/World-Pulse/WorldPulse" target="_blank" rel="noopener noreferrer" className="text-wp-amber hover:underline">GitHub</a>
        {' · '}
        <Link href="/developers" className="text-wp-amber hover:underline">API Docs</Link>
        {' · '}
        <a href="https://github.com/World-Pulse/WorldPulse" target="_blank" rel="noopener noreferrer" className="text-wp-amber hover:underline">Contribute</a>
        <br/>
        {/* plan C2 (Oct 20, 2026): the help page and how outlets are counted, from every page */}
        <Link href="/help" className="text-wp-amber hover:underline">Help &amp; FAQ</Link>
        {' · '}
        <Link href="/how-we-count" className="text-wp-amber hover:underline">How We Count</Link>
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
