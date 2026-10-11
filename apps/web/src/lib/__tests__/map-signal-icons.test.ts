/**
 * Icons of each signal's kind on the zoomed-in World Map
 * (lib/map-signal-icons.ts).
 */

import { describe, it, expect } from 'vitest'
import { categoryGlyph, signalIconId, parseSignalIconId, SIGNAL_ICON_EXPR, drawSignalIcon } from '../map-signal-icons'

describe('categoryGlyph', () => {
  it('gives each kind of news its glyph', () => {
    expect(categoryGlyph('conflict')).toBe('swords')
    expect(categoryGlyph('military')).toBe('swords')
    expect(categoryGlyph('geopolitics')).toBe('landmark')
    expect(categoryGlyph('elections')).toBe('vote')
    expect(categoryGlyph('health')).toBe('heart-pulse')
    expect(categoryGlyph('disaster')).toBe('triangle-alert')
    expect(categoryGlyph('Economy')).toBe('trending-up')
    expect(categoryGlyph('breaking')).toBe('zap')
  })

  it('draws anything else as general news', () => {
    expect(categoryGlyph('culture')).toBe('newspaper')
    expect(categoryGlyph(null)).toBe('newspaper')
    expect(categoryGlyph(undefined)).toBe('newspaper')
  })
})

describe('icon ids', () => {
  it('reads back what it writes', () => {
    const id = signalIconId('heart-pulse', 'critical', true)
    expect(id).toBe('wp-sig-heart-pulse.critical.v')
    expect(parseSignalIconId(id)).toEqual({ glyph: 'heart-pulse', severity: 'critical', verified: true })
    expect(parseSignalIconId('wp-sig-swords.low.u')).toEqual({ glyph: 'swords', severity: 'low', verified: false })
  })

  it("ignores other images and unknown glyphs", () => {
    expect(parseSignalIconId('wp-icon-plane')).toBeNull()
    expect(parseSignalIconId('wp-sig-unicorn.high.v')).toBeNull()
  })

  it('builds the same id in the map expression', () => {
    expect(SIGNAL_ICON_EXPR.slice(0, 6)).toEqual(['concat', 'wp-sig-', ['get', 'glyph'], '.', ['get', 'severity'], '.'])
    expect(SIGNAL_ICON_EXPR[6]).toEqual(['case', ['==', ['get', 'status'], 'verified'], 'v', 'u'])
  })
})

describe('drawSignalIcon', () => {
  it('draws nothing without a page (server rendering, tests)', () => {
    expect(drawSignalIcon('swords', 'high', false)).toBeNull()
  })
})
