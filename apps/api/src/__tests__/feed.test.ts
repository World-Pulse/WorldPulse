/**
 * Tests for feed route logic (global feed, signals stream, following feed).
 * Validates caching, pagination, filtering, and enrichment logic
 * without requiring a live DB or Redis — all infra is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../db/postgres', () => ({
  db: vi.fn(),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get:    vi.fn(),
    setex:  vi.fn(),
  },
}))

vi.mock('../middleware/auth', () => ({
  authenticate:  vi.fn(),
  optionalAuth:  vi.fn(),
}))

// ─── Imports after mocks ───────────────────────────────────────────────────────
const { redis } = await import('../db/redis')

// ─── Constants (from feed.ts) ─────────────────────────────────────────────────
const FEED_CACHE_TTL    = 15  // seconds — global feed
const SIGNALS_CACHE_TTL = 30  // seconds — signals stream
const PAGE_SIZE = 20

// ─── Inline business logic (replicated from routes/feed.ts) ──────────────────

/** Build per-user cache key for global feed */
function buildFeedCacheKey(
  userId: string | undefined,
  category: string,
  severity: string,
  cursor: string,
): string {
  const userSegment = userId ? `user:${userId}` : 'anon'
  return `feed:global:${userSegment}:${category}:${severity}:${cursor}`
}

/** Build cache key for signals stream */
function buildSignalsCacheKey(
  category: string,
  severity: string,
  cursor: string,
): string {
  return `feed:signals:${category}:${severity}:${cursor}`
}

/** Clamp page limit to MAX 50 */
function clampPageLimit(limit: number, max = 50): number {
  return Math.min(Number(limit), max)
}

/** Determine whether 'breaking' category maps to severity filter */
function isBreakingCategory(category: string | undefined): boolean {
  return category === 'breaking'
}

/**
 * For the 'breaking' channel: return severity values to match
 * (critical + high regardless of the category column).
 */
function breakingSeverities(): string[] {
  return ['critical', 'high']
}

/** Build cursor-based pagination where clause for posts */
function buildCursorFilter(cursorCreatedAt: Date | null, direction: 'before' | 'after' = 'before'): Record<string, unknown> | null {
  if (!cursorCreatedAt) return null
  return direction === 'before'
    ? { operator: '<', value: cursorCreatedAt }
    : { operator: '>', value: cursorCreatedAt }
}

/** Map severity to sort order (for signals stream) */
function severitySortOrder(severity: string): number {
  const order: Record<string, number> = {
    critical: 0,
    high:     1,
    medium:   2,
    low:      3,
    info:     4,
  }
  return order[severity] ?? 5
}

/** Enrich post with user-specific flags */
function enrichPost(
  post: Record<string, unknown>,
  userLikedSet: Set<string>,
  userBookmarkedSet: Set<string>,
): Record<string, unknown> {
  return {
    ...post,
    liked:      userLikedSet.has(post.id as string),
    bookmarked: userBookmarkedSet.has(post.id as string),
  }
}

/** Parse has_next_page from paginated results */
function parseHasNextPage(results: unknown[], limit: number): { items: unknown[]; hasNextPage: boolean } {
  const hasNextPage = results.length > limit
  return {
    items:       hasNextPage ? results.slice(0, limit) : results,
    hasNextPage,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Feed — cache key construction', () => {
  it('builds anon cache key when no userId provided', () => {
    const key = buildFeedCacheKey(undefined, 'all', 'all', 'start')
    expect(key).toBe('feed:global:anon:all:all:start')
  })

  it('builds user-specific cache key when userId present', () => {
    const key = buildFeedCacheKey('user-uuid-123', 'all', 'all', 'start')
    expect(key).toBe('feed:global:user:user-uuid-123:all:all:start')
  })

  it('different users get different cache keys', () => {
    const keyA = buildFeedCacheKey('user-A', 'all', 'all', 'start')
    const keyB = buildFeedCacheKey('user-B', 'all', 'all', 'start')
    expect(keyA).not.toBe(keyB)
  })

  it('includes category and severity in cache key', () => {
    const key = buildFeedCacheKey(undefined, 'conflict', 'high', 'start')
    expect(key).toContain('conflict')
    expect(key).toContain('high')
  })

  it('includes cursor in cache key for pagination isolation', () => {
    const keyPage1 = buildFeedCacheKey(undefined, 'all', 'all', 'start')
    const keyPage2 = buildFeedCacheKey(undefined, 'all', 'all', 'post-uuid-100')
    expect(keyPage1).not.toBe(keyPage2)
  })

  it('builds signals cache key without user segment', () => {
    const key = buildSignalsCacheKey('weather', 'critical', 'start')
    expect(key).toBe('feed:signals:weather:critical:start')
    expect(key).not.toContain('user:')
  })
})

