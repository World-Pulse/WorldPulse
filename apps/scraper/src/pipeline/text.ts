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
