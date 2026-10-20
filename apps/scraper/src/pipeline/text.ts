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

const BLOCK_TAG = /(?:<|&lt;)\/?(?:p|br|hr|li|ul|ol|div|h[1-6]|blockquote|table|tr|td|th|figure|figcaption|section|article|header|footer)\b[^<>]*?(?:>|&gt;)/gi
/** An XML declaration inside a description (Shafaq News starts every summary with one, Oct 20, 2026) */
const XML_DECL = /(?:<|&lt;)\?xml\b[^<>]*?\?(?:>|&gt;)/gi
const ANY_TAG = /(?:<|&lt;)\/?[a-z][^<>]*?(?:>|&gt;)/gi
/** A tag cut off where a description was clipped ('… &lt;div class="field') */
const CUT_TAG = /(?:<|&lt;)\/?[a-z][^<>]*$/i

/** Whether text has HTML tags, written out or encoded */
export const HTML_TAG_RE = /(?:<|&lt;)\/?[a-z][^<>]*?(?:>|&gt;)/i

/**
 * Feed HTML as plain text: tags gone, also when the feed sent its HTML
 * encoded ("&lt;p&gt;": 119 of 3,211 recent summaries showed the codes on
 * Oct 11, 2026, from Dawn, Middle East Eye, The Straits Times, The Guardian
 * and Al-Monitor), paragraphs and list items kept apart, codes decoded.
 */
export function feedText(html: string): string {
  const strip = (t: string) => t.replace(XML_DECL, ' ').replace(BLOCK_TAG, ' ').replace(ANY_TAG, '').replace(CUT_TAG, '')
  return strip(decodeEntities(strip(html))).replace(/\s+/g, ' ').trim()
}

