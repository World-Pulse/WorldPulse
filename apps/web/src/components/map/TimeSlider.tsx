'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { TimelineBucket, PlaybackSpeed } from '@/hooks/useTimelinePlayback'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface TimeSliderProps {
  /** Timeline buckets from API */
  buckets: TimelineBucket[]
  /** Current bucket index */
  currentIndex: number
  /** Whether playback is active */
  isPlaying: boolean
  /** Playback speed */
  speed: PlaybackSpeed
  /** Current timestamp string */
  currentTime: string | null
  /** Selected range */
  range: string
  /** Loading state */
  loading: boolean
  /** Total signal count */
  totalSignals: number

  /** Callbacks */
  onSeek: (index: number) => void
  onTogglePlay: () => void
  onSpeedChange: (speed: PlaybackSpeed) => void
  onRangeChange: (range: string) => void
  onClose: () => void
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const RANGES = [
  { value: '1h',  label: '1H' },
  { value: '6h',  label: '6H' },
  { value: '24h', label: '24H' },
  { value: '7d',  label: '7D' },
  { value: '30d', label: '30D' },
]

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8]

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b5c',
  high:     '#f5a623',
  medium:   '#fbbf24',
  low:      '#8892a4',
  info:     '#5a6477',
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string, range: string): string {
  const d = new Date(iso)
  if (range === '1h' || range === '6h') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (range === '24h') {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (range === '7d') {
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', hour12: false })
  }
  // 30d
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
}

function getDominantSeverity(signals: TimelineBucket['signals']): string {
  if (signals.length === 0) return 'info'
  const counts: Record<string, number> = {}
  const priority = ['critical', 'high', 'medium', 'low', 'info']
  for (const s of signals) {
    counts[s.severity] = (counts[s.severity] ?? 0) + 1
  }
  // Return highest severity that has any signals
  for (const sev of priority) {
    if (counts[sev]) return sev
  }
  return 'info'
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function TimeSlider({
  buckets,
  currentIndex,
  isPlaying,
  speed,
  currentTime,
  range,
  loading,
  totalSignals,
  onSeek,
  onTogglePlay,
  onSpeedChange,
  onRangeChange,
  onClose,
}: TimeSliderProps) {
  const histogramRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // ── Max bucket count for histogram normalization ─────────
  const maxCount = useMemo(() => {
    if (buckets.length === 0) return 1
    return Math.max(1, ...buckets.map(b => b.count))
  }, [buckets])

  // ── Histogram click/drag handler ────────────────────────
  const handleHistogramInteraction = useCallback((clientX: number) => {
    const el = histogramRef.current
    if (!el || buckets.length === 0) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const pct = Math.max(0, Math.min(1, x / rect.width))
    const idx = Math.round(pct * (buckets.length - 1))
    onSeek(idx)
  }, [buckets, onSeek])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    handleHistogramInteraction(e.clientX)
  }, [handleHistogramInteraction])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    handleHistogramInteraction(e.clientX)
  }, [handleHistogramInteraction])

  const onMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  // Touch support
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true
    handleHistogramInteraction(e.touches[0].clientX)
  }, [handleHistogramInteraction])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return
    handleHistogramInteraction(e.touches[0].clientX)
  }, [handleHistogramInteraction])

  const onTouchEnd = useCallback(() => {
    isDragging.current = false
  }, [])

  // Global mouseup
  useEffect(() => {
    const handler = () => { isDragging.current = false }
    window.addEventListener('mouseup', handler)
    window.addEventListener('touchend', handler)
    return () => {
      window.removeEventListener('mouseup', handler)
      window.removeEventListener('touchend', handler)
    }
  }, [])

  // ── Keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          onTogglePlay()
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) {
            onSeek(Math.min(currentIndex + 10, buckets.length - 1))
          } else {
            onSeek(Math.min(currentIndex + 1, buckets.length - 1))
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) {
            onSeek(Math.max(currentIndex - 10, 0))
          } else {
            onSeek(Math.max(currentIndex - 1, 0))
          }
          break
        case '1': onRangeChange('1h'); break
        case '2': onRangeChange('6h'); break
        case '3': onRangeChange('24h'); break
        case '4': onRangeChange('7d'); break
        case '5': onRangeChange('30d'); break
        case 'Escape':
          onClose()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIndex, buckets.length, onTogglePlay, onSeek, onRangeChange, onClose])

  // ── Progress percentage ─────────────────────────────────
  const progress = buckets.length > 1 ? currentIndex / (buckets.length - 1) : 0

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-[rgba(6,7,13,0.95)] border-t border-[rgba(255,255,255,0.09)] backdrop-blur-xl">
      {/* Histogram bar */}
      <div
        ref={histogramRef}
        className="relative h-[40px] cursor-pointer select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Histogram bars */}
        <div className="absolute inset-0 flex items-end gap-px px-1">
          {buckets.map((bucket, i) => {
            const height = Math.max(2, (bucket.count / maxCount) * 36)
            const severity = getDominantSeverity(bucket.signals)
            const color = SEV_COLOR[severity] ?? '#5a6477'
            const isActive = i <= currentIndex
            const isCurrent = i === currentIndex
            return (
              <div
                key={bucket.t}
                className="flex-1 min-w-[1px] transition-opacity duration-150"
                style={{
                  height: `${height}px`,
                  backgroundColor: color,
                  opacity: isActive ? (isCurrent ? 1 : 0.7) : 0.2,
                  borderRadius: '1px 1px 0 0',
                  boxShadow: isCurrent ? `0 0 6px ${color}` : undefined,
                }}
                title={`${formatTimestamp(bucket.t, range)} — ${bucket.count} signal${bucket.count !== 1 ? 's' : ''}`}
              />
            )
          })}
        </div>

        {/* Scrubber thumb */}
        {buckets.length > 0 && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)] pointer-events-none transition-[left] duration-75"
            style={{ left: `${progress * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-[8px] h-[8px] bg-white rounded-full shadow-lg" />
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[rgba(255,255,255,0.05)]">
        {/* Close button */}
        <button
          onClick={onClose}
          title="Close timeline (Esc)"
          className="flex items-center justify-center w-6 h-6 rounded text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.08)] transition-all text-[14px]"
        >
          ×
        </button>

        {/* Play/Pause */}
        <button
          onClick={onTogglePlay}
          disabled={loading || buckets.length === 0}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          className={`flex items-center justify-center w-7 h-7 rounded border transition-all
            ${isPlaying
              ? 'border-[rgba(0,230,118,0.5)] text-[#00e676] bg-[rgba(0,230,118,0.1)]'
              : 'border-[rgba(255,255,255,0.12)] text-wp-text hover:border-[rgba(255,255,255,0.3)]'}
            ${loading ? 'opacity-50 cursor-wait' : ''}`}
        >
          {loading ? (
            <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="1" width="3" height="10" rx="0.5" />
              <rect x="7" y="1" width="3" height="10" rx="0.5" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 1.5v9l7.5-4.5L3 1.5z" />
            </svg>
          )}
        </button>

        {/* Speed selector */}
        <div className="flex items-center gap-0.5 border border-[rgba(255,255,255,0.08)] rounded overflow-hidden">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`px-1.5 py-0.5 text-[9px] font-mono transition-all
                ${speed === s
                  ? 'bg-[rgba(255,255,255,0.12)] text-wp-text'
                  : 'text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.05)]'}`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Range tabs */}
        <div className="flex items-center gap-0.5 border border-[rgba(255,255,255,0.08)] rounded overflow-hidden ml-1">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => onRangeChange(r.value)}
              className={`px-2 py-0.5 text-[9px] font-mono transition-all
                ${range === r.value
                  ? 'bg-[rgba(0,212,255,0.15)] text-[#00d4ff] border-[rgba(0,212,255,0.3)]'
                  : 'text-wp-text3 hover:text-wp-text hover:bg-[rgba(255,255,255,0.05)]'}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Current timestamp */}
        <div className="flex-1 text-center font-mono text-[11px] text-wp-text tracking-wide">
          {loading ? (
            <span className="text-wp-text3 animate-pulse">Loading timeline…</span>
          ) : currentTime ? (
            formatTimestamp(currentTime, range)
          ) : (
            <span className="text-wp-text3">Select a range</span>
          )}
        </div>

        {/* Signal count */}
        <div className="font-mono text-[9px] text-wp-text3">
          {totalSignals > 0 && `${totalSignals.toLocaleString()} signals`}
        </div>

        {/* Bucket progress */}
        <div className="font-mono text-[9px] text-wp-text3">
          {buckets.length > 0 && `${currentIndex + 1}/${buckets.length}`}
        </div>
      </div>
    </div>
  )
}
