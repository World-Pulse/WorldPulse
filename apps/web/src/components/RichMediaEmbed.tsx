'use client'

import { useState } from 'react'

// ─── URL DETECTORS ─────────────────────────────────────────────────────────

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    // youtube.com/watch?v=ID
    if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && u.pathname === '/watch') {
      return u.searchParams.get('v')
    }
    // youtu.be/ID
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split('?')[0] || null
    }
    // youtube.com/embed/ID  or  youtube.com/shorts/ID
    if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com')) {
      const match = u.pathname.match(/\/(embed|shorts|v)\/([a-zA-Z0-9_-]{11})/)
      if (match) return match[2]
    }
    return null
  } catch {
    return null
  }
}

export function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'vimeo.com' || u.hostname === 'www.vimeo.com') {
      const match = u.pathname.match(/\/(\d+)/)
      return match ? match[1] : null
    }
    return null
  } catch {
    return null
  }
}

export type EmbedType = 'youtube' | 'vimeo' | null

export function detectEmbedType(url: string): EmbedType {
  if (extractYouTubeId(url)) return 'youtube'
  if (extractVimeoId(url))   return 'vimeo'
  return null
}

// ─── YOUTUBE EMBED ──────────────────────────────────────────────────────────

function YouTubeEmbed({ videoId }: { videoId: string }) {
  const [loaded, setLoaded] = useState(false)
  const thumbUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`

  if (loaded) {
    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ paddingTop: '56.25%' }}>
        <iframe
          src={embedUrl}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          loading="lazy"
          title="YouTube video player"
        />
      </div>
    )
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl cursor-pointer group"
      style={{ paddingTop: '56.25%' }}
      onClick={() => setLoaded(true)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && setLoaded(true)}
      aria-label="Load YouTube video"
    >
      {/* Thumbnail */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbUrl}
        alt="YouTube video thumbnail"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors" />
      {/* Play button */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-14 h-14 rounded-full bg-[rgba(255,0,0,0.9)] flex items-center justify-center group-hover:scale-110 transition-transform shadow-xl">
          <svg className="w-6 h-6 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      {/* Privacy notice */}
      <div className="absolute bottom-2 left-0 right-0 flex justify-center">
        <span className="font-mono text-[10px] text-white/60 bg-black/60 px-2 py-0.5 rounded">
          Click to load YouTube video
        </span>
      </div>
    </div>
  )
}

// ─── VIMEO EMBED ────────────────────────────────────────────────────────────

function VimeoEmbed({ videoId }: { videoId: string }) {
  const [loaded, setLoaded] = useState(false)
  const embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=1&dnt=1`

  if (loaded) {
    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ paddingTop: '56.25%' }}>
        <iframe
          src={embedUrl}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          loading="lazy"
          title="Vimeo video player"
        />
      </div>
    )
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-wp-s3 cursor-pointer group"
      style={{ paddingTop: '56.25%' }}
      onClick={() => setLoaded(true)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && setLoaded(true)}
      aria-label="Load Vimeo video"
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        {/* Vimeo play button */}
        <div className="w-14 h-14 rounded-full bg-[rgba(26,183,234,0.9)] flex items-center justify-center group-hover:scale-110 transition-transform shadow-xl">
          <svg className="w-6 h-6 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="font-mono text-[11px] text-wp-text3">Click to load Vimeo video</span>
      </div>
    </div>
  )
}

// ─── MAIN EXPORT ────────────────────────────────────────────────────────────

interface RichMediaEmbedProps {
  url: string
  className?: string
}

export function RichMediaEmbed({ url, className = '' }: RichMediaEmbedProps) {
  const youTubeId = extractYouTubeId(url)
  if (youTubeId) {
    return (
      <div className={className}>
        <YouTubeEmbed videoId={youTubeId} />
      </div>
    )
  }

  const vimeoId = extractVimeoId(url)
  if (vimeoId) {
    return (
      <div className={className}>
        <VimeoEmbed videoId={vimeoId} />
      </div>
    )
  }

  return null
}

// ─── HELPER: extract first embeddable URL from text ──────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"]+/g

export function extractFirstEmbedUrl(text: string): string | null {
  const urls = text.match(URL_REGEX) ?? []
  for (const url of urls) {
    if (detectEmbedType(url)) return url
  }
  return null
}
