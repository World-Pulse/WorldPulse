/**
 * A signal's text as a reader should see it.
 *
 * Until Oct 11, 2026 the RSS reader ended every summary with a note about the
 * outlet — "Source: Investing.com News (reliability: 76%, bias: center)." and,
 * for state-run outlets, "⚠️ This outlet is state-controlled and may reflect
 * official government positions." In the 500 newest signals 277 summaries had
 * it, and for 238 it was all they said besides the headline. It read as the
 * story's reliability (76% beside a 100% score on the same page). New signals
 * are stored without it (the scraper's text.ts, plus a 3-day repair); older
 * ones are cleaned here.
 */

const OUTLET_NOTES: RegExp[] = [
  /\s*\bSource: [^\n]{1,160}? \(reliability: \d{1,3}%, bias: [\w -]{1,40}\)\.?/g,
  /\s*⚠️?\s*This outlet is state-controlled and may reflect official government positions\.?/g,
]

/**
 * HTML a feed sent encoded ("&lt;p>Get our &lt;a href=…"), shown as codes in
 * 119 of 3,211 summaries on Oct 11, 2026; the scraper stores plain text since
 * (text.ts feedText, plus a 3-day repair). A tag cut off at the end too.
 */
const TAG = /(?:<|&lt;)\/?[a-z][^<>]*?(?:>|&gt;)/gi
const CUT_TAG = /(?:<|&lt;)\/?[a-z][^<>]*$/i

/** Text to compare with a headline: lower case, single spaces, no punctuation or quotes at either end */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’«»([-]+/u, '')
    .replace(/[\s"'“”‘’«»)\].,:;!?…-]+$/u, '')
}

/**
 * The summary to show under a headline: without the outlet note, and empty
 * when all it says is the headline again ("Title." under "Title").
 */
export function displaySummary(summary: string | null | undefined, title: string | null | undefined): string {
  if (typeof summary !== 'string') return ''
  let text = summary
  for (const re of OUTLET_NOTES) text = text.replace(re, '')
  text = text.replace(TAG, ' ').replace(CUT_TAG, '').replace(/\s+/g, ' ').trim()
  const plain = comparable(text)
  if (plain === '' || (typeof title === 'string' && plain === comparable(title))) return ''
  return text
}

/**
 * The website of a signal's first link ("theguardian.com"), or "" without
 * one: the outlet's name where a signal has no source record (news feeds and
 * GDELT, Oct 11, 2026: their cards didn't say who reported them).
 */
export function outletSite(urls: unknown): string {
  const first = Array.isArray(urls) ? urls.find((u): u is string => typeof u === 'string' && u.length > 0) : undefined
  if (!first) return ''
  try { return new URL(first).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Whether a signal comes from a state-run outlet (the scraper tags it 'state-media') */
export function isStateMedia(tags: unknown): boolean {
  return Array.isArray(tags) && tags.includes('state-media')
}

/** What the state-media badge says when you point at it */
export const STATE_MEDIA_NOTE = 'A state-run outlet: it may reflect official government positions.'
