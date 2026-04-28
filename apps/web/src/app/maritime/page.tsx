'use client'

import { useState, useEffect, useCallback } from 'react'
import { Anchor, AlertTriangle, Ship, Navigation, Shield, TrendingUp } from 'lucide-react'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Chokepoint {
  id: string
  name: string
  lat: number
  lng: number
  region: string
  dailyTransits: number
  pctGlobalTrade: number
}

interface MaritimeStats {
  total_signals: number
  high_severity: number
  military_signals: number
  piracy_alerts: number
}

interface MaritimeSignal {
  id: string
  title: string
  category: string
  severity: string
  reliability_score: number | null
  location_name: string | null
  source_url: string | null
  lat: number | null
  lng: number | null
  created_at: string
}

interface MaritimeOverview {
  chokepoints: Chokepoint[]
  stats: MaritimeStats
  recent_signals: MaritimeSignal[]
}

interface MaritimeVessel {
  id: string
  title: string
  lat: number
  lng: number
  type: 'carrier' | 'vessel' | 'dark_ship'
  fleet: string | null
  status_text: string
  severity: string
  created_at: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low:      'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  info:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

const VESSEL_TYPE_COLORS: Record<string, string> = {
  carrier:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
  vessel:    'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  dark_ship: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const VESSEL_TYPE_LABELS: Record<string, string> = {
  carrier:   'Carrier',
  vessel:    'Vessel',
  dark_ship: 'Dark Ship',
}

const SIGNAL_TABS = ['all', 'piracy', 'naval', 'shipping', 'port', 'sanctions'] as const
type SignalTab = typeof SIGNAL_TABS[number]

const TAB_LABELS: Record<SignalTab, string> = {
  all:       'All Maritime',
  piracy:    'Piracy',
  naval:     'Naval',
  shipping:  'Shipping',
  port:      'Ports',
  sanctions: 'Sanctions',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MaritimePage() {
  const [overview, setOverview] = useState<MaritimeOverview | null>(null)
  const [vessels, setVessels] = useState<MaritimeVessel[]>([])
  const [signals, setSignals] = useState<MaritimeSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<SignalTab>('all')
  const [signalLoading, setSignalLoading] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [activeChokepoint, setActiveChokepoint] = useState<Chokepoint | null>(null)

  const toggleSection = (key: string) =>
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('wp_access_token') : null
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

      const [overviewRes, vesselsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/maritime/overview`, { headers }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/maritime/vessels`, { headers }).then(r => r.ok ? r.json() : null),
      ])

