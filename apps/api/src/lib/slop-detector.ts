/**
 * slop-detector.ts — AI-generated content farm heuristic scorer
 *
 * Scores a signal source for likelihood of being AI-generated / slop content.
 * Score range: [0.0, 1.0] — higher is more likely AI-generated/low-quality.
 *
 * Heuristics (additive, clamped to 1.0):
 *   +0.40  Domain is in the known AI content farm blocklist
 *   +0.15  Missing byline / author
 *   +0.10  Title contains repetitive phrasing (clickbait patterns)
 *   +0.10  Content body is very short (< 100 chars) — stub / thin content
 *   +0.10  Unusual publish cadence (same domain > 10 signals in 1h Redis window)
 *   +0.05  URL has no meaningful path beyond the domain (root or 1-char path)
 *
 * Threshold: score >= 0.7 → display ⚠ AI Slop warning badge in UI.
 *
 * Redis cache: 24h TTL keyed by signal ID to avoid redundant scoring.
 */

import { redis } from '../db/redis'
import { KNOWN_AI_CONTENT_FARMS } from './ai-content-farms'

// ─── Config ───────────────────────────────────────────────────────────────────
const CACHE_KEY_PREFIX   = 'slop-score:'
const CACHE_TTL          = 60 * 60 * 24        // 24 hours
const CADENCE_KEY_PREFIX = 'slop-cadence:'
const CADENCE_TTL        = 60 * 60             // 1 hour window
const CADENCE_THRESHOLD  = 10                  // signals per domain per hour

// Weights for each heuristic
const WEIGHT_BLOCKLIST   = 0.40
const WEIGHT_NO_BYLINE   = 0.15
const WEIGHT_CLICKBAIT   = 0.10
const WEIGHT_THIN_BODY   = 0.10
const WEIGHT_CADENCE     = 0.10
const WEIGHT_BARE_URL    = 0.05

// Clickbait title patterns (case-insensitive)
const CLICKBAIT_PATTERNS = [
  /\byou won't believe\b/i,
  /\bshocking(ly)?\b/i,
  /\bbreaking(?![\w-])/i,
  /\b(top|best)\s+\d+\b/i,
  /\bthis one (trick|thing|secret)\b/i,
  /\bwhat happened next\b/i,
  /\beveryone is (talking|saying)\b/i,
  /\bviral\b.*\b(now|today)\b/i,
  /!{2,}/,                               // multiple exclamation marks
]

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SlopScoreInput {
  id:           string
  source_url?:  string | null
  title?:       string | null
  content?:     string | null
  author?:      string | null
  published_at?: Date | null
}

export interface SlopScoreResult {
  score:   number
  flags:   string[]
  cached:  boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const { hostname } = new URL(url.startsWith('http') ? url : `https://${url}`)
    // Strip www. prefix for consistent matching
    return hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function hasBarePath(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const { pathname } = new URL(url.startsWith('http') ? url : `https://${url}`)
    // Path is bare if it's just "/" or very short (e.g. "/a")
    return pathname.length <= 1
  } catch {
    return false
  }
}

function detectClickbait(title: string | null | undefined): boolean {
  if (!title) return false
  return CLICKBAIT_PATTERNS.some(p => p.test(title))
}

// ─── Main detector ───────────────────────────────────────────────────────────

export class SlopDetector {
  private redisAvailable: boolean

  constructor() {
    this.redisAvailable = true
  }

  /**
   * Score a signal for AI-generated / slop content probability.
   * Never throws — returns score 0 on unexpected errors.
   */
  async scoreSignal(signal: SlopScoreInput): Promise<SlopScoreResult> {
    // 1. Cache check
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${signal.id}`
      const cached = await redis.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as SlopScoreResult
        return { ...parsed, cached: true }
      }
    } catch {
      this.redisAvailable = false
    }

    let score  = 0
    const flags: string[] = []

    // 2. Domain blocklist check
    const domain = extractDomain(signal.source_url)
    if (domain) {
      const isBlocked = (KNOWN_AI_CONTENT_FARMS as readonly string[]).includes(domain)
      if (isBlocked) {
        score += WEIGHT_BLOCKLIST
        flags.push(`domain_blocklist:${domain}`)
      }

      // 5. Cadence check — same domain > CADENCE_THRESHOLD signals in 1h
      if (this.redisAvailable) {
        try {
          const cadenceKey = `${CADENCE_KEY_PREFIX}${domain}`
          const count = await redis.incr(cadenceKey)
          if (count === 1) {
            // First signal from this domain in window — set expiry
            await redis.expire(cadenceKey, CADENCE_TTL)
          }
          if (count > CADENCE_THRESHOLD) {
            score += WEIGHT_CADENCE
            flags.push(`high_cadence:${domain}:${count}/hr`)
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // 3. Missing byline / author
    const hasAuthor = signal.author && signal.author.trim().length > 0
    if (!hasAuthor) {
      score += WEIGHT_NO_BYLINE
      flags.push('missing_byline')
    }

    // 4. Clickbait title patterns
    if (detectClickbait(signal.title)) {
      score += WEIGHT_CLICKBAIT
      flags.push('clickbait_title')
    }

    // 5. Thin body content
    const bodyLength = (signal.content ?? '').trim().length
    if (bodyLength > 0 && bodyLength < 100) {
      score += WEIGHT_THIN_BODY
      flags.push(`thin_content:${bodyLength}chars`)
    }

    // 6. Bare URL path
    if (hasBarePath(signal.source_url)) {
      score += WEIGHT_BARE_URL
      flags.push('bare_url_path')
    }

    // Clamp to [0, 1]
    const finalScore = Math.min(1, Math.max(0, Math.round(score * 100) / 100))

    const result: SlopScoreResult = {
      score:  finalScore,
      flags,
      cached: false,
    }

    // Cache result
    if (this.redisAvailable) {
      try {
        await redis.setex(
          `${CACHE_KEY_PREFIX}${signal.id}`,
          CACHE_TTL,
          JSON.stringify(result),
        )
      } catch {
        // Non-fatal
      }
    }

    return result
  }

  /**
   * Invalidate cached score — call after a signal is updated.
   */
  async invalidateCache(signalId: string): Promise<void> {
    try {
      await redis.del(`${CACHE_KEY_PREFIX}${signalId}`)
    } catch {
      // Non-fatal
    }
  }
}

// Singleton instance for use across the API
export const slopDetector = new SlopDetector()
