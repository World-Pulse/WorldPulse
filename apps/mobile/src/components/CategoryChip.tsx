import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'

type Props = {
  category: string
  onPress?: () => void
  size?: 'sm' | 'md'
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  breaking:    { bg: 'rgba(255,59,92,0.12)',   text: '#ff3b5c' },
  conflict:    { bg: 'rgba(239,68,68,0.1)',    text: '#ef4444' },
  geopolitics: { bg: 'rgba(59,130,246,0.1)',   text: '#60a5fa' },
  climate:     { bg: 'rgba(34,197,94,0.1)',    text: '#4ade80' },
  health:      { bg: 'rgba(168,85,247,0.1)',   text: '#c084fc' },
  economy:     { bg: 'rgba(245,166,35,0.1)',   text: '#f5a623' },
  technology:  { bg: 'rgba(0,212,255,0.1)',    text: '#00d4ff' },
  science:     { bg: 'rgba(139,92,246,0.1)',   text: '#a78bfa' },
  elections:   { bg: 'rgba(96,165,250,0.1)',   text: '#93c5fd' },
  culture:     { bg: 'rgba(236,72,153,0.1)',   text: '#f472b6' },
  disaster:    { bg: 'rgba(249,115,22,0.1)',   text: '#fb923c' },
  security:    { bg: 'rgba(245,101,101,0.1)',  text: '#fc8181' },
  sports:      { bg: 'rgba(16,185,129,0.1)',   text: '#34d399' },
  space:       { bg: 'rgba(6,182,212,0.1)',    text: '#22d3ee' },
  other:       { bg: 'rgba(74,85,104,0.1)',    text: '#718096' },
}

const DEFAULT = { bg: 'rgba(74,85,104,0.1)', text: '#718096' }

export function CategoryChip({ category, onPress, size = 'sm' }: Props) {
  const colors = CATEGORY_COLORS[category] ?? DEFAULT
  const label = category.charAt(0).toUpperCase() + category.slice(1)

  const chip = (
    <View
      style={[
        styles.chip,
        { backgroundColor: colors.bg },
        size === 'md' && styles.chipMd,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: colors.text },
          size === 'md' && styles.textMd,
        ]}
      >
        {label}
      </Text>
    </View>
  )

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {chip}
      </TouchableOpacity>
    )
  }

  return chip
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  chipMd: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  text: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  textMd: {
    fontSize: 12,
  },
})
