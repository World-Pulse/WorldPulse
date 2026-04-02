/**
 * map-permalink.ts — BAT-15
 * Encode/decode full WorldPulse map state to/from a compact URL hash.
 *
 * Hash schema:
 *   #@lat,lng,zoom|l=wind,heat,sig|t=7d:timestamp|s=signalId|b=dark
 *
 * Segments (pipe-delimited):
 *   @lat,lng,zoom  — Viewport (always first, always present)
 *   l=...          — Comma-separated active layers (optional)
 *   t=range:ts     — Timeline range + scrubber Unix-s timestamp (optional)
 *   s=id           — Highlighted signal ID (optional)
 *   b=basemap      — Basemap mode: dark | satellite | terrain (optional)
 */

export type BasemapMode = 'satellite' | 'dark' | 'terrain'

export type LayerKey =
  | 'wind'
  | 'heat'
  | 'timeline'
  | 'adsb'
  | 'ships'
  | 'cameras'
  | 'naval'
  | 'carriers'
  | 'threats'
  | 'jamming'
  | 'hazards'
  | 'sat'
  | 'country-risk'

export interface MapPermalinkState {
  /** Center latitude */
  lat: number
  /** Center longitude */
  lng: number
  /** Zoom level */
  zoom: number
  /** Active overlay layers */
  layers: LayerKey[]
  /** Timeline range (1h | 6h | 24h | 7d | 30d) */
  timelineRange?: string
  /** Timeline scrubber position as Unix seconds */
  timelineTs?: number
  /** Highlighted / focused signal ID */
  signalId?: string
  /** Basemap mode */
  basemap?: BasemapMode
}

// ─── Encoding ────────────────────────────────────────────────────────────────

/** Encode map state into a URL hash string (without leading `#`). */
export function encodePermalink(state: MapPermalinkState): string {
  const parts: string[] = []

  // Viewport — always first
  parts.push(
    `@${state.lat.toFixed(4)},${state.lng.toFixed(4)},${state.zoom.toFixed(2)}`
  )

  // Active layers
  if (state.layers.length > 0) {
    parts.push(`l=${state.layers.join(',')}`)
  }

  // Timeline
  if (state.timelineRange) {
    const ts = state.timelineTs ?? ''
    parts.push(`t=${state.timelineRange}${ts ? `:${ts}` : ''}`)
  }

  // Selected signal
  if (state.signalId) {
    parts.push(`s=${encodeURIComponent(state.signalId)}`)
  }

  // Basemap (only if non-default)
  if (state.basemap && state.basemap !== 'satellite') {
    parts.push(`b=${state.basemap}`)
  }

  return parts.join('|')
}

/** Build a full shareable URL for the current window location. */
export function buildShareUrl(state: MapPermalinkState): string {
  if (typeof window === 'undefined') return ''
  const hash = encodePermalink(state)
  return `${window.location.origin}/map#${hash}`
}

// ─── Decoding ────────────────────────────────────────────────────────────────

/**
 * Decode a URL hash string (with or without leading `#`) back into
 * a MapPermalinkState. Returns null if the hash is empty or unparseable.
 */
export function decodePermalink(raw: string): MapPermalinkState | null {
  const hash = raw.startsWith('#') ? raw.slice(1) : raw
  if (!hash) return null

  const segments = hash.split('|')
  const result: Partial<MapPermalinkState> = {
    layers: [],
    basemap: 'satellite',
  }

  for (const seg of segments) {
    // Viewport: @lat,lng,zoom
    if (seg.startsWith('@')) {
      const parts = seg.slice(1).split(',')
      if (parts.length >= 3) {
        const lat  = parseFloat(parts[0])
        const lng  = parseFloat(parts[1])
        const zoom = parseFloat(parts[2])
        if (!isNaN(lat) && !isNaN(lng) && !isNaN(zoom)) {
          result.lat  = clamp(lat, -90, 90)
          result.lng  = clamp(lng, -180, 180)
          result.zoom = clamp(zoom, 1, 18)
        }
      }
      continue
    }

    // Layers: l=wind,heat,...
    if (seg.startsWith('l=')) {
      const raw = seg.slice(2)
      result.layers = raw
        .split(',')
        .filter((k): k is LayerKey => k.length > 0) as LayerKey[]
      continue
    }

    // Timeline: t=7d or t=7d:1711641600
    if (seg.startsWith('t=')) {
      const val = seg.slice(2)
      const colonIdx = val.indexOf(':')
      if (colonIdx >= 0) {
        result.timelineRange = val.slice(0, colonIdx)
        const ts = parseInt(val.slice(colonIdx + 1), 10)
        if (!isNaN(ts)) result.timelineTs = ts
      } else {
        result.timelineRange = val
      }
      continue
    }

    // Signal: s=abc123
    if (seg.startsWith('s=')) {
      result.signalId = decodeURIComponent(seg.slice(2))
      continue
    }

    // Basemap: b=dark|satellite|terrain
    if (seg.startsWith('b=')) {
      const bm = seg.slice(2) as BasemapMode
      if (['satellite', 'dark', 'terrain'].includes(bm)) {
        result.basemap = bm
      }
      continue
    }
  }

  // Require at minimum a valid viewport
  if (result.lat === undefined || result.lng === undefined || result.zoom === undefined) {
    return null
  }

  return result as MapPermalinkState
}

/** Parse the current window.location.hash into a MapPermalinkState. */
export function parseWindowHash(): MapPermalinkState | null {
  if (typeof window === 'undefined') return null
  return decodePermalink(window.location.hash)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Build the OG image URL for a given map state.
 * Used by generateMetadata() in the map Next.js route.
 */
export function buildOgImageUrl(state: MapPermalinkState, apiBase = ''): string {
  const encoded = encodePermalink(state)
  return `${apiBase}/api/v1/map/og?state=${encodeURIComponent(encoded)}`
}
