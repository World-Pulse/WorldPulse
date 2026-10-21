/**
 * The website's own server calling the API (plan D3, Oct 21, 2026).
 *
 * The website renders story, country, entity and home pages on its server,
 * and each asks the API for its data. It asked https://api.world-pulse.io,
 * out to the internet and back through nginx, so every one of those calls
 * came from the server's own address: all the site's readers shared one
 * rate-limit budget (GET /signals/:id allows 60 a minute per address), and
 * above 60 different stories a minute (crawlers, a busy social day) story
 * pages failed for everyone.
 *
 * Now the website calls the API over the server's private network
 * (API_URL=http://wp_api:3001 in docker-compose.prod.yml), and the API's
 * limits leave those calls alone: they are the site's, not a client's. A
 * client from outside can't pass for one: the API is reached only through
 * nginx, which adds the client's own address, and the API counts that one
 * (lib/client-address.ts), so a request from outside always has a public
 * address however its headers are written. Calls the API makes to itself for
 * an MCP client (lib/internal-call.ts) are that client's and still count.
 * Pages are limited per reader where readers arrive: nginx allows a reader 20
 * pages a second (a burst of 100), so one runaway client is turned away on
 * its own instead of failing pages for everyone.
 */

import { isInternalCall } from './internal-call'

/**
 * Whether an address is one of the server's own: loopback, private (10/8,
 * 172.16/12, 192.168/16), link-local, IPv6 loopback, unique local or
 * link-local, or such an IPv4 address written as IPv6. The same ranges the
 * API trusts as proxies (TRUSTED_PROXIES: loopback, linklocal, uniquelocal).
 */
export function isPrivateAddress(ip: string | null | undefined): boolean {
  if (typeof ip !== 'string' || ip === '') return false
  let a = ip.trim().toLowerCase()
  if (a.startsWith('::ffff:')) a = a.slice(7)
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const n = v4.slice(1).map(Number)
    if (n.some(x => x > 255)) return false
    const [p, q] = n
    return p === 10 || p === 127 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254)
  }
  if (a === '::1') return true
  // the first group written in full (four digits): "fc::1" is 00fc, not fc00
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true // fc00::/7, unique local
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true // fe80::/10, link-local
  return false
}

/** A call from inside the server (the website's own server), not an outside client's or an MCP client's */
export function isSiteCall(req: { ip?: string; headers: Record<string, unknown> }): boolean {
  if (isInternalCall(req.headers)) return false
  return isPrivateAddress(req.ip)
}
