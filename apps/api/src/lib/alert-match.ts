/**
 * Whether an alert's keyword is in a report (plan K6, Oct 21, 2026): as a
 * whole word or phrase, any letters' case. Until now a keyword matched
 * anywhere inside a word: "UN" matched "under" and "Mali" matched "Somalia".
 */

/** The keyword as a pattern: whole words, spaces matching any run of spaces */
export function keywordPattern(keyword: string): RegExp | null {
  const kw = keyword.trim().replace(/\s+/g, ' ')
  if (!kw) return null
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu')
}

/** Whether any of the keywords is in the text as a whole word or phrase */
export function keywordsMatch(text: string, keywords: readonly string[]): boolean {
  return keywords.some(k => keywordPattern(k)?.test(text) ?? false)
}

/** An alert's channels (a JSON column: an object, or its text) */
function channelsOf(channels: unknown): Record<string, unknown> | null {
  const c = typeof channels === 'string' ? (() => { try { return JSON.parse(channels) as unknown } catch { return null } })() : channels
  return c && typeof c === 'object' ? c as Record<string, unknown> : null
}

/** An alert's settings: whether it sends each report at once, or once a day (channels.digest, K6) */
export function isDailyDigest(channels: unknown): boolean {
  return channelsOf(channels)?.digest === 'daily'
}

export const MIN_OUTLETS_DEFAULT = 2
export const MIN_OUTLETS_MAX = 10

/**
 * When an alert fires (plan 10, Oct 21, 2026: "alert on verification, not
 * just keywords"): on each new report, or, with channels.verified, once a
 * story is verified and carried by at least channels.min_outlets independent
 * outlets (2 to 10; 2 when not given), each story once
 */
export function alertWhen(channels: unknown): { verified: boolean; minOutlets: number } {
  const c = channelsOf(channels)
  if (c?.verified !== true) return { verified: false, minOutlets: 1 }
  const n = Number(c.min_outlets)
  return { verified: true, minOutlets: Number.isInteger(n) && n >= MIN_OUTLETS_DEFAULT && n <= MIN_OUTLETS_MAX ? n : MIN_OUTLETS_DEFAULT }
}

const RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }

export interface AlertFilters {
  keywords?: string[] | null
  categories?: string[] | null
  countries?: string[] | null
  min_severity?: string | null
}

export interface AlertReport {
  title: string
  summary?: string | null
  category: string
  severity: string
  countryCode?: string | null
}

/**
 * Whether a report passes an alert's filters: its severity at least the
 * alert's, its category and country among the alert's (when it names any),
 * and one of its keywords in the headline or summary. A report with no
 * country doesn't pass an alert for certain countries (Oct 21, 2026: it did)
 */
export function alertMatches(alert: AlertFilters, report: AlertReport): boolean {
  if ((RANK[report.severity] ?? 0) < (RANK[alert.min_severity ?? 'medium'] ?? 3)) return false
  const cats = Array.isArray(alert.categories) ? alert.categories : []
  if (cats.length > 0 && !cats.includes(report.category)) return false
  const countries = Array.isArray(alert.countries) ? alert.countries : []
  if (countries.length > 0 && (!report.countryCode || !countries.includes(report.countryCode))) return false
  const keywords = Array.isArray(alert.keywords) ? alert.keywords : []
  if (keywords.length > 0 && !keywordsMatch(`${report.title} ${report.summary ?? ''}`, keywords)) return false
  return true
}
