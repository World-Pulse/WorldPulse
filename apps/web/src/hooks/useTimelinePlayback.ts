'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface TimelineBucket {
  t: string
  count: number
  signals: Array<{
    id: string
    lat: number
    lng: number
    severity: string
    category: string
    title: string
    is_breaking: boolean
  }>
}

export interface TimelineData {
  range: string
  bucket_interval: string
  buckets: TimelineBucket[]
  total_signals: number
  generated_at: string
}

export type PlaybackSpeed = 1 | 2 | 4 | 8

export interface TimelinePlaybackState {
  /** Timeline data from API */
  data: TimelineData | null
  /** Whether timeline is loading from API */
  loading: boolean
  /** Current bucket index */
  currentIndex: number
  /** Whether playback is running */
  isPlaying: boolean
  /** Playback speed multiplier */
  speed: PlaybackSpeed
  /** Currently visible signals (all signals up to and including current bucket) */
  visibleSignals: TimelineBucket['signals']
  /** Current timestamp ISO string */
  currentTime: string | null
  /** Error message if fetch failed */
  error: string | null
}

export interface TimelinePlaybackActions {
  /** Fetch timeline data from API */
  fetchTimeline: (range: string, category?: string, severity?: string, bbox?: string) => Promise<void>
  /** Toggle play/pause */
  togglePlay: () => void
  /** Set playback speed */
  setSpeed: (speed: PlaybackSpeed) => void
  /** Seek to a specific bucket index */
  seekTo: (index: number) => void
  /** Step forward one bucket */
  stepForward: () => void
  /** Step backward one bucket */
  stepBackward: () => void
  /** Step forward N buckets */
  stepForwardN: (n: number) => void
  /** Step backward N buckets */
  stepBackwardN: (n: number) => void
  /** Reset timeline state */
  reset: () => void
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Base interval in ms between bucket advances at 1x speed
const BASE_INTERVAL_MS = 800

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useTimelinePlayback(): TimelinePlaybackState & TimelinePlaybackActions {
  const [data, setData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1)
  const [error, setError] = useState<string | null>(null)

  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)
  const dataRef = useRef(data)
  const indexRef = useRef(currentIndex)
  const speedRef = useRef(speed)
  const playingRef = useRef(isPlaying)

  // Keep refs in sync
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { indexRef.current = currentIndex }, [currentIndex])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { playingRef.current = isPlaying }, [isPlaying])

  // ── Computed: visible signals ──────────────────────────────
  // Show all signals from buckets up to and including currentIndex
  const visibleSignals = (() => {
    if (!data || data.buckets.length === 0) return []
    const signals: TimelineBucket['signals'] = []
    const maxIdx = Math.min(currentIndex, data.buckets.length - 1)
    for (let i = 0; i <= maxIdx; i++) {
      signals.push(...data.buckets[i].signals)
    }
    return signals
  })()

  const currentTime = data && data.buckets.length > 0
    ? data.buckets[Math.min(currentIndex, data.buckets.length - 1)]?.t ?? null
    : null

  // ── Playback loop ─────────────────────────────────────────
  const tick = useCallback((timestamp: number) => {
    if (!playingRef.current || !dataRef.current) return

    const interval = BASE_INTERVAL_MS / speedRef.current
    if (timestamp - lastTickRef.current >= interval) {
      lastTickRef.current = timestamp
      const maxIndex = dataRef.current.buckets.length - 1

      setCurrentIndex(prev => {
        if (prev >= maxIndex) {
          // Reached end — stop playback
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = performance.now()
      rafRef.current = requestAnimationFrame(tick)
    } else {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying, tick])

  // ── Actions ───────────────────────────────────────────────
  const fetchTimeline = useCallback(async (
    range: string,
    category?: string,
    severity?: string,
    bbox?: string,
  ) => {
    setLoading(true)
    setError(null)
    setIsPlaying(false)
    setCurrentIndex(0)

    try {
      const params = new URLSearchParams({ range })
      if (category && category !== 'all') params.set('category', category)
      if (severity && severity !== 'all') params.set('severity', severity)
      if (bbox) params.set('bbox', bbox)

      const res = await fetch(`${API_URL}/api/v1/signals/map/timeline?${params}`)
      if (!res.ok) throw new Error(`Timeline API returned ${res.status}`)

      const json = await res.json()
      setData(json.data as TimelineData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch timeline')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const togglePlay = useCallback(() => {
    if (!data || data.buckets.length === 0) return
    setIsPlaying(prev => {
      // If at end, restart from beginning
      if (!prev && indexRef.current >= data.buckets.length - 1) {
        setCurrentIndex(0)
      }
      return !prev
    })
  }, [data])

  const setSpeed = useCallback((s: PlaybackSpeed) => {
    setSpeedState(s)
  }, [])

  const seekTo = useCallback((index: number) => {
    if (!data) return
    const clamped = Math.max(0, Math.min(index, data.buckets.length - 1))
    setCurrentIndex(clamped)
  }, [data])

  const stepForward = useCallback(() => {
    if (!data) return
    setCurrentIndex(prev => Math.min(prev + 1, data.buckets.length - 1))
  }, [data])

  const stepBackward = useCallback(() => {
    setCurrentIndex(prev => Math.max(prev - 1, 0))
  }, [])

  const stepForwardN = useCallback((n: number) => {
    if (!data) return
    setCurrentIndex(prev => Math.min(prev + n, data.buckets.length - 1))
  }, [data])

  const stepBackwardN = useCallback((n: number) => {
    setCurrentIndex(prev => Math.max(prev - n, 0))
  }, [])

  const reset = useCallback(() => {
    setIsPlaying(false)
    setCurrentIndex(0)
    setData(null)
    setError(null)
    setLoading(false)
  }, [])

  return {
    data,
    loading,
    currentIndex,
    isPlaying,
    speed,
    visibleSignals,
    currentTime,
    error,
    fetchTimeline,
    togglePlay,
    setSpeed,
    seekTo,
    stepForward,
    stepBackward,
    stepForwardN,
    stepBackwardN,
    reset,
  }
}
