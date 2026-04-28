/**
 * Deduplication Engine
 *
 * Prevents the same article from being processed twice.
 * Uses Redis bloom-filter-style tracking with URL normalization.
 *
 * Two layers:
 *   1. URL dedup — same URL from same source (24h TTL)
 *   2. Content hash dedup — identical content across sources (24h TTL)
 *   3. Cross-source title dedup — similar events across sources (6h window)
 */

import { createHash } from 'crypto'
import { redis } from '../lib/redis'

const DEDUP_TTL = 24 * 60 * 60  // 24 hours — prevents re-crawled RSS duplicates
const CROSS_SOURCE_TTL = 6 * 60 * 60  // 6 hours — cross-source event dedup window

export const dedup = {
  /**
   * Check if a URL has already been processed for a given source
   */
  async check(url: string, sourceId: string): Promise<boolean> {
    const key = `dedup:${sourceId}:${normalizeUrl(url)}`
    const exists = await redis.exists(key)
    if (exists) return true

    // Mark as seen (will expire after TTL)
    await redis.setex(key, DEDUP_TTL, '1')
    return false
  },

  /**
   * Compute a stable content hash for dedup at DB level
   */
  hash(content: string): string {
    return createHash('sha256').update(content.toLowerCase().trim()).digest('hex').slice(0, 32)
  },

  /**
   * Check if a content hash already exists in DB
   */
  async checkHash(hash: string): Promise<boolean> {
    const key = `dedup:hash:${hash}`
    const exists = await redis.exists(key)
    if (exists) return true
    await redis.setex(key, DEDUP_TTL, '1')
    return false
  },

  /**
   * Cross-source event dedup: check if a similar signal already exists.
   * Uses a normalized "event fingerprint" — category + key title words.
   * Returns true if a similar event was already seen within 6 hours.
   */
  async checkCrossSource(title: string, category: string): Promise<boolean> {
    const fingerprint = eventFingerprint(title, category)
    const key = `dedup:event:${fingerprint}`
    const exists = await redis.exists(key)
    if (exists) return true
    await redis.setex(key, CROSS_SOURCE_TTL, '1')
    return false
  },
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    // Remove tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                           'utm_term', 'fbclid', 'gclid', 'ref', 'referrer']
    trackingParams.forEach(p => u.searchParams.delete(p))
    return createHash('md5').update(u.toString()).digest('hex').slice(0, 16)
  } catch {
    return createHash('md5').update(url).digest('hex').slice(0, 16)
  }
}

// ─── STOP WORDS for event fingerprinting ────────────────────────────────────
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is',
  'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall',
  'not', 'no', 'but', 'if', 'so', 'as', 'by', 'with', 'from', 'up',
  'out', 'that', 'this', 'it', 'its', 'they', 'their', 'we', 'our',
  'new', 'says', 'said', 'report', 'reports', 'update', 'breaking',
])

/**
 * Generate a stable event fingerprint from title + category.
 * Extracts key content words, sorts them, and hashes.
 * Two articles about the same event will produce similar fingerprints
 * because they share the same nouns (people, places, events).
 */
function eventFingerprint(title: string, category: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .sort()

  // Take top 5 most distinctive words + category
  const key = `${category}:${words.slice(0, 5).join(':')}`
  return createHash('md5').update(key).digest('hex').slice(0, 16)
}
