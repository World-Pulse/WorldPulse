/**
 * ssrf-guard.ts — SSRF-safe URL validation
 *
 * Prevents Server-Side Request Forgery by blocking URLs that resolve to
 * private/internal infrastructure. Call isSSRFSafeUrl() before fetching
 * any user-supplied URL.
 *
 * Blocked:
 *   - Non-http/https schemes (file://, ftp://, gopher://, etc.)
 *   - IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *                          127.0.0.0/8, 169.254.0.0/16 (link-local)
 *   - IPv6 loopback (::1), link-local (fe80::/10), ULA (fc00::/7)
 *   - Hostnames that are "localhost" variants
 *   - Numeric IP literals in hostname (checked without DNS resolution)
 *
 * Note: hostname-to-IP DNS rebinding cannot be fully prevented here
 * (that requires resolver-level controls). For defense-in-depth, pair
 * this with egress firewall rules on the host.
 */

// ─── IPv4 helpers ─────────────────────────────────────────────────────────────

function parseIPv4(host: string): [number, number, number, number] | null {
  // Accept only pure dotted-decimal, no leading zeros (octal ambiguity)
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(p => {
    if (!/^\d+$/.test(p)) return NaN
    const n = Number(p)
    if (n < 0 || n > 255) return NaN
    return n
  })
  if (octets.some(isNaN)) return null
  return octets as [number, number, number, number]
}

function isPrivateIPv4(host: string): boolean {
  const oct = parseIPv4(host)
  if (!oct) return false
  const [a, b] = oct
  // 10.0.0.0/8
  if (a === 10) return true
  // 172.16.0.0/12 (172.16.x.x – 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 169 && b === 254) return true
  // 0.0.0.0/8
  if (a === 0) return true
  // 100.64.0.0/10 (CGNAT / AWS metadata-style)
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

// ─── IPv6 helpers ─────────────────────────────────────────────────────────────

function isPrivateIPv6(host: string): boolean {
  // Strip brackets from [::1] notation
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  const lower = h.toLowerCase()

  // Loopback
  if (lower === '::1') return true

  // Unspecified
  if (lower === '::') return true

  // link-local: fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true
  if (lower.startsWith('fe80')) return true

  // ULA: fc00::/7 (fc00:: – fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true

  // IPv4-mapped / IPv4-compatible: ::ffff:192.168.x.x etc.
  const ipv4Mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (ipv4Mapped?.[1]) {
    return isPrivateIPv4(ipv4Mapped[1])
  }

  return false
}

// ─── Localhost variants ───────────────────────────────────────────────────────

const LOCALHOST_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  '0',            // http://0/ resolves to 127.0.0.1 on many systems
])

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Returns true if the URL is safe to fetch from a server context.
 * Returns false for private IPs, localhost, non-http(s) schemes, and malformed URLs.
 *
 * @example
 *   isSSRFSafeUrl('https://example.com/feed.xml')  // true
 *   isSSRFSafeUrl('http://192.168.1.1/admin')       // false
 *   isSSRFSafeUrl('file:///etc/passwd')             // false
 */
export function isSSRFSafeUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    // Malformed URL — block it
    return false
  }

  // ── Scheme check ─────────────────────────────────────────
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }

  const host = parsed.hostname.toLowerCase()

  // ── Localhost names ───────────────────────────────────────
  if (LOCALHOST_NAMES.has(host)) return false

  // ── IPv4 private ranges ───────────────────────────────────
  if (isPrivateIPv4(host)) return false

  // ── IPv6 private/loopback ─────────────────────────────────
  if (isPrivateIPv6(host)) return false

  // ── Empty or dot-only hostname ────────────────────────────
  if (!host || host === '.') return false

  return true
}

/**
 * Throws a descriptive error if the URL is not SSRF-safe.
 * Use in contexts where you want to propagate the error to the caller.
 */
export function assertSSRFSafeUrl(rawUrl: string): void {
  if (!isSSRFSafeUrl(rawUrl)) {
    throw new Error(`SSRF blocked: URL '${rawUrl}' targets a disallowed private/internal resource`)
  }
}
