/**
 * source-bias.ts — Media bias scoring for news sources
 *
 * Scores are on a -1.0 (far-left) to +1.0 (far-right) scale.
 * Seed data is hand-curated from established media bias research.
 * Unknown domains fall back to heuristic detection (domain keyword signals,
 * TLD patterns, parent-domain inheritance) which returns medium or low
 * confidence depending on signal strength.
 *
 * Redis caching key: 'source-bias:{domain}' — TTL 7 days.
 */

import { redis } from '../db/redis'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BiasLabel =
  | 'far-left'
  | 'left'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'right'
  | 'far-right'
  | 'unknown'

export interface BiasScore {
  score:      number
  label:      BiasLabel
  confidence: 'high' | 'medium' | 'low'
  method:     'seed' | 'heuristic' | 'unknown'
}

// ─── Seed Bias Map ────────────────────────────────────────────────────────────
// Score: -1.0 = far-left, +1.0 = far-right

export const SEED_BIAS_MAP: Record<string, number> = {
  // Far-left (-0.8 to -1.0)
  'jacobinmag.com':    -0.90,
  'truthout.org':      -0.85,
  'counterpunch.org':  -0.88,
  'democracynow.org':  -0.82,

  // Left (-0.4 to -0.8)
  'nytimes.com':       -0.50,
  'washingtonpost.com':-0.55,
  'theguardian.com':   -0.55,
  'msnbc.com':         -0.72,
  'cnn.com':           -0.58,
  'huffpost.com':      -0.68,
  'vox.com':           -0.62,
  'theatlantic.com':   -0.48,
  'slate.com':         -0.60,
  'motherjones.com':   -0.72,

  // Center-left (-0.1 to -0.4)
  'npr.org':           -0.22,
  'bbc.com':           -0.18,
  'bbc.co.uk':         -0.18,
  'apnews.com':        -0.12,
  'usatoday.com':      -0.20,
  'time.com':          -0.28,
  'axios.com':         -0.15,

  // Center (-0.1 to +0.1)
  'reuters.com':        0.00,
  'pbs.org':           -0.08,
  'csmonitor.com':      0.02,
  'thehill.com':        0.05,

  // Center-right (+0.1 to +0.4)
  'wsj.com':            0.30,
  'economist.com':      0.20,
  'politico.com':       0.15,
  'businessinsider.com':0.18,

  // Right (+0.4 to +0.8)
  'foxnews.com':        0.65,
  'nypost.com':         0.55,
  'breitbart.com':      0.78,
  'dailymail.co.uk':    0.58,
  'washingtontimes.com':0.62,

  // Far-right (+0.8 to +1.0)
  'oann.com':           0.90,
  'thegatewaypundit.com':0.95,
  'infowars.com':       1.00,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip leading "www." prefix from a domain */
function stripWww(domain: string): string {
  return domain.startsWith('www.') ? domain.slice(4) : domain
}

/** Extract the registrable domain from a full URL or bare domain string */
export function extractDomain(urlOrDomain: string): string {
  try {
    // If it doesn't look like a URL, treat it as a domain
    const withScheme = urlOrDomain.startsWith('http') ? urlOrDomain : `https://${urlOrDomain}`
    const { hostname } = new URL(withScheme)
    return stripWww(hostname.toLowerCase())
  } catch {
    return stripWww(urlOrDomain.toLowerCase())
  }
}

/** Map a numeric bias score to a BiasLabel */
export function getBiasLabel(score: number): BiasLabel {
  if (score <= -0.8) return 'far-left'
  if (score <= -0.4) return 'left'
  if (score <= -0.1) return 'center-left'
  if (score <   0.1) return 'center'
  if (score <   0.4) return 'center-right'
  if (score <   0.8) return 'right'
  return 'far-right'
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const BIAS_CACHE_TTL = 7 * 24 * 60 * 60 // 7 days in seconds

async function getCached(domain: string): Promise<BiasScore | null> {
  try {
    const raw = await redis.get(`source-bias:${domain}`)
    return raw ? (JSON.parse(raw) as BiasScore) : null
  } catch {
    return null
  }
}

async function setCached(domain: string, bias: BiasScore): Promise<void> {
  try {
    await redis.setex(`source-bias:${domain}`, BIAS_CACHE_TTL, JSON.stringify(bias))
  } catch {
    // Non-fatal — cache miss is acceptable
  }
}

// ─── Heuristic Bias Detection ─────────────────────────────────────────────────
//
// Analyzes domain name keywords, TLD patterns, and parent-domain inheritance
// to estimate bias for sources not in the seed map.
// Returns null if no reliable signals are found (caller will return 'unknown').

/** Token keywords that strongly suggest a left-leaning editorial stance */
const LEFT_KEYWORDS = new Set([
  'progress', 'progressive', 'resist', 'liberal', 'democrat', 'labor',
  'labour', 'socialist', 'peoples', 'people', 'equality', 'justice',
  'solidarity', 'leftist', 'leftnews', 'dissent', 'alternet',
  'truthdig', 'commondreams', 'intercept', 'theintercept',
])

/** Token keywords that strongly suggest a right-leaning editorial stance */
const RIGHT_KEYWORDS = new Set([
  'patriot', 'patriots', 'conservative', 'gop', 'republican',
  'liberty', 'freedom', 'eagle', 'rightside', 'rightnews',
  'breitbart', 'daily-wire', 'dailywire', 'epoch', 'newsmax',
  'rebel', 'revolt', 'nationalist', 'tradnews', 'townhall',
  'redstate', 'pjmedia', 'americanthinker', 'frontpage',
])

/** TLD or domain-segment patterns that suggest a reliable/neutral source */
const AUTHORITATIVE_TLDS = new Set(['.gov', '.mil', '.edu', '.int', '.un.org'])

/** Country-code TLDs associated with state-influenced media (low confidence signal) */
const STATE_MEDIA_CCTLDS = new Set(['.ru', '.cn', '.ir', '.kp'])

/**
 * Tokenise a domain name into lowercase parts for keyword scanning.
 * e.g. "daily-liberty-news.com" → ["daily", "liberty", "news"]
 */
export function tokeniseDomain(domain: string): string[] {
  // Strip the public suffix (last segment after final dot)
  const withoutTld = domain.replace(/\.[^.]+$/, '')
  return withoutTld
    .split(/[-_.]+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length > 2)
}

/**
 * Derive a heuristic bias score from domain tokens.
 * Returns null when no reliable signals are detected (caller falls back to 'unknown').
 */
export function detectBiasHeuristic(domain: string): BiasScore | null {
  // 1. Authoritative sources (.gov, .edu, .mil) → center with high confidence
  for (const tld of AUTHORITATIVE_TLDS) {
    if (domain.endsWith(tld) || domain.includes(tld + '.')) {
      return { score: 0, label: 'center', confidence: 'high', method: 'heuristic' }
    }
  }

  // 2. Parent-domain inheritance — check if this is a subdomain of a known outlet
  //    e.g. "opinion.nytimes.com" inherits nytimes.com's score
  const parts = domain.split('.')
  if (parts.length >= 3) {
    // Try progressively shorter parent domains
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.')
      const parentScore = SEED_BIAS_MAP[parent]
      if (parentScore !== undefined) {
        return {
          score:      parentScore,
          label:      getBiasLabel(parentScore),
          confidence: 'medium',   // lower than seed because it's inherited
          method:     'heuristic',
        }
      }
    }
  }

  // 3. State-media country TLDs → flag as potentially biased (low confidence)
  for (const cctld of STATE_MEDIA_CCTLDS) {
    if (domain.endsWith(cctld)) {
      // Score toward center but flag low confidence — we can't know direction
      return { score: 0, label: 'center', confidence: 'low', method: 'heuristic' }
    }
  }

  // 4. Domain keyword scanning
  const tokens = tokeniseDomain(domain)

  let leftHits  = 0
  let rightHits = 0
  for (const token of tokens) {
    if (LEFT_KEYWORDS.has(token))  leftHits++
    if (RIGHT_KEYWORDS.has(token)) rightHits++
  }

  if (leftHits > 0 || rightHits > 0) {
    const netSignal = rightHits - leftHits
    // Map net signal to a rough score: each keyword hit ≈ 0.25 on the scale
    const rawScore  = Math.max(-0.75, Math.min(0.75, netSignal * 0.25))
    return {
      score:      rawScore,
      label:      getBiasLabel(rawScore),
      confidence: 'low',   // keyword-only detection is uncertain
      method:     'heuristic',
    }
  }

  // No reliable signals found
  return null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up media bias for a single domain (or URL).
 * Checks Redis cache first; falls back to seed map; then heuristic; then unknown.
 */
export async function getSourceBias(domainOrUrl: string): Promise<BiasScore> {
  const domain = extractDomain(domainOrUrl)

  // 1. Redis cache
  const cached = await getCached(domain)
  if (cached) return cached

  // 2. Seed map lookup
  const seedScore = SEED_BIAS_MAP[domain]
  if (seedScore !== undefined) {
    const bias: BiasScore = {
      score:      seedScore,
      label:      getBiasLabel(seedScore),
      confidence: 'high',
      method:     'seed',
    }
    await setCached(domain, bias)
    return bias
  }

  // 3. Heuristic detection — domain keyword signals + TLD patterns + parent inheritance
  const heuristic = detectBiasHeuristic(domain)
  if (heuristic) {
    await setCached(domain, heuristic)
    return heuristic
  }

  // 4. Unknown domain — no reliable signals detected
  const unknown: BiasScore = {
    score:      0,
    label:      'unknown',
    confidence: 'low',
    method:     'unknown',
  }
  // Cache unknowns with a shorter TTL (1 day) — domain may be seeded later
  try {
    await redis.setex(`source-bias:${domain}`, 86_400, JSON.stringify(unknown))
  } catch {
    // ignore
  }
  return unknown
}

/**
 * Bulk lookup — returns a map of domain → BiasScore.
 * Deduplicates inputs; fires all cache lookups in parallel.
 */
export async function batchGetSourceBias(
  domains: string[],
): Promise<Record<string, BiasScore>> {
  const unique = [...new Set(domains.map(extractDomain))]
  const results = await Promise.all(unique.map(d => getSourceBias(d)))
  return Object.fromEntries(unique.map((d, i) => [d, results[i]!]))
}
