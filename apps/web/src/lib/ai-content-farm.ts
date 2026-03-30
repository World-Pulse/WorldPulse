/**
 * ai-content-farm.ts
 *
 * Utility for detecting known AI-generated content farm domains.
 * Data sourced from NewsGuard's public AI Content Farm tracker
 * (newsguardtech.com/special-reports/ai-tracking-center/) which
 * currently tracks 3,006+ AI Content Farm sites, growing at
 * 300–500 new sites per month (as of March 2026, Pangram Labs partnership).
 *
 * WorldPulse uses this to surface credibility warnings on signals
 * originating from known AI content farms — differentiating from
 * Ground News and other aggregators that do not surface this signal.
 */

// ─── Known AI Content Farm domains ───────────────────────────────────────────
// Seed list of publicly-reported AI content farm domains.
// Sources: NewsGuard AI Tracking Center, Pangram Labs, published media reports.

const AI_CONTENT_FARM_DOMAINS = new Set<string>([
  // Tier 1 — Confirmed by NewsGuard public reports
  'worldnews24.io',
  'usaheraldnews.com',
  'reportpolitics.com',
  'thedcpatriot.com',
  'businesssandfinance.com',
  'eastcoasttimes.com',
  'greenwichtime.today',
  'libertyonenews.com',
  'usanewsflash.com',
  'realnewspost.com',
  // Tier 2 — AI slop farms identified in public NewsGuard/Pangram reporting
  'newsdailyamerica.com',
  'capitalgazettenews.com',
  'webtribune.news',
  'thestatesmen.news',
  'americanreporter.news',
  'nationalpulse24.com',
  'thepoliticalinsider.news',
  'usnewspulse.com',
  'breakingpoliticsnow.com',
  'voiceofreality.news',
])

// ─── Category metadata ────────────────────────────────────────────────────────

export type AIContentFarmCategory =
  | 'ai_generated'  // Substantively AI-generated, non-disclosed
  | 'ai_propaganda' // AI-generated + apparent propaganda/influence ops angle
  | 'unknown'

const AI_CONTENT_FARM_CATEGORIES: Record<string, AIContentFarmCategory> = {
  'thedcpatriot.com': 'ai_propaganda',
  'libertyonenews.com': 'ai_propaganda',
  'thepoliticalinsider.news': 'ai_propaganda',
  'realnewspost.com': 'ai_propaganda',
}

export interface AIContentFarmInfo {
  isAIFarm: boolean
  category: AIContentFarmCategory
  /** Canonical domain used for lookup (lowercased, www-stripped) */
  normalizedDomain: string
}

// ─── Domain normalization ─────────────────────────────────────────────────────

/**
 * Normalize a domain for lookup:
 * - Strips protocol (https://, http://)
 * - Strips path, query, fragment
 * - Lowercases
 * - Strips leading "www."
 */
export function normalizeDomain(domain: string): string {
  let d = domain.trim().toLowerCase()
  // Strip protocol
  d = d.replace(/^https?:\/\//, '')
  // Strip path/query/fragment
  d = d.split('/')[0]
  d = d.split('?')[0]
  d = d.split('#')[0]
  // Strip port
  d = d.split(':')[0]
  // Strip leading www.
  if (d.startsWith('www.')) {
    d = d.slice(4)
  }
  return d
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the given domain is a known AI content farm.
 * Accepts bare domains, URLs, or domains with "www." prefix.
 *
 * @example
 * isAIContentFarm('worldnews24.io')       // true
 * isAIContentFarm('www.worldnews24.io')   // true
 * isAIContentFarm('https://reuters.com')  // false
 */
export function isAIContentFarm(domain: string): boolean {
  if (!domain) return false
  return AI_CONTENT_FARM_DOMAINS.has(normalizeDomain(domain))
}

/**
 * Returns full metadata about a domain's AI content farm status.
 */
export function getAIContentFarmInfo(domain: string): AIContentFarmInfo {
  const normalizedDomain = normalizeDomain(domain)
  const isAIFarm = AI_CONTENT_FARM_DOMAINS.has(normalizedDomain)
  const category: AIContentFarmCategory = isAIFarm
    ? (AI_CONTENT_FARM_CATEGORIES[normalizedDomain] ?? 'ai_generated')
    : 'unknown'

  return { isAIFarm, category, normalizedDomain }
}

/**
 * Returns the full set of known AI content farm domains (read-only copy).
 * Useful for server-side pre-filtering before rendering signals.
 */
export function getKnownAIContentFarmDomains(): ReadonlySet<string> {
  return AI_CONTENT_FARM_DOMAINS
}
