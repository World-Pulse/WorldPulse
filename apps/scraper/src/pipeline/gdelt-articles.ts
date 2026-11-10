/**
 * GDELT's list of the articles it read (plan 0s3, Oct 22, 2026): every 15
 * minutes GDELT publishes, free, a file of the news articles its crawlers
 * read in those 15 minutes (the Global Knowledge Graph, "GKG"), each with its
 * address, its website and its page title. On Oct 22, 2026 the English file
 * held about 1,700 articles every 15 minutes, 7 MB compressed. GDELT's search
 * API refused the second-outlet search at one request every 6 seconds and
 * told heavy users to use its files instead: these are those files.
 *
 * Only what the second outlet needs is kept: the address, the title, the
 * website and when GDELT read it. Nothing is stored; the files are read as
 * they come.
 */

import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { hostOf } from './signal-columns'
import { cleanTitle, withoutOutletName } from './text'

/**
 * GDELT's files are read from its storage bucket's own address (Oct 23).
 * GDELT's web address (data.gdeltproject.org) is the same Google Cloud
 * Storage bucket behind Google's edge cache, which keeps a "not found" for an
 * hour (public, max-age 3600) when anyone anywhere asks for a file a moment
 * before GDELT uploads it, and ignores the query string and no-cache headers:
 * at 03:22 UTC on Oct 23 the server still got "not found" for the 03:15 file,
 * up since 03:03, while the bucket's address answered it fresh each time.
 */
export const GDELT_BUCKET = 'https://storage.googleapis.com/data.gdeltproject.org/gdeltv2'
export const LASTUPDATE_URL = `${GDELT_BUCKET}/lastupdate.txt`
export const FILE_URL = (stamp: string) => `${GDELT_BUCKET}/${stamp}.gkg.csv.zip`
/**
 * GDELT's translated list (Nov 10, 2026): the articles it read in 65 other languages and machine-translated, each
 * file about a quarter of an hour behind the English one ("Translingual"). Its page titles are the articles' own, in
 * their language, and the TranslationInfo field (25) names the language ("srclc:fra;eng:GT-FRA 1.0"). The 17:00 UTC
 * file of Nov 10 held 2,938 articles, 167 of them in French, 302 in German, 431 in Spanish and 148 in Portuguese,
 * 11.5 MB compressed.
 */
export const LASTUPDATE_TRANSLATION_URL = `${GDELT_BUCKET}/lastupdate-translation.txt`
export const TRANSLATION_FILE_URL = (stamp: string) => `${GDELT_BUCKET}/${stamp}.translation.gkg.csv.zip`
/**
 * The translated list's languages that are read, by GDELT's code: French and German (Burundi, Comoros, Liechtenstein;
 * Nov 10, 2026, 1:37 PM), Spanish and Portuguese (Latin America, Equatorial Guinea, Lusophone Africa, Timor-Leste; that
 * afternoon), Russian and Arabic (Kyrgyzstan, Syria, Bahrain and the Gulf; that evening: 244 and 84 articles of the
 * 17:00 UTC file)
 */
export const TRANSLATED_LANGUAGES: Readonly<Record<string, string>> = { fra: 'fr', deu: 'de', spa: 'es', por: 'pt', rus: 'ru', ara: 'ar' }
/**
 * A fresh address for each request (Oct 22): GDELT lists a file the moment it
 * uploads it (10 to 15 minutes before the time in its name), and a request
 * that came a moment too early got a "not found" that Google's cache then kept
 * answering for up to an hour (public, max-age 3600). The edge cache turned
 * out to ignore the query (Oct 23: hence GDELT_BUCKET); it stays as a harmless
 * extra. GDELT ignores the query too.
 */
export const fresh = (url: string, now = Date.now()) => `${url}?t=${now}`
const UA = 'WorldPulse/0.1 (open-source; https://world-pulse.io)'
const inflateRawAsync = promisify(zlib.inflateRaw)

