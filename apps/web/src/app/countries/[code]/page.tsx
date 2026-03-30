'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { use } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryBreakdown {
  category:        string
  count:           number
  max_severity:    string
  avg_reliability: number | null
}

interface RecentSignal {
  id:               string
  title:            string
  summary:          string | null
  severity:         string
  category:         string
  reliability_score: number | null
  source_count:     number | null
  created_at:       string
  location_name:    string | null
}

interface CountryDetail {
  code:               string
  name:               string
  window:             string
  risk_score:         number
  risk_label:         string
  risk_color:         string
  total_signals:      number
  category_breakdown: CategoryBreakdown[]
  recent_signals:     RecentSignal[]
  hourly_trend:       Array<{ hour: string; count: number }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  breaking:    '#ff3b5c',
  conflict:    '#ff3b5c',
  disaster:    '#ff3b5c',
  critical:    '#ff3b5c',
  climate:     '#00e676',
  science:     '#00d4ff',
  health:      '#00d4ff',
  economy:     '#f5a623',
  geopolitics: '#f5a623',
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-wp-red',
  high:     'text-orange-400',
  medium:   'text-wp-amber',
  low:      'text-yellow-300',
  info:     'text-wp-text3',
}

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-[#ff3b5c22] text-[#ff3b5c] border border-[#ff3b5c44]',
  high:     'bg-[#ff6b3522] text-orange-400 border border-orange-400/30',
  medium:   'bg-[#f5a62322] text-wp-amber border border-[#f5a62344]',
  low:      'bg-[#ffd70022] text-yellow-300 border border-yellow-300/30',
  info:     'bg-wp-s3 text-wp-text3 border border-[rgba(255,255,255,0.07)]',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function flagEmoji(code: string): string {
  return String.fromCodePoint(...code.split('').map(c => 0x1F1E0 - 65 + c.charCodeAt(0)))
}

function computeTrend(hourly: Array<{ hour: string; count: number }>): 'rising' | 'stable' | 'falling' {
  if (hourly.length < 4) return 'stable'
  const mid = Math.floor(hourly.length / 2)
  const recent = hourly.slice(mid).reduce((s, h) => s + h.count, 0)
  const prior  = hourly.slice(0, mid).reduce((s, h) => s + h.count, 0)
  if (prior === 0) return recent > 0 ? 'rising' : 'stable'
  const ratio = recent / prior
  if (ratio > 1.2)  return 'rising'
  if (ratio < 0.8)  return 'falling'
  return 'stable'
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-wp-s3 rounded ${className}`} />
}

function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CountryDetailPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = use(params)
  const [detail, setDetail]   = useState<CountryDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const upperCode = code.toUpperCase()
    setLoading(true)
    setError(null)
    fetch(`${API_URL}/api/v1/countries/${upperCode}?window=7d&limit=10`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(e.error ?? `HTTP error`)))
      .then((data: CountryDetail) => { setDetail(data); setLoading(false) })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [code])

  if (loading) return (
    <div className="min-h-[calc(100vh-52px)] bg-wp-bg">
      <PageSkeleton />
    </div>
  )

  if (error) return (
    <div className="min-h-[calc(100vh-52px)] bg-wp-bg flex flex-col items-center justify-center gap-4 px-4">
      <p className="font-mono text-[11px] text-wp-text3 tracking-widest uppercase">Country Intelligence</p>
      <p className="text-wp-red text-[14px] text-center">{error}</p>
      <Link
        href="/countries"
        className="px-4 py-2 rounded-lg bg-wp-s2 text-wp-text2 text-[12px] hover:bg-wp-s3 transition-all no-underline"
      >
        ← Back to Countries
      </Link>
    </div>
  )

  if (!detail) return null

  const trend        = computeTrend(detail.hourly_trend)
  const topCats      = detail.category_breakdown.slice(0, 4)
  const maxCatCount  = Math.max(...topCats.map(c => c.count), 1)

  const TREND_CONFIG = {
    rising:  { icon: '↑', label: 'Activity rising',   color: 'text-wp-red' },
    stable:  { icon: '→', label: 'Activity stable',   color: 'text-wp-text3' },
    falling: { icon: '↓', label: 'Activity declining', color: 'text-wp-green' },
  } as const

  const trendCfg = TREND_CONFIG[trend]

  return (
    <div className="min-h-[calc(100vh-52px)] bg-wp-bg">
      {/* Back nav */}
      <div className="sticky top-[52px] glass border-b border-[rgba(255,255,255,0.07)] z-50 px-4 sm:px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link
            href="/countries"
            className="flex items-center gap-1.5 text-wp-text3 hover:text-wp-text transition-colors text-[12px] font-mono no-underline"
          >
            ← Countries
          </Link>
          <span className="text-[rgba(255,255,255,0.15)]">/</span>
          <span className="font-mono text-[12px] text-wp-text3">{detail.code}</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Hero header ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          <span className="text-[48px] leading-none" aria-hidden="true">
            {flagEmoji(detail.code)}
          </span>
          <div>
            <h1 className="font-display text-[28px] tracking-[2px] text-wp-text leading-tight">
              {detail.name}
            </h1>
            <p className="font-mono text-[12px] text-wp-text3 tracking-widest mt-0.5">
              {detail.code} · COUNTRY INTELLIGENCE
            </p>
          </div>
        </div>

        {/* ── Risk score panel ─────────────────────────────────────────────── */}
        <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl p-5">
          <p className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase mb-4">Risk Assessment</p>
          <div className="flex items-end gap-6 mb-4">
            <div>
              <span className="font-display text-[52px] leading-none font-bold" style={{ color: detail.risk_color }}>
                {detail.risk_score}
              </span>
              <span className="font-mono text-[14px] text-wp-text3 ml-1">/100</span>
            </div>
            <div className="mb-1">
              <span
                className="font-mono text-[12px] px-3 py-1 rounded-full font-bold"
                style={{ backgroundColor: `${detail.risk_color}22`, color: detail.risk_color, border: `1px solid ${detail.risk_color}44` }}
              >
                {detail.risk_label.toUpperCase()}
              </span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-3 bg-wp-s3 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${detail.risk_score}%`, backgroundColor: detail.risk_color }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="font-mono text-[9px] text-wp-text3">LOW</span>
            <span className="font-mono text-[9px] text-wp-text3">CRITICAL</span>
          </div>
        </div>

        {/* ── Stats row ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* Signal count */}
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <p className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase mb-1">Signals (7d)</p>
            <p className="font-display text-[28px] text-wp-text leading-none">{detail.total_signals.toLocaleString()}</p>
          </div>

          {/* Trend */}
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <p className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase mb-1">Trend</p>
            <div className="flex items-center gap-2">
              <span className={`font-display text-[28px] leading-none font-bold ${trendCfg.color}`}>
                {trendCfg.icon}
              </span>
              <span className={`font-mono text-[11px] ${trendCfg.color}`}>{trendCfg.label}</span>
            </div>
          </div>

          {/* Top category */}
          {topCats[0] && (
            <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 col-span-2 sm:col-span-1">
              <p className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase mb-1">Top Category</p>
              <p
                className="font-display text-[18px] capitalize leading-tight"
                style={{ color: CATEGORY_COLORS[topCats[0].category] ?? '#f5a623' }}
              >
                {topCats[0].category}
              </p>
              <p className="font-mono text-[10px] text-wp-text3">{topCats[0].count} signals</p>
            </div>
          )}
        </div>

        {/* ── Category breakdown ──────────────────────────────────────────── */}
        {topCats.length > 0 && (
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl p-5">
            <p className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase mb-4">Category Breakdown</p>
            <div className="space-y-4">
              {topCats.map(cat => {
                const catColor = CATEGORY_COLORS[cat.category] ?? '#f5a623'
                const barWidth = Math.round((cat.count / maxCatCount) * 100)
                return (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-wp-text text-[14px] capitalize">{cat.category}</span>
                        <span className={`font-mono text-[9px] uppercase ${SEVERITY_COLOR[cat.max_severity] ?? 'text-wp-text3'}`}>
                          {cat.max_severity}
                        </span>
                      </div>
                      <span className="font-mono text-[12px] text-wp-text2">{cat.count}</span>
                    </div>
                    <div className="h-1.5 bg-wp-s3 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${barWidth}%`, backgroundColor: catColor }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Recent signals ──────────────────────────────────────────────── */}
        {detail.recent_signals.length > 0 && (
          <div>
            <p className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase mb-3">Recent Signals</p>
            <div className="space-y-2">
              {detail.recent_signals.map(sig => (
                <Link
                  key={sig.id}
                  href={`/signals/${sig.id}`}
                  className="block p-4 bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl hover:border-[rgba(255,255,255,0.18)] hover:bg-wp-s2 transition-all no-underline group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`font-mono text-[10px] uppercase px-1.5 py-0.5 rounded ${SEVERITY_BG[sig.severity] ?? SEVERITY_BG.info}`}>
                      {sig.severity}
                    </span>
                    <span
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded capitalize"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[sig.category] ?? '#f5a623'}22`,
                        color: CATEGORY_COLORS[sig.category] ?? '#f5a623',
                        border: `1px solid ${CATEGORY_COLORS[sig.category] ?? '#f5a623'}44`,
                      }}
                    >
                      {sig.category}
                    </span>
                    <span className="font-mono text-[10px] text-wp-text3 ml-auto flex-shrink-0">{timeAgo(sig.created_at)}</span>
                  </div>
                  <p className="text-wp-text text-[14px] leading-snug group-hover:text-wp-amber transition-colors line-clamp-2">
                    {sig.title}
                  </p>
                  {sig.location_name && (
                    <p className="text-wp-text3 text-[11px] mt-1">📍 {sig.location_name}</p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer action ───────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Link
            href={`/?category=all&country=${detail.code}`}
            className="flex-1 text-center px-4 py-2.5 rounded-xl bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all no-underline"
          >
            View all signals from {detail.name} →
          </Link>
          <Link
            href="/countries"
            className="px-4 py-2.5 rounded-xl bg-wp-s2 border border-[rgba(255,255,255,0.07)] text-wp-text2 text-[13px] text-center hover:bg-wp-s3 transition-all no-underline"
          >
            ← Back to Countries
          </Link>
        </div>

      </div>
    </div>
  )
}
