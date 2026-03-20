'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import 'maplibre-gl/dist/maplibre-gl.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type ViewMode = 'points' | 'heat' | 'countries'

interface MapSignal {
  id: string
  title: string
  summary: string | null
  lat: number
  lng: number
  severity: string
  category: string
  status: string
  locationName: string | null
  location_name: string | null
  countryCode: string | null
  country_code: string | null
  reliabilityScore: number
  reliability_score: number
  createdAt: string
  created_at: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  originalUrls: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  original_urls: any
}

function normalizeSignal(s: MapSignal): MapSignal {
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
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#00d4ff',
  low:      '#00e676',
  info:     '#8892a4',
}

const SEV_BG: Record<string, string> = {
  critical: 'rgba(255,59,92,0.15)',
  high:     'rgba(245,166,35,0.15)',
  medium:   'rgba(0,212,255,0.15)',
  low:      'rgba(0,230,118,0.15)',
  info:     'rgba(136,146,164,0.15)',
}

const SEV_ORDER: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
}

const CAT_ICON: Record<string, string> = {
  breaking: '🚨', conflict: '⚔️', geopolitics: '🌐', climate: '🌡️',
  health: '🏥', economy: '📈', technology: '💻', science: '🔬',
  elections: '🗳️', culture: '🎭', disaster: '🌊', security: '🔒',
  sports: '⚽', space: '🚀', other: '🌍',
}

function timeAgo(d: string) {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function getSourceUrl(sig: MapSignal): string | null {
  try {
    const raw = sig.originalUrls
    const urls: string[] = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])
    return urls?.[0] ?? null
  } catch { return null }
}

