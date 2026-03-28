'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const TIER_CONFIG: Record<string, { label: string; color: string; desc: string }> = {
  wire:      { label: 'Wire Service',  color: 'text-wp-red   border-wp-red   bg-[rgba(255,59,92,0.08)]',   desc: 'Global wire services — highest trust' },
  national:  { label: 'National',      color: 'text-wp-amber border-wp-amber bg-[rgba(245,166,35,0.08)]', desc: 'Major national outlets' },
  regional:  { label: 'Regional',      color: 'text-wp-cyan  border-wp-cyan  bg-[rgba(0,212,255,0.08)]',  desc: 'Regional and local publications' },
  community: { label: 'Community',     color: 'text-wp-green border-wp-green bg-[rgba(0,230,118,0.08)]',  desc: 'Community and specialty sources' },
  user:      { label: 'User',          color: 'text-wp-text3 border-[rgba(255,255,255,0.15)] bg-transparent', desc: 'User-submitted sources' },
}

const CATEGORY_ICONS: Record<string, string> = {
  breaking: '🚨', conflict: '⚔️', geopolitics: '🌐', climate: '🌡️',
  health: '🏥', economy: '📈', technology: '💻', science: '🔬',
  elections: '🗳️', culture: '🎭', disaster: '🌊', security: '🔒',
  sports: '⚽', space: '🚀', other: '🌍',
}

interface Source {
  id: string
  slug: string
  name: string
  url: string
  tier: string
  trustScore: number
  language: string
  country: string | null
  categories: string[]
  active: boolean
  articleCount?: number
  lastScraped?: string | null
}


function TrustBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 90 ? 'bg-wp-green' : pct >= 75 ? 'bg-wp-amber' : 'bg-wp-red'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-[4px] bg-wp-s3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-wp-text3 w-8 text-right">{pct}%</span>
    </div>
  )
}

