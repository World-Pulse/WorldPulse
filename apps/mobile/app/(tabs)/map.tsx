/**
 * WorldPulse Mobile Map — Palantir-Style Intelligence Layer
 *
 * Features:
 *   - Signal markers (severity-coded, category/time filtered)
 *   - Basemap mode: Dark / Satellite / Hybrid
 *   - ADS-B aviation layer (aircraft squawk signals from last 4h)
 *   - Maritime layer (carrier strike groups, AIS distress vessels, dark ships)
 *   - Floating layer controls panel
 *
 * Mirrors web map (apps/web/src/app/map/page.tsx) Palantir-style features
 * in React Native. Uses react-native-maps MapType for basemap switching.
 */

import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal,
  Pressable, ActivityIndicator,
} from 'react-native'
import MapView, { Marker, Callout, PROVIDER_GOOGLE, type MapType } from 'react-native-maps'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import {
  signalsApi, mapLayersApi,
  type Signal, type AdsbSignal, type MaritimeVessel,
} from '@/lib/api'

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────

const COLORS = {
  bg:      '#06070d',
  surface: '#0d0f18',
  s2:      '#141722',
  border:  'rgba(255,255,255,0.07)',
  amber:   '#f5a623',
  text:    '#e2e6f0',
  text2:   '#8892a4',
  text3:   '#4a5568',
  red:     '#ff3b5c',
  cyan:    '#00d4ff',
  green:   '#00e676',
  teal:    '#00b4a0',
  purple:  '#a855f7',
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#00d4ff',
  low:      '#00e676',
  info:     '#8892a4',
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CATEGORY_FILTERS = [
  { id: 'all',        label: 'All' },
  { id: 'conflict',   label: 'Conflict' },
  { id: 'climate',    label: 'Climate' },
  { id: 'disaster',   label: 'Disaster' },
  { id: 'health',     label: 'Health' },
  { id: 'economy',    label: 'Economy' },
  { id: 'geopolitics',label: 'Geopolitics' },
]

const TIME_FILTERS = [
  { id: '6',  label: '6h' },
  { id: '24', label: '24h' },
  { id: '72', label: '3d' },
]

type BasemapMode = 'dark' | 'satellite' | 'hybrid'

const BASEMAP_MODES: Array<{ id: BasemapMode; label: string; mapType: MapType }> = [
  { id: 'dark',      label: '🌙 DARK', mapType: 'standard' as MapType },
  { id: 'satellite', label: '🛰 SAT',  mapType: 'satellite' as MapType },
  { id: 'hybrid',    label: '🗺 HYB',  mapType: 'hybrid' as MapType },
]

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function MapScreen() {
  const router = useRouter()

  // Signal layer state
  const [selectedSignal, setSelectedSignal] = useState<(Signal & { lng: number; lat: number }) | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('24')

  // Basemap state
  const [basemapMode, setBasemapMode] = useState<BasemapMode>('dark')

  // Layer toggles
  const [showAircraft, setShowAircraft] = useState(false)
  const [showVessels, setShowVessels] = useState(false)
  const [layerPanelOpen, setLayerPanelOpen] = useState(false)

  // Selected aircraft for detail sheet
  const [selectedAircraft, setSelectedAircraft] = useState<AdsbSignal | null>(null)
  const [selectedVessel, setSelectedVessel] = useState<MaritimeVessel | null>(null)

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: signalData, isLoading: signalsLoading } = useQuery({
    queryKey: ['signals', 'map', categoryFilter, timeFilter],
    queryFn: () => signalsApi.getMapPoints({
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      hours: Number(timeFilter),
    }),
    refetchInterval: 60_000,
  })

  const { data: adsbData, isLoading: adsbLoading } = useQuery({
    queryKey: ['map', 'adsb'],
    queryFn: () => mapLayersApi.getAdsb(),
    enabled: showAircraft,
    refetchInterval: 60_000,  // refresh every 60s when layer is active
    staleTime: 30_000,
  })

  const { data: vesselData, isLoading: vesselLoading } = useQuery({
    queryKey: ['map', 'vessels'],
    queryFn: () => mapLayersApi.getVessels(),
    enabled: showVessels,
    refetchInterval: 5 * 60_000,  // refresh every 5min when active
    staleTime: 60_000,
  })

  const points   = signalData?.data ?? []
  const aircraft = adsbData?.data ?? []
  const vessels  = vesselData?.data ?? []

  const isLoading = signalsLoading || (showAircraft && adsbLoading) || (showVessels && vesselLoading)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const handleMarkerPress = useCallback((signal: Signal & { lng: number; lat: number }) => {
    setSelectedAircraft(null)
    setSelectedVessel(null)
    setSelectedSignal(signal)
    setSheetVisible(true)
  }, [])

  const handleAircraftPress = useCallback((ac: AdsbSignal) => {
    setSelectedSignal(null)
    setSelectedVessel(null)
    setSelectedAircraft(ac)
    setSheetVisible(true)
  }, [])

  const handleVesselPress = useCallback((v: MaritimeVessel) => {
    setSelectedSignal(null)
    setSelectedAircraft(null)
    setSelectedVessel(v)
    setSheetVisible(true)
  }, [])

  const cycleBasemap = useCallback(() => {
    setBasemapMode(prev => {
      const idx = BASEMAP_MODES.findIndex(m => m.id === prev)
      return BASEMAP_MODES[(idx + 1) % BASEMAP_MODES.length]!.id
    })
  }, [])

  const activeBasemap = BASEMAP_MODES.find(m => m.id === basemapMode) ?? BASEMAP_MODES[0]!

  /** Vessel marker display props by type */
  function vesselMarkerProps(v: MaritimeVessel): { icon: string; color: string } {
    switch (v.type) {
      case 'carrier':   return { icon: '⛵', color: COLORS.red }
      case 'dark_ship': return { icon: '⬛', color: COLORS.text3 }
      default:          return { icon: '🚢', color: COLORS.teal }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <MapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        mapType={activeBasemap.mapType}
        customMapStyle={basemapMode === 'dark' ? darkMapStyle : undefined}
        initialRegion={{
          latitude: 20,
          longitude: 0,
          latitudeDelta: 80,
          longitudeDelta: 120,
        }}
        showsUserLocation
        showsCompass={false}
      >
        {/* Signal markers */}
        {points.map(point => (
          <Marker
            key={`sig-${point.id}`}
            coordinate={{ latitude: point.lat, longitude: point.lng }}
            onPress={() => handleMarkerPress(point)}
          >
            <View style={[
              styles.marker,
              { borderColor: SEVERITY_COLORS[point.severity] ?? COLORS.amber }
            ]}>
              <View style={[
                styles.markerDot,
                { backgroundColor: SEVERITY_COLORS[point.severity] ?? COLORS.amber }
              ]} />
            </View>
          </Marker>
        ))}

        {/* ADS-B aircraft markers */}
        {showAircraft && aircraft.map(ac => (
          <Marker
            key={`adsb-${ac.id}`}
            coordinate={{ latitude: ac.lat, longitude: ac.lng }}
            onPress={() => handleAircraftPress(ac)}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.aircraftMarker}>
              <Text style={styles.aircraftIcon}>✈</Text>
            </View>
          </Marker>
        ))}

        {/* Maritime vessel markers */}
        {showVessels && vessels.map(v => {
          const { icon, color } = vesselMarkerProps(v)
          return (
            <Marker
              key={`vessel-${v.id}`}
              coordinate={{ latitude: v.lat, longitude: v.lng }}
              onPress={() => handleVesselPress(v)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.vesselMarker, { borderColor: color }]}>
                <Text style={styles.vesselIcon}>{icon}</Text>
              </View>
            </Marker>
          )
        })}
      </MapView>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {CATEGORY_FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              onPress={() => setCategoryFilter(f.id)}
              style={[styles.filterChip, categoryFilter === f.id && styles.filterChipActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, categoryFilter === f.id && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.timePicker}>
          {TIME_FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              onPress={() => setTimeFilter(f.id)}
              style={[styles.timeChip, timeFilter === f.id && styles.timeChipActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.timeChipText, timeFilter === f.id && styles.timeChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Basemap toggle (bottom-right) ────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.basemapToggle}
        onPress={cycleBasemap}
        activeOpacity={0.8}
      >
        <Text style={styles.basemapToggleText}>{activeBasemap.label}</Text>
      </TouchableOpacity>

      {/* ── Layer controls (right side, above basemap toggle) ────────────────── */}
      <View style={styles.layerControls}>
        {/* Layer panel toggle button */}
        <TouchableOpacity
          style={[styles.layerBtn, layerPanelOpen && styles.layerBtnActive]}
          onPress={() => setLayerPanelOpen(v => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.layerBtnIcon}>⊕</Text>
        </TouchableOpacity>

        {/* Expanded layer toggles */}
        {layerPanelOpen && (
          <View style={styles.layerPanel}>
            <Text style={styles.layerPanelTitle}>LAYERS</Text>

            <TouchableOpacity
              style={[styles.layerToggle, showAircraft && styles.layerToggleActive]}
              onPress={() => setShowAircraft(v => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.layerToggleIcon}>✈</Text>
              <Text style={[styles.layerToggleLabel, showAircraft && styles.layerToggleLabelActive]}>
                Aircraft
              </Text>
              {showAircraft && adsbLoading && (
                <ActivityIndicator size="small" color={COLORS.cyan} style={{ marginLeft: 4 }} />
              )}
              {showAircraft && !adsbLoading && (
                <Text style={styles.layerToggleCount}>{aircraft.length}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.layerToggle, showVessels && styles.layerToggleActiveTeal]}
              onPress={() => setShowVessels(v => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.layerToggleIcon}>🚢</Text>
              <Text style={[styles.layerToggleLabel, showVessels && styles.layerToggleLabelTeal]}>
                Maritime
              </Text>
              {showVessels && vesselLoading && (
                <ActivityIndicator size="small" color={COLORS.teal} style={{ marginLeft: 4 }} />
              )}
              {showVessels && !vesselLoading && (
                <Text style={[styles.layerToggleCount, { color: COLORS.teal }]}>{vessels.length}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── Loading indicator ────────────────────────────────────────────────── */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={COLORS.amber} />
        </View>
      )}

      {/* ── Signal count badge ───────────────────────────────────────────────── */}
      <View style={styles.countBadge}>
        <Text style={styles.countText}>
          {points.length} signals
          {showAircraft && aircraft.length > 0 ? `  ✈ ${aircraft.length}` : ''}
          {showVessels && vessels.length > 0 ? `  🚢 ${vessels.length}` : ''}
        </Text>
      </View>

      {/* ── Detail bottom sheet ──────────────────────────────────────────────── */}
      <Modal
        visible={sheetVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSheetVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSheetVisible(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>

            {/* Signal detail */}
            {selectedSignal != null && (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLORS[selectedSignal.severity] ?? COLORS.amber }]} />
                  <Text style={[styles.severityText, { color: SEVERITY_COLORS[selectedSignal.severity] ?? COLORS.amber }]}>
                    {selectedSignal.severity.toUpperCase()}
                  </Text>
                  <Text style={styles.categoryText}>{selectedSignal.category.toUpperCase()}</Text>
                </View>
                <Text style={styles.sheetTitle} numberOfLines={3}>{selectedSignal.title}</Text>
                {selectedSignal.locationName != null && (
                  <Text style={styles.sheetLocation}>📍 {selectedSignal.locationName}</Text>
                )}
                <View style={styles.sheetStats}>
                  <Text style={styles.statItem}>🔗 {selectedSignal.sourceCount} source{selectedSignal.sourceCount !== 1 ? 's' : ''}</Text>
                  <Text style={styles.statItem}>💬 {selectedSignal.postCount} posts</Text>
                  {selectedSignal.reliabilityScore > 0 && (
                    <Text style={styles.statItem}>✓ {Math.round(selectedSignal.reliabilityScore * 100)}% reliable</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.sheetButton}
                  onPress={() => {
                    setSheetVisible(false)
                    router.push(`/signal/${selectedSignal.id}`)
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.sheetButtonText}>View Full Signal →</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Aircraft detail */}
            {selectedAircraft != null && (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  <Text style={[styles.severityText, { color: COLORS.cyan }]}>✈ AVIATION SIGNAL</Text>
                </View>
                <Text style={styles.sheetTitle} numberOfLines={3}>{selectedAircraft.title}</Text>
                <View style={styles.sheetStats}>
                  {selectedAircraft.published_at != null && (
                    <Text style={styles.statItem}>
                      🕐 {new Date(selectedAircraft.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )}
                  {selectedAircraft.reliability_score > 0 && (
                    <Text style={styles.statItem}>✓ {Math.round(selectedAircraft.reliability_score * 100)}% reliable</Text>
                  )}
                  <Text style={styles.statItem}>
                    📍 {selectedAircraft.lat.toFixed(3)}°, {selectedAircraft.lng.toFixed(3)}°
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.sheetButton, { backgroundColor: COLORS.cyan }]}
                  onPress={() => {
                    setSheetVisible(false)
                    router.push(`/signal/${selectedAircraft.id}`)
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.sheetButtonText}>View Full Signal →</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Vessel detail */}
            {selectedVessel != null && (() => {
              const { icon, color } = vesselMarkerProps(selectedVessel)
              return (
                <>
                  <View style={styles.sheetHandle} />
                  <View style={styles.sheetHeader}>
                    <Text style={[styles.severityText, { color }]}>
                      {icon} {selectedVessel.type === 'carrier' ? 'CARRIER STRIKE GROUP' : selectedVessel.type === 'dark_ship' ? 'DARK VESSEL' : 'MARITIME VESSEL'}
                    </Text>
                  </View>
                  <Text style={styles.sheetTitle} numberOfLines={3}>{selectedVessel.title}</Text>
                  {selectedVessel.fleet != null && (
                    <Text style={styles.sheetLocation}>⚓ Fleet: {selectedVessel.fleet}</Text>
                  )}
                  <View style={styles.sheetStats}>
                    <Text style={styles.statItem}>⚡ {selectedVessel.status_text}</Text>
                    <Text style={styles.statItem}>
                      📍 {selectedVessel.lat.toFixed(3)}°, {selectedVessel.lng.toFixed(3)}°
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.sheetButton, { backgroundColor: color }]}
                    onPress={() => {
                      setSheetVisible(false)
                      router.push(`/signal/${selectedVessel.id}`)
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.sheetButtonText, { color: selectedVessel.type === 'dark_ship' ? COLORS.text : '#000' }]}>
                      View Full Signal →
                    </Text>
                  </TouchableOpacity>
                </>
              )
            })()}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  map: { flex: 1 },

  // Signal markers
  marker: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
  },
  markerDot: { width: 6, height: 6, borderRadius: 3 },

  // Aircraft markers
  aircraftMarker: {
    backgroundColor: 'rgba(0,212,255,0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cyan,
    padding: 3,
  },
  aircraftIcon: { fontSize: 14, color: COLORS.cyan },

  // Vessel markers
  vesselMarker: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
  },
  vesselIcon: { fontSize: 14 },

  // Filter bar
  filterBar: {
    position: 'absolute', top: 12, left: 0, right: 0,
    paddingHorizontal: 12, gap: 8,
  },
  filterScroll: { gap: 6, paddingRight: 12 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: 'rgba(13,15,24,0.9)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  filterChipActive: { backgroundColor: 'rgba(245,166,35,0.2)', borderColor: '#f5a623' },
  filterChipText: { fontSize: 12, color: COLORS.text2, fontWeight: '600' },
  filterChipTextActive: { color: COLORS.amber },
  timePicker: { flexDirection: 'row', gap: 4, alignSelf: 'flex-start' },
  timeChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: 'rgba(13,15,24,0.9)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  timeChipActive: { backgroundColor: 'rgba(0,212,255,0.15)', borderColor: COLORS.cyan },
  timeChipText: { fontSize: 11, color: COLORS.text3, fontWeight: '700', fontFamily: 'monospace' },
  timeChipTextActive: { color: COLORS.cyan },

  // Basemap toggle
  basemapToggle: {
    position: 'absolute', bottom: 80, right: 12,
    backgroundColor: 'rgba(13,15,24,0.92)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  basemapToggleText: {
    color: COLORS.text2, fontSize: 11, fontWeight: '700', fontFamily: 'monospace',
  },

  // Layer controls
  layerControls: {
    position: 'absolute', bottom: 128, right: 12,
    alignItems: 'flex-end', gap: 6,
  },
  layerBtn: {
    backgroundColor: 'rgba(13,15,24,0.92)',
    borderRadius: 8, width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  layerBtnActive: { borderColor: COLORS.amber, backgroundColor: 'rgba(245,166,35,0.15)' },
  layerBtnIcon: { color: COLORS.text2, fontSize: 18 },
  layerPanel: {
    backgroundColor: 'rgba(13,15,24,0.96)',
    borderRadius: 10, padding: 10, gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    minWidth: 140,
  },
  layerPanelTitle: {
    fontSize: 9, color: COLORS.text3, fontWeight: '700',
    fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 2,
  },
  layerToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  layerToggleActive: {
    backgroundColor: 'rgba(0,212,255,0.1)', borderColor: COLORS.cyan,
  },
  layerToggleActiveTeal: {
    backgroundColor: 'rgba(0,180,160,0.1)', borderColor: COLORS.teal,
  },
  layerToggleIcon: { fontSize: 14 },
  layerToggleLabel: { fontSize: 12, color: COLORS.text2, fontWeight: '600', flex: 1 },
  layerToggleLabelActive: { color: COLORS.cyan },
  layerToggleLabelTeal: { color: COLORS.teal },
  layerToggleCount: {
    fontSize: 10, color: COLORS.cyan, fontFamily: 'monospace', fontWeight: '700',
  },

  // Loading
  loadingOverlay: {
    position: 'absolute', bottom: 100, alignSelf: 'center',
    backgroundColor: 'rgba(13,15,24,0.9)', borderRadius: 20, padding: 10,
  },

  // Count badge
  countBadge: {
    position: 'absolute', bottom: 20, alignSelf: 'center',
    backgroundColor: 'rgba(13,15,24,0.9)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  countText: { color: COLORS.text2, fontSize: 12, fontFamily: 'monospace' },

  // Bottom sheet
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36,
    borderTopWidth: 1, borderColor: COLORS.border,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10,
  },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  severityText: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 1 },
  categoryText: { fontSize: 11, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1 },
  sheetTitle: {
    fontSize: 16, fontWeight: '700', color: COLORS.text, lineHeight: 22, marginBottom: 8,
  },
  sheetLocation: { fontSize: 13, color: COLORS.text2, marginBottom: 12 },
  sheetStats: { flexDirection: 'row', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  statItem: { fontSize: 12, color: COLORS.text2 },
  sheetButton: {
    backgroundColor: COLORS.amber, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  sheetButtonText: { color: '#000', fontWeight: '700', fontSize: 14 },
})

// ─── DARK MAP STYLE (Google Maps) ─────────────────────────────────────────────

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0d0f18' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8892a4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#06070d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0c13' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#141722' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1b2030' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: 'rgba(255,255,255,0.07)' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0d0f18' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]
