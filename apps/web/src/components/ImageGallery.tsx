'use client'

import { useState, useEffect, useCallback } from 'react'

interface ImageGalleryProps {
  urls:    string[]
  types?:  string[]  // 'image' | 'video' for each URL
  alt?:    string
  className?: string
}

// ─── LIGHTBOX ───────────────────────────────────────────────────────────────

function Lightbox({
  urls,
  initialIndex,
  onClose,
}: {
  urls:         string[]
  initialIndex: number
  onClose:      () => void
}) {
  const [idx, setIdx] = useState(initialIndex)

  const prev = useCallback(() => setIdx(i => (i - 1 + urls.length) % urls.length), [urls.length])
  const next = useCallback(() => setIdx(i => (i + 1) % urls.length), [urls.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')  prev()
      if (e.key === 'ArrowRight') next()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, prev, next])

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Image */}
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[idx]}
          alt={`Image ${idx + 1} of ${urls.length}`}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        />

        {/* Counter */}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
          <span className="font-mono text-[12px] text-white/70 bg-black/60 px-3 py-1 rounded-full">
            {idx + 1} / {urls.length}
          </span>
        </div>

        {/* Nav buttons */}
        {urls.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-all"
              aria-label="Previous image"
            >
              ‹
            </button>
            <button
              onClick={next}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-all"
              aria-label="Next image"
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white text-xl transition-all"
        aria-label="Close lightbox"
      >
        ✕
      </button>

      {/* Dot indicators */}
      {urls.length > 1 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
          {urls.map((_, i) => (
            <button
              key={i}
              onClick={e => { e.stopPropagation(); setIdx(i) }}
              className={`w-2 h-2 rounded-full transition-all ${i === idx ? 'bg-white' : 'bg-white/40'}`}
              aria-label={`Go to image ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── GALLERY GRID ────────────────────────────────────────────────────────────

export function ImageGallery({ urls, types, className = '' }: ImageGalleryProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  // Only include image URLs
  const imageUrls = urls.filter((_, i) => !types || types[i] === 'image' || !types[i])

  if (imageUrls.length === 0) return null

  const openLightbox = (i: number) => setLightboxIdx(i)
  const closeLightbox = () => setLightboxIdx(null)

  return (
    <>
      <div className={`rounded-xl overflow-hidden ${className}`}>
        {imageUrls.length === 1 && (
          // Single image — full width
          <div
            className="cursor-zoom-in relative group"
            onClick={() => openLightbox(0)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && openLightbox(0)}
            aria-label="Open image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrls[0]}
              alt="Post image"
              className="w-full max-h-[400px] object-cover rounded-xl"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl" />
          </div>
        )}

        {imageUrls.length === 2 && (
          // 2 images — side by side
          <div className="grid grid-cols-2 gap-[2px]">
            {imageUrls.map((url, i) => (
              <div
                key={url}
                className="cursor-zoom-in relative group aspect-square"
                onClick={() => openLightbox(i)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && openLightbox(i)}
                aria-label={`Open image ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Post image ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
              </div>
            ))}
          </div>
        )}

        {imageUrls.length === 3 && (
          // 3 images — 1 big left + 2 stacked right
          <div className="grid grid-cols-2 gap-[2px]" style={{ height: 280 }}>
            <div
              className="cursor-zoom-in relative group row-span-2"
              onClick={() => openLightbox(0)}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && openLightbox(0)}
              aria-label="Open image 1"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrls[0]} alt="Post image 1" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
            </div>
            {[1, 2].map(i => (
              <div
                key={imageUrls[i]}
                className="cursor-zoom-in relative group"
                style={{ height: 138 }}
                onClick={() => openLightbox(i)}
                role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && openLightbox(i)}
                aria-label={`Open image ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrls[i]} alt={`Post image ${i + 1}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
              </div>
            ))}
          </div>
        )}

        {imageUrls.length >= 4 && (
          // 4+ images — 2x2 grid with count badge on last
          <div className="grid grid-cols-2 gap-[2px]">
            {imageUrls.slice(0, 4).map((url, i) => {
              const isLast = i === 3
              const remaining = imageUrls.length - 4
              return (
                <div
                  key={url}
                  className="cursor-zoom-in relative group aspect-square"
                  onClick={() => openLightbox(i)}
                  role="button" tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && openLightbox(i)}
                  aria-label={`Open image ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Post image ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
                  {isLast && remaining > 0 && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <span className="text-white text-[22px] font-bold">+{remaining}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Image count badge (for 2+) */}
        {imageUrls.length >= 2 && (
          <div className="flex justify-end mt-1 pr-1">
            <span className="font-mono text-[10px] text-wp-text3">
              {imageUrls.length} photos
            </span>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <Lightbox
          urls={imageUrls}
          initialIndex={lightboxIdx}
          onClose={closeLightbox}
        />
      )}
    </>
  )
}