export interface GdeltArticle {
  url: string
  title: string
  /** The website, one owner's sister sites as one (siteOf) */
  site: string
  /** When GDELT read it */
  at: Date
  /** Its language, for an article of the translated list ('fr', 'de', 'es', 'pt'); none for the English list's */
  lang?: string
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** The newest article file's time (20261022180000) from lastupdate.txt, or null */
export function newestStamp(lastupdate: string): string | null {
  const m = /\/(\d{14})\.gkg\.csv\.zip\b/.exec(lastupdate)
  return m ? m[1]! : null
}

/** The newest file of the translated list (20261110170000) from lastupdate-translation.txt, or null */
export function newestTranslationStamp(lastupdate: string): string | null {
  const m = /\/(\d{14})\.translation\.gkg\.csv\.zip\b/.exec(lastupdate)
  return m ? m[1]! : null
}

/** A file's time as a date (UTC) */
export function stampDate(stamp: string): Date {
  return new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14)))
}

/** The stamp of a time, rounded down to GDELT's 15 minutes */
export function stampOf(d: Date): string {
  const t = new Date(Math.floor(d.getTime() / 900_000) * 900_000)
  return t.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/**
 * The files to read after `last` up to `newest`, oldest first, at most `max`
 * (the newest ones when more are missing). With no `last`, the newest `max`.
 */
export function filesToRead(newest: string, last: string | null, max: number): string[] {
  const end = stampDate(newest).getTime()
  const start = last ? stampDate(last).getTime() + 900_000 : end - (max - 1) * 900_000
  const out: string[] = []
  for (let t = Math.max(start, end - (max - 1) * 900_000); t <= end; t += 900_000) out.push(stampOf(new Date(t)))
  return out
}

/** The one file inside a GDELT zip */
export async function unzipFirst(buf: Buffer): Promise<Buffer> {
  const at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  if (at === -1) throw new Error('GDELT articles: not a zip file')
  const h = buf.subarray(at)
  const method = h.readUInt16LE(8)
  const size = h.readUInt32LE(18)
  const start = at + 30 + h.readUInt16LE(26) + h.readUInt16LE(28)
  const data = size > 0 ? buf.subarray(start, start + size) : buf.subarray(start)
  if (method === 0) return data
  if (method === 8) return inflateRawAsync(data) as Promise<Buffer>
  throw new Error(`GDELT articles: zip method ${method}`)
}

// ─── Articles ────────────────────────────────────────────────────────────────

/** Second-level names under a country's domain: news.bbc.co.uk is the site bbc.co.uk */
const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gen', 'go', 'gob', 'gov', 'info', 'mil', 'ne', 'net', 'news', 'nic', 'or', 'org', 'web'])

/** The website a host belongs to: one owner's sister sites are one (en.protothema.gr, www.protothema.gr) */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const tld = labels[labels.length - 1]!
  const sld = labels[labels.length - 2]!
  return labels.slice(tld.length === 2 && SECOND_LEVEL.has(sld) ? -3 : -2).join('.')
}

