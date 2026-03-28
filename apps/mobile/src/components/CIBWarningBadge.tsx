import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useState } from 'react'

type Props = {
  score: number   // 0–1 CIB confidence score
  compact?: boolean
}

export function CIBWarningBadge({ score, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (score < 0.4) return null

  const level = score >= 0.75 ? 'HIGH' : 'MEDIUM'
  const color  = score >= 0.75 ? '#ff3b5c' : '#f5a623'

  if (compact) {
    return (
      <View style={[styles.compactBadge, { borderColor: color, backgroundColor: `${color}14` }]}>
        <Text style={[styles.compactText, { color }]}>CIB</Text>
      </View>
    )
  }

  return (
    <TouchableOpacity
      style={[styles.badge, { borderColor: color, backgroundColor: `${color}0d` }]}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.8}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: color }]}>
          <Text style={styles.iconText}>!</Text>
        </View>
        <View style={styles.textBlock}>
          <Text style={[styles.title, { color }]}>
            {level} CIB CONFIDENCE
          </Text>
          <Text style={styles.subtitle}>
            Coordinated inauthentic behavior detected — {Math.round(score * 100)}%
          </Text>
        </View>
      </View>
      {expanded && (
        <Text style={styles.detail}>
          This signal shows patterns associated with coordinated inauthentic behavior (CIB):
          unusual amplification speed, cross-account similarity, or bot-like posting patterns.
          Treat with elevated skepticism.
        </Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconText: {
    color: '#000',
    fontWeight: '900',
    fontSize: 12,
    lineHeight: 16,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  subtitle: {
    fontSize: 12,
    color: '#8892a4',
  },
  detail: {
    fontSize: 12,
    color: '#8892a4',
    lineHeight: 18,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  compactBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  compactText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
})
