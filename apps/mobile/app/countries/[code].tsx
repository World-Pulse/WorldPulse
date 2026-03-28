import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { countriesApi } from '@/lib/api'
import { SignalCard } from '@/components/SignalCard'

const COLORS = {
  bg:      '#06070d',
  surface: '#0d0f18',
  border:  'rgba(255,255,255,0.07)',
  amber:   '#f5a623',
  text:    '#e2e6f0',
  text2:   '#8892a4',
  text3:   '#4a5568',
  red:     '#ff3b5c',
}

const SEVERITY_OPTIONS = ['all', 'critical', 'high', 'medium', 'low'] as const
type SeverityFilter = typeof SEVERITY_OPTIONS[number]

export default function CountrySignalsScreen() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const router = useRouter()
  const [severity, setSeverity] = useState<SeverityFilter>('all')

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: ['countries', code, 'signals', severity],
      queryFn: ({ pageParam }) =>
        countriesApi.getSignals(code, {
          cursor: pageParam as string | undefined,
          limit: 20,
          severity: severity === 'all' ? undefined : severity,
        }),
      initialPageParam: undefined,
      getNextPageParam: page => page.data?.cursor ?? undefined,
      enabled: !!code,
    })

  const signals = data?.pages.flatMap(p => p.data?.items ?? []) ?? []

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <>
      <Stack.Screen
        options={{
          title: code?.toUpperCase() ?? 'Country',
          headerStyle: { backgroundColor: '#0d0f18' },
          headerTintColor: COLORS.text,
          headerTitleStyle: { fontWeight: '700', fontSize: 16 },
          headerShadowVisible: false,
        }}
      />

      <View style={styles.container}>
        {/* Severity filter */}
        <View style={styles.filterRow}>
          {SEVERITY_OPTIONS.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.filterBtn, severity === s && styles.filterBtnActive]}
              onPress={() => setSeverity(s)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterText, severity === s && styles.filterTextActive]}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
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
            data={signals}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <SignalCard signal={item} onPress={() => router.push(`/signal/${item.id}`)} />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              isFetchingNextPage ? (
                <ActivityIndicator color={COLORS.amber} style={{ marginVertical: 16 }} />
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No signals for this country</Text>
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

  filterRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, flexWrap: 'wrap',
  },
  filterBtn: {
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  filterBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.12)', borderColor: COLORS.amber,
  },
  filterText: { fontSize: 12, color: COLORS.text3, fontWeight: '600' },
  filterTextActive: { color: COLORS.amber },

  list: { padding: 12, paddingBottom: 32, gap: 8 },
  empty: { paddingTop: 60, alignItems: 'center' },
  emptyText: { fontSize: 14, color: COLORS.text2 },
})
