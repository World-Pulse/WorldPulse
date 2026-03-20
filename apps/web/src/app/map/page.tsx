'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import 'maplibre-gl/dist/maplibre-gl.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface MapSignal {
  id: string; title: string; summary: string | null
  lat: number; lng: number; severity: string; category: string; status: string
  locationName: string | null; location_name: string | null
  countryCode: string | null; country_code: string | null
  reliabilityScore: number; reliability_score: number
  createdAt: string; created_at: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  originalUrls: any; original_urls: any
}

function norm(s: MapSignal): MapSignal {
  return {
    ...s,
    locationName:     s.locationName     ?? s.location_name     ?? null,
    countryCode:      s.countryCode      ?? s.country_code      ?? null,
    reliabilityScore: s.reliabilityScore ?? s.reliability_score ?? 0,
    createdAt:        s.createdAt        ?? s.created_at        ?? '',
    originalUrls:     s.originalUrls     ?? s.original_urls     ?? null,
  }
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c', high: '#f5a623', medium: '#00d4ff', low: '#00e676', info: '#8892a4',
}
const SEV_BG: Record<string, string> = {
  critical: 'rgba(255,59,92,0.15)', high: 'rgba(245,166,35,0.15)',
  medium: 'rgba(0,212,255,0.15)', low: 'rgba(0,230,118,0.15)', info: 'rgba(136,146,164,0.15)',
}
const CAT_ICON: Record<string, string> = {
  breaking: '🚨', conflict: '⚔️', geopolitics: '🌐', climate: '🌡️', health: '🏥',
  economy: '📈', technology: '💻', science: '🔬', elections: '🗳️', culture: '🎭',
  disaster: '🌊', security: '🔒', sports: '⚽', space: '🚀', other: '🌍',
}

