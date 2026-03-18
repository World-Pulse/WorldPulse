import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { signalsApi } from '@/lib/api'

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
  { id: 'disaster',    icon: '⚠️', label: 'Disaster',   color: '#f97316' },
  { id: 'science',     icon: '🔭', label: 'Science',     color: '#8b5cf6' },
  { id: 'space',       icon: '🚀', label: 'Space',       color: '#06b6d4' },
  { id: 'culture',     icon: '🎭', label: 'Culture',     color: '#ec4899' },
]

export default function ExploreScreen() {
  const router = useRouter()

  const { data: recentData } = useQuery({
    queryKey: ['signals', 'explore-recent'],
    queryFn: () => signalsApi.getAll({ limit: 5 }),
    staleTime: 60_000,
  })

  const recentSignals = recentData?.data?.items ?? []

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

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
            <Text style={[
              styles.recentCategory,
              { color: COLORS.cyan }
            ]}>
              {signal.category.toUpperCase()}
            </Text>
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
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
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
})
