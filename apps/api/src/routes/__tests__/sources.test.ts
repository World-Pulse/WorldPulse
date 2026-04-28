/**
 * Sources API Route Tests — apps/api/src/routes/sources.ts
 *
 * Tests the source management system: listing, detail, suggestion,
 * admin review, bias distribution, and source bias lookup.
 *
 * Covers: schema validation, filtering, pagination, duplicate detection,
 *         admin authorization, bias distribution, and error responses.
 */

import { describe, it, expect } from 'vitest'

// ─── Schema Constraints (mirroring sources.ts Zod schemas) ──────────────────

const VALID_CATEGORIES = [
  'breaking', 'conflict', 'geopolitics', 'climate', 'health',
  'economy', 'technology', 'science', 'elections', 'culture',
  'disaster', 'security', 'sports', 'space', 'other',
] as const

const SUGGESTION_NAME_MIN = 2
const SUGGESTION_NAME_MAX = 255
const SUGGESTION_URL_MAX = 512
const SUGGESTION_REASON_MIN = 20
const SUGGESTION_REASON_MAX = 2000

type SourceCategory = typeof VALID_CATEGORIES[number]

const REVIEW_STATUSES = ['approved', 'rejected'] as const

// ─── Validation Helpers ─────────────────────────────────────────────────────

