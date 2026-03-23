import { useState } from 'react'
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator, Alert, Image,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, type Post } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
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
}

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  journalist: '#f5a623',
  official:   '#00d4ff',
  expert:     '#8b5cf6',
  ai:         '#22c55e',
  community:  '#ec4899',
}

export default function UserProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>()
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuthStore()
  const [postCursor, setPostCursor] = useState<string | null>(null)
  const [allPosts, setAllPosts] = useState<Post[]>([])

  const { data: profileData, isLoading, isError } = useQuery({
    queryKey: ['user-profile', handle],
    queryFn: () => usersApi.getProfile(handle),
    staleTime: 60_000,
    enabled: !!handle,
  })

  const { data: postsData, isFetching: postsFetching } = useQuery({
    queryKey: ['user-posts', handle, postCursor],
    queryFn: async () => {
      const res = await usersApi.getPosts(handle, { limit: 20, cursor: postCursor ?? undefined })
      setAllPosts(prev => postCursor ? [...prev, ...(res.data?.items ?? [])] : (res.data?.items ?? []))
      return res
    },
    staleTime: 30_000,
    enabled: !!handle,
  })

  const followMutation = useMutation({
    mutationFn: () => usersApi.follow(handle),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-profile', handle] }),
    onError: () => Alert.alert('Error', 'Failed to follow user'),
  })

  const unfollowMutation = useMutation({
    mutationFn: () => usersApi.unfollow(handle),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-profile', handle] }),
    onError: () => Alert.alert('Error', 'Failed to unfollow user'),
  })

  const profile = profileData?.data
  const isOwnProfile = currentUser?.handle === handle
  const hasMore = postsData?.data?.hasMore ?? false
  const nextCursor = postsData?.data?.cursor ?? null

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.amber} />
      </View>
    )
  }

  if (isError || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>User not found</Text>
      </View>
    )
  }

  const typeColor = ACCOUNT_TYPE_COLORS[profile.accountType] ?? COLORS.text3

  return (
    <FlatList
      style={styles.container}
      data={allPosts}
      keyExtractor={item => item.id}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View>
          {/* Avatar header */}
          <View style={styles.header}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {profile.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            <View style={styles.nameBlock}>
              <View style={styles.nameRow}>
                <Text style={styles.displayName}>{profile.displayName}</Text>
                {profile.verified && <Text style={styles.verifiedIcon}>✓</Text>}
              </View>
              <Text style={styles.handleText}>@{profile.handle}</Text>
              {profile.accountType !== 'community' && (
                <View style={[styles.typeBadge, { borderColor: typeColor }]}>
                  <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                    {profile.accountType.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            {!isOwnProfile && (
              <TouchableOpacity
                style={[styles.followBtn, profile.isFollowing && styles.followingBtn]}
                onPress={() => {
                  if (profile.isFollowing) {
                    unfollowMutation.mutate()
                  } else {
                    followMutation.mutate()
                  }
                }}
                disabled={followMutation.isPending || unfollowMutation.isPending}
              >
                {(followMutation.isPending || unfollowMutation.isPending) ? (
                  <ActivityIndicator size="small" color={profile.isFollowing ? COLORS.text2 : '#000'} />
                ) : (
                  <Text style={[styles.followBtnText, profile.isFollowing && styles.followingBtnText]}>
                    {profile.isFollowing ? 'Following' : 'Follow'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Bio */}
          {profile.bio && (
            <Text style={styles.bio}>{profile.bio}</Text>
          )}

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profile.followerCount.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profile.followingCount.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profile.signalCount.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Signals</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{(profile.trustScore * 100).toFixed(0)}%</Text>
              <Text style={styles.statLabel}>Trust</Text>
            </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.amber,
  },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.s2,
    borderWidth: 2,
    borderColor: COLORS.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.amber,
  },
  nameBlock: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  displayName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  verifiedIcon: {
    fontSize: 14,
    color: COLORS.cyan,
  },
  handleText: {
    fontSize: 13,
    color: COLORS.text3,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  followBtn: {
    backgroundColor: COLORS.amber,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  followingBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  followBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
  followingBtnText: {
    color: COLORS.text2,
  },
  bio: {
    fontSize: 14,
    color: COLORS.text2,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
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
    height: 28,
    backgroundColor: COLORS.border,
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
