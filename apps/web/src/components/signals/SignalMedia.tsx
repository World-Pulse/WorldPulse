'use client'

import type { Signal } from '@worldpulse/types'

type MediaItem = NonNullable<Signal['media']>[number]

interface Props {
  items: MediaItem[]
  loading?: boolean
}

// Loading skeleton for a single media slot
function MediaSkeleton() {
  return (
    <div className="w-full rounded-xl bg-white/[0.04] animate-pulse" style={{ aspectRatio: '16/9' }} />
  )
}

// Responsive 16:9 YouTube embed using youtube-nocookie.com
function YouTubeEmbed({ embedId, title }: { embedId: string; title?: string | null }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl"
      style={{ paddingBottom: '56.25%' /* 16:9 */ }}
    >
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${embedId}`}
        title={title ?? 'YouTube video'}
        width="100%"
        height="100%"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        className="absolute inset-0 w-full h-full border-0"
      />
    </div>
  )
}

// Audio player with styled wrapper
function PodcastAudioEmbed({ url, sourceName }: { url: string; sourceName?: string | null }) {
  let hostname: string | null = null
  try { hostname = new URL(url).hostname.replace(/^www\./, '') } catch { /* noop */ }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
      {sourceName || hostname ? (
        <div className="flex items-center gap-2 font-mono text-[10px] text-wp-text3 uppercase tracking-wider">
          {/* Podcast icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="11" r="1" />
            <path d="M11 17a1 1 0 0 1 2 0c0 .5-.34 3-.5 4.5a.5.5 0 0 1-1 0c-.16-1.5-.5-4-.5-4.5Z" />
            <path d="M8 14a5 5 0 1 1 8 0" />
            <path d="M5 18a9 9 0 1 1 14 0" />
          </svg>
          <span>{sourceName ?? hostname}</span>
        </div>
      ) : null}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls src={url} className="w-full" preload="none" />
    </div>
  )
}

function MediaItemRenderer({ item }: { item: MediaItem }) {
  if (item.mediaType === 'youtube' && item.embedId) {
    return <YouTubeEmbed embedId={item.embedId} title={item.title} />
  }

  if (item.mediaType === 'podcast_audio') {
    return <PodcastAudioEmbed url={item.url} sourceName={item.sourceName} />
  }

  return null
}

export function SignalMedia({ items, loading = false }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="font-mono text-[10px] tracking-widest uppercase text-wp-text3">
          Media &amp; Commentary
        </div>
        <MediaSkeleton />
      </div>
    )
  }

  if (items.length === 0) return null

  return (
    <details open className="group">
      <summary className="flex items-center gap-2 cursor-pointer list-none font-mono text-[10px] tracking-widest uppercase text-wp-text3 hover:text-wp-text2 transition-colors select-none mb-3">
        {/* Chevron rotates when open */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
        Media &amp; Commentary
        <span className="text-wp-text3 normal-case tracking-normal">
          ({items.length})
        </span>
      </summary>

      <div className="space-y-4">
        {items.map(item => (
          <MediaItemRenderer key={item.id} item={item} />
        ))}
      </div>
    </details>
  )
}