/** Text cut to at most `max` characters at a word, ending in "…" when cut */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/u, '')}…`
}

/** A headline as it should read: codes decoded, tags gone */
export function cleanTitle(title: string): string {
  return stripTags(decodeEntities(title)).replace(/\s{2,}/g, ' ').trim()
}

/** A website's address as one word, without "www." ("https://www.livemint.com/x" → "livemintcom") */
function siteWord(url: string | null | undefined): string {
  try {
    return new URL(url ?? '').hostname.toLowerCase().replace(/^(?:www|m|amp|edition)\./, '').replace(/[^a-z0-9]/g, '')
  } catch {
    return ''
  }
}

/** Words too common to tie a headline's last part to a website by themselves */
const COMMON_SITE_WORDS = new Set([
  'news', 'times', 'daily', 'post', 'world', 'online', 'today', 'live', 'update', 'updates', 'report',
  'video', 'videos', 'photos', 'latest', 'first', 'media', 'press', 'journal', 'star', 'mail', 'express',
  'global', 'national', 'local', 'city', 'state', 'government', 'people', 'life', 'health', 'business',
  'sport', 'sports', 'tech', 'money', 'more', 'says', 'with', 'from', 'this', 'that', 'what', 'over',
])

/** The separator before an outlet's name in a page title: " - ", " – ", " — ", " | " */
export const OUTLET_SUFFIX_SQL = '\\s[-–—|]\\s[^-–—|]{2,60}$'

/**
 * A headline without the outlet's name its page title ends with ("… - The
 * Korea Times", "… | Mint"), when that name matches the article's website.
 * GDELT takes headlines from the article page's title, which usually carries
 * it (Oct 11, 2026: 169 of 2,600 recent stories). A last part that isn't the
 * outlet ("… — Treasury Secretary", "… - man arrested") stays.
 */
export function withoutOutletName(title: string, url: string | null | undefined): string {
  const site = siteWord(url)
  if (!site) return title
  const m = /^(.{20,}?)\s+[-–—|]\s+([^-–—|]{2,60})$/u.exec(title.trim())
  if (!m) return title
  const name = m[2]!.trim()
  if (name.split(/\s+/).length > 7) return title
  const whole = name.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '')
  const named = (whole.length >= 3 && site.includes(whole))
    || name.toLowerCase().split(/[^a-z0-9]+/).some(w => w.length >= 4 && !COMMON_SITE_WORDS.has(w) && site.includes(w))
  return named ? m[1]!.trim() : title
}

/** A link with "&amp;" written out as "&" (GDACS report links didn't open) */
export function cleanUrl(url: string): string {
  return url.replace(/&amp;/gi, '&')
}

/** Text that still has HTML codes worth decoding, or tags (for the repair) */
export const ENCODED_TEXT_RE = /&(?:#x[0-9a-f]+|#\d+|amp|quot|apos|nbsp|gt|lt|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);|<\/?[a-z][^<>]*>/i

/**
 * Feed footers and pitches that aren't part of the story (Oct 11, 2026: 11 of
 * the 100 newest summaries): WordPress's "The post <title> appeared first on
 * <site>.", "Read More: <link>", a trailing "Continue reading" or "Read more",
 * "[…]" (shown as "…"), The Guardian's "Get our breaking news email, free app
 * or daily news podcast", newsletter and subscription pitches, and Middle
 * East Eye's "Submitted by" left at the end; since Oct 20, 2026 a WordPress
 * membership plugin's "To access this post, you must purchase …" (Post-Courier).
 */
const FEED_FOOTERS: Array<[RegExp, string]> = [
  [/\s*\bThe post\s.{1,400}?\sappeared first on\s[^.\n]{1,120}\.?/gi, ''],
  [/\s*\bRead more\s*:\s*https?:\/\/\S+/gi, ''],
  [/\s*\b(?:Continue reading|Read more)(?:\s*(?:\.\.\.|…|»|→))?\s*$/i, ''],
  [/\s*\[(?:…|\.\.\.|&hellip;|&#8230;)\]/g, '…'],
  [/\s*\bGet our [^.]{0,100}?\b(?:emails?|newsletters?)\b[^.]{0,80}?\bpodcast\b\.?/gi, ''],
  [/\s*\bSubscribe (?:to [^.]{0,80}?\bnewsletter|now)\b[^.]*\.?/gi, ''],
  [/\s*\bSubmitted by\b[^.]{0,80}$/i, ''],
  // A WordPress membership plugin's paywall line (Post-Courier ends every summary with it, Oct 20, 2026)
  [/\s*\bTo access this post, you must purchase\b[^.]{0,600}\./gi, ''],
]

/** A feed's description without its footers (see FEED_FOOTERS) */
export function cleanSummary(text: string): string {
  let out = text
  for (const [re, by] of FEED_FOOTERS) out = out.replace(re, by)
  return out.replace(/\s{2,}/g, ' ').trim()
}

/** Text with a feed footer or HTML worth removing (for the repair; ~* is case-insensitive) */
export const FEED_FOOTER_SQL = '(appeared first on|read more\\s*:\\s*https?://|&lt;/?[a-z]|<[a-z/]|get our .{1,120}podcast|subscribe (to|now)|submitted by)'

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

/**
 * Whether a summary says more than its headline: not empty, not the headline
 * again, and not just its beginning (the word rules in classify.ts give the
 * headline's first 150 characters as the summary)
 */
export function saysMore(summary: string | null | undefined, title: string): summary is string {
  if (typeof summary !== 'string') return false
  const s = comparable(summary)
  if (s === '') return false
  const t = comparable(title)
  return s !== t && !t.startsWith(s)
}

/**
 * The older news reader's summary for a report (H-0024, Oct 20, 2026): the
 * classifier's when it says more than the headline (the word rules only
 * repeat it, which until now was stored, so 12 of the 100 newest reports
 * showed their headline twice), else the article's opening from its feed,
 * cleaned as the newer reader cleans it (sources/news-rss.ts), else none.
 */
export function articleSummary(classified: string | null | undefined, body: string | null | undefined, title: string): string | null {
  const ai = typeof classified === 'string' ? decodeEntities(classified).trim() : null
  if (saysMore(ai, title)) return ai
  if (typeof body !== 'string' || !body.trim()) return null
  const text = HTML_TAG_RE.test(body) ? feedText(body) : decodeEntities(body)
  const clean = summaryWithoutNotes(clipText(cleanSummary(text), 600), title)
  return saysMore(clean, title) ? clean : null
}

/**
 * A story post's text (the automated posts in Global Pulse): the headline,
 * and the summary only when it says more. 48 of the 50 newest read
 * "<headline>\n\n<headline>" (H-0024).
 */
export function storyPostText(title: string, summary: string | null | undefined): string {
  return (saysMore(summary, title) ? `${title}\n\n${summary}` : title).slice(0, 2000)
}
