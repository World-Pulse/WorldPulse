'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Siren, Swords, LineChart, Thermometer, Hospital, Laptop,
  Landmark, Drama, MapPin, Map as MapIcon,
} from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const CATEGORIES = [
  { slug: 'breaking',   label: 'Breaking',    icon: Siren,        color: '#ff3b5c' },
  { slug: 'conflict',   label: 'Conflict',    icon: Swords,       color: '#ff3b5c' },
  { slug: 'markets',    label: 'Markets',     icon: LineChart,    color: '#f5a623' },
  { slug: 'climate',    label: 'Climate',     icon: Thermometer,  color: '#00e676' },
  { slug: 'health',     label: 'Health',      icon: Hospital,     color: '#00d4ff' },
  { slug: 'technology', label: 'Technology',  icon: Laptop,       color: '#a855f7' },
  { slug: 'politics',   label: 'Politics',    icon: Landmark,     color: '#f5a623' },
  { slug: 'culture',    label: 'Culture',     icon: Drama,        color: '#00d4ff' },
]

interface Signal {
  id: string
  title: string
  summary: string | null
  category: string
  severity: string
  reliabilityScore: number
  locationName: string | null
  createdAt: string
  sourceCount: number
}

interface Source {
  id: string
  slug: string
  name: string
  tier: string
  trustScore: number
  categories: string[]
  language: string
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-wp-red border-wp-red bg-[rgba(255,59,92,0.1)]',
  high:     'text-wp-amber border-wp-amber bg-[rgba(245,166,35,0.1)]',
  medium:   'text-wp-cyan border-wp-cyan bg-[rgba(0,212,255,0.1)]',
  low:      'text-wp-green border-wp-green bg-[rgba(0,230,118,0.1)]',
}

