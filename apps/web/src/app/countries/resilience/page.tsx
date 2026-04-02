'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RankingEntry {
  country_code:    string
  country_name:    string
  composite_score: number
  risk_level:      string
  risk_color:      string
  signal_count:    number
  trend:           string
  trend_delta:     number
}

interface RankingsResponse {
  success:      boolean
  total:        number
  period_days:  number
  rankings:     RankingEntry[]
  generated_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flagEmoji(code: string): string {
  return String.fromCodePoint(...code.split('').map(c => 0x1F1E0 - 65 + c.charCodeAt(0)))
}

const TREND_ICON: Record<string, string>  = { improving: '↑', stable: '→', deteriorating: '↓' }
const TREND_COLOR: Record<string, string> = {
  improving:     'text-[#00e676]',
  stable:        'text-wp-text3',
  deteriorating: 'text-[#ff3b5c]',
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="h-1.5 bg-wp-s3 rounded-full overflow-hidden w-full">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, backgroundColor: color }}
      />
    </div>
  )
}

function RiskBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="font-mono text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap"
      style={{
        backgroundColor: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label.toUpperCase()}
    </span>
  )
}

function HeroCard({ entry, rank }: { entry: RankingEntry; rank: number }) {
  const isGood = rank <= 5
  return (
    <Link
      href={`/countries/${entry.country_code.toLowerCase()}`}
      className="block bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl p-5 hover:border-[rgba(255,255,255,0.18)] transition-all no-underline group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-wp-text3">#{rank}</span>
          <span className="text-[28px] leading-none">{flagEmoji(entry.country_code)}</span>
        </div>
        <RiskBadge label={entry.risk_level} color={entry.risk_color} />
      </div>

      <p className="text-wp-text text-[15px] font-semibold leading-tight mb-1 group-hover:text-wp-amber transition-colors">
        {entry.country_name}
      </p>
      <p className="font-mono text-[10px] text-wp-text3 mb-3">{entry.country_code}</p>

      <div className="flex items-end justify-between mb-2">
        <span
          className="font-display text-[36px] leading-none font-bold"
          style={{ color: entry.risk_color }}
        >
          {entry.composite_score}
        </span>
        <span className={`font-mono text-[13px] ${TREND_COLOR[entry.trend] ?? 'text-wp-text3'}`}>
          {TREND_ICON[entry.trend] ?? '→'}{' '}
          {entry.trend_delta !== 0
            ? `${entry.trend_delta > 0 ? '+' : ''}${entry.trend_delta}`
            : ''}
        </span>
      </div>

      <ScoreBar score={entry.composite_score} color={entry.risk_color} />

      <p className="font-mono text-[9px] text-wp-text3 mt-2">
        {entry.signal_count.toLocaleString()} signals · {isGood ? 'Most Resilient' : 'Highest Risk'}
      </p>
    </Link>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-wp-s3 rounded ${className}`} />
}

// ─── Page ────────────────────────────────────────────────────────────────────

type SortKey = 'composite_score' | 'country_name' | 'signal_count'

export default function ResilienceRankingsPage() {
  const [data, setData]         = useState<RankingsResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [sortKey, setSortKey]   = useState<SortKey>('composite_score')
  const [sortAsc, setSortAsc]   = useState(false)
  const [filterLevel, setFilterLevel] = useState<string>('all')

  useEffect(() => {
    setLoading(true)
    fetch(`${API_URL}/api/v1/countries/resilience/rankings?limit=200&min_signals=3`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(e.error ?? 'Failed to load')))
      .then((d: RankingsResponse) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(key === 'country_name') }
  }

  const sortedFiltered = (data?.rankings ?? [])
    .filter(r => filterLevel === 'all' || r.risk_level === filterLevel)
    .sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : (Number(va) - Number(vb))
      return sortAsc ? cmp : -cmp
    })

  const top5    = (data?.rankings ?? []).slice(0, 5)
  const bottom5 = (data?.rankings ?? []).slice(-5).reverse()

  const RISK_LEVELS = ['all', 'Low', 'Moderate', 'Elevated', 'High', 'Critical']

  const SortArrow = ({ k }: { k: SortKey }) =>
    sortKey === k ? <span className="text-wp-amber">{sortAsc ? ' ↑' : ' ↓'}</span> : null

  return (
    <div className="min-h-[calc(100vh-52px)] bg-wp-bg">

      {/* Sticky header */}
      <div className="sticky top-[52px] glass border-b border-[rgba(255,255,255,0.07)] z-50 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <Link
            href="/countries"
            className="flex items-center gap-1.5 text-wp-text3 hover:text-wp-text transition-colors text-[12px] font-mono no-underline"
          >
            ← Countries
          </Link>
          <span className="text-[rgba(255,255,255,0.15)]">/</span>
          <span className="font-mono text-[12px] text-wp-text3">Resilience Rankings</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* ── Hero header ─────────────────────────────────────────────────── */}
        <div>
          <h1 className="font-display text-[28px] tracking-[2px] text-wp-text leading-tight">
            Country Resilience Rankings
          </h1>
          <p className="text-wp-text2 text-[14px] mt-1">
            Composite stability index based on real-time signal analysis
          </p>
          <div className="mt-3 px-4 py-3 bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl">
            <p className="font-mono text-[11px] text-wp-text3">
              Scores computed from 30-day signal window. Higher score = more stable / resilient.
              Dimensions: Security (25%), Political (20%), Economic (20%), Environmental (15%),
              Infrastructure (10%), Cyber (10%).
            </p>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-[#ff3b5c22] border border-[#ff3b5c44] rounded-xl">
            <p className="text-[#ff3b5c] text-[13px]">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        ) : data && (
          <>
            {/* ── Top 5 Most Resilient ────────────────────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-[#00e676]" />
                <p className="font-mono text-[11px] text-wp-text3 tracking-widest uppercase">
                  Top 5 Most Resilient
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {top5.map((entry, i) => (
                  <HeroCard key={entry.country_code} entry={entry} rank={i + 1} />
                ))}
              </div>
            </section>

            {/* ── Top 5 Most At-Risk ───────────────────────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-[#ff3b5c]" />
                <p className="font-mono text-[11px] text-wp-text3 tracking-widest uppercase">
                  Top 5 Most At-Risk
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {bottom5.map((entry, i) => (
                  <HeroCard
                    key={entry.country_code}
                    entry={entry}
                    rank={(data.rankings.length) - (bottom5.length - 1 - i)}
                  />
                ))}
              </div>
            </section>

            {/* ── Filter bar ───────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase mr-1">Filter:</span>
              {RISK_LEVELS.map(level => (
                <button
                  key={level}
                  onClick={() => setFilterLevel(level)}
                  className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-all capitalize ${
                    filterLevel === level
                      ? 'bg-wp-amber text-black border-wp-amber'
                      : 'bg-wp-s2 text-wp-text3 border-[rgba(255,255,255,0.07)] hover:border-[rgba(255,255,255,0.18)]'
                  }`}
                >
                  {level}
                </button>
              ))}
              <span className="ml-auto font-mono text-[10px] text-wp-text3">
                {sortedFiltered.length} countries
              </span>
            </div>

            {/* ── Full sortable table ──────────────────────────────────────── */}
            <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 px-5 py-3 border-b border-[rgba(255,255,255,0.07)] bg-wp-s2">
                <span className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase">#</span>
                <button
                  onClick={() => handleSort('country_name')}
                  className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase text-left hover:text-wp-text transition-colors"
                >
                  Country<SortArrow k="country_name" />
                </button>
                <button
                  onClick={() => handleSort('composite_score')}
                  className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase text-right hover:text-wp-text transition-colors"
                >
                  Score<SortArrow k="composite_score" />
                </button>
                <span className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase text-right hidden sm:block">
                  Risk
                </span>
                <span className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase text-right hidden md:block">
                  Trend
                </span>
                <button
                  onClick={() => handleSort('signal_count')}
                  className="font-mono text-[9px] text-wp-text3 tracking-widest uppercase text-right hover:text-wp-text transition-colors hidden lg:block"
                >
                  Signals<SortArrow k="signal_count" />
                </button>
              </div>

              {sortedFiltered.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-wp-text3 text-[13px]">No countries match this filter.</p>
                </div>
              ) : (
                <div className="divide-y divide-[rgba(255,255,255,0.04)]">
                  {sortedFiltered.map((entry, idx) => {
                    const globalRank = data.rankings.findIndex(r => r.country_code === entry.country_code) + 1
                    return (
                      <Link
                        key={entry.country_code}
                        href={`/countries/${entry.country_code.toLowerCase()}`}
                        className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 items-center px-5 py-3 hover:bg-wp-s2 transition-colors no-underline group"
                      >
                        {/* Rank */}
                        <span className="font-mono text-[11px] text-wp-text3 w-6 text-right">
                          {globalRank}
                        </span>

                        {/* Country */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-[18px] leading-none flex-shrink-0">{flagEmoji(entry.country_code)}</span>
                          <div className="min-w-0">
                            <p className="text-wp-text text-[13px] leading-tight truncate group-hover:text-wp-amber transition-colors">
                              {entry.country_name}
                            </p>
                            <p className="font-mono text-[9px] text-wp-text3">{entry.country_code}</p>
                          </div>
                        </div>

                        {/* Score + bar */}
                        <div className="flex flex-col items-end gap-1 w-20">
                          <span
                            className="font-display text-[18px] leading-none font-bold"
                            style={{ color: entry.risk_color }}
                          >
                            {entry.composite_score}
                          </span>
                          <ScoreBar score={entry.composite_score} color={entry.risk_color} />
                        </div>

                        {/* Risk badge */}
                        <div className="hidden sm:block">
                          <RiskBadge label={entry.risk_level} color={entry.risk_color} />
                        </div>

                        {/* Trend */}
                        <div className={`hidden md:flex items-center gap-1 font-mono text-[12px] ${TREND_COLOR[entry.trend] ?? 'text-wp-text3'}`}>
                          <span>{TREND_ICON[entry.trend] ?? '→'}</span>
                          {entry.trend_delta !== 0 && (
                            <span className="text-[10px]">
                              {entry.trend_delta > 0 ? '+' : ''}{entry.trend_delta}
                            </span>
                          )}
                        </div>

                        {/* Signal count */}
                        <span className="hidden lg:block font-mono text-[11px] text-wp-text3 text-right">
                          {entry.signal_count.toLocaleString()}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <p className="font-mono text-[10px] text-wp-text3 text-center">
              {data.total} countries · 30-day window · updated {new Date(data.generated_at).toLocaleTimeString()}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
