import { describe, it, expect } from 'vitest'
import { isSSRFSafeUrl, assertSSRFSafeUrl } from '../utils/ssrf-guard'

describe('isSSRFSafeUrl', () => {
  // ── Valid public URLs ────────────────────────────────────────────────────────
  it('allows a standard public HTTPS URL', () => {
    expect(isSSRFSafeUrl('https://example.com/feed.xml')).toBe(true)
  })

  it('allows a public HTTP URL', () => {
    expect(isSSRFSafeUrl('http://feeds.reuters.com/reuters/topNews')).toBe(true)
  })

  it('allows a public HTTPS URL with path and query', () => {
    expect(isSSRFSafeUrl('https://api.opensanctions.org/search/default?q=test')).toBe(true)
  })

  it('allows a public IP address (non-private)', () => {
    // 8.8.8.8 is Google DNS — a valid public IP
    expect(isSSRFSafeUrl('https://8.8.8.8/')).toBe(true)
  })

  // ── Private IPv4 ranges ──────────────────────────────────────────────────────
  it('blocks 10.x.x.x (RFC 1918 private)', () => {
    expect(isSSRFSafeUrl('http://10.0.0.1/admin')).toBe(false)
  })

  it('blocks 10.255.255.255 (upper bound of 10/8)', () => {
    expect(isSSRFSafeUrl('http://10.255.255.255/')).toBe(false)
  })

  it('blocks 172.16.x.x (RFC 1918 private)', () => {
    expect(isSSRFSafeUrl('http://172.16.0.1/')).toBe(false)
  })

  it('blocks 172.31.x.x (upper bound of 172.16/12)', () => {
    expect(isSSRFSafeUrl('http://172.31.255.254/')).toBe(false)
  })

  it('allows 172.15.x.x (just below 172.16/12 — public)', () => {
    expect(isSSRFSafeUrl('http://172.15.0.1/')).toBe(true)
  })

  it('allows 172.32.x.x (just above 172.31/12 — public)', () => {
    expect(isSSRFSafeUrl('http://172.32.0.1/')).toBe(true)
  })

  it('blocks 192.168.x.x (RFC 1918 private)', () => {
    expect(isSSRFSafeUrl('http://192.168.1.1/')).toBe(false)
  })

  it('blocks 192.168.0.0 (lower bound of 192.168/16)', () => {
    expect(isSSRFSafeUrl('http://192.168.0.0/')).toBe(false)
  })

  // ── Loopback ────────────────────────────────────────────────────────────────
  it('blocks 127.0.0.1 (IPv4 loopback)', () => {
    expect(isSSRFSafeUrl('http://127.0.0.1/')).toBe(false)
  })

  it('blocks 127.255.255.255 (upper loopback)', () => {
    expect(isSSRFSafeUrl('http://127.255.255.255/')).toBe(false)
  })

  it('blocks localhost hostname', () => {
    expect(isSSRFSafeUrl('http://localhost/')).toBe(false)
  })

  it('blocks localhost with explicit port', () => {
    expect(isSSRFSafeUrl('http://localhost:8080/internal')).toBe(false)
  })

  // ── Link-local / cloud metadata ─────────────────────────────────────────────
  it('blocks 169.254.169.254 (AWS/GCP/Azure metadata endpoint)', () => {
    expect(isSSRFSafeUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
  })

  it('blocks 169.254.0.1 (link-local)', () => {
    expect(isSSRFSafeUrl('http://169.254.0.1/')).toBe(false)
  })

  // ── IPv6 private ─────────────────────────────────────────────────────────────
  it('blocks ::1 (IPv6 loopback)', () => {
    expect(isSSRFSafeUrl('http://[::1]/')).toBe(false)
  })

  it('blocks fe80::1 (IPv6 link-local)', () => {
    expect(isSSRFSafeUrl('http://[fe80::1]/')).toBe(false)
  })

  it('blocks fc00::1 (IPv6 ULA)', () => {
    expect(isSSRFSafeUrl('http://[fc00::1]/')).toBe(false)
  })

  it('blocks fd00::1 (IPv6 ULA, fd prefix)', () => {
    expect(isSSRFSafeUrl('http://[fd00::1]/')).toBe(false)
  })

  it('blocks ::ffff:192.168.1.1 (IPv4-mapped IPv6)', () => {
    expect(isSSRFSafeUrl('http://[::ffff:192.168.1.1]/')).toBe(false)
  })

  // ── Scheme validation ────────────────────────────────────────────────────────
  it('blocks file:// scheme', () => {
    expect(isSSRFSafeUrl('file:///etc/passwd')).toBe(false)
  })

  it('blocks ftp:// scheme', () => {
    expect(isSSRFSafeUrl('ftp://example.com/pub/file.txt')).toBe(false)
  })

  it('blocks gopher:// scheme', () => {
    expect(isSSRFSafeUrl('gopher://example.com/')).toBe(false)
  })

  it('blocks javascript: scheme', () => {
    expect(isSSRFSafeUrl('javascript:alert(1)')).toBe(false)
  })

  it('blocks data: URIs', () => {
    expect(isSSRFSafeUrl('data:text/html,<h1>test</h1>')).toBe(false)
  })

  // ── Malformed / edge cases ───────────────────────────────────────────────────
  it('blocks completely malformed input', () => {
    expect(isSSRFSafeUrl('not-a-url')).toBe(false)
  })

  it('blocks empty string', () => {
    expect(isSSRFSafeUrl('')).toBe(false)
  })

  it('blocks URL with no hostname', () => {
    expect(isSSRFSafeUrl('https://')).toBe(false)
  })

  it('blocks 0.0.0.0', () => {
    expect(isSSRFSafeUrl('http://0.0.0.0/')).toBe(false)
  })

  it('blocks http://0/ (short form that resolves to 0.0.0.0 on some systems)', () => {
    expect(isSSRFSafeUrl('http://0/')).toBe(false)
  })
})

describe('assertSSRFSafeUrl', () => {
  it('does not throw for a valid public URL', () => {
    expect(() => assertSSRFSafeUrl('https://example.com/')).not.toThrow()
  })

  it('throws for a private IP', () => {
    expect(() => assertSSRFSafeUrl('http://192.168.1.1/')).toThrow(/SSRF blocked/)
  })

  it('throws for localhost', () => {
    expect(() => assertSSRFSafeUrl('http://localhost:3000/')).toThrow(/SSRF blocked/)
  })

  it('throws for a non-http scheme', () => {
    expect(() => assertSSRFSafeUrl('file:///etc/hosts')).toThrow(/SSRF blocked/)
  })
})
