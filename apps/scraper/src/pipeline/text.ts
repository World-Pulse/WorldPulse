/**
 * Clean text from feeds before it becomes a signal. Feeds send HTML codes
 * ("&#x27;", "&#8211;", "&amp;") in titles and summaries, and some send
 * "&amp;" inside links; on Oct 11, 2026 about 5% of the day's headlines
 * showed codes ("Goebbels isn&#x27;t applauding…", "Who Are You, Naim
 * Qassem? &#8211; Analysis") and GDACS links didn't open.
 */

const NAMED_CODES: Record<string, number> = {
  amp: 38, quot: 34, apos: 39, nbsp: 32, gt: 62, lt: 60,
  rsquo: 0x2019, lsquo: 0x2018, rdquo: 0x201d, ldquo: 0x201c, ndash: 0x2013, mdash: 0x2014, hellip: 0x2026,
}

/**
 * HTML codes as characters. ">" is decoded ("MMI&gt;=VII" in GDACS titles):
 * on its own it can't start markup. "<" stays encoded when a letter, "/", "!"
 * or "?" follows it, so decoded text can never become a tag.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole: string, hex: string | undefined, dec: string | undefined, name: string | undefined, offset: number, full: string) => {
    const code = hex ? parseInt(hex, 16) : dec ? parseInt(dec, 10) : NAMED_CODES[String(name).toLowerCase()] ?? NaN
    if (Number.isNaN(code) || code <= 0 || code > 0x10ffff) return whole
    if (code === 60 && /^[a-z/!?]/i.test(full.slice(offset + whole.length))) return whole
    return String.fromCodePoint(code)
  })
}

/**
 * Text without HTML tags, written out or still encoded ("Osaka <i>danjiri</i>
 * float festival" → "Osaka danjiri float festival"); a title showed the tags
 * on Oct 11, 2026.
 */
export function stripTags(text: string): string {
  return text.replace(/(?:<|&lt;)\/?[a-z][^<>]*?(?:>|&gt;)/gi, '')
}

/** A headline as it should read: codes decoded, tags gone */
export function cleanTitle(title: string): string {
  return stripTags(decodeEntities(title)).replace(/\s{2,}/g, ' ').trim()
}

/** A link with "&amp;" written out as "&" (GDACS report links didn't open) */
export function cleanUrl(url: string): string {
  return url.replace(/&amp;/gi, '&')
}

/** Text that still has HTML codes worth decoding, or tags (for the repair) */
export const ENCODED_TEXT_RE = /&(?:#x[0-9a-f]+|#\d+|amp|quot|apos|nbsp|gt|lt|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);|<\/?[a-z][^<>]*>/i

/**
 * Feed footers that aren't part of the story (Oct 11, 2026: 11 of the 100
 * newest summaries): WordPress's "The post <title> appeared first on <site>.",
 * "Read More: <link>", a trailing "Continue reading" or "Read more", and
 * "[…]" (shown as "…").
 */
const FEED_FOOTERS: Array<[RegExp, string]> = [
  [/\s*\bThe post\s.{1,400}?\sappeared first on\s[^.\n]{1,120}\.?/gi, ''],
  [/\s*\bRead more\s*:\s*https?:\/\/\S+/gi, ''],
  [/\s*\b(?:Continue reading|Read more)(?:\s*(?:\.\.\.|…|»|→))?\s*$/i, ''],
  [/\s*\[(?:…|\.\.\.|&hellip;|&#8230;)\]/g, '…'],
]

/** A feed's description without its footers (see FEED_FOOTERS) */
export function cleanSummary(text: string): string {
  let out = text
  for (const [re, by] of FEED_FOOTERS) out = out.replace(re, by)
  return out.replace(/\s{2,}/g, ' ').trim()
}

/** Text with a feed footer worth removing (for the repair) */
export const FEED_FOOTER_SQL = '(appeared first on|read more\\s*:\\s*https?://)'

/**
 * The note the RSS reader added to every summary until Oct 11, 2026 —
 * "Source: Middle East Eye (reliability: 74%, bias: center-left)." and, for
 * state-run outlets, "⚠️ This outlet is state-controlled and may reflect
 * official government positions." It was in 277 of the 500 newest summaries
 * (and all that 238 of them said besides the headline). It read as the
 * story's reliability ("76%" beside a 100% score) and went into the AI
 * summaries' input; the outlet and its state-media tag are on the signal.
 */
const OUTLET_NOTES: RegExp[] = [
  /\s*\bSource: [^\n]{1,160}? \(reliability: \d{1,3}%, bias: [\w -]{1,40}\)\.?/g,
  /\s*⚠️?\s*This outlet is state-controlled and may reflect official government positions\.?/g,
]

/** Summaries that still carry the note (a Postgres ~ pattern, for the repair) */
export const OUTLET_NOTE_SQL = 'Source: .{1,160} \\(reliability: [0-9]{1,3}%, bias: '

/** Text to compare with a headline: lower case, single spaces, no punctuation or quotes at either end */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’«»([-]+/u, '')
    .replace(/[\s"'“”‘’«»)\].,:;!?…-]+$/u, '')
}

/** Whether a summary says nothing but the headline ("Title." under "Title") */
export function repeatsTitle(summary: string, title: string): boolean {
  const s = comparable(summary)
  return s === '' || s === comparable(title)
}

/**
 * A summary as it should be stored: without the outlet note and feed footers,
 * or null when nothing but the headline is left.
 */
export function summaryWithoutNotes(summary: string | null | undefined, title: string): string | null {
  if (typeof summary !== 'string') return null
  let out = summary
  for (const re of OUTLET_NOTES) out = out.replace(re, '')
  out = cleanSummary(out)
  return repeatsTitle(out, title) ? null : out
}
