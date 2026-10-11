/**
 * Clean text from feeds before it becomes a signal. Feeds send HTML codes
 * ("&#x27;", "&#8211;", "&amp;") in titles and summaries, and some send
 * "&amp;" inside links; on Oct 11, 2026 about 5% of the day's headlines
 * showed codes ("Goebbels isn&#x27;t applauding…", "Who Are You, Naim
 * Qassem? &#8211; Analysis") and GDACS links didn't open.
 */

/** HTML codes as characters. Angle brackets stay encoded, so decoded text can never become markup. */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", nbsp: ' ',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…',
  }
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex, dec, name) => {
    const code = hex ? parseInt(hex, 16) : dec ? parseInt(dec, 10) : NaN
    if (!Number.isNaN(code)) {
      return code > 0 && code <= 0x10ffff && code !== 60 && code !== 62 ? String.fromCodePoint(code) : whole
    }
    return named[String(name).toLowerCase()] ?? whole
  })
}

/** A link with "&amp;" written out as "&" (GDACS report links didn't open) */
export function cleanUrl(url: string): string {
  return url.replace(/&amp;/gi, '&')
}

/** Text that still has HTML codes worth decoding (for the repair) */
export const ENCODED_TEXT_RE = /&(?:#x[0-9a-f]+|#\d+|amp|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/i
