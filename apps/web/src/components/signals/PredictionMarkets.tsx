'use client'

import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Outcome {
  name:        string
  probability: number   // 0–1
  price:       number   // 0–100 cents
}

interface PredictionMarket {
  id:          string
  question:    string
  description: string
  outcomes:    Outcome[]
  volume:      number
  liquidity:   number
  endDate:     string | null
  url:         string
  active:      boolean
}

interface PredictionMarketsResponse {
  success: boolean
  data: {
    markets: PredictionMarket[]
    query:   string
    total:   number
    cached:  boolean
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function formatEndDate(d: string | null): string {
  if (!d) return 'Open'
  try {
    const dt  = new Date(d)
    const now = Date.now()
    const ms  = dt.getTime() - now
    if (ms < 0)                    return 'Resolved'
    const days = Math.floor(ms / 86_400_000)
    if (days === 0)                return 'Ends today'
    if (days === 1)                return 'Ends tomorrow'
    if (days < 30)                 return `Ends in ${days}d`
    return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  } catch {
    return 'Open'
  }
}

/** Top-probability outcome, capped for safety */
function leadingOutcome(outcomes: Outcome[]): Outcome | null {
  if (!outcomes.length) return null
  return [...outcomes].sort((a, b) => b.probability - a.probability)[0] ?? null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MarketSkeleton() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3 animate-pulse">
      <div className="h-3 w-2/3 rounded bg-white/[0.06]" />
      <div className="space-y-2">
        <div className="h-2 w-full rounded bg-white/[0.05]" />
        <div className="h-2 w-4/5 rounded bg-white/[0.04]" />
      </div>
      <div className="flex gap-2">
        <div className="h-6 w-16 rounded-full bg-white/[0.06]" />
        <div className="h-6 w-12 rounded-full bg-white/[0.04]" />
      </div>
    </div>
  )
}

interface OutcomeBarProps {
  outcome:  Outcome
  isLead:   boolean
}

function OutcomeBar({ outcome, isLead }: OutcomeBarProps) {
  const pct   = Math.round(outcome.probability * 100)
  const color = isLead ? '#34d399' : '#6b7280'  // emerald-400 or gray-500

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-wp-text2 truncate max-w-[70%]">{outcome.name}</span>
        <span
          className="font-mono text-[12px] font-semibold tabular-nums"
          style={{ color: isLead ? '#34d399' : '#9ca3af' }}
        >
          {pct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color, opacity: isLead ? 1 : 0.5 }}
        />
      </div>
    </div>
  )
}

interface MarketCardProps {
  market: PredictionMarket
}

function MarketCard({ market }: MarketCardProps) {
  const lead      = leadingOutcome(market.outcomes)
  const leadPct   = lead ? Math.round(lead.probability * 100) : 0
  const sentiment = leadPct >= 70 ? 'HIGH' : leadPct >= 50 ? 'MED' : 'SPLIT'
  const sentColor = sentiment === 'HIGH' ? '#34d399' : sentiment === 'MED' ? '#fbbf24' : '#f87171'

  return (
    <a
      href={market.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all p-4 space-y-3 group"
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-wp-text1 leading-[1.5] line-clamp-3">
            {market.question}
          </p>
        </div>
        <div
          className="flex-shrink-0 font-mono text-[8px] tracking-widest uppercase px-1.5 py-0.5 rounded border"
          style={{ color: sentColor, borderColor: sentColor + '40', background: sentColor + '15' }}
        >
          {sentiment}
        </div>
      </div>

      {/* Outcome probability bars */}
      <div className="space-y-2">
        {market.outcomes.slice(0, 3).map((outcome) => (
          <OutcomeBar
            key={outcome.name}
            outcome={outcome}
            isLead={outcome.name === lead?.name}
          />
        ))}
        {market.outcomes.length > 3 && (
          <p className="text-[10px] text-wp-text3">+{market.outcomes.length - 3} more outcomes</p>
        )}
      </div>

      {/* Footer metadata */}
      <div className="flex items-center gap-3 pt-1 border-t border-white/[0.04]">
        <span className="text-[10px] text-wp-text3 font-mono">
          VOL {formatVolume(market.volume)}
        </span>
        <span className="text-white/20">·</span>
        <span className="text-[10px] text-wp-text3">
          {formatEndDate(market.endDate)}
        </span>
        <span className="ml-auto text-[10px] text-wp-text3 group-hover:text-wp-text2 transition-colors">
          Polymarket ↗
        </span>
      </div>
    </a>
  )
}

// ─── Categories eligible for prediction market display ────────────────────────

const ELIGIBLE_CATEGORIES = new Set([
  'geopolitics', 'conflict', 'elections', 'economy', 'breaking',
  'security', 'health', 'other',
])

// ─── Main component ───────────────────────────────────────────────────────────

interface PredictionMarketsProps {
  signalId:  string
  category:  string
  title:     string
}

/**
 * PredictionMarkets — renders Polymarket prediction market odds relevant to
 * the current signal.  Counters WorldMonitor's "Polymarket prediction odds"
 * feature (uncountered through WorldPulse Cycle 44).
 *
 * Only shown for eligible categories (geopolitics, conflict, elections, …).
 * Fetches from /api/v1/polymarket/markets?query=<signal_title_keywords>.
 */
export function PredictionMarkets({ signalId, category, title }: PredictionMarketsProps) {
  const [markets, setMarkets]   = useState<PredictionMarket[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const isEligible = ELIGIBLE_CATEGORIES.has(category)

  useEffect(() => {
    if (!isEligible) return

    setLoading(true)
    setError(null)

    // Build a compact keyword query from the signal title (first 5 words)
    const keywords = title
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(' ')

    const params = new URLSearchParams({
      limit:     '4',
      tag:       'geopolitics',
      signal_id: signalId,
      ...(keywords ? { query: keywords } : {}),
    })

    fetch(`/api/v1/polymarket/markets?${params.toString()}`)
      .then(r => r.json() as Promise<PredictionMarketsResponse>)
      .then(json => {
        if (json.success) {
          setMarkets(json.data.markets)
        } else {
          setError('No prediction data')
        }
      })
      .catch(() => setError('Could not load prediction markets'))
      .finally(() => setLoading(false))
  }, [signalId, category, title, isEligible])

  if (!isEligible) return null
  if (error || (!loading && markets.length === 0)) return null

  return (
    <div className="space-y-3">
      {/* Section header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 w-full group"
        aria-expanded={expanded}
      >
        <span className="font-mono text-[10px] tracking-widest uppercase text-wp-text3 group-hover:text-wp-text2 transition-colors">
          📊 Prediction Markets
        </span>
        <span className="text-[10px] text-wp-text3 font-mono">· Polymarket</span>
        <div className="ml-auto h-px flex-1 bg-white/[0.04]" />
        <span className="text-[10px] text-wp-text3 font-mono">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2.5">
          {loading ? (
            <>
              <MarketSkeleton />
              <MarketSkeleton />
            </>
          ) : (
            markets.map(m => <MarketCard key={m.id} market={m} />)
          )}

          {/* Attribution */}
          {!loading && markets.length > 0 && (
            <p className="text-[9px] text-wp-text3 text-center">
              Prediction market data via{' '}
              <a
                href="https://polymarket.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-wp-text2"
              >
                Polymarket
              </a>{' '}
              · Not financial advice
            </p>
          )}
        </div>
      )}
    </div>
  )
}
