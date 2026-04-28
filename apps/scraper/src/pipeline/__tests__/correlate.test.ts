/**
 * Cross-Source Event Correlation Engine — Test Suite
 *
 * Tests all correlation scoring factors:
 *   - Temporal proximity scoring
 *   - Geographic proximity scoring (Haversine)
 *   - Causal chain detection
 *   - Keyword/tag overlap scoring
 *   - Overall correlation score computation
 *   - Correlation type determination
 */

import { describe, it, expect } from 'vitest'
import {
  temporalScore,
  geoScore,
  causalScore,
  keywordScore,
  computeCorrelationScore,
  haversineKm,
  type CorrelationCandidate,
} from '../correlate'

// ─── HELPER: Create a test signal ─────────────────────────────────────────────

function makeSignal(overrides: Partial<CorrelationCandidate> = {}): CorrelationCandidate {
  return {
    id: 'sig_test_1',
    title: 'Test Signal',
    category: 'security',
    severity: 'high',
    source_id: 'source_a',
    location_name: null,
    lat: null,
    lng: null,
    published_at: new Date().toISOString(),
    reliability_score: 0.8,
    tags: [],
    ...overrides,
  }
}

// ─── TEMPORAL SCORE ──────────────────────────────────────────────────────────

describe('temporalScore', () => {
  it('returns 1.0 for signals published at the same time', () => {
    const now = new Date().toISOString()
    const a = makeSignal({ published_at: now })
    const b = makeSignal({ published_at: now })
    expect(temporalScore(a, b)).toBe(1.0)
  })

  it('returns 1.0 for signals within 1 hour', () => {
    const now = new Date()
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000)
    const a = makeSignal({ published_at: now.toISOString() })
    const b = makeSignal({ published_at: thirtyMinAgo.toISOString() })
    expect(temporalScore(a, b)).toBe(1.0)
  })

  it('returns value between 0 and 1 for signals 6 hours apart', () => {
    const now = new Date()
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    const a = makeSignal({ published_at: now.toISOString() })
    const b = makeSignal({ published_at: sixHoursAgo.toISOString() })
    const score = temporalScore(a, b)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('returns 0 for signals beyond the temporal window (24h default)', () => {
    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
    const a = makeSignal({ published_at: now.toISOString() })
    const b = makeSignal({ published_at: twoDaysAgo.toISOString() })
    expect(temporalScore(a, b)).toBe(0)
  })

  it('decays linearly between 1h and window boundary', () => {
    const now = new Date()
    const twelveHours = new Date(now.getTime() - 12 * 60 * 60 * 1000)
    const eighteenHours = new Date(now.getTime() - 18 * 60 * 60 * 1000)
    const a = makeSignal({ published_at: now.toISOString() })
    const b12 = makeSignal({ published_at: twelveHours.toISOString() })
    const b18 = makeSignal({ published_at: eighteenHours.toISOString() })
    expect(temporalScore(a, b12)).toBeGreaterThan(temporalScore(a, b18))
  })
})

// ─── GEO SCORE ───────────────────────────────────────────────────────────────

describe('geoScore', () => {
  it('returns 0 when either signal has no coordinates', () => {
    const a = makeSignal({ lat: 40.7, lng: -74.0 })
    const b = makeSignal({ lat: null, lng: null })
    expect(geoScore(a, b)).toBe(0)
  })

  it('returns 1.0 for signals at the same location', () => {
    const a = makeSignal({ lat: 35.68, lng: 139.65 })
    const b = makeSignal({ lat: 35.68, lng: 139.65 })
    expect(geoScore(a, b)).toBe(1.0)
  })

  it('returns 1.0 for signals within 10km', () => {
    // Tokyo station to Tokyo tower (~3km)
    const a = makeSignal({ lat: 35.6812, lng: 139.7671 })
    const b = makeSignal({ lat: 35.6586, lng: 139.7454 })
    expect(geoScore(a, b)).toBe(1.0)
  })

  it('returns value between 0 and 1 for signals ~100km apart', () => {
    // Tokyo to Yokohama (~28km)
    const a = makeSignal({ lat: 35.6762, lng: 139.6503 })
    const b = makeSignal({ lat: 35.4437, lng: 139.6380 })
    const score = geoScore(a, b)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('returns 0 for signals > GEO_RADIUS_KM apart', () => {
    // Tokyo to London (~9,500km)
    const a = makeSignal({ lat: 35.6762, lng: 139.6503 })
    const b = makeSignal({ lat: 51.5074, lng: -0.1278 })
    expect(geoScore(a, b)).toBe(0)
  })
})

// ─── HAVERSINE ───────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0)
  })

  it('computes ~111km for 1 degree latitude at equator', () => {
    const dist = haversineKm(0, 0, 1, 0)
    expect(dist).toBeGreaterThan(110)
    expect(dist).toBeLessThan(112)
  })

  it('computes roughly correct Tokyo-London distance', () => {
    const dist = haversineKm(35.6762, 139.6503, 51.5074, -0.1278)
    expect(dist).toBeGreaterThan(9500)
    expect(dist).toBeLessThan(9600)
  })

  it('is symmetric', () => {
    const d1 = haversineKm(40.7, -74.0, 51.5, -0.1)
    const d2 = haversineKm(51.5, -0.1, 40.7, -74.0)
    expect(d1).toBeCloseTo(d2, 6)
  })
})

