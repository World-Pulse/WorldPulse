'use client'

import { useEffect, useRef } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'

interface Props {
  lat: number
  lng: number
  title: string
  severity: string
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#fbbf24',
  low:      '#8892a4',
  info:     '#5a6477',
}

const MAP_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    basemap: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [
    { id: 'bg',      type: 'background' as const, paint: { 'background-color': '#06070d' } },
    {
      id: 'basemap', type: 'raster' as const, source: 'basemap',
      paint: {
        'raster-opacity':         0.35,
        'raster-saturation':     -0.9,
        'raster-brightness-min':  0.05,
        'raster-brightness-max':  0.45,
      },
    },
  ],
}

export function SignalMap({ lat, lng, title, severity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let ml: typeof import('maplibre-gl') | null = null

    import('maplibre-gl').then(m => {
      ml = m
      if (!containerRef.current) return

      const map = new m.Map({
        container: containerRef.current,
        style:     MAP_STYLE,
        center:    [lng, lat],
        zoom:      8,
        interactive: false,
        attributionControl: false,
      })
      mapRef.current = map

      const color = SEV_COLOR[severity] ?? '#8892a4'

      // Pulsing marker element
      const el = document.createElement('div')
      el.style.cssText = `
        width:20px;height:20px;border-radius:50%;
        background:${color};
        box-shadow:0 0 0 4px ${color}44, 0 0 12px ${color}88;
        border:2px solid #fff;
        cursor:default;
      `

      map.on('load', () => {
        new m.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(
            new m.Popup({ offset: 14, closeButton: false, closeOnClick: false })
              .setHTML(
                `<div style="font:600 12px/1.5 system-ui;color:#e2e6f0;max-width:180px">${title}</div>`,
              ),
          )
          .addTo(map)
      })
    }).catch(() => {/* map unavailable */})

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng])

  return (
    <div
      ref={containerRef}
      className="w-full h-[220px] rounded-lg overflow-hidden border border-white/10"
      aria-label={`Map showing location of signal: ${title}`}
    />
  )
}
