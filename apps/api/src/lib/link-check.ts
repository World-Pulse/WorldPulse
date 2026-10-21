/**
 * "Paste a link, get the count", version 1 (Devon, Oct 20, 2026: "ok to start
 * with 1"): which WorldPulse story a news article belongs to, so a reader can
 * see how many outlets (websites) reported it and which ones. GET
 * /api/v1/stories/by-link answers it; world-pulse.io/check and the MCP
 * server's check_link tool ask it.
 *
 * Version 1 only looks among the articles WorldPulse has already collected,
 * never fetching the link (version 2, below, opens a page it hasn't, with
 * safeguards). Two places are looked in:
 *   - the article claims the news readers keep for 4 days (Redis
 *     dedup:article:<key>, apps/scraper/src/pipeline/dedup.ts), keyed the way
 *     both readers key an article, so any spelling of one article's address
 *     finds it;
 *   - the reports of the last LINK_DAYS days, by their links (the address
 *     itself, its http/https and www forms, with or without a trailing slash
 *     or any query), under its own time limit.
 */

import { createHash } from 'node:crypto'
import { redis } from '../db/redis'
import { db } from '../db/postgres'
import { longQuery } from './long-query'
import { fetchPublicPage, mayOpen, pageFacts, PageRefused } from './safe-fetch'
import { searchByMeaning } from './fingerprint-search'
import { headlineWords, sameEvent, stem } from './story-list'

/** How far back the reports are searched by their links */
export const LINK_DAYS = 14
/** That search gives up after this long */
export const LINK_SECONDS = 3
/** A link longer than this is not an article's address */
export const MAX_LINK_LENGTH = 2_048

/**
 * Query parameters that only say how a reader got to the page (the same list
 * as apps/scraper/src/pipeline/dedup.ts): utm_ tags, BBC's at_ and ns_ tags,
 * ad-click ids, newsletter ids.
 */
const TRACKING_PARAM_RE = /^(?:utm_|at_|ns_|mc_|pk_|mtm_)|^(?:fbclid|gclid|dclid|msclkid|ref|referrer|ref_src|cmpid|ocid|xtor|smid|ito|guccounter|guce_referrer|guce_referrer_sig)$/i

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A pasted address, read as a web page's address; null when it isn't one */
export function readLink(raw: string): URL | null {
  const text = raw.trim().replace(/&amp;/gi, '&')
  if (!text || text.length > MAX_LINK_LENGTH) return null
  let url: URL
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname.includes('.')) return null
  return url
}

/**
 * An article's key, exactly as the news readers make it (articleKey in
 * apps/scraper/src/pipeline/dedup.ts): host without www., path without a
 * trailing slash, the query without tracking tags and in order; null for a
 * front page, which tells no article.
 */
export function articleKey(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!host) return null
  const path = url.pathname.replace(/\/+$/, '')
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAM_RE.test(name))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
  if (!path && params.length === 0) return null
  const query = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&')
  return createHash('sha256').update(`${host}${path}${query ? `?${query}` : ''}`).digest('hex').slice(0, 32)
}

/** The ways a report may have stored this article's address: exact addresses, and LIKE patterns for any query */
export function storedForms(url: URL): { exact: string[]; anyQuery: string[] } {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.replace(/\/+$/, '')
  const kept = [...url.searchParams.entries()].filter(([name]) => !TRACKING_PARAM_RE.test(name))
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : ''
  const like = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)
  const exact = new Set<string>()
  const anyQuery = new Set<string>()
  for (const scheme of ['https', 'http']) {
    for (const h of [host, `www.${host}`]) {
      for (const p of path ? [path, `${path}/`] : ['/']) {
        const base = `${scheme}://${h}${p}`
        exact.add(`${base}${query}`)
        exact.add(base)
        anyQuery.add(`${like(base)}?%`)
      }
    }
  }
  exact.add(url.toString())
  return { exact: [...exact], anyQuery: [...anyQuery] }
}

