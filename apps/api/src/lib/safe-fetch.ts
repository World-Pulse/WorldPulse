/**
 * Opening a web page a stranger pasted, safely (paste-a-link version 2, plan
 * G22; Devon, Oct 21, 2026: "Yes, with safeguards": public pages only, size
 * and time limits, rate limits).
 *
 * Only http and https on their usual ports, only addresses on the public
 * internet: every address a name resolves to is checked when the connection
 * is made (so a name can't point at the server's own network, or switch to
 * it between a check and the visit), and an address written as numbers is
 * checked before. At most 3 redirects, each checked the same way; 8 seconds
 * in all; web pages only (text/html), and no more than the first 512 KB.
 * Nothing is sent but a plain GET with WorldPulse's name; no cookies.
 */

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'

export const FETCH_TIMEOUT_MS = 8_000
export const MAX_BYTES = 512 * 1024
export const MAX_REDIRECTS = 3
export const LINK_CHECK_UA = 'WorldPulse-LinkCheck/1.0 (+https://world-pulse.io/check; reads one page a reader asked about)'

// ── Which addresses are public ───────────────────────────────────────────────

const BLOCKED = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) BLOCKED.addSubnet(address, prefix, 'ipv6')

/** The IPv4 address inside an IPv4-mapped IPv6 one (::ffff:1.2.3.4 or ::ffff:102:304), else null */
function mappedV4(ip: string): string | null {
  const m = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/i.exec(ip)
  if (!m) return null
  const rest = m[1]!
  if (net.isIPv4(rest)) return rest
  const h = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest)
  if (!h) return null
  const a = parseInt(h[1]!, 16), b = parseInt(h[2]!, 16)
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
}

/** Whether an IP address is on the public internet: not private, loopback, link-local, shared, reserved or multicast */
export function isPublicAddress(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  if (net.isIPv4(v)) return !BLOCKED.check(v, 'ipv4')
  if (!net.isIPv6(v)) return false
  const v4 = mappedV4(v)
  if (v4) return !BLOCKED.check(v4, 'ipv4')
  if (BLOCKED.check(v, 'ipv6')) return false
  // global unicast only (2000::/3)
  const first = parseInt(v.split(':')[0] || '0', 16)
  return first >= 0x2000 && first <= 0x3fff
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

/** dns.lookup that refuses a name when any address it resolves to isn't public */
export function publicLookup(hostname: string, options: dns.LookupOptions | number | LookupCallback, maybe?: LookupCallback): void {
  const callback = (typeof options === 'function' ? options : maybe) as LookupCallback
  const opts: dns.LookupOptions = typeof options === 'object' ? options : typeof options === 'number' ? { family: options } : {}
  dns.lookup(hostname, { ...opts, all: true }, (err, found) => {
    const list = (found ?? []) as dns.LookupAddress[]
    if (err) return callback(err, opts.all ? [] : '', 0)
    if (list.length === 0 || !list.every(a => isPublicAddress(a.address))) {
      const e = Object.assign(new Error(`${hostname} doesn't resolve to a public address`), { code: 'ENOTPUBLIC' }) as NodeJS.ErrnoException
      return callback(e, opts.all ? [] : '', 0)
    }
    if (opts.all) return callback(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

// ── Fetching ─────────────────────────────────────────────────────────────────

export class PageRefused extends Error {
  constructor(public readonly reason: 'not_public' | 'not_a_page' | 'too_many_redirects' | 'http_error' | 'timeout' | 'unreachable', message: string) {
    super(message)
    this.name = 'PageRefused'
  }
}

/** Whether a URL may be opened at all: http(s), usual ports, no user:password, a public address when written as numbers */
export function mayOpen(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (port !== 80 && port !== 443) return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || /\.(?:localhost|local|internal|lan|home|arpa)$/i.test(host)) return false
  if (net.isIP(host)) return isPublicAddress(host)
  return host.includes('.')
}

export interface FetchedPage {
  /** Where the page was in the end (after redirects) */
  url: string
  status: number
  /** Up to MAX_BYTES of the page, as text */
  html: string
}

type Requester = (url: URL, opts: http.RequestOptions, cb: (res: http.IncomingMessage) => void) => http.ClientRequest

function charsetOf(contentType: string): BufferEncoding {
  const m = /charset=["']?([\w-]+)/i.exec(contentType)
  const cs = (m?.[1] ?? 'utf-8').toLowerCase()
  return cs === 'iso-8859-1' || cs === 'latin1' || cs === 'windows-1252' ? 'latin1' : 'utf8'
}

/** One request: the answer's status and headers, and for a page its first MAX_BYTES */
function getOnce(url: URL, deadline: number, request?: Requester): Promise<{ status: number; location: string | null; html: string | null }> {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now()
    if (left <= 0) return reject(new PageRefused('timeout', 'took too long'))
    const send: Requester = request ?? ((u, o, cb) => (u.protocol === 'https:' ? https : http).request(u, o, cb))
    const req = send(url, {
      method: 'GET',
      lookup: publicLookup as unknown as http.RequestOptions['lookup'],
      headers: {
        'user-agent': LINK_CHECK_UA,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'accept-language': 'en;q=0.9,*;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
      },
      timeout: left,
    }, res => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) {
        res.resume()
        return resolve({ status, location: typeof res.headers.location === 'string' ? res.headers.location : null, html: null })
      }
      const type = String(res.headers['content-type'] ?? '')
      if (status !== 200 || !/text\/html|application\/xhtml\+xml/i.test(type)) {
        res.resume()
        return resolve({ status, location: null, html: null })
      }
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
      const body: Readable = enc === 'gzip' ? res.pipe(zlib.createGunzip())
        : enc === 'deflate' ? res.pipe(zlib.createInflate())
        : enc === 'br' ? res.pipe(zlib.createBrotliDecompress())
        : res
      const chunks: Buffer[] = []
      let size = 0
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ status, location: null, html: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString(charsetOf(type)) })
        req.destroy()
      }
      // a page's head is near its start: stop at MAX_BYTES and read what came
      body.on('data', (c: Buffer) => { chunks.push(c); size += c.length; if (size >= MAX_BYTES) finish() })
      body.on('end', finish)
      body.on('error', () => { if (!done) { done = true; clearTimeout(timer); reject(new PageRefused('unreachable', 'the page could not be read')) } })
    })
    const timer = setTimeout(() => { req.destroy(new PageRefused('timeout', 'took too long')) }, left)
    req.on('timeout', () => req.destroy(new PageRefused('timeout', 'took too long')))
    req.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (err instanceof PageRefused) return reject(err)
      if (err?.code === 'ENOTPUBLIC') return reject(new PageRefused('not_public', 'not a public web address'))
      reject(new PageRefused('unreachable', 'the site did not answer'))
    })
    req.end()
  })
}

