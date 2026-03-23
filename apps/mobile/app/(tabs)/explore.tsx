import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, FlatList, ActivityIndicator,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { signalsApi, searchApi, type Signal, type UserProfile } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

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

const CATEGORIES = [
  { id: 'breaking',    icon: '🔴', label: 'Breaking',    color: '#ff3b5c' },
  { id: 'conflict',    icon: '⚔️',  label: 'Conflict',    color: '#ef4444' },
  { id: 'geopolitics', icon: '🌐', label: 'Geopolitics', color: '#3b82f6' },
  { id: 'climate',     icon: '🌱', label: 'Climate',     color: '#22c55e' },
  { id: 'health',      icon: '💊', label: 'Health',      color: '#a855f7' },
  { id: 'economy',     icon: '📈', label: 'Economy',     color: '#f5a623' },
  { id: 'technology',  icon: '🔬', label: 'Technology',  color: '#00d4ff' },
  { id: 'elections',   icon: '🗳️', label: 'Elections',   color: '#60a5fa' },
  { id: 'disaster',    icon: '⚠️', label: 'Disaster',    color: '#f97316' },
  { id: 'science',     icon: '🔭', label: 'Science',     color: '#8b5cf6' },
  { id: 'space',       icon: '🚀', label: 'Space',       color: '#06b6d4' },
  { id: 'culture',     icon: '🎭', label: 'Culture',     color: '#ec4899' },
]

type SearchTab = 'signals' | 'users' | 'tags'

