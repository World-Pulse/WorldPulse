'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type Supercluster from 'supercluster'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/components/Toast'
import { ReliabilityDots } from '@/components/signals/ReliabilityDots'
import { FlagModal } from '@/components/signals/FlagModal'

import {
  timeAgo, getSourceUrl, getSourceDomain, reliabilityDots,
  parseWKBPoint, extractLatLng, prependSignal, MAX_SIGNALS,
} from '@/lib/map-utils'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? API_URL.replace(/^http/, 'ws')

// ── Types ─────────────────────────────────────────────────────────────────────

interface MapSignal {
  id: string
  title: string
  summary: string | null
  lat: number
  lng: number
  severity: string
  category: string
  status: string
  location_name: string | null
  country_code: string | null
  reliability_score: number
  created_at: string
  original_urls: string | string[] | null
  is_breaking?: boolean
  community_flag_count?: number
}

interface SignalProps {
  id: string
  title: string
  severity: string
  category: string
  status: string
  location_name: string | null
  country_code: string | null
  reliability_score: number
  created_at: string
  original_urls: string  // always JSON-stringified array
  color: string
}

type SCIndex = Supercluster<SignalProps>

// ── Constants ─────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#fbbf24',
  low:      '#8892a4',
  info:     '#5a6477',
}
const SEV_BG: Record<string, string> = {
  critical: 'rgba(255,59,92,0.15)',
  high:     'rgba(245,166,35,0.15)',
  medium:   'rgba(251,191,36,0.15)',
  low:      'rgba(136,146,164,0.15)',
  info:     'rgba(90,100,119,0.15)',
}
const CAT_ICON: Record<string, string> = {
  breaking: '🚨', conflict: '⚔️', geopolitics: '🌐', climate: '🌡️', health: '🏥',
  economy: '📈', technology: '💻', science: '🔬', elections: '🗳️', culture: '🎭',
  disaster: '🌊', security: '🔒', sports: '⚽', space: '🚀', other: '🌍',
}
const CATS   = ['all', 'conflict', 'climate', 'health', 'economy', 'science', 'disaster']
const SEVS   = ['all', 'critical', 'high', 'medium', 'low']
const TRANGE = [
  { v: '1h',  l: '1H',  hours: 1 },
  { v: '6h',  l: '6H',  hours: 6 },
  { v: '24h', l: '24H', hours: 24 },
  { v: '7d',  l: '7D',  hours: 168 },
  { v: 'all', l: 'ALL', hours: null },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function toFeatures(signals: MapSignal[]): Supercluster.PointFeature<SignalProps>[] {
  return signals
    .filter(s => s.lat != null && s.lng != null)
    .map(s => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [Number(s.lng), Number(s.lat)] },
      properties: {
        id:                s.id,
        title:             s.title,
        severity:          s.severity,
        category:          s.category,
        status:            s.status,
        location_name:     s.location_name,
        country_code:      s.country_code,
        reliability_score: s.reliability_score ?? 0,
        created_at:        s.created_at ?? '',
        original_urls:     JSON.stringify(Array.isArray(s.original_urls) ? s.original_urls : []),
        color:             SEV_COLOR[s.severity] ?? '#8892a4',
      },
    }))
}

// ── MapView (inner — uses useSearchParams) ────────────────────────────────────

