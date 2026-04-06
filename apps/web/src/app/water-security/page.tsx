'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const CRISIS_BADGE: Record<string, { label: string; color: string }> = {
  catastrophic: { label: 'CATASTROPHIC', color: 'bg-red-600/20 text-red-400 border-red-500/30' },
  emergency:    { label: 'EMERGENCY',    color: 'bg-orange-600/20 text-orange-400 border-orange-500/30' },
  crisis:       { label: 'CRISIS',       color: 'bg-amber-600/20 text-amber-400 border-amber-500/30' },
  watch:        { label: 'WATCH',        color: 'bg-yellow-600/20 text-yellow-300 border-yellow-500/30' },
  stable:       { label: 'STABLE',       color: 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30' },
}

const STRESS_LABELS: Record<number, string> = {
  0: 'Low', 1: 'Low-Medium', 2: 'Medium-High', 3: 'High', 4: 'Extremely High', 5: 'Arid / Critical',
}

interface Region {
  code: string; name: string; continent: string; crisis_level: string
  indicators: {
    water_stress_index: number; sanitation_access_pct: number
    flood_risk_score: number; drought_risk_score: number; water_quality_index: number
  }
  trend: string; trend_detail: string; top_threats: string[]
  population_m: number; pop_water_insecure_m: number; related_signals: number
}

