/**
 * Fact-checks beside verified stories (Nov 11, 2026; Devon, Nov 10: "Set this up, what is the process").
 *
 * Fact-checkers publish their checks in feeds. Three are read every 30 minutes: PolitiFact's rulings,
 * FactCheck.org's articles and Full Fact's checks. Each check's headline, date and link are kept for 60
 * days, with the claim it checked and the checker's own rating where the feed gives them (PolitiFact
 * words the claim and gives its Truth-O-Meter rating), and the check's fingerprint (lib/fingerprint.ts).
 * They are kept in Redis (factchecks:items), and the API finds the stories a check is about by meaning and
 * by the words they share (apps/api/src/lib/fact-checks.ts, GET /api/v1/stories/:id/fact-checks).
 *
 * A check is never a report: it is not about the event itself, it never counts as an outlet that carried
 * a story, and it is never saved as a signal. WorldPulse never rules on a claim either. A story page shows
 * the checker's own headline, claim and rating, credited and linked to the check.
 *
 * More checkers come with Google's index of fact-checks (its Fact Check Tools API, which needs a key).
 */

import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import { logger as rootLogger } from '../lib/logger'
import { decodeEntities, stripTags } from '../pipeline/text'
import { FINGERPRINT_MODEL, fingerprintWith, loadFingerprintModel, reportText } from '../lib/fingerprint'

const log = rootLogger.child({ module: 'fact-checks' })

export const ITEMS_KEY = 'factchecks:items'
const POLL_INTERVAL_MS = 30 * 60_000
const KEEP_DAYS = 60
const KEEP_MAX = 2_000
/** A claim or summary is cut to this many characters */
const TEXT_MAX = 300
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io; fact-checks shown credited, with links)'

export interface FactChecker {
  id: string
  name: string
  /** The checker's site: its checks' links must be on it */
  site: string
  feedUrl: string
  language: string
  country: string
  /** What an item's description is: the claim the checker checked (PolitiFact) or its own summary */
  description: 'claim' | 'summary'
  /** Whether the feed carries the checker's rating (PolitiFact's Truth-O-Meter, as the alt text of its picture) */
  ratings?: boolean
}

export const FACT_CHECKERS: FactChecker[] = [
  {
    id: 'politifact', name: 'PolitiFact', site: 'https://www.politifact.com', feedUrl: 'https://www.politifact.com/rss/factchecks/',
    language: 'en', country: 'US', description: 'claim', ratings: true,
  },
  {
    id: 'factcheck-org', name: 'FactCheck.org', site: 'https://www.factcheck.org', feedUrl: 'https://www.factcheck.org/feed/',
    language: 'en', country: 'US', description: 'summary',
  },
  {
    id: 'full-fact', name: 'Full Fact', site: 'https://fullfact.org', feedUrl: 'https://fullfact.org/feed/',
    language: 'en', country: 'GB', description: 'summary',
  },
]

export interface FactCheckItem {
  /** The first 16 hex characters of the check's link's SHA-1 */
  id: string
  /** The checker's id and name (FACT_CHECKERS) */
  checker: string
  name: string
  title: string
  url: string
  /** When the checker published it (ISO) */
  published: string
  /** The claim checked, in the checker's words (PolitiFact's), or null */
  claim: string | null
  /** The checker's own rating ("Mostly False", "Pants on Fire!"), or null where the feed gives none */
  rating: string | null
  /** The checker's own one-line summary, or null */
  summary: string | null
  language: string
  /** The fingerprint's model and the fingerprint (256 numbers as Float32, base64); null until the model is ready */
  model: string | null
  vec: string | null
}

export interface CheckerStatus {
  id: string
  name: string
  ok: boolean
  read_at: string
  /** Checks in the feed when it was last read */
  items: number
  error?: string
}

export interface FactChecksSnapshot {
  updated_at: string
  checkers: CheckerStatus[]
  items: FactCheckItem[]
}

/** The ratings PolitiFact's feed gives as its picture's alt text, and the Flip-O-Meter's */
const RATINGS = new Set(['true', 'mostly true', 'half true', 'mostly false', 'false', 'pants on fire', 'full flop', 'half flip', 'no flip'])
const ratingKey = (s: string): string => s.toLowerCase().replace(/[!.]+$/, '').replace(/[-\s]+/g, ' ').trim()

/** Text without tags or entities, on one line */
export function cleanText(s: string): string {
  return decodeEntities(stripTags(decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, '')))).replace(/\s+/g, ' ').trim()
}

/** A tag's content in an item block ('' when it isn't there) */
function tagContent(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  return m ? m[1]! : ''
}

