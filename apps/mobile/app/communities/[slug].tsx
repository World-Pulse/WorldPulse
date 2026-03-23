import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { communitiesApi, type Post } from '@/lib/api'
import { PostItem } from '@/components/PostItem'

const COLORS = {
  bg:      '#06070d',
  surface: '#0d0f18',
  s2:      '#141722',
  border:  'rgba(255,255,255,0.07)',
  amber:   '#f5a623',
  text:    '#e2e6f0',
  text2:   '#8892a4',
  text3:   '#4a5568',
  cyan:    '#00d4ff',
  green:   '#00e676',
}

export default function CommunityDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [postCursor, setPostCursor] = useState<string | null>(null)
  const [allPosts, setAllPosts] = useState<Post[]>([])

  const { data: communityData, isLoading, isError } = useQuery({
    queryKey: ['community', slug],
    queryFn: () => communitiesApi.getBySlug(slug),
    staleTime: 60_000,
    enabled: !!slug,
  })

  const { data: postsData, isFetching: postsFetching } = useQuery({
    queryKey: ['community-posts', slug, postCursor],
    queryFn: async () => {
      const res = await communitiesApi.getPosts(slug, { limit: 20, cursor: postCursor ?? undefined })
      setAllPosts(prev => postCursor ? [...prev, ...(res.data?.items ?? [])] : (res.data?.items ?? []))
      return res
    },
    staleTime: 30_000,
    enabled: !!slug,
  })

  const joinMutation = useMutation({
    mutationFn: () => communitiesApi.join(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community', slug] })
      queryClient.invalidateQueries({ queryKey: ['communities'] })
    },
    onError: () => Alert.alert('Error', 'Failed to join community'),
  })

  const leaveMutation = useMutation({
    mutationFn: () => communitiesApi.leave(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community', slug] })
      queryClient.invalidateQueries({ queryKey: ['communities'] })
    },
    onError: () => Alert.alert('Error', 'Failed to leave community'),
  })

  const community = communityData?.data
  const hasMore = postsData?.data?.hasMore ?? false
  const nextCursor = postsData?.data?.cursor ?? null

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.amber} />
      </View>
    )
  }

  if (isError || !community) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Community not found</Text>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.container}
      data={allPosts}
      keyExtractor={item => item.id}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View>
          {/* Banner placeholder */}
          <View style={styles.banner}>
            <Text style={styles.bannerInitial}>{community.name.charAt(0).toUpperCase()}</Text>
          </View>

          {/* Community info */}
          <View style={styles.info}>
            <View style={styles.infoHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{community.name}</Text>
                <Text style={styles.slugText}>/{community.slug}</Text>
              </View>
              <TouchableOpacity
                style={[styles.joinBtn, community.isMember && styles.leaveBtn]}
                onPress={() => {
                  if (community.isMember) {
                    Alert.alert(
                      'Leave community',
                      `Leave ${community.name}?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Leave', style: 'destructive', onPress: () => leaveMutation.mutate() },
                      ],
                    )
                  } else {
                    joinMutation.mutate()
                  }
                }}
                disabled={joinMutation.isPending || leaveMutation.isPending}
              >
                {(joinMutation.isPending || leaveMutation.isPending) ? (
                  <ActivityIndicator size="small" color={community.isMember ? COLORS.text2 : '#000'} />
                ) : (
                  <Text style={[styles.joinBtnText, community.isMember && styles.leaveBtnText]}>
                    {community.isMember ? 'Leave' : 'Join'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {community.description && (
              <Text style={styles.description}>{community.description}</Text>
            )}

            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{community.memberCount.toLocaleString()}</Text>
                <Text style={styles.statLabel}>Members</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{community.postCount.toLocaleString()}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </View>
            </View>

            {community.categories.length > 0 && (
              <View style={styles.chips}>
                {community.categories.map(cat => (
                  <View key={cat} style={styles.chip}>
                    <Text style={styles.chipText}>{cat}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <Text style={styles.postsLabel}>POSTS</Text>
        </View>
      }
      renderItem={({ item }) => (
        <PostItem
          post={item}
          onLike={() => {}}
          onReply={() => {}}
        />
      )}
      ListEmptyComponent={
        !postsFetching ? (
          <Text style={styles.emptyText}>No posts yet</Text>
        ) : null
      }
      ListFooterComponent={
        hasMore ? (
          <TouchableOpacity
            style={styles.loadMore}
            onPress={() => setPostCursor(nextCursor)}
            disabled={postsFetching}
          >
            {postsFetching ? (
              <ActivityIndicator size="small" color={COLORS.amber} />
            ) : (
              <Text style={styles.loadMoreText}>Load more</Text>
            )}
          </TouchableOpacity>
        ) : null
      }
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
  errorText: {
    fontSize: 14,
    color: '#ff3b5c',
  },
  banner: {
    height: 100,
    backgroundColor: COLORS.s2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerInitial: {
    fontSize: 48,
    fontWeight: '700',
    color: COLORS.amber,
    opacity: 0.3,
  },
  info: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  slugText: {
    fontSize: 13,
    color: COLORS.text3,
    marginTop: 2,
  },
  joinBtn: {
    backgroundColor: COLORS.amber,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  joinBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
  leaveBtnText: {
    color: COLORS.text2,
  },
  description: {
    fontSize: 14,
    color: COLORS.text2,
    lineHeight: 20,
    marginBottom: 12,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.text3,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: COLORS.s2,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 12,
    color: COLORS.text2,
  },
  postsLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.text3,
    letterSpacing: 2,
    fontFamily: 'monospace',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.text2,
    textAlign: 'center',
    padding: 32,
  },
  loadMore: {
    alignItems: 'center',
    padding: 16,
  },
  loadMoreText: {
    fontSize: 13,
    color: COLORS.amber,
    fontWeight: '600',
  },
})