/** Open a public web page, following up to MAX_REDIRECTS redirects, each checked */
export async function fetchPublicPage(start: URL, request?: Requester): Promise<FetchedPage> {
  const deadline = Date.now() + FETCH_TIMEOUT_MS
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!mayOpen(url)) throw new PageRefused('not_public', 'not a public web address')
    const answer = await getOnce(url, deadline, request)
    if (answer.status >= 300 && answer.status < 400) {
      if (!answer.location) throw new PageRefused('http_error', `HTTP ${answer.status} without an address`)
      let next: URL
      try { next = new URL(answer.location, url) } catch { throw new PageRefused('http_error', 'a redirect to an unreadable address') }
      url = next
      continue
    }
    if (answer.html === null) {
      throw answer.status === 200 ? new PageRefused('not_a_page', 'not a web page') : new PageRefused('http_error', `HTTP ${answer.status}`)
    }
    return { url: url.toString(), status: answer.status, html: answer.html }
  }
  throw new PageRefused('too_many_redirects', `more than ${MAX_REDIRECTS} redirects`)
}

// ── What the page says about itself ──────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all
    }
    return ENTITIES[code.toLowerCase()] ?? all
  })
}

function metaContent(head: string, names: string[]): string | null {
  for (const name of names) {
    const tags = head.match(new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${name.replace(/:/g, '\\:')}["'][^>]*>`, 'gi')) ?? []
    for (const tag of tags) {
      const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
      const v = (c?.[1] ?? c?.[2] ?? '').trim()
      if (v) return decodeEntities(v).replace(/\s+/g, ' ').trim()
    }
  }
  return null
}

export interface PageFacts {
  title: string | null
  site: string | null
  canonical: string | null
  publishedAt: string | null
}

/** A page's headline, site name, canonical address and publication time, from its head */
export function pageFacts(html: string, base: string): PageFacts {
  const headEnd = html.search(/<\/head\s*>/i)
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 200_000)
  const tag = /<title\b[^>]*>([\s\S]{1,600}?)<\/title>/i.exec(head)?.[1]
  const title = metaContent(head, ['og:title', 'twitter:title']) ?? (tag ? decodeEntities(tag).replace(/\s+/g, ' ').trim() : null)
  const site = metaContent(head, ['og:site_name', 'application-name'])
  let canonical: string | null = null
  const link = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(head)?.[0]
  const href = link ? /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(link) : null
  const raw = (href?.[1] ?? href?.[2] ?? metaContent(head, ['og:url']) ?? '').trim()
  if (raw) { try { canonical = new URL(decodeEntities(raw), base).toString() } catch { canonical = null } }
  const published = metaContent(head, ['article:published_time', 'og:published_time', 'datePublished', 'pubdate'])
  const at = published ? Date.parse(published) : NaN
  return {
    title: title ? title.slice(0, 300) : null,
    site: site ? site.slice(0, 120) : null,
    canonical: canonical && /^https?:/i.test(canonical) ? canonical : null,
    publishedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
  }
}
