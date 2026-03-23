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
const CATS   = ['all', 'breaking', 'conflict', 'climate', 'economy', 'technology', 'health', 'disaster']
const SEVS   = ['all', 'critical', 'high', 'medium', 'low']
const HTIMES = [{ v: 1, l: '1h' }, { v: 6, l: '6h' }, { v: 24, l: '24h' }, { v: 168, l: '7d' }]

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
  const newSignalIdsRef    = useRef<Set<string>>(new Set())
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [hours,    setHours]    = useState(24)
  const [wsOnline, setWsOnline] = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchSignals = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ hours: String(hours) })
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
  }, [category, severity, hours])

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
    const zoom = Math.max(0, Math.min(14, Math.floor(map.getZoom())))
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
      const sc: SCIndex = new SuperclusterLib({ radius: 60, maxZoom: 14 })
      sc.load(features)
      scRef.current = sc
      refreshClusters()
    })()
    return () => { cancelled = true }
  }, [signals, refreshClusters])

  // ── WebSocket ──────────────────────────────────────────────────────────────

  useEffect(() => {
    function connectWS() {
      const ws = new WebSocket(`${WS_URL}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        setWsOnline(true)
        ws.send(JSON.stringify({ type: 'subscribe', payload: { channels: ['all'] } }))
      }

      ws.onmessage = (evt: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(evt.data) as { event?: string; data?: unknown }
          if (msg.event !== 'signal.new') return

          const raw   = msg.data as Record<string, unknown>
          const point = extractLatLng(raw)
          if (!point) return

          const newSig: MapSignal = {
            id:               String(raw.id    ?? ''),
            title:            String(raw.title  ?? ''),
            summary:          typeof raw.summary        === 'string' ? raw.summary        : null,
            lat:              point.lat,
            lng:              point.lng,
            severity:         typeof raw.severity        === 'string' ? raw.severity        : 'info',
            category:         typeof raw.category        === 'string' ? raw.category        : 'other',
            status:           typeof raw.status          === 'string' ? raw.status          : 'pending',
            location_name:    typeof raw.location_name   === 'string' ? raw.location_name   : null,
            country_code:     typeof raw.country_code    === 'string' ? raw.country_code    : null,
            reliability_score: typeof raw.reliability_score === 'number' ? raw.reliability_score : 0,
            created_at:       typeof raw.created_at      === 'string' ? raw.created_at      : new Date().toISOString(),
            original_urls:    Array.isArray(raw.original_urls) ? (raw.original_urls as string[]) : null,
          }
          if (!newSig.id) return

          // Prepend; evict oldest if over cap
          signalsRef.current = prependSignal(signalsRef.current, newSig)
          setSignals([...signalsRef.current])

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
        } catch { /* malformed message — ignore */ }
      }

      ws.onclose = () => {
        setWsOnline(false)
        wsReconnectRef.current = setTimeout(connectWS, 5000)
      }

      ws.onerror = () => { ws.close() }
    }

    connectWS()

    return () => {
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null   // prevent auto-reconnect on intentional unmount
        wsRef.current.close()
      }
      for (const t of highlightTimersRef.current.values()) clearTimeout(t)
      highlightTimersRef.current.clear()
    }
  }, []) // run once — reconnect loop is self-contained

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
        maxZoom: 14,
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

        // ── Cluster click: zoom in ────────────────────────────

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', 'clusters', (e: any) => {
          const feat = e.features?.[0]
          if (!feat) return
          const sc = scRef.current
          if (!sc) return
          const clusterId = feat.properties.cluster_id as number
          const z = sc.getClusterExpansionZoom(clusterId)
          map.flyTo({ center: feat.geometry.coordinates as [number, number], zoom: z, duration: 600 })
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
          if (urlTimerRef.current) clearTimeout(urlTimerRef.current)
          urlTimerRef.current = setTimeout(() => {
            const c = map.getCenter()
            const z = map.getZoom()
            routerRef.current.replace(
              `?z=${z.toFixed(2)}&lat=${c.lat.toFixed(4)}&lng=${c.lng.toFixed(4)}`,
              { scroll: false },
            )
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
                  className={`px-[9px] py-[5px] sm:py-[3px] rounded-full border text-[10px] font-mono capitalize transition-all whitespace-nowrap min-h-[32px]
                    ${category === cat
                      ? 'border-wp-cyan text-wp-cyan bg-[rgba(0,212,255,0.1)]'
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
              {HTIMES.map(opt => (
                <button key={opt.v} onClick={() => setHours(opt.v)}
                  className={`px-2.5 py-[5px] sm:py-[3px] rounded border text-[10px] font-mono transition-all whitespace-nowrap min-h-[32px]
                    ${hours === opt.v
                      ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.1)]'
                      : 'border-[rgba(255,255,255,0.06)] text-wp-text3 hover:border-[rgba(255,255,255,0.15)]'}`}>
                  {opt.l}
                </button>
              ))}
            </div>
          </div>

          {/* WS status + signal count */}
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-wp-text2 border border-[rgba(255,255,255,0.07)] rounded-lg px-2 sm:px-2.5 py-[4px] flex-shrink-0">
            <span
              title={wsOnline ? 'Live' : 'Reconnecting…'}
              className={`w-[5px] h-[5px] rounded-full animate-live-pulse flex-shrink-0 ${wsOnline ? 'bg-wp-green' : 'bg-wp-red'}`}
            />
            <span className="hidden sm:inline">{signals.length} signals</span>
          </div>
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={mapContainer} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />

        {/* Legend — hidden on mobile when panel is open to avoid overlap */}
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
                  message={`No ${category !== 'all' ? category : ''} signals found in the last ${hours < 24 ? `${hours}h` : hours === 24 ? '24h' : '7 days'}.`}
                  cta={{ label: 'Reset filters', onClick: () => { setCategory('all'); setSeverity('all'); setHours(24) } }}
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
