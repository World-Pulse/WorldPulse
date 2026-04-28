'use client'

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface MarketTicker {
  symbol: string
  name:   string
  type:   string
  price:  number | null
  changePercent: number | null
}

function formatPrice(t: MarketTicker): string {
  if (t.price == null) return '—'
  if (t.type === 'fx')         return t.price.toFixed(4)
  if (t.type === 'bond')       return t.price.toFixed(2) + '%'
  if (t.type === 'crypto')     return t.price >= 1000
    ? t.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : t.price.toFixed(2)
  if (t.type === 'volatility') return t.price.toFixed(2)
  return t.price >= 10000
    ? t.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const TYPE_LABELS: Record<string, string> = {
  volatility: 'Volatility',
  equity:     'Indices',
  crypto:     'Crypto',
  commodity:  'Commodities',
  fx:         'Forex',
  bond:       'Bonds',
}

const TYPE_ORDER = ['volatility', 'equity', 'crypto', 'commodity', 'fx', 'bond']

function TickerRow({ t, compact }: { t: MarketTicker; compact?: boolean }) {
  const up    = (t.changePercent ?? 0) >= 0
  const color = t.changePercent == null ? '#888' : up ? '#00e676' : '#ff3b5c'
  const arrow = t.changePercent == null ? '' : up ? '▲' : '▼'
  const pct   = t.changePercent == null ? '—' : `${Math.abs(t.changePercent).toFixed(2)}%`
  const priceStr = formatPrice(t)

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-wp-text2 w-16 flex-shrink-0 truncate">{t.name}</span>
        <span className="font-mono text-[11px] text-wp-text flex-1 text-right">{priceStr}</span>
        <span className="font-mono text-[10px] flex-shrink-0 flex items-center gap-0.5" style={{ color }}>
          {arrow} {pct}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 hover:bg-wp-s2 transition-colors rounded-lg">
      <span className="font-mono text-[12px] text-wp-text2 w-24 flex-shrink-0">{t.name}</span>
      <span className="font-mono text-[14px] text-wp-text font-medium flex-1 text-right tabular-nums">{priceStr}</span>
      <span
        className="font-mono text-[12px] w-20 text-right flex-shrink-0 flex items-center justify-end gap-1 font-medium"
        style={{ color }}
      >
        {arrow} {pct}
      </span>
    </div>
  )
}

/**
 * Market Pulse — live market prices from Yahoo Finance.
 *
 * @param extended  When true, fetches 22 instruments grouped by category (for /finance page).
 *                  When false, fetches 9 core instruments in a compact list (sidebar).
 */
export function MarketPulse({ extended = false }: { extended?: boolean }) {
  const [tickers, setTickers]   = useState<MarketTicker[]>([])
  const [loading, setLoading]   = useState(true)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function fetch_() {
      try {
        const url = extended
          ? `${API_URL}/api/v1/analytics/markets?extended=true`
          : `${API_URL}/api/v1/analytics/markets`
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          if (mounted) {
            setTickers(data.tickers ?? [])
            setGeneratedAt(data.generated_at ?? null)
            setLoading(false)
          }
        }
      } catch { if (mounted) setLoading(false) }
    }
    fetch_()
    const id = setInterval(fetch_, 5 * 60_000)
    return () => { mounted = false; clearInterval(id) }
  }, [extended])

  // ── Compact mode (sidebar) ────────────────────────────────────
  if (!extended) {
    if (loading) {
      return (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-2 animate-pulse">
              <div className="flex-1 h-3 bg-wp-s3 rounded" />
              <div className="w-12 h-3 bg-wp-s3 rounded" />
              <div className="w-10 h-3 bg-wp-s3 rounded" />
            </div>
          ))}
        </div>
      )
    }
    if (tickers.length === 0) {
      return <p className="font-mono text-[10px] text-wp-text3 italic">Market data unavailable</p>
    }
    return (
      <div className="space-y-[6px]">
        {tickers.map(t => <TickerRow key={t.symbol} t={t} compact />)}
        <p className="font-mono text-[9px] text-wp-text3 text-right mt-1">Yahoo Finance · 5m delay</p>
      </div>
    )
  }

  // ── Extended mode (/finance page) ─────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-wp-s2 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (tickers.length === 0) {
    return (
      <div className="text-center text-wp-text3 text-[13px] py-8">
        Market data temporarily unavailable
      </div>
    )
  }

  // Group tickers by type
  const groups: Record<string, MarketTicker[]> = {}
  for (const t of tickers) {
    ;(groups[t.type] ??= []).push(t)
  }

  return (
    <div className="space-y-4">
      {TYPE_ORDER.filter(type => groups[type]?.length).map(type => (
        <div key={type} className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-wp-text2 uppercase tracking-wider">
              {TYPE_LABELS[type] ?? type}
            </h3>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-live-pulse" title="Live" />
          </div>
          <div className="divide-y divide-[rgba(255,255,255,0.04)]">
            {groups[type]!.map(t => <TickerRow key={t.symbol} t={t} />)}
          </div>
        </div>
      ))}
      <p className="font-mono text-[10px] text-wp-text3 text-right">
        Yahoo Finance · 5m delay{generatedAt ? ` · Updated ${new Date(generatedAt).toLocaleTimeString()}` : ''}
      </p>
    </div>
  )
}
