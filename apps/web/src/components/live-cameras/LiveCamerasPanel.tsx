'use client'

import { useState, useEffect, useCallback } from 'react'

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

interface RegionOption {
  id: string
  label: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGION_LABELS: RegionOption[] = [
  { id: 'global',     label: 'Global'      },
  { id: 'americas',   label: 'Americas'    },
  { id: 'europe',     label: 'Europe'      },
  { id: 'mena',       label: 'MENA'        },
  { id: 'asia',       label: 'Asia'        },
  { id: 'africa',     label: 'Africa'      },
  { id: 'oceania',    label: 'Oceania'     },
  { id: 'easteurope', label: 'East Europe' },
]

const TYPE_BADGE: Record<CameraType, { label: string; color: string }> = {
  traffic: { label: 'TRAFFIC', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  weather: { label: 'WEATHER', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30'   },
  city:    { label: 'CITY',    color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  nature:  { label: 'NATURE',  color: 'bg-green-500/20 text-green-400 border-green-500/30' },
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
    <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl overflow-hidden animate-pulse">
      <div className="w-full aspect-video bg-zinc-800" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-zinc-800 rounded w-2/3" />
        <div className="h-2.5 bg-zinc-800 rounded w-1/3" />
      </div>
    </div>
  )
}

// ─── CameraCard ───────────────────────────────────────────────────────────────

interface CameraCardProps {
  camera: CameraFeed
  refreshTick: number
  compact?: boolean
}

function CameraCard({ camera, refreshTick, compact = false }: CameraCardProps) {
  const badge = TYPE_BADGE[camera.type]
  const flag  = COUNTRY_FLAG[camera.countryCode] ?? '🌐'

  // Snapshot URL cache-bust uses refreshTick so all snapshots refresh together
  const snapshotSrc = camera.snapshotUrl
    ? `${camera.snapshotUrl}?t=${refreshTick}`
    : null

  return (
    <div className="group bg-zinc-900 border border-zinc-700/50 hover:border-zinc-600 rounded-xl overflow-hidden transition-all duration-200">
      {/* Video / Snapshot area */}
      <div className="relative w-full bg-black" style={{ aspectRatio: '16/9' }}>
        {snapshotSrc ? (
          <img
            src={snapshotSrc}
            alt={camera.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <iframe
            src={camera.embedUrl}
            title={camera.name}
            className="w-full h-full border-0"
            loading="lazy"
            allow="autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        )}

        {/* Live dot */}
        {camera.isLive && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-[9px] text-red-400 tracking-widest">LIVE</span>
          </div>
        )}

        {/* Type badge */}
        {!compact && (
          <div className={`absolute top-2 right-2 font-mono text-[9px] px-1.5 py-0.5 rounded border ${badge.color}`}>
            {badge.label}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-zinc-100 truncate">{camera.name}</span>
          <span className="text-base flex-shrink-0">{flag}</span>
        </div>
        {!compact && (
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${badge.color}`}>
              {badge.label}
            </span>
            <span className="text-[11px] text-zinc-500 truncate">{camera.country}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── LiveCamerasPanel ─────────────────────────────────────────────────────────

interface LiveCamerasPanelProps {
  /** Whether to render as a full sidebar panel or a modal-style overlay */
  variant?: 'panel' | 'modal'
}

export function LiveCamerasPanel({ variant = 'panel' }: LiveCamerasPanelProps) {
  const [cameras, setCameras]       = useState<CameraFeed[]>([])
  const [loading, setLoading]       = useState(true)
  const [region, setRegion]         = useState('global')
  const [refreshTick, setRefreshTick] = useState(Date.now())
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [error, setError]           = useState<string | null>(null)

  const load = useCallback(async (r: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/v1/cameras?region=${r}&limit=20`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { cameras: CameraFeed[] }
      setCameras(data.cameras)
      setLastRefreshed(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cameras')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load on region change
  useEffect(() => {
    void load(region)
  }, [region, load])

  // Auto-refresh snapshots every 30s
  useEffect(() => {
    const id = setInterval(() => setRefreshTick(Date.now()), SNAPSHOT_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const isModal = variant === 'modal'

  return (
    <div className={isModal
      ? 'flex flex-col h-full bg-zinc-950 rounded-2xl overflow-hidden'
      : 'flex flex-col h-full'
    }>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">📹</span>
          <span className="font-semibold text-zinc-100 text-[14px]">Live Cameras</span>
          {cameras.length > 0 && (
            <span className="font-mono text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
              {cameras.length}
            </span>
          )}
        </div>
        {lastRefreshed && (
          <span className="font-mono text-[10px] text-zinc-600">
            {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Region pills */}
      <div className="px-4 py-2 flex gap-1.5 overflow-x-auto scrollbar-none flex-shrink-0 border-b border-zinc-800/50">
        {REGION_LABELS.map(r => (
          <button
            key={r.id}
            onClick={() => setRegion(r.id)}
            className={`flex-shrink-0 font-mono text-[10px] tracking-wide px-2.5 py-1 rounded-full border transition-all
              ${region === r.id
                ? 'bg-wp-amber/20 text-wp-amber border-wp-amber/40'
                : 'text-zinc-500 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300'
              }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <span className="text-2xl mb-2">⚠️</span>
            <p className="text-[13px] text-zinc-400">{error}</p>
            <button
              onClick={() => void load(region)}
              className="mt-3 text-[12px] text-wp-amber hover:underline"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }, (_, i) => <CameraCardSkeleton key={i} />)}
          </div>
        ) : cameras.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <span className="text-2xl mb-2">📷</span>
            <p className="text-[13px] text-zinc-400">No cameras available for this region.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cameras.map(cam => (
              <CameraCard
                key={cam.id}
                camera={cam}
                refreshTick={refreshTick}
                compact
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