export default function SourcesPage() {
  const [sources, setSources]     = useState<Source[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/v1/sources?limit=100`)
      .then(r => r.json())
      .then(d => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any[] = d.data?.items ?? d.items ?? []
        if (raw.length > 0) {
          setSources(raw.map(s => ({
            id:           s.id,
            slug:         s.slug,
            name:         s.name,
            url:          s.url,
            tier:         s.tier,
            trustScore:   s.trustScore   ?? s.trust_score   ?? 0,
            language:     s.language     ?? 'en',
            country:      s.country      ?? null,
            categories:   s.categories   ?? [],
            active:       s.active       ?? true,
            articleCount: s.articleCount ?? s.article_count ?? undefined,
            lastScraped:  s.lastScraped  ?? s.last_scraped  ?? undefined,
          })))
        }
      })
      .catch(() => { /* API unavailable */ })
      .finally(() => setLoading(false))
  }, [])

  const allTiers = [...new Set(sources.map(s => s.tier))]
  const allCategories = [...new Set(sources.flatMap(s => s.categories))]

  const filtered = sources.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase())
    const matchTier = !tierFilter || s.tier === tierFilter
    const matchCat  = !catFilter || s.categories.includes(catFilter)
    return matchSearch && matchTier && matchCat
  })

  const byTier: Record<string, Source[]> = {}
  for (const s of filtered) {
    if (!byTier[s.tier]) byTier[s.tier] = []
    byTier[s.tier].push(s)
  }

  const tierOrder = ['wire', 'national', 'regional', 'community', 'user']

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-wp-text">Intelligence Sources</h1>
          <p className="text-[13px] text-wp-text3 mt-0.5">
            {sources.length} verified sources · Continuously monitored
          </p>
        </div>
        <Link
          href="/sources/suggest"
          className="px-4 py-2 rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all"
        >
          + Suggest Source
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Sources',   value: sources.length },
          { label: 'Wire Services',   value: sources.filter(s => s.tier === 'wire').length },
          { label: 'Active Now',      value: sources.filter(s => s.active).length },
          { label: 'Avg Trust',       value: `${Math.round(sources.reduce((s, src) => s + src.trustScore, 0) / (sources.length || 1) * 100)}%` },
        ].map(stat => (
          <div key={stat.label} className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <div className="font-mono text-[10px] tracking-[2px] text-wp-text3 uppercase mb-1">{stat.label}</div>
            <div className="text-[22px] font-bold text-wp-amber">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-xl px-3 py-2.5 focus-within:border-wp-amber transition-colors">
            <span className="text-wp-text3">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sources…"
              className="flex-1 bg-transparent border-none outline-none text-[14px] text-wp-text placeholder-wp-text3"
            />
          </div>
        </div>

        {/* Tier filters */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setTierFilter('')}
            className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-all
              ${!tierFilter ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]' : 'border-[rgba(255,255,255,0.08)] text-wp-text3 hover:border-wp-amber hover:text-wp-amber'}`}
          >
            All tiers
          </button>
          {allTiers.sort((a, b) => tierOrder.indexOf(a) - tierOrder.indexOf(b)).map(tier => (
            <button
              key={tier}
              onClick={() => setTierFilter(tierFilter === tier ? '' : tier)}
              className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-all
                ${tierFilter === tier
                  ? (TIER_CONFIG[tier]?.color ?? 'text-wp-amber border-wp-amber bg-[rgba(245,166,35,0.1)]')
                  : 'border-[rgba(255,255,255,0.08)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}`}
            >
              {TIER_CONFIG[tier]?.label ?? tier}
            </button>
          ))}
        </div>

        {/* Category filters */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCatFilter('')}
            className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-all
              ${!catFilter ? 'border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.1)]' : 'border-[rgba(255,255,255,0.08)] text-wp-text3 hover:border-wp-cyan hover:text-wp-cyan'}`}
          >
            All categories
          </button>
          {allCategories.slice(0, 10).map(cat => (
            <button
              key={cat}
              onClick={() => setCatFilter(catFilter === cat ? '' : cat)}
              className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-all
                ${catFilter === cat
                  ? 'border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.1)]'
                  : 'border-[rgba(255,255,255,0.08)] text-wp-text3 hover:border-wp-cyan hover:text-wp-cyan'}`}
            >
              {CATEGORY_ICONS[cat] ?? ''} {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Sources by tier */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl shimmer" />)}
        </div>
      ) : (
        <div className="space-y-8">
          {tierOrder.filter(t => byTier[t]?.length).map(tier => (
            <div key={tier}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${TIER_CONFIG[tier]?.color ?? ''}`}>
                  {TIER_CONFIG[tier]?.label ?? tier}
                </span>
                <span className="text-[11px] text-wp-text3">{TIER_CONFIG[tier]?.desc}</span>
                <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
                <span className="font-mono text-[10px] text-wp-text3">{byTier[tier].length} sources</span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {byTier[tier].map(src => (
                  <div
                    key={src.id}
                    className="flex items-center gap-3 p-3 sm:p-4 bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl hover:border-[rgba(255,255,255,0.15)] transition-all"
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-wp-s2 to-wp-s3 flex items-center justify-center font-bold text-[14px] text-wp-amber flex-shrink-0">
                      {src.name.charAt(0)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[14px] text-wp-text">{src.name}</span>
                        {src.active && (
                          <span className="w-[5px] h-[5px] rounded-full bg-wp-green flex-shrink-0" title="Active" />
                        )}
                        <span className="font-mono text-[10px] text-wp-text3">{src.language.toUpperCase()}</span>
                        {src.country && (
                          <span className="font-mono text-[10px] text-wp-text3">{src.country}</span>
                        )}
                      </div>
                      <a
                        href={src.url.startsWith('http') ? src.url : `https://${src.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] text-wp-text3 hover:text-wp-amber transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        {src.url.replace(/^https?:\/\//, '')}
                      </a>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {src.categories.slice(0, 4).map(cat => (
                          <span key={cat} className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-[rgba(245,166,35,0.07)] border border-[rgba(245,166,35,0.15)] text-wp-amber">
                            {cat}
                          </span>
                        ))}
                      </div>
                      {/* Trust score — mobile only (inline below categories) */}
                      <div className="sm:hidden mt-2">
                        <TrustBar score={src.trustScore} />
                      </div>
                    </div>

                    {/* Trust score — desktop */}
                    <div className="hidden sm:block w-32 flex-shrink-0">
                      <div className="font-mono text-[9px] text-wp-text3 uppercase mb-1">Trust Score</div>
                      <TrustBar score={src.trustScore} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="text-center py-16">
          <div className="text-[48px] mb-4">📡</div>
          <div className="text-[16px] font-semibold text-wp-text mb-2">No sources match your filters</div>
          <button onClick={() => { setSearch(''); setTierFilter(''); setCatFilter('') }} className="text-wp-amber hover:underline text-[13px]">
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}