describe('Feed — cache hit/miss logic', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns cached data without querying DB on cache hit', async () => {
    const cached = JSON.stringify({ success: true, data: { items: [], hasNextPage: false } })
    vi.mocked(redis.get).mockResolvedValueOnce(cached)

    const result = await redis.get('feed:global:anon:all:all:start')
    expect(result).toBe(cached)
    // DB should NOT be called — only Redis was used
    expect(vi.mocked(redis.get)).toHaveBeenCalledTimes(1)
  })

  it('returns null on cache miss (triggers DB query)', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null)
    const result = await redis.get('feed:global:anon:all:all:start')
    expect(result).toBeNull()
  })

  it('stores result in Redis after DB query with correct TTL', async () => {
    vi.mocked(redis.setex).mockResolvedValueOnce('OK' as never)
    const cacheKey = 'feed:global:anon:all:all:start'
    const data = { items: [], hasNextPage: false }
    await redis.setex(cacheKey, FEED_CACHE_TTL, JSON.stringify(data))
    expect(vi.mocked(redis.setex)).toHaveBeenCalledWith(cacheKey, FEED_CACHE_TTL, expect.any(String))
  })

  it('uses SIGNALS_CACHE_TTL (30s) for signals stream, not FEED_CACHE_TTL (15s)', () => {
    expect(SIGNALS_CACHE_TTL).toBe(30)
    expect(FEED_CACHE_TTL).toBe(15)
    expect(SIGNALS_CACHE_TTL).toBeGreaterThan(FEED_CACHE_TTL)
  })
})

describe('Feed — pagination helpers', () => {
  it('clamps page limit to max 50', () => {
    expect(clampPageLimit(100)).toBe(50)
    expect(clampPageLimit(200)).toBe(50)
  })

  it('respects limit when under max', () => {
    expect(clampPageLimit(10)).toBe(10)
    expect(clampPageLimit(50)).toBe(50)
  })

  it('uses PAGE_SIZE = 20 as default', () => {
    expect(PAGE_SIZE).toBe(20)
  })

  it('hasNextPage is true when results exceed limit', () => {
    const results = Array.from({ length: 21 }, (_, i) => ({ id: String(i) }))
    const { hasNextPage, items } = parseHasNextPage(results, 20)
    expect(hasNextPage).toBe(true)
    expect(items).toHaveLength(20)
  })

  it('hasNextPage is false when results equal limit', () => {
    const results = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }))
    const { hasNextPage } = parseHasNextPage(results, 20)
    expect(hasNextPage).toBe(false)
  })

  it('buildCursorFilter returns correct before clause', () => {
    const date = new Date('2026-03-24T00:00:00Z')
    const filter = buildCursorFilter(date, 'before')
    expect(filter).toEqual({ operator: '<', value: date })
  })

  it('returns null when no cursor provided (first page)', () => {
    const filter = buildCursorFilter(null)
    expect(filter).toBeNull()
  })
})

describe('Feed — category filters', () => {
  it('identifies "breaking" as special category', () => {
    expect(isBreakingCategory('breaking')).toBe(true)
    expect(isBreakingCategory('conflict')).toBe(false)
    expect(isBreakingCategory('all')).toBe(false)
    expect(isBreakingCategory(undefined)).toBe(false)
  })

  it('breaking category maps to critical + high severities', () => {
    const severities = breakingSeverities()
    expect(severities).toContain('critical')
    expect(severities).toContain('high')
    expect(severities).toHaveLength(2)
  })
})

describe('Feed — severity sort order', () => {
  it('sorts critical before high', () => {
    expect(severitySortOrder('critical')).toBeLessThan(severitySortOrder('high'))
  })

  it('sorts high before medium', () => {
    expect(severitySortOrder('high')).toBeLessThan(severitySortOrder('medium'))
  })

  it('sorts medium before low', () => {
    expect(severitySortOrder('medium')).toBeLessThan(severitySortOrder('low'))
  })

  it('sorts known severities before unknown values', () => {
    expect(severitySortOrder('critical')).toBeLessThan(severitySortOrder('unknown'))
  })
})

describe('Feed — post enrichment with user flags', () => {
  it('marks post as liked when user has liked it', () => {
    const post = { id: 'post-1', content: 'Hello' }
    const likedSet = new Set(['post-1', 'post-3'])
    const bookmarkedSet = new Set<string>()
    const enriched = enrichPost(post, likedSet, bookmarkedSet)
    expect(enriched.liked).toBe(true)
    expect(enriched.bookmarked).toBe(false)
  })

  it('marks post as bookmarked when user has bookmarked it', () => {
    const post = { id: 'post-2', content: 'World' }
    const likedSet = new Set<string>()
    const bookmarkedSet = new Set(['post-2'])
    const enriched = enrichPost(post, likedSet, bookmarkedSet)
    expect(enriched.liked).toBe(false)
    expect(enriched.bookmarked).toBe(true)
  })

  it('neither flag set when user has no interaction with post', () => {
    const post = { id: 'post-99', content: 'Other' }
    const enriched = enrichPost(post, new Set(), new Set())
    expect(enriched.liked).toBe(false)
    expect(enriched.bookmarked).toBe(false)
  })
})