// Build country choropleth paint expressions from signal data
function buildChoropleth(sigs: MapSignal[]) {
  const counts: Record<string, number> = {}
  const worst:  Record<string, string> = {}

  for (const s of sigs) {
    const cc = s.countryCode
    if (!cc || cc === '-99' || cc === '-1') continue
    counts[cc] = (counts[cc] || 0) + 1
    if (!worst[cc] || SEV_ORDER[s.severity] > SEV_ORDER[worst[cc]]) {
      worst[cc] = s.severity
    }
  }

  const colorExpr:   unknown[] = ['match', ['get', 'ISO_A2']]
  const opacityExpr: unknown[] = ['match', ['get', 'ISO_A2']]

  for (const cc of Object.keys(counts)) {
    colorExpr.push(cc,   SEV_COLOR[worst[cc]] ?? '#8892a4')
    opacityExpr.push(cc, Math.min(0.08 + counts[cc] * 0.025, 0.38))
  }

  colorExpr.push('rgba(0,0,0,0)')
  opacityExpr.push(0)

  return { colorExpr, opacityExpr, counts, worst }
}

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef    = useRef<any>(null)
  const popupRef  = useRef<{ remove: () => void } | null>(null)
  const [signals,   setSignals]   = useState<MapSignal[]>([])
  const [selected,  setSelected]  = useState<MapSignal | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [category,  setCategory]  = useState('all')
  const [hours,     setHours]     = useState(24)
  const [viewMode,  setViewMode]  = useState<ViewMode>('points')
  const [mapReady,  setMapReady]  = useState(false)
  const [hovCountry, setHovCountry] = useState<{ name: string; count: number; sev: string } | null>(null)

  // ─── Fetch signals ──────────────────────────────────────────
  const fetchSignals = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ hours: String(hours), ...(category !== 'all' ? { category } : {}) })
      const res  = await fetch(`${API_URL}/api/v1/signals/map/points?${p}`)
      const data = await res.json() as { success: boolean; data: MapSignal[] }
      if (data.success) setSignals(data.data.map(normalizeSignal))
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [category, hours])

  useEffect(() => { fetchSignals() }, [fetchSignals])

  // ─── GeoJSON builder ────────────────────────────────────────
  const buildGeoJSON = useCallback((sigs: MapSignal[]) => ({
    type: 'FeatureCollection' as const,
    features: sigs.map(s => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      properties: {
        ...s,
        color:        SEV_COLOR[s.severity] ?? '#8892a4',
        originalUrls: JSON.stringify(Array.isArray(s.originalUrls) ? s.originalUrls : []),
      },
    })),
  }), [])

  // ─── Initialize MapLibre ────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || typeof window === 'undefined') return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any

    async function initMap() {
      const ml = await import('maplibre-gl')

      map = new ml.Map({
        container: mapContainer.current!,
        style: {
          version: 8,
          // Free public font server for text labels
          glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
          sources: {
            // CartoDB Dark Matter — no labels layer (we add labels on top of data)
            basemap: {
              type: 'raster',
              tiles: [
                'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
                'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
              ],
              tileSize: 256,
              attribution: '© CARTO © OpenStreetMap contributors',
            },
            // Labels-only layer so they render above our data
            labels: {
              type: 'raster',
              tiles: [
                'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
              ],
              tileSize: 256,
            },
          },
          layers: [
            { id: 'bg', type: 'background' as const, paint: { 'background-color': '#0a0b14' } },
            { id: 'basemap', type: 'raster' as const, source: 'basemap', paint: { 'raster-opacity': 0.92 } },
          ],
        },
        center: [10, 20],
        zoom: 2,
        minZoom: 1,
        maxZoom: 14,
        attributionControl: false,
      })

      mapRef.current = map

      map.on('load', () => {
        // ── Countries source (Natural Earth 110m) ───────────────
        map.addSource('countries', {
          type: 'geojson',
          data: 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson',
          generateId: true,
        })

        // Country fill choropleth
        map.addLayer({
          id: 'country-fill',
          type: 'fill',
          source: 'countries',
          paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0 },
        })

        // Country borders (always visible, subtle)
        map.addLayer({
          id: 'country-line',
          type: 'line',
          source: 'countries',
          paint: { 'line-color': 'rgba(255,255,255,0.1)', 'line-width': 0.5 },
        })

        // Country hover outline
        map.addLayer({
          id: 'country-hover',
          type: 'line',
          source: 'countries',
          paint: {
            'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], 'rgba(255,255,255,0.55)', 'rgba(0,0,0,0)'],
            'line-width': 1.5,
          },
        })

        // ── Signals source ──────────────────────────────────────
        map.addSource('signals', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 6,
          clusterRadius: 50,
        })

        // ── Heatmap (hidden by default) ─────────────────────────
        map.addLayer({
          id: 'signal-heatmap',
          type: 'heatmap',
          source: 'signals',
          layout: { visibility: 'none' },
          paint: {
            'heatmap-weight': ['match', ['get', 'severity'],
              'critical', 1.0, 'high', 0.75, 'medium', 0.5, 'low', 0.25, 0.1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 5],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,    'rgba(0,0,0,0)',
              0.15, 'rgba(0,100,200,0.5)',
              0.35, 'rgba(0,212,255,0.7)',
              0.55, 'rgba(245,166,35,0.85)',
              0.75, 'rgba(255,59,92,0.9)',
              1.0,  'rgba(255,0,80,1)',
            ],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 9, 40],
            'heatmap-opacity': 0.85,
          },
        })

        // ── Cluster halos ───────────────────────────────────────
        map.addLayer({
          id: 'cluster-halo',
          type: 'circle',
          source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#f5a62318', 10, '#ff3b5c18'],
            'circle-radius': ['step', ['get', 'point_count'], 32, 10, 40, 30, 48],
            'circle-blur': 0.7,
          },
        })

        // ── Clusters ────────────────────────────────────────────
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#f5a623', 10, '#ff5e3a', 30, '#ff3b5c'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 26, 30, 32],
            'circle-opacity': 0.95,
            'circle-stroke-color': 'rgba(255,255,255,0.18)',
            'circle-stroke-width': 1.5,
          },
        })

        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'signals',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-size': 12,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          },
          paint: { 'text-color': '#000000' },
        })

        // ── Signal glow ─────────────────────────────────────────
        map.addLayer({
          id: 'signal-glow',
          type: 'circle',
          source: 'signals',
          filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'severity'], 'critical']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': 18,
            'circle-opacity': 0.1,
            'circle-blur': 1.2,
          },
        })

        // ── Non-critical signal points ──────────────────────────
        map.addLayer({
          id: 'signal-points',
          type: 'circle',
          source: 'signals',
          filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'severity'], 'critical']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': 7,
            'circle-opacity': 0.92,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 2.5,
            'circle-stroke-opacity': 0.3,
          },
        })

        // ── Pulsing image for CRITICAL signals ──────────────────
        const sz = 140
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pulsingDot: any = {
          width: sz, height: sz,
          data: new Uint8ClampedArray(sz * sz * 4),
          ctx: null as CanvasRenderingContext2D | null,
          onAdd() {
            const c = document.createElement('canvas')
            c.width = c.height = sz
            this.ctx = c.getContext('2d')
          },
          render() {
            const t  = (performance.now() % 1800) / 1800
            const t2 = ((performance.now() + 900) % 1800) / 1800
            const cx = sz / 2, inner = sz * 0.17
            const ctx = this.ctx!
            ctx.clearRect(0, 0, sz, sz)

            // Double pulse rings
            for (const [pt, alpha] of [[t, 0.9], [t2, 0.45]] as [number, number][]) {
              const r = inner + sz * 0.38 * pt
              ctx.beginPath()
              ctx.arc(cx, cx, r, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255,59,92,${(1 - pt) * alpha})`
              ctx.lineWidth = 2.5 - pt * 1.5
              ctx.stroke()
            }

            // Core glow
            const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, inner * 1.8)
            g.addColorStop(0, 'rgba(255,120,150,0.5)')
            g.addColorStop(1, 'rgba(255,59,92,0)')
            ctx.beginPath()
            ctx.arc(cx, cx, inner * 1.8, 0, Math.PI * 2)
            ctx.fillStyle = g
            ctx.fill()

            // Core dot
            ctx.beginPath()
            ctx.arc(cx, cx, inner, 0, Math.PI * 2)
            const cg = ctx.createRadialGradient(cx - inner * 0.3, cx - inner * 0.3, 0, cx, cx, inner)
            cg.addColorStop(0, '#ff8fa8')
            cg.addColorStop(1, '#ff3b5c')
            ctx.fillStyle = cg
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.85)'
            ctx.lineWidth = 1.5
            ctx.stroke()

            this.data = ctx.getImageData(0, 0, sz, sz).data
            map.triggerRepaint()
            return true
          },
        }
        map.addImage('pulsing-critical', pulsingDot, { pixelRatio: 2 })

        // Critical signal symbol layer
        map.addLayer({
          id: 'signal-critical',
          type: 'symbol',
          source: 'signals',
          filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'severity'], 'critical']],
          layout: {
            'icon-image': 'pulsing-critical',
            'icon-size': 1,
            'icon-allow-overlap': true,
          },
        })

        // ── CartoDB labels on top of data ───────────────────────
        map.addLayer({
          id: 'map-labels',
          type: 'raster',
          source: 'labels',
          paint: { 'raster-opacity': 0.85 },
        })

        // ── Cursors ──────────────────────────────────────────────
        const on  = () => { map.getCanvas().style.cursor = 'pointer' }
        const off = () => { map.getCanvas().style.cursor = '' }
        for (const id of ['signal-points', 'signal-critical', 'clusters']) {
          map.on('mouseenter', id, on)
          map.on('mouseleave', id, off)
        }

        // ── Hover popup ─────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const showPopup = (e: any) => {
          if (!e.features?.[0]) return
          const p = e.features[0].properties
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${SEV_COLOR[p.severity] ?? '#8892a4'};margin-right:4px;vertical-align:middle"></span>`
          const popup = new ml.Popup({
            closeButton: false, closeOnClick: false,
            offset: 14, className: 'wp-map-popup',
          })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font:10px/1 'SF Mono',monospace;color:#8892a4;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">
                ${dot}${p.severity} · ${p.category}
              </div>
              <div style="font:600 13px/1.4 -apple-system,system-ui,sans-serif;color:#e8eaf0;max-width:240px">
                ${p.title}
              </div>
              ${p.locationName ? `<div style="font:11px 'SF Mono',monospace;color:#8892a4;margin-top:5px">📍 ${p.locationName}</div>` : ''}
            `)
            .addTo(map)
          popupRef.current = popup
        }
        const hidePopup = () => {
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
        }
        map.on('mouseenter', 'signal-points',   showPopup)
        map.on('mouseleave', 'signal-points',   hidePopup)
        map.on('mouseenter', 'signal-critical', showPopup)
        map.on('mouseleave', 'signal-critical', hidePopup)

        // ── Pin click: select + flyTo ────────────────────────────
        let pinClicked = false

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handlePinClick = (e: any) => {
          if (!e.features?.[0]) return
          pinClicked = true
          hidePopup()
          const p = e.features[0].properties
          setSelected(p)
          map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 5), speed: 1.2, duration: 700 })
        }
        map.on('click', 'signal-points',   handlePinClick)
        map.on('click', 'signal-critical', handlePinClick)

        // ── Cluster click: zoom in ───────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', 'clusters', async (e: any) => {
          pinClicked = true
          const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
          if (!features.length) return
          const clusterId = features[0].properties.cluster_id
          const source = map.getSource('signals')
          const zoom = await source.getClusterExpansionZoom(clusterId)
          map.flyTo({ center: features[0].geometry.coordinates, zoom, duration: 600, speed: 1.5 })
        })

        // ── Background click: deselect ────────────────────────────
        map.on('click', () => {
          if (pinClicked) { pinClicked = false; return }
          setSelected(null)
        })

        // ── Country hover ────────────────────────────────────────
        let hoveredId: number | string | null = null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('mousemove', 'country-fill', (e: any) => {
          if (!e.features?.length) return
          if (hoveredId !== null) map.setFeatureState({ source: 'countries', id: hoveredId }, { hover: false })
          hoveredId = e.features[0].id
          map.setFeatureState({ source: 'countries', id: hoveredId }, { hover: true })
          const iso = e.features[0].properties?.ISO_A2
          const name = e.features[0].properties?.NAME ?? iso
          // Post country info to React state
          if (iso) {
            const count = 0 // will be computed below via ref
            setHovCountry({ name, count, sev: 'info' })
          }
        })
        map.on('mouseleave', 'country-fill', () => {
          if (hoveredId !== null) map.setFeatureState({ source: 'countries', id: hoveredId }, { hover: false })
          hoveredId = null
          setHovCountry(null)
        })

        setMapReady(true)
        setLoading(false)
      })
    }

    initMap()
    return () => {
      if (popupRef.current) popupRef.current.remove()
      if (mapRef.current) mapRef.current.remove()
    }
  }, [])

  // ─── Update map data when signals change ────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const source = mapRef.current.getSource('signals')
    if (!source) return
    source.setData(buildGeoJSON(signals))
  }, [signals, mapReady, buildGeoJSON])

  // ─── Apply choropleth when in countries mode ─────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || viewMode !== 'countries') return
    const { colorExpr, opacityExpr } = buildChoropleth(signals)
    try {
      mapRef.current.setPaintProperty('country-fill', 'fill-color',   colorExpr)
      mapRef.current.setPaintProperty('country-fill', 'fill-opacity', opacityExpr)
    } catch { /* layer not ready yet */ }
  }, [signals, mapReady, viewMode])

  // ─── Toggle layer visibility when viewMode changes ──────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current
    const isHeat = viewMode === 'heat'

    try {
      map.setLayoutProperty('signal-heatmap', 'visibility', isHeat ? 'visible' : 'none')
      for (const id of ['signal-glow', 'signal-points', 'signal-critical', 'cluster-halo', 'clusters', 'cluster-count']) {
        map.setLayoutProperty(id, 'visibility', isHeat ? 'none' : 'visible')
      }
      if (viewMode === 'countries') {
        const { colorExpr, opacityExpr } = buildChoropleth(signals)
        map.setPaintProperty('country-fill', 'fill-color',   colorExpr)
        map.setPaintProperty('country-fill', 'fill-opacity', opacityExpr)
      } else {
        map.setPaintProperty('country-fill', 'fill-color',   'rgba(0,0,0,0)')
        map.setPaintProperty('country-fill', 'fill-opacity', 0)
      }
    } catch { /* ignore */ }
  }, [viewMode, mapReady]) // eslint-disable-line

  const CATEGORIES   = ['all','breaking','conflict','climate','economy','technology','health','disaster']
  const HOURS_OPTIONS = [{ v: 6, l: '6h' }, { v: 24, l: '24h' }, { v: 72, l: '3d' }, { v: 168, l: '7d' }]

  const sevColor = selected ? (SEV_COLOR[selected.severity] ?? '#8892a4') : '#8892a4'
  const sevBg    = selected ? (SEV_BG[selected.severity]    ?? 'rgba(136,146,164,0.15)') : ''
  const sourceUrl = selected ? getSourceUrl(selected) : null

  // Severity counts for mini stats
  const sevCounts = signals.reduce((acc, s) => {
    acc[s.severity] = (acc[s.severity] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col bg-[#0a0b14]">

      {/* ─── Toolbar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[rgba(255,255,255,0.07)] z-10 bg-[rgba(10,11,20,0.92)] backdrop-blur-xl flex-wrap">
        <span className="font-display text-[14px] tracking-[2.5px] text-wp-text font-bold">LIVE MAP</span>

        <div className="w-px h-4 bg-[rgba(255,255,255,0.1)]" />

        {/* Category filters */}
        <div className="flex gap-[4px] flex-wrap">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-[9px] py-[3px] rounded-full border text-[10px] font-mono capitalize transition-all
                ${category === cat
                  ? 'border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.1)]'
                  : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-[2px] p-[3px] rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.07)]">
            {([
              { v: 'points',    l: '⬤ Points'  },
              { v: 'heat',      l: '⬛ Heat'    },
              { v: 'countries', l: '🌐 Regions' },
            ] as { v: ViewMode; l: string }[]).map(opt => (
              <button key={opt.v} onClick={() => setViewMode(opt.v)}
                className={`px-3 py-[4px] rounded-[6px] text-[10px] font-mono transition-all
                  ${viewMode === opt.v
                    ? 'bg-[rgba(255,255,255,0.1)] text-wp-text'
                    : 'text-wp-text3 hover:text-wp-text2'}`}>
                {opt.l}
              </button>
            ))}
          </div>

          {/* Time window */}
          <div className="flex gap-[3px]">
            {HOURS_OPTIONS.map(opt => (
              <button key={opt.v} onClick={() => setHours(opt.v)}
                className={`px-2.5 py-[3px] rounded border text-[10px] font-mono transition-all
                  ${hours === opt.v
                    ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.15)]'}`}>
                {opt.l}
              </button>
            ))}
          </div>

          {/* Live signal count */}
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-wp-text2 border border-[rgba(255,255,255,0.07)] rounded-lg px-2.5 py-[4px]">
            <span className="w-[5px] h-[5px] rounded-full bg-wp-red animate-live-pulse" />
            {signals.length} signals
          </div>
        </div>
      </div>

      {/* ─── Map area ───────────────────────────────────────── */}
      <div className="flex-1 relative" style={{ overflowX: 'clip' }}>
        <div ref={mapContainer} className="absolute inset-0" />

        {/* Severity mini-stats (bottom left) */}
        <div className="absolute bottom-6 left-4 z-10 pointer-events-none space-y-3">
          {/* Legend */}
          <div className="bg-[rgba(10,11,20,0.88)] border border-[rgba(255,255,255,0.09)] rounded-xl p-3 backdrop-blur-xl">
            <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2">Severity</div>
            <div className="space-y-1.5">
              {Object.entries(SEV_COLOR).map(([sev, color]) => (
                <div key={sev} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
                    <span className="font-mono text-[10px] text-wp-text2 capitalize">{sev}</span>
                  </div>
                  {sevCounts[sev] ? (
                    <span className="font-mono text-[10px] text-wp-text3">{sevCounts[sev]}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Country hover tooltip */}
        {hovCountry && viewMode === 'countries' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none
            bg-[rgba(10,11,20,0.92)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 backdrop-blur-xl">
            <span className="font-mono text-[11px] text-wp-text">{hovCountry.name}</span>
          </div>
        )}

        {/* Attribution */}
        <div className="absolute bottom-2 right-2 z-10 pointer-events-none font-mono text-[9px] text-wp-text3 opacity-50">
          © CARTO © OpenStreetMap
        </div>

        {/* ─── Signal detail panel (slide in from right) ──── */}
        <div
          className={`absolute top-0 right-0 h-full w-[340px] bg-[rgba(8,9,18,0.98)] border-l border-[rgba(255,255,255,0.09)] backdrop-blur-xl z-20 flex flex-col transition-transform duration-300 ease-out ${selected ? 'translate-x-0' : 'translate-x-full'}`}
        >
          {selected && (
            <>
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.07)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: sevColor, boxShadow: `0 0 7px ${sevColor}` }} />
                  <span className="font-mono text-[10px] tracking-[1.5px] uppercase" style={{ color: sevColor }}>
                    {selected.severity}
                  </span>
                  <span className="text-wp-text3">·</span>
                  <span className="font-mono text-[10px] text-wp-text3 uppercase">
                    {CAT_ICON[selected.category] ?? ''} {selected.category}
                  </span>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.06)] transition-all text-[18px] leading-none"
                >×</button>
              </div>

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div className="text-[15px] font-semibold text-wp-text leading-[1.5]">
                  {selected.title}
                </div>

                {selected.summary && (
                  <p className="text-[13px] text-wp-text2 leading-[1.65] border-l-2 pl-3" style={{ borderColor: sevColor + '55' }}>
                    {selected.summary}
                  </p>
                )}

                <div className="space-y-2">
                  {selected.locationName && (
                    <div className="flex items-center gap-2 text-[12px] text-wp-text2">
                      <span>📍</span><span>{selected.locationName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 font-mono text-[11px] text-wp-text3">
                    <span>🕐</span>
                    <span>{timeAgo(selected.createdAt ?? selected.created_at)}</span>
                    {selected.status && (
                      <>
                        <span className="mx-1">·</span>
                        <span className={`uppercase tracking-wider text-[9px] ${selected.status === 'verified' ? 'text-wp-green' : 'text-wp-amber'}`}>
                          {selected.status}
                        </span>
                      </>
                    )}
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
                    <div className="h-full rounded-full bg-gradient-to-r from-[#00e676] to-[#00c853] transition-all"
                      style={{ width: `${Math.round((selected.reliabilityScore ?? selected.reliability_score ?? 0) * 100)}%` }} />
                  </div>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium"
                  style={{ background: sevBg, color: sevColor, border: `1px solid ${sevColor}30` }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: sevColor }} />
                  {selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} severity
                </div>
              </div>

              {/* Actions */}
              <div className="px-5 py-4 border-t border-[rgba(255,255,255,0.07)] space-y-2">
                {sourceUrl && (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                    style={{ background: sevBg, color: sevColor, border: `1px solid ${sevColor}40` }}>
                    Read Original Source
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </a>
                )}
                <Link href={`/?signal=${selected.id}`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[13px] text-wp-text2 hover:bg-[rgba(255,255,255,0.07)] hover:text-wp-text transition-all">
                  View on Feed
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </Link>
              </div>
            </>
          )}
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(10,11,20,0.75)] z-30">
            <div className="font-mono text-[12px] text-wp-amber animate-pulse">Loading signals…</div>
          </div>
        )}
      </div>

      <style>{`
        .wp-map-popup .maplibregl-popup-content {
          background: rgba(10, 11, 20, 0.97);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 10px 13px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
          backdrop-filter: blur(16px);
          max-width: 280px;
        }
        .wp-map-popup .maplibregl-popup-tip {
          border-top-color: rgba(10,11,20,0.97) !important;
        }
        .maplibregl-ctrl-attrib { display: none !important; }
      `}</style>
    </div>
  )
}
