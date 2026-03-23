import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View, Text, FlatList, RefreshControl, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native'
import { useInfiniteQuery } from '@tanstack/react-query'
import { feedApi, type Signal } from '@/lib/api'
import { SignalCard } from '@/components/SignalCard'
import { Composer } from '@/components/Composer'

type FeedTab = 'global' | 'following' | 'verified'

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'global',   label: 'Global' },
  { id: 'following', label: 'Following' },
  { id: 'verified', label: 'Verified' },
]

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
}

const wsRef: { current: WebSocket | null } = { current: null }

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState<FeedTab>('global')
  const [wsSignals, setWsSignals] = useState<Signal[]>([])
  const [composerVisible, setComposerVisible] = useState(false)
  const flatListRef = useRef<FlatList>(null)

  const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001'
  const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws'

  // Fetch feed
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['feed', activeTab],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = {}
      if (pageParam) params.cursor = pageParam as string

      if (activeTab === 'global') {
        return feedApi.getGlobal(params)
      } else if (activeTab === 'following') {
        return feedApi.getFollowing(params)
      } else {
        return feedApi.getGlobal({ ...params, status: 'verified' })
      }
    },
    getNextPageParam: (lastPage) => lastPage.data?.cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  })

  // WebSocket for real-time signals
  useEffect(() => {
    if (activeTab !== 'global') return

    try {
      wsRef.current = new WebSocket(WS_URL)

      wsRef.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.event === 'signal.new' && msg.payload) {
            setWsSignals(prev => [msg.payload as Signal, ...prev.slice(0, 4)])
          }
        } catch { /* ignore malformed messages */ }
      }

      wsRef.current.onerror = () => { /* silently fail */ }
    } catch { /* silently fail */ }

    return () => {
      wsRef.current?.close()
      wsRef.current = null
      setWsSignals([])
    }
  }, [activeTab])

  const allSignals = [
    ...wsSignals,
    ...(data?.pages.flatMap(p => p.data?.items ?? []) ?? []),
  ]

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleRefresh = useCallback(() => {
    setWsSignals([])
    refetch()
  }, [refetch])

  const renderItem = useCallback(({ item }: { item: Signal }) => (
    <SignalCard signal={item} />
  ), [])

  const renderFooter = () => {
    if (!isFetchingNextPage) return null
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={COLORS.amber} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Live indicator */}
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* New signals notification bar */}
      {wsSignals.length > 0 && (
        <TouchableOpacity
          style={styles.newSignalsBar}
          onPress={() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.newSignalsText}>
            {wsSignals.length} new signal{wsSignals.length > 1 ? 's' : ''} — tap to view
          </Text>
        </TouchableOpacity>
      )}

      {/* Feed */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.amber} />
          <Text style={styles.loadingText}>Loading signals…</Text>
        </View>
      ) : isError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load feed</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={allSignals}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor={COLORS.amber}
              colors={[COLORS.amber]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>⚡</Text>
              <Text style={styles.emptyTitle}>No signals found</Text>
              <Text style={styles.emptySubtitle}>Check back shortly for the latest global events</Text>
            </View>
          }
          contentContainerStyle={allSignals.length === 0 ? styles.emptyList : undefined}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={10}
          removeClippedSubviews
        />
      )}

      {/* Compose FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setComposerVisible(true)}
        activeOpacity={0.85}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      <Composer
        visible={composerVisible}
        onClose={() => setComposerVisible(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.amber,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text3,
  },
  tabTextActive: {
    color: COLORS.amber,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    backgroundColor: 'rgba(255,59,92,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,92,0.3)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.red,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.red,
    letterSpacing: 1.5,
    fontFamily: 'monospace',
  },
  newSignalsBar: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,166,35,0.3)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  newSignalsText: {
    fontSize: 13,
    color: COLORS.amber,
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: COLORS.text2,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  errorText: {
    color: COLORS.text2,
    fontSize: 15,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.amber,
  },
  retryButtonText: {
    color: COLORS.amber,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyList: {
    flex: 1,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.text2,
    textAlign: 'center',
    maxWidth: 260,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.amber,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.amber,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 28,
    fontWeight: '300',
    color: '#000',
    lineHeight: 32,
  },
})
