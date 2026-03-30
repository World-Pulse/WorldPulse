/**
 * SourceChain unit tests
 *
 * Tests for the pure helper functions exported from SourceChain.tsx:
 *   - computeSourceChainMode  – determines render mode
 *   - showPrimarySourceCTA    – controls standalone CTA visibility
 *   - reliabilityBarColor     – maps trust score to hex colour
 *
 * Node environment (no jsdom) — tests are purely functional.
 */

import { describe, it, expect } from 'vitest'
import {
  computeSourceChainMode,
  showPrimarySourceCTA,
  reliabilityBarColor,
} from '../SourceChain'
import type { Source } from '@worldpulse/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id:          'src-1',
    slug:        'reuters',
    name:        'Reuters',
    description: null,
    url:         'https://reuters.com',
    logoUrl:     null,
    tier:        'wire',
    trustScore:  0.91,
    language:    'en',
    country:     null,
    categories:  [],
    activeAt:    new Date().toISOString(),
    ...overrides,
  }
}

// ─── computeSourceChainMode ───────────────────────────────────────────────────

describe('computeSourceChainMode', () => {
  it('returns "hidden" when sources is empty and no sourceUrl', () => {
    expect(computeSourceChainMode([], null)).toBe('hidden')
    expect(computeSourceChainMode([], undefined)).toBe('hidden')
  })

  it('returns "cta_only" when sources is empty but sourceUrl is present', () => {
    expect(computeSourceChainMode([], 'https://bbc.com/article/1')).toBe('cta_only')
  })

  it('returns "list" when there is 1 source regardless of sourceUrl', () => {
    expect(computeSourceChainMode([makeSource()], null)).toBe('list')
    expect(computeSourceChainMode([makeSource()], 'https://bbc.com')).toBe('list')
  })

  it('returns "list" when there are 3 sources', () => {
    const sources = [
      makeSource({ id: 'src-1', name: 'Reuters' }),
      makeSource({ id: 'src-2', name: 'AP News', trustScore: 0.88 }),
      makeSource({ id: 'src-3', name: 'BBC',     trustScore: 0.82 }),
    ]
    expect(computeSourceChainMode(sources, null)).toBe('list')
  })
})

// ─── showPrimarySourceCTA ─────────────────────────────────────────────────────

describe('showPrimarySourceCTA', () => {
  it('returns false when sourceUrl is null', () => {
    expect(showPrimarySourceCTA([makeSource()], null)).toBe(false)
    expect(showPrimarySourceCTA([], null)).toBe(false)
  })

  it('returns false when sourceUrl is undefined', () => {
    expect(showPrimarySourceCTA([makeSource()], undefined)).toBe(false)
  })

  it('returns true when sourceUrl is set and no source has a matching articleUrl', () => {
    const src = makeSource({ articleUrl: 'https://reuters.com/article/other' })
    expect(showPrimarySourceCTA([src], 'https://reuters.com/article/primary')).toBe(true)
  })

  it('returns false when a source articleUrl matches sourceUrl exactly', () => {
    const url = 'https://reuters.com/article/primary'
    const src = makeSource({ articleUrl: url })
    expect(showPrimarySourceCTA([src], url)).toBe(false)
  })

  it('returns true for empty sources array with a sourceUrl', () => {
    expect(showPrimarySourceCTA([], 'https://ap.org/article/1')).toBe(true)
  })
})

// ─── reliabilityBarColor ──────────────────────────────────────────────────────

describe('reliabilityBarColor', () => {
  it('returns green (#00e676) for scores >= 0.8', () => {
    expect(reliabilityBarColor(0.80)).toBe('#00e676')
    expect(reliabilityBarColor(0.91)).toBe('#00e676')
    expect(reliabilityBarColor(1.00)).toBe('#00e676')
  })

  it('returns amber (#f5a623) for scores >= 0.6 and < 0.8', () => {
    expect(reliabilityBarColor(0.60)).toBe('#f5a623')
    expect(reliabilityBarColor(0.70)).toBe('#f5a623')
    expect(reliabilityBarColor(0.79)).toBe('#f5a623')
  })

  it('returns red (#ff3b5c) for scores < 0.6', () => {
    expect(reliabilityBarColor(0.59)).toBe('#ff3b5c')
    expect(reliabilityBarColor(0.30)).toBe('#ff3b5c')
    expect(reliabilityBarColor(0.00)).toBe('#ff3b5c')
  })

  it('boundary: exactly 0.8 maps to green, exactly 0.6 maps to amber', () => {
    expect(reliabilityBarColor(0.8)).toBe('#00e676')
    expect(reliabilityBarColor(0.6)).toBe('#f5a623')
  })
})
