import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal,
  Pressable, ActivityIndicator,
} from 'react-native'
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from 'react-native-maps'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { signalsApi, type Signal } from '@/lib/api'

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
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#00d4ff',
  low:      '#00e676',
  info:     '#8892a4',
}

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

export default function MapScreen() {
  const router = useRouter()
  const [selectedSignal, setSelectedSignal] = useState<Signal & { lng: number; lat: number } | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('24')

  const { data, isLoading } = useQuery({
    queryKey: ['signals', 'map', categoryFilter, timeFilter],
    queryFn: () => signalsApi.getMapPoints({
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      hours: Number(timeFilter),
    }),
    refetchInterval: 60_000,
  })

  const points = data?.data ?? []

  const handleMarkerPress = useCallback((signal: Signal & { lng: number; lat: number }) => {
    setSelectedSignal(signal)
    setSheetVisible(true)
  }, [])

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        customMapStyle={darkMapStyle}
        initialRegion={{
          latitude: 20,
          longitude: 0,
          latitudeDelta: 80,
          longitudeDelta: 120,
        }}
        showsUserLocation
        showsCompass={false}
      >
        {points.map(point => (
          <Marker
            key={point.id}
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
      </MapView>

      {/* Filter bar */}
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

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={COLORS.amber} />
        </View>
      )}

      {/* Signal count */}
      <View style={styles.countBadge}>
        <Text style={styles.countText}>{points.length} signals</Text>
      </View>

      {/* Bottom sheet */}
      <Modal
        visible={sheetVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSheetVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSheetVisible(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            {selectedSignal && (
              <>
                {/* Handle */}
                <View style={styles.sheetHandle} />

                {/* Severity */}
                <View style={styles.sheetHeader}>
                  <View style={[
                    styles.severityDot,
                    { backgroundColor: SEVERITY_COLORS[selectedSignal.severity] ?? COLORS.amber }
                  ]} />
                  <Text style={[styles.severityText, { color: SEVERITY_COLORS[selectedSignal.severity] ?? COLORS.amber }]}>
                    {selectedSignal.severity.toUpperCase()}
                  </Text>
                  <Text style={styles.categoryText}>{selectedSignal.category.toUpperCase()}</Text>
                </View>

                {/* Title */}
                <Text style={styles.sheetTitle} numberOfLines={3}>
                  {selectedSignal.title}
                </Text>

                {/* Location */}
                {selectedSignal.locationName && (
                  <Text style={styles.sheetLocation}>📍 {selectedSignal.locationName}</Text>
                )}

                {/* Stats */}
                <View style={styles.sheetStats}>
                  <Text style={styles.statItem}>
                    🔗 {selectedSignal.sourceCount} source{selectedSignal.sourceCount !== 1 ? 's' : ''}
                  </Text>
                  <Text style={styles.statItem}>
                    💬 {selectedSignal.postCount} posts
                  </Text>
                  {selectedSignal.reliabilityScore > 0 && (
                    <Text style={styles.statItem}>
                      ✓ {Math.round(selectedSignal.reliabilityScore * 100)}% reliable
                    </Text>
                  )}
                </View>

                {/* CTA */}
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
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  map: { flex: 1 },
  marker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  filterBar: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    gap: 8,
  },
  filterScroll: {
    gap: 6,
    paddingRight: 12,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(13,15,24,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  filterChipActive: {
    backgroundColor: 'rgba(245,166,35,0.2)',
    borderColor: '#f5a623',
  },
  filterChipText: {
    fontSize: 12,
    color: COLORS.text2,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: COLORS.amber,
  },
  timePicker: {
    flexDirection: 'row',
    gap: 4,
    alignSelf: 'flex-start',
  },
  timeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(13,15,24,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  timeChipActive: {
    backgroundColor: 'rgba(0,212,255,0.15)',
    borderColor: COLORS.cyan,
  },
  timeChipText: {
    fontSize: 11,
    color: COLORS.text3,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  timeChipTextActive: {
    color: COLORS.cyan,
  },
  loadingOverlay: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(13,15,24,0.9)',
    borderRadius: 20,
    padding: 10,
  },
  countBadge: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    backgroundColor: 'rgba(13,15,24,0.9)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  countText: {
    color: COLORS.text2,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  severityText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  categoryText: {
    fontSize: 11,
    color: COLORS.text3,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: 8,
  },
  sheetLocation: {
    fontSize: 13,
    color: COLORS.text2,
    marginBottom: 12,
  },
  sheetStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statItem: {
    fontSize: 12,
    color: COLORS.text2,
  },
  sheetButton: {
    backgroundColor: COLORS.amber,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  sheetButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
})

// Dark map style for Google Maps
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
