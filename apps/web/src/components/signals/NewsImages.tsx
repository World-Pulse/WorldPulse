'use client'

import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsImage {
  id:           string
  imageUrl:     string
  caption:      string | null
  sourceUrl:    string | null
  sourceDomain: string | null
  date:         string | null
}

interface NewsImagesResponse {
  success: boolean
  data: {
    images: NewsImage[]
    query:  string
    total:  number
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatImageDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    // GDELT seendate format: "20260329T120000Z" or ISO string
    let d: Date
    if (/^\d{8}T\d{6}Z$/.test(dateStr)) {
      d = new Date(
        dateStr.slice(0, 4) + '-' +
        dateStr.slice(4, 6) + '-' +
        dateStr.slice(6, 8) + 'T' +
        dateStr.slice(9, 11) + ':' +
        dateStr.slice(11, 13) + ':' +
        dateStr.slice(13, 15) + 'Z'
      )
    } else {
      d = new Date(dateStr)
    }
    if (isNaN(d.getTime())) return dateStr
    const diffMs = Date.now() - d.getTime()
    const diffH  = Math.floor(diffMs / 3_600_000)
    if (diffH < 1)  return 'Just now'
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7)  return `${diffD}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function shortenDomain(domain: string | null): string {
  if (!domain) return ''
  return domain.replace(/^www\./, '')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ImageSkeleton() {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden animate-pulse">
      <div className="w-full bg-white/[0.06]" style={{ aspectRatio: '16/9' }} />
      <div className="p-3 space-y-2">
        <div className="h-3 w-3/4 rounded bg-white/[0.08]" />
        <div className="h-3 w-1/2 rounded bg-white/[0.06]" />
        <div className="h-3 w-1/4 rounded bg-white/[0.05]" />
      </div>
    </div>
  )
}

function ImageCard({ image }: { image: NewsImage }) {
  const [imgError, setImgError] = useState(false)
  const target = image.sourceUrl ?? image.imageUrl

  return (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-white/[0.15] hover:bg-white/[0.04] transition-all"
    >
      {/* Thumbnail */}
      {image.imageUrl && !imgError ? (
        <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.imageUrl}
            alt={image.caption ?? 'News image'}
            width={320}
            height={180}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
          {/* External link overlay on hover */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        /* Fallback placeholder */
        <div className="w-full bg-white/[0.04] flex items-center justify-center" style={{ aspectRatio: '16/9' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-wp-text3" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      {/* Card body */}
      <div className="p-3 space-y-1.5 flex-1 flex flex-col">
        {/* Caption / headline */}
        {image.caption && (
          <p className="text-[12px] text-wp-text2 font-medium leading-[1.4] line-clamp-2">
            {image.caption}
          </p>
        )}

        {/* Domain + date row */}
        <div className="flex items-center gap-2 font-mono text-[10px] text-wp-text3 mt-auto flex-wrap">
          {image.sourceDomain && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide"
              style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8' }}
            >
              {shortenDomain(image.sourceDomain)}
            </span>
          )}
          {image.date && (
            <span>{formatImageDate(image.date)}</span>
          )}
        </div>

        {/* View article CTA */}
        <div
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-mono font-semibold transition-colors"
          style={{ color: '#a78bfa' }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          View Article
        </div>
      </div>
    </a>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  signalId: string
}

export function NewsImages({ signalId }: Props) {
  const [images,  setImages]  = useState<NewsImage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1'
    fetch(`${API_BASE}/signals/${encodeURIComponent(signalId)}/news-images`)
      .then(r => r.ok ? r.json() : null)
      .then((data: NewsImagesResponse | null) => {
        if (data?.success && data.data.images.length > 0) {
          setImages(data.data.images)
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
          Visual News Coverage
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <ImageSkeleton />
          <ImageSkeleton />
          <ImageSkeleton />
        </div>
      </div>
    )
  }

  // Hide section entirely when no images
  if (images.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          <span aria-hidden="true">🖼</span>
          Visual News Coverage
          <span className="normal-case tracking-normal text-wp-text3">({images.length})</span>
        </div>
      </div>

      {/* 3-column grid on desktop, 2 on tablet, 1 on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {images.map(image => (
          <ImageCard key={image.id} image={image} />
        ))}
      </div>

      {/* Attribution */}
      <div className="font-mono text-[9px] text-wp-text3">
        Powered by{' '}
        <a
          href="https://www.gdeltproject.org"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-wp-text2 underline underline-offset-2 transition-colors"
        >
          GDELT Summary
        </a>
      </div>
    </div>
  )
}