export default function ExploreScreen() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [searchTab, setSearchTab] = useState<SearchTab>('signals')
  const debouncedQuery = useDebouncedValue(query, 350)

  const isSearching = debouncedQuery.trim().length > 0

  const { data: recentData } = useQuery({
    queryKey: ['signals', 'explore-recent'],
    queryFn: () => signalsApi.getAll({ limit: 5 }),
    staleTime: 60_000,
    enabled: !isSearching,
  })

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['search', debouncedQuery, searchTab],
    queryFn: () => searchApi.search(debouncedQuery, searchTab),
    staleTime: 30_000,
    enabled: isSearching,
  })

  const recentSignals = recentData?.data?.items ?? []
  const searchResults = searchData?.data

  const handleClear = useCallback(() => setQuery(''), [])

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search signals, people, tags…"
            placeholderTextColor={COLORS.text3}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isSearching ? (
        <View style={{ flex: 1 }}>
          {/* Search type tabs */}
          <View style={styles.tabRow}>
            {(['signals', 'users', 'tags'] as SearchTab[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.tab, searchTab === t && styles.tabActive]}
                onPress={() => setSearchTab(t)}
              >
                <Text style={[styles.tabLabel, searchTab === t && styles.tabLabelActive]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {searchLoading ? (
            <ActivityIndicator color={COLORS.amber} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
              data={
                (searchTab === 'signals' ? (searchResults?.signals ?? []) :
                searchTab === 'users'   ? (searchResults?.users ?? []) :
                                          (searchResults?.tags ?? [])) as (Signal | UserProfile | string)[]
              }
              keyExtractor={(item, idx) =>
                typeof item === 'string' ? item : (item as Signal | UserProfile).id ?? String(idx)
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>No results for "{debouncedQuery}"</Text>
              }
              renderItem={({ item }) => {
                if (searchTab === 'signals') {
                  const sig = item as unknown as Signal
                  return (
                    <TouchableOpacity
                      style={styles.resultCard}
                      onPress={() => router.push(`/signal/${sig.id}`)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.recentHeader}>
                        <Text style={styles.recentCategory}>{sig.category.toUpperCase()}</Text>
                        {sig.locationName && (
                          <Text style={styles.recentLocation}>📍 {sig.locationName}</Text>
                        )}
                      </View>
                      <Text style={styles.recentTitle} numberOfLines={2}>{sig.title}</Text>
                      <View style={styles.recentMeta}>
                        <Text style={styles.recentStat}>🔗 {sig.sourceCount} sources</Text>
                        <Text style={styles.recentStat}>💬 {sig.postCount} posts</Text>
                      </View>
                    </TouchableOpacity>
                  )
                }

                if (searchTab === 'users') {
                  const user = item as unknown as UserProfile
                  return (
                    <TouchableOpacity
                      style={styles.resultCard}
                      onPress={() => router.push(`/users/${user.handle}`)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.userRow}>
                        <View style={styles.userAvatar}>
                          <Text style={styles.userAvatarText}>
                            {user.displayName.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.userNameRow}>
                            <Text style={styles.userName}>{user.displayName}</Text>
                            {user.verified && <Text style={styles.verifiedBadge}>✓</Text>}
                          </View>
                          <Text style={styles.userHandle}>@{user.handle}</Text>
                          {user.bio && (
                            <Text style={styles.userBio} numberOfLines={1}>{user.bio}</Text>
                          )}
                        </View>
                        <Text style={styles.followerCount}>{user.followerCount} followers</Text>
                      </View>
                    </TouchableOpacity>
                  )
                }

                // tags
                const tag = item as unknown as string
                return (
                  <TouchableOpacity
                    style={styles.resultCard}
                    onPress={() => router.push({ pathname: '/(tabs)/', params: { tag } })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.tagItem}># {tag}</Text>
                  </TouchableOpacity>
                )
              }}
            />
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Communities shortcut */}
          <TouchableOpacity
            style={styles.communitiesRow}
            onPress={() => router.push('/communities')}
            activeOpacity={0.7}
          >
            <Text style={styles.communitiesIcon}>🏘️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.communitiesTitle}>Communities</Text>
              <Text style={styles.communitiesSub}>Join topic communities</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* Category grid */}
          <Text style={styles.sectionLabel}>BROWSE BY CATEGORY</Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={styles.categoryCard}
                onPress={() => router.push({ pathname: '/(tabs)/', params: { category: cat.id } })}
                activeOpacity={0.7}
              >
                <Text style={styles.categoryIcon}>{cat.icon}</Text>
                <Text style={[styles.categoryLabel, { color: cat.color }]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Recent signals */}
          <Text style={styles.sectionLabel}>RECENT SIGNALS</Text>
          {recentSignals.map(signal => (
            <TouchableOpacity
              key={signal.id}
              style={styles.recentCard}
              onPress={() => router.push(`/signal/${signal.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.recentHeader}>
                <Text style={styles.recentCategory}>{signal.category.toUpperCase()}</Text>
                {signal.locationName && (
                  <Text style={styles.recentLocation}>📍 {signal.locationName}</Text>
                )}
              </View>
              <Text style={styles.recentTitle} numberOfLines={2}>{signal.title}</Text>
              <View style={styles.recentMeta}>
                <Text style={styles.recentStat}>🔗 {signal.sourceCount} sources</Text>
                <Text style={styles.recentStat}>💬 {signal.postCount} posts</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  searchRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchIcon: {
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  clearBtn: {
    fontSize: 14,
    color: COLORS.text3,
    paddingLeft: 4,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabActive: {
    backgroundColor: COLORS.amber,
    borderColor: COLORS.amber,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text2,
  },
  tabLabelActive: {
    color: '#000',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  communitiesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  communitiesIcon: {
    fontSize: 24,
  },
  communitiesTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  communitiesSub: {
    fontSize: 12,
    color: COLORS.text2,
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: COLORS.text3,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.text3,
    letterSpacing: 2,
    fontFamily: 'monospace',
    marginBottom: 12,
    marginTop: 16,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryCard: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  categoryIcon: {
    fontSize: 24,
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  recentCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  resultCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  recentCategory: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: 'monospace',
    color: COLORS.cyan,
  },
  recentLocation: {
    fontSize: 11,
    color: COLORS.text2,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 8,
  },
  recentMeta: {
    flexDirection: 'row',
    gap: 12,
  },
  recentStat: {
    fontSize: 12,
    color: COLORS.text3,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.text2,
    textAlign: 'center',
    marginTop: 40,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.s2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.amber,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  verifiedBadge: {
    fontSize: 12,
    color: COLORS.cyan,
  },
  userHandle: {
    fontSize: 12,
    color: COLORS.text2,
    marginTop: 1,
  },
  userBio: {
    fontSize: 12,
    color: COLORS.text3,
    marginTop: 2,
  },
  followerCount: {
    fontSize: 11,
    color: COLORS.text3,
    textAlign: 'right',
  },
  tagItem: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.amber,
  },
})
