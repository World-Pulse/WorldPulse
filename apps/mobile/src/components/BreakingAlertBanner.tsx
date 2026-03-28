import { useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { breakingApi, type BreakingAlert } from '@/lib/api'

const COLORS = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  text:     '#e2e6f0',
  bg:       'rgba(255,59,92,0.12)',
}

function BannerItem({ alert, onPress }: { alert: BreakingAlert; onPress: () => void }) {
  const color = alert.severity === 'critical' ? COLORS.critical : COLORS.high
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [pulse])

  return (
    <TouchableOpacity
      style={[styles.banner, { borderColor: color, backgroundColor: `${color}14` }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
      <Text style={[styles.label, { color }]}>BREAKING</Text>
      <Text style={styles.title} numberOfLines={1}>{alert.title}</Text>
      {alert.locationName && (
        <Text style={[styles.location, { color }]}>
          {alert.locationName}
        </Text>
      )}
    </TouchableOpacity>
  )
}

export function BreakingAlertBanner() {
  const router = useRouter()

  const { data } = useQuery({
    queryKey: ['breaking', 'latest'],
    queryFn: () => breakingApi.getLatest(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  const alerts = data?.data ?? []
  if (alerts.length === 0) return null

  // Show only the most recent breaking alert
  const top = alerts[0]

  return (
    <BannerItem
      alert={top}
      onPress={() => {
        if (top.signalId) {
          router.push(`/signal/${top.signalId}`)
        }
      }}
    />
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    flexShrink: 0,
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#e2e6f0',
  },
  location: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
    flexShrink: 0,
  },
})
