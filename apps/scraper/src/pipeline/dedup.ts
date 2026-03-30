/**
 * Deduplication Engine
 * 
 * Prevents the same article from being processed twice.
 * Uses Redis bloom-filter-style tracking with URL normalization.
 */

import { createHash } from 'crypto'
import { redis } from '../lib/redis'

const DEDUP_TTL = 60 * 60  // 1 hour — was 7 days which blocked all re-crawled RSS items

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
