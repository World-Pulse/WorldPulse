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

/**
 * How far a playback tick moves (Oct 31, 2026, G9): the steps to take and the new time of the last step.
 * In play mode (`catchUp`) the replay keeps its length whatever the frame rate: a slow frame takes every
 * step it covered and the leftover carries over. Taking one step a frame at most, the 5:30 AM recording
 * on a busy server ran 2.5 times slow and reached the recorder's 2-minute limit at midnight of its 24
 * hours, before the closing card. The timeline a reader plays still takes one step a tick.
 */
export function playbackAdvance(now: number, lastTick: number, intervalMs: number, catchUp: boolean): { steps: number; lastTick: number } {
  const elapsed = now - lastTick
  if (!(intervalMs > 0) || !(elapsed >= intervalMs)) return { steps: 0, lastTick }
  if (!catchUp) return { steps: 1, lastTick: now }
  const steps = Math.floor(elapsed / intervalMs)
  return { steps, lastTick: lastTick + steps * intervalMs }
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

// ── The video's shape (Oct 30, 2026; Devon: "The video is kind of lame, add some more layers, make it more
// exciting"): a title card while the map and the day's data load, the replay with the camera flying to the
// story of the moment, then the day's most-reported stories. The recorder waits for data-play-done.

export type PlayPhase = 'intro' | 'play' | 'outro'
/** The title card stays this long once the map and the day's data are ready */
export const PLAY_INTRO_MS = 2_800
/** The closing card's time on screen before the recording may stop */
export const PLAY_OUTRO_MS = 6_000
/** The camera flies to a new story at most this often */
export const TOUR_EVERY_MS = 4_500
/** How many moments back the camera looks for its next story */
const TOUR_LOOKBACK = 6
/**
 * The camera's next story is at least this far from the last one when any is (Oct 30, 2026: the first video sat on
 * Indonesia's middle for 25 s, where every report placed only "Indonesia" is pinned)
 */
export const TOUR_MIN_HOP_KM = 1_200

export interface TourSignal {
  id: string
  lat: number
  lng: number
  title: string
  severity: string
  status?: string
  is_breaking: boolean
}

/** Great-circle distance in km */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The story the camera visits next: of the last few moments, the best-ranked report with a place (verified first,
 * then the most severe, breaking breaking ties) that the camera hasn't visited (`exclude`: the ids it has, or the
 * one it is at), at least TOUR_MIN_HOP_KM from where it is (`from`) when any such report is there
 */
export function pickTourStop(
  buckets: Array<{ signals: TourSignal[] }>,
  index: number,
  exclude: ReadonlySet<string> | string | null = null,
  from: { lat: number; lng: number } | null = null,
): TourSignal | null {
  const skip = (id: string) => (typeof exclude === 'string' ? id === exclude : exclude?.has(id) ?? false)
  let best: TourSignal | null = null
  let bestFar: TourSignal | null = null
  for (let i = Math.min(index, buckets.length - 1); i >= 0 && i > index - TOUR_LOOKBACK; i--) {
    for (const s of buckets[i]?.signals ?? []) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || (s.lat === 0 && s.lng === 0)) continue
      if (skip(s.id) || !s.title?.trim()) continue
      if (!best || rank(s) > rank(best)) best = s
      if (from && distanceKm(from, s) >= TOUR_MIN_HOP_KM && (!bestFar || rank(s) > rank(bestFar))) bestFar = s
    }
  }
  return bestFar ?? best
}

/** The caption for the story the camera is at, so the headline and the place on screen match */
export function tourCaption(stop: TourSignal): PlayCaption {
  const title = stop.title.trim()
  return {
    title: title.length > CAPTION_MAX ? `${title.slice(0, CAPTION_MAX - 1).trimEnd()}…` : title,
    severity: stop.severity,
    verified: stop.status === 'verified',
  }
}

/** Reports and verified reports on the map by a step (the replay shows every moment up to it) */
export function playCounts(buckets: Array<{ signals: Array<{ status?: string }> }>, index: number): { reports: number; verified: number } {
  let reports = 0
  let verified = 0
  for (let i = 0; i <= Math.min(index, buckets.length - 1); i++) {
    for (const s of buckets[i]?.signals ?? []) {
      reports++
      if (s.status === 'verified') verified++
    }
  }
  return { reports, verified }
}

/** "FRIDAY, OCTOBER 30" for the day the window ends on (UTC, like the time label) */
export function playDateLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).toUpperCase()
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
