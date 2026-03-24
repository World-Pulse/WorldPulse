'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

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

export function RightSidebar() {
  const [signals, setSignals]         = useState<LiveSignal[]>([])
  const [signalTotal, setSignalTotal] = useState<number | null>(null)
  const [connectedCount, setConnectedCount] = useState(847213)
  const seenIds = useRef(new Set<string>())

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

  // Simulated connected count drift (websocket-style feel)
  useEffect(() => {
    const id = setInterval(() => {
      setConnectedCount(n => Math.max(100_000, n + Math.floor(Math.random() * 10) - 4))
    }, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <aside aria-label="Live information panel" className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-[rgba(255,255,255,0.07)] scrollbar-track-transparent">

      {/* ─── WORLD MAP WIDGET ──────────────────────────────── */}
      <Widget title="Live World Map">
        <Link href="/map">
          <div className="w-full aspect-square rounded-[10px] overflow-hidden relative mb-2 cursor-pointer group"
            style={{ background: 'radial-gradient(circle at 35% 35%, #0d1a3a, #030812)' }}>

          {/* Globe SVG */}
          <svg viewBox="0 0 268 268" className="w-full h-full opacity-70">
            <defs>
              <radialGradient id="g" cx="38%" cy="35%" r="65%">
                <stop offset="0%" stopColor="#1a3a6e" stopOpacity="0.9"/>
                <stop offset="100%" stopColor="#030812"/>
              </radialGradient>
            </defs>
            <ellipse cx="134" cy="134" rx="128" ry="128" fill="url(#g)"/>
            {/* Simplified continents */}
            {[
              "M60,80 L85,70 L100,82 L95,100 L80,110 L62,105 Z",
              "M100,65 L130,60 L145,75 L148,95 L130,110 L108,108 L98,88 Z",
              "M155,70 L185,65 L200,80 L198,100 L180,112 L160,108 L150,90 Z",
              "M65,120 L90,115 L95,140 L85,160 L65,158 L58,138 Z",
              "M100,120 L140,118 L148,145 L130,170 L105,165 L95,140 Z",
              "M155,120 L185,118 L192,150 L175,168 L152,162 L148,140 Z",
              "M165,85 L205,80 L220,100 L205,115 L168,112 Z",
            ].map((d, i) => <path key={i} d={d} fill="rgba(255,255,255,0.07)"/>)}
            {/* Grid lines */}
            <ellipse cx="134" cy="134" rx="128" ry="128" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
            <ellipse cx="134" cy="134" rx="85" ry="128" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
            <ellipse cx="134" cy="100" rx="108" ry="34" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
            <ellipse cx="134" cy="134" rx="128" ry="10" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
            <ellipse cx="134" cy="168" rx="108" ry="34" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
            <ellipse cx="104" cy="90" rx="35" ry="22" fill="rgba(255,255,255,0.04)"/>
          </svg>

          {/* Hotspot markers */}
          {HOTSPOTS.map(([l, t, type], i) => {
            const c = HOTSPOT_COLORS[type]
            return (
              <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${l}%`, top: `${t}%` }}>
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${c.ring} animate-pulse-ring`}
                  style={{ animationDelay: `${i * 0.3}s` }} />
                <div className={`w-[6px] h-[6px] rounded-full ${c.dot} relative z-10`} />
              </div>
            )
          })}

            {/* Hover overlay */}
            <div className="absolute inset-0 flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
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

      {/* ─── PLATFORM PULSE ───────────────────────────────── */}
      <Widget title="Platform Pulse">
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: signalTotal != null ? signalTotal.toLocaleString() : '…', label: 'Active Signals', color: 'text-wp-amber' },
            { value: connectedCount.toLocaleString(), label: 'Online Now', color: 'text-wp-cyan' },
            { value: '99.2%',  label: 'Uptime',        color: 'text-wp-green' },
            { value: '184',    label: 'Nations',        color: 'text-wp-red' },
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
        {[
          { icon: '🛡️', label: 'Cross-source verified', value: '98.7%',    color: 'text-wp-green' },
          { icon: '🤖', label: 'AI fact-check',          value: 'LIVE',    color: 'text-wp-cyan'  },
          { icon: '⚠️', label: 'Blocked today',          value: '312',     color: 'text-wp-amber' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2 bg-wp-s2 rounded-lg p-[10px] mb-2 last:mb-0">
            <span className="text-[16px]">{item.icon}</span>
            <span className="flex-1 text-[11px] text-wp-text2">{item.label}</span>
            <span className={`font-mono text-[12px] font-bold ${item.color}`}>{item.value}</span>
          </div>
        ))}
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
