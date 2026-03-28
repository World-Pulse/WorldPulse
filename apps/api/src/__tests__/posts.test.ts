/**
 * Posts Route — Unit Tests
 *
 * Tests for exported pure functions from apps/api/src/routes/posts.ts:
 *   detectLanguage   — script-pattern + latin stop-word language detector
 *   CreatePostSchema — Zod validation for post creation payload
 *   formatBasicPost  — camelCase formatter for DB post rows
 *
 * No DB / Redis / Meilisearch calls are made — all heavy dependencies are mocked.
 */

import { describe, it, expect, vi } from 'vitest'

// ── Mock heavy deps before importing routes ──────────────────────────────────
vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../db/redis', () => ({
  redis: { publish: vi.fn(), get: vi.fn(), setex: vi.fn() },
}))
vi.mock('../lib/search',        () => ({ indexPost: vi.fn(), removePost: vi.fn() }))
vi.mock('../lib/search-events', () => ({ publishPostCreated: vi.fn(), publishPostDeleted: vi.fn() }))
vi.mock('../middleware/auth',   () => ({
  authenticate: vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
  optionalAuth: vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
}))
vi.mock('../ws/handler', () => ({ broadcast: vi.fn() }))

import { detectLanguage, CreatePostSchema, formatBasicPost } from '../routes/posts'

// ─── detectLanguage ───────────────────────────────────────────────────────────

describe('detectLanguage — script detection', () => {
  it('detects Chinese (CJK Unified Ideographs)', () => {
    expect(detectLanguage('北京发生重大地震')).toBe('zh')
  })

  it('detects Japanese (Hiragana/Katakana)', () => {
    expect(detectLanguage('東京で地震が発生しました')).toBe('ja')
  })

  it('detects Korean (Hangul)', () => {
    expect(detectLanguage('서울에서 지진이 발생했습니다')).toBe('ko')
  })

  it('detects Arabic', () => {
    expect(detectLanguage('حدث زلزال في القاهرة')).toBe('ar')
  })

  it('detects Cyrillic (Russian)', () => {
    expect(detectLanguage('Землетрясение произошло в Москве')).toBe('ru')
  })

  it('detects Devanagari (Hindi)', () => {
    expect(detectLanguage('मुंबई में भूकंप आया')).toBe('hi')
  })

  it('detects Greek', () => {
    expect(detectLanguage('Σεισμός στην Αθήνα')).toBe('el')
  })

  it('detects Thai', () => {
    expect(detectLanguage('แผ่นดินไหวในกรุงเทพ')).toBe('th')
  })

  it('detects Hebrew', () => {
    expect(detectLanguage('רעידת אדמה בתל אביב')).toBe('he')
  })
})

describe('detectLanguage — Latin stop-word heuristic', () => {
  it('detects Spanish via stop-words (que, del, los)', () => {
    expect(detectLanguage('El terremoto que afecta los edificios del centro')).toBe('es')
  })

  it('detects French via stop-words (les, des, est)', () => {
    expect(detectLanguage('Les résultats des élections est attendus')).toBe('fr')
  })

  it('detects German via stop-words (die, und, nicht)', () => {
    expect(detectLanguage('Die Regierung und die Opposition sind nicht einig')).toBe('de')
  })

  it('detects Portuguese via stop-words (não, com, para)', () => {
    expect(detectLanguage('Não podemos continuar com isso para sempre')).toBe('pt')
  })

  it('detects Italian via stop-words (che, del, per)', () => {
    expect(detectLanguage('Il problema che si trova del territorio per tutti')).toBe('it')
  })

  it('defaults to English when no script or stop-word matches', () => {
    expect(detectLanguage('Breaking news from London tonight')).toBe('en')
  })

  it('returns "en" for an empty string', () => {
    expect(detectLanguage('')).toBe('en')
  })
})

// ─── CreatePostSchema ─────────────────────────────────────────────────────────

