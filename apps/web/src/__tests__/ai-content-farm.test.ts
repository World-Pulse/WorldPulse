/**
 * ai-content-farm.test.ts
 *
 * Tests for the AI content farm detection utility.
 * Validates domain normalization, known-farm detection,
 * metadata accuracy, and edge-case handling.
 */

import { describe, it, expect } from 'vitest'
import {
  isAIContentFarm,
  getAIContentFarmInfo,
  normalizeDomain,
  getKnownAIContentFarmDomains,
} from '../lib/ai-content-farm'

// ─── normalizeDomain ──────────────────────────────────────────────────────────

describe('normalizeDomain', () => {
  it('lowercases the domain', () => {
    expect(normalizeDomain('WorldNews24.IO')).toBe('worldnews24.io')
  })

  it('strips www. prefix', () => {
    expect(normalizeDomain('www.reuters.com')).toBe('reuters.com')
  })

  it('strips https:// protocol', () => {
    expect(normalizeDomain('https://reuters.com/world')).toBe('reuters.com')
  })

  it('strips http:// protocol', () => {
    expect(normalizeDomain('http://worldnews24.io/story/123')).toBe('worldnews24.io')
  })

  it('strips path component', () => {
    expect(normalizeDomain('bbc.com/news/world')).toBe('bbc.com')
  })

  it('strips query string', () => {
    expect(normalizeDomain('example.com?ref=twitter')).toBe('example.com')
  })

  it('strips port number', () => {
    expect(normalizeDomain('localhost:3000')).toBe('localhost')
  })

  it('handles leading/trailing whitespace', () => {
    expect(normalizeDomain('  reuters.com  ')).toBe('reuters.com')
  })

  it('strips www. from full URL', () => {
    expect(normalizeDomain('https://www.worldnews24.io/article?id=1')).toBe('worldnews24.io')
  })
})

// ─── isAIContentFarm ─────────────────────────────────────────────────────────

describe('isAIContentFarm', () => {
  // Positive cases — known AI content farms
  it('detects a known AI content farm domain', () => {
    expect(isAIContentFarm('worldnews24.io')).toBe(true)
  })

  it('detects with www. prefix', () => {
    expect(isAIContentFarm('www.worldnews24.io')).toBe(true)
  })

  it('detects from full HTTPS URL', () => {
    expect(isAIContentFarm('https://worldnews24.io/story/foo')).toBe(true)
  })

  it('detects case-insensitively', () => {
    expect(isAIContentFarm('USAHeraldNews.COM')).toBe(true)
  })

  it('detects another known farm: reportpolitics.com', () => {
    expect(isAIContentFarm('reportpolitics.com')).toBe(true)
  })

  it('detects libertyonenews.com', () => {
    expect(isAIContentFarm('libertyonenews.com')).toBe(true)
  })

  it('detects thedcpatriot.com', () => {
    expect(isAIContentFarm('thedcpatriot.com')).toBe(true)
  })

  // Negative cases — trusted/legitimate sources
  it('returns false for reuters.com', () => {
    expect(isAIContentFarm('reuters.com')).toBe(false)
  })

  it('returns false for bbc.com', () => {
    expect(isAIContentFarm('bbc.com')).toBe(false)
  })

  it('returns false for apnews.com', () => {
    expect(isAIContentFarm('apnews.com')).toBe(false)
  })

  it('returns false for theguardian.com', () => {
    expect(isAIContentFarm('theguardian.com')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isAIContentFarm('')).toBe(false)
  })

  it('returns false for a random unknown domain', () => {
    expect(isAIContentFarm('totally-legit-news.example.com')).toBe(false)
  })
})

// ─── getAIContentFarmInfo ─────────────────────────────────────────────────────

describe('getAIContentFarmInfo', () => {
  it('returns isAIFarm:true and category for a known propaganda farm', () => {
    const info = getAIContentFarmInfo('thedcpatriot.com')
    expect(info.isAIFarm).toBe(true)
    expect(info.category).toBe('ai_propaganda')
    expect(info.normalizedDomain).toBe('thedcpatriot.com')
  })

  it('returns isAIFarm:true and ai_generated for a non-propaganda farm', () => {
    const info = getAIContentFarmInfo('worldnews24.io')
    expect(info.isAIFarm).toBe(true)
    expect(info.category).toBe('ai_generated')
  })

  it('returns isAIFarm:false and unknown for a trusted domain', () => {
    const info = getAIContentFarmInfo('reuters.com')
    expect(info.isAIFarm).toBe(false)
    expect(info.category).toBe('unknown')
  })

  it('normalizes domain in the returned info', () => {
    const info = getAIContentFarmInfo('https://www.LibertyOneNews.com/story')
    expect(info.isAIFarm).toBe(true)
    expect(info.normalizedDomain).toBe('libertyonenews.com')
  })
})

// ─── getKnownAIContentFarmDomains ────────────────────────────────────────────

describe('getKnownAIContentFarmDomains', () => {
  it('returns a non-empty set', () => {
    const domains = getKnownAIContentFarmDomains()
    expect(domains.size).toBeGreaterThan(10)
  })

  it('contains known farms', () => {
    const domains = getKnownAIContentFarmDomains()
    expect(domains.has('worldnews24.io')).toBe(true)
    expect(domains.has('reportpolitics.com')).toBe(true)
  })

  it('is read-only (Set does not expose mutable add method via type)', () => {
    const domains = getKnownAIContentFarmDomains()
    // ReadonlySet type — calling .has() should work; the type system prevents .add()
    expect(domains.has('bbc.com')).toBe(false)
  })
})