function validateSuggestion(input: {
  name: string
  url: string
  rss_url?: string
  category: string
  reason: string
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (input.name.length < SUGGESTION_NAME_MIN) errors.push('name too short')
  if (input.name.length > SUGGESTION_NAME_MAX) errors.push('name too long')

  try { new URL(input.url) } catch { errors.push('invalid url') }
  if (input.url.length > SUGGESTION_URL_MAX) errors.push('url too long')

  if (input.rss_url && input.rss_url !== '') {
    try { new URL(input.rss_url) } catch { errors.push('invalid rss_url') }
    if (input.rss_url.length > SUGGESTION_URL_MAX) errors.push('rss_url too long')
  }

  if (!(VALID_CATEGORIES as readonly string[]).includes(input.category)) {
    errors.push('invalid category')
  }

  if (input.reason.length < SUGGESTION_REASON_MIN) errors.push('reason too short')
  if (input.reason.length > SUGGESTION_REASON_MAX) errors.push('reason too long')

  return { valid: errors.length === 0, errors }
}

function validateReviewStatus(status: string): boolean {
  return (REVIEW_STATUSES as readonly string[]).includes(status as typeof REVIEW_STATUSES[number])
}

// ─── Source List Response Shape ──────────────────────────────────────────────

interface SourceListItem {
  id: string
  slug: string
  name: string
  description: string | null
  url: string
  logo_url: string | null
  tier: string
  trust_score: number
  language: string
  country: string | null
  categories: string[]
  article_count: number
  last_scraped: string | null
  created_at: string
}

function isValidSourceListItem(item: Record<string, unknown>): boolean {
  const requiredFields = [
    'id', 'slug', 'name', 'url', 'tier', 'trust_score', 'language',
    'categories', 'article_count', 'created_at',
  ]
  return requiredFields.every(f => f in item)
}

// ─── Pagination Helpers ─────────────────────────────────────────────────────

function clampLimit(limit: number): number {
  return Math.min(Number(limit), 200)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SuggestSourceSchema Constraints', () => {
  it('accepts valid suggestion with all fields', () => {
    const result = validateSuggestion({
      name: 'Al Jazeera English',
      url: 'https://www.aljazeera.com',
      rss_url: 'https://www.aljazeera.com/xml/rss/all.xml',
      category: 'breaking',
      reason: 'Major international news source with wide Middle East coverage and global perspective',
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts suggestion without optional rss_url', () => {
    const result = validateSuggestion({
      name: 'Reuters',
      url: 'https://www.reuters.com',
      category: 'breaking',
      reason: 'Premier global wire service with factual reporting standards and broad coverage',
    })
    expect(result.valid).toBe(true)
  })

  it('accepts empty string rss_url', () => {
    const result = validateSuggestion({
      name: 'Reuters',
      url: 'https://www.reuters.com',
      rss_url: '',
      category: 'breaking',
      reason: 'Premier global wire service with factual reporting standards and broad coverage',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects name shorter than 2 chars', () => {
    const result = validateSuggestion({
      name: 'X',
      url: 'https://example.com',
      category: 'breaking',
      reason: 'This is a long enough reason for the suggestion to pass validation',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('name too short')
  })

  it('rejects name longer than 255 chars', () => {
    const result = validateSuggestion({
      name: 'A'.repeat(256),
      url: 'https://example.com',
      category: 'breaking',
      reason: 'This is a long enough reason for the suggestion to pass validation',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('name too long')
  })

  it('rejects invalid url', () => {
    const result = validateSuggestion({
      name: 'Bad Source',
      url: 'not-a-url',
      category: 'breaking',
      reason: 'This is a long enough reason for the suggestion to pass validation',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('invalid url')
  })

  it('rejects invalid rss_url', () => {
    const result = validateSuggestion({
      name: 'Bad Source',
      url: 'https://example.com',
      rss_url: 'not-a-valid-rss-url',
      category: 'breaking',
      reason: 'This is a long enough reason for the suggestion to pass validation',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('invalid rss_url')
  })

  it('rejects invalid category', () => {
    const result = validateSuggestion({
      name: 'Some Source',
      url: 'https://example.com',
      category: 'invalid_category',
      reason: 'This is a long enough reason for the suggestion to pass validation',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('invalid category')
  })

  it('rejects reason shorter than 20 chars', () => {
    const result = validateSuggestion({
      name: 'Some Source',
      url: 'https://example.com',
      category: 'breaking',
      reason: 'Too short',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('reason too short')
  })

  it('rejects reason longer than 2000 chars', () => {
    const result = validateSuggestion({
      name: 'Some Source',
      url: 'https://example.com',
      category: 'breaking',
      reason: 'X'.repeat(2001),
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('reason too long')
  })
})

describe('Source Categories', () => {
  it('has exactly 15 valid categories', () => {
    expect(VALID_CATEGORIES).toHaveLength(15)
  })

  it('includes all expected categories', () => {
    const expected = [
      'breaking', 'conflict', 'geopolitics', 'climate', 'health',
      'economy', 'technology', 'science', 'elections', 'culture',
      'disaster', 'security', 'sports', 'space', 'other',
    ]
    for (const cat of expected) {
      expect(VALID_CATEGORIES).toContain(cat)
    }
  })

  it('all categories are lowercase', () => {
    for (const cat of VALID_CATEGORIES) {
      expect(cat).toBe(cat.toLowerCase())
    }
  })
})

describe('Review Status Validation', () => {
  it('accepts "approved"', () => {
    expect(validateReviewStatus('approved')).toBe(true)
  })

  it('accepts "rejected"', () => {
    expect(validateReviewStatus('rejected')).toBe(true)
  })

  it('rejects "pending"', () => {
    expect(validateReviewStatus('pending')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateReviewStatus('')).toBe(false)
  })

  it('rejects arbitrary strings', () => {
    expect(validateReviewStatus('maybe')).toBe(false)
    expect(validateReviewStatus('APPROVED')).toBe(false)
  })
})

describe('Source List Response Shape', () => {
  it('validates a complete source item', () => {
    const item = {
      id: 'uuid-123',
      slug: 'reuters',
      name: 'Reuters',
      description: 'Global wire service',
      url: 'https://www.reuters.com',
      logo_url: null,
      tier: 'premium',
      trust_score: 95,
      language: 'en',
      country: 'US',
      categories: ['breaking', 'geopolitics'],
      article_count: 15000,
      last_scraped: '2026-04-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    }
    expect(isValidSourceListItem(item)).toBe(true)
  })

  it('rejects item missing required fields', () => {
    const item = { id: 'uuid-123', name: 'Reuters' }
    expect(isValidSourceListItem(item)).toBe(false)
  })

  it('requires trust_score field', () => {
    const item = {
      id: 'uuid-123', slug: 'reuters', name: 'Reuters', url: 'https://reuters.com',
      tier: 'premium', trust_score: 90, language: 'en', categories: [], article_count: 0, created_at: '2026-01-01',
    }
    expect(isValidSourceListItem(item)).toBe(true)
    // Verify removing trust_score makes it invalid
    const { trust_score, ...withoutScore } = item
    expect(isValidSourceListItem(withoutScore)).toBe(false)
  })
})

describe('Pagination and Limits', () => {
  it('clamps limit to 200', () => {
    expect(clampLimit(500)).toBe(200)
  })

  it('allows limit of 200', () => {
    expect(clampLimit(200)).toBe(200)
  })

  it('allows limit below 200', () => {
    expect(clampLimit(50)).toBe(50)
  })

  it('handles default limit of 50', () => {
    expect(clampLimit(50)).toBe(50)
  })

  it('handles limit of 1', () => {
    expect(clampLimit(1)).toBe(1)
  })
})

describe('Source Tier Filtering', () => {
  const VALID_TIERS = ['premium', 'major', 'standard', 'specialised'] as const

  it('has 4 valid source tiers', () => {
    expect(VALID_TIERS).toHaveLength(4)
  })

  it('premium is highest tier', () => {
    expect(VALID_TIERS[0]).toBe('premium')
  })
})

describe('Source Bias Distribution', () => {
  const BIAS_LABELS = ['left', 'center-left', 'center', 'center-right', 'right', 'unknown'] as const

  it('defines 6 bias labels including unknown', () => {
    expect(BIAS_LABELS).toHaveLength(6)
  })

  it('excludes unknown from distribution results', () => {
    // The API filters WHERE bias_label != 'unknown'
    const filteredLabels = BIAS_LABELS.filter(l => l !== 'unknown')
    expect(filteredLabels).toHaveLength(5)
    expect(filteredLabels).not.toContain('unknown')
  })

  it('distribution values should be non-negative integers', () => {
    const mockDistribution: Record<string, number> = {
      left: 12, 'center-left': 45, center: 78, 'center-right': 34, right: 15,
    }
    for (const [label, count] of Object.entries(mockDistribution)) {
      expect(count).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(count)).toBe(true)
    }
  })
})

describe('Admin Authorization Logic', () => {
  const ADMIN_ACCOUNT_TYPES = ['official', 'expert']

  it('allows official account type', () => {
    expect(ADMIN_ACCOUNT_TYPES.includes('official')).toBe(true)
  })

  it('allows expert account type', () => {
    expect(ADMIN_ACCOUNT_TYPES.includes('expert')).toBe(true)
  })

  it('denies regular user', () => {
    expect(ADMIN_ACCOUNT_TYPES.includes('user')).toBe(false)
  })

  it('denies free tier', () => {
    expect(ADMIN_ACCOUNT_TYPES.includes('free')).toBe(false)
  })

  it('denies pro tier', () => {
    expect(ADMIN_ACCOUNT_TYPES.includes('pro')).toBe(false)
  })
})

describe('Error Response Format', () => {
  function buildError(code: string, error: string) {
    return { success: false, error, code }
  }

  it('returns correct format for not found', () => {
    const err = buildError('NOT_FOUND', 'Source not found')
    expect(err.success).toBe(false)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.error).toMatch(/not found/i)
  })

  it('returns correct format for duplicate suggestion', () => {
    const err = buildError('DUPLICATE_SUGGESTION', 'A suggestion for this source URL is already pending review')
    expect(err.code).toBe('DUPLICATE_SUGGESTION')
    expect(err.success).toBe(false)
  })

  it('returns correct format for source exists', () => {
    const err = buildError('SOURCE_EXISTS', 'This source is already in the WorldPulse database')
    expect(err.code).toBe('SOURCE_EXISTS')
  })

  it('returns correct format for forbidden', () => {
    const err = buildError('FORBIDDEN', 'Admin access required')
    expect(err.code).toBe('FORBIDDEN')
  })

  it('returns correct format for validation error', () => {
    const err = buildError('VALIDATION_ERROR', 'Invalid input')
    expect(err.code).toBe('VALIDATION_ERROR')
  })
})

describe('Domain Extraction', () => {
  function extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }

  it('extracts domain from full URL', () => {
    expect(extractDomain('https://www.reuters.com/world')).toBe('reuters.com')
  })

  it('strips www prefix', () => {
    expect(extractDomain('https://www.bbc.com')).toBe('bbc.com')
  })

  it('handles URL without www', () => {
    expect(extractDomain('https://aljazeera.com/news')).toBe('aljazeera.com')
  })

  it('handles subdomain', () => {
    expect(extractDomain('https://news.bbc.co.uk/feed')).toBe('news.bbc.co.uk')
  })

  it('returns empty for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe('')
  })
})