/** The checker's rating in an item's HTML: the first picture whose alt text is a rating, as written */
export function ratingOf(html: string): string | null {
  // (HTML in CDATA, or escaped: decodeEntities leaves a "&lt;" that would start a tag as it is)
  const text = decodeEntities(html.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"'))
  for (const m of text.matchAll(/<img\b[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const alt = (m[1] ?? m[2] ?? '').trim()
    if (alt && RATINGS.has(ratingKey(alt))) return alt
  }
  return null
}

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

export const itemId = (url: string): string => createHash('sha1').update(url).digest('hex').slice(0, 16)

const cut = (s: string): string | null => {
  if (!s) return null
  if (s.length <= TEXT_MAX) return s
  const head = s.slice(0, TEXT_MAX)
  const space = head.lastIndexOf(' ')
  return `${(space > TEXT_MAX * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, '')}…`
}

/** A checker's feed read into checks (no fingerprints yet): items with a title, a date and a link on the checker's site */
export function readCheckerFeed(xml: string, checker: FactChecker, now = Date.now()): FactCheckItem[] {
  const site = hostOf(checker.site)
  const out: FactCheckItem[] = []
  for (const m of xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi)) {
    const block = m[2]!
    const title = cleanText(tagContent(block, 'title'))
    let url = cleanText(tagContent(block, 'link'))
    if (!url) url = /<link[^>]+href="([^"]+)"/i.exec(block)?.[1] ?? ''
    const date = cleanText(tagContent(block, 'pubDate') || tagContent(block, 'published') || tagContent(block, 'updated'))
    const at = Date.parse(date)
    if (!title || !url || Number.isNaN(at)) continue
    if (!/^https:\/\//i.test(url) || hostOf(url) !== site) continue
    // A date ahead of now is taken as now (a clock a little ahead)
    const published = new Date(Math.min(at, now)).toISOString()
    const description = cut(cleanText(tagContent(block, 'description') || tagContent(block, 'summary')))
    out.push({
      id: itemId(url), checker: checker.id, name: checker.name, title, url, published,
      claim: checker.description === 'claim' ? description : null,
      rating: checker.ratings ? ratingOf(tagContent(block, 'content:encoded')) : null,
      summary: checker.description === 'summary' ? description : null,
      language: checker.language, model: null, vec: null,
    })
  }
  return out
}

/** A fingerprint as base64 (256 Float32 numbers) and back */
export function encodeVec(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
}

/** The text a check is fingerprinted from: its headline and the claim or summary, as a report's headline and summary */
export const checkText = (item: Pick<FactCheckItem, 'title' | 'claim' | 'summary'>): string => reportText(item.title, item.claim ?? item.summary)

/**
 * New checks merged into the kept ones: one per link (a kept check keeps its fingerprint unless its text changed),
 * newest first, 60 days, at most 2,000
 */
export function mergeChecks(kept: readonly FactCheckItem[], fresh: readonly FactCheckItem[], now = Date.now()): FactCheckItem[] {
  const byId = new Map<string, FactCheckItem>()
  for (const item of kept) byId.set(item.id, item)
  for (const item of fresh) {
    const old = byId.get(item.id)
    const same = old && checkText(old) === checkText(item)
    byId.set(item.id, same && old.vec ? { ...item, model: old.model, vec: old.vec } : item)
  }
  return [...byId.values()]
    .filter(item => now - Date.parse(item.published) <= KEEP_DAYS * 86_400_000)
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, KEEP_MAX)
}

/**
 * Fingerprints for the checks that have none (or one from another model), made with `embed` (lib/fingerprint.ts's
 * fingerprintWith and the loaded model); false when the model isn't ready (null), and they are made next time
 */
export function addFingerprints(items: FactCheckItem[], embed: ((text: string) => Float32Array | null) | null): boolean {
  const todo = items.filter(item => !item.vec || item.model !== FINGERPRINT_MODEL)
  if (!todo.length) return true
  if (!embed) return false
  for (const item of todo) {
    const v = embed(checkText(item))
    if (!v) continue   // no word of it is known
    item.vec = encodeVec(v)
    item.model = FINGERPRINT_MODEL
  }
  return true
}

async function readChecker(checker: FactChecker): Promise<{ items: FactCheckItem[]; status: CheckerStatus }> {
  const read_at = new Date().toISOString()
  try {
    const res = await fetch(checker.feedUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return { items: [], status: { id: checker.id, name: checker.name, ok: false, read_at, items: 0, error: `HTTP ${res.status}` } }
    const items = readCheckerFeed(await res.text(), checker)
    return { items, status: { id: checker.id, name: checker.name, ok: items.length > 0, read_at, items: items.length, ...(items.length ? {} : { error: 'no checks in the feed' }) } }
  } catch (err) {
    return { items: [], status: { id: checker.id, name: checker.name, ok: false, read_at, items: 0, error: String((err as Error)?.message ?? err).slice(0, 120) } }
  }
}

export function startFactChecksPoller(redis: Redis): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      const fresh: FactCheckItem[] = []
      const checkers: CheckerStatus[] = []
      for (const checker of FACT_CHECKERS) {
        const { items, status } = await readChecker(checker)
        fresh.push(...items)
        checkers.push(status)
        if (!status.ok) log.warn({ checker: checker.id, error: status.error }, 'Fact-checks: feed not read')
      }
      const raw = await redis.get(ITEMS_KEY)
      let kept: FactCheckItem[] = []
      try { kept = raw ? (JSON.parse(raw) as FactChecksSnapshot).items ?? [] : [] } catch { kept = [] }
      const items = mergeChecks(kept, fresh)
      const model = await loadFingerprintModel()
      const ready = addFingerprints(items, model ? text => fingerprintWith(model, text) : null)
      const snapshot: FactChecksSnapshot = { updated_at: new Date().toISOString(), checkers, items }
      await redis.set(ITEMS_KEY, JSON.stringify(snapshot))
      log.info({ fresh: fresh.length, kept: items.length, fingerprinted: items.filter(i => i.vec).length, model: ready }, 'Fact-checks read')
    } catch (err) {
      log.error({ err }, 'Fact-checks poll error')
    } finally {
      running = false
    }
  }

  // (after the fingerprint model has had time to load)
  const first = setTimeout(() => { void poll() }, 3 * 60_000)
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    log.info('Fact-checks poller stopped')
  }
}
