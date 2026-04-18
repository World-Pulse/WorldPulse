'use client'

/**
 * Cyber Threat Intelligence Page
 *
 * Displays real-time cyber threat intelligence from CISA Known Exploited
 * Vulnerabilities (KEV) catalogue and AlienVault OTX threat pulses.
 *
 * Data is served by /api/v1/cyber/{recent,summary}.
 */

import { useEffect, useState, useCallback } from 'react'
import { ShieldAlert, CheckCircle, Shield, Search } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.world-pulse.io'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CyberThreatSignal {
  id:                string
  title:             string
  summary:           string
  severity:          string
  reliability_score: number
  source_url:        string | null
  published_at:      string
  source_slug:       string
}

interface CyberThreatSummary {
  total_24h:       number
  cisa_kev_count:  number
  otx_count:       number
  critical_count:  number
  high_count:      number
  medium_count:    number
  low_count:       number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { label: '24h', value: '24h' },
  { label: '48h', value: '48h' },
  { label: '7d',  value: '7d'  },
]

const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#8892a4',
}

const SEV_BG: Record<string, string> = {
  critical: 'rgba(239,68,68,0.15)',
  high:     'rgba(249,115,22,0.15)',
  medium:   'rgba(234,179,8,0.10)',
  low:      'rgba(136,146,164,0.08)',
}

const SEV_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityPill({ severity }: { severity: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider"
      style={{
        color:      SEV_COLOR[severity] ?? '#8892a4',
        background: SEV_BG[severity]    ?? SEV_BG.low,
      }}
    >
      {SEV_LABEL[severity] ?? severity.toUpperCase()}
    </span>
  )
}

function SourceBadge({ slug }: { slug: string }) {
  const isCisa = slug === 'cisa-kev'
  const label  = isCisa ? 'CISA KEV' : 'OTX Pulse'
  const color  = isCisa ? '#60a5fa' : '#a78bfa'
  const bg     = isCisa ? 'rgba(96,165,250,0.12)' : 'rgba(167,139,250,0.12)'
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  )
}

function ReliabilityDots({ score }: { score: number }) {
  const filled = Math.round(score * 5)
  return (
    <span className="inline-flex items-center gap-0.5" title={`${Math.round(score * 100)}% reliability`}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: i <= filled ? '#60a5fa' : 'rgba(255,255,255,0.12)' }}
        />
      ))}
    </span>
  )
}

