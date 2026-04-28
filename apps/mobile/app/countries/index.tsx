import { useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, RefreshControl,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { countriesApi, type CountrySummary } from '@/lib/api'

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

const TIME_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: '6h',  hours: 6  },
  { label: '24h', hours: 24 },
  { label: '3d',  hours: 72 },
  { label: '7d',  hours: 168 },
]

function severityBar(critical: number, high: number, total: number) {
  const critPct = total > 0 ? critical / total : 0
  const highPct = total > 0 ? high / total : 0

  return (
    <View style={styles.severityBar}>
      {critPct > 0 && (
        <View style={[styles.severitySegment, { flex: critPct, backgroundColor: COLORS.red }]} />
      )}
      {highPct > 0 && (
        <View style={[styles.severitySegment, { flex: highPct, backgroundColor: COLORS.amber }]} />
      )}
      <View style={[styles.severitySegment, { flex: Math.max(0.01, 1 - critPct - highPct), backgroundColor: COLORS.s2 }]} />
    </View>
  )
}

function CountryCard({ country, onPress }: { country: CountrySummary; onPress: () => void }) {
  const hasCritical = country.criticalCount > 0

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardLeft}>
        <Text style={styles.countryCode}>{country.countryCode}</Text>
        {hasCritical && <View style={styles.criticalDot} />}
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.countryName} numberOfLines={1}>{country.countryName}</Text>
          {country.topCategory && (
            <View style={styles.categoryChip}>
              <Text style={styles.categoryText}>{country.topCategory.toUpperCase()}</Text>
            </View>
          )}
        </View>

        {severityBar(country.criticalCount, country.highCount, country.signalCount)}

        <View style={styles.cardMeta}>
          <Text style={styles.signalCount}>{country.signalCount} signals</Text>
          {country.criticalCount > 0 && (
            <Text style={[styles.criticalCount, { color: COLORS.red }]}>
              {country.criticalCount} critical
            </Text>
          )}
          {country.latestSignalAt && (
            <Text style={styles.timeAgo}>
              {relativeTime(country.latestSignalAt)}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m  = Math.floor(ms / 60_000)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function CountriesScreen() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [hours, setHours] = useState(24)
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['countries', hours],
    queryFn: () => countriesApi.getAll({ hours }),
    staleTime: 60_000,
  })

  const countries = (data?.data ?? []).filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.countryCode.toLowerCase().includes(q) ||
      c.countryName.toLowerCase().includes(q)
    )
  })

  async function onRefresh() {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Countries',
          headerStyle: { backgroundColor: '#0d0f18' },
          headerTintColor: COLORS.text,
          headerTitleStyle: { fontWeight: '700', fontSize: 16 },
          headerShadowVisible: false,
        }}
      />

      <View style={styles.container}>
        {/* Search */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search countries..."
            placeholderTextColor={COLORS.text3}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {/* Time filter */}
        <View style={styles.timeFilter}>
          {TIME_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.label}
              style={[styles.timeBtn, hours === opt.hours && styles.timeBtnActive]}
              onPress={() => setHours(opt.hours)}
              activeOpacity={0.7}
            >
              <Text style={[styles.timeBtnText, hours === opt.hours && styles.timeBtnTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={COLORS.amber} />
          </View>
        ) : (
          <FlatList
            data={countries}
            keyExtractor={item => item.countryCode}
            renderItem={({ item }) => (
              <CountryCard
                country={item}
                onPress={() => router.push(`/countries/${item.countryCode}`)}
              />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={COLORS.amber}
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No countries found</Text>
              </View>
            }
          />
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  searchRow: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  searchInput: {
    backgroundColor: COLORS.s2, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: COLORS.text,
  },

  timeFilter: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  timeBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  timeBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.12)', borderColor: COLORS.amber,
  },
  timeBtnText: { fontSize: 12, color: COLORS.text3, fontWeight: '600' },
  timeBtnTextActive: { color: COLORS.amber },

  list: { padding: 12, gap: 8, paddingBottom: 32 },

  card: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, flexDirection: 'row', overflow: 'hidden',
  },
  cardLeft: {
    width: 52, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.s2, gap: 6,
  },
  countryCode: {
    fontSize: 13, fontWeight: '800', color: COLORS.text, fontFamily: 'monospace',
  },
  criticalDot: {
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.red,
  },

  cardBody: { flex: 1, padding: 12, gap: 7 },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  countryName: { fontSize: 15, fontWeight: '700', color: COLORS.text, flex: 1 },
  categoryChip: {
    backgroundColor: 'rgba(0,212,255,0.1)', borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.2)', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  categoryText: {
    fontSize: 9, color: COLORS.cyan, fontWeight: '700',
    letterSpacing: 1, fontFamily: 'monospace',
  },

  severityBar: {
    height: 4, borderRadius: 2, flexDirection: 'row', overflow: 'hidden',
  },
  severitySegment: { height: '100%' },

  cardMeta: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  signalCount: { fontSize: 12, color: COLORS.text3 },
  criticalCount: { fontSize: 12, fontWeight: '700' },
  timeAgo: { fontSize: 12, color: COLORS.text3, marginLeft: 'auto' },

  empty: { paddingTop: 60, alignItems: 'center' },
  emptyText: { fontSize: 14, color: COLORS.text2 },
})
