/**
 * query-schemas.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the shared query-param validation library.
 * 25 test cases covering all schemas + parseBboxParam + parseQuery helper.
 */

import { describe, it, expect } from 'vitest'
import {
  FeedQuerySchema,
  PublicSignalsQuerySchema,
  SignalListQuerySchema,
  MapPointsQuerySchema,
  RssQuerySchema,
  WindowQuerySchema,
  parseBboxParam,
  parseQuery,
} from '../query-schemas'

// ─── FeedQuerySchema ──────────────────────────────────────────────────────────

describe('FeedQuerySchema', () => {
  it('accepts empty object and applies defaults', () => {
    const r = FeedQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.limit).toBe(20)
    expect(r.data.cursor).toBeUndefined()
    expect(r.data.category).toBeUndefined()
    expect(r.data.severity).toBeUndefined()
  })

  it('parses limit string to number', () => {
    const r = FeedQuerySchema.safeParse({ limit: '50' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.limit).toBe(50)
  })

  it('rejects severity not in enum', () => {
    const r = FeedQuerySchema.safeParse({ severity: 'catastrophic' })
    expect(r.success).toBe(false)
  })

  it('accepts valid severity values', () => {
    for (const sev of ['low', 'medium', 'high', 'critical']) {
      const r = FeedQuerySchema.safeParse({ severity: sev })
      expect(r.success).toBe(true)
    }
  })

  it('caps limit at 100', () => {
    const r = FeedQuerySchema.safeParse({ limit: '999' })
    expect(r.success).toBe(false)
  })

  it('rejects limit below 1', () => {
    const r = FeedQuerySchema.safeParse({ limit: '0' })
    expect(r.success).toBe(false)
  })
})

// ─── PublicSignalsQuerySchema ─────────────────────────────────────────────────

describe('PublicSignalsQuerySchema', () => {
  it('applies default limit=50 and offset=0', () => {
    const r = PublicSignalsQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.limit).toBe(50)
    expect(r.data.offset).toBe(0)
  })

  it('parses limit and offset strings to numbers', () => {
    const r = PublicSignalsQuerySchema.safeParse({ limit: '25', offset: '100' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.limit).toBe(25)
    expect(r.data.offset).toBe(100)
  })

  it('rejects invalid severity', () => {
    const r = PublicSignalsQuerySchema.safeParse({ severity: 'extreme' })
    expect(r.success).toBe(false)
  })

  it('rejects negative offset', () => {
    const r = PublicSignalsQuerySchema.safeParse({ offset: '-1' })
    expect(r.success).toBe(false)
  })

  it('rejects limit above 100', () => {
    const r = PublicSignalsQuerySchema.safeParse({ limit: '101' })
    expect(r.success).toBe(false)
  })
})

// ─── SignalListQuerySchema ────────────────────────────────────────────────────

describe('SignalListQuerySchema', () => {
  it('defaults status to "verified"', () => {
    const r = SignalListQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.status).toBe('verified')
  })

  it('accepts "pending" status', () => {
    const r = SignalListQuerySchema.safeParse({ status: 'pending' })
    expect(r.success).toBe(true)
  })

  it('rejects unknown status', () => {
    const r = SignalListQuerySchema.safeParse({ status: 'approved' })
    expect(r.success).toBe(false)
  })

  it('accepts a bbox string', () => {
    const r = SignalListQuerySchema.safeParse({ bbox: '-10,-5,10,5' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.bbox).toBe('-10,-5,10,5')
  })
})

// ─── MapPointsQuerySchema ─────────────────────────────────────────────────────

describe('MapPointsQuerySchema', () => {
  it('defaults hours to 24', () => {
    const r = MapPointsQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.hours).toBe(24)
  })

  it('parses hours string to number', () => {
    const r = MapPointsQuerySchema.safeParse({ hours: '48' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.hours).toBe(48)
  })

  it('caps hours at 168 (1 week)', () => {
    const r = MapPointsQuerySchema.safeParse({ hours: '200' })
    expect(r.success).toBe(false)
  })
})

// ─── RssQuerySchema ───────────────────────────────────────────────────────────

describe('RssQuerySchema', () => {
  it('defaults min_reliability to 0', () => {
    const r = RssQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.min_reliability).toBe(0)
  })

  it('parses min_reliability string to float', () => {
    const r = RssQuerySchema.safeParse({ min_reliability: '0.75' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.min_reliability).toBeCloseTo(0.75)
  })

  it('rejects min_reliability above 1', () => {
    const r = RssQuerySchema.safeParse({ min_reliability: '1.5' })
    expect(r.success).toBe(false)
  })

  it('rejects negative min_reliability', () => {
    const r = RssQuerySchema.safeParse({ min_reliability: '-0.1' })
    expect(r.success).toBe(false)
  })
})

// ─── parseBboxParam ───────────────────────────────────────────────────────────

describe('parseBboxParam', () => {
  it('parses a valid bbox string', () => {
    const r = parseBboxParam('-10,-5,10,5')
    expect('coords' in r).toBe(true)
    if (!('coords' in r)) return
    expect(r.coords).toEqual([-10, -5, 10, 5])
  })

  it('rejects fewer than 4 parts', () => {
    const r = parseBboxParam('-10,-5,10')
    expect('error' in r).toBe(true)
  })

  it('rejects non-numeric values', () => {
    const r = parseBboxParam('-10,-5,10,abc')
    expect('error' in r).toBe(true)
  })

  it('rejects longitude out of range', () => {
    const r = parseBboxParam('-200,-5,10,5')
    expect('error' in r).toBe(true)
  })

  it('rejects latitude out of range', () => {
    const r = parseBboxParam('-10,-95,10,5')
    expect('error' in r).toBe(true)
  })

  it('rejects min >= max', () => {
    const r = parseBboxParam('10,-5,-10,5')  // minLng > maxLng
    expect('error' in r).toBe(true)
  })

  it('accepts global bbox', () => {
    const r = parseBboxParam('-180,-90,180,90')
    expect('coords' in r).toBe(true)
  })
})

// ─── parseQuery helper ────────────────────────────────────────────────────────

describe('parseQuery', () => {
  it('returns data on success', () => {
    const r = parseQuery(FeedQuerySchema, { limit: '30' })
    expect(r.error).toBeNull()
    expect(r.data?.limit).toBe(30)
  })

  it('returns error string on failure', () => {
    const r = parseQuery(FeedQuerySchema, { severity: 'extreme' })
    expect(r.data).toBeNull()
    expect(typeof r.error).toBe('string')
    expect(r.error).toContain('severity')
  })

  it('includes field name in error message', () => {
    const r = parseQuery(PublicSignalsQuerySchema, { offset: '-5' })
    expect(r.data).toBeNull()
    expect(r.error).toBeTruthy()
  })
})
