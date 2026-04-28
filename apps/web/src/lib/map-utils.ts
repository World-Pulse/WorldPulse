/**
 * Pure utility functions for the live map page.
 * Kept separate from the component so they can be unit-tested without a DOM.
 */

// ── Time formatting ────────────────────────────────────────────────────────────

export function timeAgo(d: string): string {
  if (!d) return ''
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ── Source URL helpers ─────────────────────────────────────────────────────────

export function getSourceUrl(urls: string | string[] | null | undefined): string | null {
  try {
    const list: string[] = typeof urls === 'string' ? JSON.parse(urls) : Array.isArray(urls) ? urls : []
    return list[0] ?? null
  } catch { return null }
}

export function getSourceDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// ── Reliability display ────────────────────────────────────────────────────────

export function reliabilityDots(score: number): string {
  const n = Math.max(0, Math.min(5, Math.round(score * 5)))
  return '●'.repeat(n) + '○'.repeat(5 - n)
}

// ── Geo parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a PostGIS WKB/EWKB hex string into a Point coordinate pair.
 * Handles both plain WKB and EWKB (with embedded SRID).
 */
export function parseWKBPoint(hex: string): { lng: number; lat: number } | null {
  if (hex.length < 42) return null
  try {
    const bytes = new Uint8Array((hex.match(/.{2}/g) ?? []).map(b => parseInt(b, 16)))
    const view  = new DataView(bytes.buffer)
    const le    = bytes[0] === 1
    const geomType = view.getUint32(1, le)
    const hasSRID  = (geomType & 0x20000000) !== 0
    const offset   = hasSRID ? 9 : 5
    if (bytes.length < offset + 16) return null
    const lng = view.getFloat64(offset, le)
    const lat = view.getFloat64(offset + 8, le)
    if (!isFinite(lng) || !isFinite(lat)) return null
    return { lng, lat }
  } catch { return null }
}

/**
 * Extract lat/lng from a raw WS signal payload.
 * Supports: direct {lat,lng} fields, GeoJSON Point, or PostGIS WKB hex.
 */
export function extractLatLng(raw: Record<string, unknown>): { lng: number; lat: number } | null {
  if (typeof raw.lat === 'number' && typeof raw.lng === 'number') {
    return { lat: raw.lat, lng: raw.lng }
  }
  if (raw.location && typeof raw.location === 'object') {
    const loc = raw.location as { type?: string; coordinates?: number[] }
    if (loc.type === 'Point' && Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
      return { lng: loc.coordinates[0], lat: loc.coordinates[1] }
    }
  }
  if (typeof raw.location === 'string') return parseWKBPoint(raw.location)
  return null
}

// ── Signal-cap helper ──────────────────────────────────────────────────────────

export const MAX_SIGNALS = 500

/**
 * Prepend a new signal to the list, deduplicating by id and capping at MAX_SIGNALS.
 */
export function prependSignal<T extends { id: string }>(existing: T[], incoming: T): T[] {
  return [incoming, ...existing.filter(s => s.id !== incoming.id)].slice(0, MAX_SIGNALS)
}
