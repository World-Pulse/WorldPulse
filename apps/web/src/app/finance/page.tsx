'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { MarketPulse } from '@/components/MarketPulse'
import { TradeSurveillancePanel } from '@/components/sidebar/TradeSurveillancePanel'
import {
  TrendingUp, LineChart, Building2, Ban, Building, Bitcoin, BarChart3,
  Clock, Newspaper, Landmark as Bank, MapPin,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinanceSignalEntry {
  id:                string
  title:             string
  subcategory:       string | null
  severity:          string
  reliability_score: number
  location_name:     string | null
  country_code:      string | null
  created_at:        string
}

interface SubcategoryBreakdown {
  market_move:  number
  central_bank: number
  sanctions:    number
  corporate:    number
  crypto:       number
  unclassified: number
}

interface FinanceSummary {
  period_hours:          number
  total_signals_24h:     number
  total_signals_6h:      number
  trend_direction:       'escalating' | 'stable' | 'de-escalating'
  subcategory_breakdown: SubcategoryBreakdown
  top_signals:           FinanceSignalEntry[]
  generated_at:          string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  high:     'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  low:      'text-blue-400 bg-blue-500/10 border-blue-500/30',
}

const SUBCATEGORY_LABEL: Record<string, { label: string; color: string }> = {
  market_move:  { label: 'Market Move',   color: 'text-green-400' },
  central_bank: { label: 'Central Bank',  color: 'text-blue-400'  },
  sanctions:    { label: 'Sanctions',     color: 'text-red-400'   },
  corporate:    { label: 'Corporate',     color: 'text-amber-400' },
  crypto:       { label: 'Crypto',        color: 'text-purple-400'},
  unclassified: { label: 'Other Finance', color: 'text-wp-text3'  },
}

const TREND_ICON: Record<string, string> = {
  escalating:    '⬆ Escalating',
  stable:        '→ Stable',
  'de-escalating': '⬇ De-escalating',
}

const TREND_COLOR: Record<string, string> = {
  escalating:    'text-red-400',
  stable:        'text-wp-text2',
  'de-escalating': 'text-green-400',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1_000
  if (diff < 60)    return `${Math.round(diff)}s ago`
  if (diff < 3_600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.round(diff / 3_600)}h ago`
  return `${Math.round(diff / 86_400)}d ago`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SignalRow({ s }: { s: FinanceSignalEntry }) {
  const sub = s.subcategory ? (SUBCATEGORY_LABEL[s.subcategory] ?? SUBCATEGORY_LABEL.unclassified) : SUBCATEGORY_LABEL.unclassified
  const sev = SEV_COLOR[s.severity] ?? SEV_COLOR.low

  return (
    <Link
      href={`/signals/${s.id}`}
      className="flex items-start gap-3 px-4 py-3 hover:bg-wp-s2 transition-colors rounded-lg group"
    >
      <span className={`text-[13px] font-semibold flex-shrink-0 mt-0.5 ${sub.color}`} title={sub.label}>{sub.label.charAt(0)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-wp-text group-hover:text-wp-amber transition-colors leading-snug line-clamp-2">
          {s.title}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-[10px] px-1.5 py-px rounded border font-mono ${sev}`}>
            {s.severity.toUpperCase()}
          </span>
          <span className={`text-[11px] font-medium ${sub.color}`}>{sub.label}</span>
          {s.location_name && (
            <span className="text-[11px] text-wp-text3 inline-flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {s.location_name}</span>
          )}
          <span className="text-[11px] text-wp-text3 ml-auto">{timeAgo(s.created_at)}</span>
        </div>
      </div>
    </Link>
  )
}