/** A page title as a headline: codes decoded, no outlet name at the end, no spaces before punctuation */
export function articleTitle(title: unknown, url: string): string {
  if (typeof title !== 'string') return ''
  const tidy = cleanTitle(title).replace(/\s+([,.;:!?%)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+'\s*s\b/g, "'s")
  return withoutOutletName(tidy, url)
}

/** GDELT's YYYYMMDDHHMMSS as a date, or null */
function gdeltDate(value: string | undefined): Date | null {
  if (!value || !/^\d{14}$/.test(value)) return null
  const d = stampDate(value)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Big News Network's hundred-odd websites (europesun.com, russiaherald.com,
 * indiagazette.com, kenyastar.com …) republish agency and press-release copy
 * at /news/<9-digit id>/<slug>: 1,540 of 31,723 articles in 5 hours on Oct 22,
 * on 98 websites. Never another newsroom's report.
 */
export const REPUBLISHED_URL = /^https?:\/\/[^/]+\/news\/\d{9}\//i

/**
 * A string's own copy (Oct 30, 2026, LR10). A piece cut from a big text (by
 * split, trim, a regex match, or a replace that changed nothing) can be kept
 * by V8 as a pointer into that text, which then lives as long as the piece
 * does. A GKG file's text is tens of MB, and the second outlet keeps 8 hours
 * of its articles (ArticleWindow): their addresses and titles kept the text of
 * every file read in those hours, and the scraper's memory grew about 220 MB
 * an hour until its 1.4 GB ceiling restarted it. Copied through a Buffer, a
 * piece is a short string of its own.
 */
export function ownCopy(s: string): string {
  return Buffer.from(s, 'utf8').toString('utf8')
}

/**
 * The articles of one GKG file: web pages (collection 1) with a title. A
 * line's fields (GKG 2.1, tab-separated): 1 DATE, 2 SourceCollectionIdentifier,
 * 3 SourceCommonName, 4 DocumentIdentifier (the address), 26 V2EXTRASXML
 * (<PAGE_TITLE>…</PAGE_TITLE>). The strings kept are copies (ownCopy), so the
 * file's text is freed once it has been read. With `languages` (the translated
 * list), only the articles in those languages, by field 25's "srclc:", each
 * with its language.
 */
export function readArticles(text: string, languages?: Readonly<Record<string, string>>): GdeltArticle[] {
  const out: GdeltArticle[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    if (!line) continue
    const f = line.split('\t')
    if (f.length < 27 || f[2] !== '1') continue
    const url = (f[4] ?? '').trim()
    if (!/^https?:\/\//i.test(url) || REPUBLISHED_URL.test(url) || seen.has(url)) continue
    const lang = languages ? languages[/\bsrclc:([a-z]{3})\b/.exec(f[25] ?? '')?.[1] ?? ''] : undefined
    if (languages && !lang) continue
    const m = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/.exec(f[26] ?? '')
    const title = m ? articleTitle(m[1], url) : ''
    const at = gdeltDate(f[1])
    const site = siteOf(hostOf(url))
    if (!title || !at || !site) continue
    seen.add(url)
    out.push({ url: ownCopy(url), title: ownCopy(title), site: ownCopy(site), at, ...(lang ? { lang } : {}) })
  }
  return out
}

// ─── The network ─────────────────────────────────────────────────────────────

export async function fetchNewestStamp(): Promise<string | null> {
  const res = await fetch(fresh(LASTUPDATE_URL), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) { void res.body?.cancel().catch(() => {}); throw new Error(`GDELT articles: HTTP ${res.status} for lastupdate.txt`) }
  return newestStamp(await res.text())
}

/** The translated list's newest file (lastupdate-translation.txt) */
export async function fetchNewestTranslationStamp(): Promise<string | null> {
  const res = await fetch(fresh(LASTUPDATE_TRANSLATION_URL), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) { void res.body?.cancel().catch(() => {}); throw new Error(`GDELT articles: HTTP ${res.status} for lastupdate-translation.txt`) }
  return newestTranslationStamp(await res.text())
}

/** One file's text; null when GDELT doesn't have it (a file it skipped) */
export async function fetchFileText(stamp: string, url = FILE_URL(stamp)): Promise<string | null> {
  const res = await fetch(fresh(url), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90_000) })
  // An answer's body not read is let go at once, not left to the garbage collector
  if (res.status === 404) { void res.body?.cancel().catch(() => {}); return null }
  if (!res.ok) { void res.body?.cancel().catch(() => {}); throw new Error(`GDELT articles: HTTP ${res.status} for ${stamp}`) }
  return (await unzipFirst(Buffer.from(await res.arrayBuffer()))).toString('utf8')
}

/**
 * One file's articles; null when GDELT doesn't have it (a file it skipped).
 * `onText` gets the whole file too (the pulse counts, gkg-pulse.ts).
 */
export async function fetchArticles(stamp: string, onText?: (stamp: string, text: string) => Promise<unknown>): Promise<GdeltArticle[] | null> {
  const text = await fetchFileText(stamp)
  if (text === null) return null
  if (onText) await onText(stamp, text).catch(() => null)
  return readArticles(text)
}

/** One file of the translated list: its articles in TRANSLATED_LANGUAGES; null when GDELT doesn't have it */
export async function fetchTranslatedArticles(stamp: string): Promise<GdeltArticle[] | null> {
  const text = await fetchFileText(stamp, TRANSLATION_FILE_URL(stamp))
  return text === null ? null : readArticles(text, TRANSLATED_LANGUAGES)
}