// ─── CAUSAL SCORE ────────────────────────────────────────────────────────────

describe('causalScore', () => {
  it('returns 1.0 for earthquake → tsunami chain', () => {
    const a = makeSignal({ category: 'science' })
    const b = makeSignal({ category: 'weather' })
    // science:earthquake → weather:tsunami is a known chain
    expect(causalScore(a, b)).toBe(1.0)
  })

  it('returns 1.0 for conflict → humanitarian chain', () => {
    const a = makeSignal({ category: 'conflict' })
    const b = makeSignal({ category: 'humanitarian' })
    expect(causalScore(a, b)).toBe(1.0)
  })

  it('returns 1.0 for reverse direction (humanitarian → conflict)', () => {
    const a = makeSignal({ category: 'humanitarian' })
    const b = makeSignal({ category: 'conflict' })
    expect(causalScore(a, b)).toBe(1.0)
  })

  it('returns 0.6 for same-category different-source signals', () => {
    const a = makeSignal({ category: 'security', source_id: 'src_a' })
    const b = makeSignal({ category: 'security', source_id: 'src_b' })
    expect(causalScore(a, b)).toBe(0.6)
  })

  it('returns 0.3 for same-family different-category', () => {
    // infrastructure and transportation are in the same family
    const a = makeSignal({ category: 'infrastructure' })
    const b = makeSignal({ category: 'transportation' })
    expect(causalScore(a, b)).toBe(0.3)
  })

  it('returns 0 for unrelated categories', () => {
    const a = makeSignal({ category: 'health' })
    const b = makeSignal({ category: 'technology' })
    expect(causalScore(a, b)).toBe(0)
  })

  it('returns 0 for same-category same-source (not corroboration)', () => {
    const a = makeSignal({ category: 'security', source_id: 'same' })
    const b = makeSignal({ category: 'security', source_id: 'same' })
    // Same source is not cross-source corroboration
    expect(causalScore(a, b)).toBe(0)
  })
})

// ─── KEYWORD SCORE ───────────────────────────────────────────────────────────

