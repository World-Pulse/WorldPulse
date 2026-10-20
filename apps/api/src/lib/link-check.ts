/**
 * "Paste a link, get the count", version 1 (Devon, Oct 20, 2026: "ok to start
 * with 1"): which WorldPulse story a news article belongs to, so a reader can
 * see how many outlets (websites) reported it and which ones. GET
 * /api/v1/stories/by-link answers it; world-pulse.io/check and the MCP
 * server's check_link tool ask it.
 *
 * Version 1 only looks among the articles WorldPulse has already collected.
 * It never fetches the link, so a pasted address can't make the server visit
 * anything. Two places are looked in:
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
import { longQuery } from './long-query'

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
