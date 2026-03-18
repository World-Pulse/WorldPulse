import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Share, FlatList, ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, Stack } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { signalsApi, type Post } from '@/lib/api'
import { SeverityBadge } from '@/components/SeverityBadge'
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
  red:     '#ff3b5c',
  cyan:    '#00d4ff',
  green:   '#00e676',
}

export default function SignalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [postsSort, setPostsSort] = useState<'recent' | 'top'>('recent')

  const { data: signalData, isLoading: signalLoading } = useQuery({
    queryKey: ['signal', id],
    queryFn: () => signalsApi.getById(id),
    enabled: !!id,
  })

  const { data: postsData, isLoading: postsLoading } = useQuery({
    queryKey: ['signal', id, 'posts', postsSort],
    queryFn: () => signalsApi.getPosts(id, { limit: 20 }),
    enabled: !!id,
  })

  const signal = signalData?.data
  const posts = postsData?.data?.items ?? []

  async function handleShare() {
    if (!signal) return
    await Share.share({
      title: signal.title,
      message: `${signal.title}\n\nVia WorldPulse: https://worldpulse.io/signal/${id}`,
      url: `https://worldpulse.io/signal/${id}`,
    })
  }

  if (signalLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.amber} />
      </View>
    )
  }

  if (!signal) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Signal not found</Text>
      </View>
    )
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: signal.category.toUpperCase(),
          headerRight: () => (
            <TouchableOpacity onPress={handleShare} activeOpacity={0.7} style={{ padding: 4 }}>
              <Text style={{ fontSize: 16 }}>⬆️</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Severity + category */}
        <View style={styles.tagRow}>
          <SeverityBadge severity={signal.severity} />
          <View style={styles.categoryPill}>
            <Text style={styles.categoryPillText}>{signal.category.toUpperCase()}</Text>
          </View>
          {signal.countryCode && (
            <Text style={styles.countryCode}>{signal.countryCode}</Text>
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{signal.title}</Text>

        {/* Location */}
        {signal.locationName && (
          <Text style={styles.location}>📍 {signal.locationName}</Text>
        )}

        {/* Reliability bar */}
        {signal.reliabilityScore > 0 && (
          <View style={styles.reliabilityRow}>
            <Text style={styles.reliabilityLabel}>RELIABILITY</Text>
            <View style={styles.reliabilityBar}>
              <View
                style={[
                  styles.reliabilityFill,
                  { width: `${signal.reliabilityScore * 100}%` }
                ]}
              />
            </View>
            <Text style={styles.reliabilityValue}>
              {Math.round(signal.reliabilityScore * 100)}%
            </Text>
          </View>
        )}

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>SUMMARY</Text>
          <Text style={styles.summaryText}>{signal.summary}</Text>
        </View>

        {/* Sources */}
        {signal.sources && signal.sources.length > 0 && (
          <View style={styles.sourcesSection}>
            <Text style={styles.sectionLabel}>SOURCES ({signal.sourceCount})</Text>
            <View style={styles.sourcePills}>
              {(signal.sources as Array<{ name: string; tier: string }>).map((src, i) => (
                <View key={i} style={styles.sourcePill}>
                  <Text style={styles.sourcePillText}>{src.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBlock}>
            <Text style={styles.statNum}>{signal.viewCount.toLocaleString()}</Text>
            <Text style={styles.statLbl}>views</Text>
          </View>
          <View style={styles.statBlock}>
            <Text style={styles.statNum}>{signal.postCount.toLocaleString()}</Text>
            <Text style={styles.statLbl}>posts</Text>
          </View>
          <View style={styles.statBlock}>
            <Text style={styles.statNum}>{signal.sourceCount}</Text>
            <Text style={styles.statLbl}>sources</Text>
          </View>
        </View>

        {/* Tags */}
        {signal.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {signal.tags.map(tag => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Verifications */}
        {signal.verifications && signal.verifications.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>VERIFICATION LOG</Text>
            {(signal.verifications as Array<{ check_type: string; result: string; confidence: number; notes: string }>)
              .map((v, i) => (
                <View key={i} style={styles.verificationItem}>
                  <View style={[
                    styles.verificationDot,
                    { backgroundColor: v.result === 'confirmed' ? COLORS.green : COLORS.red }
                  ]} />
                  <View style={styles.verificationText}>
                    <Text style={styles.verificationCheckType}>{v.check_type.replace('_', ' ').toUpperCase()}</Text>
                    {v.notes && <Text style={styles.verificationNotes}>{v.notes}</Text>}
                  </View>
                  {v.confidence != null && (
                    <Text style={styles.verificationConfidence}>
                      {Math.round(v.confidence * 100)}%
                    </Text>
                  )}
                </View>
              ))}
          </View>
        )}

        {/* Discussion */}
        <View style={styles.section}>
          <View style={styles.discussionHeader}>
            <Text style={styles.sectionLabel}>DISCUSSION ({signal.postCount})</Text>
            <View style={styles.sortPicker}>
              {(['recent', 'top'] as const).map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setPostsSort(s)}
                  style={[styles.sortBtn, postsSort === s && styles.sortBtnActive]}
                >
                  <Text style={[styles.sortBtnText, postsSort === s && styles.sortBtnTextActive]}>
                    {s === 'recent' ? 'Recent' : 'Top'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {postsLoading ? (
            <ActivityIndicator size="small" color={COLORS.amber} style={{ marginTop: 16 }} />
          ) : posts.length === 0 ? (
            <Text style={styles.noPosts}>No posts yet. Be the first to discuss this signal.</Text>
          ) : (
            posts.map(post => <PostItem key={post.id} post={post} />)
          )}
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content:   { padding: 16, paddingBottom: 40 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  errorText: { color: COLORS.text2, fontSize: 16 },

  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  categoryPill: {
    backgroundColor: 'rgba(0,212,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.2)',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  categoryPillText: { fontSize: 9, color: COLORS.cyan, fontWeight: '700', letterSpacing: 1.5, fontFamily: 'monospace' },
  countryCode: { fontSize: 12, color: COLORS.text3, fontFamily: 'monospace', marginLeft: 'auto' },

  title:    { fontSize: 20, fontWeight: '700', color: COLORS.text, lineHeight: 28, marginBottom: 8 },
  location: { fontSize: 13, color: COLORS.text2, marginBottom: 14 },

  reliabilityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16,
  },
  reliabilityLabel: { fontSize: 9, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5 },
  reliabilityBar: {
    flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.s2, overflow: 'hidden',
  },
  reliabilityFill: { height: '100%', backgroundColor: COLORS.green, borderRadius: 2 },
  reliabilityValue: { fontSize: 11, color: COLORS.green, fontFamily: 'monospace', fontWeight: '700' },

  summaryCard: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, padding: 14, marginBottom: 14,
  },
  summaryLabel: {
    fontSize: 9, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 8,
  },
  summaryText: { fontSize: 14, color: COLORS.text2, lineHeight: 21 },

  sourcesSection: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 9, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 8,
  },
  sourcePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sourcePill: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5,
  },
  sourcePillText: { fontSize: 12, color: COLORS.text2, fontWeight: '600' },

  statsRow: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderWidth: 1,
    borderColor: COLORS.border, borderRadius: 12, marginBottom: 14,
  },
  statBlock: { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 2 },
  statNum:   { fontSize: 16, fontWeight: '700', color: COLORS.text },
  statLbl:   { fontSize: 11, color: COLORS.text3, fontFamily: 'monospace' },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  tag: {
    backgroundColor: 'rgba(245,166,35,0.08)', borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)', borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  tagText: { fontSize: 12, color: COLORS.amber },

  section: { marginBottom: 16 },
  verificationItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 8, padding: 12, marginBottom: 6,
  },
  verificationDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  verificationText: { flex: 1, gap: 2 },
  verificationCheckType: { fontSize: 11, color: COLORS.text, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 0.5 },
  verificationNotes: { fontSize: 12, color: COLORS.text2 },
  verificationConfidence: { fontSize: 12, color: COLORS.green, fontFamily: 'monospace', fontWeight: '700' },

  discussionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sortPicker: { flexDirection: 'row', gap: 4 },
  sortBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sortBtnActive: { backgroundColor: 'rgba(0,212,255,0.1)', borderColor: COLORS.cyan },
  sortBtnText: { fontSize: 12, color: COLORS.text3, fontWeight: '600' },
  sortBtnTextActive: { color: COLORS.cyan },

  noPosts: { fontSize: 14, color: COLORS.text2, textAlign: 'center', paddingTop: 16, paddingBottom: 24 },
})
