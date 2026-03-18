'use client'

import { useEffect, useRef, useState } from 'react'
import type { Signal } from '@worldpulse/types'
import 'maplibre-gl/dist/maplibre-gl.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// MapLibre loaded dynamically (no SSR)
interface MapSignal {
  id: string
  title: string
  lat: number
  lng: number
  severity: string
  category: string
  locationName: string | null
  countryCode: string | null
  reliabilityScore: number
  createdAt: string
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#00d4ff',
  low:      '#00e676',
  info:     '#8892a4',
}

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<unknown>(null)
  const [signals, setSignals] = useState<MapSignal[]>([])
  const [selected, setSelected] = useState<MapSignal | null>(null)
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all')
  const [hours, setHours] = useState(24)

  // Load signals
  const fetchSignals = async () => {
    try {
      const params = new URLSearchParams({ hours: String(hours), ...(category !== 'all' ? { category } : {}) })
      const res  = await fetch(`${API_URL}/api/v1/signals/map/points?${params}`)
      const data = await res.json() as { success: boolean; data: MapSignal[] }
      if (data.success) setSignals(data.data)
    } catch {
      // Use demo data if API unavailable
      setSignals(DEMO_SIGNALS)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSignals() }, [category, hours]) // eslint-disable-line

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainer.current || typeof window === 'undefined') return

    let map: {
      on: (e: string, ...args: unknown[]) => void
      addSource: (id: string, data: unknown) => void
      addLayer: (layer: unknown) => void
      getSource: (id: string) => { setData: (data: unknown) => void } | undefined
      remove: () => void
    }

    async function initMap() {
      const maplibre = await import('maplibre-gl')

      map = new maplibre.Map({
        container: mapContainer.current!,
        style: {
          version: 8,
          sources: {
            'osm-tiles': {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap',
            },
          },
          layers: [
            {
              id: 'background',
              type: 'background' as const,
              paint: { 'background-color': '#06070d' },
            },
            {
              id: 'osm-tiles',
              type: 'raster' as const,
              source: 'osm-tiles',
              paint: {
                'raster-opacity': 0.15,
                'raster-saturation': -1,
                'raster-brightness-min': 0.1,
                'raster-brightness-max': 0.3,
              },
            },
          ],
        },
        center: [10, 20],
        zoom: 2,
        minZoom: 1,
        maxZoom: 12,
        attributionControl: false,
      }) as typeof map

      mapRef.current = map

      map.on('load', () => {
        // Add signal points source
        map.addSource('signals', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 5,
          clusterRadius: 40,
        })

        // Cluster circles
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#f5a623', 10, '#ff3b5c', 30, '#ff3b5c'],
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 30, 28],
            'circle-opacity': 0.9,
          },
        })

        // Cluster count labels
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'signals',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-size': 11,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          },
          paint: { 'text-color': '#000' },
        })

        // Individual signal points
        map.addLayer({
          id: 'signal-points',
          type: 'circle',
          source: 'signals',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': 7,
            'circle-opacity': 0.9,
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.5,
          },
        })

        // Click handler
        map.on('click', 'signal-points', (e: { features?: Array<{ properties: MapSignal & { color: string } }> }) => {
          if (e.features?.[0]) {
            setSelected(e.features[0].properties)
          }
        })

        setLoading(false)
      })
    }

    initMap()
    return () => { if (mapRef.current) (mapRef.current as { remove: () => void }).remove() }
  }, [])

  // Update map data when signals change
  useEffect(() => {
    const map = mapRef.current as { getSource: (id: string) => { setData: (d: unknown) => void } | undefined } | null
    if (!map) return

    const source = map.getSource('signals')
    if (!source) return

    source.setData({
      type: 'FeatureCollection',
      features: signals.map(s => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { ...s, color: SEVERITY_COLORS[s.severity] ?? '#8892a4' },
      })),
    })
  }, [signals])

  const CATEGORIES = ['all','breaking','conflict','climate','economy','technology','health','disaster']
  const HOURS_OPTIONS = [{ v: 6, l: '6h' }, { v: 24, l: '24h' }, { v: 72, l: '3d' }, { v: 168, l: '7d' }]

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col bg-wp-bg">

      {/* Map toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 glass border-b border-[rgba(255,255,255,0.07)] z-10">
        <span className="font-display text-[16px] tracking-[2px] text-wp-text">LIVE MAP</span>
        <div className="w-px h-5 bg-[rgba(255,255,255,0.1)]" />

        {/* Category filters */}
        <div className="flex gap-[6px] flex-wrap">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-[10px] py-1 rounded-full border text-[11px] font-mono capitalize transition-all
                ${category === cat ? 'border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.1)]' : 'border-[rgba(255,255,255,0.07)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[rgba(255,255,255,0.1)] ml-auto" />

        {/* Time window */}
        <div className="flex gap-[4px]">
          {HOURS_OPTIONS.map(opt => (
            <button key={opt.v} onClick={() => setHours(opt.v)}
              className={`px-3 py-1 rounded border text-[11px] font-mono transition-all
                ${hours === opt.v ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]' : 'border-[rgba(255,255,255,0.07)] text-wp-text3'}`}>
              {opt.l}
            </button>
          ))}
        </div>

        {/* Live count */}
        <div className="flex items-center gap-2 font-mono text-[11px] text-wp-text2">
          <span className="w-[6px] h-[6px] rounded-full bg-wp-red animate-live-pulse" />
          {signals.length} signals
        </div>
      </div>

      {/* Map container */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="w-full h-full" />

        {/* Legend */}
        <div className="absolute bottom-6 left-6 bg-[rgba(6,7,13,0.92)] border border-[rgba(255,255,255,0.1)] rounded-xl p-4 backdrop-blur-xl">
          <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-3">Severity</div>
          <div className="space-y-2">
            {Object.entries(SEVERITY_COLORS).map(([sev, color]) => (
              <div key={sev} className="flex items-center gap-2 font-mono text-[10px] text-wp-text2 capitalize">
                <div className="w-[8px] h-[8px] rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                {sev}
              </div>
            ))}
          </div>
        </div>

        {/* Selected signal panel */}
        {selected && (
          <div className="absolute top-4 right-4 w-[300px] bg-[rgba(6,7,13,0.95)] border border-[rgba(255,255,255,0.1)] rounded-xl p-4 backdrop-blur-xl animate-fade-in">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-[8px] h-[8px] rounded-full flex-shrink-0"
                  style={{ background: SEVERITY_COLORS[selected.severity], boxShadow: `0 0 6px ${SEVERITY_COLORS[selected.severity]}` }} />
                <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">{selected.severity} · {selected.category}</span>
              </div>
              <button onClick={() => setSelected(null)} className="text-wp-text3 hover:text-wp-text text-[18px] leading-none -mt-1">×</button>
            </div>
            <div className="font-semibold text-[14px] text-wp-text leading-[1.4] mb-2">{selected.title}</div>
            {selected.locationName && (
              <div className="font-mono text-[11px] text-wp-text2 mb-3">📍 {selected.locationName}</div>
            )}
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[9px] text-wp-text3">RELIABILITY</span>
              <div className="flex-1 h-1 bg-wp-s3 rounded-full overflow-hidden">
                <div className="h-full bg-wp-green rounded-full"
                  style={{ width: `${(selected.reliabilityScore ?? 0) * 100}%` }} />
              </div>
              <span className="font-mono text-[10px] text-wp-green">
                {((selected.reliabilityScore ?? 0) * 100).toFixed(0)}%
              </span>
            </div>
            <button className="w-full py-2 rounded-lg bg-[rgba(245,166,35,0.1)] border border-[rgba(245,166,35,0.3)] text-wp-amber text-[12px] font-medium hover:bg-[rgba(245,166,35,0.2)] transition-all">
              View Full Signal →
            </button>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(6,7,13,0.7)]">
            <div className="font-mono text-[12px] text-wp-amber animate-pulse">Loading signals…</div>
          </div>
        )}
      </div>
    </div>
  )
}