function MapView() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const mapContainer = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef       = useRef<any>(null)
  const popupRef     = useRef<{ remove: () => void } | null>(null)
  const scRef        = useRef<SCIndex | null>(null)
  const signalsRef   = useRef<MapSignal[]>([])
  const animFrameRef = useRef<number | null>(null)

  // WS
  const wsRef              = useRef<WebSocket | null>(null)
  const wsReconnectRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsReconnectDelay   = useRef<number>(1000)
  const newSignalIdsRef    = useRef<Set<string>>(new Set())
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const [wsNewCount, setWsNewCount] = useState(0)

  // URL update debounce
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stable ref to router (router is stable in App Router, but capture for closure clarity)
  const routerRef   = useRef(router)

  // Initial map position from URL params — read once at mount
  const initPosRef = useRef({
    lat:  Number(searchParams.get('lat') ?? '20'),
    lng:  Number(searchParams.get('lng') ?? '10'),
    zoom: Number(searchParams.get('z')   ?? '2'),
  })

  const { toast } = useToast()

  const [signals,  setSignals]  = useState<MapSignal[]>([])
  const [selected,         setSelected]         = useState<MapSignal | null>(null)
  const [flagModalSignalId, setFlagModalSignalId] = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [category,    setCategory]    = useState(() => searchParams.get('cat') ?? 'all')
  const [severity,    setSeverity]    = useState('all')
  const [timeRange,   setTimeRange]   = useState(() => searchParams.get('tr')  ?? '24h')
  const [wsOnline,    setWsOnline]    = useState(false)
  const [heatmapMode, setHeatmapMode] = useState(() => searchParams.get('hm') === '1')
  const [heatmapItems, setHeatmapItems] = useState<Array<{ x: number; y: number; severity: string }>>([])
  const [visibleCount, setVisibleCount] = useState(0)

  // ── NASA GIBS satellite imagery state ──────────────────────────────────────
  const [satelliteMode, setSatelliteMode] = useState(false)
  const [gibsDate, setGibsDate] = useState(() => {
    // MODIS Terra imagery is typically 1 day delayed — default to yesterday
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  })

  // ── CelesTrak satellite tracking state ─────────────────────────────────────
  const [satTrackingMode,    setSatTrackingMode]    = useState(false)
  const [satTrackingLoading, setSatTrackingLoading] = useState(false)
  const [satCount,           setSatCount]           = useState(0)

  // ── Carrier Strike Group tracking state ────────────────────────────────────
  const [carrierMode,    setCarrierMode]    = useState(false)
  const [carrierLoading, setCarrierLoading] = useState(false)

  // ── Naval Intelligence layer state ──────────────────────────────────────────
  const [navalMode,    setNavalMode]    = useState(false)
  const [navalLoading, setNavalLoading] = useState(false)
  const [navalCount,   setNavalCount]   = useState(0)

  // ── Missile/Drone Threat layer state ────────────────────────────────────────
  const [threatMode,    setThreatMode]    = useState(false)
  const [threatLoading, setThreatLoading] = useState(false)
  const [threatCount,   setThreatCount]   = useState(0)

  // ── GPS/GNSS Jamming layer state ─────────────────────────────────────────────
  const [jammingMode,    setJammingMode]    = useState(false)
  const [jammingLoading, setJammingLoading] = useState(false)
  const [jammingCount,   setJammingCount]   = useState(0)

  // ── Country Risk Choropleth layer state ───────────────────────────────────────
  const [countryRiskMode,    setCountryRiskMode]    = useState(false)
  const [countryRiskLoading, setCountryRiskLoading] = useState(false)
  const [countryRiskCount,   setCountryRiskCount]   = useState(0)

  // ── Geographic Convergence Hotspots state ──────────────────────────────────
  interface Hotspot {
    centerLat:      number
    centerLng:      number
    signalCount:    number
    categoryCount:  number
    categories:     string[]
    maxSeverity:    string
    avgReliability: number
    latestSignalAt: string | null
    sampleTitles:   string[]
    sampleIds:      string[]
  }
  const [hotspots,     setHotspots]     = useState<Hotspot[]>([])
  const [hotspotsOpen, setHotspotsOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    async function fetchHotspots() {
      try {
        const res  = await fetch(`${API_URL}/api/v1/signals/map/hotspots?hours=24&min_categories=3&limit=10`)
        if (!res.ok) return
        const json = await res.json() as { success: boolean; data: { hotspots: Hotspot[] } }
        if (mounted && json.success) setHotspots(json.data.hotspots)
      } catch { /* silent — non-critical widget */ }
    }
    fetchHotspots()
    const id = setInterval(fetchHotspots, 5 * 60_000) // refresh every 5 min
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // ── Filter URL persistence refs ────────────────────────────────────────────

  const catRef = useRef(category)
  const sevRef = useRef(severity)
  const trRef  = useRef(timeRange)
  const hmRef  = useRef(heatmapMode)
  useEffect(() => { catRef.current = category  }, [category])
  useEffect(() => { sevRef.current = severity  }, [severity])
  useEffect(() => { trRef.current  = timeRange  }, [timeRange])
  useEffect(() => { hmRef.current  = heatmapMode }, [heatmapMode])

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchSignals = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      const trEntry = TRANGE.find(t => t.v === timeRange)
      const h = trEntry?.hours ?? 168   // 'all' → max window the API supports (7d)
      p.set('hours', String(h))
      if (category !== 'all') p.set('category', category)
      if (severity !== 'all') p.set('severity', severity)
      const res  = await fetch(`${API_URL}/api/v1/signals/map/points?${p}`)
      const data = await res.json() as { success: boolean; data: MapSignal[] }
      if (data.success && Array.isArray(data.data)) {
        signalsRef.current = data.data
        setSignals(data.data)
      }
    } catch (e) {
      console.error('[map] fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [category, severity, timeRange])

  useEffect(() => { fetchSignals() }, [fetchSignals])

  // ── 30-second auto-refresh ─────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => { fetchSignals() }, 30_000)
    return () => clearInterval(id)
  }, [fetchSignals])

  // ── Viewport cluster refresh ───────────────────────────────────────────────

  const refreshClusters = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    const sc  = scRef.current
    if (!map || !sc) return
    const src = map.getSource('signals')
    if (!src) return
    const b    = map.getBounds()
    const zoom = Math.max(0, Math.min(18, Math.floor(map.getZoom())))
    const clusters = sc.getClusters(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      zoom,
    )
    src.setData({ type: 'FeatureCollection', features: clusters })
  }, [])

  // ── New-signal highlight refresh ──────────────────────────────────────────

  const refreshHighlights = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    if (!map) return
    const src = map.getSource('highlights')
    if (!src) return
    const ids      = newSignalIdsRef.current
    const features = signalsRef.current
      .filter(s => ids.has(s.id) && s.lat != null && s.lng != null)
      .map(s => ({
        type:       'Feature' as const,
        geometry:   { type: 'Point' as const, coordinates: [Number(s.lng), Number(s.lat)] },
        properties: { id: s.id },
      }))
    src.setData({ type: 'FeatureCollection', features })
  }, [])

  // ── Heatmap + visible-signal-count refresh ─────────────────────────────────

  const refreshHeatmapAndCount = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    if (!map || !map.loaded()) return
    const b = map.getBounds()
    const w = b.getWest()
    const e = b.getEast()
    const s = b.getSouth()
    const n = b.getNorth()
    const visible = signalsRef.current.filter(sig =>
      sig.lat != null && sig.lng != null &&
      sig.lat >= s && sig.lat <= n &&
      sig.lng >= w && sig.lng <= e
    )
    setVisibleCount(visible.length)
    if (hmRef.current) {
      const items = visible.map(sig => {
        const pt = map.project([Number(sig.lng), Number(sig.lat)])
        return { x: Math.round(pt.x), y: Math.round(pt.y), severity: sig.severity }
      })
      setHeatmapItems(items)
    } else {
      setHeatmapItems([])
    }
  }, [])

  const refreshHeatmapAndCountRef = useRef(refreshHeatmapAndCount)
  useEffect(() => { refreshHeatmapAndCountRef.current = refreshHeatmapAndCount }, [refreshHeatmapAndCount])

  // Stable ref so WS closure always calls latest version
  const refreshHighlightsRef = useRef(refreshHighlights)
  useEffect(() => { refreshHighlightsRef.current = refreshHighlights }, [refreshHighlights])

  // ── Rebuild Supercluster when signals change ───────────────────────────────

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { default: SuperclusterLib } = await import('supercluster')
      if (cancelled) return
      const features = toFeatures(signals)
      const sc: SCIndex = new SuperclusterLib({ radius: 60, maxZoom: 18 })
      sc.load(features)
      scRef.current = sc
      refreshClusters()
    })()
    return () => { cancelled = true }
  }, [signals, refreshClusters])

  // Refresh heatmap / visible count whenever signals change
  useEffect(() => { refreshHeatmapAndCountRef.current() }, [signals])

  // Also re-compute pixel positions when heatmap is toggled on/off
  useEffect(() => { refreshHeatmapAndCountRef.current() }, [heatmapMode])

  // ── WebSocket ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let unmounted = false

    function connectWS() {
      const ws = new WebSocket(`${WS_URL}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        if (unmounted) { ws.close(); return }
        setWsOnline(true)
        wsReconnectDelay.current = 1000  // reset backoff on successful connect
        ws.send(JSON.stringify({ type: 'subscribe', payload: { channels: ['all'] } }))
      }

      ws.onmessage = (evt: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(evt.data) as { event?: string; data?: unknown }

          // ── Heartbeat: respond to server pings ────────────────────────────
          if (msg.event === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
            return
          }

          // ── New signal ────────────────────────────────────────────────────
          if (msg.event === 'signal.new') {
            const raw   = msg.data as Record<string, unknown>
            const point = extractLatLng(raw)
            if (!point) return

            const newSig: MapSignal = {
              id:                String(raw.id    ?? ''),
              title:             String(raw.title  ?? ''),
              summary:           typeof raw.summary           === 'string' ? raw.summary           : null,
              lat:               point.lat,
              lng:               point.lng,
              severity:          typeof raw.severity           === 'string' ? raw.severity           : 'info',
              category:          typeof raw.category           === 'string' ? raw.category           : 'other',
              status:            typeof raw.status             === 'string' ? raw.status             : 'pending',
              location_name:     typeof raw.location_name      === 'string' ? raw.location_name      : null,
              country_code:      typeof raw.country_code       === 'string' ? raw.country_code       : null,
              reliability_score: typeof raw.reliability_score  === 'number' ? raw.reliability_score  : 0,
              created_at:        typeof raw.created_at         === 'string' ? raw.created_at         : new Date().toISOString(),
              original_urls:     Array.isArray(raw.original_urls) ? (raw.original_urls as string[]) : null,
            }
            if (!newSig.id) return

            // Only add to map if it passes the active category/severity filters
            const activeCat = catRef.current
            const activeSev = sevRef.current
            if (activeCat !== 'all' && newSig.category !== activeCat) return
            if (activeSev !== 'all' && newSig.severity !== activeSev) return

            // Prepend; evict oldest if over cap
            signalsRef.current = prependSignal(signalsRef.current, newSig)
            setSignals([...signalsRef.current])
            setWsNewCount(n => n + 1)

            // Highlight for 3 s
            newSignalIdsRef.current.add(newSig.id)
            refreshHighlightsRef.current()
            const prev = highlightTimersRef.current.get(newSig.id)
            if (prev) clearTimeout(prev)
            highlightTimersRef.current.set(newSig.id, setTimeout(() => {
              newSignalIdsRef.current.delete(newSig.id)
              highlightTimersRef.current.delete(newSig.id)
              refreshHighlightsRef.current()
            }, 3000))

            // Toast for breaking/critical signals
            if (newSig.severity === 'critical' || newSig.is_breaking) {
              toast(newSig.title, 'error')
            }
            return
          }

          // ── Signal updated ────────────────────────────────────────────────
          if (msg.event === 'signal.updated') {
            const raw = msg.data as Record<string, unknown>
            const id  = String(raw.id ?? '')
            if (!id) return
            const idx = signalsRef.current.findIndex(s => s.id === id)
            if (idx === -1) return
            const existing = signalsRef.current[idx]
            const updated: MapSignal = {
              ...existing,
              title:             typeof raw.title             === 'string' ? raw.title             : existing.title,
              severity:          typeof raw.severity          === 'string' ? raw.severity          : existing.severity,
              status:            typeof raw.status            === 'string' ? raw.status            : existing.status,
              reliability_score: typeof raw.reliability_score === 'number' ? raw.reliability_score : existing.reliability_score,
              summary:           typeof raw.summary           === 'string' ? raw.summary           : existing.summary,
            }
            // Update lat/lng if the updated signal has a location
            const point = extractLatLng(raw)
            if (point) { updated.lat = point.lat; updated.lng = point.lng }

            signalsRef.current = [
              ...signalsRef.current.slice(0, idx),
              updated,
              ...signalsRef.current.slice(idx + 1),
            ]
            setSignals([...signalsRef.current])
            return
          }

        } catch { /* malformed message — ignore */ }
      }

      ws.onclose = () => {
        if (unmounted) return
        setWsOnline(false)
        // Exponential backoff: 1s → 2s → 4s → … → 30s max
        const delay = wsReconnectDelay.current
        wsReconnectDelay.current = Math.min(delay * 2, 30_000)
        wsReconnectRef.current = setTimeout(connectWS, delay)
      }

      ws.onerror = () => { ws.close() }
    }

    connectWS()

    return () => {
      unmounted = true
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null   // prevent auto-reconnect on intentional unmount
        wsRef.current.close()
      }
      for (const t of highlightTimersRef.current.values()) clearTimeout(t)
      highlightTimersRef.current.clear()
    }
  }, [toast]) // toast is stable; all filter state accessed via refs

  // ── Initialize MapLibre (once) ─────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainer.current || typeof window === 'undefined') return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null
    let ro: ResizeObserver | null = null

    ;(async () => {
      const [ml] = await Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl.css'),
      ])
      if (cancelled) return

      const { lat, lng, zoom } = initPosRef.current

      map = new ml.Map({
        container: mapContainer.current!,
        style: {
          version: 8,
          glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
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
        center: [lng, lat],
        zoom,
        minZoom: 1,
        maxZoom: 18,
        attributionControl: false,
      })

      mapRef.current = map

      ro = new ResizeObserver(() => { if (mapRef.current) mapRef.current.resize() })
      if (mapContainer.current) ro.observe(mapContainer.current)

      map.on('error', (e: unknown) => { console.error('[maplibre]', e) })

      map.on('load', () => {
        if (cancelled) return
        map.resize()

        // ── Sources ───────────────────────────────────────────

        map.addSource('signals', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        map.addSource('highlights', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        // ── Signal layers ─────────────────────────────────────

        map.addLayer({
          id: 'cluster-halo', type: 'circle', source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#f5a623',
            'circle-radius': ['step', ['get', 'point_count'], 32, 10, 40, 30, 48],
            'circle-opacity': 0.09,
            'circle-blur': 0.7,
          },
        })

        map.addLayer({
          id: 'clusters', type: 'circle', source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#f5a623', 10, '#ff5e3a', 30, '#ff3b5c'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 26, 30, 32],
            'circle-opacity': 0.95,
            'circle-stroke-color': 'rgba(255,255,255,0.2)',
            'circle-stroke-width': 1.5,
          },
        })

        map.addLayer({
          id: 'cluster-count', type: 'symbol', source: 'signals',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font':  ['Open Sans Bold'],
            'text-size':  12,
          },
          paint: { 'text-color': '#ffffff' },
        })

        map.addLayer({
          id: 'critical-pulse', type: 'circle', source: 'signals',
          filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'severity'], 'critical']],
          paint: { 'circle-color': '#ff3b5c', 'circle-radius': 16, 'circle-opacity': 0.2, 'circle-blur': 0.5 },
        })

        map.addLayer({
          id: 'signal-glow', type: 'circle', source: 'signals',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': 14,
            'circle-opacity': 0.12,
            'circle-blur': 1.2,
          },
        })

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

        // ── New-signal highlight ring (gold, animated, 3 s) ───

        map.addLayer({
          id: 'new-highlight', type: 'circle', source: 'highlights',
          paint: {
            'circle-color':         'rgba(0,0,0,0)',
            'circle-radius':        18,
            'circle-stroke-color':  '#f5d020',
            'circle-stroke-width':  2.5,
            'circle-stroke-opacity': 0.9,
          },
        })

        // ── Animation loop ────────────────────────────────────

        let pulseT = 0
        let hlT    = 0
        const animatePulse = () => {
          pulseT += 0.045
          hlT    += 0.07
          const r  = 14 + Math.sin(pulseT) * 7
          const o  = 0.12 + Math.sin(pulseT) * 0.1
          const hr = 16 + Math.sin(hlT) * 5
          const ho = 0.65 + Math.sin(hlT) * 0.3
          try {
            map.setPaintProperty('critical-pulse', 'circle-radius',          r)
            map.setPaintProperty('critical-pulse', 'circle-opacity',         o)
            map.setPaintProperty('new-highlight',  'circle-radius',          hr)
            map.setPaintProperty('new-highlight',  'circle-stroke-opacity',  ho)
          } catch { /* layer removed */ }
          animFrameRef.current = requestAnimationFrame(animatePulse)
        }
        animFrameRef.current = requestAnimationFrame(animatePulse)

        // ── Cursors ───────────────────────────────────────────

        const cursorOn  = () => { map.getCanvas().style.cursor = 'pointer' }
        const cursorOff = () => { map.getCanvas().style.cursor = '' }
        map.on('mouseenter', 'signal-points', cursorOn)
        map.on('mouseleave', 'signal-points', cursorOff)
        map.on('mouseenter', 'clusters',      cursorOn)
        map.on('mouseleave', 'clusters',      cursorOff)

        // ── Cluster click: zoom in or show list popup ──────────
        //
        // If the expansion zoom is reachable (> current zoom), fly there.
        // If the map is already at or past the expansion zoom the signals share
        // the same coordinates and can never be separated by zooming — in that
        // case show a compact list popup instead (spiderfy-lite).

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', 'clusters', (e: any) => {
          const feat = e.features?.[0]
          if (!feat) return
          const sc = scRef.current
          if (!sc) return

          const clusterId    = feat.properties.cluster_id as number
          const coords       = feat.geometry.coordinates as [number, number]
          const expansionZ   = sc.getClusterExpansionZoom(clusterId)
          const currentZ     = map.getZoom()

          // If we can meaningfully zoom in — do it
          if (expansionZ > currentZ + 0.5) {
            map.flyTo({ center: coords, zoom: expansionZ, duration: 600 })
            return
          }

          // Already at max useful zoom — signals are co-located.
          // Show a popup listing all signals in this cluster.
          const leaves = sc.getLeaves(clusterId, 20)
          if (leaves.length === 0) return

          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }

          const listItems = leaves.map((leaf: any) => {
            const p = leaf.properties as SignalProps
            const color = SEV_COLOR[p.severity] ?? '#8892a4'
            return `<a href="/?signal=${p.id}" style="display:block;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.07);text-decoration:none;color:#e2e6f0;font:13px/1.4 system-ui" title="${p.title}">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;flex-shrink:0"></span>
              <span style="font-size:12px">${p.title.length > 70 ? p.title.slice(0, 70) + '…' : p.title}</span>
            </a>`
          }).join('')

          const extra = (feat.properties.point_count as number) > leaves.length
            ? `<div style="font:11px monospace;color:#5a6477;padding-top:6px">+ ${(feat.properties.point_count as number) - leaves.length} more signals</div>`
            : ''

          popupRef.current = new ml.Popup({
            closeButton: true,
            closeOnClick: false,
            offset: 14,
            className: 'wp-map-popup',
            maxWidth: '280px',
          })
            .setLngLat(coords)
            .setHTML(`
              <div style="font:700 11px/1 monospace;color:#8892a4;letter-spacing:1.5px;margin-bottom:8px">
                ${feat.properties.point_count} SIGNALS · ${(leaves[0]?.properties as SignalProps)?.location_name ?? 'Same location'}
              </div>
              <div style="max-height:220px;overflow-y:auto">${listItems}${extra}</div>
            `)
            .addTo(map)
        })

        // ── Signal click: popup + side panel ──────────────────

        let pinClicked = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', 'signal-points', (e: any) => {
          pinClicked = true
          const feat = e.features?.[0]
          const p = feat?.properties as SignalProps | undefined
          if (!p || !feat) return

          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }

          const srcUrl   = getSourceUrl(p.original_urls)
          const srcLabel = srcUrl ? getSourceDomain(srcUrl) : (p.location_name ?? null)
          const score    = Number(p.reliability_score) || 0
          const dots     = reliabilityDots(score)
          const color    = SEV_COLOR[p.severity] ?? '#8892a4'
          const coords   = feat.geometry.coordinates as [number, number]

          popupRef.current = new ml.Popup({
            closeButton: true,
            closeOnClick: false,
            offset: 14,
            className: 'wp-map-popup',
          })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:220px;margin-bottom:6px">${p.title}</div>
              <div style="font:600 12px/1 monospace;color:${color};letter-spacing:1.5px;margin-bottom:6px" title="${Math.round(score * 100)}% reliability">${dots}</div>
              ${srcLabel ? `<div style="font:11px monospace;color:#8892a4;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">via ${srcLabel}</div>` : ''}
              <div style="font:11px monospace;color:#5a6477;margin-bottom:8px">${timeAgo(p.created_at)}</div>
              <a href="/?signal=${p.id}" style="display:inline-flex;align-items:center;gap:5px;font:600 11px/1 system-ui;color:${color};text-decoration:none;border:1px solid ${color}44;border-radius:6px;padding:4px 9px;transition:opacity .15s">
                View Full Signal <span style="font-size:10px">→</span>
              </a>
            `)
            .addTo(map)

          const sig = signalsRef.current.find(s => s.id === p.id) ?? null
          setSelected(sig)
          map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 5), speed: 1.2, duration: 700 })
        })

        // ── Background click: deselect ────────────────────────

        map.on('click', () => {
          if (pinClicked) { pinClicked = false; return }
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          setSelected(null)
        })

        // ── Viewport change: re-cluster + persist URL ─────────

        const onViewChange = () => {
          refreshClusters()
          refreshHeatmapAndCountRef.current()
          if (urlTimerRef.current) clearTimeout(urlTimerRef.current)
          urlTimerRef.current = setTimeout(() => {
            const c   = map.getCenter()
            const z   = map.getZoom()
            const cat = catRef.current
            const tr  = trRef.current
            const hm  = hmRef.current
            let url = `?z=${z.toFixed(2)}&lat=${c.lat.toFixed(4)}&lng=${c.lng.toFixed(4)}`
            if (cat !== 'all') url += `&cat=${cat}`
            if (tr  !== '24h') url += `&tr=${tr}`
            if (hm)            url += `&hm=1`
            routerRef.current.replace(url, { scroll: false })
          }, 500)
        }

        map.on('moveend', onViewChange)
        map.on('zoomend', onViewChange)

        // Seed from already-fetched signals (if any)
        refreshClusters()
        refreshHighlights()
      })
    })()

    return () => {
      cancelled = true
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
      if (urlTimerRef.current)  { clearTimeout(urlTimerRef.current);           urlTimerRef.current  = null }
      if (ro) ro.disconnect()
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
      if (mapRef.current)   { mapRef.current.remove();   mapRef.current   = null }
    }
  // refreshClusters and refreshHighlights are stable useCallbacks with [] deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshClusters, refreshHighlights])

  // ── NASA GIBS satellite imagery layer ─────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const GIBS_SOURCE = 'nasa-gibs'
    const GIBS_LAYER  = 'nasa-satellite'

    const applyLayer = () => {
      try {
        if (satelliteMode) {
          // Add source if not present
          if (!map.getSource(GIBS_SOURCE)) {
            map.addSource(GIBS_SOURCE, {
              type:        'raster',
              tiles:       [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${gibsDate}/GoogleMapsCompatible/{z}/{y}/{x}.jpg`],
              tileSize:    256,
              maxzoom:     9,
              attribution: 'Imagery courtesy <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a> / MODIS Terra',
            })
          }
          // Add layer above basemap, below signal pins
          if (!map.getLayer(GIBS_LAYER)) {
            // Insert before the first signals layer (cluster-halo) so signals stay on top
            const beforeLayer = map.getLayer('cluster-halo') ? 'cluster-halo' : undefined
            map.addLayer({
              id:     GIBS_LAYER,
              type:   'raster',
              source: GIBS_SOURCE,
              paint:  { 'raster-opacity': 0.72 },
            }, beforeLayer)
          }
        } else {
          if (map.getLayer(GIBS_LAYER))  map.removeLayer(GIBS_LAYER)
          if (map.getSource(GIBS_SOURCE)) map.removeSource(GIBS_SOURCE)
        }
      } catch (e) {
        console.warn('[map] GIBS layer error:', e)
      }
    }

    // Apply immediately if map is loaded, otherwise wait for the load event
    if (map.loaded()) {
      applyLayer()
    } else {
      map.once('load', applyLayer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satelliteMode, gibsDate])

  // ── CelesTrak satellite tracking layer ─────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const CT_SOURCE = 'celestrak-sats'
    const CT_LAYER  = 'celestrak-sat-points'

    const removeLayer = () => {
      try {
        if (map.getLayer(CT_LAYER))  map.removeLayer(CT_LAYER)
        if (map.getSource(CT_SOURCE)) map.removeSource(CT_SOURCE)
      } catch { /* ignore */ }
    }

    const applyLayer = async () => {
      if (!satTrackingMode) {
        removeLayer()
        return
      }

      setSatTrackingLoading(true)
      try {
        // CelesTrak GP JSON — TLE-less orbital elements for all active objects
        const res  = await fetch('https://celestrak.org/GP.php?GROUP=active&FORMAT=json')
        const data = await res.json() as Array<{
          SATNAME:          string
          NORAD_CAT_ID:     number
          OBJECT_TYPE:      string
          INCLINATION:      number
          RA_OF_ASC_NODE:   number
          ECCENTRICITY:     number
          MEAN_ANOMALY:     number
          MEAN_MOTION:      number
        }>

        if (!Array.isArray(data) || data.length === 0) return

        // Limit to first 200 client-side to keep rendering snappy
        const subset = data.slice(0, 200)
        setSatCount(subset.length)

        // Approximate position: map INCLINATION → latitude range, RA_OF_ASC_NODE → longitude
        // MEAN_ANOMALY moves the satellite along its orbit — use it to offset longitude
        const features = subset.map(sat => {
          // Approximate sub-satellite longitude from RAAN + mean anomaly offset
          const lng = ((sat.RA_OF_ASC_NODE + sat.MEAN_ANOMALY) % 360 + 360) % 360
          const lngNorm = lng > 180 ? lng - 360 : lng
          // Latitude oscillates between ±inclination; use mean anomaly as phase
          const incRad = (sat.INCLINATION * Math.PI) / 180
          const maRad  = (sat.MEAN_ANOMALY * Math.PI) / 180
          const lat    = Math.sin(maRad) * sat.INCLINATION
          const clampedLat = Math.max(-85, Math.min(85, lat))

          // Color by object type
          const typeColor =
            sat.OBJECT_TYPE === 'PAYLOAD'      ? '#3b82f6' :   // blue
            sat.OBJECT_TYPE === 'ROCKET BODY'  ? '#6b7280' :   // gray
            sat.OBJECT_TYPE === 'DEBRIS'       ? '#ef4444' :   // red
                                                 '#f3f4f6'     // white / unknown

          return {
            type:       'Feature' as const,
            geometry:   { type: 'Point' as const, coordinates: [lngNorm, clampedLat] },
            properties: {
              name:  sat.SATNAME,
              id:    sat.NORAD_CAT_ID,
              type:  sat.OBJECT_TYPE,
              color: typeColor,
            },
          }
        })

        if (!map.getSource(CT_SOURCE)) {
          map.addSource(CT_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(CT_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        if (!map.getLayer(CT_LAYER)) {
          map.addLayer({
            id:     CT_LAYER,
            type:   'circle',
            source: CT_SOURCE,
            paint:  {
              'circle-color':   ['get', 'color'],
              'circle-radius':  3,
              'circle-opacity': 0.7,
              'circle-stroke-color':  'rgba(255,255,255,0.15)',
              'circle-stroke-width':  0.5,
            },
          })
        }
      } catch (e) {
        console.warn('[map] CelesTrak layer error:', e)
      } finally {
        setSatTrackingLoading(false)
      }
    }

    if (map.loaded()) {
      void applyLayer()
    } else {
      map.once('load', () => { void applyLayer() })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satTrackingMode])

  // ── Carrier Strike Group layer ─────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const CSG_SOURCE = 'csg-carriers'
    const CSG_LAYER  = 'csg-carrier-points'
    const CSG_POPUP  = 'csg-carrier-cursor'

    const removeLayer = () => {
      try {
        // Remove event listeners added for this layer
        map.off('click',      CSG_LAYER)
        map.off('mouseenter', CSG_LAYER)
        map.off('mouseleave', CSG_LAYER)
        if (map.getLayer(CSG_LAYER))  map.removeLayer(CSG_LAYER)
        if (map.getSource(CSG_SOURCE)) map.removeSource(CSG_SOURCE)
      } catch { /* ignore */ }
    }

    const applyLayer = async () => {
      if (!carrierMode) {
        removeLayer()
        return
      }

      setCarrierLoading(true)
      try {
        // Fetch recent military medium/high signals and filter for carrier content
        const res  = await fetch(
          `${API_URL}/api/v1/signals?category=military&severity=medium&limit=50`,
        )
        const json = await res.json() as { success: boolean; data: Array<{
          id:            string
          title:         string
          summary:       string | null
          location:      string | null
          location_name: string | null
          severity:      string
          reliability_score: number
          created_at:    string
        }> }

        // Filter for carrier-related signals and those with positions
        const CARRIER_KEYWORDS = [
          'cvn-', 'carrier strike', 'uss gerald', 'uss george washington',
          'uss harry', 'uss theodore', 'uss abraham', 'uss carl vinson',
          'uss eisenhower', 'uss nimitz', 'uss stennis', 'uss ronald reagan',
          'uss george h', 'carrier group', 'strike group',
        ]

        const carrierSignals = (json.data ?? []).filter(s => {
          const text = `${s.title} ${s.summary ?? ''}`.toLowerCase()
          return CARRIER_KEYWORDS.some(kw => text.includes(kw))
        })

        // Parse WKB/WKT locations — signals store location as WKB hex or object
        const features = carrierSignals
          .filter(s => s.location != null)
          .map(s => {
            // Attempt to parse PostGIS WKB point (little-endian, SRID-aware)
            // Byte layout: [byteOrder:1][wkbType:4][lng:8][lat:8] or with SRID [byteOrder:1][wkbType:4][SRID:4][lng:8][lat:8]
            let lat = 0
            let lng = 0
            try {
              if (typeof s.location === 'string' && s.location.length >= 42) {
                const hex = s.location
                // Convert hex string → Uint8Array via DataView (browser-safe, no Node Buffer)
                const bytes = new Uint8Array(hex.length / 2)
                for (let i = 0; i < bytes.length; i++) {
                  bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
                }
                const view = new DataView(bytes.buffer)
                const littleEndian = view.getUint8(0) === 1
                const wkbType = view.getUint32(1, littleEndian)
                // wkbType 0x20000001 = POINT with SRID (EWKB), 0x00000001 = plain POINT
                const hasSrid = (wkbType & 0x20000000) !== 0
                const offset  = hasSrid ? 9 : 5   // skip byteOrder(1)+type(4) + optional SRID(4)
                lng = view.getFloat64(offset,     littleEndian)
                lat = view.getFloat64(offset + 8, littleEndian)
              }
            } catch { /* skip bad location */ }
            if (lat === 0 && lng === 0) return null

            return {
              type:       'Feature' as const,
              geometry:   { type: 'Point' as const, coordinates: [lng, lat] },
              properties: {
                id:           s.id,
                title:        s.title,
                locationName: s.location_name ?? 'Unknown position',
                reliability:  s.reliability_score,
                createdAt:    s.created_at,
              },
            }
          })
          .filter((f): f is NonNullable<typeof f> => f !== null)

        if (!map.getSource(CSG_SOURCE)) {
          map.addSource(CSG_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(CSG_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        if (!map.getLayer(CSG_LAYER)) {
          map.addLayer({
            id:     CSG_LAYER,
            type:   'circle',
            source: CSG_SOURCE,
            paint:  {
              'circle-color':         '#1e3a5f',
              'circle-radius':        8,
              'circle-opacity':       0.9,
              'circle-stroke-color':  '#4a90d9',
              'circle-stroke-width':  2,
              'circle-stroke-opacity': 0.8,
            },
          })

          // Cursor
          map.on('mouseenter', CSG_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', CSG_LAYER, () => { map.getCanvas().style.cursor = '' })

          // Popup on click
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map.on('click', CSG_LAYER, async (e: any) => {
            const feat = e.features?.[0]
            if (!feat) return
            const p = feat.properties as {
              title: string; locationName: string; reliability: number; createdAt: string
            }
            const { default: ml } = await import('maplibre-gl')
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
            popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font:600 12px/1.4 system-ui;color:#93c5fd;margin-bottom:4px">⚓ CARRIER STRIKE GROUP</div>
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:220px;margin-bottom:6px">${p.title}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:4px">📍 ${p.locationName}</div>
                <div style="font:10px monospace;color:#5a6477">OSINT-estimated · ${Math.round(p.reliability * 100)}% confidence</div>
              `)
              .addTo(map)
          })
        }
      } catch (e) {
        console.warn('[map] CSG layer error:', e)
      } finally {
        setCarrierLoading(false)
      }
    }

    if (map.loaded()) {
      void applyLayer()
    } else {
      map.once('load', () => { void applyLayer() })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrierMode])

  // ── Naval Intelligence layer (carriers + AIS distress + dark ships) ────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const NAVAL_SOURCE         = 'naval-vessels'
    const NAVAL_CARRIER_LAYER  = 'naval-carriers'
    const NAVAL_DISTRESS_LAYER = 'naval-distress'
    const NAVAL_DARK_LAYER     = 'naval-dark-ships'

    const removeLayer = () => {
      try {
        map.off('click',      NAVAL_CARRIER_LAYER)
        map.off('mouseenter', NAVAL_CARRIER_LAYER)
        map.off('mouseleave', NAVAL_CARRIER_LAYER)
        map.off('click',      NAVAL_DISTRESS_LAYER)
        map.off('mouseenter', NAVAL_DISTRESS_LAYER)
        map.off('mouseleave', NAVAL_DISTRESS_LAYER)
        map.off('click',      NAVAL_DARK_LAYER)
        map.off('mouseenter', NAVAL_DARK_LAYER)
        map.off('mouseleave', NAVAL_DARK_LAYER)
        if (map.getLayer(NAVAL_CARRIER_LAYER))  map.removeLayer(NAVAL_CARRIER_LAYER)
        if (map.getLayer(NAVAL_DISTRESS_LAYER)) map.removeLayer(NAVAL_DISTRESS_LAYER)
        if (map.getLayer(NAVAL_DARK_LAYER))     map.removeLayer(NAVAL_DARK_LAYER)
        if (map.getSource(NAVAL_SOURCE))        map.removeSource(NAVAL_SOURCE)
      } catch { /* ignore */ }
    }

    let refreshTimer: ReturnType<typeof setInterval> | null = null

    const applyLayer = async () => {
      if (!navalMode) {
        removeLayer()
        setNavalCount(0)
        return
      }

      setNavalLoading(true)
      try {
        const res  = await fetch(`${API_URL}/api/v1/maritime/vessels`)
        const json = await res.json() as {
          success: boolean
          data: Array<{
            id:          string
            title:       string
            lat:         number
            lng:         number
            type:        'carrier' | 'vessel' | 'dark_ship'
            fleet:       string | null
            status_text: string
            severity:    string
            created_at:  string
          }>
        }

        if (!json.success || !Array.isArray(json.data)) return

        setNavalCount(json.data.length)

        const features = json.data.map(v => ({
          type:     'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
          properties: {
            id:         v.id,
            title:      v.title,
            vesselType: v.type,
            fleet:      v.fleet ?? 'Unknown',
            statusText: v.status_text,
            severity:   v.severity,
            createdAt:  v.created_at,
          },
        }))

        if (!map.getSource(NAVAL_SOURCE)) {
          map.addSource(NAVAL_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(NAVAL_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        // Carrier layer — blue symbol circles
        if (!map.getLayer(NAVAL_CARRIER_LAYER)) {
          map.addLayer({
            id:     NAVAL_CARRIER_LAYER,
            type:   'circle',
            source: NAVAL_SOURCE,
            filter: ['==', ['get', 'vesselType'], 'carrier'],
            paint:  {
              'circle-color':         '#1e90ff',
              'circle-radius':        8,
              'circle-opacity':       0.9,
              'circle-stroke-color':  'rgba(30,144,255,0.5)',
              'circle-stroke-width':  3,
            },
          })

          map.on('mouseenter', NAVAL_CARRIER_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', NAVAL_CARRIER_LAYER, () => { map.getCanvas().style.cursor = '' })

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map.on('click', NAVAL_CARRIER_LAYER, async (e: any) => {
            const feat = e.features?.[0]
            if (!feat) return
            const p = feat.properties as {
              title: string; fleet: string; statusText: string; createdAt: string
            }
            const { default: ml } = await import('maplibre-gl')
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
            popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font:600 12px/1.4 system-ui;color:#60a5fa;margin-bottom:4px">⚓ CARRIER STRIKE GROUP</div>
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${p.title}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">🚢 Fleet: ${p.fleet}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">📍 ${p.statusText}</div>
                <div style="font:10px monospace;color:#5a6477">${new Date(p.createdAt).toLocaleString()}</div>
              `)
              .addTo(map)
          })
        }

        // Distress vessel layer — orange circles
        if (!map.getLayer(NAVAL_DISTRESS_LAYER)) {
          map.addLayer({
            id:     NAVAL_DISTRESS_LAYER,
            type:   'circle',
            source: NAVAL_SOURCE,
            filter: ['==', ['get', 'vesselType'], 'vessel'],
            paint:  {
              'circle-color':         '#ff6600',
              'circle-radius':        6,
              'circle-opacity':       0.85,
              'circle-stroke-color':  'rgba(255,102,0,0.4)',
              'circle-stroke-width':  2,
            },
          })

          map.on('mouseenter', NAVAL_DISTRESS_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', NAVAL_DISTRESS_LAYER, () => { map.getCanvas().style.cursor = '' })

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map.on('click', NAVAL_DISTRESS_LAYER, async (e: any) => {
            const feat = e.features?.[0]
            if (!feat) return
            const p = feat.properties as {
              title: string; statusText: string; severity: string; createdAt: string
            }
            const { default: ml } = await import('maplibre-gl')
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
            popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font:600 12px/1.4 system-ui;color:#fb923c;margin-bottom:4px">🆘 AIS DISTRESS SIGNAL</div>
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${p.title}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">📍 ${p.statusText}</div>
                <div style="font:11px monospace;color:#f87171;margin-bottom:3px">Severity: ${p.severity}</div>
                <div style="font:10px monospace;color:#5a6477">${new Date(p.createdAt).toLocaleString()}</div>
              `)
              .addTo(map)
          })
        }

        // Dark ship layer — red/grey circles
        if (!map.getLayer(NAVAL_DARK_LAYER)) {
          map.addLayer({
            id:     NAVAL_DARK_LAYER,
            type:   'circle',
            source: NAVAL_SOURCE,
            filter: ['==', ['get', 'vesselType'], 'dark_ship'],
            paint:  {
              'circle-color':         '#6b21a8',
              'circle-radius':        6,
              'circle-opacity':       0.85,
              'circle-stroke-color':  'rgba(107,33,168,0.5)',
              'circle-stroke-width':  2,
            },
          })

          map.on('mouseenter', NAVAL_DARK_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', NAVAL_DARK_LAYER, () => { map.getCanvas().style.cursor = '' })

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map.on('click', NAVAL_DARK_LAYER, async (e: any) => {
            const feat = e.features?.[0]
            if (!feat) return
            const p = feat.properties as {
              title: string; statusText: string; createdAt: string
            }
            const { default: ml } = await import('maplibre-gl')
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
            popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font:600 12px/1.4 system-ui;color:#c084fc;margin-bottom:4px">⚠️ DARK SHIP DETECTED</div>
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${p.title}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">📍 ${p.statusText}</div>
                <div style="font:10px monospace;color:#5a6477">${new Date(p.createdAt).toLocaleString()}</div>
              `)
              .addTo(map)
          })
        }
      } catch (e) {
        console.warn('[map] Naval Intel layer error:', e)
      } finally {
        setNavalLoading(false)
      }
    }

    if (map.loaded()) {
      void applyLayer()
    } else {
      map.once('load', () => { void applyLayer() })
    }

    // Auto-refresh every 10 minutes when navalMode is active
    if (navalMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 10 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navalMode])

  // ── Missile/Drone Threat Intelligence layer ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const THREAT_SOURCE    = 'threat-signals'
    const THREAT_BALLISTIC = 'threats-ballistic'
    const THREAT_DRONE_L   = 'threats-drone'
    const THREAT_OTHER     = 'threats-other'

    let refreshTimer: ReturnType<typeof setInterval> | null = null

    const removeThreatLayers = () => {
      try {
        for (const layer of [THREAT_BALLISTIC, THREAT_DRONE_L, THREAT_OTHER]) {
          map.off('click',      layer)
          map.off('mouseenter', layer)
          map.off('mouseleave', layer)
          if (map.getLayer(layer)) map.removeLayer(layer)
        }
        if (map.getSource(THREAT_SOURCE)) map.removeSource(THREAT_SOURCE)
      } catch { /* ignore */ }
    }

    async function applyLayer() {
      if (!threatMode) {
        removeThreatLayers()
        setThreatCount(0)
        return
      }

      setThreatLoading(true)
      try {
        const res  = await fetch(`${API_URL}/api/v1/threats/missiles`)
        const json = await res.json() as {
          success: boolean
          data: Array<{
            id:                string
            title:             string
            lat:               number
            lng:               number
            threat_type:       'ballistic' | 'cruise' | 'drone' | 'hypersonic' | 'rocket' | 'unknown'
            origin_country:    string | null
            target_region:     string | null
            severity:          string
            reliability_score: number
            created_at:        string
          }>
        }

        if (!json.success) return

        const features = json.data.map(t => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [t.lng, t.lat] },
          properties: { ...t },
        }))

        setThreatCount(features.length)

        if (!map!.getSource(THREAT_SOURCE)) {
          map!.addSource(THREAT_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          ;(map!.getSource(THREAT_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        // ── Build popup HTML for a threat signal ───────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeThreatPopup = async (e: any) => {
          const feat = e.features?.[0]
          if (!feat) return
          const props  = feat.properties as Record<string, unknown>
          const tt     = String(props.threat_type ?? 'unknown')
          const typeLabel: Record<string, string> = {
            ballistic:  '🚀 BALLISTIC', cruise: '✈️ CRUISE', hypersonic: '⚡ HYPERSONIC',
            rocket: '💥 ROCKET', drone: '🛸 DRONE/UAV', unknown: '⚠️ THREAT',
          }
          const typeColor: Record<string, string> = {
            ballistic: '#dc2626', cruise: '#dc2626', hypersonic: '#dc2626',
            drone: '#f97316', rocket: '#a855f7', unknown: '#a855f7',
          }
          const label  = typeLabel[tt] ?? '⚠️ THREAT'
          const color  = typeColor[tt] ?? '#a855f7'
          const ts     = new Date(String(props.created_at ?? '')).toLocaleString()
          const origin = props.origin_country
            ? `<div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Origin: ${String(props.origin_country)}</div>`
            : ''
          const { default: ml } = await import('maplibre-gl')
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font:600 12px/1.4 system-ui;color:${color};margin-bottom:4px">${label}</div>
              <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${String(props.title ?? '')}</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Severity: ${String(props.severity ?? '')}</div>
              ${origin}
              <div style="font:10px monospace;color:#5a6477">${ts}</div>
            `)
            .addTo(map)
        }

        const hookLayer = (layerId: string) => {
          map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
          map.on('click', layerId, makeThreatPopup)
        }

        // ── threats-ballistic: red-600 #dc2626, radius 8, pulse via stroke ─────
        if (!map.getLayer(THREAT_BALLISTIC)) {
          map.addLayer({
            id:     THREAT_BALLISTIC,
            type:   'circle',
            source: THREAT_SOURCE,
            filter: ['in', ['get', 'threat_type'], ['literal', ['ballistic', 'cruise', 'hypersonic']]],
            paint:  {
              'circle-color':        '#dc2626',
              'circle-radius':       8,
              'circle-opacity':      0.9,
              'circle-stroke-color': 'rgba(220,38,38,0.35)',
              'circle-stroke-width': 5,
            },
          })
          hookLayer(THREAT_BALLISTIC)
        }

        // ── threats-drone: orange-500 #f97316, radius 6 ────────────────────────
        if (!map.getLayer(THREAT_DRONE_L)) {
          map.addLayer({
            id:     THREAT_DRONE_L,
            type:   'circle',
            source: THREAT_SOURCE,
            filter: ['==', ['get', 'threat_type'], 'drone'],
            paint:  {
              'circle-color':        '#f97316',
              'circle-radius':       6,
              'circle-opacity':      0.9,
              'circle-stroke-color': 'rgba(249,115,22,0.4)',
              'circle-stroke-width': 2,
            },
          })
          hookLayer(THREAT_DRONE_L)
        }

        // ── threats-other: purple-500 #a855f7, radius 5 ────────────────────────
        if (!map.getLayer(THREAT_OTHER)) {
          map.addLayer({
            id:     THREAT_OTHER,
            type:   'circle',
            source: THREAT_SOURCE,
            filter: ['in', ['get', 'threat_type'], ['literal', ['rocket', 'unknown']]],
            paint:  {
              'circle-color':        '#a855f7',
              'circle-radius':       5,
              'circle-opacity':      0.85,
              'circle-stroke-color': 'rgba(168,85,247,0.4)',
              'circle-stroke-width': 2,
            },
          })
          hookLayer(THREAT_OTHER)
        }

      } catch (err) {
        console.error('[ThreatLayer] fetch error:', err)
      } finally {
        setThreatLoading(false)
      }
    }

    if (map.loaded()) {
      void applyLayer()
    } else {
      map.once('load', () => { void applyLayer() })
    }

    // Auto-refresh every 5 minutes when threatMode is active (more volatile than naval)
    if (threatMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 5 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threatMode])

  // ── GPS/GNSS Jamming Intelligence layer ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const JAMMING_SOURCE    = 'jamming-zones'
    const JAMMING_MIL_LAYER = 'jamming-military'
    const JAMMING_SPF_LAYER = 'jamming-spoofing'
    const JAMMING_CIV_LAYER = 'jamming-civilian'

    let refreshTimer: ReturnType<typeof setInterval> | null = null

    const removeJammingLayers = () => {
      try {
        for (const layer of [JAMMING_MIL_LAYER, JAMMING_SPF_LAYER, JAMMING_CIV_LAYER]) {
          map.off('click',      layer)
          map.off('mouseenter', layer)
          map.off('mouseleave', layer)
          if (map.getLayer(layer)) map.removeLayer(layer)
        }
        if (map.getSource(JAMMING_SOURCE)) map.removeSource(JAMMING_SOURCE)
      } catch { /* ignore */ }
    }

    async function applyLayer() {
      if (!jammingMode) {
        removeJammingLayers()
        setJammingCount(0)
        return
      }

      setJammingLoading(true)
      try {
        const res  = await fetch(`${API_URL}/api/v1/jamming/zones`)
        const json = await res.json() as {
          success: boolean
          data: Array<{
            id:               string
            title:            string
            lat:              number
            lng:              number
            radius_km:        number
            jamming_type:     'military' | 'spoofing' | 'civilian' | 'unknown'
            severity:         string
            confidence:       number
            affected_systems: string[]
            first_detected:   string
            last_confirmed:   string
            source:           string
          }>
        }

        if (!json.success || !Array.isArray(json.data)) return

        setJammingCount(json.data.length)

        const features = json.data.map(z => ({
          type:     'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [z.lng, z.lat] },
          properties: {
            id:               z.id,
            title:            z.title,
            jammingType:      z.jamming_type,
            severity:         z.severity,
            confidence:       z.confidence,
            radiusKm:         z.radius_km,
            affectedSystems:  z.affected_systems.join(', '),
            firstDetected:    z.first_detected,
            lastConfirmed:    z.last_confirmed,
            source:           z.source,
          },
        }))

        if (!map.getSource(JAMMING_SOURCE)) {
          map.addSource(JAMMING_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(JAMMING_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        // ── Popup builder ─────────────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeJammingPopup = async (e: any) => {
          const feat = e.features?.[0]
          if (!feat) return
          const p = feat.properties as {
            title: string; jammingType: string; severity: string
            confidence: number; radiusKm: number
            affectedSystems: string; firstDetected: string; source: string
          }
          const typeLabels: Record<string, string> = {
            military: '⚔️ MILITARY EW (GPS JAMMING)',
            spoofing: '🎭 GPS SPOOFING',
            civilian: '📡 CIVILIAN INTERFERENCE',
            unknown:  '📡 GNSS ANOMALY',
          }
          const typeColors: Record<string, string> = {
            military: '#ef4444',
            spoofing: '#a855f7',
            civilian: '#f59e0b',
            unknown:  '#8892a4',
          }
          const label = typeLabels[p.jammingType] ?? '📡 GNSS ANOMALY'
          const color = typeColors[p.jammingType] ?? '#8892a4'
          const ts    = new Date(p.firstDetected).toLocaleString()
          const { default: ml } = await import('maplibre-gl')
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font:600 12px/1.4 system-ui;color:${color};margin-bottom:4px">${label}</div>
              <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:260px;margin-bottom:6px">${p.title}</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Severity: ${p.severity} — Confidence: ${p.confidence}%</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Affected radius: ~${p.radiusKm} km</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:4px;max-width:260px">Systems: ${p.affectedSystems}</div>
              <div style="font:10px monospace;color:#5a6477;margin-bottom:2px">Detected: ${ts}</div>
              <div style="font:10px monospace;color:#5a6477">${p.source}</div>
            `)
            .addTo(map)
        }

        const hookJammingLayer = (layerId: string) => {
          map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
          map.on('click', layerId, makeJammingPopup)
        }

        // ── Military jamming layer — red circles with heat-zone glow ──────────
        if (!map.getLayer(JAMMING_MIL_LAYER)) {
          map.addLayer({
            id:     JAMMING_MIL_LAYER,
            type:   'circle',
            source: JAMMING_SOURCE,
            filter: ['==', ['get', 'jammingType'], 'military'],
            paint:  {
              'circle-color':        '#ef4444',
              'circle-radius':       ['interpolate', ['linear'], ['zoom'], 2, 8, 8, 20],
              'circle-opacity':      0.85,
              'circle-stroke-color': 'rgba(239,68,68,0.35)',
              'circle-stroke-width': 6,
            },
          })
          hookJammingLayer(JAMMING_MIL_LAYER)
        }

        // ── Spoofing layer — purple circles with wide dashed-look stroke ──────
        if (!map.getLayer(JAMMING_SPF_LAYER)) {
          map.addLayer({
            id:     JAMMING_SPF_LAYER,
            type:   'circle',
            source: JAMMING_SOURCE,
            filter: ['==', ['get', 'jammingType'], 'spoofing'],
            paint:  {
              'circle-color':        '#a855f7',
              'circle-radius':       ['interpolate', ['linear'], ['zoom'], 2, 10, 8, 24],
              'circle-opacity':      0.88,
              'circle-stroke-color': 'rgba(168,85,247,0.5)',
              'circle-stroke-width': 8,
            },
          })
          hookJammingLayer(JAMMING_SPF_LAYER)
        }

        // ── Civilian interference layer — amber circles ───────────────────────
        if (!map.getLayer(JAMMING_CIV_LAYER)) {
          map.addLayer({
            id:     JAMMING_CIV_LAYER,
            type:   'circle',
            source: JAMMING_SOURCE,
            filter: ['in', ['get', 'jammingType'], ['literal', ['civilian', 'unknown']]],
            paint:  {
              'circle-color':        '#f59e0b',
              'circle-radius':       ['interpolate', ['linear'], ['zoom'], 2, 6, 8, 16],
              'circle-opacity':      0.8,
              'circle-stroke-color': 'rgba(245,158,11,0.35)',
              'circle-stroke-width': 4,
            },
          })
          hookJammingLayer(JAMMING_CIV_LAYER)
        }

      } catch (err) {
        console.warn('[map] GPS Jamming layer error:', err)
      } finally {
        setJammingLoading(false)
      }
    }

    if (map.loaded()) {
      void applyLayer()
    } else {
      map.once('load', () => { void applyLayer() })
    }

    // Auto-refresh every 5 minutes when jammingMode is active
    if (jammingMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 5 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jammingMode])

  // ── Country Risk Choropleth layer ────────────────────────────────────────────
  //
  // Fetches /api/v1/countries?window=24h&limit=200 for live risk scores and
  // joins against Natural Earth 110m country boundary GeoJSON from a public CDN.
  // Countries with no signal activity render transparent; active countries are
  // colored by risk band: critical #ff3b5c, high #f97316, elevated #fbbf24,
  // moderate #3b82f6, low #6b7280.
  //
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const CR_SOURCE = 'country-risk-geo'
    const CR_FILL   = 'country-risk-fill'
    const CR_LINE   = 'country-risk-border'

    const removeLayer = () => {
      try {
        map.off('click',      CR_FILL)
        map.off('mouseenter', CR_FILL)
        map.off('mouseleave', CR_FILL)
        if (map.getLayer(CR_LINE))   map.removeLayer(CR_LINE)
        if (map.getLayer(CR_FILL))   map.removeLayer(CR_FILL)
        if (map.getSource(CR_SOURCE)) map.removeSource(CR_SOURCE)
      } catch { /* ignore */ }
    }

    async function applyLayer() {
      if (!countryRiskMode) {
        removeLayer()
        setCountryRiskCount(0)
        return
      }

      setCountryRiskLoading(true)
      try {
        // Fetch risk API + country GeoJSON in parallel
        const [riskRes, geoRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/countries?window=24h&limit=200`),
          // Natural Earth 110m admin-0 GeoJSON — ~400 KB, ISO_A2 property
          fetch('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson'),
        ])

        if (!riskRes.ok || !geoRes.ok) {
          console.warn('[map] Country risk fetch failed', riskRes.status, geoRes.status)
          return
        }

        const riskJson = await riskRes.json() as {
          countries: Array<{
            code:         string
            name:         string
            risk_score:   number
            risk_label:   string
            risk_color:   string
            signal_count: number
            trend:        string
            categories:   string[]
          }>
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const geoJson = await geoRes.json() as { type: string; features: any[] }

        // Build lookup: ISO-2 code → risk entry
        const byCode = new Map<string, (typeof riskJson.countries)[0]>()
        for (const c of riskJson.countries ?? []) {
          byCode.set(c.code.toUpperCase(), c)
        }
        setCountryRiskCount(byCode.size)

        // Annotate each GeoJSON feature with the live risk data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const annotated = {
          ...geoJson,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          features: geoJson.features.map((f: any) => {
            // Natural Earth 110m uses ISO_A2 (some edge cases use '-99' for disputed)
            const iso2 = String(f.properties?.ISO_A2 ?? f.properties?.iso_a2 ?? '').toUpperCase()
            const risk = byCode.get(iso2)
            return {
              ...f,
              properties: {
                ...f.properties,
                wpIso2:        iso2,
                wpHasData:     !!risk,
                wpRiskScore:   risk?.risk_score   ?? 0,
                wpRiskLabel:   risk?.risk_label   ?? 'No Data',
                wpRiskColor:   risk?.risk_color   ?? 'rgba(0,0,0,0)',
                wpSignalCount: risk?.signal_count ?? 0,
                wpTrend:       risk?.trend        ?? 'stable',
                wpCategories:  risk?.categories?.join(', ') ?? '',
                wpCountryName: risk?.name ?? f.properties?.NAME ?? f.properties?.ADMIN ?? iso2,
              },
            }
          }),
        }

        if (!map.getSource(CR_SOURCE)) {
          map.addSource(CR_SOURCE, { type: 'geojson', data: annotated })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(CR_SOURCE) as any).setData(annotated)
        }

        // Insert choropleth BELOW signal layers so pins remain on top
        const beforeLayer = map.getLayer('cluster-halo') ? 'cluster-halo' : undefined

        if (!map.getLayer(CR_FILL)) {
          map.addLayer({
            id:     CR_FILL,
            type:   'fill',
            source: CR_SOURCE,
            paint: {
              'fill-color': [
                'case',
                ['!', ['get', 'wpHasData']], 'rgba(0,0,0,0)',
                ['>=', ['get', 'wpRiskScore'], 80], '#ff3b5c',
                ['>=', ['get', 'wpRiskScore'], 60], '#f97316',
                ['>=', ['get', 'wpRiskScore'], 40], '#fbbf24',
                ['>=', ['get', 'wpRiskScore'], 20], '#3b82f6',
                '#6b7280',
              ],
              'fill-opacity': 0.30,
            },
          }, beforeLayer)

          map.addLayer({
            id:     CR_LINE,
            type:   'line',
            source: CR_SOURCE,
            paint: {
              'line-color': [
                'case',
                ['!', ['get', 'wpHasData']], 'rgba(255,255,255,0.04)',
                ['>=', ['get', 'wpRiskScore'], 80], '#ff3b5c',
                ['>=', ['get', 'wpRiskScore'], 60], '#f97316',
                ['>=', ['get', 'wpRiskScore'], 40], '#fbbf24',
                ['>=', ['get', 'wpRiskScore'], 20], '#3b82f6',
                '#6b7280',
              ],
              'line-width':   0.6,
              'line-opacity': 0.5,
            },
          }, beforeLayer)

          map.on('mouseenter', CR_FILL, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', CR_FILL, () => { map.getCanvas().style.cursor = '' })

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map.on('click', CR_FILL, async (e: any) => {
            const feat = e.features?.[0]
            if (!feat) return
            const p = feat.properties as {
              wpCountryName: string
              wpHasData:     boolean
              wpRiskLabel:   string
              wpRiskScore:   number
              wpSignalCount: number
              wpTrend:       string
              wpCategories:  string
            }
            if (!p.wpHasData) return

            const riskColor =
              p.wpRiskScore >= 80 ? '#ff3b5c'
              : p.wpRiskScore >= 60 ? '#f97316'
              : p.wpRiskScore >= 40 ? '#fbbf24'
              : p.wpRiskScore >= 20 ? '#3b82f6'
              : '#6b7280'

            const trendArrow =
              p.wpTrend === 'rising'  ? '⬆' :
              p.wpTrend === 'falling' ? '⬇' : '➡'

            const { default: ml } = await import('maplibre-gl')
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
            popupRef.current = new ml.Popup({
              closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup',
            })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font:600 14px/1.4 system-ui;color:#e2e6f0;margin-bottom:6px">${p.wpCountryName}</div>
                <div style="font:700 28px/1 monospace;color:${riskColor};margin-bottom:4px">${p.wpRiskScore}</div>
                <div style="font:600 11px monospace;color:${riskColor};letter-spacing:1.5px;margin-bottom:8px">${p.wpRiskLabel.toUpperCase()} RISK</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">
                  📊 ${p.wpSignalCount} signal${p.wpSignalCount !== 1 ? 's' : ''} (24h)
                </div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">
                  Trend: ${trendArrow} ${p.wpTrend}
                </div>
                ${p.wpCategories
                  ? `<div style="font:10px monospace;color:#5a6477;margin-top:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.wpCategories}</div>`
                  : ''}
              `)
              .addTo(map)
          })
        }
      } catch (e) {
        console.warn('[map] Country risk choropleth error:', e)
      } finally {
        setCountryRiskLoading(false)
      }
    }

    if (map.loaded()) {
      void applyLayer()
    } else {
      map.once('load', () => { void applyLayer() })
    }

    // Auto-refresh every 10 minutes when active
    let refreshTimer: ReturnType<typeof setInterval> | null = null
    if (countryRiskMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 10 * 60_000)
    }
    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryRiskMode])

  // ── Sync filter state → URL (independent of map pan) ──────────────────────

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    if (!map) return
    const c = map.getCenter?.()
    const z = map.getZoom?.()
    if (c == null || z == null) return
    let url = `?z=${parseFloat(z).toFixed(2)}&lat=${parseFloat(c.lat).toFixed(4)}&lng=${parseFloat(c.lng).toFixed(4)}`
    if (category    !== 'all')  url += `&cat=${category}`
    if (timeRange   !== '24h')  url += `&tr=${timeRange}`
    if (heatmapMode)            url += `&hm=1`
    routerRef.current.replace(url, { scroll: false })
  }, [category, timeRange, heatmapMode])

  // ── Derived state ──────────────────────────────────────────────────────────

  const sevCounts = signals.reduce((a, s) => {
    a[s.severity] = (a[s.severity] ?? 0) + 1; return a
  }, {} as Record<string, number>)

  const sevColor = selected ? (SEV_COLOR[selected.severity] ?? '#8892a4') : '#8892a4'
  const sevBg    = selected ? (SEV_BG[selected.severity]    ?? 'rgba(136,146,164,0.15)') : ''
  const srcUrl   = selected ? getSourceUrl(selected.original_urls) : null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100dvh-52px-56px)] md:h-[calc(100dvh-52px)] flex flex-col bg-wp-bg">

      {/* Toolbar */}
      <div className="border-b border-[rgba(255,255,255,0.07)] bg-[rgba(6,7,13,0.92)] backdrop-blur-xl z-10">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="font-display text-[13px] tracking-[2.5px] text-wp-text font-bold flex-shrink-0">LIVE MAP</span>
          <div className="w-px h-4 bg-[rgba(255,255,255,0.1)] flex-shrink-0 hidden sm:block" />

          {/* Scrollable filter strip */}
          <div className="flex-1 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-1 min-w-max">
              {/* Category filter */}
              {CATS.map(cat => (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`px-[9px] py-[5px] sm:py-[3px] rounded-full border text-[10px] font-mono uppercase transition-all whitespace-nowrap min-h-[32px]
                    ${category === cat
                      ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.12)]'
                      : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}`}>
                  {cat}
                </button>
              ))}

              <div className="w-px h-4 bg-[rgba(255,255,255,0.06)] flex-shrink-0 mx-1" />

              {/* Severity filter */}
              {SEVS.map(sev => {
                const active = severity === sev
                const color  = sev !== 'all' ? SEV_COLOR[sev] : undefined
                const bg     = sev !== 'all' ? SEV_BG[sev]    : undefined
                return (
                  <button key={sev} onClick={() => setSeverity(sev)}
                    className={`px-[9px] py-[5px] sm:py-[3px] rounded-full border text-[10px] font-mono capitalize transition-all whitespace-nowrap min-h-[32px]
                      ${active && sev === 'all'
                        ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]'
                        : !active
                          ? 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'
                          : ''}`}
                    style={active && color ? { borderColor: color, color, background: bg } : {}}>
                    {sev}
                  </button>
                )
              })}

              <div className="w-px h-4 bg-[rgba(255,255,255,0.06)] flex-shrink-0 mx-1" />

              {/* Time range */}
              {TRANGE.map(opt => (
                <button key={opt.v} onClick={() => setTimeRange(opt.v)}
                  className={`px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                    ${timeRange === opt.v
                      ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]'
                      : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.15)]'}`}>
                  {opt.l}
                </button>
              ))}

              <div className="w-px h-4 bg-[rgba(255,255,255,0.06)] flex-shrink-0 mx-1" />

              {/* NASA GIBS Satellite imagery toggle */}
              <button
                onClick={() => setSatelliteMode(v => !v)}
                title={satelliteMode ? `NASA MODIS Terra satellite imagery — ${gibsDate}` : 'Toggle NASA GIBS satellite imagery'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${satelliteMode
                    ? 'border-[rgba(0,230,118,0.6)] text-wp-green bg-[rgba(0,230,118,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}`}>
                🛰 SAT
              </button>
              {satelliteMode && (
                <input
                  type="date"
                  value={gibsDate}
                  min="2000-02-24"
                  max={(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()}
                  onChange={e => { if (e.target.value) setGibsDate(e.target.value) }}
                  title="Select imagery date (NASA MODIS Terra, ~1 day delay)"
                  className="bg-black/30 border border-[rgba(0,230,118,0.3)] text-wp-green text-[10px] font-mono rounded px-2 py-[4px] min-h-[32px] outline-none focus:border-[rgba(0,230,118,0.6)] transition-colors cursor-pointer"
                />
              )}

              {/* CelesTrak satellite tracking toggle */}
              <button
                onClick={() => setSatTrackingMode(v => !v)}
                disabled={satTrackingLoading}
                title={satTrackingMode ? `CelesTrak: ${satCount} satellites displayed` : 'Toggle CelesTrak satellite tracking'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${satTrackingMode
                    ? 'border-[rgba(59,130,246,0.6)] text-[#93c5fd] bg-[rgba(59,130,246,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}
                  ${satTrackingLoading ? 'opacity-60 cursor-wait' : ''}`}>
                {satTrackingLoading
                  ? <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : '🛰️'}
                {' '}SATS
                {satTrackingMode && satCount > 0 && (
                  <span className="ml-1 px-1 py-px bg-[rgba(59,130,246,0.25)] rounded text-[9px]">{satCount}</span>
                )}
              </button>

              {/* Carrier Strike Group toggle */}
              <button
                onClick={() => setCarrierMode(v => !v)}
                disabled={carrierLoading}
                title={carrierMode ? 'Hide carrier strike group positions' : 'Toggle US Navy carrier strike group tracker (OSINT-estimated)'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${carrierMode
                    ? 'border-[rgba(30,58,95,0.9)] text-[#4a90d9] bg-[rgba(30,58,95,0.35)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}
                  ${carrierLoading ? 'opacity-60 cursor-wait' : ''}`}>
                {carrierLoading
                  ? <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : '⚓'}
                {' '}CARRIERS
              </button>

              {/* Missile / Drone Threat Intelligence toggle */}
              <button
                onClick={() => setThreatMode(v => !v)}
                disabled={threatLoading}
                title={threatMode ? `Threats: ${threatCount} active — hypersonic (purple), ballistic (red), cruise (orange), drone (amber), rocket (coral)` : 'Toggle missile/drone threat intelligence layer'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${threatMode
                    ? 'border-[rgba(255,34,34,0.6)] text-[#fca5a5] bg-[rgba(255,34,34,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}
                  ${threatLoading ? 'opacity-60 cursor-wait' : ''}`}>
                {threatLoading
                  ? <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : '🎯'}
                {' '}THREATS
                {threatMode && threatCount > 0 && (
                  <span className="ml-1 px-1 py-px bg-[rgba(255,34,34,0.25)] rounded text-[9px]">{threatCount}</span>
                )}
              </button>

              {/* GPS/GNSS Jamming Intelligence toggle */}
              <button
                onClick={() => setJammingMode(v => !v)}
                disabled={jammingLoading}
                title={jammingMode
                  ? `RF Jamming: ${jammingCount} active zones — military (red), spoofing (purple), civilian (amber)`
                  : 'Toggle GPS/GNSS jamming intelligence layer (military EW, spoofing, civilian interference)'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${jammingMode
                    ? 'border-[rgba(239,68,68,0.6)] text-[#fca5a5] bg-[rgba(239,68,68,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}
                  ${jammingLoading ? 'opacity-60 cursor-wait' : ''}`}>
                {jammingLoading
                  ? <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : '📡'}
                {' '}RF JAMMING
                {jammingMode && jammingCount > 0 && (
                  <span className="ml-1 px-1 py-px bg-[rgba(239,68,68,0.25)] rounded text-[9px]">{jammingCount}</span>
                )}
              </button>

              {/* Country Risk Choropleth toggle */}
              <button
                onClick={() => setCountryRiskMode(v => !v)}
                disabled={countryRiskLoading}
                title={countryRiskMode
                  ? `Country risk: ${countryRiskCount} countries — critical (red), high (orange), elevated (yellow), moderate (blue)`
                  : 'Toggle country risk choropleth (live risk scores from signal activity)'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${countryRiskMode
                    ? 'border-[rgba(251,191,36,0.6)] text-[#fde68a] bg-[rgba(251,191,36,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}
                  ${countryRiskLoading ? 'opacity-60 cursor-wait' : ''}`}>
                {countryRiskLoading
                  ? <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : '🌡'}
                {' '}RISK MAP
                {countryRiskMode && countryRiskCount > 0 && (
                  <span className="ml-1 px-1 py-px bg-[rgba(251,191,36,0.25)] rounded text-[9px]">{countryRiskCount}</span>
                )}
              </button>

              {/* Heatmap density toggle */}
              <button
                onClick={() => setHeatmapMode(v => !v)}
                title={heatmapMode ? 'Hide density heatmap' : 'Show signal density heatmap'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${heatmapMode
                    ? 'border-[rgba(255,100,30,0.6)] text-[#fdba74] bg-[rgba(255,100,30,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}`}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" className="flex-shrink-0">
                  <circle cx="6" cy="6" r="5" opacity="0.5"/>
                  <circle cx="6" cy="6" r="3" opacity="0.7"/>
                  <circle cx="6" cy="6" r="1.5"/>
                </svg>
                {' '}HEATMAP
              </button>

              {/* Naval Intelligence toggle */}
            <button
                onClick={() => setNavalMode(v => !v)}
                disabled={navalLoading}
                title={navalMode ? `Naval Intel: ${navalCount} vessels — carriers, AIS distress, dark ships` : 'Toggle Naval Intelligence layer (carriers + AIS distress + dark ships)'}
                className={`flex items-center gap-1 px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                  ${navalMode
                    ? 'border-[rgba(30,144,255,0.6)] text-[#60a5fa] bg-[rgba(30,144,255,0.1)]'
                    : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.2)]'}
                  ${navalLoading ? 'opacity-60 cursor-wait' : ''}`}>
                {navalLoading
                  ? <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : '🌊'}
                {' '}NAVAL INTEL
                {navalMode && navalCount > 0 && (
                  <span className="ml-1 px-1 py-px bg-[rgba(30,144,255,0.25)] rounded text-[9px]">{navalCount}</span>
                )}
              </button>
            </div>
          </div>

          {/* Visible signal count badge (cyan) */}
          <div
            title={`${visibleCount} signals visible in current viewport`}
            className="hidden sm:flex items-center gap-1 font-mono text-[10px] text-[#00d4ff] border border-[rgba(0,212,255,0.35)] bg-[rgba(0,212,255,0.07)] rounded-lg px-2 py-[4px] flex-shrink-0 whitespace-nowrap"
          >
            {visibleCount} SIGNALS
          </div>

          {/* WS status dot */}
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-wp-text2 border border-[rgba(255,255,255,0.07)] rounded-lg px-2 sm:px-2.5 py-[4px] flex-shrink-0">
            <span
              title={wsOnline ? 'Live feed connected' : 'Reconnecting…'}
              className={`w-[5px] h-[5px] rounded-full animate-live-pulse flex-shrink-0 ${wsOnline ? 'bg-wp-green' : 'bg-wp-red'}`}
            />
            <span className="hidden sm:inline">{signals.length} total</span>
            {wsNewCount > 0 && (
              <span
                title={`${wsNewCount} new signal${wsNewCount !== 1 ? 's' : ''} received live`}
                className="px-1 py-px bg-[rgba(0,230,118,0.2)] border border-[rgba(0,230,118,0.35)] text-wp-green rounded text-[9px]"
              >
                +{wsNewCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={mapContainer} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />

        {/* Heatmap density overlay — CSS-only radial gradients, pointer-events:none */}
        {heatmapMode && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
            {heatmapItems.map((item, i) => {
              const sizeMap: Record<string, number> = { critical: 80, high: 60, medium: 40, low: 20 }
              const colorMap: Record<string, string> = { critical: '#ff3b5c', high: '#f97316', medium: '#fbbf24', low: '#8892a4' }
              const size  = sizeMap[item.severity]  ?? 20
              const color = colorMap[item.severity] ?? '#8892a4'
              return (
                <div key={i} style={{
                  position:     'absolute',
                  left:         item.x - size / 2,
                  top:          item.y - size / 2,
                  width:        size,
                  height:       size,
                  borderRadius: '50%',
                  background:   `radial-gradient(circle, ${color} 0%, transparent 70%)`,
                  opacity:      0.25,
                  pointerEvents: 'none',
                }} />
              )
            })}
          </div>
        )}

        {/* ── Convergence Hotspots Widget ─────────────────────────────── */}
        {/* Shows geographic cells with 3+ distinct signal categories converging */}
        {hotspots.length > 0 && !selected && (
          <div className="absolute right-4 top-4 z-10 max-w-[220px]">
            <button
              onClick={() => setHotspotsOpen(o => !o)}
              className="w-full flex items-center gap-2 bg-[rgba(255,59,92,0.12)] border border-[rgba(255,59,92,0.35)] rounded-xl px-3 py-2 backdrop-blur-xl hover:bg-[rgba(255,59,92,0.2)] transition-all"
              aria-expanded={hotspotsOpen}
            >
              <span className="text-wp-red animate-live-pulse text-[14px]">⚡</span>
              <span className="font-mono text-[10px] text-wp-red font-bold tracking-wider flex-1 text-left">
                {hotspots.length} CONVERGENCE{hotspots.length !== 1 ? 'S' : ''}
              </span>
              <span className="font-mono text-[9px] text-wp-text3">{hotspotsOpen ? '▲' : '▼'}</span>
            </button>

            {hotspotsOpen && (
              <div className="mt-1 bg-[rgba(6,7,13,0.95)] border border-[rgba(255,255,255,0.09)] rounded-xl backdrop-blur-xl overflow-hidden">
                <div className="px-3 pt-2 pb-1 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase">24h Multi-Domain Convergence</span>
                </div>
                <div className="max-h-[240px] overflow-y-auto scrollbar-thin scrollbar-thumb-[rgba(255,255,255,0.07)]">
                  {hotspots.map((hs, i) => {
                    const sevColor: Record<string, string> = { critical: '#ff3b5c', high: '#f97316', medium: '#fbbf24', low: '#8892a4', info: '#6b7280' }
                    const color = sevColor[hs.maxSeverity] ?? '#f5a623'
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          // Fly map to hotspot center
                          if (mapRef.current) {
                            mapRef.current.flyTo({ center: [hs.centerLng, hs.centerLat], zoom: 5, duration: 1200 })
                          }
                          setHotspotsOpen(false)
                        }}
                        className="w-full text-left px-3 py-2 border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.04)] transition-colors last:border-0"
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
                          <span className="font-mono text-[10px] font-semibold" style={{ color }}>
                            {hs.categoryCount} domains · {hs.signalCount} signals
                          </span>
                        </div>
                        <div className="font-mono text-[9px] text-wp-text3 mb-0.5">
                          {hs.centerLat.toFixed(1)}°, {hs.centerLng.toFixed(1)}°
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {hs.categories.slice(0, 4).map(cat => (
                            <span key={cat} className="font-mono text-[8px] px-1 py-px bg-[rgba(245,166,35,0.1)] text-wp-amber border border-[rgba(245,166,35,0.2)] rounded">
                              {cat}
                            </span>
                          ))}
                          {hs.categories.length > 4 && (
                            <span className="font-mono text-[8px] text-wp-text3">+{hs.categories.length - 4}</span>
                          )}
                        </div>
                        {hs.sampleTitles[0] && (
                          <div className="font-mono text-[9px] text-wp-text2 mt-0.5 truncate" title={hs.sampleTitles[0]}>
                            {hs.sampleTitles[0]}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="px-3 py-1.5 border-t border-[rgba(255,255,255,0.06)]">
                  <span className="font-mono text-[8px] text-wp-text3">Click a hotspot to zoom to location</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Legend — hidden on mobile when panel is open to avoid overlap */}
        {/* Country risk legend — shown when choropleth is active */}
        {countryRiskMode && (
          <div className={`absolute left-4 z-10 pointer-events-none transition-all duration-300 ${selected ? 'bottom-[calc(72%+108px)] md:bottom-[108px]' : 'bottom-[108px]'}`}>
            <div className="bg-[rgba(6,7,13,0.88)] border border-[rgba(255,255,255,0.09)] rounded-xl p-3 backdrop-blur-xl">
              <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2">Country Risk</div>
              <div className="space-y-1.5">
                {([
                  ['Critical',  '#ff3b5c', '≥80'],
                  ['High',      '#f97316', '≥60'],
                  ['Elevated',  '#fbbf24', '≥40'],
                  ['Moderate',  '#3b82f6', '≥20'],
                  ['Low',       '#6b7280', '<20'],
                ] as const).map(([label, color, range]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-sm opacity-80" style={{ background: color }} />
                      <span className="font-mono text-[10px] text-wp-text2">{label}</span>
                    </div>
                    <span className="font-mono text-[10px] text-wp-text3">{range}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className={`absolute left-4 z-10 pointer-events-none transition-all duration-300 ${selected ? 'bottom-[72%] md:bottom-6' : 'bottom-6'}`}>
          <div className="bg-[rgba(6,7,13,0.88)] border border-[rgba(255,255,255,0.09)] rounded-xl p-3 backdrop-blur-xl">
            <div className="font-mono text-[9px] tracking-[2px] text-wp-text3 uppercase mb-2">Severity</div>
            <div className="space-y-1.5">
              {Object.entries(SEV_COLOR).map(([sev, color]) => (
                <div key={sev} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
                    <span className="font-mono text-[10px] text-wp-text2 capitalize">{sev}</span>
                  </div>
                  {sevCounts[sev] != null && (
                    <span className="font-mono text-[10px] text-wp-text3">{sevCounts[sev]}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Signal detail panel — bottom sheet on mobile, side panel on desktop */}
        {/* Mobile backdrop */}
        {selected && (
          <div
            className="md:hidden absolute inset-0 bg-black/40 z-10"
            onClick={() => setSelected(null)}
            aria-hidden="true"
          />
        )}
        <div className={`
          absolute bottom-0 left-0 right-0 max-h-[72vh] rounded-t-2xl overflow-hidden
          md:top-0 md:right-0 md:bottom-auto md:left-auto md:max-h-none md:h-full md:w-[340px] md:rounded-none
          bg-[rgba(6,7,13,0.97)]
          border-t md:border-t-0 md:border-l border-[rgba(255,255,255,0.09)]
          backdrop-blur-xl z-20 flex flex-col transition-transform duration-300 ease-out
          ${selected
            ? 'translate-y-0 md:translate-x-0 md:translate-y-0'
            : 'translate-y-full md:translate-x-full md:translate-y-0'
          }`}
          style={{ willChange: 'transform' }}
        >
          {selected && (
            <>
              {/* Drag handle — mobile only */}
              <div className="md:hidden flex justify-center pt-3 pb-1 flex-shrink-0" aria-hidden="true">
                <div className="w-10 h-[3px] rounded-full bg-[rgba(255,255,255,0.25)]" />
              </div>
              <div className="flex items-center justify-between px-5 py-3 md:py-4 border-b border-[rgba(255,255,255,0.07)] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: sevColor, boxShadow: `0 0 7px ${sevColor}` }} />
                  <span className="font-mono text-[10px] tracking-[1.5px] uppercase" style={{ color: sevColor }}>{selected.severity}</span>
                  <span className="text-wp-text3">·</span>
                  <span className="font-mono text-[10px] text-wp-text3 uppercase">{CAT_ICON[selected.category] ?? ''} {selected.category}</span>
                </div>
                <button onClick={() => setSelected(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.06)] transition-all text-[18px] leading-none">×</button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
                {/* BREAKING / CONTESTED badges */}
                {(selected.is_breaking && (Date.now() - new Date(selected.created_at).getTime()) < 30 * 60_000) ||
                 (selected.status === 'disputed' || (selected.community_flag_count ?? 0) >= 3) ? (
                  <div className="flex gap-2 flex-wrap">
                    {selected.is_breaking && (Date.now() - new Date(selected.created_at).getTime()) < 30 * 60_000 && (
                      <span className="source-badge bg-wp-red text-white animate-flash-tag">BREAKING</span>
                    )}
                    {(selected.status === 'disputed' || (selected.community_flag_count ?? 0) >= 3) && (
                      <span className="source-badge bg-[rgba(245,166,35,0.15)] text-wp-amber border border-[rgba(245,166,35,0.4)]">CONTESTED</span>
                    )}
                  </div>
                ) : null}
                <div className="text-[15px] font-semibold text-wp-text leading-[1.5]">{selected.title}</div>
                {selected.summary && (
                  <p className="text-[13px] text-wp-text2 leading-[1.65] border-l-2 pl-3" style={{ borderColor: sevColor + '55' }}>
                    {selected.summary}
                  </p>
                )}
                <div className="space-y-2">
                  {selected.location_name && (
                    <div className="flex items-center gap-2 text-[12px] text-wp-text2">
                      <span>📍</span><span>{selected.location_name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 font-mono text-[11px] text-wp-text3">
                    <span>🕐</span>
                    <span>{timeAgo(selected.created_at)}</span>
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
                    <ReliabilityDots
                      score={selected.reliability_score ?? 0}
                      label
                      crossCheckStatus={
                        selected.status === 'verified' ? 'confirmed' :
                        selected.status === 'disputed' ? 'contested' : 'unconfirmed'
                      }
                      communityFlagCount={selected.community_flag_count ?? 0}
                    />
                    <span className="font-mono text-[12px] font-bold text-wp-green">
                      {Math.round((selected.reliability_score ?? 0) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[rgba(255,255,255,0.07)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#00e676] to-[#00c853]"
                      style={{ width: `${Math.round((selected.reliability_score ?? 0) * 100)}%` }} />
                  </div>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium"
                  style={{ background: sevBg, color: sevColor, border: `1px solid ${sevColor}30` }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: sevColor }} />
                  {selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} severity
                </div>
              </div>

              <div className="px-5 py-4 border-t border-[rgba(255,255,255,0.07)] space-y-2"
                style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
                {srcUrl && (
                  <a href={srcUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                    style={{ background: sevBg, color: sevColor, border: `1px solid ${sevColor}40` }}>
                    Source: {getSourceDomain(srcUrl)}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </a>
                )}
                <Link href={`/?signal=${selected.id}`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[13px] text-wp-text2 hover:bg-[rgba(255,255,255,0.07)] hover:text-wp-text transition-all">
                  View Signal
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </Link>
                <button
                  onClick={() => toast('Signal bookmarked — saved to your collection', 'success')}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] text-[13px] text-wp-text3 hover:text-wp-amber hover:border-wp-amber hover:bg-[rgba(245,166,35,0.05)] transition-all"
                >
                  🔖 Bookmark Signal
                </button>
                <button
                  onClick={() => setFlagModalSignalId(selected.id)}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[rgba(255,255,255,0.01)] border border-[rgba(255,255,255,0.05)] text-[13px] text-wp-text3 hover:text-wp-red hover:border-wp-red/30 hover:bg-[rgba(255,59,92,0.05)] transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                  </svg>
                  Flag Signal
                </button>
              </div>
            </>
          )}
          {flagModalSignalId && (
            <FlagModal signalId={flagModalSignalId} onClose={() => setFlagModalSignalId(null)} />
          )}
        </div>

        {loading && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            {/* Skeleton shimmer over the map toolbar area */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[rgba(6,7,13,0.88)] border border-[rgba(255,255,255,0.09)] rounded-xl px-5 py-3 backdrop-blur-xl shadow-xl">
              <div className="w-2 h-2 rounded-full bg-wp-amber animate-live-pulse" />
              <div className="font-mono text-[11px] text-wp-amber tracking-widest">LOADING SIGNALS…</div>
            </div>
            {/* Subtle map overlay */}
            <div className="absolute inset-0 bg-[rgba(6,7,13,0.25)]" />
          </div>
        )}

        {/* No signals in area empty state (only shown when map is done loading) */}
        {!loading && signals.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto">
              <div className="bg-[rgba(6,7,13,0.92)] border border-[rgba(255,255,255,0.09)] rounded-2xl backdrop-blur-xl shadow-2xl max-w-[300px]">
                <EmptyState
                  icon="🗺️"
                  headline="No signals in this area"
                  message={`No ${category !== 'all' ? category : ''} signals found in the selected time range.`}
                  cta={{ label: 'Reset filters', onClick: () => { setCategory('all'); setSeverity('all'); setTimeRange('24h') } }}
                  compact
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .wp-map-popup .maplibregl-popup-content {
          background: rgba(6,7,13,0.97);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 11px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          backdrop-filter: blur(12px);
        }
        .wp-map-popup .maplibregl-popup-tip { border-top-color: rgba(6,7,13,0.97) !important; }
        .wp-map-popup .maplibregl-popup-close-button {
          color: #8892a4; font-size: 16px; right: 6px; top: 4px;
        }
        .maplibregl-ctrl-attrib { display: none !important; }
      `}</style>
    </div>
  )
}

// ── Page export (Suspense required for useSearchParams in App Router) ──────────

function MapFallback() {
  return (
    <div className="h-[calc(100vh-52px)] flex flex-col bg-wp-bg">
      {/* Toolbar skeleton */}
      <div className="h-[46px] border-b border-[rgba(255,255,255,0.07)] bg-[rgba(6,7,13,0.92)] flex items-center gap-3 px-4">
        <div className="h-4 w-20 rounded shimmer" />
        <div className="h-4 w-px bg-[rgba(255,255,255,0.07)]" />
        {[80, 64, 72, 60, 80, 70, 68].map((w, i) => (
          <div key={i} className="h-[22px] rounded-full shimmer" style={{ width: w }} />
        ))}
      </div>
      {/* Map area skeleton */}
      <div className="flex-1 shimmer" />
    </div>
  )
}

export default function MapPage() {
  return (
    <Suspense fallback={<MapFallback />}>
      <MapView />
    </Suspense>
  )
}