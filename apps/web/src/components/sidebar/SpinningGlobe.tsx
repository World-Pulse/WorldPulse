'use client'

import { useEffect, useRef } from 'react'
import { loadBaseStyle, ATMOSPHERE, SEVERITY_COLOR } from '@/lib/map-style'
import { toHotspot, type Hotspot } from '@/lib/hotspots'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** Degrees the globe turns each step, and how often (10 steps a second: 4° a second) */
const STEP_DEG = 0.4
const STEP_MS = 100

/**
 * The home page's small spinning globe: the World Map's dark basemap (no
 * labels at this size) with the real places where news converges in the
 * last 24 hours, the World Map's "convergences", coloured by their worst
 * severity. Until Oct 11, 2026 it showed bright street tiles with seven
 * hand-placed dots that didn't move with the globe, and redrew itself every
 * frame for as long as the page was open; it now turns 10 times a second and
 * stops while it's off screen or the tab is hidden.
 */
export function SpinningGlobe({ onHotspots }: { onHotspots?: (count: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onHotspotsRef = useRef(onHotspots)
  onHotspotsRef.current = onHotspots

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof window === 'undefined') return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null
    let timer: ReturnType<typeof setInterval> | null = null
    let inView = true
    let observer: IntersectionObserver | null = null
    let resizer: ResizeObserver | null = null

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const turning = () => !cancelled && inView && document.visibilityState !== 'hidden'

    ;(async () => {
      const [ml, base] = await Promise.all([
        import('maplibre-gl'),
        loadBaseStyle(),
        import('maplibre-gl/dist/maplibre-gl.css'),
      ])
      if (cancelled) return

      // Country names and borders' labels crowd a globe this small
      const style = { ...base.style, layers: (base.style.layers ?? []).filter((l: { type?: string }) => l.type !== 'symbol') }
      // A whole world filling most of the widget
      const zoom = Math.max(0, Math.log2((Math.max(160, container.clientWidth) * 1.1 * Math.PI) / 512))
      let lng = 20

      map = new ml.Map({
        container,
        style,
        center: [lng, 20],
        zoom,
        interactive: false,       // the widget is a link to the World Map
        attributionControl: false, // credited under the widget
        fadeDuration: 0,
      })

      map.on('load', () => {
        if (cancelled) return
        try {
          map.setProjection({ type: 'globe' })
          map.setSky?.(ATMOSPHERE)
        } catch { /* older MapLibre: a flat map still turns */ }

        map.addSource('hotspots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        const color = ['match', ['get', 'severity'],
          'critical', SEVERITY_COLOR.critical, 'high', SEVERITY_COLOR.high, 'medium', SEVERITY_COLOR.medium, SEVERITY_COLOR.low]
        map.addLayer({
          id: 'hotspot-glow', type: 'circle', source: 'hotspots',
          paint: {
            'circle-color': color,
            'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 6, 50, 11, 300, 16],
            'circle-opacity': 0.28,
            'circle-blur': 0.8,
          },
        })
        map.addLayer({
          id: 'hotspot-dot', type: 'circle', source: 'hotspots',
          paint: {
            'circle-color': color,
            'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 2.2, 50, 3, 300, 4],
            'circle-stroke-color': '#04060b',
            'circle-stroke-width': 0.8,
          },
        })

        fetch(`${API_URL}/api/v1/signals/map/hotspots?hours=24&min_categories=2&limit=25`)
          .then(res => (res.ok ? res.json() : null))
          .then((json: { data?: { hotspots?: unknown[] } } | null) => {
            if (cancelled || !map) return
            const spots = (json?.data?.hotspots ?? []).map(toHotspot).filter((h): h is Hotspot => h !== null)
            map.getSource('hotspots')?.setData({
              type: 'FeatureCollection',
              features: spots.map(h => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [h.centerLng, h.centerLat] },
                properties: { severity: h.maxSeverity, count: h.signalCount },
              })),
            })
            onHotspotsRef.current?.(spots.length)
          })
          .catch(() => { /* the globe still turns without them */ })

        if (reducedMotion) return
        timer = setInterval(() => {
          if (!turning() || !map) return
          lng = ((lng + STEP_DEG + 180) % 360) - 180
          map.setCenter([lng, 20])
        }, STEP_MS)
      })

      // Off screen (scrolled past) it doesn't need to turn
      observer = new IntersectionObserver(entries => { inView = entries.some(e => e.isIntersecting) })
      observer.observe(container)
      // The widget can settle its size after the map starts: keep the canvas matching it
      resizer = new ResizeObserver(() => { try { map?.resize() } catch { /* removed */ } })
      resizer.observe(container)
    })()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      observer?.disconnect()
      resizer?.disconnect()
      if (map) {
        try { map.remove() } catch { /* ignore */ }
      }
    }
  }, [])

  return <div ref={containerRef} className="w-full aspect-square" aria-hidden="true" />
}
