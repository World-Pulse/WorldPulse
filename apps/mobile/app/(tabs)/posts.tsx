import { useState, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, RefreshControl, TouchableOpacity,
  StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { postsApi, type Post } from '@/lib/api'
import { PostItem } from '@/components/PostItem'
import { Composer } from '@/components/Composer'

type PostsTab = 'global' | 'following'

const TABS: { id: PostsTab; label: string }[] = [
  { id: 'global',    label: 'Global' },
  { id: 'following', label: 'Following' },
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
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <View style={styles.skeletonRow}>
      <View style={styles.skeletonAvatar} />
      <View style={styles.skeletonLines}>
        <View style={[styles.skeletonLine, { width: '40%' }]} />
        <View style={[styles.skeletonLine, { width: '90%', marginTop: 8 }]} />
        <View style={[styles.skeletonLine, { width: '70%', marginTop: 4 }]} />
      </View>
    </View>
  )
}

function LoadingSkeleton() {
  return (
    <View>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PostsScreen() {
  const [activeTab, setActiveTab] = useState<PostsTab>('global')
  const [composerVisible, setComposerVisible] = useState(false)
  const flatListRef = useRef<FlatList<Post>>(null)
  const queryClient = useQueryClient()

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
    queryKey: ['posts', activeTab],
    queryFn: ({ pageParam }) =>
      postsApi.getFeed({ tab: activeTab, cursor: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => lastPage.data?.cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  })

  const likeMutation = useMutation({
    mutationFn: (id: string) => postsApi.like(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts', activeTab] })
    },
  })

  const boostMutation = useMutation({
    mutationFn: (id: string) => postsApi.boost(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts', activeTab] })
    },
  })

  const allPosts = data?.pages.flatMap(p => p.data?.items ?? []) ?? []

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleRefresh = useCallback(() => { refetch() }, [refetch])

  const renderItem = useCallback(({ item }: { item: Post }) => (
    <PostItem
      post={item}
      onLike={(id) => likeMutation.mutate(id)}
      onBoost={(id) => boostMutation.mutate(id)}
    />
  ), [likeMutation, boostMutation])

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
      {/* Subtab bar */}
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
      </View>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load posts</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={allPosts}
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
              <Ionicons name="globe-outline" size={48} color={COLORS.text3} />
              <Text style={styles.emptyTitle}>No posts yet</Text>
              <Text style={styles.emptySubtitle}>
                Be the first to share intelligence
              </Text>
            </View>
          }
          contentContainerStyle={allPosts.length === 0 ? styles.emptyList : styles.listContent}
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
        <Ionicons name="add" size={28} color="#000" />
      </TouchableOpacity>

      <Composer
        visible={composerVisible}
        onClose={() => {
          setComposerVisible(false)
          queryClient.invalidateQueries({ queryKey: ['posts', activeTab] })
        }}
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
  listContent: {
    paddingHorizontal: 16,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
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
  // Skeleton
  skeletonRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  skeletonAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.s2,
  },
  skeletonLines: {
    flex: 1,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.s2,
  },
})
