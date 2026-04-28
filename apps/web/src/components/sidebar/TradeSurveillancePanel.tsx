'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Globe, ArrowRight } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ComtradeFlow {
  period: string
  reporterCode: number
  reporterDesc: string
  reporterIso2?: string
  partnerCode: number
  partnerDesc: string
  partnerIso2?: string
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
  source?: 'seed' | string
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const COMMODITY_TABS: Array<{ label: string; cmdCode: string }> = [
  { label: 'Oil',     cmdCode: '270900' },
  { label: 'Uranium', cmdCode: '261200' },
  { label: 'Chips',   cmdCode: '854231' },
  { label: 'Wheat',   cmdCode: '100199' },
  { label: 'Arms',    cmdCode: '930190' },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatUSD(value: number): string {
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3)  return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

// ─── COUNTRY CODE BADGE ──────────────────────────────────────────────────────

function CountryBadge({ iso2, name }: { iso2?: string; name: string }) {
  const code = iso2 || name.slice(0, 2).toUpperCase()
  const hasCode = iso2 && iso2.length === 2

  return (
    <span
      className={`inline-flex items-center justify-center w-[26px] h-[18px] rounded-[3px] text-[9px] font-mono font-bold tracking-wide flex-shrink-0 ${
        hasCode
          ? 'bg-[rgba(245,166,35,0.12)] text-wp-amber border border-[rgba(245,166,35,0.2)]'
          : 'bg-[rgba(255,255,255,0.06)] text-wp-text3 border border-[rgba(255,255,255,0.08)]'
      }`}
      title={name}
    >
      {hasCode ? iso2 : <Globe className="w-[10px] h-[10px]" />}
    </span>
  )
}

// ─── SKELETON ────────────────────────────────────────────────────────────────

function FlowSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 py-[10px] border-b border-[rgba(255,255,255,0.04)] last:border-0 animate-pulse">
          <div className="w-[26px] h-[18px] bg-[rgba(255,255,255,0.06)] rounded-[3px]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-[11px] bg-[rgba(255,255,255,0.06)] rounded w-3/4" />
            <div className="h-[9px] bg-[rgba(255,255,255,0.04)] rounded w-1/3" />
          </div>
          <div className="w-[48px] h-[16px] bg-[rgba(255,255,255,0.06)] rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── FLOW CARD ────────────────────────────────────────────────────────────────

function FlowCard({ flow }: { flow: ComtradeFlow }) {
  const isImport = flow.flowCode === 'M'

  return (
    <div className="flex items-center gap-[8px] py-[9px] border-b border-[rgba(255,255,255,0.04)] last:border-0 group hover:bg-[rgba(255,255,255,0.02)] transition-colors rounded-sm">
      {/* Reporter country badge */}
      <CountryBadge iso2={flow.reporterIso2} name={flow.reporterDesc} />

      {/* Flow direction + details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[12px] leading-tight">
          <span className="font-medium text-wp-text truncate max-w-[80px]">{flow.reporterDesc}</span>
          <ArrowRight className="w-[10px] h-[10px] text-wp-text3 flex-shrink-0" />
          <span className="text-wp-text3 truncate max-w-[80px]">{flow.partnerDesc}</span>
        </div>
        <div className="font-mono text-[9px] text-wp-text3 mt-[2px] tracking-wide">
          {flow.period} annual
        </div>
      </div>

      {/* Value + flow type */}
      <div className="flex flex-col items-end gap-[3px] flex-shrink-0">
        <span
          className={`text-[8px] font-bold font-mono px-[5px] py-[1px] rounded-[2px] tracking-wider ${
            isImport
              ? 'bg-[rgba(0,212,255,0.10)] text-wp-cyan'
              : 'bg-[rgba(0,230,118,0.10)] text-wp-green'
          }`}
        >
          {isImport ? 'IMP' : 'EXP'}
        </span>
        <span className="text-[12px] font-mono font-semibold text-wp-text">
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
  const [isSeedData, setIsSeedData]   = useState(false)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(false)
  const [spinning, setSpinning]     = useState(false)

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
      setIsSeedData(json.source === 'seed')
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

  const handleRefresh = async () => {
    setSpinning(true)
    await fetchFlows()
    setTimeout(() => setSpinning(false), 600)
  }

  // Derive period label from data
  const periodLabel = flows.length > 0 ? flows[0].period : '2024'

  return (
    <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-[14px] pt-[14px] pb-[10px]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">
            Strategic Commodity Flows
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isSeedData && (
            <span className="font-mono text-[8px] px-[5px] py-[2px] rounded-[3px] bg-[rgba(255,255,255,0.05)] text-wp-text3 border border-[rgba(255,255,255,0.06)]">
              Reference
            </span>
          )}
          <button
            onClick={() => void handleRefresh()}
            className="text-wp-text3 hover:text-wp-amber transition-colors p-0.5"
            aria-label="Refresh trade data"
            title="Refresh"
          >
            <RefreshCw className={`w-[12px] h-[12px] ${spinning ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-[rgba(255,255,255,0.05)] mx-[14px]" />

      {/* Commodity selector tabs */}
      <div className="flex gap-[3px] px-[14px] py-[10px] flex-wrap">
        {COMMODITY_TABS.map(tab => (
          <button
            key={tab.cmdCode}
            onClick={() => setSelectedCmdCode(tab.cmdCode)}
            className={`px-[8px] py-[4px] rounded-[4px] text-[10px] font-mono font-semibold transition-all ${
              selectedCmdCode === tab.cmdCode
                ? 'bg-[rgba(245,166,35,0.15)] text-wp-amber border border-[rgba(245,166,35,0.25)]'
                : 'text-wp-text3 border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] hover:text-wp-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-[14px] pb-[10px]">
        {loading ? (
          <FlowSkeleton />
        ) : error ? (
          <div className="text-[11px] text-wp-text3 text-center py-6 font-mono">
            Trade data unavailable — retry in a moment
          </div>
        ) : flows.length === 0 ? (
          <div className="text-[11px] text-wp-text3 text-center py-6 font-mono">
            No flow data available
          </div>
        ) : (
          <div className="space-y-0">
            {flows.slice(0, 5).map((flow, i) => (
              <FlowCard key={`${flow.reporterCode}-${flow.partnerCode}-${flow.flowCode}-${i}`} flow={flow} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-[14px] pb-[12px] flex items-center justify-between">
        <span className="font-mono text-[9px] text-wp-text3">
          Source: UN Comtrade
        </span>
        <span className="font-mono text-[9px] text-wp-text3">
          {isSeedData ? `Annual data (${periodLabel})` : `${periodLabel} annual`}
        </span>
      </div>
    </div>
  )
}