function KpiCard({
  label,
  value,
  color,
  loading,
}: {
  label:   string
  value:   number
  color:   string
  loading: boolean
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="text-2xl font-bold font-mono" style={{ color }}>
        {loading ? '—' : value}
      </div>
      <div className="text-xs text-wp-text3 mt-1">{label}</div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 animate-pulse h-20" />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CyberThreatsPage() {
  const [signals,     setSignals]     = useState<CyberThreatSignal[]>([])
  const [summary,     setSummary]     = useState<CyberThreatSummary | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [timeWindow,  setTimeWindow]  = useState('24h')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async (w: string) => {
    setLoading(true)
    setError(null)
    try {
      const [recentRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/cyber/recent?window=${w}`, { cache: 'no-store' }),
        fetch(`${API_URL}/api/v1/cyber/summary`,            { cache: 'no-store' }),
      ])
      if (!recentRes.ok || !summaryRes.ok) {
        throw new Error('Failed to load cyber threat data')
      }
      const [recentJson, summaryJson] = await Promise.all([recentRes.json(), summaryRes.json()])
      setSignals((recentJson?.data?.signals as CyberThreatSignal[]) ?? [])
      setSummary((summaryJson?.data as CyberThreatSummary) ?? null)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(timeWindow)
    const interval = setInterval(() => void fetchData(timeWindow), 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [timeWindow, fetchData])

  const cisaSignals = signals.filter(s => s.source_slug === 'cisa-kev')
  const otxSignals  = signals.filter(s => s.source_slug === 'otx-threats')
  const isEmpty     = !loading && signals.length === 0

  return (
    <div className="min-h-screen bg-[#06070d] text-white">

      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.08] px-4 py-4 md:px-8">
        <div className="mx-auto max-w-6xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-red-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Cyber Threat Intelligence</h1>
              <p className="text-sm text-wp-text2 mt-0.5">
                Real-time vulnerabilities &amp; threat pulses via CISA KEV + AlienVault OTX
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-wp-text3">Updated {timeAgo(lastUpdated.toISOString())}</span>
            )}
            <button
              onClick={() => void fetchData(timeWindow)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-wp-text2 hover:bg-white/[0.05] transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 space-y-6">

        {/* ─── KPI Cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="Total 24h Threats"
            value={summary?.total_24h ?? 0}
            color="#e2e8f0"
            loading={loading}
          />
          <KpiCard
            label="CISA KEV"
            value={summary?.cisa_kev_count ?? cisaSignals.length}
            color="#60a5fa"
            loading={loading}
          />
          <KpiCard
            label="OTX Pulses"
            value={summary?.otx_count ?? otxSignals.length}
            color="#a78bfa"
            loading={loading}
          />
          <KpiCard
            label="Critical"
            value={summary?.critical_count ?? 0}
            color="#ef4444"
            loading={loading}
          />
        </div>

        {/* ─── Time window selector ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-wp-text3">Time window:</span>
          {WINDOW_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTimeWindow(opt.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                timeWindow === opt.value
                  ? 'bg-[#ef4444] text-white'
                  : 'border border-white/10 text-wp-text2 hover:bg-white/[0.05]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ─── Empty state ─────────────────────────────────────────────────── */}
        {isEmpty && !error && (
          <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-6 text-center">
            <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
            <div className="font-semibold text-green-400">No Active Threats Detected</div>
            <div className="text-sm text-wp-text3 mt-1">
              No cyber threat signals in the selected time window
            </div>
          </div>
        )}

        {/* ─── Threat Feed Timeline ────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-wp-text2 mb-3 uppercase tracking-wider">
            Threat Feed
          </h2>

          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          )}

          {!loading && signals.length === 0 && !error && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center text-wp-text3 text-sm">
              No threat signals in the selected time window.
            </div>
          )}

          {!loading && signals.length > 0 && (
            <div className="space-y-2">
              {signals.map(sig => (
                <div
                  key={sig.id}
                  className={`rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 transition-colors ${
                    sig.source_url ? 'hover:bg-white/[0.05] cursor-pointer' : ''
                  }`}
                  style={{
                    borderLeftWidth: 3,
                    borderLeftColor: SEV_COLOR[sig.severity] ?? '#8892a4',
                  }}
                  onClick={() => {
                    if (sig.source_url) globalThis.open(sig.source_url, '_blank', 'noopener,noreferrer')
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5">
                      {sig.source_slug === 'cisa-kev' ? <Shield className="w-5 h-5 text-blue-400" /> : <Search className="w-5 h-5 text-purple-400" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <SeverityPill severity={sig.severity} />
                        <SourceBadge slug={sig.source_slug} />
                        <ReliabilityDots score={sig.reliability_score} />
                        <span className="text-xs text-wp-text3">{timeAgo(sig.published_at)}</span>
                      </div>
                      <div className="font-medium text-sm text-white leading-snug">{sig.title}</div>
                      {sig.summary && (
                        <p className="text-xs text-wp-text2 mt-1 line-clamp-2">{sig.summary}</p>
                      )}
                    </div>
                    {sig.source_url && (
                      <a
                        href={sig.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-wp-text3 hover:text-wp-text2 shrink-0 mt-0.5"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── Severity breakdown ──────────────────────────────────────────── */}
        {!loading && summary && summary.total_24h > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-wp-text2 mb-3 uppercase tracking-wider">
              Severity Breakdown (24h)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(
                [
                  { label: 'Critical', count: summary.critical_count, sev: 'critical' },
                  { label: 'High',     count: summary.high_count,     sev: 'high'     },
                  { label: 'Medium',   count: summary.medium_count,   sev: 'medium'   },
                  { label: 'Low',      count: summary.low_count,      sev: 'low'      },
                ] as const
              ).map(item => (
                <div
                  key={item.sev}
                  className="rounded-xl border border-white/[0.08] p-4"
                  style={{ borderLeftWidth: 3, borderLeftColor: SEV_COLOR[item.sev] }}
                >
                  <div className="text-2xl font-bold font-mono" style={{ color: SEV_COLOR[item.sev] }}>
                    {item.count}
                  </div>
                  <div className="text-xs text-wp-text3 mt-1">{item.label}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── About this data ─────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-wp-text3 uppercase tracking-wider mb-2">
            About this data
          </h3>
          <p className="text-xs text-wp-text3 leading-relaxed">
            Cyber threat intelligence is sourced from two authoritative feeds.{' '}
            <a
              href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
              target="_blank"
              rel="noopener noreferrer"
              className="text-wp-text2 hover:text-white underline"
            >
              CISA Known Exploited Vulnerabilities (KEV)
            </a>
            {' '}is maintained by the U.S. Cybersecurity and Infrastructure Security Agency and
            lists vulnerabilities actively exploited in the wild — reliability 0.95.{' '}
            <a
              href="https://otx.alienvault.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-wp-text2 hover:text-white underline"
            >
              AlienVault OTX
            </a>
            {' '}provides community-sourced threat pulses covering malware, phishing, C2 indicators,
            and emerging attack campaigns — reliability 0.82.
          </p>
        </section>

      </div>
    </div>
  )
}
