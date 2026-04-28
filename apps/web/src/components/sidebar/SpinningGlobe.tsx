'use client'

import { useEffect, useRef } from 'react'

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ''

/**
 * Lightweight spinning globe for the sidebar widget.
 * Uses MapLibre GL with dark tiles + auto-rotation.
 */
export function SpinningGlobe() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<unknown>(null)

  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null

    ;(async () => {
      const ml = await import('maplibre-gl')
      await import('maplibre-gl/dist/maplibre-gl.css')
      if (cancelled) return

      const tiles = MAPTILER_KEY && MAPTILER_KEY !== 'demo'
        ? [`https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`]
        : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png']

      map = new ml.Map({
        container: containerRef.current!,
        style: {
          version: 8,
          sources: {
            basemap: { type: 'raster', tiles, tileSize: 256 },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#030812' } },
            { id: 'basemap', type: 'raster', source: 'basemap',
              paint: { 'raster-opacity': 0.6, 'raster-saturation': -0.7,
                'raster-brightness-min': 0.02, 'raster-brightness-max': 0.35 } },
          ],
        },
        center: [20, 20],
        zoom: 1.2,
        pitch: 0,
        interactive: false,      // no pan/zoom/click — purely decorative
        attributionControl: false,
        fadeDuration: 0,
      })

      mapRef.current = map

      map.on('load', () => {
        if (cancelled) return

        // Try globe projection (MapLibre v5+)
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map as any).setProjection({ type: 'globe' })
        } catch { /* v4 fallback — flat spin still looks good */ }

        // Auto-rotate: slowly pan longitude
        let lng = 20
        const spin = () => {
          if (cancelled || !map) return
          lng += 0.15
          map.setCenter([lng, 20])
          requestAnimationFrame(spin)
        }
        requestAnimationFrame(spin)
      })
    })()

    return () => {
      cancelled = true
      if (map) {
        try { map.remove() } catch { /* ignore */ }
      }
      mapRef.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="w-full aspect-square rounded-full overflow-hidden"
      style={{ mask: 'radial-gradient(circle, black 62%, transparent 63%)' }}
    />
  )
}
