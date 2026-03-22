import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  timeAgo,
  getSourceUrl,
  getSourceDomain,
  reliabilityDots,
  parseWKBPoint,
  extractLatLng,
  prependSignal,
  MAX_SIGNALS,
} from '../map-utils'

// ── timeAgo ───────────────────────────────────────────────────────────────────

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('returns empty string for empty input', () => {
    expect(timeAgo('')).toBe('')
  })

  it('returns minutes for <60 min ago', () => {
    const d = new Date('2026-01-01T11:45:00Z').toISOString()
    expect(timeAgo(d)).toBe('15m ago')
  })

  it('returns hours for same-day timestamps', () => {
    const d = new Date('2026-01-01T09:00:00Z').toISOString()
    expect(timeAgo(d)).toBe('3h ago')
  })

  it('returns days for multi-day timestamps', () => {
    const d = new Date('2025-12-30T12:00:00Z').toISOString()
    expect(timeAgo(d)).toBe('2d ago')
  })
})

// ── getSourceUrl ──────────────────────────────────────────────────────────────

describe('getSourceUrl', () => {
  it('returns first URL from a JSON string array', () => {
    expect(getSourceUrl(JSON.stringify(['https://bbc.com', 'https://ap.org']))).toBe('https://bbc.com')
  })

  it('returns first URL from an array', () => {
    expect(getSourceUrl(['https://reuters.com', 'https://cnn.com'])).toBe('https://reuters.com')
  })

  it('returns null for empty array', () => {
    expect(getSourceUrl([])).toBeNull()
  })

  it('returns null for null', () => {
    expect(getSourceUrl(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(getSourceUrl(undefined)).toBeNull()
  })

  it('returns null for malformed JSON string', () => {
    expect(getSourceUrl('not-json')).toBeNull()
  })
})

// ── getSourceDomain ───────────────────────────────────────────────────────────

describe('getSourceDomain', () => {
  it('strips www. prefix', () => {
    expect(getSourceDomain('https://www.bbc.com/news/article')).toBe('bbc.com')
  })

  it('handles non-www hostnames', () => {
    expect(getSourceDomain('https://ap.org/article/123')).toBe('ap.org')
  })

  it('returns raw input for invalid URLs', () => {
    expect(getSourceDomain('not-a-url')).toBe('not-a-url')
  })
})

// ── reliabilityDots ───────────────────────────────────────────────────────────

describe('reliabilityDots', () => {
  it('returns 5 filled dots for score 1.0', () => {
    expect(reliabilityDots(1.0)).toBe('●●●●●')
  })

  it('returns 5 empty dots for score 0.0', () => {
    expect(reliabilityDots(0.0)).toBe('○○○○○')
  })

  it('returns 3 filled + 2 empty for score ~0.6', () => {
    expect(reliabilityDots(0.6)).toBe('●●●○○')
  })

  it('clamps scores above 1.0 to 5 dots', () => {
    expect(reliabilityDots(2.0)).toBe('●●●●●')
  })

  it('clamps negative scores to 0 dots', () => {
    expect(reliabilityDots(-1)).toBe('○○○○○')
  })
})

// ── parseWKBPoint ─────────────────────────────────────────────────────────────

describe('parseWKBPoint', () => {
  it('returns null for strings shorter than 42 chars', () => {
    expect(parseWKBPoint('0101000020E6100000')).toBeNull()
  })

  it('parses a plain WKB little-endian point', () => {
    // WKB for POINT(10.5, 51.2) in little-endian:
    // byte order: 01 (LE)
    // type: 01000000 (Point = 1)
    // x (lng): 10.5 as LE float64
    // y (lat): 51.2 as LE float64
    const buf = new ArrayBuffer(21)
    const view = new DataView(buf)
    view.setUint8(0, 1)              // LE
    view.setUint32(1, 1, true)       // type = Point
    view.setFloat64(5, 10.5, true)   // lng
    view.setFloat64(13, 51.2, true)  // lat
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    const result = parseWKBPoint(hex)
    expect(result).not.toBeNull()
    expect(result!.lng).toBeCloseTo(10.5)
    expect(result!.lat).toBeCloseTo(51.2)
  })

  it('parses an EWKB point with SRID', () => {
    // EWKB: has SRID flag (0x20000000) set in type
    const buf = new ArrayBuffer(25)
    const view = new DataView(buf)
    view.setUint8(0, 1)                          // LE
    view.setUint32(1, 0x20000001, true)           // type = Point | SRID flag
    view.setUint32(5, 4326, true)                 // SRID
    view.setFloat64(9, -74.006, true)             // lng (NYC)
    view.setFloat64(17, 40.7128, true)            // lat
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    const result = parseWKBPoint(hex)
    expect(result).not.toBeNull()
    expect(result!.lng).toBeCloseTo(-74.006)
    expect(result!.lat).toBeCloseTo(40.7128)
  })
})

// ── extractLatLng ─────────────────────────────────────────────────────────────

describe('extractLatLng', () => {
  it('reads direct lat/lng fields', () => {
    const result = extractLatLng({ lat: 51.5, lng: -0.12 })
    expect(result).toEqual({ lat: 51.5, lng: -0.12 })
  })

  it('reads GeoJSON Point coordinates', () => {
    const result = extractLatLng({
      location: { type: 'Point', coordinates: [-0.12, 51.5] },
    })
    expect(result).toEqual({ lng: -0.12, lat: 51.5 })
  })

  it('returns null for missing location', () => {
    expect(extractLatLng({ title: 'foo' })).toBeNull()
  })

  it('returns null for non-Point GeoJSON', () => {
    expect(extractLatLng({ location: { type: 'LineString', coordinates: [] } })).toBeNull()
  })

  it('prioritises direct lat/lng over location object', () => {
    const result = extractLatLng({
      lat: 10,
      lng: 20,
      location: { type: 'Point', coordinates: [99, 99] },
    })
    expect(result).toEqual({ lat: 10, lng: 20 })
  })
})

// ── prependSignal ─────────────────────────────────────────────────────────────

describe('prependSignal', () => {
  it('prepends a new signal', () => {
    const existing = [{ id: 'a' }, { id: 'b' }]
    const result = prependSignal(existing, { id: 'c' })
    expect(result[0].id).toBe('c')
    expect(result).toHaveLength(3)
  })

  it('deduplicates by id', () => {
    const existing = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const result = prependSignal(existing, { id: 'b' })
    expect(result.map(s => s.id)).toEqual(['b', 'a', 'c'])
  })

  it(`caps at MAX_SIGNALS (${MAX_SIGNALS})`, () => {
    const existing = Array.from({ length: MAX_SIGNALS }, (_, i) => ({ id: `s${i}` }))
    const result = prependSignal(existing, { id: 'new' })
    expect(result).toHaveLength(MAX_SIGNALS)
    expect(result[0].id).toBe('new')
    // oldest signal (s499) should have been evicted
    expect(result.find(s => s.id === `s${MAX_SIGNALS - 1}`)).toBeUndefined()
  })

  it('keeps all signals when under cap', () => {
    const existing = [{ id: 'x' }]
    const result = prependSignal(existing, { id: 'y' })
    expect(result).toHaveLength(2)
  })
})
