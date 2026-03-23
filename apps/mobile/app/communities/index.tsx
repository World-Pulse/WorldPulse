import { useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { communitiesApi, type Community } from '@/lib/api'
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
  cyan:    '#00d4ff',
}

type SortOption = 'members' | 'posts' | 'trending' | 'newest'

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'members',  label: 'Popular' },
  { id: 'trending', label: 'Trending' },
  { id: 'newest',   label: 'Newest' },
]

export default function CommunitiesScreen() {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<SortOption>('members')
  const debouncedSearch = useDebouncedValue(searchQuery, 350)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['communities', debouncedSearch, sort],
    queryFn: () => communitiesApi.getAll({
      search: debouncedSearch || undefined,
      sort,
      limit: 50,
    }),
    staleTime: 60_000,
  })

  const communities = data?.data ?? []

  function renderItem({ item }: { item: Community }) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/communities/${item.slug}`)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.communityName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.communitySlug}>/{item.slug}</Text>
          </View>
          {item.isMember && (
            <View style={styles.memberBadge}>
              <Text style={styles.memberBadgeText}>JOINED</Text>
            </View>
          )}
        </View>

        {item.description && (
          <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
        )}

        <View style={styles.stats}>
          <Text style={styles.stat}>👥 {item.memberCount.toLocaleString()} members</Text>
          <Text style={styles.stat}>💬 {item.postCount.toLocaleString()} posts</Text>
        </View>

        {item.categories.length > 0 && (
          <View style={styles.chips}>
            {item.categories.slice(0, 3).map(cat => (
              <View key={cat} style={styles.chip}>
                <Text style={styles.chipText}>{cat}</Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search communities…"
            placeholderTextColor={COLORS.text3}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {/* Sort tabs */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.id}
            style={[styles.sortTab, sort === opt.id && styles.sortTabActive]}
            onPress={() => setSort(opt.id)}
          >
            <Text style={[styles.sortLabel, sort === opt.id && styles.sortLabelActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={COLORS.amber} style={{ marginTop: 40 }} />
      ) : isError ? (
        <Text style={styles.errorText}>Failed to load communities</Text>
      ) : (
        <FlatList
          data={communities}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No communities found</Text>
          }
          showsVerticalScrollIndicator={false}
        />
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
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  sortTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sortTabActive: {
    backgroundColor: COLORS.amber,
    borderColor: COLORS.amber,
  },
  sortLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text2,
  },
  sortLabelActive: {
    color: '#000',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.s2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.amber,
  },
  communityName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  communitySlug: {
    fontSize: 12,
    color: COLORS.text3,
    marginTop: 1,
  },
  memberBadge: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    borderWidth: 1,
    borderColor: COLORS.cyan,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  memberBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.cyan,
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  description: {
    fontSize: 13,
    color: COLORS.text2,
    lineHeight: 19,
    marginBottom: 8,
  },
  stats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  stat: {
    fontSize: 12,
    color: COLORS.text3,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: COLORS.s2,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 11,
    color: COLORS.text2,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.text2,
    textAlign: 'center',
    marginTop: 40,
  },
  errorText: {
    fontSize: 14,
    color: '#ff3b5c',
    textAlign: 'center',
    marginTop: 40,
  },
})