export default function ExplorePage() {
  const router = useRouter()
  const [signals, setSignals]   = useState<Signal[]>([])
  const [sources, setSources]   = useState<Source[]>([])
  const [trending, setTrending] = useState<{ topic: string; count: number }[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.allSettled([
      fetch(`${API_URL}/api/v1/feed/signals?limit=10`).then(r => r.json()),
      fetch(`${API_URL}/api/v1/sources?limit=8`).then(r => r.json()),
      fetch(`${API_URL}/api/v1/feed/trending?window=6h`).then(r => r.json()),
    ]).then(([sigRes, srcRes, trendRes]) => {
      if (sigRes.status === 'fulfilled' && sigRes.value.items) {
        setSignals(sigRes.value.items.slice(0, 10))
      }
      if (srcRes.status === 'fulfilled') {
        const items = srcRes.value.data?.items ?? srcRes.value.items ?? []
        setSources(items.slice(0, 8))
      }
      if (trendRes.status === 'fulfilled' && trendRes.value.items) {
        setTrending(trendRes.value.items.slice(0, 8))
      }
    }).finally(() => setLoading(false))
  }, [])

  function timeAgo(iso: string) {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">

      {/* Header */}
      <div>
        <h1 className="font-display text-[28px] tracking-wider text-wp-text">EXPLORE</h1>
        <p className="text-[14px] text-wp-text3 mt-1">Discover signals, sources, and communities shaping the world</p>
      </div>

      {/* Category grid */}
      <div>
        <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-4">Browse by Category</div>
        <div className="grid grid-cols-4 gap-3">
          {CATEGORIES.map(cat => (
            <Link
              key={cat.slug}
              href={`/c/${cat.slug}`}
              className="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-[rgba(255,255,255,0.07)] hover:border-[rgba(255,255,255,0.2)] bg-wp-surface transition-all group text-center"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-[24px]"
                style={{ background: `${cat.color}18`, border: `1px solid ${cat.color}33` }}
              >
                <cat.icon className="w-6 h-6" />
              </div>
              <span className="text-[13px] font-semibold text-wp-text group-hover:text-wp-amber transition-colors">
                {cat.label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[1fr_300px] gap-6">

        {/* Latest signals */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Latest Verified Signals</div>
            <Link href="/" className="text-[12px] text-wp-amber hover:underline">View all →</Link>
          </div>

          {loading && (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-20 rounded-xl shimmer" />)}
            </div>
          )}

          {!loading && signals.length === 0 && (
            <div className="text-center py-12 text-wp-text3 text-[14px]">
              No signals yet — the scraper is warming up.
            </div>
          )}

          {!loading && signals.map(sig => (
            <div
              key={sig.id}
              onClick={() => router.push(`/signals/${sig.id}`)}
              className="flex gap-3 p-4 rounded-xl border border-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.02)] transition-all cursor-pointer mb-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-mono text-[9px] px-2 py-0.5 rounded border ${SEVERITY_COLOR[sig.severity] ?? 'text-wp-text3 border-[rgba(255,255,255,0.1)]'}`}>
                    {sig.severity.toUpperCase()}
                  </span>
                  <span className="font-mono text-[10px] text-wp-text3 uppercase">{sig.category}</span>
                  {sig.locationName && (
                    <span className="font-mono text-[10px] text-wp-text3 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {sig.locationName.split(',').slice(-1)[0]?.trim()}</span>
                  )}
                </div>
                <div className="text-[13px] font-semibold text-wp-text leading-snug line-clamp-2">{sig.title}</div>
                {sig.summary && (
                  <div className="text-[12px] text-wp-text3 mt-1 line-clamp-1">{sig.summary}</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="font-mono text-[10px] text-wp-text3">{timeAgo(sig.createdAt)}</span>
                <span className="font-mono text-[10px] text-wp-text3">{sig.sourceCount} src</span>
                <div className="flex gap-[2px]">
                  {Array(5).fill(0).map((_, i) => (
                    <div
                      key={i}
                      className={`w-[4px] h-[4px] rounded-full ${i < Math.round(sig.reliabilityScore * 5) ? 'bg-wp-green' : 'bg-wp-s3'}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Trending topics */}
          <div>
            <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-3">Trending Topics</div>
            {trending.length > 0 ? (
              <div className="space-y-2">
                {trending.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.03)] transition-all cursor-pointer">
                    <span className="font-mono text-[11px] text-wp-text3 w-5">{i + 1}.</span>
                    <span className="text-[13px] text-wp-text2 flex-1 truncate">{t.topic}</span>
                    {t.count > 0 && (
                      <span className="font-mono text-[10px] text-wp-amber">{t.count}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-wp-text3 py-4 text-center">Trending topics will appear as signals accumulate.</div>
            )}
          </div>

          {/* Top sources */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Trusted Sources</div>
              <Link href="/sources" className="text-[11px] text-wp-amber hover:underline">All →</Link>
            </div>
            {sources.length > 0 ? (
              <div className="space-y-2">
                {sources.map(src => (
                  <div key={src.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.03)] transition-all">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-wp-s2 to-wp-s3 flex items-center justify-center font-bold text-[11px] text-wp-amber flex-shrink-0">
                      {src.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-wp-text truncate">{src.name}</div>
                      <div className="font-mono text-[10px] text-wp-text3">{src.tier} · {Math.round(src.trustScore * 100)}% trust</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-wp-text3 py-4 text-center">Sources loading…</div>
            )}
          </div>

          {/* Map CTA */}
          <Link
            href="/map"
            className="block p-4 rounded-xl border border-[rgba(255,255,255,0.07)] hover:border-wp-amber bg-gradient-to-br from-wp-s2 to-wp-bg transition-all group"
          >
            <MapIcon className="w-5 h-5 mb-2 text-wp-text3" />
            <div className="text-[13px] font-semibold text-wp-text group-hover:text-wp-amber transition-colors">Signal World Map</div>
            <div className="text-[11px] text-wp-text3 mt-0.5">Live geospatial view of all active signals</div>
          </Link>
        </div>
      </div>
    </div>
  )
}