function timeAgo(d: string) {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function getSourceUrl(sig: MapSignal): string | null {
  try {
    const raw = sig.originalUrls
    const urls: string[] = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : []
    return urls?.[0] ?? null
  } catch { return null }
}

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef    = useRef<any>(null)
  const popupRef  = useRef<{ remove: () => void } | null>(null)

  const signalsRef = useRef<MapSignal[]>([])   // always current, readable inside map closures

  const [signals,  setSignals]  = useState<MapSignal[]>([])
  const [selected, setSelected] = useState<MapSignal | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [category, setCategory] = useState('all')
  const [hours,    setHours]    = useState(24)

  // ── Fetch signals ────────────────────────────────────────────
  const fetchSignals = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ hours: String(hours), ...(category !== 'all' ? { category } : {}) })
      const res  = await fetch(`${API_URL}/api/v1/signals/map/points?${p}`)
      const data = await res.json() as { success: boolean; data: MapSignal[] }
      if (data.success && Array.isArray(data.data)) {
        const normalized = data.data.map(norm)
        signalsRef.current = normalized
        setSignals(normalized)
      }
    } catch (e) {
      console.error('[map] fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [category, hours])

  useEffect(() => { fetchSignals() }, [fetchSignals])

  // ── Initialize MapLibre once ─────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || typeof window === 'undefined') return

    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null
    let ro: ResizeObserver | null = null

    ;(async () => {
      const ml = await import('maplibre-gl')
      if (cancelled) return

      map = new ml.Map({
        container: mapContainer.current!,
        style: {
          version: 8,
          sources: {
            basemap: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap',
            },
          },
          layers: [
            { id: 'bg',      type: 'background' as const, paint: { 'background-color': '#06070d' } },
            { id: 'basemap', type: 'raster'     as const, source: 'basemap',
              paint: { 'raster-opacity': 0.35, 'raster-saturation': -0.9,
                'raster-brightness-min': 0.05, 'raster-brightness-max': 0.45 } },
          ],
        },
        center: [10, 20],
        zoom: 2,
        minZoom: 1,
        maxZoom: 14,
        attributionControl: false,
      })

      mapRef.current = map

      // Keep canvas sized to container
      ro = new ResizeObserver(() => { if (mapRef.current) mapRef.current.resize() })
      if (mapContainer.current) ro.observe(mapContainer.current)

      map.on('error', (e: unknown) => { console.error('[maplibre] error:', e) })

      map.on('load', () => {
        if (cancelled) return

        // Force canvas to correct dimensions after DOM layout settles
        map.resize()

        map.addSource('signals', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 6,
          clusterRadius: 50,
        })

        // Cluster halo
        map.addLayer({
          id: 'cluster-halo', type: 'circle', source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#f5a623',
            'circle-radius': ['step', ['get', 'point_count'], 30, 10, 38, 30, 46],
            'circle-opacity': 0.08,
            'circle-blur': 0.7,
          },
        })

        // Clusters
        map.addLayer({
          id: 'clusters', type: 'circle', source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#f5a623', 10, '#ff5e3a', 30, '#ff3b5c'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 26, 30, 32],
            'circle-opacity': 0.95,
            'circle-stroke-color': 'rgba(255,255,255,0.18)',
            'circle-stroke-width': 1.5,
          },
        })

        // Signal glow
        map.addLayer({
          id: 'signal-glow', type: 'circle', source: 'signals',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': 16,
            'circle-opacity': 0.12,
            'circle-blur': 1.2,
          },
        })

        // Signal points
        map.addLayer({
          id: 'signal-points', type: 'circle', source: 'signals',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': ['case', ['==', ['get', 'severity'], 'critical'], 9, 7],
            'circle-opacity': 0.92,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 0.35,
          },
        })

        // Seed with any signals already fetched before map loaded
        if (signalsRef.current.length > 0) {
          map.getSource('signals').setData({
            type: 'FeatureCollection',
            features: signalsRef.current
              .filter(s => s.lat != null && s.lng != null)
              .map(s => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [Number(s.lng), Number(s.lat)] },
                properties: {
                  ...s,
                  lat: Number(s.lat), lng: Number(s.lng),
                  color: SEV_COLOR[s.severity] ?? '#8892a4',
                  originalUrls: JSON.stringify(Array.isArray(s.originalUrls) ? s.originalUrls : []),
                },
              })),
          })
        }

        // Cursors
        const on  = () => { map.getCanvas().style.cursor = 'pointer' }
        const off = () => { map.getCanvas().style.cursor = '' }
        map.on('mouseenter', 'signal-points', on)
        map.on('mouseleave', 'signal-points', off)
        map.on('mouseenter', 'clusters', on)
        map.on('mouseleave', 'clusters', off)

        // Hover popup
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('mouseenter', 'signal-points', (e: any) => {
          const p = e.features?.[0]?.properties
          if (!p) return
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          popupRef.current = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font:10px/1 monospace;color:#8892a4;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">${p.severity} · ${p.category}</div>
              <div style="font:600 13px/1.4 system-ui;color:#e8eaf0;max-width:230px">${p.title}</div>
              ${p.locationName ? `<div style="font:11px monospace;color:#8892a4;margin-top:4px">📍 ${p.locationName}</div>` : ''}
            `)
            .addTo(map)
        })
        map.on('mouseleave', 'signal-points', () => {
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
        })

        // Pin click
        let pinClicked = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', 'signal-points', (e: any) => {
          const p = e.features?.[0]?.properties
          if (!p) return
          pinClicked = true
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          setSelected(p)
          map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 5), speed: 1.2, duration: 700 })
        })

        // Cluster zoom
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', 'clusters', async (e: any) => {
          pinClicked = true
          const feats = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
          if (!feats.length) return
          const zoom = await map.getSource('signals').getClusterExpansionZoom(feats[0].properties.cluster_id)
          map.flyTo({ center: feats[0].geometry.coordinates, zoom, duration: 600 })
        })

        // Background click: deselect
        map.on('click', () => { if (pinClicked) { pinClicked = false; return } setSelected(null) })
      })
    })()

    return () => {
      cancelled = true
      if (ro) ro.disconnect()
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, []) // run once

  // ── Push signal data to map whenever signals change ──────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    if (!map) return
    const source = map.getSource('signals')
    if (!source) return
    source.setData({
      type: 'FeatureCollection',
      features: signals
        .filter(s => s.lat != null && s.lng != null)
        .map(s => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(s.lng), Number(s.lat)] },
          properties: {
            ...s,
            lat: Number(s.lat),
            lng: Number(s.lng),
            color: SEV_COLOR[s.severity] ?? '#8892a4',
            originalUrls: JSON.stringify(Array.isArray(s.originalUrls) ? s.originalUrls : []),
          },
        })),
    })
  }, [signals])

  const CATS   = ['all','breaking','conflict','climate','economy','technology','health','disaster']
  const HTIMES = [{ v: 6, l: '6h' }, { v: 24, l: '24h' }, { v: 72, l: '3d' }, { v: 168, l: '7d' }]

  const sevColor = selected ? (SEV_COLOR[selected.severity] ?? '#8892a4') : '#8892a4'
  const sevBg    = selected ? (SEV_BG[selected.severity]    ?? 'rgba(136,146,164,0.15)') : ''
  const srcUrl   = selected ? getSourceUrl(selected) : null

  const sevCounts = signals.reduce((a, s) => {
    a[s.severity] = (a[s.severity] || 0) + 1; return a
  }, {} as Record<string, number>)

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col bg-wp-bg">

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[rgba(255,255,255,0.07)] bg-[rgba(6,7,13,0.92)] backdrop-blur-xl z-10 flex-wrap">
        <span className="font-display text-[14px] tracking-[2.5px] text-wp-text font-bold">LIVE MAP</span>
        <div className="w-px h-4 bg-[rgba(255,255,255,0.1)]" />

        <div className="flex gap-[4px] flex-wrap">
          {CATS.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-[9px] py-[3px] rounded-full border text-[10px] font-mono capitalize transition-all
                ${category === cat ? 'border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.1)]' : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-[3px]">
            {HTIMES.map(opt => (
              <button key={opt.v} onClick={() => setHours(opt.v)}
                className={`px-2.5 py-[3px] rounded border text-[10px] font-mono transition-all
                  ${hours === opt.v ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]' : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.15)]'}`}>
                {opt.l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-wp-text2 border border-[rgba(255,255,255,0.07)] rounded-lg px-2.5 py-[4px]">
            <span className="w-[5px] h-[5px] rounded-full bg-wp-red animate-live-pulse" />
            {signals.length} signals
          </div>
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={mapContainer} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

        {/* Legend */}
        <div className="absolute bottom-6 left-4 z-10 pointer-events-none">
          <div className="bg-[rgba(6,7,13,0.88)] border border-[rgba(255,255,255,0.09)] rounded-xl p-3 backdrop-blur-xl">
            <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2">Severity</div>
            <div className="space-y-1.5">
              {Object.entries(SEV_COLOR).map(([sev, color]) => (
                <div key={sev} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
                    <span className="font-mono text-[10px] text-wp-text2 capitalize">{sev}</span>
                  </div>
                  {sevCounts[sev] ? <span className="font-mono text-[10px] text-wp-text3">{sevCounts[sev]}</span> : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Signal detail panel */}
        <div className={`absolute top-0 right-0 h-full w-[340px] bg-[rgba(6,7,13,0.97)] border-l border-[rgba(255,255,255,0.09)] backdrop-blur-xl z-20 flex flex-col transition-transform duration-300 ease-out ${selected ? 'translate-x-0' : 'translate-x-full'}`}>
          {selected && (
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.07)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: sevColor, boxShadow: `0 0 7px ${sevColor}` }} />
                  <span className="font-mono text-[10px] tracking-[1.5px] uppercase" style={{ color: sevColor }}>{selected.severity}</span>
                  <span className="text-wp-text3">·</span>
                  <span className="font-mono text-[10px] text-wp-text3 uppercase">{CAT_ICON[selected.category] ?? ''} {selected.category}</span>
                </div>
                <button onClick={() => setSelected(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.06)] transition-all text-[18px] leading-none">×</button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div className="text-[15px] font-semibold text-wp-text leading-[1.5]">{selected.title}</div>
                {selected.summary && (
                  <p className="text-[13px] text-wp-text2 leading-[1.65] border-l-2 pl-3" style={{ borderColor: sevColor + '55' }}>
                    {selected.summary}
                  </p>
                )}
                <div className="space-y-2">
                  {selected.locationName && (
                    <div className="flex items-center gap-2 text-[12px] text-wp-text2"><span>📍</span><span>{selected.locationName}</span></div>
                  )}
                  <div className="flex items-center gap-2 font-mono text-[11px] text-wp-text3">
                    <span>🕐</span><span>{timeAgo(selected.createdAt ?? selected.created_at)}</span>
                    {selected.status && (<><span className="mx-1">·</span>
                      <span className={`uppercase tracking-wider text-[9px] ${selected.status === 'verified' ? 'text-wp-green' : 'text-wp-amber'}`}>{selected.status}</span>
                    </>)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">Reliability</span>
                    <span className="font-mono text-[12px] font-bold text-wp-green">
                      {Math.round((selected.reliabilityScore ?? selected.reliability_score ?? 0) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[rgba(255,255,255,0.07)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#00e676] to-[#00c853]"
                      style={{ width: `${Math.round((selected.reliabilityScore ?? selected.reliability_score ?? 0) * 100)}%` }} />
                  </div>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium"
                  style={{ background: sevBg, color: sevColor, border: `1px solid ${sevColor}30` }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: sevColor }} />
                  {selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} severity
                </div>
              </div>

              <div className="px-5 py-4 border-t border-[rgba(255,255,255,0.07)] space-y-2">
                {srcUrl && (
                  <a href={srcUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                    style={{ background: sevBg, color: sevColor, border: `1px solid ${sevColor}40` }}>
                    Read Original Source
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </a>
                )}
                <Link href={`/?signal=${selected.id}`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[13px] text-wp-text2 hover:bg-[rgba(255,255,255,0.07)] hover:text-wp-text transition-all">
                  View on Feed
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </Link>
              </div>
            </>
          )}
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(6,7,13,0.7)] z-30">
            <div className="font-mono text-[12px] text-wp-amber animate-pulse">Loading signals…</div>
          </div>
        )}
      </div>

      <style>{`
        .wp-map-popup .maplibregl-popup-content {
          background: rgba(6,7,13,0.97);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 10px 13px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          backdrop-filter: blur(12px);
        }
        .wp-map-popup .maplibregl-popup-tip { border-top-color: rgba(6,7,13,0.97) !important; }
        .maplibregl-ctrl-attrib { display: none !important; }
      `}</style>
    </div>
  )
}
