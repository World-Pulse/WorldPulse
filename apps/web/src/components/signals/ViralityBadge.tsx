'use client'

/**
 * ViralityBadge — Displays spreading velocity status for signals
 *
 * Shows when a signal is gaining multi-source corroboration fast:
 *   "🔥 VIRAL"       — 8+ corroborating sources
 *   "📡 SPREADING"   — 3–7 sources AND corroborated within 4 hours (precise velocity)
 *   "N SOURCES"      — 3+ sources but older (slower velocity)
 *
 * Velocity priority:
 *   1. lastCorroboratedAt — precise timestamp set by the correlation engine when a
 *      new source is added. Most accurate for velocity detection.
 *   2. lastUpdated        — fallback for signals not yet on the new schema (backfill
 *      covers multi-source signals, but single-source signals never have lastCorroboratedAt).
 *
 * No additional API calls required.
 */

/** Time window within which corroboration counts as "spreading fast" (4 hours) */
const SPREADING_WINDOW_MS = 4 * 60 * 60 * 1000

/** Source threshold for multi-source corroboration */
const MULTI_SOURCE_MIN = 3

/** Source threshold for viral status */
const VIRAL_MIN = 8

export type ViralityStatus = 'viral' | 'spreading' | 'multi_source' | null

/**
 * Pure function: compute virality status from source count + corroboration timestamps.
 *
 * Uses lastCorroboratedAt as the primary velocity signal — this is set exactly when
 * the correlation engine adds a new source to a cluster. Falls back to lastUpdated
 * for backwards compatibility with existing signal rows.
 *
 * Exported for unit testing.
 */
export function computeViralityStatus(
  sourceCount: number,
  lastCorroboratedAt?: string | null,
  lastUpdated?: string | null,
): ViralityStatus {
  if (sourceCount < MULTI_SOURCE_MIN) return null
  if (sourceCount >= VIRAL_MIN) return 'viral'

  // Prefer lastCorroboratedAt (precise); fall back to lastUpdated (proxy)
  const velocityTimestamp = lastCorroboratedAt ?? lastUpdated

  const recentlyCorroborated = velocityTimestamp
    ? Date.now() - new Date(velocityTimestamp).getTime() < SPREADING_WINDOW_MS
    : false

  if (recentlyCorroborated) return 'spreading'
  return 'multi_source'
}

interface ViralityBadgeProps {
  sourceCount: number
  /** Precise corroboration timestamp from correlation engine (preferred). */
  lastCorroboratedAt?: string | null
  /** General update timestamp — used as fallback when lastCorroboratedAt is unavailable. */
  lastUpdated?: string | null
  /** 'sm' = compact pill (feed cards), 'md' = larger (detail pages) */
  size?: 'sm' | 'md'
  /** If true, show source count instead of generic label for multi_source */
  showCount?: boolean
}

const BASE_STYLES = {
  sm: 'inline-flex items-center gap-[3px] rounded px-[5px] py-[2px] font-mono tracking-wider border text-[8px] font-semibold',
  md: 'inline-flex items-center gap-[4px] rounded-md px-[7px] py-[3px] font-mono tracking-wider border text-[10px] font-semibold',
}

const STATUS_STYLES: Record<NonNullable<ViralityStatus>, string> = {
  viral:        'bg-[rgba(255,59,92,0.18)]  text-[#ff3b5c] border-[rgba(255,59,92,0.45)]',
  spreading:    'bg-[rgba(255,166,35,0.15)] text-[#f5a623] border-[rgba(255,166,35,0.4)]',
  multi_source: 'bg-[rgba(0,212,255,0.10)]  text-[#00d4ff] border-[rgba(0,212,255,0.25)]',
}

const STATUS_ICONS: Record<NonNullable<ViralityStatus>, string> = {
  viral:        '🔥',
  spreading:    '📡',
  multi_source: '◈',
}

const STATUS_LABELS: Record<NonNullable<ViralityStatus>, string> = {
  viral:        'VIRAL',
  spreading:    'SPREADING',
  multi_source: 'SOURCES',
}

/**
 * Badge component that surfaces corroboration velocity on signal cards and detail pages.
 *
 * @example
 * // Feed card (compact) — uses precise corroboration timestamp
 * <ViralityBadge sourceCount={sig.sourceCount} lastCorroboratedAt={sig.lastCorroboratedAt} lastUpdated={sig.lastUpdated} size="sm" showCount />
 *
 * // Signal detail page (larger)
 * <ViralityBadge sourceCount={detail.sourceCount} lastCorroboratedAt={detail.lastCorroboratedAt} lastUpdated={detail.lastUpdated} size="md" showCount />
 */
export function ViralityBadge({
  sourceCount,
  lastCorroboratedAt,
  lastUpdated,
  size = 'sm',
  showCount = false,
}: ViralityBadgeProps) {
  const status = computeViralityStatus(sourceCount, lastCorroboratedAt, lastUpdated)
  if (!status) return null

  const icon  = STATUS_ICONS[status]
  const label = showCount && status === 'multi_source'
    ? `${sourceCount} SOURCES`
    : `${STATUS_LABELS[status]}`

  const velocityTimestamp = lastCorroboratedAt ?? lastUpdated

  return (
    <span
      className={`${BASE_STYLES[size]} ${STATUS_STYLES[status]}`}
      title={`${sourceCount} sources have corroborated this signal${status === 'spreading' ? ' — spreading fast in the last 4h' : ''}${lastCorroboratedAt ? ` (last corroborated: ${new Date(lastCorroboratedAt).toLocaleString()})` : ''}`}
    >
      {icon} {label}
    </span>
  )
}