interface Summary {
  total_regions: number; catastrophic: number; emergency: number; crisis: number
  watch: number; stable: number; avg_water_stress: number; avg_sanitation_access: number
  total_water_insecure_m: number
  most_affected: { name: string; code: string; stress: number }[]
  most_improved: { name: string; code: string; detail: string }[]
  continent_breakdown: { continent: string; count: number; avg_stress: number; water_insecure_m: number }[]
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-[2px] text-wp-text3 uppercase">{label}</span>
      <span className={`text-[24px] font-bold leading-none ${color ?? 'text-wp-text'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="font-mono text-[11px] text-wp-text3">{sub}</span>}
    </div>
  )
}

function StressBar({ level }: { level: number }) {
  const pct = Math.round((level / 5) * 100)
  const color = pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-orange-500' : pct >= 40 ? 'bg-amber-500' : pct >= 20 ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-[6px] bg-wp-s3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-wp-text3 w-8 text-right">{level.toFixed(1)}</span>
    </div>
  )
}

export default function WaterSecurityPage() {
  const [regions, setRegions]   = useState<Region[]>([])
  const [summary, setSummary]   = useState<Summary | null>(null)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [continent, setContinent] = useState('')
  const [crisisFilter, setCrisisFilter] = useState('')
  const [sort, setSort]         = useState('water_stress_index')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (code: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (continent) params.set('continent', continent)
      if (crisisFilter) params.set('crisis_level', crisisFilter)
      if (sort) params.set('sort', sort)
      params.set('limit', '100')

      const [regRes, sumRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/water-security/regions?${params}`),
        fetch(`${API_URL}/api/v1/water-security/summary`),
      ])

      if (regRes.ok) {
        const d = await regRes.json()
        setRegions(d?.data?.items ?? [])
      }
      if (sumRes.ok) {
        const d = await sumRes.json()
        setSummary(d?.data ?? null)
      }
    } catch { /* API unavailable */ }
    setLoading(false)
  }, [search, continent, crisisFilter, sort])

  useEffect(() => { fetchData() }, [fetchData])

  const trendIcon = (t: string) => t === 'improving' ? String.fromCharCode(8599) : t === 'declining' ? String.fromCharCode(8600) : String.fromCharCode(8594)
  const trendColor = (t: string) => t === 'improving' ? 'text-emerald-400' : t === 'declining' ? 'text-red-400' : 'text-wp-text3'

  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="mb-10 text-center">
          <h1 className="text-[32px] sm:text-[40px] font-bold tracking-tight">Water Security Intelligence</h1>
          <p className="mt-2 text-wp-text2 max-w-2xl mx-auto text-[15px]">
            Real-time monitoring of water stress, sanitation access, flood &amp; drought risk, and water quality across 55+ countries
          </p>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            <StatCard label="Countries Tracked" value={summary.total_regions} color="text-wp-cyan" />
            <StatCard label="Catastrophic" value={summary.catastrophic} color="text-red-400" />
            <StatCard label="Emergency" value={summary.emergency} color="text-orange-400" />
            <StatCard label="Crisis" value={summary.crisis} color="text-amber-400" />
            <StatCard label="Watch" value={summary.watch} color="text-yellow-300" />
            <StatCard label="Water Insecure" value={`${(summary.total_water_insecure_m / 1000).toFixed(1)}B`} sub="population" color="text-red-400" />
          </div>
        )}

        {summary && summary.most_affected.length > 0 && (
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5 mb-6">
            <h2 className="text-[14px] font-semibold tracking-wide text-wp-text2 uppercase mb-4">Most Water-Stressed Countries</h2>
            <div className="space-y-3">
              {summary.most_affected.map((c, i) => (
                <div key={c.code} className="flex items-center gap-3">
                  <span className="font-mono text-[12px] text-wp-text3 w-5">{i + 1}.</span>
                  <span className="text-[14px] font-medium flex-1">{c.name}</span>
                  <span className="font-mono text-[12px] text-red-400">{c.stress.toFixed(1)}/5.0</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary && summary.continent_breakdown.length > 0 && (
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5 mb-6">
            <h2 className="text-[14px] font-semibold tracking-wide text-wp-text2 uppercase mb-4">Regional Breakdown</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.continent_breakdown.map(r => (
                <div key={r.continent} className="bg-wp-bg/50 rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
                  <div className="text-[13px] font-medium">{r.continent}</div>
                  <div className="flex justify-between mt-1">
                    <span className="font-mono text-[10px] text-wp-text3">{r.count} countries</span>
                    <span className="font-mono text-[10px] text-wp-text3">Avg Stress: {r.avg_stress.toFixed(1)}</span>
                  </div>
                  <div className="font-mono text-[10px] text-red-400 mt-1">{r.water_insecure_m.toFixed(1)}M water insecure</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary && summary.most_improved.length > 0 && (
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5 mb-6">
            <h2 className="text-[14px] font-semibold tracking-wide text-emerald-400 uppercase mb-4">Countries Showing Improvement</h2>
            <div className="space-y-2">
              {summary.most_improved.map(c => (
                <div key={c.code} className="flex items-start gap-2">
                  <span className="text-emerald-400">{String.fromCharCode(8599)}</span>
                  <span className="text-[13px]"><span className="font-medium">{c.name}</span> — <span className="text-wp-text3">{c.detail}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          <input type="text" placeholder="Search countries or threats..."
            className="bg-wp-s2 border border-[rgba(255,255,255,0.10)] rounded-lg px-3 py-2 text-[13px] text-wp-text placeholder:text-wp-text3 flex-1 min-w-[200px]"
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className="bg-wp-s2 border border-[rgba(255,255,255,0.10)] rounded-lg px-3 py-2 text-[13px] text-wp-text"
            value={continent} onChange={e => setContinent(e.target.value)}>
            <option value="">All Continents</option>
            {['Africa', 'Middle East', 'Asia', 'Americas', 'Europe', 'Central Asia', 'Oceania'].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className="bg-wp-s2 border border-[rgba(255,255,255,0.10)] rounded-lg px-3 py-2 text-[13px] text-wp-text"
            value={crisisFilter} onChange={e => setCrisisFilter(e.target.value)}>
            <option value="">All Crisis Levels</option>
            {['catastrophic', 'emergency', 'crisis', 'watch', 'stable'].map(l => (
              <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
            ))}
          </select>
          <select className="bg-wp-s2 border border-[rgba(255,255,255,0.10)] rounded-lg px-3 py-2 text-[13px] text-wp-text"
            value={sort} onChange={e => setSort(e.target.value)}>
            <option value="water_stress_index">Sort: Water Stress</option>
            <option value="drought_risk_score">Sort: Drought Risk</option>
            <option value="flood_risk_score">Sort: Flood Risk</option>
            <option value="sanitation_access_pct">Sort: Sanitation Access</option>
            <option value="population">Sort: Population</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>

        {loading ? (
          <div className="text-center py-20 text-wp-text3">Loading water security data...</div>
        ) : regions.length === 0 ? (
          <div className="text-center py-20 text-wp-text3">No countries match your filters.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {regions.map(r => {
              const badge = CRISIS_BADGE[r.crisis_level] ?? CRISIS_BADGE.watch
              const isOpen = expanded.has(r.code)
              return (
                <div key={r.code}
                  className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 cursor-pointer hover:border-wp-cyan/30 transition-colors"
                  onClick={() => toggle(r.code)}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[15px] font-semibold">{r.name}</span>
                    <span className={`text-[9px] font-mono tracking-wider px-2 py-0.5 rounded-full border ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="mb-2">
                    <div className="flex justify-between text-[10px] text-wp-text3 font-mono mb-1">
                      <span>Water Stress</span>
                      <span>{STRESS_LABELS[Math.round(r.indicators.water_stress_index)] ?? 'Unknown'}</span>
                    </div>
                    <StressBar level={r.indicators.water_stress_index} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={trendColor(r.trend)}>{trendIcon(r.trend)} {r.trend}</span>
                    <span className="text-wp-text3">|</span>
                    <span className="text-wp-text3">{r.continent}</span>
                  </div>
                  {isOpen && (
                    <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div><span className="text-wp-text3">Sanitation:</span> <span className="font-mono">{r.indicators.sanitation_access_pct}%</span></div>
                        <div><span className="text-wp-text3">Flood Risk:</span> <span className="font-mono">{r.indicators.flood_risk_score}/10</span></div>
                        <div><span className="text-wp-text3">Drought Risk:</span> <span className="font-mono">{r.indicators.drought_risk_score}/10</span></div>
                        <div><span className="text-wp-text3">Water Quality:</span> <span className="font-mono">{r.indicators.water_quality_index}/100</span></div>
                        <div><span className="text-wp-text3">Population:</span> <span className="font-mono">{r.population_m}M</span></div>
                        <div><span className="text-wp-text3">Water Insecure:</span> <span className="font-mono text-red-400">{r.pop_water_insecure_m}M</span></div>
                      </div>
                      <p className="text-[11px] text-wp-text3 italic">{r.trend_detail}</p>
                      <div className="flex flex-wrap gap-1">
                        {r.top_threats.map(t => (
                          <span key={t} className="text-[9px] font-mono bg-wp-s2 rounded px-1.5 py-0.5 text-wp-text3">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-10 bg-gradient-to-r from-cyan-900/20 to-blue-900/20 border border-cyan-500/20 rounded-xl p-6 text-center">
          <h3 className="text-[18px] font-bold mb-2">WorldPulse Pro — Water Crisis Alerts</h3>
          <p className="text-[13px] text-wp-text3 max-w-lg mx-auto mb-4">
            Get real-time alerts on water crises, drought onset, flood warnings, and infrastructure failures.
          </p>
          <Link href="/pricing" className="inline-block bg-wp-cyan text-wp-bg font-semibold text-[13px] px-5 py-2 rounded-lg hover:bg-wp-cyan/90 transition-colors">
            Upgrade to Pro
          </Link>
        </div>

        <div className="mt-8 text-center text-[11px] text-wp-text3">
          Data sources: WRI Aqueduct | WHO/UNICEF JMP | Circle of Blue | WaterAid | IWA | FEWS NET | FAO AQUASTAT
        </div>
      </div>
    </div>
  )
}
