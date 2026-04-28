/**
 * safe-fetch.ts — SSRF-protected fetch wrapper for the scraper
 *
 * Gate 6: All outbound HTTP requests from the scraper should use this wrapper
 * to prevent SSRF attacks via user-controlled URLs (e.g., custom RSS sources,
 * webhook URLs, or redirect chains).
 *
 * Usage:
 *   import { safeFetch } from '../lib/safe-fetch'
 *   const response = await safeFetch('https://api.example.com/data')
 */

import { URL } from 'url'
import net from 'net'

/** Private/internal IP ranges that must never be fetched */
const PRIVATE_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '224.0.0.0', end: '239.255.255.255' },
  { start: '172.17.0.0', end: '172.17.255.255' },
]

const BLOCKED_SCHEMES = new Set(['file:', 'ftp:', 'gopher:', 'data:', 'javascript:'])
const INTERNAL_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata.internal', '0.0.0.0'])
const MAX_URL_LENGTH = 4096
const MAX_REDIRECTS = 5

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)
}

function isPrivateIP(ip: string): boolean {
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd00:')) {
    return true
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  if (!net.isIPv4(ip)) return false
  const n = ipToInt(ip)
  return PRIVATE_RANGES.some(r => n >= ipToInt(r.start) && n <= ipToInt(r.end))
}

export class SSRFError extends Error {
  constructor(reason: string) {
    super(`SSRF blocked: ${reason}`)
    this.name = 'SSRFError'
  }
}

function validateUrl(urlString: string): URL {
  if (urlString.length > MAX_URL_LENGTH) throw new SSRFError('url_too_long')

  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    throw new SSRFError('invalid_url')
  }

  if (BLOCKED_SCHEMES.has(parsed.protocol)) throw new SSRFError(`blocked_scheme:${parsed.protocol}`)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new SSRFError(`unsupported_scheme:${parsed.protocol}`)
  if (net.isIP(parsed.hostname) && isPrivateIP(parsed.hostname)) throw new SSRFError('private_ip')
  if (INTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) throw new SSRFError('internal_hostname')
  if (parsed.username || parsed.password) throw new SSRFError('credentials_in_url')

  return parsed
}

/**
 * SSRF-safe fetch wrapper.
 * Validates the URL before fetching and follows redirects safely
 * (re-validating each redirect target).
 */
export async function safeFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  validateUrl(url)

  const response = await fetch(url, {
    ...options,
    redirect: 'manual', // Handle redirects ourselves to validate each one
    signal: options.signal ?? AbortSignal.timeout(30_000),
  })

  // Follow redirects manually with SSRF validation
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) return response

    const redirectCount = ((options as Record<string, unknown>)._redirectCount as number) ?? 0
    if (redirectCount >= MAX_REDIRECTS) {
      throw new SSRFError('too_many_redirects')
    }

    // Resolve relative redirects
    const resolvedUrl = new URL(location, url).toString()
    return safeFetch(resolvedUrl, {
      ...options,
      _redirectCount: redirectCount + 1,
    } as RequestInit)
  }

  return response
}

export { isPrivateIP, validateUrl }
