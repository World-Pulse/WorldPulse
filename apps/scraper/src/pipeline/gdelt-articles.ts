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

export const LASTUPDATE_URL = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt'
const FILE_URL = (stamp: string) => `https://data.gdeltproject.org/gdeltv2/${stamp}.gkg.csv.zip`
const UA = 'WorldPulse/0.1 (open-source; https://world-pulse.io)'
const inflateRawAsync = promisify(zlib.inflateRaw)

export interface GdeltArticle {
  url: string
  title: string
  /** The website, one owner's sister sites as one (siteOf) */
  site: string
  /** When GDELT read it */
  at: Date
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** The newest article file's time (20261022180000) from lastupdate.txt, or null */
export function newestStamp(lastupdate: string): string | null {
  const m = /\/(\d{14})\.gkg\.csv\.zip\b/.exec(lastupdate)
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
 * The articles of one GKG file: web pages (collection 1) with a title. A
 * line's fields (GKG 2.1, tab-separated): 1 DATE, 2 SourceCollectionIdentifier,
 * 3 SourceCommonName, 4 DocumentIdentifier (the address), 26 V2EXTRASXML
 * (<PAGE_TITLE>…</PAGE_TITLE>).
 */
export function readArticles(text: string): GdeltArticle[] {
  const out: GdeltArticle[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    if (!line) continue
    const f = line.split('\t')
    if (f.length < 27 || f[2] !== '1') continue
    const url = (f[4] ?? '').trim()
    if (!/^https?:\/\//i.test(url) || REPUBLISHED_URL.test(url) || seen.has(url)) continue
    const m = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/.exec(f[26] ?? '')
    const title = m ? articleTitle(m[1], url) : ''
    const at = gdeltDate(f[1])
    const site = siteOf(hostOf(url))
    if (!title || !at || !site) continue
    seen.add(url)
    out.push({ url, title, site, at })
  }
  return out
}

// ─── The network ─────────────────────────────────────────────────────────────

export async function fetchNewestStamp(): Promise<string | null> {
  const res = await fetch(LASTUPDATE_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`GDELT articles: HTTP ${res.status} for lastupdate.txt`)
  return newestStamp(await res.text())
}

/** One file's articles; null when GDELT doesn't have it (a file it skipped) */
export async function fetchArticles(stamp: string): Promise<GdeltArticle[] | null> {
  const res = await fetch(FILE_URL(stamp), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GDELT articles: HTTP ${res.status} for ${stamp}`)
  const text = (await unzipFirst(Buffer.from(await res.arrayBuffer()))).toString('utf8')
  return readArticles(text)
}