// Demo data for when API is unavailable
const DEMO_SIGNALS: MapSignal[] = [
  { id:'1', title:'M5.8 Earthquake — Manila Bay', lat:14.59, lng:120.98, severity:'critical', category:'disaster',    locationName:'Manila, Philippines', countryCode:'PH', reliabilityScore:0.95, createdAt:'' },
  { id:'2', title:'EU AI Safety Directive',        lat:50.85, lng:4.35,  severity:'high',     category:'technology',  locationName:'Brussels, Belgium',    countryCode:'BE', reliabilityScore:0.92, createdAt:'' },
  { id:'3', title:'Arctic Ice Record Low',          lat:75.00, lng:0.00,  severity:'high',     category:'climate',     locationName:'Arctic Ocean',          countryCode:null, reliabilityScore:0.98, createdAt:'' },
  { id:'4', title:'South Korea Election',           lat:37.56, lng:126.97,severity:'medium',   category:'elections',   locationName:'Seoul, South Korea',   countryCode:'KR', reliabilityScore:0.99, createdAt:'' },
  { id:'5', title:'Sudan Ceasefire Talks',          lat:15.50, lng:32.56, severity:'high',     category:'conflict',    locationName:'Khartoum, Sudan',      countryCode:'SD', reliabilityScore:0.88, createdAt:'' },
  { id:'6', title:'WHO H5N9 Containment',           lat:21.02, lng:105.85,severity:'medium',   category:'health',      locationName:'Hanoi, Vietnam',       countryCode:'VN', reliabilityScore:0.97, createdAt:'' },
  { id:'7', title:'US Fed Minutes Release',         lat:38.90, lng:-77.03,severity:'medium',   category:'economy',     locationName:'Washington DC, USA',   countryCode:'US', reliabilityScore:0.99, createdAt:'' },
  { id:'8', title:'Gaza Humanitarian Update',       lat:31.50, lng:34.47, severity:'critical', category:'conflict',    locationName:'Gaza',                 countryCode:'PS', reliabilityScore:0.85, createdAt:'' },
  { id:'9', title:'Japan Seismic Monitoring',       lat:35.68, lng:139.65,severity:'low',      category:'disaster',    locationName:'Tokyo, Japan',         countryCode:'JP', reliabilityScore:0.99, createdAt:'' },
]