describe('keywordScore', () => {
  it('returns 0 for completely different signals', () => {
    const a = makeSignal({ title: 'Earthquake magnitude 7.2 Japan', tags: ['earthquake', 'japan'] })
    const b = makeSignal({ title: 'Stock market rally New York', tags: ['finance', 'nyse'] })
    expect(keywordScore(a, b)).toBeLessThan(0.1)
  })

  it('returns high score for shared tags', () => {
    const a = makeSignal({ title: 'Earthquake in Turkey', tags: ['earthquake', 'turkey', 'disaster'] })
    const b = makeSignal({ title: 'Tsunami warning Turkey coast', tags: ['tsunami', 'turkey', 'disaster'] })
    expect(keywordScore(a, b)).toBeGreaterThan(0.2)
  })

  it('returns positive score for title word overlap', () => {
    const a = makeSignal({ title: 'Ukraine conflict escalation Kharkiv', tags: [] })
    const b = makeSignal({ title: 'Humanitarian crisis Ukraine Kharkiv', tags: [] })
    const score = keywordScore(a, b)
    expect(score).toBeGreaterThan(0)
  })

  it('returns higher score when both tags and title overlap', () => {
    const a = makeSignal({ title: 'Earthquake magnitude 7.0 Turkey', tags: ['earthquake', 'turkey'] })
    const b = makeSignal({ title: 'Turkey earthquake aftershock', tags: ['earthquake', 'turkey'] })
    const score = keywordScore(a, b)
    expect(score).toBeGreaterThan(0.3)
  })

  it('gets location name match bonus', () => {
    const a = makeSignal({ title: 'Event A', location_name: 'Tokyo', tags: [] })
    const b = makeSignal({ title: 'Event B', location_name: 'Tokyo', tags: [] })
    const c = makeSignal({ title: 'Event B', location_name: 'London', tags: [] })
    expect(keywordScore(a, b)).toBeGreaterThan(keywordScore(a, c))
  })
})

// ─── OVERALL CORRELATION SCORE ───────────────────────────────────────────────

describe('computeCorrelationScore', () => {
  it('returns high score for earthquake + tsunami same location/time', () => {
    const now = new Date()
    const a = makeSignal({
      category: 'science',
      title: 'M7.2 earthquake strikes Japan coast',
      tags: ['earthquake', 'japan'],
      lat: 38.3, lng: 142.4,
      published_at: now.toISOString(),
    })
    const b = makeSignal({
      category: 'weather',
      title: 'Tsunami warning issued Japan Pacific coast',
      tags: ['tsunami', 'japan'],
      lat: 38.5, lng: 142.6,
      published_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    })
    const score = computeCorrelationScore(a, b)
    expect(score).toBeGreaterThan(0.6)
  })

  it('returns low score for unrelated signals far apart', () => {
    const a = makeSignal({
      category: 'health',
      title: 'Disease outbreak in Africa',
      tags: ['disease'],
      lat: 0.3, lng: 32.6,
      published_at: new Date().toISOString(),
    })
    const b = makeSignal({
      category: 'technology',
      title: 'New AI chip released by NVIDIA',
      tags: ['ai', 'nvidia'],
      lat: 37.4, lng: -122.1,
      published_at: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    })
    const score = computeCorrelationScore(a, b)
    expect(score).toBeLessThan(0.3)
  })

  it('uses adjusted weights when no geo data available', () => {
    const now = new Date()
    const a = makeSignal({
      category: 'conflict',
      title: 'Armed conflict escalation',
      tags: ['conflict'],
      lat: null, lng: null,
      published_at: now.toISOString(),
    })
    const b = makeSignal({
      category: 'humanitarian',
      title: 'Humanitarian displacement crisis',
      tags: ['displacement'],
      lat: null, lng: null,
      published_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    })
    const score = computeCorrelationScore(a, b)
    // Should still detect causal chain without geo
    expect(score).toBeGreaterThan(0.3)
  })

  it('same-category different-source scores moderately', () => {
    const now = new Date()
    const a = makeSignal({
      category: 'security',
      title: 'Cyberattack targets energy grid',
      tags: ['cyber', 'energy'],
      source_id: 'cisa',
      published_at: now.toISOString(),
    })
    const b = makeSignal({
      category: 'security',
      title: 'Energy sector cyber threat detected',
      tags: ['cyber', 'energy'],
      source_id: 'otx',
      published_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    })
    const score = computeCorrelationScore(a, b)
    expect(score).toBeGreaterThan(0.4)
  })
})
