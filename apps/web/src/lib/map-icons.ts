/**
 * Map icons for planes, ships and cameras (plan item M4). These layers used to
 * draw the emoji ✈ ⚓ 📹 as text, but the map's font server has no emoji, so
 * nothing appeared. Each icon is a small dark disc ringed in the layer's
 * colour with a Lucide glyph inside (ISC licence), drawn from SVG and added
 * to the map as an image.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapLike = any

/** Lucide glyph shapes (24×24, stroke-drawn) */
const GLYPHS = {
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  ship: '<path d="M12 10.189V14"/><path d="M12 2v3"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  camera: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
} as const

export type MapIconGlyph = keyof typeof GLYPHS

/** The image ids the layers use */
export const MAP_ICON = {
  plane:  { id: 'wp-icon-plane',  glyph: 'plane',  color: '#22d3ee' },
  /** Live aircraft (Oct 19, 2026): military amber, an emergency squawk red */
  planeMil: { id: 'wp-icon-plane-mil', glyph: 'plane', color: '#f59e0b' },
  planeSos: { id: 'wp-icon-plane-sos', glyph: 'plane', color: '#ef4444' },
  ship:   { id: 'wp-icon-ship',   glyph: 'ship',   color: '#f59e0b' },
  camera: { id: 'wp-icon-camera', glyph: 'camera', color: '#2dd4bf' },
} as const

const SIZE = 28   // css pixels
const RATIO = 2   // drawn at 2× for sharp edges

/** The icon as an SVG document: a ringed dark disc with the glyph in the middle */
export function iconSvg(glyph: MapIconGlyph, color: string): string {
  const px = SIZE * RATIO
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 28 28">`
    + `<circle cx="14" cy="14" r="12" fill="#0b1220" fill-opacity="0.92" stroke="${color}" stroke-width="1.6"/>`
    + `<g transform="translate(7 7) scale(0.5833)" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyph]}</g>`
    + '</svg>'
}

/** Add an icon to the map once (resolves when it can be used; false if it couldn't be drawn) */
export function ensureMapIcon(map: MapLike, icon: { id: string; glyph: MapIconGlyph; color: string }): Promise<boolean> {
  if (!map || map.hasImage?.(icon.id)) return Promise.resolve(true)
  return new Promise(resolve => {
    const img = new Image(SIZE * RATIO, SIZE * RATIO)
    img.onload = () => {
      try {
        if (!map.hasImage(icon.id)) map.addImage(icon.id, img, { pixelRatio: RATIO })
        resolve(true)
      } catch {
        resolve(false)
      }
    }
    img.onerror = () => resolve(false)
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(icon.glyph, icon.color))}`
  })
}