function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-wp-text3 text-[12px]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-mono text-[26px] font-bold text-wp-text">{value}</div>
      {sub && <div className="text-[11px] text-wp-text3">{sub}</div>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/v1/finance/summary`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (mounted && json.success) setSummary(json.data as FinanceSummary)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // ── Market Alerts: critical/high severity signals
  const marketAlerts = summary?.top_signals.filter(
    s => s.severity === 'critical' || s.severity === 'high',
  ) ?? []

  // ── Central Bank Watch: central_bank subcategory
  const centralBankSignals = summary?.top_signals.filter(
    s => s.subcategory === 'central_bank',
  ) ?? []

  // ── Finance Feed: all top signals
  const feedSignals = summary?.top_signals ?? []

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

      {/* ── Header ── */}
      <div>
        <h1 className="font-display text-[28px] tracking-wide text-wp-text flex items-center gap-3">
          <LineChart className="w-7 h-7 text-wp-amber" /> Finance Intelligence
        </h1>
        <p className="text-[13px] text-wp-text3 mt-1">
          Real-time financial signals — markets, central banks, sanctions, corporate events, crypto
        </p>
      </div>

      {/* ── Stats row ── */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-[90px] bg-wp-s2 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<BarChart3 className="w-4 h-4" />} label="Signals (24h)"  value={summary.total_signals_24h} />
          <StatCard icon={<Clock className="w-4 h-4" />}  label="Signals (6h)"   value={summary.total_signals_6h} />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="Trend"
            value={<span className={TREND_COLOR[summary.trend_direction]}>{TREND_ICON[summary.trend_direction]}</span>}
          />
          <StatCard
            icon={<Bitcoin className="w-4 h-4" />}
            label="Crypto signals"
            value={summary.subcategory_breakdown.crypto}
            sub={`${summary.subcategory_breakdown.central_bank} central bank`}
          />
        </div>
      ) : null}

      {error && (
        <div className="text-wp-red text-[13px] bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
          Failed to load finance data: {error}
        </div>
      )}

      {/* ── Subcategory breakdown chips ── */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(summary.subcategory_breakdown) as [string, number][]).map(([key, count]) => {
            const meta = SUBCATEGORY_LABEL[key] ?? SUBCATEGORY_LABEL.unclassified
            return (
              <span
                key={key}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-wp-s2 border border-[rgba(255,255,255,0.07)] text-[12px]"
              >
                <span className={`font-semibold ${meta.color}`}>{meta.label.charAt(0)}</span>
                <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                <span className="text-wp-text3 font-mono">{count}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* ── Market Pulse — live prices ── */}
      <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-wp-text flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-live-pulse" />
            Market Pulse
          </h2>
          <span className="text-[11px] text-wp-text3 font-mono">live · 22 instruments</span>
        </div>
        <div className="p-4">
          <MarketPulse extended />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Finance Signal Feed ── */}
        <div className="lg:col-span-2 space-y-0 bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-wp-text flex items-center gap-2">
              <Newspaper className="w-4 h-4" /> Finance Signal Feed
            </h2>
            <span className="text-[11px] text-wp-text3 font-mono">last 24h</span>
          </div>

          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-14 bg-wp-s2 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : feedSignals.length === 0 ? (
            <div className="p-8 text-center text-wp-text3 text-[13px]">
              No finance signals in the last 24h
            </div>
          ) : (
            <div className="divide-y divide-[rgba(255,255,255,0.04)]">
              {feedSignals.map(s => <SignalRow key={s.id} s={s} />)}
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="space-y-4">

          {/* Market Alerts */}
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-wp-red animate-live-pulse" />
              <h2 className="text-[14px] font-semibold text-wp-text">Market Alerts</h2>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-wp-s2 rounded animate-pulse" />)}
              </div>
            ) : marketAlerts.length === 0 ? (
              <div className="p-4 text-[12px] text-wp-text3">No critical/high alerts right now</div>
            ) : (
              <div className="divide-y divide-[rgba(255,255,255,0.04)]">
                {marketAlerts.slice(0, 6).map(s => <SignalRow key={s.id} s={s} />)}
              </div>
            )}
          </div>

          {/* Strategic Commodity Flows */}
          <TradeSurveillancePanel />

          {/* Central Bank Watch */}
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)] flex items-center gap-2">
              <Bank className="w-4 h-4" />
              <h2 className="text-[14px] font-semibold text-wp-text">Central Bank Watch</h2>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-wp-s2 rounded animate-pulse" />)}
              </div>
            ) : centralBankSignals.length === 0 ? (
              <div className="p-4 text-[12px] text-wp-text3">No central bank signals right now</div>
            ) : (
              <div className="divide-y divide-[rgba(255,255,255,0.04)]">
                {centralBankSignals.slice(0, 5).map(s => <SignalRow key={s.id} s={s} />)}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
