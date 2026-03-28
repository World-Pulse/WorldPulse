'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ScraperGate1Status } from '@/components/scraper/ScraperGate1Status'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceHealth {
  sourceId: string
  sourceName: string
  status: 'healthy' | 'degraded' | 'dead' | 'unknown'
  lastSeen: string | null
  successRate: number
  latencyMs: number | null
  errorCount: number
  successCount: number
  lastError: string | null
}

interface ScraperHealthData {
  summary: {
    total: number
    healthy: number
    degraded: number
    dead: number
    unknown: number
    overallSuccessRate: number
  }
  sources: SourceHealth[]
  generatedAt: string
}

interface SignalStatsData {
  total: number
  last24h: number
  lastHour: number
  bySeverity: { critical: number; high: number; medium: number; low: number; info: number }
  byStatus: { verified: number; pending: number; disputed: number; false: number; retracted: number }
}

interface ServiceCheck {
  status: string
  latency_ms?: number
  error?: string
}

interface SystemHealthData {
  services: {
    db:    ServiceCheck
    redis: ServiceCheck
    kafka: ServiceCheck
  }
}

interface LlmProvider {
  id:         string
  label:      string
  model:      string
  configured: boolean
  active:     boolean
}

interface LlmStatusData {
  activeProvider: string
  providers:      LlmProvider[]
  generatedAt:    string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSec < 60)   return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

function fmtPct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`
}

function fmtNum(n: number) {
  return n.toLocaleString()
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const STATUS_ICON: Record<SourceHealth['status'], string> = {
  healthy:  '🟢',
  degraded: '🟡',
  dead:     '🔴',
  unknown:  '⚪',
}

const STATUS_COLOR: Record<SourceHealth['status'], string> = {
  healthy:  'text-[#00e676] border-[rgba(0,230,118,0.25)] bg-[rgba(0,230,118,0.06)]',
  degraded: 'text-wp-amber border-[rgba(245,166,35,0.25)] bg-[rgba(245,166,35,0.06)]',
  dead:     'text-wp-red   border-[rgba(255,59,92,0.25)]  bg-[rgba(255,59,92,0.06)]',
  unknown:  'text-wp-text3 border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)]',
}

function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4 animate-pulse ${className}`}>
      <div className="h-3 w-2/3 bg-[rgba(255,255,255,0.08)] rounded mb-3" />
      <div className="h-6 w-1/3 bg-[rgba(255,255,255,0.06)] rounded mb-2" />
      <div className="h-3 w-1/2 bg-[rgba(255,255,255,0.05)] rounded" />
    </div>
  )
}

function SourceCard({ s }: { s: SourceHealth }) {
  return (
    <div className={`glass border rounded-xl p-4 ${STATUS_COLOR[s.status]}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-[13px] font-semibold text-wp-text leading-tight">{s.sourceName}</p>
        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono border ${STATUS_COLOR[s.status]}`}>
          {STATUS_ICON[s.status]} {s.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] mb-2">
        <div>
          <span className="text-wp-text3">Success</span>
          <span className="ml-1.5 font-mono text-wp-text">{fmtPct(s.successRate)}</span>
        </div>
        <div>
          <span className="text-wp-text3">Latency</span>
          <span className="ml-1.5 font-mono text-wp-text">{s.latencyMs != null ? `${s.latencyMs}ms` : '—'}</span>
        </div>
        <div>
          <span className="text-wp-text3">Errors</span>
          <span className="ml-1.5 font-mono text-wp-text">{s.errorCount}</span>
        </div>
        <div>
          <span className="text-wp-text3">Last seen</span>
          <span className="ml-1.5 font-mono text-wp-text">{timeAgo(s.lastSeen)}</span>
        </div>
      </div>

      {s.lastError && (
        <p className="text-[11px] font-mono text-wp-red bg-[rgba(255,59,92,0.08)] border border-[rgba(255,59,92,0.2)] rounded px-2 py-1 truncate" title={s.lastError}>
          {s.lastError}
        </p>
      )}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
      <p className="text-[11px] font-mono text-wp-text3 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-[28px] font-mono font-semibold text-wp-text leading-none">{typeof value === 'number' ? fmtNum(value) : value}</p>
      {sub && <p className="text-[11px] text-wp-text2 mt-1">{sub}</p>}
    </div>
  )
}

function SeverityBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className={`text-[11px] font-mono w-16 shrink-0 ${color}`}>{label}</span>
      <div className="flex-1 h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color.replace('text-', 'bg-')}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] font-mono text-wp-text w-12 text-right shrink-0">{fmtNum(count)}</span>
    </div>
  )
}

function ServiceRow({ name, check }: { name: string; check: ServiceCheck }) {
  const ok = check.status === 'ok' || check.status === 'healthy' || check.status === 'connected'
  return (
    <div className="flex items-center justify-between py-3 border-b border-[rgba(255,255,255,0.05)] last:border-0">
      <span className="text-[13px] text-wp-text font-medium">{name}</span>
      <div className="flex items-center gap-3">
        {check.latency_ms != null && (
          <span className="text-[12px] font-mono text-wp-text2">{check.latency_ms}ms</span>
        )}
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-mono ${ok ? 'text-[#00e676]' : 'text-wp-red'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-[#00e676]' : 'bg-wp-red'}`} />
          {check.status}
        </span>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null) // null = loading

  const [scraperData,    setScraperData]    = useState<ScraperHealthData | null>(null)
  const [signalStats,    setSignalStats]    = useState<SignalStatsData | null>(null)
  const [systemHealth,   setSystemHealth]   = useState<SystemHealthData | null>(null)
  const [llmStatus,      setLlmStatus]      = useState<LlmStatusData | null>(null)
  const [securityData,   setSecurityData]   = useState<{ events_last_24h: Record<string, number>; active_lockouts: number; total_blocked_requests: number } | null>(null)

  const [scraperError,   setScraperError]   = useState('')
  const [signalError,    setSignalError]    = useState('')
  const [healthError,    setHealthError]    = useState('')
  const [llmError,       setLlmError]       = useState('')
  const [securityError,  setSecurityError]  = useState('')

  const [loading,        setLoading]        = useState(false)
  const [lastRefresh,    setLastRefresh]    = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Auth check ────────────────────────────────────────────
  useEffect(() => {
    const t = localStorage.getItem('wp_access_token')
    if (!t) { setIsAdmin(false); return }
    const payload = decodeJwtPayload(t)
    const accountType = payload?.accountType ?? payload?.account_type
    setToken(t)
    setIsAdmin(accountType === 'admin')
  }, [])

  // ── Data fetching ─────────────────────────────────────────
  const fetchAll = useCallback(async (tok: string) => {
    setLoading(true)

    await Promise.allSettled([
      // Scraper health
      fetch(`${API_URL}/api/v1/admin/scraper/health`, {
        headers: { Authorization: `Bearer ${tok}` },
      }).then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'Failed to load scraper health')
        setScraperData(d.data)
        setScraperError('')
      }).catch(e => setScraperError(e instanceof Error ? e.message : 'Failed to load scraper health')),

      // Signal stats
      fetch(`${API_URL}/api/v1/admin/signals/stats`, {
        headers: { Authorization: `Bearer ${tok}` },
      }).then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'Failed to load signal stats')
        setSignalStats(d.data)
        setSignalError('')
      }).catch(e => setSignalError(e instanceof Error ? e.message : 'Failed to load signal stats')),

      // System health (public)
      fetch(`${API_URL}/api/v1/health`).then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error('Failed to load system health')
        setSystemHealth(d.data ?? d)
        setHealthError('')
      }).catch(e => setHealthError(e instanceof Error ? e.message : 'Failed to load system health')),

      // LLM provider status
      fetch(`${API_URL}/api/v1/admin/llm-status`, {
        headers: { Authorization: `Bearer ${tok}` },
      }).then(async r => {
        const d = await r.json() as { success: boolean; data: LlmStatusData }
        if (!r.ok) throw new Error('Failed to load LLM status')
        setLlmStatus(d.data)
        setLlmError('')
      }).catch(e => setLlmError(e instanceof Error ? e.message : 'Failed to load LLM status')),

      // Security metrics (Gate 6)
      fetch(`${API_URL}/api/v1/admin/security`, {
        headers: { Authorization: `Bearer ${tok}` },
      }).then(async r => {
        const d = await r.json() as { success: boolean; data: typeof securityData }
        if (!r.ok) throw new Error('Failed to load security metrics')
        setSecurityData(d.data)
        setSecurityError('')
      }).catch(e => setSecurityError(e instanceof Error ? e.message : 'Failed to load security metrics')),
      // Note: Gate 1 stability is handled by <ScraperGate1Status> which self-polls every 60s
    ])

    setLoading(false)
    setLastRefresh(new Date())
  }, [])

  // Trigger fetch once authed
  useEffect(() => {
    if (isAdmin && token) {
      fetchAll(token)
    }
  }, [isAdmin, token, fetchAll])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!isAdmin || !token) return
    intervalRef.current = setInterval(() => fetchAll(token), 30_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isAdmin, token, fetchAll])

  // ── Guard: loading auth ───────────────────────────────────
  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-wp-text2 text-[14px] font-mono animate-pulse">Verifying access…</p>
      </div>
    )
  }

  // ── Guard: not admin ──────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-[48px]">🔒</p>
        <h1 className="font-display text-[24px] tracking-widest text-wp-text">403 — ACCESS DENIED</h1>
        <p className="text-[14px] text-wp-text2">Admin access required.</p>
        <Link href="/" className="mt-4 text-[13px] text-wp-amber hover:underline">← Back to WorldPulse</Link>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────
  const scraperSummary = scraperData?.summary
  const sigSev = signalStats?.bySeverity
  const sigTotal = signalStats?.total ?? 0

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <Link href="/" className="text-[12px] font-mono text-wp-text3 hover:text-wp-amber transition-colors mb-3 inline-block">
            ← worldpulse
          </Link>
          <h1 className="font-display text-[28px] tracking-[2px] text-wp-text">
            ADMIN <span className="text-wp-amber">DASHBOARD</span>
          </h1>
          {lastRefresh && (
            <p className="text-[11px] font-mono text-wp-text3 mt-1">
              Last refreshed {timeAgo(lastRefresh.toISOString())} · auto-refresh every 30s
            </p>
          )}
        </div>

        <button
          onClick={() => token && fetchAll(token)}
          disabled={loading}
          className="shrink-0 bg-wp-surface2 border border-[rgba(255,255,255,0.1)] hover:border-wp-amber text-wp-text text-[13px] font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── SCRAPER SUMMARY STRIP ──────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Scraper Overview</h2>
        {scraperSummary ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total"    value={scraperSummary.total} />
            <StatCard label="Healthy"  value={scraperSummary.healthy}  sub="sources OK" />
            <StatCard label="Degraded" value={scraperSummary.degraded} sub="low success rate" />
            <StatCard label="Dead"     value={scraperSummary.dead}     sub="no recent data" />
            <StatCard label="Unknown"  value={scraperSummary.unknown}  sub="never seen" />
            <StatCard label="Overall"  value={fmtPct(scraperSummary.overallSuccessRate)} sub="success rate" />
          </div>
        ) : scraperError ? (
          <div className="glass border border-[rgba(255,59,92,0.3)] rounded-xl px-5 py-4 text-[13px] text-wp-red">{scraperError}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}
      </section>

      {/* ── GATE 1 STABILITY CLOCK ─────────────────────────── */}
      <section className="mb-8">
        <ScraperGate1Status token={token} />
      </section>

      {/* ── SCRAPER HEALTH GRID ────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Scraper Sources</h2>
        {scraperData ? (
          scraperData.sources.length === 0 ? (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl px-5 py-8 text-center text-[13px] text-wp-text2">
              No scraper sources registered yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {scraperData.sources.map(s => <SourceCard key={s.sourceId} s={s} />)}
            </div>
          )
        ) : scraperError ? null : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} className="h-36" />)}
          </div>
        )}
      </section>

      {/* ── SIGNAL STATS + SYSTEM HEALTH ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">

        {/* Signal stats */}
        <section>
          <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Signal Statistics</h2>
          {signalStats ? (
            <div className="flex flex-col gap-4">
              {/* Count cards */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Total"     value={signalStats.total} />
                <StatCard label="Last 24h"  value={signalStats.last24h} />
                <StatCard label="Last Hour" value={signalStats.lastHour} />
              </div>

              {/* Severity breakdown */}
              <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
                <p className="text-[11px] font-mono text-wp-text3 uppercase tracking-wider mb-3">By Severity</p>
                <div className="flex flex-col gap-2.5">
                  <SeverityBar label="critical" count={sigSev?.critical ?? 0} total={sigTotal} color="text-wp-red" />
                  <SeverityBar label="high"     count={sigSev?.high     ?? 0} total={sigTotal} color="text-[#ff9500]" />
                  <SeverityBar label="medium"   count={sigSev?.medium   ?? 0} total={sigTotal} color="text-wp-amber" />
                  <SeverityBar label="low"      count={sigSev?.low      ?? 0} total={sigTotal} color="text-[#00e676]" />
                  <SeverityBar label="info"     count={sigSev?.info     ?? 0} total={sigTotal} color="text-wp-text2" />
                </div>
              </div>

              {/* Status breakdown */}
              <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
                <p className="text-[11px] font-mono text-wp-text3 uppercase tracking-wider mb-3">By Status</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {([
                    ['verified',  signalStats.byStatus.verified,  'text-[#00e676]'],
                    ['pending',   signalStats.byStatus.pending,   'text-wp-amber'],
                    ['disputed',  signalStats.byStatus.disputed,  'text-[#00d4ff]'],
                    ['false',     signalStats.byStatus.false,     'text-wp-red'],
                    ['retracted', signalStats.byStatus.retracted, 'text-wp-text3'],
                  ] as [string, number, string][]).map(([label, count, color]) => (
                    <div key={label} className="bg-[rgba(255,255,255,0.03)] rounded-lg py-2 px-1">
                      <p className={`text-[18px] font-mono font-semibold ${color}`}>{fmtNum(count)}</p>
                      <p className="text-[10px] font-mono text-wp-text3 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : signalError ? (
            <div className="glass border border-[rgba(255,59,92,0.3)] rounded-xl px-5 py-4 text-[13px] text-wp-red">{signalError}</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
              <SkeletonCard className="h-32" />
              <SkeletonCard className="h-24" />
            </div>
          )}
        </section>

        {/* System health */}
        <section>
          <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">System Health</h2>
          {systemHealth ? (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
              {systemHealth.services ? (
                <>
                  <ServiceRow name="PostgreSQL" check={systemHealth.services.db    ?? { status: 'unknown' }} />
                  <ServiceRow name="Redis"      check={systemHealth.services.redis ?? { status: 'unknown' }} />
                  <ServiceRow name="Kafka"      check={systemHealth.services.kafka ?? { status: 'unknown' }} />
                </>
              ) : (
                <p className="text-[13px] text-wp-text2 py-4 text-center">Health data format unexpected.</p>
              )}
            </div>
          ) : healthError ? (
            <div className="glass border border-[rgba(255,59,92,0.3)] rounded-xl px-5 py-4 text-[13px] text-wp-red">{healthError}</div>
          ) : (
            <SkeletonCard className="h-40" />
          )}
        </section>

        {/* AI Provider Status */}
        <section>
          <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">AI Summary Provider</h2>
          {llmStatus ? (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
              {llmStatus.providers.map((p) => {
                const PROVIDER_STYLE: Record<string, { icon: string; color: string; bg: string }> = {
                  anthropic:  { icon: '🟠', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
                  openai:     { icon: '🟢', color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
                  gemini:     { icon: '🔵', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
                  openrouter: { icon: '🟣', color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
                  ollama:     { icon: '🏠', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)'  },
                  extractive: { icon: '📝', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
                }
                const style = PROVIDER_STYLE[p.id] ?? PROVIDER_STYLE['extractive']!
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-2.5 border-b border-[rgba(255,255,255,0.05)] last:border-0"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[15px]">{style.icon}</span>
                      <div>
                        <p className="text-[13px] font-medium text-wp-text leading-tight">{p.label}</p>
                        <p className="text-[11px] font-mono text-wp-text3">{p.model}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.active ? (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider"
                          style={{ background: style.bg, color: style.color }}
                        >
                          ✓ active
                        </span>
                      ) : p.configured ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-[rgba(255,255,255,0.05)] text-wp-text3">
                          configured
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider text-wp-text3 opacity-40">
                          not set
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              <p className="text-[11px] font-mono text-wp-text3 mt-3 pt-3 border-t border-[rgba(255,255,255,0.05)]">
                Priority chain: Anthropic → OpenAI → Gemini → OpenRouter → Ollama → Extractive
              </p>
            </div>
          ) : llmError ? (
            <div className="glass border border-[rgba(255,59,92,0.3)] rounded-xl px-5 py-4 text-[13px] text-wp-red">{llmError}</div>
          ) : (
            <SkeletonCard className="h-52" />
          )}
        </section>
        {/* Security Dashboard (Gate 6) */}
        <section>
          <h2 className="text-[12px] font-mono text-wp-text3 uppercase tracking-widest mb-3">Security (Last 24h)</h2>
          {securityData ? (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center">
                  <p className="text-[24px] font-mono font-bold text-wp-amber">{securityData.total_blocked_requests}</p>
                  <p className="text-[11px] text-wp-text3">Blocked Requests</p>
                </div>
                <div className="text-center">
                  <p className="text-[24px] font-mono font-bold text-wp-red">{securityData.active_lockouts}</p>
                  <p className="text-[11px] text-wp-text3">Active Lockouts</p>
                </div>
                <div className="text-center">
                  <p className="text-[24px] font-mono font-bold text-[#00e676]">
                    {securityData.total_blocked_requests === 0 ? 'CLEAN' : 'ALERT'}
                  </p>
                  <p className="text-[11px] text-wp-text3">Status</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {Object.entries(securityData.events_last_24h)
                  .filter(([, count]) => count > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([event, count]) => (
                    <div key={event} className="flex items-center justify-between py-1.5 border-b border-[rgba(255,255,255,0.05)] last:border-0">
                      <span className="text-[12px] font-mono text-wp-text2">{event.replace(/_/g, ' ')}</span>
                      <span className="text-[12px] font-mono font-semibold text-wp-amber">{count}</span>
                    </div>
                  ))}
                {Object.values(securityData.events_last_24h).every(c => c === 0) && (
                  <p className="text-[12px] text-[#00e676] text-center py-2 font-mono">No security events in the last 24 hours</p>
                )}
              </div>
            </div>
          ) : securityError ? (
            <div className="glass border border-[rgba(255,59,92,0.3)] rounded-xl px-5 py-4 text-[13px] text-wp-red">{securityError}</div>
          ) : (
            <SkeletonCard className="h-40" />
          )}
        </section>
      </div>

    </div>
  )
}
