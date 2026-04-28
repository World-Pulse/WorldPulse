import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useWebSocketFeed } from '@/lib/useWebSocketFeed'
import type { Signal } from '@/lib/api'

const AUTO_DISMISS_MS = 8_000

function isCriticalSignal(signal: Signal, eventType: string): boolean {
  return (
    eventType === 'alert.breaking' ||
    signal.breaking === true ||
    signal.severity === 'critical' ||
    (signal.riskScore != null && signal.riskScore >= 8)
  )
}

export function LiveFeedBanner() {
  const router = useRouter()
  const { lastEvent } = useWebSocketFeed()

  const [visible, setVisible] = useState(false)
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null)

  const translateY = useRef(new Animated.Value(-100)).current
  const opacity = useRef(new Animated.Value(0)).current
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -100, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setVisible(false))
  }

  const show = () => {
    setVisible(true)
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start()

    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS)
  }

  useEffect(() => {
    if (!lastEvent) return
    const { type, data } = lastEvent
    if (!isCriticalSignal(data, type)) return

    setActiveSignal(data)
    show()
  }, [lastEvent])

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [])

  if (!visible || !activeSignal) return null

  const handlePress = () => {
    dismiss()
    router.push(`/signal/${activeSignal.id}`)
  }

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY }], opacity }]}
      pointerEvents="box-none"
    >
      <Pressable onPress={handlePress} style={styles.inner}>
        <View style={styles.accentBar} />
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Ionicons name="alert-circle" size={16} color="#38bdf8" />
            <Text style={styles.label}>
              {activeSignal.breaking ? 'BREAKING' : 'CRITICAL ALERT'}
            </Text>
            <Pressable onPress={dismiss} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={16} color="#94a3b8" />
            </Pressable>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {activeSignal.title}
          </Text>
          {activeSignal.locationName ? (
            <Text style={styles.location} numberOfLines={1}>
              <Ionicons name="location-outline" size={11} color="#64748b" />
              {'  '}{activeSignal.locationName}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 8,
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 20,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  inner: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  accentBar: {
    width: 3,
    backgroundColor: '#38bdf8',
  },
  content: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#38bdf8',
    textTransform: 'uppercase',
  },
  closeBtn: {
    padding: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
    lineHeight: 20,
  },
  location: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
})
