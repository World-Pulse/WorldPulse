/**
 * ViralityBadge unit tests
 *
 * Tests for the pure `computeViralityStatus` function that drives
 * the virality badge displayed on signal cards and detail pages.
 *
 * Updated in cycle 16: added lastCorroboratedAt parameter tests.
 * The function now takes (sourceCount, lastCorroboratedAt, lastUpdated).
 */

import { describe, it, expect } from 'vitest'
import { computeViralityStatus } from '../ViralityBadge'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Return an ISO timestamp N hours in the past */
function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString()
}

// ─── Tests: backward-compat (lastCorroboratedAt = null, lastUpdated as fallback) ──

describe('computeViralityStatus — lastUpdated fallback (lastCorroboratedAt absent)', () => {
  it('returns "viral" when source_count >= 8, regardless of timestamp', () => {
    expect(computeViralityStatus(8,  null, hoursAgo(1))).toBe('viral')
    expect(computeViralityStatus(10, null, hoursAgo(10))).toBe('viral')
    expect(computeViralityStatus(8,  null, undefined)).toBe('viral')
  })

  it('returns "viral" for exactly 8 sources', () => {
    expect(computeViralityStatus(8, null, hoursAgo(0.5))).toBe('viral')
  })

  it('returns "viral" for very high source counts', () => {
    expect(computeViralityStatus(50, null, hoursAgo(24))).toBe('viral')
  })

  it('returns "spreading" when 3+ sources and lastUpdated within 4 hours', () => {
    expect(computeViralityStatus(3, null, hoursAgo(1))).toBe('spreading')
    expect(computeViralityStatus(5, null, hoursAgo(2))).toBe('spreading')
    expect(computeViralityStatus(7, null, hoursAgo(3.9))).toBe('spreading')
  })

  it('returns "multi_source" when 3+ sources but lastUpdated > 4 hours ago', () => {
    expect(computeViralityStatus(3, null, hoursAgo(5))).toBe('multi_source')
    expect(computeViralityStatus(5, null, hoursAgo(12))).toBe('multi_source')
  })

  it('returns "multi_source" when 3+ sources and no timestamp at all', () => {
    expect(computeViralityStatus(3, null, undefined)).toBe('multi_source')
    expect(computeViralityStatus(5, undefined, null)).toBe('multi_source')
  })

  it('returns null below multi-source threshold', () => {
    expect(computeViralityStatus(0, null, hoursAgo(1))).toBeNull()
    expect(computeViralityStatus(1, null, hoursAgo(0.5))).toBeNull()
    expect(computeViralityStatus(2, null, hoursAgo(1))).toBeNull()
  })

  it('handles invalid timestamp string gracefully — falls back to multi_source', () => {
    expect(computeViralityStatus(4, null, 'not-a-date')).toBe('multi_source')
  })
})

// ─── Tests: lastCorroboratedAt (preferred over lastUpdated) ──────────────────

describe('computeViralityStatus — lastCorroboratedAt (precise, preferred path)', () => {
  it('uses lastCorroboratedAt when provided, ignoring lastUpdated', () => {
    // lastCorroboratedAt says recent, lastUpdated says old — should be spreading
    expect(computeViralityStatus(4, hoursAgo(1), hoursAgo(48))).toBe('spreading')
  })

  it('detects spreading via lastCorroboratedAt even when lastUpdated is null', () => {
    expect(computeViralityStatus(5, hoursAgo(2), null)).toBe('spreading')
  })

  it('returns multi_source when lastCorroboratedAt is old (> 4h), even if lastUpdated is recent', () => {
    // lastCorroboratedAt is stale, lastUpdated is recent — multi_source wins (corrob takes priority)
    expect(computeViralityStatus(4, hoursAgo(10), hoursAgo(0.5))).toBe('multi_source')
  })

  it('returns viral for 8+ sources regardless of lastCorroboratedAt', () => {
    expect(computeViralityStatus(8, hoursAgo(100), hoursAgo(100))).toBe('viral')
    expect(computeViralityStatus(9, undefined, undefined)).toBe('viral')
  })

  it('returns spreading for exactly 3 sources corroborated within 4h', () => {
    expect(computeViralityStatus(3, hoursAgo(0.1), null)).toBe('spreading')
  })

  it('transitions from spreading to multi_source at 4h boundary', () => {
    expect(computeViralityStatus(4, hoursAgo(3.99), null)).toBe('spreading')
    expect(computeViralityStatus(4, hoursAgo(4.01), null)).toBe('multi_source')
  })

  it('viral takes priority over corroboration recency', () => {
    expect(computeViralityStatus(8, hoursAgo(0.01), hoursAgo(0.01))).toBe('viral')
  })

  it('falls back to lastUpdated when lastCorroboratedAt is undefined', () => {
    expect(computeViralityStatus(4, undefined, hoursAgo(1))).toBe('spreading')
    expect(computeViralityStatus(4, undefined, hoursAgo(10))).toBe('multi_source')
  })

  it('returns null below multi-source threshold even with fresh lastCorroboratedAt', () => {
    expect(computeViralityStatus(2, hoursAgo(0.1), hoursAgo(0.1))).toBeNull()
    expect(computeViralityStatus(1, hoursAgo(0), null)).toBeNull()
  })
})

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('computeViralityStatus — edge cases', () => {
  it('both timestamps null or undefined → multi_source for 3+ sources', () => {
    expect(computeViralityStatus(3, null, null)).toBe('multi_source')
    expect(computeViralityStatus(5, undefined, undefined)).toBe('multi_source')
  })

  it('sourceCount exactly at MULTI_SOURCE_MIN (3) with recent corroboration', () => {
    expect(computeViralityStatus(3, hoursAgo(0.5), null)).toBe('spreading')
  })

  it('sourceCount exactly at VIRAL_MIN (8) is always viral', () => {
    expect(computeViralityStatus(8, null, null)).toBe('viral')
  })
})