      if (overviewRes?.data) {
        setOverview(overviewRes.data)
        setSignals(overviewRes.data.recent_signals ?? [])
      }
      if (vesselsRes?.data) setVessels(vesselsRes.data)
    } catch {
      // API not available
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchOverview() }, [fetchOverview])

  // Fetch filtered signals when tab changes
  const fetchFilteredSignals = useCallback(async (tab: SignalTab, chokepoint?: Chokepoint | null) => {
    if (tab === 'all' && !chokepoint && overview?.recent_signals) {
      setSignals(overview.recent_signals)
      return
    }
    setSignalLoading(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('wp_access_token') : null
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      const params = new URLSearchParams({ type: tab, limit: '30' })
      if (chokepoint) {
        params.set('near', `${chokepoint.lat},${chokepoint.lng}`)
        params.set('radius', '500')
      }
      const res = await fetch(`${API_BASE}/api/v1/maritime/signals?${params}`, { headers })
      if (res.ok) {
        const json = await res.json()
        setSignals(json.data ?? [])
      }
    } catch {
      // ignore
    } finally {
      setSignalLoading(false)
    }
  }, [overview])

  useEffect(() => { fetchFilteredSignals(activeTab, activeChokepoint) }, [activeTab, activeChokepoint, fetchFilteredSignals])

  // Separate vessel types
  const carriers = vessels.filter(v => v.type === 'carrier')
  const darkShips = vessels.filter(v => v.type === 'dark_ship')
  const regularVessels = vessels.filter(v => v.type === 'vessel')

  return (
    <div className="min-h-screen bg-[#06070d] text-white">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-zinc-800">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-cyan-900/20" />
        <div className="relative max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-2">
            <Anchor className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl font-bold tracking-tight">Maritime Intelligence</h1>
          </div>
          <p className="text-zinc-400 text-lg max-w-2xl">
            Global maritime domain awareness — vessel tracking, chokepoint monitoring, piracy alerts,
            naval movements, and sanctions evasion detection.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">

        {/* Stats Cards */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 animate-pulse">
                <div className="h-8 bg-zinc-800 rounded w-16 mb-2" />
                <div className="h-3 bg-zinc-800 rounded w-24" />
              </div>
            ))}
          </div>
        ) : overview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Maritime Signals (7d)', value: overview.stats.total_signals, icon: Ship, color: 'text-blue-400' },
              { label: 'High Severity', value: overview.stats.high_severity, icon: AlertTriangle, color: 'text-orange-400' },
              { label: 'Naval / Military', value: overview.stats.military_signals, icon: Navigation, color: 'text-cyan-400' },
              { label: 'Piracy Alerts', value: overview.stats.piracy_alerts, icon: Shield, color: 'text-red-400' },
            ].map(card => (
              <div key={card.label} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-2xl font-bold ${card.color}`}>{card.value}</span>
                  <card.icon className={`w-5 h-5 ${card.color} opacity-50`} />
                </div>
                <div className="text-xs text-zinc-500">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Row 2: Two-column — Chokepoints left, Carrier/Vessel intel right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left: Chokepoint Monitor */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-zinc-400 mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              Global Chokepoints
            </h2>
            <div className="space-y-1">
              {(overview?.chokepoints ?? []).map(cp => (
                <button
                  key={cp.id}
                  onClick={() => {
                    if (activeChokepoint?.id === cp.id) {
                      setActiveChokepoint(null)
                    } else {
                      setActiveChokepoint(cp)
                    }
                  }}
                  className={`w-full flex items-center justify-between py-2 px-2 -mx-2 rounded transition-colors ${
                    activeChokepoint?.id === cp.id
                      ? 'bg-blue-500/15 border border-blue-500/30'
                      : 'border border-transparent hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="text-left">
                    <div className={`text-sm ${activeChokepoint?.id === cp.id ? 'text-blue-300' : 'text-zinc-200'}`}>{cp.name}</div>
                    <div className="text-xs text-zinc-500">{cp.region}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-blue-400">{cp.pctGlobalTrade}%</div>
                    <div className="text-xs text-zinc-500">{cp.dailyTransits}/day</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Carrier Strike Groups + Vessel Alerts stacked */}
          <div className="space-y-6">

            {/* Carrier Strike Groups */}
            {carriers.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-zinc-400 mb-4 flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-cyan-400" />
                  Carrier Strike Groups ({carriers.length})
                </h2>
                <div className="space-y-3">
                  {(expandedSections['carriers'] ? carriers : carriers.slice(0, 5)).map(c => (
                    <Link key={c.id} href={`/signals/${c.id}`} className="block">
                      <div className="flex items-start justify-between py-2 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 rounded px-1 -mx-1 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-200 truncate">{c.title}</div>
                          <div className="text-xs text-zinc-500">{c.fleet ?? c.status_text}</div>
                        </div>
                        <span className={`ml-2 shrink-0 px-1.5 py-0.5 text-xs rounded border ${VESSEL_TYPE_COLORS[c.type]}`}>
                          {VESSEL_TYPE_LABELS[c.type]}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {carriers.length > 5 && (
                    <button
                      onClick={() => toggleSection('carriers')}
                      className="w-full text-center text-xs text-cyan-400/70 hover:text-cyan-400 py-1.5 transition-colors"
                    >
                      {expandedSections['carriers'] ? 'Show less' : `Show all ${carriers.length} carrier groups`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Dark Ships */}
            {darkShips.length > 0 && (
              <div className="bg-zinc-900/60 border border-red-900/30 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-red-400 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Dark Ships Detected ({darkShips.length})
                </h2>
                <div className="space-y-3">
                  {(expandedSections['darkShips'] ? darkShips : darkShips.slice(0, 5)).map(ds => (
                    <Link key={ds.id} href={`/signals/${ds.id}`} className="block">
                      <div className="py-2 border-b border-red-900/20 last:border-0 hover:bg-red-900/10 rounded px-1 -mx-1 transition-colors">
                        <div className="text-sm text-zinc-200 truncate">{ds.title}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-zinc-500">{ds.status_text}</span>
                          <span className="text-xs text-red-400">{timeAgo(ds.created_at)}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                  {darkShips.length > 5 && (
                    <button
                      onClick={() => toggleSection('darkShips')}
                      className="w-full text-center text-xs text-red-400/70 hover:text-red-400 py-1.5 transition-colors"
                    >
                      {expandedSections['darkShips'] ? 'Show less' : `Show all ${darkShips.length} dark ships`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Vessel Alerts */}
            {regularVessels.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
                <h2 className="text-sm font-semibold text-zinc-400 mb-4 flex items-center gap-2">
                  <Ship className="w-4 h-4 text-cyan-400" />
                  Vessel Alerts ({regularVessels.length})
                </h2>
                <div className="space-y-2">
                  {(expandedSections['vessels'] ? regularVessels : regularVessels.slice(0, 5)).map(v => (
                    <Link key={v.id} href={`/signals/${v.id}`} className="block">
                      <div className="flex items-start justify-between py-2 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 rounded px-1 -mx-1 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-200 truncate">{v.title}</div>
                          <div className="text-xs text-zinc-500">{v.status_text} &middot; {timeAgo(v.created_at)}</div>
                        </div>
                        <span className={`ml-2 shrink-0 px-1.5 py-0.5 text-xs rounded border ${SEVERITY_COLORS[v.severity] ?? SEVERITY_COLORS.info}`}>
                          {v.severity}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {regularVessels.length > 5 && (
                    <button
                      onClick={() => toggleSection('vessels')}
                      className="w-full text-center text-xs text-cyan-400/70 hover:text-cyan-400 py-1.5 transition-colors"
                    >
                      {expandedSections['vessels'] ? 'Show less' : `Show all ${regularVessels.length} vessel alerts`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Full-width Signal Feed (hero section) */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg">
          {/* Active chokepoint filter banner */}
          {activeChokepoint && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-blue-500/10 border-b border-blue-500/20">
              <span className="text-xs text-blue-300">
                Showing signals near <strong>{activeChokepoint.name}</strong> ({activeChokepoint.region}) — 500 km radius
              </span>
              <button
                onClick={() => setActiveChokepoint(null)}
                className="text-xs text-blue-400/70 hover:text-blue-300 ml-3 shrink-0 transition-colors"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Tab Bar */}
          <div className="border-b border-zinc-800 px-4 pt-4 overflow-x-auto">
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {SIGNAL_TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-2 text-xs font-medium rounded-t transition-colors whitespace-nowrap ${
                      activeTab === tab
                        ? 'bg-zinc-800 text-white border-b-2 border-blue-400'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                ))}
              </div>
              <h2 className="text-sm font-semibold text-zinc-400 hidden sm:block">Maritime Signal Feed</h2>
            </div>
          </div>

          {/* Signal List */}
          <div className="p-4">
            {(loading || signalLoading) ? (
              <div className="space-y-3">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="animate-pulse flex items-start gap-3">
                    <div className="w-16 h-5 bg-zinc-800 rounded" />
                    <div className="flex-1">
                      <div className="h-4 bg-zinc-800 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-zinc-800 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : signals.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <Ship className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No maritime signals in this category yet.</p>
                <p className="text-xs mt-1">Signals will appear as maritime data sources begin ingesting.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {signals.map(signal => (
                  <Link key={signal.id} href={`/signals/${signal.id}`} className="block">
                    <div className="flex items-start gap-3 py-3 px-2 -mx-2 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 rounded transition-colors">
                      <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-xs rounded border font-medium ${SEVERITY_COLORS[signal.severity] ?? SEVERITY_COLORS.info}`}>
                        {signal.severity?.toUpperCase().slice(0, 4)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-200 leading-snug">{signal.title}</div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                          {signal.location_name && <span>{signal.location_name}</span>}
                          <span>{timeAgo(signal.created_at)}</span>
                          <span className="text-zinc-600">{signal.category}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Attribution */}
        <div className="text-center text-xs text-zinc-600 pt-4 pb-8">
          Maritime data sourced from AIS, USNI, IMB, and 15+ maritime intelligence feeds.
          Updated continuously by WorldPulse.
        </div>
      </div>
    </div>
  )
}
