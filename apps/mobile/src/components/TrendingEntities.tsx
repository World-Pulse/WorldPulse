/**
 * TrendingEntities — Mobile component for WorldPulse global intelligence dashboard.
 *
 * Displays trending geopolitical entities (countries, orgs, topics, actors) from
 * the /api/v1/analytics/trending-entities endpoint with time window selector.
 *
 * This is WorldPulse's direct competitive response to WorldMonitor's geopolitical
 * monitoring dashboard, with the key differentiator that each entity is backed by
 * WorldPulse's AI verification pipeline.
 */

import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { analyticsApi, type TrendingEntity } from '@/lib/api'

const COLORS = {
  bg:       '#06070d',
  surface:  '#0d0f18',
  s2:       '#141722',
  border:   'rgba(255,255,255,0.07)',
  amber:    '#f5a623',
  text:     '#e2e6f0',
  text2:    '#8892a4',
  text3:    '#4a5568',
  red:      '#ff3b5c',
  cyan:     '#00d4ff',
  green:    '#00e676',
  orange:   '#f97316',
}

type TimeWindow = '1h' | '6h' | '24h' | '7d'

const TIME_WINDOWS: { id: TimeWindow; label: string }[] = [
  { id: '1h',  label: '1H' },
  { id: '6h',  label: '6H' },
  { id: '24h', label: '24H' },
  { id: '7d',  label: '7D' },
]

const SEVERITY_COLORS: Record<string, string> = {
  critical: COLORS.red,
  high:     COLORS.amber,
  medium:   COLORS.cyan,
  low:      COLORS.green,
  info:     COLORS.text3,
}

const TYPE_LABELS: Record<string, { short: string; color: string }> = {
  country: { short: 'CTY', color: COLORS.cyan },
  org:     { short: 'ORG', color: COLORS.amber },
  tag:     { short: 'TAG', color: COLORS.green },
  actor:   { short: 'ACT', color: COLORS.orange },
}

type Props = {
  /** How many entities to show. Default: 8 */
  limit?: number
}

export function TrendingEntities({ limit = 8 }: Props) {
  const [window, setWindow] = useState<TimeWindow>('24h')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['trending-entities', window, limit],
    queryFn:  () => analyticsApi.getTrendingEntities(window, undefined, limit),
    staleTime: 5 * 60_000, // 5 minutes
    retry: 1,
  })

  const entities = data?.data?.entities ?? []
  const meta     = data?.data

  const handleRetry = useCallback(() => { void refetch() }, [refetch])

  const maxCount = entities.length > 0
    ? Math.max(...entities.map(e => e.count))
    : 1

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.titleIcon}>🌐</Text>
          <Text style={styles.title}>TRENDING INTELLIGENCE</Text>
        </View>
        {meta && (
          <Text style={styles.metaText}>
            {meta.total_signals_scanned} signals · {meta.unique_entity_count} entities
          </Text>
        )}
      </View>

      {/* Time window selector */}
      <View style={styles.windowRow}>
        {TIME_WINDOWS.map(w => (
          <TouchableOpacity
            key={w.id}
            style={[styles.windowBtn, window === w.id && styles.windowBtnActive]}
            onPress={() => setWindow(w.id)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Text style={[styles.windowLabel, window === w.id && styles.windowLabelActive]}>
              {w.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator color={COLORS.amber} size="small" />
          <Text style={styles.stateText}>Loading intelligence…</Text>
        </View>
      ) : isError ? (
        <View style={styles.stateContainer}>
          <Text style={styles.errorText}>Failed to load trending entities</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryLabel}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : entities.length === 0 ? (
        <View style={styles.stateContainer}>
          <Text style={styles.stateText}>No trending entities in this window</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}  // Parent scroll handles it
        >
          {entities.map((entity, idx) => (
            <EntityRow key={`${entity.entity}-${idx}`} entity={entity} rank={idx + 1} maxCount={maxCount} />
          ))}
        </ScrollView>
      )}

      {/* Footer: powered-by note */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>✦ AI-verified · WorldPulse OSINT</Text>
      </View>
    </View>
  )
}

// ─── EntityRow ────────────────────────────────────────────────────────────────

type EntityRowProps = {
  entity:   TrendingEntity
  rank:     number
  maxCount: number
}

function EntityRow({ entity, rank, maxCount }: EntityRowProps) {
  const typeInfo   = TYPE_LABELS[entity.type] ?? { short: entity.type.toUpperCase().slice(0, 3), color: COLORS.text3 }
  const barWidth   = Math.max(4, (entity.count / maxCount) * 100)
  const barColor   = SEVERITY_COLORS[entity.topSeverity] ?? COLORS.text3

  return (
    <View style={styles.entityRow}>
      {/* Rank */}
      <Text style={styles.rank}>{rank}</Text>

      {/* Type badge */}
      <View style={[styles.typeBadge, { borderColor: typeInfo.color }]}>
        <Text style={[styles.typeText, { color: typeInfo.color }]}>{typeInfo.short}</Text>
      </View>

      {/* Entity name + bar */}
      <View style={styles.entityContent}>
        <View style={styles.entityNameRow}>
          <Text style={styles.entityName} numberOfLines={1}>{entity.entity}</Text>
          <Text style={styles.entityCount}>{entity.count}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${barWidth}%` as `${number}%`, backgroundColor: barColor }]} />
        </View>
        {entity.topCategories.length > 0 && (
          <Text style={styles.categories} numberOfLines={1}>
            {entity.topCategories.slice(0, 3).join(' · ')}
          </Text>
        )}
      </View>
    </View>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleIcon: {
    fontSize: 14,
  },
  title: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.text3,
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  metaText: {
    fontSize: 10,
    color: COLORS.text3,
    fontFamily: 'monospace',
  },
  windowRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  windowBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: COLORS.s2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  windowBtnActive: {
    backgroundColor: COLORS.amber,
    borderColor: COLORS.amber,
  },
  windowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.text2,
    fontFamily: 'monospace',
  },
  windowLabelActive: {
    color: '#000',
  },
  stateContainer: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  stateText: {
    fontSize: 13,
    color: COLORS.text2,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.red,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: COLORS.s2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  retryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.amber,
  },
  entityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  rank: {
    fontSize: 11,
    color: COLORS.text3,
    fontFamily: 'monospace',
    width: 16,
    marginTop: 2,
  },
  typeBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginTop: 1,
  },
  typeText: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  entityContent: {
    flex: 1,
    gap: 4,
  },
  entityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  entityName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  entityCount: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.text3,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  barTrack: {
    height: 3,
    backgroundColor: COLORS.s2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
  },
  categories: {
    fontSize: 10,
    color: COLORS.text3,
    marginTop: 1,
  },
  footer: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  footerText: {
    fontSize: 9,
    color: COLORS.text3,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
})
