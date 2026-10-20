import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { corsDecision, isPublicRead } from '../cors-policy'

// Which websites may read the API's answers from a browser (plan V3b, Oct 20, 2026)

const OWN = ['https://world-pulse.io', 'https://www.world-pulse.io']

describe('isPublicRead', () => {
  it('covers the public reads and their preflight', () => {
    expect(isPublicRead('GET', '/api/v1/public/signals?limit=10&category=conflict')).toBe(true)
    expect(isPublicRead('GET', '/api/v1/rss/signals.json')).toBe(true)
    expect(isPublicRead('GET', '/api/v1/signals/0b7e2c1a-1111-4222-8333-944445555666')).toBe(true)
    expect(isPublicRead('HEAD', '/api/v1/countries')).toBe(true)
    expect(isPublicRead('GET', '/api/v1/feed/trending')).toBe(true)
    expect(isPublicRead('GET', '/ws')).toBe(true)
    expect(isPublicRead('OPTIONS', '/api/v1/public/signals', 'GET')).toBe(true)
  })
  it('leaves out writes, sign-in routes and look-alike paths', () => {
    expect(isPublicRead('POST', '/api/v1/signals/abc/flag')).toBe(false)
    expect(isPublicRead('OPTIONS', '/api/v1/signals/abc/flag', 'POST')).toBe(false)
    expect(isPublicRead('GET', '/api/v1/feed/following')).toBe(false)
    expect(isPublicRead('GET', '/api/v1/auth/me')).toBe(false)
    expect(isPublicRead('GET', '/api/v1/signalsx')).toBe(false)
    expect(isPublicRead('GET', '/api/v1/admin/users')).toBe(false)
  })
  it('covers the MCP server, whose questions come by POST, and only it', () => {
    expect(isPublicRead('POST', '/mcp')).toBe(true)
    expect(isPublicRead('OPTIONS', '/mcp', 'POST')).toBe(true)
    expect(isPublicRead('GET', '/mcp')).toBe(false)
    expect(isPublicRead('POST', '/mcpx')).toBe(false)
    expect(isPublicRead('POST', '/api/v1/public/signals')).toBe(false)
  })
})

describe('corsDecision', () => {
  const req = (method: string, url: string, origin?: string, asked?: string) =>
    ({ method, url, headers: { ...(origin ? { origin } : {}), ...(asked ? { 'access-control-request-method': asked } : {}) } })

  it("answers the site's own pages and origin-less calls as before: echoed, with credentials", () => {
    expect(corsDecision(req('GET', '/api/v1/feed/following', 'https://world-pulse.io'), OWN)).toEqual({ origin: true, credentials: true })
    expect(corsDecision(req('GET', '/api/v1/public/signals'), OWN)).toEqual({ origin: true, credentials: true })
  })
  it('opens the public reads to every website, without credentials', () => {
    const d = corsDecision(req('GET', '/api/v1/public/signals', 'https://example.com'), OWN)
    expect(d).toMatchObject({ origin: '*', credentials: false })
    expect(d.exposedHeaders).toContain('x-ratelimit-remaining')
  })
  it('gives any other website no CORS headers on other routes, rather than an error', () => {
    expect(corsDecision(req('GET', '/api/v1/feed/following', 'https://example.com'), OWN)).toEqual({ origin: false })
    expect(corsDecision(req('OPTIONS', '/api/v1/auth/login', 'https://example.com', 'POST'), OWN)).toEqual({ origin: false })
  })
})

describe('the API with this policy', () => {
  async function build() {
    const app = Fastify()
    await app.register(cors, { delegator: (r, cb) => cb(null, corsDecision(r, OWN)) })
    app.get('/api/v1/public/signals', async () => ({ success: true }))
    app.get('/api/v1/feed/following', async () => ({ success: true }))
    app.post('/mcp', async () => ({ jsonrpc: '2.0', id: 1, result: {} }))
    return app
  }

  it('lets another website read the public signals (it answered 500 before)', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/signals', headers: { origin: 'https://example.com' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
    expect(String(res.headers.vary)).toMatch(/Origin/i)
  })

  it("answers another website's preflight for a public read", async () => {
    const app = await build()
    const res = await app.inject({ method: 'OPTIONS', url: '/api/v1/public/signals', headers: { origin: 'https://example.com', 'access-control-request-method': 'GET' } })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/GET/)
  })

  it('answers another website on other routes without CORS headers, never a 500', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/api/v1/feed/following', headers: { origin: 'https://example.com' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it("keeps echoing the site's own address with credentials", async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/api/v1/feed/following', headers: { origin: 'https://world-pulse.io' } })
    expect(res.headers['access-control-allow-origin']).toBe('https://world-pulse.io')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it("answers another website's preflight for the MCP server, with the headers it asks for", async () => {
    const app = await build()
    const res = await app.inject({ method: 'OPTIONS', url: '/mcp', headers: { origin: 'https://example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, mcp-protocol-version' } })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/POST/)
    expect(String(res.headers['access-control-allow-headers'])).toMatch(/mcp-protocol-version/)
    const post = await app.inject({ method: 'POST', url: '/mcp', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, payload: '{}' })
    expect(post.headers['access-control-allow-origin']).toBe('*')
  })
})
