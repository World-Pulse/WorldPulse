/**
 * Play mode of the map's Replay (plan G9, slice 1): /map?play=24h plays the
 * window once in about a minute with a caption for each moment, so it can be
 * screen-recorded for a short video. &frame=vertical crops to a 9:16 phone frame.
 */

export const PLAY_RANGES = ['1h', '6h', '24h', '7d', '30d'] as const
export const PLAY_TOTAL_MS = 60_000
const MIN_STEP_MS = 150
const MAX_STEP_MS = 3_000
const CAPTION_MAX = 140
/** An empty moment keeps the last caption for at most this many steps */
const CAPTION_HOLD_STEPS = 3

export interface PlayBucket {
  t: string
  signals: Array<{ title: string; severity: string; status?: string; is_breaking: boolean }>
}

export interface PlayCaption {
  title: string
  severity: string
  verified: boolean
}

/** ?play=24h → '24h'; ?play=1 (or empty) → the last 24 hours; anything else → no play mode */
export function parsePlayParam(value: string | null): string | null {
  if (value === null) return null
  if (value === '' || value === '1' || value === 'true') return '24h'
  return (PLAY_RANGES as readonly string[]).includes(value) ? value : null
}

/** How long each step lasts so the whole window plays in about a minute */
export function playStepMs(bucketCount: number): number {
  if (bucketCount <= 0) return MAX_STEP_MS
  return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, Math.round(PLAY_TOTAL_MS / bucketCount)))
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function rank(s: PlayBucket['signals'][number]): number {
  return (s.status === 'verified' ? 100 : 0) + (SEVERITY_RANK[s.severity] ?? 0) * 10 + (s.is_breaking ? 5 : 0)
}

/** The headline of one moment: verified first, then the most severe, breaking breaking ties */
export function pickCaption(bucket: PlayBucket | undefined): PlayCaption | null {
  if (!bucket) return null
  let best: PlayBucket['signals'][number] | null = null
  for (const s of bucket.signals) {
    if (!s.title || !s.title.trim()) continue
    if (!best || rank(s) > rank(best)) best = s
  }
  if (!best) return null
  const title = best.title.trim()
  return {
    title: title.length > CAPTION_MAX ? `${title.slice(0, CAPTION_MAX - 1).trimEnd()}…` : title,
    severity: best.severity,
    verified: best.status === 'verified',
  }
}

/** The caption at a step; a quiet moment keeps the last headline for a few steps, then none */
export function captionAt(buckets: PlayBucket[], index: number): PlayCaption | null {
  for (let i = Math.min(index, buckets.length - 1); i >= 0 && i > index - CAPTION_HOLD_STEPS; i--) {
    const c = pickCaption(buckets[i])
    if (c) return c
  }
  return null
}

/** "Oct 17 · 14:00 UTC" */
export function playTimeLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${month} ${d.getUTCDate()} · ${hh}:${mm} UTC`
}
