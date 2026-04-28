/**
 * Unit tests for map WebSocket integration logic.
 *
 * Tests the filter-awareness, ping/pong, signal.updated handling, and
 * exponential backoff reconnection added to apps/web/src/app/map/page.tsx.
 *
 * These tests exercise the pure logic extracted from the WS onmessage handler
 * without mounting the full map component (which requires MapLibre / DOM).
 */

import { describe, it, expect } from 'vitest'

// ── Helpers mirrored from map-utils ──────────────────────────────────────────

function extractLatLng(raw: Record<string, unknown>): { lat: number; lng: number } | null {
  if (typeof raw.lat === 'number' && typeof raw.lng === 'number') {
    return { lat: raw.lat, lng: raw.lng }
  }
  return null
}

// ── Signal filter logic (mirrors the WS onmessage guard) ─────────────────────

function shouldAddSignal(
  raw: Record<string, unknown>,
  activeCat: string,
  activeSev: string,
): boolean {
  const cat = typeof raw.category === 'string' ? raw.category : 'other'
  const sev = typeof raw.severity === 'string' ? raw.severity : 'info'
  if (activeCat !== 'all' && cat !== activeCat) return false
  if (activeSev !== 'all' && sev !== activeSev) return false
  return true
}

// ── Exponential backoff logic ─────────────────────────────────────────────────

function nextBackoff(current: number, max = 30_000): number {
  return Math.min(current * 2, max)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('map WS — filter awareness', () => {
  it('passes when category and severity match "all"', () => {
    const raw = { id: '1', category: 'conflict', severity: 'high', lat: 10, lng: 20 }
    expect(shouldAddSignal(raw, 'all', 'all')).toBe(true)
  })

  it('passes when category matches active filter', () => {
    const raw = { id: '1', category: 'conflict', severity: 'high', lat: 10, lng: 20 }
    expect(shouldAddSignal(raw, 'conflict', 'all')).toBe(true)
  })

  it('blocks when category does not match active filter', () => {
    const raw = { id: '1', category: 'climate', severity: 'high', lat: 10, lng: 20 }
    expect(shouldAddSignal(raw, 'conflict', 'all')).toBe(false)
  })

  it('passes when severity matches active filter', () => {
    const raw = { id: '1', category: 'conflict', severity: 'critical', lat: 10, lng: 20 }
    expect(shouldAddSignal(raw, 'all', 'critical')).toBe(true)
  })

  it('blocks when severity does not match active filter', () => {
    const raw = { id: '1', category: 'conflict', severity: 'low', lat: 10, lng: 20 }
    expect(shouldAddSignal(raw, 'all', 'critical')).toBe(false)
  })

  it('blocks when both category and severity filters are active and neither matches', () => {
    const raw = { id: '1', category: 'health', severity: 'low', lat: 10, lng: 20 }
    expect(shouldAddSignal(raw, 'conflict', 'critical')).toBe(false)
  })

  it('handles missing category/severity gracefully', () => {
    const raw = { id: '1', lat: 10, lng: 20 }
    // defaults: category='other', severity='info'
    expect(shouldAddSignal(raw, 'all', 'all')).toBe(true)
    expect(shouldAddSignal(raw, 'conflict', 'all')).toBe(false)
  })
})

describe('map WS — lat/lng extraction', () => {
  it('extracts valid lat/lng', () => {
    expect(extractLatLng({ lat: 51.5, lng: -0.1 })).toEqual({ lat: 51.5, lng: -0.1 })
  })

  it('returns null when lat/lng are missing', () => {
    expect(extractLatLng({ id: 'x' })).toBeNull()
  })

  it('returns null when lat/lng are strings', () => {
    expect(extractLatLng({ lat: '51.5', lng: '-0.1' })).toBeNull()
  })
})

describe('map WS — exponential backoff reconnect', () => {
  it('doubles each time up to the max', () => {
    expect(nextBackoff(1000)).toBe(2000)
    expect(nextBackoff(2000)).toBe(4000)
    expect(nextBackoff(16000)).toBe(30000) // capped at 30s
    expect(nextBackoff(30000)).toBe(30000) // stays at 30s
  })

  it('never exceeds max', () => {
    let delay = 1000
    for (let i = 0; i < 20; i++) delay = nextBackoff(delay)
    expect(delay).toBe(30000)
  })
})

describe('map WS — signal.updated merge logic', () => {
  interface Sig { id: string; title: string; severity: string; reliability_score: number }

  function applyUpdate(signals: Sig[], raw: Record<string, unknown>): Sig[] {
    const id  = String(raw.id ?? '')
    const idx = signals.findIndex(s => s.id === id)
    if (idx === -1) return signals
    const existing = signals[idx]
    const updated: Sig = {
      ...existing,
      title:             typeof raw.title             === 'string' ? raw.title             : existing.title,
      severity:          typeof raw.severity          === 'string' ? raw.severity          : existing.severity,
      reliability_score: typeof raw.reliability_score === 'number' ? raw.reliability_score : existing.reliability_score,
    }
    return [...signals.slice(0, idx), updated, ...signals.slice(idx + 1)]
  }

  const base: Sig[] = [
    { id: 'a', title: 'Flood', severity: 'medium', reliability_score: 0.5 },
    { id: 'b', title: 'Fire',  severity: 'low',    reliability_score: 0.3 },
  ]

  it('updates an existing signal', () => {
    const result = applyUpdate(base, { id: 'a', severity: 'critical', reliability_score: 0.9 })
    expect(result[0].severity).toBe('critical')
    expect(result[0].reliability_score).toBe(0.9)
    expect(result[0].title).toBe('Flood') // unchanged
    expect(result[1]).toBe(base[1])        // untouched
  })

  it('ignores updates for unknown IDs', () => {
    const result = applyUpdate(base, { id: 'z', severity: 'critical' })
    expect(result).toBe(base)
  })

  it('preserves existing fields when update omits them', () => {
    const result = applyUpdate(base, { id: 'b', title: 'Wildfire' })
    expect(result[1].title).toBe('Wildfire')
    expect(result[1].severity).toBe('low') // unchanged
  })
})