describe('CreatePostSchema — validation', () => {
  it('accepts a minimal valid post (content only)', () => {
    const r = CreatePostSchema.safeParse({ content: 'Hello world' })
    expect(r.success).toBe(true)
  })

  it('rejects empty content', () => {
    expect(CreatePostSchema.safeParse({ content: '' }).success).toBe(false)
  })

  it('rejects content exceeding 2000 characters', () => {
    expect(CreatePostSchema.safeParse({ content: 'x'.repeat(2001) }).success).toBe(false)
  })

  it('accepts content at exactly 2000 characters', () => {
    expect(CreatePostSchema.safeParse({ content: 'x'.repeat(2000) }).success).toBe(true)
  })

  it('defaults postType to "signal"', () => {
    const r = CreatePostSchema.safeParse({ content: 'Test' })
    expect(r.success && r.data.postType).toBe('signal')
  })

  it('accepts all valid postType values', () => {
    const types = ['signal', 'thread', 'report', 'boost', 'deep_dive', 'poll'] as const
    for (const postType of types) {
      expect(CreatePostSchema.safeParse({ content: 'Test', postType }).success).toBe(true)
    }
  })

  it('rejects invalid postType', () => {
    expect(CreatePostSchema.safeParse({ content: 'Test', postType: 'status' }).success).toBe(false)
  })

  it('rejects invalid UUID for signalId', () => {
    expect(CreatePostSchema.safeParse({ content: 'Test', signalId: 'not-a-uuid' }).success).toBe(false)
  })

  it('accepts a valid UUID for signalId', () => {
    expect(
      CreatePostSchema.safeParse({ content: 'Test', signalId: '123e4567-e89b-12d3-a456-426614174000' }).success,
    ).toBe(true)
  })

  it('rejects mediaUrls array with more than 4 items', () => {
    const mediaUrls = [
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
      'https://example.com/4.jpg',
      'https://example.com/5.jpg',
    ]
    expect(CreatePostSchema.safeParse({ content: 'Test', mediaUrls }).success).toBe(false)
  })

  it('accepts mediaUrls at exactly 4 items', () => {
    const mediaUrls = [
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
      'https://example.com/4.jpg',
    ]
    expect(CreatePostSchema.safeParse({ content: 'Test', mediaUrls }).success).toBe(true)
  })

  it('rejects invalid URL in mediaUrls', () => {
    expect(
      CreatePostSchema.safeParse({ content: 'Test', mediaUrls: ['not-a-url'] }).success,
    ).toBe(false)
  })

  it('rejects tags array with more than 10 items', () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`)
    expect(CreatePostSchema.safeParse({ content: 'Test', tags }).success).toBe(false)
  })

  it('accepts tags at exactly 10 items', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`)
    expect(CreatePostSchema.safeParse({ content: 'Test', tags }).success).toBe(true)
  })

  it('rejects a tag exceeding 50 characters', () => {
    expect(
      CreatePostSchema.safeParse({ content: 'Test', tags: ['x'.repeat(51)] }).success,
    ).toBe(false)
  })

  it('defaults mediaUrls, mediaTypes, and tags to empty arrays', () => {
    const r = CreatePostSchema.safeParse({ content: 'Test' })
    expect(r.success && r.data.mediaUrls).toEqual([])
    expect(r.success && r.data.mediaTypes).toEqual([])
    expect(r.success && r.data.tags).toEqual([])
  })
})

// ─── formatBasicPost ─────────────────────────────────────────────────────────

function makePostRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2024-06-15T08:30:00Z')
  return {
    id:               'post-001',
    post_type:        'signal',
    content:          'Breaking: earthquake detected',
    media_urls:       ['https://example.com/img.jpg'],
    media_types:      ['image/jpeg'],
    source_url:       'https://reuters.com/story',
    source_name:      'Reuters',
    tags:             ['earthquake', 'breaking'],
    like_count:       10,
    boost_count:      3,
    reply_count:      5,
    view_count:       200,
    location_name:    'Tokyo',
    language:         'en',
    created_at:       now,
    updated_at:       now,
    signal_id:        null,
    parent_id:        null,
    boost_of_id:      null,
    thread_root_id:   null,
    reliability_score: 0.85,
    author_id:        'user-001',
    author_handle:    'janedoe',
    author_display_name: 'Jane Doe',
    author_avatar:    'https://example.com/avatar.jpg',
    author_type:      'journalist',
    author_trust:     0.9,
    author_verified:  true,
    signal_title:     null,
    signal_category:  null,
    signal_severity:  null,
    signal_status:    null,
    signal_reliability: null,
    signal_location:  null,
    ...overrides,
  }
}