export type LinkLookup =
  | { status: 'found'; reportId: string; via: 'claim' | 'links' }
  /** One of the news readers is storing it right now */
  | { status: 'pending' }
  | { status: 'not_seen' }
  /** A front page, or no web address at all */
  | { status: 'not_an_article' }

/** Which report holds the article at `raw`, among the articles collected */
export async function findReport(raw: string): Promise<LinkLookup> {
  const url = readLink(raw)
  if (!url) return { status: 'not_an_article' }
  const key = articleKey(url)
  if (!key) return { status: 'not_an_article' }

  const held = await redis.get(`dedup:article:${key}`).catch(() => null)
  if (held && UUID_RE.test(held)) return { status: 'found', reportId: held, via: 'claim' }

  const { exact, anyQuery } = storedForms(url)
  try {
    const rows = await longQuery(LINK_SECONDS, trx => trx.raw(`
      SELECT s.id
        FROM signals s
       WHERE s.created_at > now() - make_interval(days => ?)
         AND s.status IN ('verified', 'pending')
         AND EXISTS (
               SELECT 1 FROM unnest(s.original_urls) AS link(url)
                WHERE link.url = ANY(?::text[]) OR link.url LIKE ANY(?::text[])
             )
       ORDER BY s.created_at ASC
       LIMIT 1
    `, [LINK_DAYS, exact, anyQuery])) as { rows?: Array<{ id: string }> }
    const id = rows.rows?.[0]?.id
    if (id) return { status: 'found', reportId: String(id), via: 'links' }
  } catch {
    // Too slow just now: say what the claims said
  }
  return held === 'pending' ? { status: 'pending' } : { status: 'not_seen' }
}

// ─── Version 2: links WorldPulse hasn't collected (plan G22; Devon, Oct 21,
// 2026: "Yes, with safeguards": public pages only, size and time limits, rate
// limits). The page is opened once, safely (lib/safe-fetch.ts), only to read
// its headline and canonical address; nothing of it is kept but those, for 6
// hours. Then: the canonical address among the collected articles, or the
// story whose reports say the same as the headline: close in meaning (the
// in-house fingerprints, lib/fingerprint-search.ts) and the same event by
// their words (story-list.ts sameEvent), with a name, place or number in
// common. Fingerprints alone aren't enough: on Oct 21 a pasted Vermont flood
// headline came closest to a Spanish one (0.61) and a red panda birth to a
// red panda's farewell (0.64), while a rewritten headline of the Abyei market
// strike scored 0.66 against its own story.

export const PAGE_KEEP_SECONDS = 6 * 3600
export const PAGE_FAILED_SECONDS = 2 * 3600
/** Pages opened: per client a minute, per website an hour, in all an hour */
export const CLIENT_FETCHES_A_MINUTE = 6
export const HOST_FETCHES_AN_HOUR = 30
export const FETCHES_AN_HOUR = 300
/** How far back a story is looked for by meaning, and how close a report must be to be read */
export const SIMILAR_DAYS = 7
export const SIMILAR_MIN_SCORE = 0.5

/** A headline without the site's name tacked on ("… | Reuters", "… - BBC News") */
export function headlineOnly(title: string, site: string | null, host: string): string {
  const t = title.replace(/\s+/g, ' ').trim()
  const parts = t.split(/\s+(?:\||-|–|—|::|·)\s+/)
  if (parts.length < 2) return t
  const raw = parts[parts.length - 1]!
  const last = raw.toLowerCase()
  const hostWord = host.toLowerCase().replace(/^www\./, '').split('.')[0] ?? ''
  // the site's name, its address's name, or a short name in capitals ("AP News"), not "what we know"
  const isSite = (site && last.includes(site.toLowerCase().slice(0, 12)))
    || (hostWord.length >= 3 && last.replace(/[^a-z0-9]/g, '').includes(hostWord))
    || (raw.length <= 24 && raw.split(/\s+/).every(w => /^[A-Z0-9&]/.test(w)))
  return isSite ? parts.slice(0, -1).join(' - ').trim() : t
}

/**
 * The words of a headline that name something particular: written with a
 * capital letter but not as its first word (Abyei, Trump, France), or
 * numbers of two digits or more. A headline in title case says nothing this
 * way, so all its words count.
 */
