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

/** An alert's settings: whether it sends each report at once, or once a day (channels.digest, K6) */
export function isDailyDigest(channels: unknown): boolean {
  const c = typeof channels === 'string' ? (() => { try { return JSON.parse(channels) as unknown } catch { return null } })() : channels
  return !!c && typeof c === 'object' && (c as { digest?: unknown }).digest === 'daily'
}
