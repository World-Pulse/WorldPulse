'use client'

import React, { useEffect, useRef, useState, useCallback, useMemo, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type Supercluster from 'supercluster'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/components/Toast'
import { ReliabilityDots } from '@/components/signals/ReliabilityDots'
import { FlagModal } from '@/components/signals/FlagModal'
import { TimeSlider } from '@/components/map/TimeSlider'
import { ShareButton } from '@/components/map/ShareButton'
import HotspotLabels from '@/components/map/HotspotLabels'
import { EnhancedHeatmap } from '@/components/map/EnhancedHeatmap'
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback'
import { parseWindowHash, encodePermalink, type MapPermalinkState, type LayerKey } from '@/lib/map-permalink'
import {
  Map as MapIcon, Moon, Satellite, Globe2, LocateFixed, Layers as LayersIcon,
  Flame, History, Swords, Crosshair, RadioTower, Anchor, Plane, Ship, Activity, ShieldAlert, Video, List as ListIcon,
  SunMoon, Compass,
} from 'lucide-react'
import { LayersPanel, activeLayerCount, type MapLayerGroup } from '@/components/map/LayersPanel'
import { MapLegend } from '@/components/map/MapLegend'
import { LiveList, latestFirst } from '@/components/map/LiveList'
import { CountryBrief, type CountryRisk } from '@/components/map/CountryBrief'
import { SinceLastVisit } from '@/components/map/SinceLastVisit'
import { useLastVisit } from '@/hooks/useLastVisit'
import { sinceLastVisit, awayLabel } from '@/lib/last-visit'
import { countryAt, loadCountryShapes, focusBboxOf, type CountryHit } from '@/lib/country-shapes'
import { signalsInCountry, countryBrief } from '@/lib/country-brief'
import { toHotspot, hotspotPlace, type Hotspot } from '@/lib/hotspots'
import { ensureMapIcon, MAP_ICON } from '@/lib/map-icons'
import { dayNightFeatures, subsolarPoint } from '@/lib/daynight'
import { MAP_REGIONS } from '@/lib/map-regions'
import {
  SEVERITY_COLOR, SEVERITY_BG, SEVERITY_RANK, CLUSTER_COLOR_EXPR, SIGNAL_RADIUS_EXPR, FONT_BOLD,
  BASEMAP_MODES, BASEMAP_LABEL, ATMOSPHERE,
  loadBaseStyle, baseLayerIds, addImageryLayers, applyBasemap, toBasemapMode,
  type BasemapMode,
} from '@/lib/map-style'

import {
  timeAgo, getSourceUrl, getSourceDomain, reliabilityDots,
  parseWKBPoint, extractLatLng, prependSignal, MAX_SIGNALS,
  escapeHtml, safeHttpUrl, safeCssColor,
} from '@/lib/map-utils'

const API_URL      = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const WS_URL       = process.env.NEXT_PUBLIC_WS_URL  ?? API_URL.replace(/^http/, 'ws')
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ''
/** localStorage: '0' when the reader turned day and night off */
const DAYNIGHT_KEY = 'wp_map_daynight'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MapSignal {
  id: string
  title: string
  /** Not in the map's lean points: fetched when the signal is opened (undefined until then) */
  summary?: string | null
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

/** What each cluster carries: its most severe signal's rank and how many are verified */
interface ClusterProps {
  sev: number
  verified: number
}

type SCIndex = Supercluster<SignalProps, ClusterProps>

type ProjectionMode = 'globe' | 'mercator'

interface AdsbSignal {
  id: string
  title: string
  lat: number
  lng: number
  reliability_score: number
  published_at: string | null
}

interface CameraFeed {
  id:          string
  name:        string
  region:      string
  country:     string
  countryCode: string
  lat:         number
  lng:         number
  embedUrl:    string
  snapshotUrl: string | null
  type:        'traffic' | 'weather' | 'city' | 'nature'
  isLive:      boolean
}

interface HazardPoint {
  id: string
  title: string
  lat: number
  lng: number
  severity: string
  category: string
  source_slug: string
  published_at: string
  reliability_score: number
}

interface AnnotationCard {
  signal: MapSignal
  lat: number
  lng: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

// One palette for the map, its legend, pop-ups and panels (lib/map-style.ts)
const SEV_COLOR = SEVERITY_COLOR
const SEV_BG    = SEVERITY_BG
const CAT_ICON: Record<string, string> = {
  breaking: '🚨', conflict: '⚔️', geopolitics: '🌐', climate: '🌡️', health: '🏥',
  economy: '📈', technology: '💻', science: '🔬', elections: '🗳️', culture: '🎭',
  disaster: '🌊', security: '🔒', sports: '⚽', space: '🚀', other: '🌍',
}
const CATS   = ['all', 'conflict', 'climate', 'health', 'economy', 'science', 'disaster']
const SEVS   = ['all', 'critical', 'high', 'medium', 'low']
/** The reader's sign-in, for layers that need an account */
function signedInHeaders(): Record<string, string> {
  try {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('wp_access_token') : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
const SIGN_IN_NOTE = { text: 'This layer needs a free account.', href: '/auth/login', linkText: 'Sign in' }

/** The time window in words, for the country brief */
const TIME_WINDOW_LABEL: Record<string, string> = {
  '1h': 'last hour', '6h': 'last 6 hours', '24h': 'last 24 hours', '7d': 'last 7 days', all: 'all time',
}
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
        color:             SEV_COLOR[s.severity] ?? SEV_COLOR.low,
      },
    }))
}

/**
 * The zoom that shows the whole world: on the globe, a sphere filling ~85% of
 * the shorter side; on the flat map, the world's width. (A world at zoom z is
 * 512·2^z pixels around; the globe's diameter is that divided by π.)
 */