export function particularWords(title: string): Set<string> {
  const words = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[A-Za-z0-9]+/g) ?? []
  const caps = words.filter(w => /^[A-Z]/.test(w)).length
  const titleCase = words.length >= 4 && caps / words.length > 0.7
  const out = new Set<string>()
  words.forEach((w, i) => {
    if (/^\d{2,}$/.test(w) || ((titleCase || i > 0) && /^[A-Z]/.test(w))) out.add(stem(w.toLowerCase()))
  })
  return out
}

export interface StoryCandidate { id: string; title: string; score: number; createdAt?: string | null }

/** How far apart a page's publication and a report may be to tell one event */
export const SAME_EVENT_DAYS = 3

/** A date in an article's address (/2025/12/14/, /2025-12-14-, /20251214/), as an ISO day, else null */
export function dateInPath(url: string): string | null {
  let path: string
  try { path = new URL(url).pathname } catch { return null }
  const m = /(?:^|[/_-])(20\d{2})[/_-]?(0[1-9]|1[0-2])[/_-]?(0[1-9]|[12]\d|3[01])(?=[/_.-]|$)/.exec(path)
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  return Number.isFinite(Date.parse(`${iso}T12:00:00Z`)) ? iso : null
}

/**
 * The reports a page may tell the same event as, by time: within
 * SAME_EVENT_DAYS of when the page says it was published (or the date in its
 * address). Oct 21, 2026: a December 2025 article on a drone strike in
 * Abyei ("six Bangladesh Army soldiers") matched October 2026's Abyei
 * market strike by its words. Without a date, all of them.
 */
export function nearInTime(candidates: StoryCandidate[], publishedAt: string | null): StoryCandidate[] {
  const at = publishedAt ? Date.parse(publishedAt.length === 10 ? `${publishedAt}T12:00:00Z` : publishedAt) : NaN
  if (!Number.isFinite(at)) return candidates
  const span = SAME_EVENT_DAYS * 86_400_000 + (publishedAt!.length === 10 ? 86_400_000 : 0)
  return candidates.filter(c => {
    const t = c.createdAt ? Date.parse(c.createdAt) : NaN
    return Number.isFinite(t) && Math.abs(t - at) <= span
  })
}

/**
 * The report that tells the same event as a headline, among the closest in
 * meaning: the same event by sameEvent's words, with something particular in
 * common; the most words in common first, then the closest. null when none.
 */
export function bestMatch(headline: string, candidates: StoryCandidate[]): (StoryCandidate & { shared: number }) | null {
  const words = headlineWords(headline)
  const particular = particularWords(headline)
  let best: (StoryCandidate & { shared: number; ratio: number }) | null = null
  for (const c of candidates) {
    if (!c.title || !sameEvent({ title: headline, place: null }, { title: c.title, place: null })) continue
    const theirs = headlineWords(c.title)
    const theirParticular = particularWords(c.title)
    const shared = [...words].filter(w => theirs.has(w))
    if (!shared.some(w => particular.has(w) || theirParticular.has(w))) continue
    const ratio = shared.length / Math.max(1, Math.min(words.size, theirs.size))
    if (!best || ratio > best.ratio || (ratio === best.ratio && c.score > best.score)) best = { ...c, shared: shared.length, ratio }
  }
  if (!best) return null
  const { ratio: _ratio, ...rest } = best
  return rest
}

export type PageLookup =
  | { status: 'found'; reportId: string; via: 'canonical' | 'similar'; page: PageFactsKept; score?: number }
  | { status: 'not_seen'; page: PageFactsKept }
  /** The page couldn't be opened (not public, not a web page, no answer) or no headline was found */
  | { status: 'unreadable'; reason: string }
  /** Too many pages opened just now (this client, this website or all) */
  | { status: 'busy' }

export interface PageFactsKept { title: string; site: string | null; canonical: string | null; publishedAt?: string | null }

