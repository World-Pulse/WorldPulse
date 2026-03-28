import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { briefingApi, type BriefingSection } from '@/lib/api'

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
  red:     '#ff3b5c',
}

const CATEGORY_COLORS: Record<string, string> = {
  conflict:    '#ff3b5c',
  climate:     '#00e676',
  disaster:    '#f5a623',
  health:      '#00d4ff',
  economy:     '#7c3aed',
  geopolitics: '#f59e0b',
  technology:  '#06b6d4',
  default:     '#8892a4',
}

function SectionCard({ section, onPress }: { section: BriefingSection; onPress: () => void }) {
  const color = CATEGORY_COLORS[section.category] ?? CATEGORY_COLORS.default

  return (
    <TouchableOpacity
      style={styles.sectionCard}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.sectionAccent, { backgroundColor: color }]} />
      <View style={styles.sectionContent}>
        <View style={styles.sectionHeader}>
          <View style={[styles.categoryChip, { borderColor: color, backgroundColor: `${color}14` }]}>
            <Text style={[styles.categoryText, { color }]}>
              {section.category.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.signalCount}>{section.signalCount} signals</Text>
        </View>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionSummary} numberOfLines={3}>
          {section.summary}
        </Text>
        {section.topSignalId && (
          <Text style={styles.viewSignal}>View top signal →</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

export default function BriefingScreen() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['briefing', 'latest'],
    queryFn: () => briefingApi.getLatest(),
    staleTime: 5 * 60_000,
  })

  const briefing = data?.data

  async function onRefresh() {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'AI Briefing',
          headerStyle: { backgroundColor: COLORS.surface },
          headerTintColor: COLORS.text,
          headerTitleStyle: { fontWeight: '700', fontSize: 16 },
          headerShadowVisible: false,
        }}
      />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.amber} />
          <Text style={styles.loadingText}>Generating briefing...</Text>
        </View>
      ) : error || !briefing ? (
        <View style={styles.centered}>
          <Text style={styles.errorIcon}>📡</Text>
          <Text style={styles.errorTitle}>No briefing available</Text>
          <Text style={styles.errorSubtitle}>Check back later for your AI-generated intelligence briefing.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()} activeOpacity={0.8}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.amber}
            />
          }
        >
          {/* Date + generated time */}
          <View style={styles.metaRow}>
            <Text style={styles.dateLabel}>
              {new Date(briefing.date).toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
              }).toUpperCase()}
            </Text>
            <Text style={styles.generatedAt}>
              Generated {new Date(briefing.generatedAt).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>

          {/* Headline */}
          <Text style={styles.headline}>{briefing.headline}</Text>

          {/* AI badge */}
          <View style={styles.aiBadge}>
            <Text style={styles.aiText}>AI-GENERATED • WORLDPULSE INTELLIGENCE</Text>
          </View>

          {/* Executive summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>EXECUTIVE SUMMARY</Text>
            <Text style={styles.summaryText}>{briefing.summary}</Text>
          </View>

          {/* Sections */}
          {briefing.sections.length > 0 && (
            <View style={styles.sectionsBlock}>
              <Text style={styles.sectionsLabel}>
                KEY DEVELOPMENTS ({briefing.sections.length})
              </Text>
              {briefing.sections.map((section, i) => (
                <SectionCard
                  key={i}
                  section={section}
                  onPress={() => {
                    if (section.topSignalId) {
                      router.push(`/signal/${section.topSignalId}`)
                    }
                  }}
                />
              ))}
            </View>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              This briefing is AI-generated from verified signals ingested by WorldPulse.
              Always verify critical information from primary sources.
            </Text>
          </View>
        </ScrollView>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content:   { padding: 16, paddingBottom: 40 },
  centered:  {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bg, padding: 32, gap: 12,
  },

  loadingText: { fontSize: 14, color: COLORS.text2, marginTop: 8 },
  errorIcon:   { fontSize: 40 },
  errorTitle:  { fontSize: 18, fontWeight: '700', color: COLORS.text },
  errorSubtitle: { fontSize: 14, color: COLORS.text2, textAlign: 'center', lineHeight: 20 },
  retryButton: {
    marginTop: 8, backgroundColor: COLORS.amber,
    borderRadius: 10, paddingHorizontal: 24, paddingVertical: 11,
  },
  retryText: { color: '#000', fontWeight: '700', fontSize: 14 },

  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  dateLabel: {
    fontSize: 10, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1,
  },
  generatedAt: {
    fontSize: 10, color: COLORS.text3, fontFamily: 'monospace',
  },

  headline: {
    fontSize: 22, fontWeight: '700', color: COLORS.text, lineHeight: 30, marginBottom: 10,
  },

  aiBadge: {
    backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 16,
  },
  aiText: {
    fontSize: 9, color: COLORS.amber, fontWeight: '700',
    letterSpacing: 1, fontFamily: 'monospace',
  },

  summaryCard: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, padding: 14, marginBottom: 20,
  },
  summaryLabel: {
    fontSize: 9, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 8,
  },
  summaryText: { fontSize: 14, color: COLORS.text2, lineHeight: 22 },

  sectionsBlock: { gap: 10 },
  sectionsLabel: {
    fontSize: 9, color: COLORS.text3, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 2,
  },

  sectionCard: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, flexDirection: 'row', overflow: 'hidden',
  },
  sectionAccent: { width: 4 },
  sectionContent: { flex: 1, padding: 13, gap: 7 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  categoryChip: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2,
  },
  categoryText: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1.5, fontFamily: 'monospace',
  },
  signalCount: { fontSize: 11, color: COLORS.text3 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, lineHeight: 21 },
  sectionSummary: { fontSize: 13, color: COLORS.text2, lineHeight: 19 },
  viewSignal: { fontSize: 12, color: COLORS.cyan, fontWeight: '600' },

  footer: {
    marginTop: 24, padding: 14,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10,
  },
  footerText: { fontSize: 11, color: COLORS.text3, lineHeight: 17, textAlign: 'center' },
})
