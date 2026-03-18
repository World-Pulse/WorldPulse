import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { type Signal } from '@/lib/api'
import { SeverityBadge } from './SeverityBadge'
import { CategoryChip } from './CategoryChip'

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

const SEVERITY_BORDER: Record<string, string> = {
  critical: COLORS.red,
  high:     COLORS.amber,
  medium:   COLORS.cyan,
  low:      COLORS.green,
  info:     COLORS.border,
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)

  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

type Props = {
  signal: Signal
}

export function SignalCard({ signal }: Props) {
  const router = useRouter()

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: SEVERITY_BORDER[signal.severity] ?? COLORS.border }]}
      onPress={() => router.push(`/signal/${signal.id}`)}
      activeOpacity={0.75}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.badges}>
          <SeverityBadge severity={signal.severity} compact />
          <CategoryChip category={signal.category} />
        </View>
        <Text style={styles.time}>{timeAgo(signal.createdAt)} ago</Text>
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={2}>{signal.title}</Text>

      {/* Summary */}
      {signal.summary && (
        <Text style={styles.summary} numberOfLines={2}>{signal.summary}</Text>
      )}

      {/* Location */}
      {signal.locationName && (
        <Text style={styles.location}>📍 {signal.locationName}</Text>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Text style={styles.stat}>🔗 {signal.sourceCount}</Text>
          <Text style={styles.stat}>💬 {formatCount(signal.postCount)}</Text>
          <Text style={styles.stat}>👁 {formatCount(signal.viewCount)}</Text>
        </View>

        {signal.reliabilityScore > 0 && (
          <View style={styles.reliabilityRow}>
            <View style={styles.reliabilityBar}>
              <View
                style={[
                  styles.reliabilityFill,
                  {
                    width: `${signal.reliabilityScore * 100}%` as `${number}%`,
                    backgroundColor: signal.reliabilityScore > 0.8
                      ? COLORS.green
                      : signal.reliabilityScore > 0.6
                        ? COLORS.amber
                        : COLORS.red,
                  },
                ]}
              />
            </View>
            <Text style={styles.reliabilityText}>
              {Math.round(signal.reliabilityScore * 100)}%
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderLeftWidth: 3,
    padding: 14,
    paddingLeft: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  time: {
    fontSize: 11,
    color: COLORS.text3,
    fontFamily: 'monospace',
    flexShrink: 0,
    marginLeft: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 21,
    marginBottom: 5,
  },
  summary: {
    fontSize: 13,
    color: COLORS.text2,
    lineHeight: 18,
    marginBottom: 6,
  },
  location: {
    fontSize: 12,
    color: COLORS.text3,
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLeft: {
    flexDirection: 'row',
    gap: 10,
  },
  stat: {
    fontSize: 12,
    color: COLORS.text3,
  },
  reliabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reliabilityBar: {
    width: 40,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.s2,
    overflow: 'hidden',
  },
  reliabilityFill: {
    height: '100%',
    borderRadius: 2,
  },
  reliabilityText: {
    fontSize: 10,
    color: COLORS.text3,
    fontFamily: 'monospace',
  },
})