/** Count one more under a key for `seconds`; false when that passes `max` */
async function underLimit(key: string, max: number, seconds: number): Promise<boolean> {
  try {
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, seconds)
    return n <= max
  } catch {
    return false   // can't count: don't open pages
  }
}

/** Version 2: a link not among the collected articles, by its page's canonical address or headline */
export async function lookUpByPage(raw: string, client: string, deps: {
  fetchPage?: (url: URL) => Promise<{ url: string; html: string }>
  similar?: (q: string, from: Date) => Promise<StoryCandidate[]>
  now?: Date
} = {}): Promise<PageLookup> {
  const url = readLink(raw)
  const key = url ? articleKey(url) : null
  if (!url || !key) return { status: 'unreadable', reason: 'not_an_article' }
  if (!mayOpen(url)) return { status: 'unreadable', reason: 'not_public' }
  const now = deps.now ?? new Date()

  // v2: with the page's publication time (Oct 21, 2026)
  const cacheKey = `linkcheck:page:v2:${key}`
  let facts: PageFactsKept | { failed: string } | null = null
  try { facts = JSON.parse((await redis.get(cacheKey)) ?? 'null') } catch { facts = null }

  if (!facts) {
    const hour = now.toISOString().slice(0, 13)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!(await underLimit(`linkcheck:client:${client}:${now.toISOString().slice(0, 16)}`, CLIENT_FETCHES_A_MINUTE, 120))
      || !(await underLimit(`linkcheck:host:${host}:${hour}`, HOST_FETCHES_AN_HOUR, 7200))
      || !(await underLimit(`linkcheck:all:${hour}`, FETCHES_AN_HOUR, 7200))) return { status: 'busy' }
    try {
      const page = await (deps.fetchPage ?? fetchPublicPage)(url)
      const f = pageFacts(page.html, page.url)
      facts = f.title
        ? { title: headlineOnly(f.title, f.site, new URL(page.url).hostname), site: f.site, canonical: f.canonical, publishedAt: f.publishedAt ?? dateInPath(page.url) ?? dateInPath(url.toString()) }
        : { failed: 'no_headline' }
    } catch (err) {
      facts = { failed: err instanceof PageRefused ? err.reason : 'unreachable' }
    }
    await redis.setex(cacheKey, 'failed' in facts ? PAGE_FAILED_SECONDS : PAGE_KEEP_SECONDS, JSON.stringify(facts)).catch(() => {})
  }
  if ('failed' in facts) return { status: 'unreadable', reason: facts.failed }

  // the canonical address may be the one the outlet's feed gave
  if (facts.canonical && facts.canonical !== url.toString()) {
    const byCanonical = await findReport(facts.canonical).catch(() => null)
    if (byCanonical?.status === 'found') return { status: 'found', reportId: byCanonical.reportId, via: 'canonical', page: facts }
  }

  const candidates = await (deps.similar ?? similarTitles)(facts.title, new Date(now.getTime() - SIMILAR_DAYS * 86_400_000)).catch(() => [] as StoryCandidate[])
  const match = bestMatch(facts.title, nearInTime(candidates, facts.publishedAt ?? dateInPath(url.toString())))
  if (match) return { status: 'found', reportId: match.id, via: 'similar', page: facts, score: match.score }
  return { status: 'not_seen', page: facts }
}

/** Reports close in meaning to a headline since `from`, with their titles (collected stories only) */
async function similarTitles(q: string, from: Date): Promise<StoryCandidate[]> {
  const matches = await searchByMeaning(q, { limit: 12, minScore: SIMILAR_MIN_SCORE, from })
  if (!matches?.length) return []
  const rows = await db('signals').whereIn('id', matches.map(m => m.id)).whereIn('status', ['verified', 'pending'])
    .select('id', 'title', 'created_at') as Array<{ id: string; title: string | null; created_at: unknown }>
  const found = new Map(rows.map(r => [String(r.id), r]))
  return matches.filter(m => found.has(m.id)).map(m => {
    const r = found.get(m.id)!
    return { id: m.id, title: String(r.title ?? ''), score: m.score, createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : null }
  })
}
