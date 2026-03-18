import { View, Text, StyleSheet } from 'react-native'

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

type Props = {
  severity: Severity | string
  compact?: boolean
}

const SEVERITY_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  critical: { bg: 'rgba(255,59,92,0.15)',   border: 'rgba(255,59,92,0.35)',  text: '#ff3b5c', label: 'CRITICAL' },
  high:     { bg: 'rgba(245,166,35,0.15)',  border: 'rgba(245,166,35,0.35)', text: '#f5a623', label: 'HIGH' },
  medium:   { bg: 'rgba(0,212,255,0.12)',   border: 'rgba(0,212,255,0.3)',   text: '#00d4ff', label: 'MEDIUM' },
  low:      { bg: 'rgba(0,230,118,0.12)',   border: 'rgba(0,230,118,0.3)',   text: '#00e676', label: 'LOW' },
  info:     { bg: 'rgba(136,146,164,0.1)',  border: 'rgba(136,146,164,0.25)',text: '#8892a4', label: 'INFO' },
}

export function SeverityBadge({ severity, compact = false }: Props) {
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.bg,
          borderColor: config.border,
        },
        compact && styles.badgeCompact,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: config.text }]} />
      {!compact && (
        <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  badgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  text: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
})
