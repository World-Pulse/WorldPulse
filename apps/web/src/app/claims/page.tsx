'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface VerificationSource {
  name: string
  slug: string
  url: string | null
  trustScore: number
  agrees: boolean
  snippet: string | null
}

interface Claim {
  id: string
  signalId: string
  signalTitle: string
  text: string
  type: 'factual' | 'statistical' | 'attribution' | 'causal' | 'predictive'
  confidence: number
  verificationScore: number
  status: 'verified' | 'disputed' | 'unverified' | 'mixed'
  sources: VerificationSource[]
  context: string
  entities: string[]
  extractedAt: string
}

interface ClaimsResponse {
  total: number
  offset: number
  limit: number
  claims: Claim[]
  summary: {
    verified: number
    disputed: number
    unverified: number
    mixed: number
    total: number
  }
}

interface StatsResponse {
  signalsLast24h: number
  totalSignals: number
  sourceTrustDistribution: {
    highTrust: number
    mediumTrust: number
    lowTrust: number
  }
  verificationEngine: {
    version: string
    patternsCount: number
    maxClaimsPerSignal: number
  }
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

const STATUS_CONFIG = {
  verified:   { label: 'Verified',   color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: '✓', ring: 'ring-emerald-500/40' },
  disputed:   { label: 'Disputed',   color: 'bg-red-500/20 text-red-400 border-red-500/30',           icon: '✗', ring: 'ring-red-500/40' },
  unverified: { label: 'Unverified', color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',         icon: '?', ring: 'ring-zinc-500/40' },
  mixed:      { label: 'Mixed',      color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',      icon: '~', ring: 'ring-amber-500/40' },
} as const

const TYPE_LABELS: Record<Claim['type'], string> = {
  factual: 'Factual',
  statistical: 'Statistical',
  attribution: 'Attribution',
  causal: 'Causal',
  predictive: 'Predictive',
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([])
  const [summary, setSummary] = useState<ClaimsResponse['summary'] | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null)

  const fetchClaims = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (typeFilter !== 'all') params.set('type', typeFilter)
      params.set('limit', '30')

      const res = await fetch(`${API}/api/v1/claims/recent?${params}`)
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const data: ClaimsResponse = await res.json()
      setClaims(data.claims)
      setSummary(data.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/claims/stats`)
      if (res.ok) {
        const data: StatsResponse = await res.json()
        setStats(data)
      }
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { fetchClaims() }, [fetchClaims])
  useEffect(() => { fetchStats() }, [fetchStats])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Claim Verification
              <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                BETA
              </span>
            </h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              AI-powered claim extraction & multi-source cross-referencing
            </p>
          </div>
          <Link
            href="/map"
            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ← Back to Map
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {summary && (
            <>
              <StatCard
                label="Verified"
                value={summary.verified}
                color="text-emerald-400"
                bg="bg-emerald-500/10"
              />
              <StatCard
                label="Disputed"
                value={summary.disputed}
                color="text-red-400"
                bg="bg-red-500/10"
              />
              <StatCard
                label="Mixed"
                value={summary.mixed}
                color="text-amber-400"
                bg="bg-amber-500/10"
              />
              <StatCard
                label="Unverified"
                value={summary.unverified}
                color="text-zinc-400"
                bg="bg-zinc-500/10"
              />
            </>
          )}
          {!summary && !loading && (
            <div className="col-span-4 text-center py-4 text-zinc-500 text-sm">
              No claim data available yet
            </div>
          )}
        </div>

        {/* Engine Info */}
        {stats && (
          <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
            <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
              Engine v{stats.verificationEngine.version}
            </span>
            <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
              {stats.signalsLast24h} signals/24h
            </span>
            <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
              {stats.sourceTrustDistribution.highTrust} high-trust sources
            </span>
            <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
              {stats.verificationEngine.patternsCount} extraction patterns
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <FilterGroup
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'verified', label: 'Verified' },
              { value: 'disputed', label: 'Disputed' },
              { value: 'mixed', label: 'Mixed' },
              { value: 'unverified', label: 'Unverified' },
            ]}
          />
          <FilterGroup
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'factual', label: 'Factual' },
              { value: 'statistical', label: 'Statistical' },
              { value: 'attribution', label: 'Attribution' },
              { value: 'causal', label: 'Causal' },
              { value: 'predictive', label: 'Predictive' },
            ]}
          />
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={fetchClaims}
              className="ml-4 px-3 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-zinc-900 animate-pulse" />
            ))}
          </div>
        )}

        {/* Claims List */}
        {!loading && !error && claims.length === 0 && (
          <div className="text-center py-16 text-zinc-500">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-lg font-medium">No claims found</p>
            <p className="text-sm mt-1">
              Claims are extracted automatically as new signals are ingested.
            </p>
          </div>
        )}

        {!loading && !error && claims.length > 0 && (
          <div className="space-y-3">
            {claims.map(claim => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                expanded={expandedClaim === claim.id}
                onToggle={() => setExpandedClaim(
                  expandedClaim === claim.id ? null : claim.id,
                )}
              />
            ))}
          </div>
        )}

        {/* Pro CTA */}
        <div className="mt-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-center">
          <p className="text-amber-400 font-medium">
            Claim Verification is in beta. Pro members get priority access to
            advanced features including semantic cross-referencing and claim alerts.
          </p>
          <Link
            href="/developers#pricing"
            className="inline-block mt-3 px-5 py-2 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-sm hover:bg-amber-400 transition-colors"
          >
            Get Pro Access →
          </Link>
        </div>
      </main>
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`rounded-lg border border-zinc-800 ${bg} p-4`}>
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500 mr-1">{label}:</span>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-zinc-700 text-zinc-100'
              : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function ClaimCard({
  claim,
  expanded,
  onToggle,
}: {
  claim: Claim
  expanded: boolean
  onToggle: () => void
}) {
  const cfg = STATUS_CONFIG[claim.status]

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden transition-all hover:border-zinc-700 ${
        expanded ? 'ring-1 ' + cfg.ring : ''
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        {/* Status icon */}
        <span className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${cfg.color}`}>
          {cfg.icon}
        </span>

        <div className="flex-1 min-w-0">
          {/* Claim text */}
          <p className="text-sm text-zinc-200 leading-snug line-clamp-2">
            {claim.text}
          </p>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cfg.color}`}>
              {cfg.label}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              {TYPE_LABELS[claim.type]}
            </span>
            <span className="text-[10px] text-zinc-500">
              {Math.round(claim.confidence * 100)}% confidence
            </span>
            <span className="text-[10px] text-zinc-500">
              · {claim.sources.length} source{claim.sources.length !== 1 ? 's' : ''}
            </span>
            {claim.entities.length > 0 && (
              <span className="text-[10px] text-zinc-600 truncate max-w-[200px]">
                · {claim.entities.slice(0, 3).join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Verification score bar */}
        <div className="flex-shrink-0 w-12 flex flex-col items-center">
          <span className="text-xs font-mono text-zinc-400">
            {Math.round(claim.verificationScore * 100)}
          </span>
          <div className="w-8 h-1.5 rounded-full bg-zinc-800 mt-1 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${claim.verificationScore * 100}%`,
                backgroundColor:
                  claim.verificationScore >= 0.7 ? '#34d399' :
                  claim.verificationScore >= 0.5 ? '#fbbf24' :
                  '#ef4444',
              }}
            />
          </div>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          {/* Signal link */}
          <div className="text-xs text-zinc-500">
            From signal:{' '}
            <Link
              href={`/signals/${claim.signalId}`}
              className="text-amber-400 hover:underline"
            >
              {claim.signalTitle}
            </Link>
          </div>

          {/* Context */}
          <div className="text-xs text-zinc-400 bg-zinc-950 rounded p-2 border border-zinc-800">
            <span className="text-zinc-600 uppercase text-[10px] block mb-1">Context</span>
            …{claim.context}…
          </div>

          {/* Cross-reference sources */}
          {claim.sources.length > 0 && (
            <div>
              <span className="text-zinc-600 uppercase text-[10px] block mb-1.5">
                Cross-referenced sources
              </span>
              <div className="space-y-1.5">
                {claim.sources.map((src, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs bg-zinc-950 rounded px-2 py-1.5 border border-zinc-800"
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                      src.agrees ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {src.agrees ? '✓' : '✗'}
                    </span>
                    <span className="text-zinc-300 font-medium">{src.name}</span>
                    <span className="text-zinc-600">trust: {Math.round(src.trustScore * 100)}%</span>
                    {src.snippet && (
                      <span className="text-zinc-500 truncate max-w-[300px]">
                        — {src.snippet}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {claim.sources.length === 0 && (
            <p className="text-xs text-zinc-500 italic">
              No cross-referencing sources found for this claim yet.
            </p>
          )}

          {/* Entities */}
          {claim.entities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {claim.entities.map((entity, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
                >
                  {entity}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
