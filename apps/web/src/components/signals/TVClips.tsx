'use client'

import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TVClip {
  id:           string
  station:      string
  showName:     string
  showDate:     string
  previewUrl:   string
  clipUrl:      string
  durationSecs: number | null
}

interface TVClipsResponse {
  success: boolean
  data: {
    clips: TVClip[]
    query: string
    total: number
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function formatClipDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const diffMs = Date.now() - d.getTime()
    const diffH  = Math.floor(diffMs / 3_600_000)
    if (diffH < 1)  return 'Just now'
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7)  return `${diffD} day${diffD !== 1 ? 's' : ''} ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ClipSkeleton() {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden animate-pulse">
      <div className="w-full bg-white/[0.06]" style={{ aspectRatio: '16/9' }} />
      <div className="p-3 space-y-2">
        <div className="h-3 w-16 rounded bg-white/[0.08]" />
        <div className="h-3 w-3/4 rounded bg-white/[0.06]" />
        <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
      </div>
    </div>
  )
}

function ClipCard({ clip }: { clip: TVClip }) {
  const [imgError, setImgError] = useState(false)
  const target = clip.clipUrl || 'https://television.gdeltproject.org/cgi-bin/iatv_ftxtsearch/iatv_ftxtsearch'

  return (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-white/[0.15] hover:bg-white/[0.04] transition-all"
    >
      {/* Thumbnail */}
      {clip.previewUrl && !imgError ? (
        <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={clip.previewUrl}
            alt={`${clip.showName} preview`}
            width={320}
            height={180}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
          {/* Play overlay */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        /* Fallback when no thumbnail */
        <div className="w-full bg-white/[0.04] flex items-center justify-center" style={{ aspectRatio: '16/9' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-wp-text3" aria-hidden="true">
            <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
            <polyline points="17 2 12 7 7 2" />
          </svg>
        </div>
      )}

      {/* Card body */}
      <div className="p-3 space-y-1.5 flex-1 flex flex-col">
        {/* Station badge */}
        {clip.station && (
          <span
            className="self-start px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-widest"
            style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)', color: '#e2e8f0' }}
          >
            {clip.station}
          </span>
        )}

        {/* Show name */}
        {clip.showName && (
          <p className="text-[12px] text-wp-text2 font-medium leading-[1.4] line-clamp-2">
            {clip.showName}
          </p>
        )}

        {/* Date + duration */}
        <div className="flex items-center gap-2 font-mono text-[10px] text-wp-text3 mt-auto">
          {clip.showDate && <span>{formatClipDate(clip.showDate)}</span>}
          {clip.durationSecs != null && (
            <>
              <span>·</span>
              <span>{formatDuration(clip.durationSecs)}</span>
            </>
          )}
        </div>

        {/* Watch button */}
        <div
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono font-semibold transition-colors"
          style={{ color: '#00d2d2' }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5,3 19,12 5,21" />
          </svg>
          Watch Clip
        </div>
      </div>
    </a>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  signalId: string
}

export function TVClips({ signalId }: Props) {
  const [clips,   setClips]   = useState<TVClip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1'
    fetch(`${API_BASE}/signals/${encodeURIComponent(signalId)}/tv-clips`)
      .then(r => r.ok ? r.json() : null)
      .then((data: TVClipsResponse | null) => {
        if (data?.success && data.data.clips.length > 0) {
          setClips(data.data.clips)
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoading(false))
  }, [signalId])

  // Show 3 skeleton cards while loading
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          TV News Coverage
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ClipSkeleton />
          <ClipSkeleton />
          <ClipSkeleton />
        </div>
      </div>
    )
  }

  // Hide section entirely when no clips
  if (clips.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          <span aria-hidden="true">📺</span>
          TV News Coverage
          <span className="normal-case tracking-normal text-wp-text3">({clips.length})</span>
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {clips.map(clip => (
          <ClipCard key={clip.id} clip={clip} />
        ))}
      </div>

      {/* Attribution */}
      <div className="font-mono text-[9px] text-wp-text3">
        Powered by{' '}
        <a
          href="https://television.gdeltproject.org/cgi-bin/iatv_ftxtsearch/iatv_ftxtsearch"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-wp-text2 underline underline-offset-2 transition-colors"
        >
          GDELT TV
        </a>
      </div>
    </div>
  )
}
