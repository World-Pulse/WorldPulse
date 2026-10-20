/**
 * Deduplication Engine
 *
 * Prevents the same article from being processed twice.
 * Uses Redis bloom-filter-style tracking with URL normalization.
 *
 * Layers:
 *   1. URL dedup — same URL from same source (24h TTL)
 *   2. Content hash dedup — identical content across sources (24h TTL)
 *   3. Cross-source title dedup — similar events across sources (6h window)
 *   4. One report per article address, whichever news reader stores it first
 *      (4 days; claimArticle)
 */

import { createHash } from 'crypto'
import { redis } from '../lib/redis'
import { cleanUrl } from './text'

const DEDUP_TTL = 24 * 60 * 60  // 24 hours — prevents re-crawled RSS duplicates
const CROSS_SOURCE_TTL = 6 * 60 * 60  // 6 hours — cross-source event dedup window
/** A claim while one reader stores the article (its AI classification can take a while) */
const ARTICLE_PENDING_TTL = 5 * 60
/** The report holding an article: the newer news reader's own memory (sources/news-rss.ts) */
const ARTICLE_HELD_TTL = 4 * 24 * 60 * 60

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
    return (await this.claimCrossSource(title, category)).seen !== null
  },

  /**
   * Cross-source event dedup that remembers which signal holds the event, so
   * a later report from another outlet can corroborate it instead of being
   * thrown away. Claims the event when it is new (seen = null); otherwise
   * returns what is stored: the holding signal's id once rememberCrossSource
   * has run, or '1' / 'pending' when that isn't known.
   */
  async claimCrossSource(title: string, category: string): Promise<{ key: string; seen: string | null }> {
    const key = `dedup:event:${eventFingerprint(title, category)}`
    const claimed = await redis.set(key, 'pending', 'EX', CROSS_SOURCE_TTL, 'NX')
    if (claimed === 'OK') return { key, seen: null }
    return { key, seen: (await redis.get(key)) ?? '1' }
  },

  /** Record the signal that holds an event claimed with claimCrossSource (its 6-hour window is kept) */
  async rememberCrossSource(key: string, signalId: string): Promise<void> {
    await redis.set(key, signalId, 'KEEPTTL')
  },

  /**
   * One stored report per news article, whichever reader gets to it first
   * (H-0014, Oct 20, 2026). The scraper has two news readers that read some
   * of the same feeds, sources/news-rss.ts and processArticleGroup in
   * index.ts, and each remembered only what it had read itself, so some
   * articles were stored twice (4 of the 100 newest verified reports that
   * day; one DW article 3 times on Oct 19).
   *
   * Claims the article's address (articleKey) while the caller stores it:
   * seen = null. Otherwise returns what is held: the id of the report that
   * holds the article (rememberArticle), or 'pending' while the other reader
   * is storing it. Null when the address isn't one an article can be told
   * by: nothing is claimed and the caller stores as before.
   */
  async claimArticle(url: string): Promise<{ key: string; seen: string | null } | null> {
    const id = articleKey(url)
    if (!id) return null
    const key = `dedup:article:${id}`
    const claimed = await redis.set(key, 'pending', 'EX', ARTICLE_PENDING_TTL, 'NX')
    if (claimed === 'OK') return { key, seen: null }
    return { key, seen: (await redis.get(key)) ?? 'pending' }
  },

  /** The report that holds an article claimed with claimArticle (kept 4 days) */
  async rememberArticle(key: string, signalId: string): Promise<void> {
    await redis.set(key, signalId, 'EX', ARTICLE_HELD_TTL)
  },

  /** Let go of a claim when the article wasn't stored after all, so the other reader can store it */
  async releaseArticle(key: string): Promise<void> {
    if ((await redis.get(key)) === 'pending') await redis.del(key)
  },
}

/**
 * Query parameters that only say how a reader got to the page: utm_ tags,
 * BBC's at_ and ns_ tags, ad-click ids, newsletter ids. Two feeds of one
 * outlet can tag the same article differently.
 */
const TRACKING_PARAM_RE = /^(?:utm_|at_|ns_|mc_|pk_|mtm_)|^(?:fbclid|gclid|dclid|msclkid|ref|referrer|ref_src|cmpid|ocid|xtor|smid|ito|guccounter|guce_referrer|guce_referrer_sig)$/i

/**
 * An article's address as a key, the same however a feed spells it: http or
 * https, with or without "www.", a trailing slash, a #fragment, tracking
 * parameters or parameters in another order, "&" written "&amp;" (the newer
 * reader reads links from the feed's XML as written, so BBC's
 * "?at_medium=RSS&amp;at_campaign=rss" kept a parameter "amp;at_campaign"
 * and its key differed from the older reader's: one BBC article was still
 * stored twice after the fix, Oct 20, 2026). Null when the address isn't a
 * web page or is a site's front page, which can't tell one article from
 * another.
 */
export function articleKey(url: string): string | null {
  let u: URL
  try { u = new URL(cleanUrl(url.trim())) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (!host) return null
  const path = u.pathname.replace(/\/+$/, '')
  const params = [...u.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAM_RE.test(name))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
  if (!path && params.length === 0) return null
  const query = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&')
  return createHash('sha256').update(`${host}${path}${query ? `?${query}` : ''}`).digest('hex').slice(0, 32)
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
