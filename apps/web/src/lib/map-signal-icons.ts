/**
 * What kind of event a signal is, drawn on the World Map when zoomed in:
 * a dark disc ringed in the signal's severity colour, a white outer ring when
 * it's verified, and a glyph for its kind (conflict, politics, elections,
 * health, disaster…). Competitors' maps (Liveuamap, WorldMonitor) mark each
 * event's kind; ours showed only coloured dots.
 *
 * Glyphs are Lucide icons (ISC licence), as SVG path data so a canvas can
 * draw them synchronously when the map asks for an image it doesn't have
 * (MapLibre's 'styleimagemissing'), and the legend uses the same icons.
 */

import { SEVERITY_COLOR } from './map-style'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** Lucide glyphs (24×24, stroked) as path data */
const GLYPH_PATHS = {
  "swords": [
    "M14.5 17.5L3 6L3 3L6 3L17.5 14.5",
    "M13 19L19 13",
    "M16 16L20 20",
    "M19 21L21 19",
    "M14.5 6.5L18 3L21 3L21 6L17.5 9.5",
    "M5 14L9 18",
    "M7 17L4 20",
    "M3 19L5 21",
  ],
  "shield": [
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  ],
  "landmark": [
    "M3 22L21 22",
    "M6 18L6 11",
    "M10 18L10 11",
    "M14 18L14 11",
    "M18 18L18 11",
    "M12 2L20 7L4 7Z",
  ],
  "vote": [
    "m9 12 2 2 4-4",
    "M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z",
    "M22 19H2",
  ],
  "heart-pulse": [
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
    "M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27",
  ],
  "triangle-alert": [
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "M12 9v4",
    "M12 17h.01",
  ],
  "cloud-lightning": [
    "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973",
    "m13 12-3 5h4l-3 5",
  ],
  "thermometer": [
    "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z",
  ],
  "trending-up": [
    "M22 7L13.5 15.5L8.5 10.5L2 17",
    "M16 7L22 7L22 13",
  ],
  "cpu": [
    "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2Z",
    "M10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1Z",
    "M15 2v2",
    "M15 20v2",
    "M2 15h2",
    "M2 9h2",
    "M20 15h2",
    "M20 9h2",
    "M9 2v2",
    "M9 20v2",
  ],
  "flask-conical": [
    "M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2",
    "M6.453 15h11.094",
    "M8.5 2h7",
  ],
  "rocket": [
    "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
    "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
    "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",
    "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  ],
  "zap": [
    "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  ],
  "newspaper": [
    "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2",
    "M18 14h-8",
    "M15 18h-5",
    "M10 6h8v4h-8V6Z",
  ],
} as const

export type SignalGlyph = keyof typeof GLYPH_PATHS

/** A signal's category → its glyph (anything else is general news) */
const CATEGORY_GLYPH: Record<string, SignalGlyph> = {
  conflict:    'swords',
  military:    'swords',
  security:    'shield',
  geopolitics: 'landmark',
  politics:    'landmark',
  elections:   'vote',
  health:      'heart-pulse',
  disaster:    'triangle-alert',
  weather:     'cloud-lightning',
  climate:     'thermometer',
  economy:     'trending-up',
  finance:     'trending-up',
  markets:     'trending-up',
  technology:  'cpu',
  science:     'flask-conical',
  space:       'rocket',
  breaking:    'zap',
}

export function categoryGlyph(category: string | null | undefined): SignalGlyph {
  return CATEGORY_GLYPH[String(category ?? '').toLowerCase()] ?? 'newspaper'
}

/** The image a signal uses: its glyph, severity and whether it's verified */
export function signalIconId(glyph: SignalGlyph, severity: string, verified: boolean): string {
  return `wp-sig-${glyph}.${severity}.${verified ? 'v' : 'u'}`
}

/** The parts of an image id signalIconId wrote (null for any other image) */
export function parseSignalIconId(id: string): { glyph: SignalGlyph; severity: string; verified: boolean } | null {
  const m = /^wp-sig-([a-z-]+)\.([a-z]+)\.([vu])$/.exec(id)
  if (!m || !(m[1]! in GLYPH_PATHS)) return null
  return { glyph: m[1] as SignalGlyph, severity: m[2]!, verified: m[3] === 'v' }
}

/** MapLibre expression for the image of a signal feature (properties glyph, severity, status) */
export const SIGNAL_ICON_EXPR: Json = [
  'concat', 'wp-sig-', ['get', 'glyph'], '.', ['get', 'severity'], '.',
  ['case', ['==', ['get', 'status'], 'verified'], 'v', 'u'],
]

/** The icon's size in CSS pixels (drawn at 2× for sharp edges) */
export const SIGNAL_ICON_SIZE = 26
const RATIO = 2

/**
 * The icon as pixels for map.addImage: a dark disc ringed in the severity's
 * colour, a white outer ring when verified, the glyph inside. Null where
 * there's no canvas.
 */
export function drawSignalIcon(glyph: SignalGlyph, severity: string, verified: boolean): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (typeof document === 'undefined') return null
  const px = SIGNAL_ICON_SIZE * RATIO
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof Path2D === 'undefined') return null
  const color = SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.low!
  const c = SIGNAL_ICON_SIZE / 2
  ctx.scale(RATIO, RATIO)

  // Verified: a white ring around the disc, as the map's dots have
  if (verified) {
    ctx.beginPath()
    ctx.arc(c, c, c - 0.9, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.4
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(c, c, c - 3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(11,18,32,0.94)'
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  ctx.stroke()

  // The glyph, 12 px square in the middle
  ctx.save()
  ctx.translate(c - 6, c - 6)
  ctx.scale(0.5, 0.5)
  ctx.strokeStyle = color
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of GLYPH_PATHS[glyph]) ctx.stroke(new Path2D(d))
  ctx.restore()

  const img = ctx.getImageData(0, 0, px, px)
  return { width: px, height: px, data: img.data }
}

/** The icon's pixel ratio for map.addImage */
export const SIGNAL_ICON_RATIO = RATIO