function worldZoom(width: number, height: number, projection: 'globe' | 'mercator' = 'globe'): number {
  const w = Math.max(width, 200)
  const h = Math.max(height, 200)
  const z = projection === 'globe'
    ? Math.log2((Math.min(w, h) * 0.85 * Math.PI) / 512)
    : Math.log2(w / 512)
  return Math.max(0.6, Math.min(3, z))
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
  /** While nothing pulses, the animation checks once a second instead of every frame (M3) */
  const animIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Whether a critical signal is drawn on its own (it pulses) */
  const hasCriticalRef = useRef(false)

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

  // ── Permalink hash — parse once at mount, takes priority over ?lat/?lng/?z ──
  // Must be evaluated synchronously before useState initializers below.
  const permalinkRef = useRef<MapPermalinkState | null>(
    typeof window !== 'undefined' ? parseWindowHash() : null
  )
  const hashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** A shared link's selected signal, opened once the signals have loaded (M10) */
  const pendingSignalRef = useRef<string | null>(permalinkRef.current?.signalId ?? null)

  // Initial map position from URL params — read once at mount
  // If a permalink hash is present, it takes priority over query params.
  const initPosRef = useRef({
    lat:  permalinkRef.current?.lat  ?? Number(searchParams.get('lat') ?? '20'),
    lng:  permalinkRef.current?.lng  ?? Number(searchParams.get('lng') ?? '10'),
    zoom: permalinkRef.current?.zoom ?? Number(searchParams.get('z')   ?? '2'),
  })

  const { toast } = useToast()

  const [signals,  setSignals]  = useState<MapSignal[]>([])
  const [selected,         setSelected]         = useState<MapSignal | null>(null)
  // "Since you last looked" (plan M8)
  const lastVisit = useLastVisit()
  const [sinceShown,     setSinceShown]     = useState(false)
  const [sinceDismissed, setSinceDismissed] = useState(false)
  // Country brief (plan M9): the country clicked on the map
  const [country,          setCountry]          = useState<(CountryHit & { risk: CountryRisk | null }) | null>(null)
  const [flagModalSignalId, setFlagModalSignalId] = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [category,    setCategory]    = useState(() => searchParams.get('cat') ?? 'all')
  const [severity,    setSeverity]    = useState('all')
  const [timeRange,   setTimeRange]   = useState(() => searchParams.get('tr')  ?? '24h')
  const [wsOnline,    setWsOnline]    = useState(false)
  const [heatmapMode, setHeatmapMode] = useState(() => searchParams.get('hm') === '1')
  const [visibleCount, setVisibleCount] = useState(0)
  const [mapZoom, setMapZoom] = useState(2)
  // BAT-16: EnhancedHeatmap instance — created once after map loads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enhancedHeatmapRef = useRef<EnhancedHeatmap | null>(null)

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
  const [satError,           setSatError]           = useState<string | null>(null)
  const [gibsError,          setGibsError]          = useState<string | null>(null)

  // ── Carrier Strike Group tracking state ────────────────────────────────────
  const [carrierMode,    setCarrierMode]    = useState(false)
  const [carrierLoading, setCarrierLoading] = useState(false)

  // ── Naval Intelligence layer state ──────────────────────────────────────────
  const [navalMode,    setNavalMode]    = useState(false)
  const [navalLoading, setNavalLoading] = useState(false)
  const [navalCount,   setNavalCount]   = useState(0)

  // ── Maritime AIS ship tracking layer state ───────────────────────────────────
  const [showShips,    setShowShips]    = useState(false)
  const [shipCount,    setShipCount]    = useState(0)

  // ── Missile/Drone Threat layer state ────────────────────────────────────────
  const [threatMode,    setThreatMode]    = useState(false)
  const [threatLoading, setThreatLoading] = useState(false)
  const [threatCount,   setThreatCount]   = useState(0)

  // ── GPS/GNSS Jamming layer state ─────────────────────────────────────────────
  const [jammingMode,    setJammingMode]    = useState(false)
  const [jammingLoading, setJammingLoading] = useState(false)
  const [jammingCount,   setJammingCount]   = useState(0)
  // Missile threats and GPS jamming need an account (the API answers 401)
  const [signInNeeded,   setSignInNeeded]   = useState<{ threats?: boolean; jamming?: boolean }>({})

  // ── Natural Hazards layer state ───────────────────────────────────────────────
  const [hazardsMode,    setHazardsMode]    = useState(false)
  const [hazardsLoading, setHazardsLoading] = useState(false)
  const [hazardsCount,   setHazardsCount]   = useState(0)

  // ── Country Risk Choropleth layer state ───────────────────────────────────────
  const [countryRiskMode,    setCountryRiskMode]    = useState(false)
  const [countryRiskLoading, setCountryRiskLoading] = useState(false)
  const [countryRiskCount,   setCountryRiskCount]   = useState(0)

  // ── Conflict Zone Overlay layer state (BAT-17) ─────────────────────────────
  const [conflictMode,    setConflictMode]    = useState(false)
  const [conflictLoading, setConflictLoading] = useState(false)
  const [conflictCount,   setConflictCount]   = useState(0)
  const conflictLayerRef  = useRef<import('@/components/map/ConflictZoneOverlay').ConflictZoneOverlay | null>(null)
  const conflictRegionRef = useRef<import('@/components/map/ConflictRegions').ConflictRegionLayer | null>(null)

  // ── Wind Particle Flow layer state ─────────────────────────────────────────────
  const [windMode,    setWindMode]    = useState(false)
  const [windLoading, setWindLoading] = useState(false)
  const [windDensity, setWindDensity] = useState<'16k' | '32k' | '65k'>('32k')
  const windLayerRef = useRef<import('@/components/map/WindParticleLayer').WindParticleLayer | null>(null)

  // ── Timeline Playback state (BAT-14) ────────────────────────────────────────────
  // A shared link's Replay is switched on after the first render (see the M10 effect)
  const [timelineActive, setTimelineActive] = useState(false)
  const [timelineRange, setTimelineRange] = useState('24h')
  const timeline = useTimelinePlayback()

  // ── Basemap switcher state ────────────────────────────────────────────────────
  // Starts dark on the server and the client alike (the server can't see the #hash); a
  // shared link's basemap is applied right after (below), before the map loads
  const [basemap, setBasemap] = useState<BasemapMode>('dark')
  const basemapRef = useRef<BasemapMode>(basemap)
  useEffect(() => { basemapRef.current = basemap }, [basemap])
  /** The basemap's own layer ids, known once the map has loaded */
  const baseIdsRef = useRef<string[] | null>(null)

  // ── Globe/Mercator projection state ──────────────────────────────────────────
  const [projection, setProjection] = useState<ProjectionMode>('globe')
  const projectionRef = useRef<ProjectionMode>(projection)
  useEffect(() => { projectionRef.current = projection }, [projection])

  // ── Projection switcher effect (MapLibre v5+ globe support) ──────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(map as any).setProjection({ type: projection })
      // The atmosphere only shows around the globe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (projection === 'globe') (map as any).setSky?.(ATMOSPHERE)
    } catch (e) {
      console.warn('[map] setProjection failed (requires MapLibre v5+):', e)
    }
  }, [projection])

  // ── Basemap switcher effect ───────────────────────────────────────────────────
  // Dark vector map, night lights or satellite: only layer visibility changes,
  // so signal and overlay layers stay put (lib/map-style.ts)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !baseIdsRef.current) return
    try {
      applyBasemap(map, basemap, baseIdsRef.current)
    } catch (e: unknown) {
      console.warn('[map] basemap switch error:', e)
    }
  }, [basemap])

  // ── ADS-B Aircraft layer state ────────────────────────────────────────────────
  const [showAircraft, setShowAircraft] = useState(false)
  const [adsbSignals, setAdsbSignals] = useState<AdsbSignal[]>([])

  // ── Live Webcam / IP Camera layer state ───────────────────────────────────────
  const [showCameras, setShowCameras] = useState(false)
  const [cameraCount, setCameraCount] = useState(0)

  // ── Annotation cards (Palantir-style intelligence overlays) ───────────────────
  const [annotationCards, setAnnotationCards] = useState<Map<string, AnnotationCard>>(new Map())
  const annotationCardsRef = useRef<Map<string, AnnotationCard>>(new Map())
  useEffect(() => { annotationCardsRef.current = annotationCards }, [annotationCards])
  // Incremented on map moveend to re-project connector lines
  const [mapMoveCount, setMapMoveCount] = useState(0)

  // ── Geographic Convergence Hotspots state ──────────────────────────────────
  const [hotspots,     setHotspots]     = useState<Hotspot[]>([])
  const [hotspotsOpen, setHotspotsOpen] = useState(false)
  const [layersOpen,   setLayersOpen]   = useState(false)
  /** The map has loaded: overlay layers switched on earlier (e.g. by a shared link) can draw now */
  const [mapReady,     setMapReady]     = useState(false)
  // Day and night (M18): on unless this reader turned it off (kept in this browser only)
  const [dayNight, setDayNight] = useState(true)
  useEffect(() => {
    try { if (localStorage.getItem(DAYNIGHT_KEY) === '0') setDayNight(false) } catch { /* storage blocked */ }
  }, [])
  const toggleDayNight = useCallback(() => {
    setDayNight(on => {
      try { localStorage.setItem(DAYNIGHT_KEY, on ? '0' : '1') } catch { /* storage blocked */ }
      return !on
    })
  }, [])
  // Region shortcuts (M18)
  const [regionsOpen, setRegionsOpen] = useState(false)
  // "Latest in view" list beside the map (M14): open by default on wide screens
  const [listOpen,     setListOpen]     = useState(false)
  const [inView,       setInView]       = useState<MapSignal[]>([])
  const inViewKeyRef = useRef('')
  const listOpenRef  = useRef(listOpen)
  useEffect(() => { listOpenRef.current = listOpen }, [listOpen])
  useEffect(() => { if (window.innerWidth >= 1280) setListOpen(true) }, [])
  // On desktop the list covers the map's left 320px: centre the map in the rest
  useEffect(() => {
    const map = mapRef.current
    if (!map || typeof window === 'undefined') return
    const left = listOpen && window.innerWidth >= 768 ? 320 : 0
    try { map.easeTo({ padding: { left, right: 0, top: 0, bottom: 0 }, duration: 400 }) } catch { /* map not ready */ }
  }, [listOpen])

  useEffect(() => {
    let mounted = true
    async function fetchHotspots() {
      try {
        // The last 24 hours, as the list says (it asked for 7 days)
        const res  = await fetch(`${API_URL}/api/v1/signals/map/hotspots?hours=24&min_categories=2&limit=25`)
        if (!res.ok) return
        const json = await res.json() as { success: boolean; data?: { hotspots?: unknown[] } }
        if (mounted && json.success) {
          setHotspots((json.data?.hotspots ?? []).map(toHotspot).filter((h): h is Hotspot => h !== null))
        }
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

  // ── Permalink state refs (BAT-15) — kept current for hash encoder ────────────
  const windModeRef       = useRef(windMode)
  const timelineActiveRef = useRef(timelineActive)
  const timelineRangeRef  = useRef(timelineRange)
  const selectedRef       = useRef(selected)
  useEffect(() => { windModeRef.current       = windMode       }, [windMode])
  useEffect(() => { timelineActiveRef.current = timelineActive }, [timelineActive])
  useEffect(() => { timelineRangeRef.current  = timelineRange  }, [timelineRange])
  useEffect(() => { selectedRef.current       = selected       }, [selected])

  /** Every layer that's on, for share links (M10) */
  const activeLayerKeysRef = useRef<LayerKey[]>([])

  /** Collect current map state for permalink encoding. */
  const getPermalinkState = useCallback((): MapPermalinkState => {
    const map = mapRef.current
    const center = map?.getCenter?.() ?? { lat: 20, lng: 10 }
    const zoom   = map?.getZoom?.()   ?? 2
    const layers: LayerKey[] = [...activeLayerKeysRef.current]
    return {
      lat:           Number(center.lat.toFixed(4)),
      lng:           Number(center.lng.toFixed(4)),
      zoom:          Number(zoom.toFixed(2)),
      layers,
      timelineRange: timelineActiveRef.current ? timelineRangeRef.current : undefined,
      signalId:      selectedRef.current?.id,
      basemap:       basemapRef.current,
    }
  }, [])

  /** Write permalink hash to window.location (debounced, 500ms). */
  const updateHash = useCallback(() => {
    if (typeof window === 'undefined' || !mapRef.current) return
    if (hashTimerRef.current) clearTimeout(hashTimerRef.current)
    hashTimerRef.current = setTimeout(() => {
      const state = getPermalinkState()
      const hash  = encodePermalink(state)
      window.history.replaceState(null, '', `#${hash}`)
    }, 500)
  }, [getPermalinkState])

  // Re-write hash whenever layer toggles or selected signal changes (BAT-15)
  useEffect(() => { updateHash() }, [windMode, timelineActive, timelineRange, basemap, selected?.id, updateHash])

  // Share links carry every layer that's on, and open with them on (M10)
  useEffect(() => {
    const on: Array<[boolean, LayerKey]> = [
      [heatmapMode, 'heat'], [timelineActive, 'timeline'], [showAircraft, 'adsb'], [showShips, 'ships'],
      [showCameras, 'cameras'], [navalMode, 'naval'], [threatMode, 'threats'], [jammingMode, 'jamming'],
      [hazardsMode, 'hazards'], [satelliteMode, 'sat'], [countryRiskMode, 'country-risk'], [conflictMode, 'conflict'],
    ]
    activeLayerKeysRef.current = on.filter(([isOn]) => isOn).map(([, key]) => key)
    updateHash()
  }, [heatmapMode, timelineActive, showAircraft, showShips, showCameras, navalMode, threatMode, jammingMode,
      hazardsMode, satelliteMode, countryRiskMode, conflictMode, updateHash])

  // A shared link opens with its layers and basemap (M10). Applied after the first
  // render: the server can't see the #hash, so doing it in useState broke hydration
  useEffect(() => {
    const link = permalinkRef.current
    if (!link) return
    const bm = toBasemapMode(link.basemap)
    if (bm) { basemapRef.current = bm; setBasemap(bm) }
    const has = (key: LayerKey) => link.layers?.includes(key) ?? false
    if (has('heat'))         setHeatmapMode(true)
    if (has('adsb'))         setShowAircraft(true)
    if (has('ships'))        setShowShips(true)
    if (has('cameras'))      setShowCameras(true)
    if (has('naval'))        setNavalMode(true)
    if (has('threats'))      setThreatMode(true)
    if (has('jamming'))      setJammingMode(true)
    if (has('hazards'))      setHazardsMode(true)
    if (has('sat'))          setSatelliteMode(true)
    if (has('country-risk')) setCountryRiskMode(true)
    if (has('conflict'))     setConflictMode(true)
    if (link.timelineRange) { setTimelineRange(link.timelineRange); setTimelineActive(true) }
  }, [])

  // A shared link's signal opens once it's among the loaded ones (M10)
  useEffect(() => {
    const id = pendingSignalRef.current
    if (!id || signals.length === 0) return
    const sig = signals.find(x => x.id === id)
    pendingSignalRef.current = null
    if (sig) setSelected(sig)
  }, [signals])

  // ── Fetch ──────────────────────────────────────────────────────────────────

  // `background` refreshes (the 30s poll) update quietly; only first load and filter changes show the overlay.
  const fetchSignals = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const p = new URLSearchParams()
      const trEntry = TRANGE.find(t => t.v === timeRange)
      const h = trEntry?.hours ?? 168   // 'all' → max window the API supports (7d)
      p.set('hours', String(h))
      // Up to 3,000 light points: every critical, high and verified signal in
      // the window, then the newest (500 newest-first covered ~3 of 24 hours)
      p.set('limit', String(MAX_SIGNALS))
      p.set('lean', '1')
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
      if (!background) setLoading(false)
    }
  }, [category, severity, timeRange])

  useEffect(() => { fetchSignals(false) }, [fetchSignals])

  // ── Auto-refresh every minute while the page is in view ──────────────────
  // (live arrivals come over the WebSocket; this catches anything it missed)

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      fetchSignals(true)
    }, 60_000)
    return () => clearInterval(id)
  }, [fetchSignals])

  // Lean map points carry no summary: fetch it when a signal is opened
  useEffect(() => {
    if (!selected || selected.summary !== undefined) return
    const id = selected.id
    let cancelled = false
    const fill = (summary: string | null, urls?: string[] | null) => {
      if (cancelled) return
      const known = signalsRef.current.find(s => s.id === id)
      if (known) { known.summary = summary; if (urls?.length) known.original_urls = urls }
      setSelected(prev => prev && prev.id === id ? { ...prev, summary, ...(urls?.length ? { original_urls: urls } : {}) } : prev)
    }
    fetch(`${API_URL}/api/v1/signals/${encodeURIComponent(id)}`)
      .then(res => (res.ok ? res.json() : null))
      .then((json: { data?: { summary?: string | null; originalUrls?: string[] | null } } | null) => fill(json?.data?.summary ?? null, json?.data?.originalUrls))
      .catch(() => fill(null))
    return () => { cancelled = true }
  }, [selected])

  // ── Viewport cluster refresh ───────────────────────────────────────────────

  const refreshClusters = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    const sc  = scRef.current
    if (!map || !sc) return
    const src = map.getSource('signals')
    if (!src) return
    const zoomNow = map.getZoom()
    const zoom = Math.max(0, Math.min(18, Math.floor(zoomNow)))
    // Zoomed out (and on the globe) the view's bounds aren't a usable box: take the whole world
    let bbox: [number, number, number, number] = [-180, -85, 180, 85]
    if (zoomNow >= 3) {
      const b = map.getBounds()
      bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
    }
    const clusters = sc.getClusters(bbox, zoom)
    src.setData({ type: 'FeatureCollection', features: clusters })
    hasCriticalRef.current = clusters.some(f => {
      const props = f.properties as { cluster?: boolean; severity?: string }
      return !props.cluster && props.severity === 'critical'
    })
    // Signals in view: each cluster counts its members
    setVisibleCount(clusters.reduce((n, f) => {
      const props = f.properties as { cluster?: boolean; point_count?: number }
      return n + (props.cluster ? Number(props.point_count ?? 0) : 1)
    }, 0))
    // The "Latest in view" list: the newest signals inside the same box
    const [w, s, e, n] = bbox
    // (the same headline from two feeds of one outlet shows once)
    const seenTitles = new Set<string>()
    const visible = latestFirst(signalsRef.current.filter(sig => {
      const lat = Number(sig.lat), lng = Number(sig.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
      const inLng = w <= e ? lng >= w && lng <= e : lng >= w || lng <= e
      return lat >= s && lat <= n && inLng
    }), 200).filter(sig => {
      const t = String(sig.title ?? '').trim().toLowerCase()
      if (seenTitles.has(t)) return false
      seenTitles.add(t)
      return true
    }).slice(0, 60)
    const key = visible.map(v => v.id).join(',')
    if (key !== inViewKeyRef.current) {
      inViewKeyRef.current = key
      setInView(visible)
    }
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
    // Nothing left to do here: the count of signals in view comes from
    // refreshClusters (what is drawn), and the heatmap is a native layer (BAT-16)
  }, [])

  const refreshHeatmapAndCountRef = useRef(refreshHeatmapAndCount)
  useEffect(() => { refreshHeatmapAndCountRef.current = refreshHeatmapAndCount }, [refreshHeatmapAndCount])

  // Stable ref so WS closure always calls latest version
  const refreshHighlightsRef = useRef(refreshHighlights)
  useEffect(() => { refreshHighlightsRef.current = refreshHighlights }, [refreshHighlights])

  // ── Rebuild Supercluster when signals change ───────────────────────────────

  useEffect(() => {
    // While Replay runs it owns the map's points; closing it brings the live ones back
    if (timelineActive) return
    let cancelled = false
    ;(async () => {
      const { default: SuperclusterLib } = await import('supercluster')
      if (cancelled) return
      const features = toFeatures(signals)
      // Clusters remember their most severe signal (their colour) and how many are verified
      const sc: SCIndex = new SuperclusterLib<SignalProps, ClusterProps>({
        radius: 44,
        maxZoom: 22,
        map: props => ({
          sev:      SEVERITY_RANK[props.severity] ?? 1,
          verified: props.status === 'verified' ? 1 : 0,
        }),
        reduce: (acc, props) => {
          acc.sev = Math.max(acc.sev, props.sev)
          acc.verified += props.verified
        },
      })
      sc.load(features)
      scRef.current = sc
      refreshClusters()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mapRef.current as any)?.getSource?.('signals-raw')?.setData({ type: 'FeatureCollection', features })
    })()
    return () => { cancelled = true }
  }, [signals, refreshClusters, timelineActive])

  // Refresh heatmap / visible count whenever signals change
  useEffect(() => { refreshHeatmapAndCountRef.current() }, [signals])

  // Refresh visible count when heatmap is toggled on/off
  useEffect(() => { refreshHeatmapAndCountRef.current() }, [heatmapMode])

  // BAT-16: EnhancedHeatmap — show/hide when heatmap mode changes
  useEffect(() => {
    const hm = enhancedHeatmapRef.current
    if (!hm) return
    if (heatmapMode) {
      hm.show(category)
    } else {
      hm.hide()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapMode, mapReady])

  // BAT-16: cross-fade colour ramp when category filter changes
  useEffect(() => {
    if (heatmapMode) {
      enhancedHeatmapRef.current?.setCategory(category)
    }
  }, [category, heatmapMode])

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
      const hasLinkedView = !!(permalinkRef.current || searchParams.get('z'))

      // The dark vector basemap (OpenFreeMap, recoloured), or a plain fallback
      // when it doesn't load: then the night-lights imagery is shown instead
      const base = await loadBaseStyle()
      if (cancelled || !mapContainer.current) return
      if (!base.vector && basemapRef.current === 'dark') {
        basemapRef.current = 'night'
        setBasemap('night')
      }

      map = new ml.Map({
        container: mapContainer.current!,
        style: base.style,
        center: [lng, lat],
        zoom: hasLinkedView ? zoom : worldZoom(mapContainer.current.clientWidth, mapContainer.current.clientHeight, projectionRef.current),
        pitch:   0,
        bearing: 0,
        minZoom: 0.6,
        maxZoom: 20,
        attributionControl: { compact: true },
      })

      mapRef.current = map

      // Layer listeners: MapLibre's off(type, layerId) without the listener
      // removes nothing, so switching a layer off and on again stacked up
      // duplicate click and hover handlers (several pop-ups per click). Keep
      // track of them, and let off(type, layerId) remove them all.
      const layerListeners = new Map<string, Array<(...args: unknown[]) => void>>()
      const originalOn  = map.on.bind(map)
      const originalOff = map.off.bind(map)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on = (type: string, target: any, listener?: any) => {
        if (typeof target === 'string' && typeof listener === 'function') {
          const key = `${type}|${target}`
          layerListeners.set(key, [...(layerListeners.get(key) ?? []), listener])
        }
        return listener === undefined ? originalOn(type, target) : originalOn(type, target, listener)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off = (type: string, target: any, listener?: any) => {
        if (typeof target === 'string' && listener === undefined) {
          const key = `${type}|${target}`
          for (const fn of layerListeners.get(key) ?? []) originalOff(type, target, fn)
          layerListeners.delete(key)
          return map
        }
        return listener === undefined ? originalOff(type, target) : originalOff(type, target, listener)
      }

      // MapLibre v5 workaround: explicitly setting mercator projection right
      // after creation kicks the render pipeline out of a stuck state where
      // isStyleLoaded + areTilesLoaded are true but the 'load' event never
      // fires.  Without this, the map shows a black canvas indefinitely.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(map as any).setProjection({ type: 'mercator' })
      } catch { /* pre-v5 — ignore */ }

      // Zoom buttons and compass (styled dark in globals.css)
      map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right')

      ro = new ResizeObserver(() => { if (mapRef.current) mapRef.current.resize() })
      if (mapContainer.current) ro.observe(mapContainer.current)

      map.on('error', (e: unknown) => { console.error('[maplibre]', e) })

      map.on('load', () => {
        if (cancelled) return
        map.resize()

        // If the "Latest in view" list is already open, centre the map beside it
        if (listOpenRef.current && window.innerWidth >= 768) {
          try { map.setPadding({ left: 320, right: 0, top: 0, bottom: 0 }) } catch { /* older MapLibre */ }
        }

        // Basemap: night lights and satellite imagery sit under the borders and
        // labels; the chosen one is shown (lib/map-style.ts)
        baseIdsRef.current = baseLayerIds(base.style)
        try {
          addImageryLayers(map, MAPTILER_KEY)
          applyBasemap(map, basemapRef.current, baseIdsRef.current)
        } catch (e) { console.warn('[map] basemap setup failed:', e) }

        // While the globe spins by itself, moves don't rewrite the address bar
        const spinState = { on: false }

        // Switch to the globe after the first render: setting it earlier blocks
        // the MapLibre v5 render pipeline. The pulse animation keeps the map
        // busy, so 'idle' may never fire: a timer makes sure it happens.
        let projected = false
        const setInitialProjection = () => {
          if (cancelled || projected) return
          projected = true
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(map as any).setProjection({ type: projectionRef.current })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (projectionRef.current === 'globe') (map as any).setSky?.(ATMOSPHERE)
          } catch { /* pre-v5 fallback — ignore */ }
        }
        map.once('idle', setInitialProjection)
        setTimeout(setInitialProjection, 1200)

        // A slow spin of the whole-world globe until someone touches the map
        // (not on shared links, which open on a chosen place)
        if (!hasLinkedView && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          spinState.on = true
          const stopSpin = () => { spinState.on = false }
          map.once('mousedown', stopSpin)
          map.once('touchstart', stopSpin)
          map.once('wheel', stopSpin)
          map.once('dragstart', stopSpin)
          const spin = () => {
            if (cancelled || !spinState.on) return
            if (projectionRef.current === 'globe' && map.getZoom() < 3 && !map.isMoving()) {
              const c = map.getCenter()
              map.easeTo({ center: [c.lng - 4, c.lat], duration: 1000, easing: (t: number) => t })
            }
            setTimeout(spin, 1000)
          }
          setTimeout(spin, 2500)
        }

        // ── Sources ───────────────────────────────────────────

        map.addSource('signals', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        map.addSource('highlights', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        // Every signal, unclustered: the heatmap reads this (reading the
        // clustered source, it saw almost nothing when zoomed out)
        map.addSource('signals-raw', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: toFeatures(signalsRef.current) },
        })

        // ── Signal layers ─────────────────────────────────────
        // Clusters: a dark disc ringed in the colour of their most severe
        // signal, with a soft halo. Signals: a dot sized and coloured by
        // severity; verified ones get a white ring.

        map.addLayer({
          id: 'cluster-halo', type: 'circle', source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': CLUSTER_COLOR_EXPR,
            'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 17, 10, 23, 50, 31, 200, 40],
            'circle-opacity': 0.16,
            'circle-blur': 0.75,
          },
        })

        map.addLayer({
          id: 'clusters', type: 'circle', source: 'signals',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#0b1220',
            'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 11, 10, 14, 50, 19, 200, 25],
            'circle-opacity': 0.9,
            'circle-stroke-color': CLUSTER_COLOR_EXPR,
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 0.95,
          },
        })

        map.addLayer({
          id: 'cluster-count', type: 'symbol', source: 'signals',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font':  FONT_BOLD,
            'text-size':  ['interpolate', ['linear'], ['get', 'point_count'], 2, 10.5, 200, 13],
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#eef3fb' },
        })

        map.addLayer({
          id: 'critical-pulse', type: 'circle', source: 'signals',
          filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'severity'], 'critical']],
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': 10,
            'circle-stroke-color': SEV_COLOR.critical,
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.5,
          },
        })

        map.addLayer({
          id: 'signal-glow', type: 'circle', source: 'signals',
          filter: ['all', ['!', ['has', 'point_count']], ['in', ['get', 'severity'], ['literal', ['critical', 'high']]]],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 11, 6, 18, 12, 24],
            'circle-opacity': 0.28,
            'circle-blur': 1,
          },
        })

        map.addLayer({
          id: 'signal-points', type: 'circle', source: 'signals',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': SIGNAL_RADIUS_EXPR,
            'circle-opacity': ['match', ['get', 'severity'], 'low', 0.82, 'info', 0.7, 0.96],
            'circle-stroke-color': ['case', ['==', ['get', 'status'], 'verified'], '#ffffff', '#04060b'],
            'circle-stroke-width': ['case', ['==', ['get', 'status'], 'verified'], 1.6, 0.8],
            'circle-stroke-opacity': ['case', ['==', ['get', 'status'], 'verified'], 0.95, 0.85],
          },
        })

        // ── The signal under the pointer in the "Latest in view" list ───
        map.addSource('list-hover', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: 'list-hover-ring', type: 'circle', source: 'list-hover',
          paint: {
            'circle-color': 'rgba(255,255,255,0.08)',
            'circle-radius': 15,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 0.95,
          },
        })

        // ── New-signal highlight ring (gold, animated, 3 s) ───

        map.addLayer({
          id: 'new-highlight', type: 'circle', source: 'highlights',
          paint: {
            'circle-color':         'rgba(0,0,0,0)',
            'circle-radius':        18,
            'circle-stroke-color':  '#f5d020',
            'circle-stroke-width':  2,
            'circle-stroke-opacity': 0.9,
          },
        })

        // ── Animation loop ────────────────────────────────────

        // Critical signals send out a slow ripple; new arrivals get a pulsing gold ring
        // Redrawn about 15 times a second (not every frame): the motion looks the
        // same but the map repaints a quarter as often. With nothing to pulse it
        // only looks again once a second.
        let lastTickMs = 0
        const animatePulse = (now: number) => {
          if (!hasCriticalRef.current && newSignalIdsRef.current.size === 0) {
            animIdleTimerRef.current = setTimeout(() => {
              animFrameRef.current = requestAnimationFrame(animatePulse)
            }, 1000)
            return
          }
          animFrameRef.current = requestAnimationFrame(animatePulse)
          if (now - lastTickMs < 66) return
          lastTickMs = now
          const pulseT = (now % 4000) / 4000      // one ripple every 4 s
          const hlT    = (now / 1000) * 4.2       // gold ring breathes ~every 1.5 s
          const r  = 8 + pulseT * 18
          const o  = 0.65 * (1 - pulseT)
          const hr = 16 + Math.sin(hlT) * 5
          const ho = 0.65 + Math.sin(hlT) * 0.3
          try {
            map.setPaintProperty('critical-pulse', 'circle-radius',          r)
            map.setPaintProperty('critical-pulse', 'circle-stroke-opacity',  o)
            map.setPaintProperty('new-highlight',  'circle-radius',          hr)
            map.setPaintProperty('new-highlight',  'circle-stroke-opacity',  ho)
          } catch { /* layer removed */ }
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
          if (expansionZ > currentZ + 0.3) {
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
            const title = String(p.title ?? '')
            return `<a href="/signals/${encodeURIComponent(String(p.id))}" style="display:block;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.07);text-decoration:none;color:#e2e6f0;font:13px/1.4 system-ui" title="${escapeHtml(title)}">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;flex-shrink:0"></span>
              <span style="font-size:12px">${escapeHtml(title.length > 70 ? title.slice(0, 70) + '…' : title)}</span>
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
                ${escapeHtml(feat.properties.point_count)} SIGNALS · ${escapeHtml((leaves[0]?.properties as SignalProps)?.location_name ?? 'Same location')}
              </div>
              <div style="max-height:220px;overflow-y:auto">${listItems}${extra}</div>
            `)
            .addTo(map)
        })

        // ── Signal click: the side panel (bottom sheet on phones) ─────
        // One place for the details: it used to open a pop-up, the panel and an
        // annotation card for the same signal at once.

        let pinClicked = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', 'signal-points', (e: any) => {
          pinClicked = true
          const feat = e.features?.[0]
          const p = feat?.properties as SignalProps | undefined
          if (!p || !feat) return

          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }

          const coords = feat.geometry.coordinates as [number, number]
          const sig = signalsRef.current.find(s => s.id === p.id) ?? null
          setSelected(sig)
          setCountry(null)
          map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 5), speed: 1.2, duration: 700 })
        })

        // ── Background click: deselect, and open the brief of the country
        //    clicked (plan M9) when nothing else is under the cursor ─────

        // Layers that are scenery, not something to click
        // Shading and outlines over the land: a click through them still picks the country
        // (the day/night polygons cover the whole globe, so leaving them out blocked every brief)
        const SCENERY = /^(wp-imagery-|country-select-|country-risk-|enhanced-heatmap|list-hover|since-visit-|daynight-|country-links-)/
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pickCountry = async (e: any) => {
          const base = new Set(baseIdsRef.current ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const under = map.queryRenderedFeatures(e.point) as any[]
          if (under.some(f => !base.has(f.layer?.id) && !SCENERY.test(f.layer?.id ?? ''))) return
          const risk = under.find(f => f.layer?.id === 'country-risk-fill')?.properties
          try {
            const hit = await countryAt(e.lngLat.lng, e.lngLat.lat)
            setCountry(hit ? {
              ...hit,
              risk: risk?.wpHasData ? { score: Number(risk.wpRiskScore), label: String(risk.wpRiskLabel), trend: String(risk.wpTrend ?? '') } : null,
            } : null)
          } catch {
            // The outlines didn't load: no brief this time
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('click', (e: any) => {
          if (pinClicked) { pinClicked = false; return }
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          setSelected(null)
          void pickCountry(e)
        })

        // ── Viewport change: re-cluster + persist URL ─────────

        const onViewChange = () => {
          refreshClusters()
          refreshHeatmapAndCountRef.current()
          // The idle spin isn't the reader moving the map: leave the address alone
          if (spinState.on) return
          // BAT-16: track zoom for HotspotLabels threshold
          setMapZoom(parseFloat(map.getZoom().toFixed(1)))
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
            // Update the address without a Next.js navigation (M7), keeping the #share hash
            window.history.replaceState(window.history.state, '', url + window.location.hash)
          }, 500)
          // Also update the URL hash for permalink sharing (BAT-15)
          updateHash()
        }

        map.on('moveend', onViewChange)
        map.on('zoomend', onViewChange)

        // Re-project annotation card connector lines after map pans/zooms
        map.on('moveend', () => {
          setMapMoveCount(c => c + 1) // hotspot labels re-position on every move
        })

        // Seed from already-fetched signals (if any)
        refreshClusters()
        refreshHighlights()

        // BAT-16: Create EnhancedHeatmap instance — activates when heatmapMode is true
        enhancedHeatmapRef.current = new EnhancedHeatmap(map)
        if (hmRef.current) {
          enhancedHeatmapRef.current.show(catRef.current)
        }

        // Overlay layers that were switched on before the map loaded draw now
        setMapReady(true)
      })
    })()

    return () => {
      cancelled = true
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
      if (animIdleTimerRef.current) { clearTimeout(animIdleTimerRef.current); animIdleTimerRef.current = null }
      if (urlTimerRef.current)  { clearTimeout(urlTimerRef.current);           urlTimerRef.current  = null }
      if (ro) ro.disconnect()
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
      // BAT-16: cleanup EnhancedHeatmap RAF loop
      enhancedHeatmapRef.current?.destroy()
      enhancedHeatmapRef.current = null
      if (mapRef.current)   { mapRef.current.remove();   mapRef.current   = null }
      if (hashTimerRef.current) { clearTimeout(hashTimerRef.current); hashTimerRef.current = null }
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
        setGibsError(null)
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
        setGibsError('NASA GIBS imagery unavailable')
        setSatelliteMode(false)
      }
    }

    // Apply immediately if map is loaded, otherwise wait for the load event
    if (map.isStyleLoaded()) {
      applyLayer()
    } else {
      map.once('idle', applyLayer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satelliteMode, gibsDate, mapReady])

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
      setSatError(null)
      try {
        // CelesTrak GP JSON — TLE-less orbital elements for all active objects
        const res  = await fetch('https://celestrak.org/GP.php?GROUP=active&FORMAT=json')
        if (!res.ok) throw new Error(`CelesTrak returned ${res.status}`)
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
        setSatError('CelesTrak satellite data unavailable')
        setSatTrackingMode(false)
      } finally {
        setSatTrackingLoading(false)
      }
    }

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
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
        // Fetch recent military signals (all severities) and filter for carrier content
        const res  = await fetch(
          `${API_URL}/api/v1/signals?category=military&limit=100`,
        )
        if (!res.ok) { console.warn(`[map][carriers] HTTP ${res.status}`); return }
        const json = await res.json() as { success: boolean; data: {
          items: Array<{
            id:            string
            title:         string
            summary:       string | null
            location:      { lng: number; lat: number } | null
            locationName:  string | null
            severity:      string
            reliabilityScore: number
            createdAt:     string
          }>
          cursor: string | null
          hasMore: boolean
        } }

        const items = json.data?.items ?? []

        // Filter for carrier-related signals and those with positions
        const CARRIER_KEYWORDS = [
          'cvn-', 'carrier strike', 'uss gerald', 'uss george washington',
          'uss harry', 'uss theodore', 'uss abraham', 'uss carl vinson',
          'uss eisenhower', 'uss nimitz', 'uss stennis', 'uss ronald reagan',
          'uss george h', 'carrier group', 'strike group',
        ]

        const carrierSignals = items.filter(s => {
          const text = `${s.title} ${s.summary ?? ''}`.toLowerCase()
          return CARRIER_KEYWORDS.some(kw => text.includes(kw))
        })
        console.info(`[map][carriers] fetched=${items.length}, matched=${carrierSignals.length}`)

        // API returns location as { lng, lat } object from formatSignal
        const features = carrierSignals
          .filter(s => s.location != null && isFinite(s.location.lat) && isFinite(s.location.lng))
          .map(s => ({
            type:       'Feature' as const,
            geometry:   { type: 'Point' as const, coordinates: [s.location!.lng, s.location!.lat] },
            properties: {
              id:           s.id,
              title:        s.title,
              locationName: s.locationName ?? 'Unknown position',
              reliability:  s.reliabilityScore,
              createdAt:    s.createdAt,
            },
          }))

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
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:220px;margin-bottom:6px">${escapeHtml(p.title)}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:4px">📍 ${escapeHtml(p.locationName)}</div>
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

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrierMode, mapReady])

  // ── ADS-B Live Aircraft layer ──────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const ADSB_SOURCE = 'adsb-aircraft'
    const ADSB_LAYER  = 'adsb-aircraft-symbols'

    const removeLayer = () => {
      try {
        map.off('click',      ADSB_LAYER)
        map.off('mouseenter', ADSB_LAYER)
        map.off('mouseleave', ADSB_LAYER)
        if (map.getLayer(ADSB_LAYER))   map.removeLayer(ADSB_LAYER)
        if (map.getSource(ADSB_SOURCE)) map.removeSource(ADSB_SOURCE)
      } catch { /* ignore */ }
    }

    let intervalId: ReturnType<typeof setInterval> | null = null

    const fetchAndUpdate = async () => {
      try {
        const res  = await fetch(`${API_URL}/api/v1/signals/map/adsb`)
        if (!res.ok) { console.warn(`[map][adsb] HTTP ${res.status}`); return }
        const json = await res.json() as { success: boolean; data: AdsbSignal[] }
        if (!json.success || !Array.isArray(json.data)) return

        setAdsbSignals(json.data)

        const features = json.data
          .filter(a => isFinite(a.lat) && isFinite(a.lng))
          .map(a => ({
            type:       'Feature' as const,
            geometry:   { type: 'Point' as const, coordinates: [a.lng, a.lat] },
            properties: {
              id:           a.id,
              title:        a.title,
              published_at: a.published_at ?? '',
            },
          }))

        const currentMap = mapRef.current
        // (loaded() stays false while tiles load, e.g. as the globe turns)
        if (!currentMap || !currentMap.isStyleLoaded()) return
        await ensureMapIcon(currentMap, MAP_ICON.plane)

        if (!currentMap.getSource(ADSB_SOURCE)) {
          currentMap.addSource(ADSB_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(currentMap.getSource(ADSB_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        if (!currentMap.getLayer(ADSB_LAYER)) {
          currentMap.addLayer({
            id:     ADSB_LAYER,
            type:   'symbol',
            source: ADSB_SOURCE,
            // An icon: the map font has no ✈ (it drew nothing)
            layout: {
              'icon-image':            MAP_ICON.plane.id,
              'icon-size':             ['interpolate', ['linear'], ['zoom'], 2, 0.75, 8, 1],
              'icon-allow-overlap':    true,
              'icon-ignore-placement': true,
            },
          })

          currentMap.on('mouseenter', ADSB_LAYER, () => { currentMap.getCanvas().style.cursor = 'pointer' })
          currentMap.on('mouseleave', ADSB_LAYER, () => { currentMap.getCanvas().style.cursor = '' })

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          currentMap.on('click', ADSB_LAYER, async (e: any) => {
            const feat = e.features?.[0]
            if (!feat) return
            const p = feat.properties as { title: string; published_at: string }
            const ts = p.published_at ? timeAgo(p.published_at) : 'unknown'
            const { default: ml } = await import('maplibre-gl')
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
            popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 14, className: 'wp-map-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font:600 12px/1.4 system-ui;color:#00d4ff;margin-bottom:4px">✈ ADS-B AIRCRAFT</div>
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${escapeHtml(p.title)}</div>
                <div style="font:10px monospace;color:#5a6477">${escapeHtml(ts)}</div>
              `)
              .addTo(currentMap)
          })
        }
      } catch (err) {
        console.warn('[map] ADS-B layer error:', err)
      }
    }

    const applyLayer = () => {
      if (!showAircraft) {
        removeLayer()
        setAdsbSignals([])
        return
      }

      if (map.isStyleLoaded()) {
        void fetchAndUpdate()
      } else {
        map.once('idle', () => { void fetchAndUpdate() })
      }

      intervalId = setInterval(() => { void fetchAndUpdate() }, 60_000)
    }

    applyLayer()

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAircraft, mapReady])

  // ── Live Webcam / IP Camera map layer ─────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const CAM_SOURCE = 'cameras-layer'
    const CAM_LAYER  = 'cameras-symbols'

    const removeLayer = () => {
      try {
        map.off('click',      CAM_LAYER)
        map.off('mouseenter', CAM_LAYER)
        map.off('mouseleave', CAM_LAYER)
        if (map.getLayer(CAM_LAYER))   map.removeLayer(CAM_LAYER)
        if (map.getSource(CAM_SOURCE)) map.removeSource(CAM_SOURCE)
      } catch { /* ignore */ }
    }

    let intervalId: ReturnType<typeof setInterval> | null = null

    const TYPE_COLOR: Record<string, string> = {
      traffic: '#f59e0b',
      weather: '#60a5fa',
      city:    '#a78bfa',
      nature:  '#34d399',
    }

    const fetchAndUpdate = async () => {
      try {
        const res  = await fetch(`${API_URL}/api/v1/cameras?region=global&limit=50`)
        if (!res.ok) { console.warn(`[map][cameras] HTTP ${res.status}`); return }
        const json = await res.json() as { cameras: CameraFeed[]; total: number }
        if (!Array.isArray(json.cameras)) return

        setCameraCount(json.cameras.length)

        const features = json.cameras
          .filter(c => isFinite(c.lat) && isFinite(c.lng))
          .map(c => ({
            type:       'Feature' as const,
            geometry:   { type: 'Point' as const, coordinates: [c.lng, c.lat] },
            properties: {
              id:          c.id,
              name:        c.name,
              country:     c.country,
              countryCode: c.countryCode,
              embedUrl:    c.embedUrl,
              type:        c.type,
              isLive:      c.isLive,
              color:       TYPE_COLOR[c.type] ?? '#34d399',
            },
          }))

        const currentMap = mapRef.current
        if (!currentMap || !currentMap.isStyleLoaded()) return
        await ensureMapIcon(currentMap, MAP_ICON.camera)

        if (!currentMap.getSource(CAM_SOURCE)) {
          currentMap.addSource(CAM_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(currentMap.getSource(CAM_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        if (!currentMap.getLayer(CAM_LAYER)) {
          currentMap.addLayer({
            id:     CAM_LAYER,
            type:   'symbol',
            source: CAM_SOURCE,
            // An icon: the map font has no 📹 (it drew nothing)
            layout: {
              'icon-image':            MAP_ICON.camera.id,
              'icon-size':             ['interpolate', ['linear'], ['zoom'], 2, 0.75, 8, 1],
              'icon-allow-overlap':    true,
              'icon-ignore-placement': true,
            },
          })

          currentMap.on('mouseenter', CAM_LAYER, () => { currentMap.getCanvas().style.cursor = 'pointer' })
          currentMap.on('mouseleave', CAM_LAYER, () => { currentMap.getCanvas().style.cursor = '' })

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          currentMap.on('click', CAM_LAYER, async (e: any) => {
            const feat = e.features?.[0]
            if (!feat) return
            const p = feat.properties as {
              name: string; country: string; countryCode: string
              embedUrl: string; type: string; isLive: boolean
            }
            const typeLabel = p.type ? String(p.type).toUpperCase() : 'WEBCAM'
            const liveTag   = p.isLive ? '<span style="color:#34d399;font-size:9px;font-weight:700;letter-spacing:0.05em">● LIVE</span>' : ''
            const feedUrl   = safeHttpUrl(p.embedUrl)
            const { default: ml } = await import('maplibre-gl')
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
            popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 14, className: 'wp-map-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font:600 11px/1.4 system-ui;color:#34d399;margin-bottom:4px;display:flex;align-items:center;gap:6px">
                  📹 LIVE WEBCAM ${liveTag}
                </div>
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:4px">${escapeHtml(p.name)}</div>
                <div style="font:11px system-ui;color:#9aa5b4;margin-bottom:6px">${escapeHtml(p.country)} · ${escapeHtml(typeLabel)}</div>
                ${feedUrl ? `<a href="${escapeHtml(feedUrl)}" target="_blank" rel="noopener noreferrer"
                   style="display:inline-block;font:11px system-ui;color:#34d399;text-decoration:underline">
                  ↗ Open feed
                </a>` : ''}
              `)
              .addTo(currentMap)
          })
        }
      } catch (err) {
        console.warn('[map] Live webcam layer error:', err)
      }
    }

    const applyLayer = () => {
      if (!showCameras) {
        removeLayer()
        setCameraCount(0)
        return
      }

      if (map.isStyleLoaded()) {
        void fetchAndUpdate()
      } else {
        map.once('idle', () => { void fetchAndUpdate() })
      }

      intervalId = setInterval(() => { void fetchAndUpdate() }, 90_000)
    }

    applyLayer()

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCameras, mapReady])

  // ── Maritime AIS ship tracking layer (civilian vessels, GeoJSON, clustered) ────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const MARITIME_SOURCE        = 'maritime-layer'
    const MARITIME_CLUSTERS      = 'maritime-clusters'
    const MARITIME_CLUSTER_COUNT = 'maritime-cluster-count'
    const MARITIME_SHIPS         = 'maritime-ships'
    let intervalId: ReturnType<typeof setInterval> | null = null

    const removeLayer = () => {
      try {
        map.off('click',      MARITIME_SHIPS)
        map.off('mouseenter', MARITIME_SHIPS)
        map.off('mouseleave', MARITIME_SHIPS)
        for (const layer of [MARITIME_SHIPS, MARITIME_CLUSTER_COUNT, MARITIME_CLUSTERS]) {
          if (map.getLayer(layer)) map.removeLayer(layer)
        }
        if (map.getSource(MARITIME_SOURCE)) map.removeSource(MARITIME_SOURCE)
      } catch { /* ignore cleanup errors */ }
    }

    const fetchAndUpdate = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/signals/map/maritime`)
        if (!res.ok) return
        const geojson = await res.json() as { type: string; features: Array<{ properties: { title?: string } }> }
        setShipCount(geojson.features?.length ?? 0)

        const src = map.getSource(MARITIME_SOURCE)
        if (src) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(src as any).setData(geojson)
        } else {
          map.addSource(MARITIME_SOURCE, {
            type:           'geojson',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data:           geojson as any,
            cluster:        true,
            clusterMaxZoom: 12,
            clusterRadius:  40,
          })

          // Cluster circles — amber
          map.addLayer({
            id:     MARITIME_CLUSTERS,
            type:   'circle',
            source: MARITIME_SOURCE,
            filter: ['has', 'point_count'],
            paint:  {
              'circle-color':   ['step', ['get', 'point_count'], '#f59e0b', 10, '#d97706', 50, '#b45309'],
              'circle-radius':  ['step', ['get', 'point_count'], 14, 10, 18, 50, 22],
              'circle-opacity': 0.82,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': 'rgba(245,158,11,0.45)',
            },
          })

          // Cluster count labels
          map.addLayer({
            id:     MARITIME_CLUSTER_COUNT,
            type:   'symbol',
            source: MARITIME_SOURCE,
            filter: ['has', 'point_count'],
            layout: {
              'text-field':  '{point_count_abbreviated}',
              'text-font':   FONT_BOLD,
              'text-size':   11,
            },
            paint: { 'text-color': '#fff' },
          })

          // Individual ships: an icon (the map font has no ⚓, so it drew nothing)
          await ensureMapIcon(map, MAP_ICON.ship)
          map.addLayer({
            id:     MARITIME_SHIPS,
            type:   'symbol',
            source: MARITIME_SOURCE,
            filter: ['!', ['has', 'point_count']],
            layout: {
              'icon-image':            MAP_ICON.ship.id,
              'icon-size':             ['interpolate', ['linear'], ['zoom'], 2, 0.75, 8, 1],
              'icon-allow-overlap':    false,
              'icon-ignore-placement': false,
            },
          })

          // Hover popup (maplibre-gl is loaded on demand: there is no global to use)
          const { default: ml } = await import('maplibre-gl')
          const popup = new ml.Popup({
            closeButton:  false,
            closeOnClick: false,
            offset:       [0, -10],
            className:    'wp-map-popup',
          })

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map.on('mouseenter', MARITIME_SHIPS, (e: any) => {
            map.getCanvas().style.cursor = 'pointer'
            const feature = e.features?.[0]
            if (!feature || feature.geometry.type !== 'Point') return
            const coords = feature.geometry.coordinates as [number, number]
            const props  = feature.properties as { title?: string; severity?: string; published_at?: string }
            popup
              .setLngLat(coords)
              .setHTML(
                `<div style="font:600 12px/1.4 system-ui;color:#f59e0b;margin-bottom:3px">⚓ VESSEL</div>` +
                `<div style="font:400 11px/1.4 system-ui;color:#e2e8f0;max-width:200px">${escapeHtml(props.title ?? 'Unknown vessel')}</div>` +
                (props.severity ? `<div style="font:500 10px/1.4 system-ui;color:#94a3b8;margin-top:3px">Severity: ${escapeHtml(props.severity)}</div>` : '')
              )
              .addTo(map)
          })

          map.on('mouseleave', MARITIME_SHIPS, () => {
            map.getCanvas().style.cursor = ''
            popup.remove()
          })
        }
      } catch (err) {
        console.warn('[map] Maritime layer error:', err)
      }
    }

    const applyLayer = () => {
      if (!showShips) {
        removeLayer()
        setShipCount(0)
        return
      }

      if (map.isStyleLoaded()) {
        void fetchAndUpdate()
      } else {
        map.once('idle', () => { void fetchAndUpdate() })
      }

      intervalId = setInterval(() => { void fetchAndUpdate() }, 120_000)
    }

    applyLayer()

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showShips, mapReady])

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
        if (!res.ok) { console.warn(`[map][naval] HTTP ${res.status}`); return }
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

        console.info(`[map][naval] response: success=${json.success}, count=${json.data?.length ?? 0}`)
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
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${escapeHtml(p.title)}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">🚢 Fleet: ${escapeHtml(p.fleet)}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">📍 ${escapeHtml(p.statusText)}</div>
                <div style="font:10px monospace;color:#5a6477">${escapeHtml(new Date(p.createdAt).toLocaleString())}</div>
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
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${escapeHtml(p.title)}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">📍 ${escapeHtml(p.statusText)}</div>
                <div style="font:11px monospace;color:#f87171;margin-bottom:3px">Severity: ${escapeHtml(p.severity)}</div>
                <div style="font:10px monospace;color:#5a6477">${escapeHtml(new Date(p.createdAt).toLocaleString())}</div>
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
                <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${escapeHtml(p.title)}</div>
                <div style="font:11px monospace;color:#8892a4;margin-bottom:3px">📍 ${escapeHtml(p.statusText)}</div>
                <div style="font:10px monospace;color:#5a6477">${escapeHtml(new Date(p.createdAt).toLocaleString())}</div>
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

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
    }

    // Auto-refresh every 10 minutes when navalMode is active
    if (navalMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 10 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navalMode, mapReady])

  // ── Conflict Zone Overlay (BAT-17) ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let refreshTimer: ReturnType<typeof setInterval> | null = null

    const applyLayer = async (): Promise<void> => {
      if (!conflictMode) {
        conflictLayerRef.current?.hide()
        conflictRegionRef.current?.removeFromMap()
        return
      }

      setConflictLoading(true)
      try {
        const [{ ConflictZoneOverlay }, res] = await Promise.all([
          import('@/components/map/ConflictZoneOverlay'),
          fetch(`${API_URL}/api/v1/signals/map/conflict-zones`),
        ])

        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const geojson = await res.json() as { type: string; features: unknown[] }
        console.info(`[map][conflict] response: features=${geojson.features?.length ?? 0}`)

        // Init overlay
        if (!conflictLayerRef.current) {
          conflictLayerRef.current = new ConflictZoneOverlay(map)
        }
        conflictLayerRef.current.show(geojson as Parameters<typeof conflictLayerRef.current.show>[0])
        setConflictCount(geojson.features.length)

        // The fixed conflict-region boxes (ConflictRegions.ts) are no longer
        // drawn: 20 hand-drawn rectangles that always reported 0 signals, and
        // looked like warped sheets on the globe. The signals above are real.
      } catch (err) {
        console.error('[ConflictZone] fetch error', err)
      } finally {
        setConflictLoading(false)
      }
    }

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
    }

    // Auto-refresh every 3 minutes when active
    if (conflictMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 3 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictMode, mapReady])

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
        const res  = await fetch(`${API_URL}/api/v1/threats/missiles`, { headers: signedInHeaders() })
        setSignInNeeded(n => ({ ...n, threats: res.status === 401 }))
        if (!res.ok) { console.warn(`[map][threats] HTTP ${res.status}`); return }
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

        console.info(`[map][threats] response: success=${json.success}, count=${json.data?.length ?? 0}`)
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
            ? `<div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Origin: ${escapeHtml(props.origin_country)}</div>`
            : ''
          const { default: ml } = await import('maplibre-gl')
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font:600 12px/1.4 system-ui;color:${color};margin-bottom:4px">${label}</div>
              <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:240px;margin-bottom:6px">${escapeHtml(props.title)}</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Severity: ${escapeHtml(props.severity)}</div>
              ${origin}
              <div style="font:10px monospace;color:#5a6477">${escapeHtml(ts)}</div>
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

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
    }

    // Auto-refresh every 5 minutes when threatMode is active (more volatile than naval)
    if (threatMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 5 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threatMode, mapReady])

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
        const res  = await fetch(`${API_URL}/api/v1/jamming/zones`, { headers: signedInHeaders() })
        setSignInNeeded(n => ({ ...n, jamming: res.status === 401 }))
        if (!res.ok) { console.warn(`[map][jamming] HTTP ${res.status}`); return }
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

        console.info(`[map][jamming] response: success=${json.success}, count=${json.data?.length ?? 0}`)
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
              <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:260px;margin-bottom:6px">${escapeHtml(p.title)}</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Severity: ${escapeHtml(p.severity)} — Confidence: ${escapeHtml(p.confidence)}%</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:2px">Affected radius: ~${escapeHtml(p.radiusKm)} km</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:4px;max-width:260px">Systems: ${escapeHtml(p.affectedSystems)}</div>
              <div style="font:10px monospace;color:#5a6477;margin-bottom:2px">Detected: ${escapeHtml(ts)}</div>
              <div style="font:10px monospace;color:#5a6477">${escapeHtml(p.source)}</div>
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

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
    }

    // Auto-refresh every 5 minutes when jammingMode is active
    if (jammingMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 5 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jammingMode, mapReady])

  // ── Natural Hazards layer (seismic, volcano, tsunami, wildfire) ────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const HAZARDS_SOURCE = 'hazards-source'
    const HAZARDS_LAYER  = 'hazards-circles'

    let refreshTimer: ReturnType<typeof setInterval> | null = null

    const removeHazardsLayers = () => {
      try {
        map.off('click',      HAZARDS_LAYER)
        map.off('mouseenter', HAZARDS_LAYER)
        map.off('mouseleave', HAZARDS_LAYER)
        if (map.getLayer(HAZARDS_LAYER)) map.removeLayer(HAZARDS_LAYER)
        if (map.getSource(HAZARDS_SOURCE)) map.removeSource(HAZARDS_SOURCE)
      } catch { /* ignore */ }
    }

    async function applyLayer() {
      if (!hazardsMode) {
        removeHazardsLayers()
        setHazardsCount(0)
        return
      }

      setHazardsLoading(true)
      try {
        const res  = await fetch(`${API_URL}/api/v1/hazards/map/points?hours=48`)
        if (!res.ok) { console.warn(`[map][hazards] HTTP ${res.status}`); return }
        const json = await res.json() as {
          success: boolean
          data: {
            points: HazardPoint[]
            count: number
          }
        }

        console.info(`[map][hazards] response: success=${json.success}, count=${json.data?.points?.length ?? 0}`)
        if (!json.success || !Array.isArray(json.data.points)) return

        setHazardsCount(json.data.points.length)

        const features = json.data.points.map(h => {
          // Color by hazard type
          let color = '#6B7280' // default gray
          let typeLabel = 'Hazard'
          switch (h.source_slug) {
            case 'seismic':
              color = '#F59E0B' // amber
              typeLabel = 'Earthquake'
              break
            case 'firms':
              color = '#EF4444' // red
              typeLabel = 'Wildfire'
              break
            case 'gvp-volcano':
              color = '#7C3AED' // purple
              typeLabel = 'Volcano'
              break
            case 'tsunami-warnings':
              color = '#0EA5E9' // cyan
              typeLabel = 'Tsunami'
              break
            case 'storm':
              color = '#3B82F6' // blue
              typeLabel = 'Storm'
              break
            case 'flood':
              color = '#06B6D4' // teal
              typeLabel = 'Flood'
              break
            case 'tornado':
              color = '#EC4899' // pink
              typeLabel = 'Tornado'
              break
            case 'weather':
              color = '#8B5CF6' // violet
              typeLabel = 'Weather'
              break
          }

          // Radius by severity
          let radius = 8 // medium
          switch (h.severity) {
            case 'critical': radius = 14; break
            case 'high':     radius = 10; break
            case 'medium':   radius = 8;  break
            case 'low':      radius = 6;  break
          }

          return {
            type:     'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] },
            properties: {
              id:                h.id,
              title:             h.title,
              sourceSlug:        h.source_slug,
              severity:          h.severity,
              reliability_score: h.reliability_score,
              published_at:      h.published_at,
              color,
              typeLabel,
              radius,
            },
          }
        })

        if (!map.getSource(HAZARDS_SOURCE)) {
          map.addSource(HAZARDS_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          })
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(HAZARDS_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        }

        // ── Popup builder ─────────────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeHazardsPopup = async (e: any) => {
          const feat = e.features?.[0]
          if (!feat) return
          const p = feat.properties as {
            title: string
            typeLabel: string
            severity: string
            published_at: string
            reliability_score: number
            color: string
          }
          const ago = timeAgo(p.published_at)
          const { default: ml } = await import('maplibre-gl')
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
          popupRef.current = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: 'wp-map-popup' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font:600 12px/1.4 system-ui;color:${safeCssColor(p.color)};margin-bottom:4px">${escapeHtml(p.typeLabel)}</div>
              <div style="font:600 13px/1.5 system-ui;color:#e2e6f0;max-width:260px;margin-bottom:6px">${escapeHtml(p.title)}</div>
              <div style="font:11px monospace;color:#8892a4;margin-bottom:4px">Severity: ${escapeHtml(p.severity)} — Confidence: ${Math.round(p.reliability_score * 100)}%</div>
              <div style="font:10px monospace;color:#5a6477">${escapeHtml(ago)}</div>
            `)
            .addTo(map)
        }

        const hookHazardsLayer = () => {
          map.on('mouseenter', HAZARDS_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', HAZARDS_LAYER, () => { map.getCanvas().style.cursor = '' })
          map.on('click', HAZARDS_LAYER, makeHazardsPopup)
        }

        // ── Hazard circles layer ──────────────────────────────────────────────
        if (!map.getLayer(HAZARDS_LAYER)) {
          map.addLayer({
            id:     HAZARDS_LAYER,
            type:   'circle',
            source: HAZARDS_SOURCE,
            paint:  {
              'circle-color':        ['get', 'color'],
              'circle-radius':       ['get', 'radius'],
              'circle-opacity':      0.85,
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.5,
            },
          })
          hookHazardsLayer()
        }

      } catch (err) {
        console.warn('[map] Natural Hazards layer error:', err)
      } finally {
        setHazardsLoading(false)
      }
    }

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
    }

    // Auto-refresh every 10 minutes when hazardsMode is active
    if (hazardsMode) {
      refreshTimer = setInterval(() => { void applyLayer() }, 10 * 60_000)
    }

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazardsMode, mapReady])

  // ── Day and night (M18): the night side shaded, redrawn every 5 minutes ─────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const SRC = 'daynight'
    const LAYERS = ['daynight-day', 'daynight-shade', 'daynight-edge']
    const draw = () => {
      if (document.visibilityState === 'hidden') return
      const now = new Date()
      const data = dayNightFeatures(now)
      // The soft edge sits on the day side of the line: right of it (going east)
      // when the north pole is dark, left of it when the south pole is
      const daySide = subsolarPoint(now).lat < 0 ? 1 : -1
      try {
        if (!map.getSource(SRC)) {
          map.addSource(SRC, { type: 'geojson', data })
          // Over the land and sea, under the map's labels and every signal layer
          const layers: Array<{ id: string; type: string }> = map.getStyle()?.layers ?? []
          const before = layers.find(l => l.type === 'symbol')?.id ?? (map.getLayer('cluster-halo') ? 'cluster-halo' : undefined)
          // A touch of daylight on the sunlit side, the night side darker (the
          // dark basemap alone left too little to darken)
          map.addLayer({ id: 'daynight-day', type: 'fill', source: SRC, filter: ['==', ['get', 'part'], 'day'],
            paint: { 'fill-color': '#9db8e8', 'fill-opacity': 0.07, 'fill-antialias': false } }, before)
          map.addLayer({ id: 'daynight-shade', type: 'fill', source: SRC, filter: ['==', ['get', 'part'], 'night'],
            paint: { 'fill-color': '#000208', 'fill-opacity': 0.45, 'fill-antialias': false } }, before)
          map.addLayer({ id: 'daynight-edge', type: 'line', source: SRC, filter: ['==', ['get', 'part'], 'edge'],
            layout: { 'line-join': 'round' },
            paint: {
              'line-color': '#000208', 'line-opacity': 0.4,
              'line-width': ['interpolate', ['linear'], ['zoom'], 0, 28, 4, 44],
              'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 28, 4, 44],
              'line-offset': ['interpolate', ['linear'], ['zoom'], 0, 14 * daySide, 4, 22 * daySide],
            } }, before)
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(SRC) as any).setData(data)
          map.setPaintProperty('daynight-edge', 'line-offset', ['interpolate', ['linear'], ['zoom'], 0, 14 * daySide, 4, 22 * daySide])
        }
      } catch { /* the style is reloading; the next redraw adds it */ }
    }
    if (dayNight) draw()
    for (const id of LAYERS) {
      try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', dayNight ? 'visible' : 'none') } catch { /* gone */ }
    }
    if (!dayNight) return
    const timer = setInterval(draw, 5 * 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') draw() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [dayNight, mapReady])

  // Region shortcuts (M18): close the menu on Escape or a click elsewhere
  useEffect(() => {
    if (!regionsOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRegionsOpen(false) }
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-regions]')) setRegionsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [regionsOpen])

  const flyToRegion = (bounds: [[number, number], [number, number]]) => {
    const map = mapRef.current
    if (!map) return
    setRegionsOpen(false)
    const desktop = typeof window !== 'undefined' && window.innerWidth >= 768
    map.fitBounds(bounds, {
      // Clear of the "Latest in view" list (320 px) when it's open beside the map
      padding: desktop ? { top: 70, bottom: 70, left: listOpen ? 360 : 70, right: 70 } : { top: 110, bottom: 140, left: 20, right: 20 },
      duration: 1200,
    })
  }

  // ── Country brief: outline the chosen country (plan M9) ─────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const SRC = 'country-select'
    const data = { type: 'FeatureCollection', features: country ? [country.feature] : [] }
    try {
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'geojson', data })
        // Under the signal clusters and pins
        const before = map.getLayer('cluster-halo') ? 'cluster-halo' : undefined
        map.addLayer({ id: 'country-select-fill', type: 'fill', source: SRC,
          paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.07 } }, before)
        map.addLayer({ id: 'country-select-glow', type: 'line', source: SRC,
          paint: { 'line-color': '#f5a623', 'line-width': 6, 'line-opacity': 0.22, 'line-blur': 4 } }, before)
        map.addLayer({ id: 'country-select-line', type: 'line', source: SRC,
          paint: { 'line-color': '#f5a623', 'line-width': 1.4, 'line-opacity': 0.9 } }, before)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(map.getSource(SRC) as any).setData(data)
      }
    } catch { /* the style is reloading; the next change draws it */ }
  }, [country, mapReady])

  // Escape closes the country brief (the signal panel first, if it's open)
  useEffect(() => {
    if (!country) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) setSelected(null)
      else setCountry(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [country, selected])

  // ── Since you last looked (plan M8): what came in since this reader's last visit
  const since = useMemo(() => {
    const hours = TRANGE.find(t => t.v === timeRange)?.hours ?? null
    const now = Date.now()
    return sinceLastVisit(signals, lastVisit, hours !== null ? now - hours * 3_600_000 : null, now)
  }, [signals, lastVisit, timeRange])
  const freshIds = useMemo(() => new Set(since?.fresh.map(s => s.id) ?? []), [since])
  // The ones worth a ring: new critical, high or verified signals (hundreds of
  // rings would say nothing); all of them when there are only a few
  const ringed = useMemo(() => {
    const fresh = since?.fresh ?? []
    const key = fresh.filter(s => s.severity === 'critical' || s.severity === 'high' || s.status === 'verified')
    return key.length > 0 ? key : fresh.length <= 100 ? fresh : []
  }, [since])

  // Ring the new ones on the map while "Show" is on
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const SRC = 'since-visit'
    const fresh = sinceShown && !sinceDismissed ? ringed : []
    const data = {
      type: 'FeatureCollection',
      features: fresh
        .filter(s => s.lat != null && s.lng != null)
        .map(s => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(s.lng), Number(s.lat)] }, properties: { id: s.id } })),
    }
    try {
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'geojson', data })
        const before = map.getLayer('cluster-halo') ? 'cluster-halo' : undefined
        map.addLayer({ id: 'since-visit-glow', type: 'circle', source: SRC,
          paint: { 'circle-radius': 14, 'circle-color': '#e0f2fe', 'circle-opacity': 0.12, 'circle-blur': 0.8 } }, before)
        map.addLayer({ id: 'since-visit-ring', type: 'circle', source: SRC,
          paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e0f2fe', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.9 } }, before)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(map.getSource(SRC) as any).setData(data)
      }
    } catch { /* the style is reloading */ }
  }, [ringed, sinceShown, sinceDismissed, mapReady])

  const countrySignals = useMemo(
    () => country ? signalsInCountry(signals, country.code, country.feature) : [],
    [country, signals],
  )
  const brief = useMemo(() => countryBrief(countrySignals), [countrySignals])
  const zoomToCountry = () => {
    const map = mapRef.current
    if (!map || !country) return
    const [w, s, e, n] = focusBboxOf(country.feature)
    const desktop = typeof window !== 'undefined' && window.innerWidth >= 768
    map.fitBounds([[w, s], [e, n]], {
      padding: desktop ? { top: 60, bottom: 60, left: 60, right: 400 } : { top: 40, bottom: Math.round(window.innerHeight * 0.5), left: 30, right: 30 },
      maxZoom: 6, duration: 1000,
    })
  }

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
        // Natural Earth 110m admin-0 outlines (~600 KB), shared with the country brief
        const [riskRes, shapes] = await Promise.all([
          fetch(`${API_URL}/api/v1/countries?window=24h&limit=200`),
          loadCountryShapes().catch(() => null),
        ])

        if (!riskRes.ok || !shapes) {
          console.warn('[map] Country risk fetch failed', riskRes.status, shapes ? 'outlines ok' : 'outlines failed')
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
        const geoJson = shapes as unknown as { type: string; features: any[] }

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

          // A click on a country opens its brief (with this layer's risk score);
          // see the background click handler. This layer has no pop-up of its own.
        }
      } catch (e) {
        console.warn('[map] Country risk choropleth error:', e)
      } finally {
        setCountryRiskLoading(false)
      }
    }

    if (map.isStyleLoaded()) {
      void applyLayer()
    } else {
      map.once('idle', () => { void applyLayer() })
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
  }, [countryRiskMode, mapReady])

  // ── Wind Particle Flow layer (WebGL custom layer, BAT-13) ────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const WIND_LAYER_ID = 'wind-particles'

    async function applyWindLayer() {
      if (!windMode) {
        // Remove layer
        try {
          if (map.getLayer(WIND_LAYER_ID)) map.removeLayer(WIND_LAYER_ID)
        } catch { /* ignore */ }
        windLayerRef.current = null
        return
      }

      setWindLoading(true)
      try {
        // Dynamic import to avoid loading WebGL code until needed
        const { WindParticleLayer, detectOptimalDensity } = await import('@/components/map/WindParticleLayer')

        // Auto-detect optimal density on first use
        const detectedDensity = detectOptimalDensity()
        setWindDensity(detectedDensity)

        const layer = new WindParticleLayer({
          density: detectedDensity,
          speedFactor: 0.25,
          opacity: 0.97,
          apiUrl: API_URL,
        })

        windLayerRef.current = layer

        // Remove existing if somehow already present
        if (map.getLayer(WIND_LAYER_ID)) map.removeLayer(WIND_LAYER_ID)

        // Add as custom layer (above basemap, below signal pins)
        const beforeLayer = map.getLayer('cluster-halo') ? 'cluster-halo' : undefined
        map.addLayer(layer as unknown as maplibregl.LayerSpecification, beforeLayer)
      } catch (err) {
        console.error('[map] Wind particle layer error:', err)
      } finally {
        setWindLoading(false)
      }
    }

    applyWindLayer()

    return () => {
      try {
        if (map.getLayer(WIND_LAYER_ID)) map.removeLayer(WIND_LAYER_ID)
      } catch { /* ignore */ }
      windLayerRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windMode])

  // Wind density change handler
  useEffect(() => {
    if (windLayerRef.current) {
      windLayerRef.current.setDensity(windDensity)
    }
  }, [windDensity])

  // ── Timeline Playback data fetch + map integration (BAT-14) ─────────────────
  useEffect(() => {
    if (!timelineActive) return
    timeline.fetchTimeline(timelineRange, category, severity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineActive, timelineRange, category, severity])

  // When timeline is active and has visible signals, update the map source
  useEffect(() => {
    if (!timelineActive || !timeline.data) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    if (!map) return

    // Convert timeline visible signals to MapSignal format and update clusters
    const timelineSignals: MapSignal[] = timeline.visibleSignals.map(s => ({
      id: s.id,
      title: s.title,
      summary: null,
      lat: s.lat,
      lng: s.lng,
      severity: s.severity,
      category: s.category,
      status: '', // unknown here: don't draw a verified ring
      location_name: null,
      country_code: null,
      reliability_score: 0.7,
      created_at: timeline.currentTime ?? new Date().toISOString(),
      original_urls: null,
      is_breaking: s.is_breaking,
    }))

    // Load the replayed signals into the cluster index and redraw (the old code
    // wrote to a 'signals-cluster' source that doesn't exist, so nothing moved)
    const Sc = scRef.current
    if (Sc) {
      const features = toFeatures(timelineSignals)
      Sc.load(features)
      refreshClusters()
      map.getSource?.('signals-raw')?.setData({ type: 'FeatureCollection', features })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineActive, timeline.visibleSignals, timeline.currentTime])

  // Timeline range change handler
  const handleTimelineRangeChange = useCallback((range: string) => {
    setTimelineRange(range)
  }, [])

  // Timeline close handler
  const handleTimelineClose = useCallback(() => {
    setTimelineActive(false)
    timeline.reset()
  }, [timeline])

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
    if (timelineActive)         url += `&tl=${timelineRange}`
    if (timelineActive && timeline.currentTime) url += `&tt=${encodeURIComponent(timeline.currentTime)}`
    // Without a Next.js navigation (M7), keeping the #share hash
    window.history.replaceState(window.history.state, '', url + window.location.hash)
  }, [category, timeRange, heatmapMode])

  // ── Derived state ──────────────────────────────────────────────────────────

  const sevCounts = signals.reduce((a, s) => {
    a[s.severity] = (a[s.severity] ?? 0) + 1; return a
  }, {} as Record<string, number>)

  const sevColor = selected ? (SEV_COLOR[selected.severity] ?? '#8892a4') : '#8892a4'
  const sevBg    = selected ? (SEV_BG[selected.severity]    ?? 'rgba(136,146,164,0.15)') : ''
  const srcUrl   = selected ? getSourceUrl(selected.original_urls) : null

  // ── "Latest in view" list (M14) ───────────────────────────────────────────
  const hoverOnMap = (item: { id: string } | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = mapRef.current?.getSource?.('list-hover') as any
    if (!src) return
    const sig = item ? signalsRef.current.find(x => x.id === item.id) : null
    src.setData({
      type: 'FeatureCollection',
      features: sig ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(sig.lng), Number(sig.lat)] }, properties: {} }] : [],
    })
  }
  const selectFromList = (item: { id: string }) => {
    const sig = signalsRef.current.find(x => x.id === item.id)
    if (!sig) return
    setSelected(sig)
    if (typeof window !== 'undefined' && window.innerWidth < 768) setListOpen(false)
    const map = mapRef.current
    if (map) map.flyTo({ center: [Number(sig.lng), Number(sig.lat)], zoom: Math.max(map.getZoom(), 5), speed: 1.2, duration: 800 })
  }

  // ── Layers (one panel, grouped by theme; plan M11) ─────────────────────────
  // WIND and SATS aren't offered until they show real data (M6): the wind
  // layer can't draw on MapLibre v5 and the satellite positions are rough
  // guesses. CARRIERS is covered by Naval intelligence.
  const layerGroups: MapLayerGroup[] = [
    {
      title: 'Signals',
      items: [
        { key: 'heat', label: 'Heatmap', description: 'Where signals are concentrated', icon: Flame, color: '#ff7a3d',
          on: heatmapMode, toggle: () => setHeatmapMode(v => !v) },
        { key: 'timeline', label: 'Replay', description: 'Play back how the last hours unfolded', icon: History, color: '#a78bfa',
          on: timelineActive, loading: timeline.loading, count: timeline.data?.total_signals ?? null,
          toggle: () => setTimelineActive(v => !v) },
      ],
    },
    {
      title: 'Security',
      items: [
        { key: 'conflict', label: 'Conflict zones', description: 'Fighting, military activity and security incidents, last 72 h', icon: Swords, color: '#ef4444',
          on: conflictMode, loading: conflictLoading, count: conflictCount, toggle: () => setConflictMode(v => !v) },
        { key: 'threats', label: 'Missile & drone threats', description: 'Ballistic, cruise, hypersonic, drone and rocket reports', icon: Crosshair, color: '#f87171',
          on: threatMode, loading: threatLoading, count: threatCount, toggle: () => setThreatMode(v => !v),
          note: signInNeeded.threats ? SIGN_IN_NOTE : null },
        { key: 'jamming', label: 'GPS jamming', description: 'Military jamming, spoofing and interference zones', icon: RadioTower, color: '#c084fc',
          on: jammingMode, loading: jammingLoading, count: jammingCount, toggle: () => setJammingMode(v => !v),
          note: signInNeeded.jamming ? SIGN_IN_NOTE : null },
        { key: 'naval', label: 'Naval intelligence', description: 'Carriers, ships in distress and ships gone dark', icon: Anchor, color: '#60a5fa',
          on: navalMode, loading: navalLoading, count: navalCount, toggle: () => setNavalMode(v => !v) },
      ],
    },
    {
      title: 'Movement',
      items: [
        { key: 'aircraft', label: 'Aircraft', description: 'Aviation alerts from ADS-B, last 2 h', icon: Plane, color: '#22d3ee',
          on: showAircraft, count: adsbSignals.length, toggle: () => setShowAircraft(v => !v) },
        { key: 'ships', label: 'Ships', description: 'Maritime reports from AIS, last 4 h', icon: Ship, color: '#f59e0b',
          on: showShips, count: shipCount, toggle: () => setShowShips(v => !v) },
      ],
    },
    {
      title: 'Earth & context',
      items: [
        { key: 'hazards', label: 'Natural hazards', description: 'Earthquakes, volcanoes, tsunamis and wildfires, last 48 h', icon: Activity, color: '#fb923c',
          on: hazardsMode, loading: hazardsLoading, count: hazardsCount, toggle: () => setHazardsMode(v => !v) },
        { key: 'risk', label: 'Country risk', description: 'Countries shaded by today’s signal activity', icon: ShieldAlert, color: '#fbbf24',
          on: countryRiskMode, loading: countryRiskLoading, count: countryRiskCount, toggle: () => setCountryRiskMode(v => !v) },
        { key: 'nasa', label: 'Daily satellite photo', description: 'NASA MODIS image of the chosen day (clouds included)', icon: Satellite, color: '#34d399',
          on: satelliteMode, toggle: () => setSatelliteMode(v => !v),
          extra: (
            <input
              type="date"
              value={gibsDate}
              min="2000-02-24"
              max={(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()}
              onChange={e => { if (e.target.value) setGibsDate(e.target.value) }}
              aria-label="Satellite photo date"
              className="bg-black/30 border border-white/10 text-wp-text2 text-[11px] font-mono rounded-md px-2 py-1 outline-none focus:border-[rgba(52,211,153,0.6)]"
            />
          ) },
        { key: 'cams', label: 'Live cameras', description: 'Public traffic, weather and city webcams', icon: Video, color: '#2dd4bf',
          on: showCameras, count: cameraCount, toggle: () => setShowCameras(v => !v) },
        { key: 'daynight', label: 'Day and night', description: 'Where it is night right now, updated every 5 minutes', icon: SunMoon, color: '#94a3b8',
          on: dayNight, toggle: toggleDayNight },
      ],
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100dvh-52px-56px)] md:h-[calc(100dvh-52px)] flex flex-col bg-wp-bg">

      {/* Toolbar: topic, severity and time on the left; live status and Layers on the right */}
      <div className="relative z-20 border-b border-white/[0.07] bg-[rgba(6,8,14,0.94)] backdrop-blur-xl">
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-12">
          <h1 className="hidden sm:block font-display text-[13px] tracking-[2.5px] text-wp-text font-bold flex-shrink-0">LIVE MAP</h1>

          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-2 min-w-max">
              {/* Topic */}
              <label htmlFor="map-topic" className="sr-only">Topic</label>
              <select
                id="map-topic"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="wp-map-select"
              >
                {CATS.map(cat => (
                  <option key={cat} value={cat}>{cat === 'all' ? 'All topics' : cat[0].toUpperCase() + cat.slice(1)}</option>
                ))}
              </select>

              {/* Severity */}
              <div className="wp-seg" role="group" aria-label="Severity">
                {SEVS.map(sev => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverity(sev)}
                    aria-pressed={severity === sev}
                    className={`wp-seg-btn ${severity === sev ? 'wp-seg-on' : ''}`}
                  >
                    {sev !== 'all' && (
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SEV_COLOR[sev] }} />
                    )}
                    {sev === 'all' ? 'All' : sev[0].toUpperCase() + sev.slice(1)}
                  </button>
                ))}
              </div>

              {/* Time window ("ALL" was the same 7 days as 7D) */}
              <div className="wp-seg" role="group" aria-label="Time window">
                {TRANGE.filter(t => t.v !== 'all').map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setTimeRange(opt.v)}
                    aria-pressed={timeRange === opt.v || (opt.v === '7d' && timeRange === 'all')}
                    className={`wp-seg-btn ${timeRange === opt.v || (opt.v === '7d' && timeRange === 'all') ? 'wp-seg-on' : ''}`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>

              {(satError || gibsError) && (
                <span className="text-[10px] text-red-300 font-mono px-2 py-1 bg-red-500/10 rounded border border-red-500/20">
                  {satError || gibsError}
                </span>
              )}
            </div>
          </div>

          {/* Live status: connection, signals in view, new arrivals */}
          <div
            className="flex items-center gap-2 flex-shrink-0 font-mono text-[10px] text-wp-text2"
            title={wsOnline ? 'Live: new signals appear as they arrive' : 'Reconnecting… the map still refreshes every 30 seconds'}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wsOnline ? 'bg-wp-green animate-live-pulse' : 'bg-wp-amber'}`} />
            <span className="hidden md:inline tabular-nums">{visibleCount.toLocaleString('en-US')} in view</span>
            {wsNewCount > 0 && <span className="text-wp-green tabular-nums">+{wsNewCount}</span>}
          </div>

          {/* Latest in view */}
          <button
            type="button"
            onClick={() => setListOpen(o => !o)}
            aria-expanded={listOpen}
            aria-label="Latest signals in view"
            className={`flex items-center gap-1.5 flex-shrink-0 h-8 px-2.5 rounded-lg border text-[12px] font-medium transition-colors
              ${listOpen
                ? 'border-[rgba(0,212,255,0.45)] text-[#4dd8ff] bg-[rgba(0,212,255,0.08)]'
                : 'border-white/10 text-wp-text2 hover:text-wp-text hover:border-white/20'}`}
          >
            <ListIcon size={15} />
            <span className="hidden sm:inline">Latest</span>
          </button>

          {/* Layers */}
          <button
            type="button"
            onClick={() => setLayersOpen(o => !o)}
            aria-expanded={layersOpen}
            aria-haspopup="dialog"
            className={`flex items-center gap-1.5 flex-shrink-0 h-8 px-2.5 rounded-lg border text-[12px] font-medium transition-colors
              ${layersOpen || activeLayerCount(layerGroups) > 0
                ? 'border-[rgba(0,212,255,0.45)] text-[#4dd8ff] bg-[rgba(0,212,255,0.08)]'
                : 'border-white/10 text-wp-text2 hover:text-wp-text hover:border-white/20'}`}
          >
            <LayersIcon size={15} />
            <span className="hidden sm:inline">Layers</span>
            {activeLayerCount(layerGroups) > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#4dd8ff] text-[#04121a] text-[10px] font-bold leading-4 text-center">
                {activeLayerCount(layerGroups)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Outside the toolbar on purpose: its backdrop blur would trap the phone sheet */}
        <LayersPanel groups={layerGroups} open={layersOpen} onClose={() => setLayersOpen(false)} />
        <LiveList
          items={inView}
          total={visibleCount}
          open={listOpen}
          selectedId={selected?.id ?? null}
          freshIds={sinceDismissed ? undefined : freshIds}
          onClose={() => { setListOpen(false); hoverOnMap(null) }}
          onSelect={selectFromList}
          onHover={hoverOnMap}
        />
        <div ref={mapContainer} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />

        {/* BAT-16: Hotspot labels overlay — floating labels for dense signal zones at zoom > 5 */}
        <HotspotLabels
          hotspots={hotspots}
          mapRef={mapRef as React.RefObject<import('maplibre-gl').Map | null>}
          moveCount={mapMoveCount}
          currentZoom={mapZoom}
        />

        {/* ── Convergence Hotspots Widget ─────────────────────────────── */}
        {/* Shows geographic cells with 3+ distinct signal categories converging */}
        {hotspots.length > 0 && !selected && (
          <div className={`absolute top-4 z-10 max-w-[240px] transition-all ${listOpen ? 'left-4 md:left-[336px]' : 'left-4'}`}>
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
                        <div className="font-mono text-[9px] text-wp-text3 mb-0.5 truncate">
                          {hotspotPlace(hs)}
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
          <div className={`absolute z-10 pointer-events-none transition-all duration-300 ${listOpen ? 'left-4 md:left-[336px]' : 'left-4'} ${selected ? 'bottom-[calc(72%+108px)] md:bottom-[108px]' : 'bottom-[108px]'}`}>
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

        {/* Legend: severities, verified ring, groups, and the layers that are on */}
        <div className={`absolute z-10 transition-all duration-300 ${listOpen ? 'left-4 md:left-[336px]' : 'left-4'} ${selected || country ? 'hidden md:block md:bottom-6' : 'bottom-6'}`}>
          <MapLegend counts={sevCounts} groups={layerGroups} />
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
                <Link href={`/signals/${encodeURIComponent(selected.id)}`}
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
            // Rendered on <body>: inside the sliding panel (it has a transform) the dialog was trapped in 340px
            createPortal(<FlagModal signalId={flagModalSignalId} onClose={() => setFlagModalSignalId(null)} />, document.body)
          )}
        </div>

        {/* Since you last looked (plan M8) */}
        {since && since.fresh.length > 0 && !sinceDismissed && lastVisit !== null && !selected && !country && !hotspotsOpen && (
          <SinceLastVisit
            count={since.fresh.length}
            more={since.fresh.length >= signals.length && signals.length >= MAX_SIGNALS}
            serious={since.serious}
            ringCount={ringed.length}
            className={listOpen ? 'md:left-[calc(50%+160px)]' : ''}
            away={awayLabel(lastVisit)}
            capped={since.capped}
            windowLabel={TIME_WINDOW_LABEL[timeRange] ?? 'chosen time window'}
            showing={sinceShown}
            onToggle={() => setSinceShown(v => !v)}
            onDismiss={() => { setSinceDismissed(true); setSinceShown(false) }}
          />
        )}

        {/* Country brief (plan M9): opens on a click on a country; a signal
            chosen from it opens the signal panel, and closing that comes back here */}
        {country && !selected && (
          <CountryBrief
            country={country}
            brief={brief}
            windowLabel={TIME_WINDOW_LABEL[timeRange] ?? 'chosen time window'}
            risk={country.risk}
            categoryIcon={CAT_ICON}
            onClose={() => setCountry(null)}
            onSelect={selectFromList}
            onZoom={zoomToCountry}
          />
        )}

        {/* ── Basemap, projection and reset view (top-right, under the zoom buttons) ── */}
        {/* Below MapLibre's zoom/compass buttons, which are 44px tall each on phones */}
        <div className="absolute right-[10px] z-10 flex flex-col gap-1.5 top-[152px] md:top-[112px]">
          {/* Basemap: dark map → night lights → satellite */}
          <button
            onClick={() => setBasemap(b => BASEMAP_MODES[(BASEMAP_MODES.indexOf(b) + 1) % BASEMAP_MODES.length])}
            title={`Basemap: ${BASEMAP_LABEL[basemap]} (click for ${BASEMAP_LABEL[BASEMAP_MODES[(BASEMAP_MODES.indexOf(basemap) + 1) % BASEMAP_MODES.length]]})`}
            aria-label={`Basemap: ${BASEMAP_LABEL[basemap]}`}
            className="wp-map-ctrl"
          >
            {basemap === 'dark' ? <MapIcon size={15} /> : basemap === 'night' ? <Moon size={15} /> : <Satellite size={15} />}
          </button>
          {/* Globe / flat */}
          <button
            onClick={() => setProjection(p => p === 'globe' ? 'mercator' : 'globe')}
            title={projection === 'globe' ? 'Globe view (click for a flat map)' : 'Flat map (click for the globe)'}
            aria-label={projection === 'globe' ? 'Switch to flat map' : 'Switch to globe'}
            aria-pressed={projection === 'globe'}
            className={`wp-map-ctrl ${projection === 'globe' ? 'wp-map-ctrl-on' : ''}`}
          >
            <Globe2 size={15} />
          </button>
          {/* Whole world, straight down */}
          <button
            onClick={() => {
              const map = mapRef.current
              if (!map) return
              const el = map.getContainer()
              map.flyTo({ center: [10, 20], zoom: worldZoom(el.clientWidth, el.clientHeight, projection), pitch: 0, bearing: 0, duration: 1000 })
            }}
            title="Show the whole world"
            aria-label="Show the whole world"
            className="wp-map-ctrl"
          >
            <LocateFixed size={15} />
          </button>
          {/* Jump to a region (M18) */}
          <div className="relative" data-regions>
            <button
              onClick={() => setRegionsOpen(v => !v)}
              title="Go to a region"
              aria-label="Go to a region"
              aria-haspopup="menu"
              aria-expanded={regionsOpen}
              className={`wp-map-ctrl ${regionsOpen ? 'wp-map-ctrl-on' : ''}`}
            >
              <Compass size={15} />
            </button>
            {regionsOpen && (
              <div role="menu" aria-label="Regions"
                className="absolute right-[40px] top-0 w-[220px] rounded-xl border border-white/10 bg-[rgba(8,11,20,0.94)] backdrop-blur-md shadow-2xl py-1.5">
                <div className="px-3 pt-1 pb-1.5 text-[10px] font-mono uppercase tracking-[1.2px] text-wp-text3">Go to</div>
                {MAP_REGIONS.map(region => (
                  <button key={region.key} role="menuitem" onClick={() => flyToRegion(region.bounds)}
                    className="w-full text-left px-3 py-2 text-[13px] text-wp-text hover:bg-white/[0.06] focus:bg-white/[0.06] focus:outline-none">
                    {region.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Palantir-style Annotation Cards ───────────────────────────── */}
        {annotationCards.size > 0 && (
          <div className="absolute inset-0 pointer-events-none z-10" aria-label="Signal annotation cards">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 pointer-events-auto max-w-[320px] w-full">
              {Array.from(annotationCards.values()).map(({ signal: sig }) => {
                const color  = SEV_COLOR[sig.severity]  ?? '#8892a4'
                const bg     = SEV_BG[sig.severity]     ?? 'rgba(136,146,164,0.15)'
                const icon   = CAT_ICON[sig.category]   ?? '🌍'
                const score  = Math.round((sig.reliability_score ?? 0) * 100)
                const dots   = reliabilityDots(sig.reliability_score ?? 0)
                const srcUrl = getSourceUrl(sig.original_urls)
                const srcDomain = srcUrl ? getSourceDomain(srcUrl) : null

                return (
                  <div
                    key={sig.id}
                    style={{
                      background:  'rgba(6,7,13,0.93)',
                      border:      `1px solid ${color}55`,
                      borderLeft:  `3px solid ${color}`,
                      borderRadius: 12,
                      backdropFilter: 'blur(16px)',
                      boxShadow:   `0 4px 24px rgba(0,0,0,0.6), 0 0 12px ${color}22`,
                    }}
                    className="p-3"
                  >
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="font-mono text-[9px] tracking-[1.5px] uppercase px-1.5 py-0.5 rounded"
                          style={{ color, background: bg, border: `1px solid ${color}44` }}
                        >
                          {icon} {sig.category}
                        </span>
                        <span
                          className="font-mono text-[9px] tracking-[1.5px] uppercase px-1.5 py-0.5 rounded"
                          style={{ color, background: bg, border: `1px solid ${color}33` }}
                        >
                          {sig.severity}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setAnnotationCards(prev => {
                            const next = new Map(prev)
                            next.delete(sig.id)
                            return next
                          })
                        }}
                        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.08)] transition-all text-[14px] leading-none"
                        aria-label="Dismiss"
                      >
                        ×
                      </button>
                    </div>

                    {/* Title */}
                    <div className="text-[12px] font-semibold text-wp-text leading-snug mb-2 line-clamp-2">
                      {sig.title}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px]" style={{ color }} title={`${score}% reliability`}>
                          {dots}
                        </span>
                        <span className="font-mono text-[9px] text-wp-text3">
                          {timeAgo(sig.created_at)}
                        </span>
                      </div>
                      {srcDomain && (
                        <span className="font-mono text-[9px] text-wp-text3 truncate max-w-[90px]">
                          via {srcDomain}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Share Button — floating bottom-right (BAT-15) */}
        {/* Beside the side panel when one is open (on phones the sheet covers it) */}
        <ShareButton getState={getPermalinkState} className={selected || country ? 'hidden md:flex md:right-[352px]' : ''} />

        {/* Timeline Slider (BAT-14) */}
        {timelineActive && (
          <TimeSlider
            buckets={timeline.data?.buckets ?? []}
            currentIndex={timeline.currentIndex}
            isPlaying={timeline.isPlaying}
            speed={timeline.speed}
            currentTime={timeline.currentTime}
            range={timelineRange}
            loading={timeline.loading}
            totalSignals={timeline.data?.total_signals ?? 0}
            onSeek={timeline.seekTo}
            onTogglePlay={timeline.togglePlay}
            onSpeedChange={timeline.setSpeed}
            onRangeChange={handleTimelineRangeChange}
            onClose={handleTimelineClose}
          />
        )}

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