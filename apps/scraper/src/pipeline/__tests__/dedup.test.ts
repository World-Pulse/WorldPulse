/**
 * Unit tests for apps/scraper/src/pipeline/dedup.ts
 *
 * Covers: dedup.hash (pure), dedup.check (Redis mock), dedup.checkHash (Redis mock),
 * and URL normalisation (tracking-param stripping).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Redis mock ────────────────────────────────────────────────────────────────

const redisMock = {
  exists: vi.fn<() => Promise<number>>(),
  setex:  vi.fn<() => Promise<'OK'>>().mockResolvedValue('OK'),
}

vi.mock('../../lib/redis.js', () => ({ redis: redisMock }))

const { dedup } = await import('../dedup.js')

// ─── dedup.hash ───────────────────────────────────────────────────────────────

describe('dedup.hash', () => {
  it('returns a 32-character hex string', () => {
    const h = dedup.hash('some article content')
    expect(h).toHaveLength(32)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('is case-insensitive (lowercases before hashing)', () => {
    expect(dedup.hash('Breaking News')).toBe(dedup.hash('breaking news'))
  })

  it('trims whitespace before hashing', () => {
    expect(dedup.hash('  hello  ')).toBe(dedup.hash('hello'))
  })

  it('produces different hashes for different content', () => {
    expect(dedup.hash('article A')).not.toBe(dedup.hash('article B'))
  })

  it('is deterministic — same input always yields same hash', () => {
    const content = 'Earthquake hits eastern Turkey, magnitude 7.2'
    expect(dedup.hash(content)).toBe(dedup.hash(content))
  })
})

// ─── dedup.check ─────────────────────────────────────────────────────────────

describe('dedup.check', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns true (duplicate) when Redis key already exists', async () => {
    redisMock.exists.mockResolvedValueOnce(1)
    const result = await dedup.check('https://bbc.com/article/1', 'bbc')
    expect(result).toBe(true)
    // Should NOT call setex — already seen, no update needed
    expect(redisMock.setex).not.toHaveBeenCalled()
  })

  it('returns false (new) and marks the URL when key does not exist', async () => {
    redisMock.exists.mockResolvedValueOnce(0)
    const result = await dedup.check('https://reuters.com/article/2', 'reuters')
    expect(result).toBe(false)
    expect(redisMock.setex).toHaveBeenCalledOnce()
    // TTL should be 7 days in seconds
    const [, ttl] = redisMock.setex.mock.calls[0] as [string, number, string]
    expect(ttl).toBe(7 * 24 * 60 * 60)
  })

  it('strips UTM tracking params so the same article URL deduplicates correctly', async () => {
    redisMock.exists.mockResolvedValue(0)

    // First call — clean URL
    await dedup.check('https://ap.org/story/123', 'ap')
    const [key1] = redisMock.setex.mock.calls[0] as [string, number, string]

    vi.clearAllMocks()
    redisMock.exists.mockResolvedValue(0)

    // Second call — same URL with UTM params
    await dedup.check('https://ap.org/story/123?utm_source=twitter&utm_campaign=breaking', 'ap')
    const [key2] = redisMock.setex.mock.calls[0] as [string, number, string]

    // Both should produce the same dedup key (tracking params stripped)
    expect(key1).toBe(key2)
  })

  it('includes the sourceId in the Redis key', async () => {
    redisMock.exists.mockResolvedValue(0)
    await dedup.check('https://cnn.com/article/99', 'cnn')
    const [key] = redisMock.setex.mock.calls[0] as [string, number, string]
    expect(key).toContain('cnn')
  })
})

// ─── dedup.checkHash ─────────────────────────────────────────────────────────

describe('dedup.checkHash', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns true when hash key already exists in Redis', async () => {
    redisMock.exists.mockResolvedValueOnce(1)
    const result = await dedup.checkHash('abc123deadbeef')
    expect(result).toBe(true)
    expect(redisMock.setex).not.toHaveBeenCalled()
  })

  it('returns false and stores the hash when it is new', async () => {
    redisMock.exists.mockResolvedValueOnce(0)
    const result = await dedup.checkHash('deadbeef12345678')
    expect(result).toBe(false)
    expect(redisMock.setex).toHaveBeenCalledOnce()
  })

  it('namespaces hash keys separately from URL keys', async () => {
    redisMock.exists.mockResolvedValue(0)
    await dedup.checkHash('somehash')
    const [key] = redisMock.setex.mock.calls[0] as [string, number, string]
    expect(key).toContain('hash')
  })
})