describe('formatBasicPost', () => {
  it('maps DB row to camelCase output', () => {
    const result = formatBasicPost(makePostRow())
    expect(result.id).toBe('post-001')
    expect(result.postType).toBe('signal')
    expect(result.content).toBe('Breaking: earthquake detected')
    expect(result.likeCount).toBe(10)
    expect(result.boostCount).toBe(3)
    expect(result.replyCount).toBe(5)
    expect(result.locationName).toBe('Tokyo')
    expect(result.language).toBe('en')
  })

  it('formats author sub-object correctly', () => {
    const result = formatBasicPost(makePostRow())
    expect(result.author.handle).toBe('janedoe')
    expect(result.author.displayName).toBe('Jane Doe')
    expect(result.author.accountType).toBe('journalist')
    expect(result.author.trustScore).toBe(0.9)
    expect(result.author.verified).toBe(true)
  })

  it('converts created_at and updated_at to ISO strings', () => {
    const result = formatBasicPost(makePostRow())
    expect(result.createdAt).toBe('2024-06-15T08:30:00.000Z')
    expect(result.updatedAt).toBe('2024-06-15T08:30:00.000Z')
  })

  it('defaults media arrays to [] when null', () => {
    const result = formatBasicPost(makePostRow({ media_urls: null, media_types: null }))
    expect(result.mediaUrls).toEqual([])
    expect(result.mediaTypes).toEqual([])
  })

  it('defaults tags to [] when null', () => {
    expect(formatBasicPost(makePostRow({ tags: null })).tags).toEqual([])
  })

  it('sets hasLiked/hasBoosted/hasBookmarked = false by default (no viewer sets)', () => {
    const result = formatBasicPost(makePostRow())
    expect(result.hasLiked).toBe(false)
    expect(result.hasBoosted).toBe(false)
    expect(result.hasBookmarked).toBe(false)
  })

  it('sets hasLiked = true when post id is in likedIds set', () => {
    const id = 'post-001'
    const result = formatBasicPost(makePostRow({ id }), new Set([id]))
    expect(result.hasLiked).toBe(true)
    expect(result.hasBoosted).toBe(false)
  })

  it('sets hasBoosted = true when post id is in boostedIds set', () => {
    const id = 'post-001'
    const result = formatBasicPost(makePostRow({ id }), new Set(), new Set([id]))
    expect(result.hasBoosted).toBe(true)
    expect(result.hasLiked).toBe(false)
  })

  it('sets hasBookmarked = true when post id is in bookmarkedIds set', () => {
    const id = 'post-001'
    const result = formatBasicPost(makePostRow({ id }), new Set(), new Set(), new Set([id]))
    expect(result.hasBookmarked).toBe(true)
  })

  it('defaults language to "en" when null', () => {
    expect(formatBasicPost(makePostRow({ language: null })).language).toBe('en')
  })

  it('includes nested signal object when signal_id is present', () => {
    const result = formatBasicPost(makePostRow({
      signal_id:       'sig-001',
      signal_title:    'Earthquake in Tokyo',
      signal_category: 'disaster',
      signal_severity: 'high',
    }))
    expect(result.signal).not.toBeNull()
    expect(result.signal?.id).toBe('sig-001')
    expect(result.signal?.title).toBe('Earthquake in Tokyo')
    expect(result.signal?.category).toBe('disaster')
  })

  it('sets signal = null when signal_id is null', () => {
    expect(formatBasicPost(makePostRow({ signal_id: null })).signal).toBeNull()
  })
})
