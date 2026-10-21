/**
 * Opening a page a stranger pasted (paste-a-link version 2, plan G22; Devon,
 * Oct 21, 2026: "Yes, with safeguards"): public addresses only, usual ports,
 * 3 redirects, web pages only, and what a page says about itself.
 */
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import http from 'node:http'
import { isPublicAddress, mayOpen, publicLookup, pageFacts, decodeEntities, fetchPublicPage, PageRefused, MAX_BYTES } from '../lib/safe-fetch'

describe('isPublicAddress', () => {
  it('refuses private, loopback, link-local, shared, reserved and multicast addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1',
      '2001:db8::1', '64:ff9b::a00:1', '[::1]', 'not-an-ip']) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })
  it('allows public ones', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '142.93.71.102', '104.168.149.178', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true)
    }
  })
})

describe('mayOpen', () => {
  it('http and https on their usual ports, by name or public address', () => {
    expect(mayOpen(new URL('https://www.reuters.com/world/x'))).toBe(true)
    expect(mayOpen(new URL('http://example.com:80/a'))).toBe(true)
    expect(mayOpen(new URL('https://8.8.8.8/a'))).toBe(true)
  })
  it('nothing else', () => {
    for (const u of ['ftp://example.com/a', 'https://example.com:8443/a', 'http://127.0.0.1/a', 'http://[::1]/a', 'http://localhost/a',
      'http://printer.local/a', 'http://metadata.internal/a', 'https://user:pass@example.com/a', 'http://169.254.169.254/latest/meta-data/', 'http://intranet/a']) {
      expect(mayOpen(new URL(u)), u).toBe(false)
    }
  })
})

describe('publicLookup', () => {
  it('refuses a name that resolves to the machine itself', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>(resolve => publicLookup('localhost', { all: true }, e => resolve(e)))
    expect(err?.code).toBe('ENOTPUBLIC')
    const err2 = await new Promise<NodeJS.ErrnoException | null>(resolve => publicLookup('127.0.0.1', {}, e => resolve(e)))
    expect(err2?.code).toBe('ENOTPUBLIC')
  })
})

describe('pageFacts', () => {
  const html = `<!doctype html><html><head>
    <title>Ignored when og:title exists | Example News</title>
    <meta property="og:title" content="Drone strike on Abyei market kills 150 &amp; wounds dozens">
    <meta property="og:site_name" content='Example News'>
    <link rel="canonical" href="/world/abyei-strike">
    <meta property="article:published_time" content="2026-10-20T09:15:00Z">
  </head><body><h1>Other</h1></body></html>`
  it('reads the headline, the site, the canonical address and the time', () => {
    expect(pageFacts(html, 'https://news.example.com/x?utm_source=a')).toEqual({
      title: 'Drone strike on Abyei market kills 150 & wounds dozens',
      site: 'Example News',
      canonical: 'https://news.example.com/world/abyei-strike',
      publishedAt: '2026-10-20T09:15:00.000Z',
    })
  })
  it('falls back to the title tag', () => {
    expect(pageFacts('<head><title>  Quake &#8212; 5 dead  </title></head>', 'https://a.example/b').title).toBe('Quake — 5 dead')
    expect(pageFacts('<p>no head</p>', 'https://a.example/b').title).toBeNull()
  })
  it('decodes entities', () => {
    expect(decodeEntities('Tom &amp; Jerry&#39;s &quot;show&quot; &#x2014; &nbsp;ok')).toBe('Tom & Jerry\'s "show" —  ok')
  })
})

/** A fake http.request: answers by address, and records what was asked */
function fakeRequester(answers: Record<string, { status: number; headers?: Record<string, string>; body?: string | Buffer }>) {
  const asked: string[] = []
  const request = (url: URL, _opts: http.RequestOptions, cb: (res: http.IncomingMessage) => void) => {
    asked.push(url.toString())
    const req = new EventEmitter() as unknown as http.ClientRequest
    ;(req as unknown as { end: () => void }).end = () => {
      const a = answers[url.toString()] ?? { status: 404 }
      const res = new PassThrough() as unknown as http.IncomingMessage
      res.statusCode = a.status
      res.headers = a.headers ?? {}
      setImmediate(() => { cb(res); (res as unknown as PassThrough).end(a.body ?? '') })
    }
    ;(req as unknown as { destroy: (e?: Error) => void }).destroy = (e?: Error) => { if (e) req.emit('error', e) }
    return req
  }
  return { request, asked }
}

describe('fetchPublicPage', () => {
  const page = { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<head><title>Hello</title></head>' }

  it('follows redirects, each checked', async () => {
    const { request, asked } = fakeRequester({
      'https://a.example/x': { status: 301, headers: { location: '/y' } },
      'https://a.example/y': page,
    })
    const got = await fetchPublicPage(new URL('https://a.example/x'), request)
    expect(got.url).toBe('https://a.example/y')
    expect(got.html).toContain('Hello')
    expect(asked).toEqual(['https://a.example/x', 'https://a.example/y'])
  })

  it('refuses a redirect to the server\'s own network', async () => {
    const { request, asked } = fakeRequester({ 'https://a.example/x': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } } })
    await expect(fetchPublicPage(new URL('https://a.example/x'), request)).rejects.toMatchObject({ reason: 'not_public' })
    expect(asked).toEqual(['https://a.example/x'])
  })

  it('at most 3 redirects', async () => {
    const { request } = fakeRequester({
      'https://a.example/1': { status: 302, headers: { location: '/2' } },
      'https://a.example/2': { status: 302, headers: { location: '/3' } },
      'https://a.example/3': { status: 302, headers: { location: '/4' } },
      'https://a.example/4': { status: 302, headers: { location: '/5' } },
    })
    await expect(fetchPublicPage(new URL('https://a.example/1'), request)).rejects.toMatchObject({ reason: 'too_many_redirects' })
  })

  it('web pages only, and an error for an error', async () => {
    const { request } = fakeRequester({
      'https://a.example/pdf': { status: 200, headers: { 'content-type': 'application/pdf' }, body: '%PDF' },
      'https://a.example/gone': { status: 410 },
    })
    await expect(fetchPublicPage(new URL('https://a.example/pdf'), request)).rejects.toBeInstanceOf(PageRefused)
    await expect(fetchPublicPage(new URL('https://a.example/pdf'), request)).rejects.toMatchObject({ reason: 'not_a_page' })
    await expect(fetchPublicPage(new URL('https://a.example/gone'), request)).rejects.toMatchObject({ reason: 'http_error' })
  })

  it('reads no more than the first 512 KB', async () => {
    const big = '<head><title>Big</title></head>' + 'x'.repeat(MAX_BYTES * 2)
    const { request } = fakeRequester({ 'https://a.example/big': { ...page, body: big } })
    const got = await fetchPublicPage(new URL('https://a.example/big'), request)
    expect(got.html.length).toBeLessThanOrEqual(MAX_BYTES)
    expect(got.html.startsWith('<head><title>Big')).toBe(true)
  })

  it('never opens a private address, even on a real request', async () => {
    const server = http.createServer((_q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>secret</title>') })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    await expect(fetchPublicPage(new URL(`http://127.0.0.1:${port}/`))).rejects.toMatchObject({ reason: 'not_public' })
    await expect(fetchPublicPage(new URL('http://127.0.0.1/'))).rejects.toMatchObject({ reason: 'not_public' })
    server.close()
  })
})
