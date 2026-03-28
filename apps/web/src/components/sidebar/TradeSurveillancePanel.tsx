'use client'

import { useCallback, useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ComtradeFlow {
  period: string
  reporterCode: number
  reporterDesc: string
  partnerCode: number
  partnerDesc: string
  flowCode: 'M' | 'X'
  cmdCode: string
  cmdDesc: string
  primaryValue: number
  netWgt: number
}

interface TradeApiResponse {
  flows: ComtradeFlow[]
  commodities: string[]
  lastUpdated: string
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const COMMODITY_TABS: Array<{ label: string; cmdCode: string }> = [
  { label: 'Oil',    cmdCode: '270900' },
  { label: 'Uranium', cmdCode: '261200' },
  { label: 'Chips',  cmdCode: '854231' },
  { label: 'Wheat',  cmdCode: '100199' },
  { label: 'Arms',   cmdCode: '930190' },
]

const COUNTRY_FLAGS: Record<number, string> = {
  156: '🇨🇳',
  840: '🇺🇸',
  643: '🇷🇺',
  276: '🇩🇪',
  356: '🇮🇳',
  826: '🇬🇧',
  250: '🇫🇷',
  682: '🇸🇦',
  364: '🇮🇷',
  398: '🇰🇿',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatUSD(value: number): string {
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3)  return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// ─── SKELETON ────────────────────────────────────────────────────────────────

function FlowSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 py-2 border-b border-[rgba(255,255,255,0.05)] last:border-0 animate-pulse">
          <div className="w-6 h-4 bg-[rgba(255,255,255,0.08)] rounded" />
          <div className="flex-1 space-y-1">
            <div className="h-3 bg-[rgba(255,255,255,0.08)] rounded w-3/4" />
            <div className="h-2 bg-[rgba(255,255,255,0.05)] rounded w-1/2" />
          </div>
          <div className="w-10 h-4 bg-[rgba(255,255,255,0.08)] rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── FLOW CARD ────────────────────────────────────────────────────────────────

function FlowCard({ flow }: { flow: ComtradeFlow }) {
  const flag = COUNTRY_FLAGS[flow.reporterCode] ?? '🌐'
  const isImport = flow.flowCode === 'M'

  return (
    <div className="flex items-center gap-2 py-[7px] border-b border-[rgba(255,255,255,0.05)] last:border-0">
      <span className="text-[18px] leading-none flex-shrink-0">{flag}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-wp-text truncate">
          {flow.reporterDesc}
          <span className="text-wp-text3 mx-1">→</span>
          <span className="text-wp-text3">{flow.partnerDesc}</span>
        </div>
        <div className="text-[10px] text-wp-text3">{flow.period}</div>
      </div>
      <div className="flex flex-col items-end gap-[2px] flex-shrink-0">
        <span
          className={`text-[9px] font-bold font-mono px-[5px] py-[2px] rounded ${
            isImport
              ? 'bg-[rgba(0,212,255,0.12)] text-wp-cyan'
              : 'bg-[rgba(0,230,118,0.12)] text-wp-green'
          }`}
        >
          {isImport ? 'IMP' : 'EXP'}
        </span>
        <span className="text-[11px] font-mono font-semibold text-wp-text">
          {formatUSD(flow.primaryValue)}
        </span>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function TradeSurveillancePanel() {
  const [selectedCmdCode, setSelectedCmdCode] = useState(COMMODITY_TABS[0].cmdCode)
  const [flows, setFlows]           = useState<ComtradeFlow[]>([])
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(false)

  const fetchFlows = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(
        `${API_URL}/api/v1/trade/commodity-flows?cmdCode=${selectedCmdCode}&limit=5`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error('non-ok')
      const json: TradeApiResponse = await res.json()
      setFlows(json.flows ?? [])
      setLastUpdated(json.lastUpdated ?? '')
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [selectedCmdCode])

  // Initial fetch + refetch when commodity changes
  useEffect(() => {
    void fetchFlows()
  }, [fetchFlows])

  // Auto-refresh every 60 minutes
  useEffect(() => {
    const id = setInterval(() => void fetchFlows(), 60 * 60_000)
    return () => clearInterval(id)
  }, [fetchFlows])

  return (
    <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-[14px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">
          Strategic Commodity Flows
        </span>
        <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
        <button
          onClick={() => void fetchFlows()}
          className="text-[10px] text-wp-text3 hover:text-wp-amber transition-colors"
          aria-label="Refresh trade data"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Commodity selector tabs */}
      <div className="flex gap-[4px] mb-3 flex-wrap">
        {COMMODITY_TABS.map(tab => (
          <button
            key={tab.cmdCode}
            onClick={() => setSelectedCmdCode(tab.cmdCode)}
            className={`px-[8px] py-[3px] rounded text-[10px] font-mono font-semibold transition-all ${
              selectedCmdCode === tab.cmdCode
                ? 'bg-[rgba(245,166,35,0.18)] text-wp-amber border border-[rgba(245,166,35,0.3)]'
                : 'text-wp-text3 border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.15)] hover:text-wp-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <FlowSkeleton />
      ) : error ? (
        <div className="text-[12px] text-wp-text3 text-center py-4">
          Trade data unavailable
        </div>
      ) : flows.length === 0 ? (
        <div className="text-[12px] text-wp-text3 text-center py-4">
          No flow data cached yet
        </div>
      ) : (
        <div className="space-y-0">
          {flows.slice(0, 5).map((flow, i) => (
            <FlowCard key={`${flow.reporterCode}-${flow.partnerCode}-${flow.flowCode}-${i}`} flow={flow} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[9px] text-wp-text3">Source: UN Comtrade</span>
        {lastUpdated && (
          <span className="font-mono text-[9px] text-wp-text3">
            {formatTime(lastUpdated)}
          </span>
        )}
      </div>
    </div>
  )
}
