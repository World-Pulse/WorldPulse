/**
 * Use from outside (Oct 22, 2026): the API and MCP server used by anyone but
 * WorldPulse's own website, counted a day at a time (lib/outside-use.ts).
 */
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import {
  isOutsideUse, askerKind, sentApiKey, fromOwnPages, isOwnCheck, countOutsideUse, countMcpTool, useDay, outsideUse,
  outsideUseKey, mcpUseKey, OUTSIDE_USE_KEEP_S,
} from '../lib/outside-use'
import { internalCallHeaders, INTERNAL_CALL_HEADER } from '../lib/internal-call'

const req = (route: string, extra: Partial<{ method: string; ip: string; headers: Record<string, unknown> }> = {}) => ({
  method: extra.method ?? 'GET', ip: extra.ip ?? '203.0.113.9', headers: extra.headers ?? {}, routeOptions: { url: route },
})

function fakeRedis() {
  const hashes = new Map<string, Record<string, number>>()
  const ttls = new Map<string, number>()
  const multi = () => {
    const ops: Array<() => void> = []
    const m = {
      hincrby: (k: string, f: string, n: number) => { ops.push(() => { const h = hashes.get(k) ?? {}; h[f] = (h[f] ?? 0) + n; hashes.set(k, h) }); return m },
      expire: (k: string, s: number) => { ops.push(() => ttls.set(k, s)); return m },
      exec: async () => { ops.forEach(o => o()); return [] },
    }
    return m
  }
  const hgetall = async (k: string) => Object.fromEntries(Object.entries(hashes.get(k) ?? {}).map(([f, n]) => [f, String(n)]))
  return { hashes, ttls, multi: multi as never, hgetall: hgetall as never }
}

