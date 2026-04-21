/**
 * Video/Transcript Claim Extraction API Routes — Unit Tests
 *
 * Tests helpers, constants, channel data, and language support.
 */

import { describe, it, expect } from 'vitest'
import {
  VIDEO_SOURCE_TYPES,
  VIDEO_CLAIM_TYPES,
  VIDEO_CLAIM_STATUSES,
  SUPPORTED_LANGUAGES,
  SORT_FIELDS,
  MONITORED_CHANNELS,
  clampPage,
  clampLimit,
  isValidSortField,
} from '../video-claims'

// ─── Constants ───────────────────────────────────────────────────────────────

describe('VIDEO_SOURCE_TYPES', () => {
  it('has 7 source types', () => {
    expect(VIDEO_SOURCE_TYPES).toHaveLength(7)
  })

  it('includes youtube and news_broadcast', () => {
    expect(VIDEO_SOURCE_TYPES).toContain('youtube')
    expect(VIDEO_SOURCE_TYPES).toContain('news_broadcast')
  })

  it('includes political_debate and press_conference', () => {
    expect(VIDEO_SOURCE_TYPES).toContain('political_debate')
    expect(VIDEO_SOURCE_TYPES).toContain('press_conference')
  })

  it('includes un_session', () => {
    expect(VIDEO_SOURCE_TYPES).toContain('un_session')
  })
})

describe('VIDEO_CLAIM_TYPES', () => {
  it('has 8 claim types', () => {
    expect(VIDEO_CLAIM_TYPES).toHaveLength(8)
  })

  it('includes video-specific types: visual, chyron', () => {
    expect(VIDEO_CLAIM_TYPES).toContain('visual')
    expect(VIDEO_CLAIM_TYPES).toContain('chyron')
  })
})

describe('VIDEO_CLAIM_STATUSES', () => {
  it('has 6 statuses', () => {
    expect(VIDEO_CLAIM_STATUSES).toHaveLength(6)
  })

  it('includes retracted status', () => {
    expect(VIDEO_CLAIM_STATUSES).toContain('retracted')
  })
})

describe('SUPPORTED_LANGUAGES', () => {
  it('has 12 languages', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(12)
  })

  it('includes major world languages', () => {
    expect(SUPPORTED_LANGUAGES).toContain('en')
    expect(SUPPORTED_LANGUAGES).toContain('es')
    expect(SUPPORTED_LANGUAGES).toContain('fr')
    expect(SUPPORTED_LANGUAGES).toContain('ar')
    expect(SUPPORTED_LANGUAGES).toContain('zh')
    expect(SUPPORTED_LANGUAGES).toContain('ru')
  })
})

describe('SORT_FIELDS', () => {
  it('has 6 sortable fields', () => {
    expect(SORT_FIELDS).toHaveLength(6)
  })

  it('includes confidence and type', () => {
    expect(SORT_FIELDS).toContain('confidence')
    expect(SORT_FIELDS).toContain('type')
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('clampPage', () => {
  it('returns fallback for invalid input', () => {
    expect(clampPage(undefined)).toBe(1)
    expect(clampPage('abc')).toBe(1)
    expect(clampPage(-1)).toBe(1)
    expect(clampPage(0)).toBe(1)
  })

  it('clamps to 1000 max', () => {
    expect(clampPage(5000)).toBe(1000)
  })

  it('passes through valid values', () => {
    expect(clampPage(5)).toBe(5)
    expect(clampPage('10')).toBe(10)
  })
})

describe('clampLimit', () => {
  it('returns fallback for invalid input', () => {
    expect(clampLimit(undefined)).toBe(20)
    expect(clampLimit('xyz')).toBe(20)
    expect(clampLimit(-5)).toBe(20)
  })

  it('clamps to 100 max', () => {
    expect(clampLimit(200)).toBe(100)
  })

  it('passes through valid values', () => {
    expect(clampLimit(50)).toBe(50)
    expect(clampLimit('25')).toBe(25)
  })
})

describe('isValidSortField', () => {
  it('returns true for valid fields', () => {
    expect(isValidSortField('confidence')).toBe(true)
    expect(isValidSortField('verification_score')).toBe(true)
    expect(isValidSortField('type')).toBe(true)
  })

  it('returns false for invalid fields', () => {
    expect(isValidSortField('invalid')).toBe(false)
    expect(isValidSortField('')).toBe(false)
    expect(isValidSortField(null)).toBe(false)
    expect(isValidSortField(undefined)).toBe(false)
    expect(isValidSortField(42)).toBe(false)
  })
})

// ─── Monitored Channels ─────────────────────────────────────────────────────

describe('MONITORED_CHANNELS', () => {
  it('has 25 channels', () => {
    expect(MONITORED_CHANNELS).toHaveLength(25)
  })

  it('all channels have valid types', () => {
    for (const ch of MONITORED_CHANNELS) {
      expect(VIDEO_SOURCE_TYPES).toContain(ch.type)
    }
  })

  it('all channels have HTTPS URLs', () => {
    for (const ch of MONITORED_CHANNELS) {
      expect(ch.url).toMatch(/^https:\/\//)
    }
  })

  it('all channels have 2-letter country codes', () => {
    for (const ch of MONITORED_CHANNELS) {
      expect(ch.country).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('includes BBC News', () => {
    const bbc = MONITORED_CHANNELS.find(c => c.name === 'BBC News')
    expect(bbc).toBeDefined()
    expect(bbc?.type).toBe('news_broadcast')
    expect(bbc?.country).toBe('GB')
  })

  it('includes C-SPAN', () => {
    const cspan = MONITORED_CHANNELS.find(c => c.name === 'C-SPAN')
    expect(cspan).toBeDefined()
    expect(cspan?.type).toBe('political_debate')
    expect(cspan?.country).toBe('US')
  })

  it('includes White House', () => {
    const wh = MONITORED_CHANNELS.find(c => c.name === 'White House')
    expect(wh).toBeDefined()
    expect(wh?.type).toBe('press_conference')
  })

  it('includes UN Web TV', () => {
    const un = MONITORED_CHANNELS.find(c => c.name === 'UN Web TV')
    expect(un).toBeDefined()
    expect(un?.type).toBe('un_session')
  })

  it('includes multi-language channels', () => {
    const french = MONITORED_CHANNELS.filter(c => c.language === 'fr')
    const arabic = MONITORED_CHANNELS.filter(c => c.language === 'ar')
    expect(french.length).toBeGreaterThanOrEqual(1)
    expect(arabic.length).toBeGreaterThanOrEqual(1)
  })

  it('has channels from 10+ countries', () => {
    const countries = new Set(MONITORED_CHANNELS.map(c => c.country))
    expect(countries.size).toBeGreaterThanOrEqual(10)
  })
})

// ─── Cache Consistency ───────────────────────────────────────────────────────

describe('Cache key patterns', () => {
  it('sort field validation rejects injection attempts', () => {
    expect(isValidSortField('confidence; DROP TABLE--')).toBe(false)
    expect(isValidSortField('1=1')).toBe(false)
    expect(isValidSortField("' OR '1'='1")).toBe(false)
  })

  it('clamp functions handle Infinity', () => {
    expect(clampPage(Infinity)).toBe(1)
    expect(clampLimit(Infinity)).toBe(20)
  })

  it('clamp functions handle NaN', () => {
    expect(clampPage(NaN)).toBe(1)
    expect(clampLimit(NaN)).toBe(20)
  })
})
