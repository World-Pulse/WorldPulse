'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Video, AlertTriangle } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const SNAPSHOT_REFRESH_MS = 30_000

// ─── Types ────────────────────────────────────────────────────────────────────

type CameraType = 'traffic' | 'weather' | 'city' | 'nature'

interface CameraFeed {
  id: string
  name: string
  region: string
  country: string
  countryCode: string
  lat: number
  lng: number
  embedUrl: string
  snapshotUrl: string | null
  type: CameraType
  isLive: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIONS = [
  { id: 'global',     label: 'Global'      },
  { id: 'americas',   label: 'Americas'    },
  { id: 'europe',     label: 'Europe'      },
  { id: 'mena',       label: 'MENA'        },
  { id: 'asia',       label: 'Asia'        },
  { id: 'africa',     label: 'Africa'      },
  { id: 'oceania',    label: 'Oceania'     },
  { id: 'easteurope', label: 'East Europe' },
]

const TYPE_META: Record<CameraType, { label: string; color: string }> = {
  traffic: { label: 'Traffic',  color: 'bg-amber-500/20 text-amber-400 border-amber-500/30'    },
  weather: { label: 'Weather',  color: 'bg-blue-500/20 text-blue-400 border-blue-500/30'       },
  city:    { label: 'City',     color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  nature:  { label: 'Nature',   color: 'bg-green-500/20 text-green-400 border-green-500/30'    },
}

const COUNTRY_FLAG: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', FR: '🇫🇷', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸',
  NL: '🇳🇱', JP: '🇯🇵', AU: '🇦🇺', BR: '🇧🇷', MX: '🇲🇽', CA: '🇨🇦',
  AE: '🇦🇪', TR: '🇹🇷', EG: '🇪🇬', IL: '🇮🇱', SG: '🇸🇬', HK: '🇭🇰',
  KR: '🇰🇷', IN: '🇮🇳', TH: '🇹🇭', ZA: '🇿🇦', KE: '🇰🇪', MA: '🇲🇦',
  NZ: '🇳🇿', PL: '🇵🇱', CZ: '🇨🇿', UA: '🇺🇦', RU: '🇷🇺',
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CameraCardSkeleton() {
  return (
    <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl overflow-hidden animate-pulse">
      <div className="w-full aspect-video bg-zinc-800" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-zinc-800 rounded w-2/3" />
        <div className="h-3 bg-zinc-800 rounded w-1/3" />
      </div>
    </div>
  )
}

// ─── CameraCard ───────────────────────────────────────────────────────────────

interface CameraCardProps {
  camera: CameraFeed
  refreshTick: number
}

function CameraCard({ camera, refreshTick }: CameraCardProps) {
  const meta = TYPE_META[camera.type]
  const flag = COUNTRY_FLAG[camera.countryCode] ?? '🌐'
  const [imgError, setImgError] = useState(false)

  const snapshotSrc = (!imgError && camera.snapshotUrl)
    ? `${camera.snapshotUrl}?t=${refreshTick}`
    : null

  // Detect invalid Windy embed URLs (placeholder IDs that won't render)
  const isValidEmbed = camera.embedUrl && !camera.embedUrl.includes('embed-webcam.html?id=1')

  return (
    <div className="group bg-zinc-900 border border-zinc-700/50 hover:border-zinc-600 rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-black/30">
      {/* Stream / snapshot */}
      <div className="relative w-full bg-black" style={{ aspectRatio: '16/9' }}>
        {snapshotSrc ? (
          <img
            src={snapshotSrc}
            alt={camera.name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : isValidEmbed ? (
          <iframe
            src={camera.embedUrl}
            title={camera.name}
            className="w-full h-full border-0"
            loading="lazy"
            allow="autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-800">
            <Video className="w-10 h-10 mb-2 opacity-60 mx-auto" />
            <span className="text-[11px] text-zinc-500 font-mono">Stream connecting…</span>
            {isValidEmbed && (
              <a
                href={camera.embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-[10px] text-amber-500/70 hover:text-amber-400 font-mono transition-colors"
              >
                Open external feed →
              </a>
            )}
          </div>
        )}

        {/* Live badge */}
        {camera.isLive && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-full px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-[10px] text-red-400 tracking-widest font-bold">LIVE</span>
          </div>
        )}

        {/* Type badge */}
        <div className={`absolute top-3 right-3 font-mono text-[9px] px-2 py-0.5 rounded-full border ${meta.color}`}>
          {meta.label.toUpperCase()}
        </div>
      </div>

      {/* Info */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-zinc-100 leading-snug">{camera.name}</h3>
          <span className="text-xl flex-shrink-0 mt-0.5">{flag}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[12px] text-zinc-500">{camera.country}</span>
          <span className="text-zinc-700">·</span>
          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${meta.color}`}>
            {meta.label.toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CamerasPage() {
  const [cameras, setCameras]     = useState<CameraFeed[]>([])
  const [loading, setLoading]     = useState(true)
  const [region, setRegion]       = useState('global')
  const [typeFilter, setTypeFilter] = useState<CameraType | 'all'>('all')
  const [refreshTick, setRefreshTick] = useState(Date.now())
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [total, setTotal]         = useState(0)

  const load = useCallback(async (r: string, t: CameraType | 'all') => {
    setLoading(true)
    setError(null)
    try {
      const typeParam = t !== 'all' ? `&type=${t}` : ''
      const res = await fetch(
        `${API_URL}/api/v1/cameras?region=${r}&limit=50${typeParam}`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { cameras: CameraFeed[]; total: number }
      setCameras(data.cameras)
      setTotal(data.total)
      setLastRefreshed(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cameras')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(region, typeFilter)
  }, [region, typeFilter, load])

  // Auto-refresh snapshots every 30 s
  useEffect(() => {
    const id = setInterval(() => setRefreshTick(Date.now()), SNAPSHOT_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      {/* Page metadata via document.title (client component) */}
      <title>Live Cameras — WorldPulse</title>

      <div className="min-h-screen bg-wp-bg text-wp-text">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-wp-bg/95 backdrop-blur-md border-b border-[rgba(255,255,255,0.07)]">
          {/* Breadcrumb */}
          <div className="px-6 pt-3 flex items-center gap-2 text-[12px] text-zinc-500">
            <Link href="/" className="hover:text-zinc-300 transition-colors no-underline">Home</Link>
            <span>›</span>
            <span className="text-zinc-300">Live Cameras</span>
          </div>

          {/* Title row */}
          <div className="px-6 pt-2 pb-3 flex items-center gap-3">
            <Video className="w-6 h-6 text-red-400" />
            <div>
              <h1 className="text-xl font-bold text-zinc-100 leading-none">Live Cameras</h1>
              <p className="text-[12px] text-zinc-500 mt-0.5">Public CCTV & webcam feeds worldwide</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {!loading && total > 0 && (
                <span className="font-mono text-[11px] bg-zinc-800 text-zinc-400 px-2.5 py-1 rounded-full">
                  {total} feeds
                </span>
              )}
              {lastRefreshed && (
                <span className="font-mono text-[10px] text-zinc-600 hidden sm:block">
                  Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>

          {/* Region pills */}
          <div className="px-6 pb-3 flex gap-1.5 overflow-x-auto scrollbar-none">
            {REGIONS.map(r => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 font-mono text-[11px] tracking-wide px-3 py-1.5 rounded-full border transition-all
                  ${region === r.id
                    ? 'bg-wp-amber/20 text-wp-amber border-wp-amber/40 font-bold'
                    : 'text-zinc-500 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
              >
                <span>{r.label}</span>
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div className="px-6 pb-3 flex gap-1.5 overflow-x-auto scrollbar-none border-t border-zinc-800/50 pt-2">
            {(['all', 'traffic', 'weather', 'city', 'nature'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`flex-shrink-0 font-mono text-[10px] tracking-wide px-2.5 py-1 rounded-full border transition-all capitalize
                  ${typeFilter === t
                    ? 'bg-zinc-700 text-zinc-100 border-zinc-600'
                    : 'text-zinc-600 border-zinc-800 hover:border-zinc-700 hover:text-zinc-400'
                  }`}
              >
                {t === 'all' ? 'All Types' : t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 py-6">
          {error ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
              <p className="text-zinc-400 mb-4">{error}</p>
              <button
                onClick={() => void load(region, typeFilter)}
                className="px-4 py-2 bg-wp-amber text-black font-semibold rounded-lg text-[13px] hover:bg-amber-400 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 12 }, (_, i) => <CameraCardSkeleton key={i} />)}
            </div>
          ) : cameras.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Video className="w-10 h-10 mb-4 text-zinc-400 mx-auto" />
              <p className="text-zinc-400 text-[15px] font-medium">No cameras found</p>
              <p className="text-zinc-600 text-[13px] mt-1">Try a different region or remove the type filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {cameras.map(cam => (
                <CameraCard
                  key={cam.id}
                  camera={cam}
                  refreshTick={refreshTick}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