describe('what counts as use from outside', () => {
  it('the data routes and the MCP server, asked from anywhere but the website', () => {
    expect(isOutsideUse(req('/api/v1/public/signals'), 200)).toBe(true)
    expect(isOutsideUse(req('/api/v1/coverage-gap'), 200)).toBe(true)
    expect(isOutsideUse(req('/mcp', { method: 'POST' }), 200)).toBe(true)
    // a client's mistakes are use too; server errors aren't
    expect(isOutsideUse(req('/api/v1/signals/:id'), 404)).toBe(true)
    expect(isOutsideUse(req('/api/v1/signals/:id'), 503)).toBe(false)
  })

  it("not the website: its server, readers' browsers on its pages, an MCP tool's own calls", () => {
    expect(isOutsideUse(req('/api/v1/signals', { ip: '172.18.0.5' }), 200)).toBe(false)
    expect(isOutsideUse(req('/api/v1/signals', { headers: { origin: 'https://world-pulse.io' } }), 200)).toBe(false)
    expect(isOutsideUse(req('/api/v1/signals', { headers: { referer: 'https://www.world-pulse.io/map' } }), 200)).toBe(false)
    expect(isOutsideUse(req('/api/v1/signals', { ip: '127.0.0.1', headers: internalCallHeaders('ip:203.0.113.9') }), 200)).toBe(false)
    // a made-up internal header is an outside call like any other
    expect(isOutsideUse(req('/api/v1/signals', { headers: { [INTERNAL_CALL_HEADER]: '1' } }), 200)).toBe(true)
    // another website's page calling the API is use
    expect(isOutsideUse(req('/api/v1/signals', { headers: { origin: 'https://newsroom.example' } }), 200)).toBe(true)
    expect(fromOwnPages({ origin: 'https://world-pulse.io.evil.example' })).toBe(false)
  })

  it('not account, payment, sign-in, admin, health or status routes, preflights, or an address no route answers', () => {
    for (const r of ['/api/v1/health', '/api/v1/status/ping', '/api/v1/auth/login', '/api/v1/admin/outside-use', '/api/v1/billing/webhook',
      '/api/v1/developer/keys', '/api/v1/me/feed', '/api/v1/users/:handle', '/api/v1/analytics/pageview', '/api/v1/alerts', '/api/v1/pro/waitlist']) {
      expect(isOutsideUse(req(r), 200), r).toBe(false)
    }
    // a route's name only starting like one of those is still use
    expect(isOutsideUse(req('/api/v1/mentions'), 200)).toBe(true)
    expect(isOutsideUse(req('/api/v1/signals', { method: 'OPTIONS' }), 204)).toBe(false)
    expect(isOutsideUse({ method: 'GET', ip: '203.0.113.9', headers: {} }, 404)).toBe(false)
    expect(isOutsideUse(req('/ws'), 200)).toBe(false)
  })

  it('who asks: AI agents, other crawlers, clients', () => {
    expect(askerKind('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('ai')
    expect(askerKind('Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)')).toBe('ai')
    expect(askerKind('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe('bot')
    expect(askerKind('python-requests/2.32.3')).toBe('client')
    expect(askerKind(undefined)).toBe('client')
  })

  it('an API key sent, in either header, shaped like ours', () => {
    const key = 'wp_live_' + 'a'.repeat(32)
    expect(sentApiKey({ 'x-api-key': key })).toBe(true)
    expect(sentApiKey({ authorization: `Bearer ${key}` })).toBe(true)
    expect(sentApiKey({ authorization: 'Bearer eyJhbGciOi.a-sign-in-token' })).toBe(false)
    expect(sentApiKey({ 'x-api-key': 'made-up' })).toBe(false)
  })
})

describe('counting', () => {
  const now = new Date('2026-10-22T12:00:00Z')

  it('a day at a time, by route pattern, with who asked and whether a key came; kept 45 days', async () => {
    const r = fakeRedis()
    const key = 'wp_live_' + 'b'.repeat(32)
    expect(await countOutsideUse(r, req('/api/v1/signals/:id', { headers: { 'user-agent': 'python-requests/2.32' } }), 200, now)).toBe(true)
    expect(await countOutsideUse(r, req('/api/v1/signals/:id', { headers: { 'x-api-key': key } }), 200, now)).toBe(true)
    expect(await countOutsideUse(r, req('/mcp', { method: 'POST', headers: { 'user-agent': 'Claude-User/1.0' } }), 200, now)).toBe(true)
    expect(await countOutsideUse(r, req('/api/v1/signals', { ip: '10.0.0.4' }), 200, now)).toBe(false)
    expect(r.hashes.get('use:outside:2026-10-22')).toEqual({ 'GET /api/v1/signals/:id': 2, 'POST /mcp': 1, total: 3, client: 2, ai: 1, with_key: 1 })
    expect(r.ttls.get(outsideUseKey(now))).toBe(OUTSIDE_USE_KEEP_S)
    await countMcpTool(r, 'under_reported', now)
    await countMcpTool(r, 'Not A Tool!', now)
    expect(r.hashes.get(mcpUseKey(now))).toEqual({ under_reported: 1, '(other)': 1, total: 2 })
  })

  it("WorldPulse's own checks are counted apart and never move the total", async () => {
    const r = fakeRedis()
    expect(isOwnCheck('WorldPulse-Autopilot/1.0 (checks)')).toBe(true)
    expect(isOwnCheck('curl/8.5')).toBe(false)
    expect(await countOutsideUse(r, req('/api/v1/coverage-gap', { headers: { 'user-agent': 'WorldPulse-Autopilot/1.0 (checks)' } }), 200, now)).toBe(false)
    expect(r.hashes.get(outsideUseKey(now))).toEqual({ own: 1 })
    expect(useDay('2026-10-22', { own: '1' }, null)).toMatchObject({ total: 0, own: 1, routes: {} })
  })

  it('a Redis that fails never fails the request', async () => {
    const broken = { multi: () => { throw new Error('down') } }
    await expect(countOutsideUse(broken as never, req('/api/v1/signals'), 200, now)).resolves.toBe(false)
    await expect(countMcpTool(broken as never, 'week', now)).resolves.toBeUndefined()
  })

  it('reads the days back, today first, the busiest routes first', async () => {
    const r = fakeRedis()
    r.hashes.set('use:outside:2026-10-22', { 'GET /api/v1/stories': 5, 'GET /api/v1/coverage-gap': 9, total: 14, client: 10, ai: 4, with_key: 2 })
    r.hashes.set('use:mcp:2026-10-21', { story: 3, total: 3 })
    const days = await outsideUse(r, 2, now)
    expect(days[0]).toEqual({
      day: '2026-10-22', total: 14, withKey: 2, ai: 4, bots: 0, clients: 10, own: 0,
      routes: { 'GET /api/v1/coverage-gap': 9, 'GET /api/v1/stories': 5 }, mcp: { total: 0, tools: {} },
    })
    expect(days[1]).toMatchObject({ day: '2026-10-21', total: 0, mcp: { total: 3, tools: { story: 3 } } })
    expect(useDay('2026-10-20', null, null)).toMatchObject({ total: 0, routes: {}, mcp: { total: 0, tools: {} } })
  })
})

describe('the hook (as index.ts adds it)', () => {
  it('sees the route pattern with its prefix, the caller, and the status', async () => {
    const r = fakeRedis()
    const app = Fastify({ logger: false })
    await app.register(async (sub) => { sub.get('/:id', async () => ({ ok: true })) }, { prefix: '/api/v1/signals' })
    app.addHook('onResponse', async (req, reply) => { await countOutsideUse(r, req, reply.statusCode) })
    await app.inject({ method: 'GET', url: '/api/v1/signals/abc', remoteAddress: '203.0.113.9' })
    await app.inject({ method: 'GET', url: '/api/v1/signals/def', remoteAddress: '172.18.0.7' })
    await app.inject({ method: 'GET', url: '/nothing-here', remoteAddress: '203.0.113.9' })
    const today = Object.keys(Object.fromEntries(r.hashes))
    expect(today).toHaveLength(1)
    expect(r.hashes.get(today[0])).toMatchObject({ 'GET /api/v1/signals/:id': 1, total: 1, client: 1 })
  })
})
