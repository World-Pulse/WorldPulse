/**
 * WorldPulse's MCP server (routes/mcp.ts, plan 15, Oct 20, 2026): JSON-RPC
 * over one POST, the six read-only tools asking the API's own routes, and
 * those inner calls counted as the client who asked.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { registerMcpRoutes, PROTOCOL_VERSIONS } from '../mcp'
import { internalCallClient } from '../../lib/internal-call'
import { rateLimitKey } from '../../lib/rate-limit-options'

const STORY = {
  id: '11111111-1111-4111-8111-111111111111', leadId: '22222222-2222-4222-8222-222222222222',
  title: 'Ceasefire talks resume in Doha', place: 'Doha, Qatar', category: 'conflict', severity: 'high',
  outletCount: 14, outlets: ['aljazeera.com', 'bbc.co.uk', 'reuters.com'], verifiedAt: '2026-10-20T09:00:00.000Z',
}

let asked: Array<{ url: string; client: string | undefined }> = []

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // the API's own routes the tools ask, standing in for the real ones
  app.get('/api/v1/stories', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { stories: [STORY], hours: 12 } }
  })
  app.get('/api/v1/stories/week', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    if ((req.query as { week?: string }).week === '2099-W10') return reply.code(404).send({ success: false, code: 'NOT_FOUND', error: 'That week has not started yet' })
    if ((req.query as { week?: string }).week === '2026-W30') return reply.code(503).send({ success: false, code: 'SERVICE_UNAVAILABLE', error: 'This week is being put together; try again in a couple of minutes' })
    return { success: true, data: { week: '2026-W43', underWay: true, stories: [STORY], countries: [{ code: 'QA', name: 'Qatar', stories: 31 }] } }
  })
  app.get('/api/v1/stories/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (id !== STORY.leadId) return reply.code(404).send({ success: false, code: 'NOT_FOUND', error: 'Story not found' })
    return {
      success: true,
      data: {
        storyId: STORY.id, size: 2, outlets: 2, outletNames: ['aljazeera.com', 'bbc.co.uk'], verifiedAt: STORY.verifiedAt,
        signals: [
          { id: STORY.leadId, title: STORY.title, status: 'verified', outlet: 'aljazeera.com', url: 'https://www.aljazeera.com/a', createdAt: '2026-10-20T08:00:00.000Z', locationName: 'Doha' },
          { id: '33333333-3333-4333-8333-333333333333', title: 'Talks on Gaza resume', status: 'verified', outlet: 'bbc.co.uk', url: 'https://www.bbc.co.uk/b', createdAt: '2026-10-20T08:30:00.000Z', locationName: 'Doha' },
        ],
      },
    }
  })
  app.get('/api/v1/stories/by-link', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const url = (req.query as { url?: string }).url ?? ''
    if (url.includes('aljazeera.com/a')) {
      return {
        success: true,
        data: {
          found: true, via: 'claim', link: `https://world-pulse.io/signals/${STORY.leadId}`,
          report: { id: STORY.leadId, title: STORY.title, outlet: 'aljazeera.com', url: 'https://www.aljazeera.com/a', status: 'verified', createdAt: '2026-10-20T08:00:00.000Z' },
          story: { id: STORY.id, outlets: 2, outletNames: ['aljazeera.com', 'bbc.co.uk'], verified: true, verifiedAt: STORY.verifiedAt, size: 2 },
        },
      }
    }
    if (url.includes('lonely.example')) {
      return {
        success: true,
        data: {
          found: true, via: 'links', link: 'https://world-pulse.io/signals/55555555-5555-4555-8555-555555555555',
          report: { id: '55555555-5555-4555-8555-555555555555', title: 'Local strike', outlet: 'lonely.example' },
          story: { id: '55555555-5555-4555-8555-555555555555', outlets: 1, outletNames: ['lonely.example'], verified: false, verifiedAt: null, size: 1 },
        },
      }
    }
    return { success: true, data: { found: false, reason: url.endsWith('.com/') ? 'not_an_article' : 'not_seen' } }
  })
  app.get('/api/v1/coverage-gap', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const week = (req.query as { week?: string }).week
    if (week === '2026-W43') return reply.code(400).send({ success: false, code: 'VALIDATION_ERROR', error: 'That week is not over yet: leave out week for the last 7 days' })
    return {
      success: true,
      data: {
        window: week ? 'week' : 'last7days', week: week ?? null, unhcrYear: 2025,
        crises: [
          { rank: 1, code: 'SS', name: 'South Sudan', displaced: 3_788_010, outlets: 2, outletsAbroad: 1, peoplePerOutlet: 1_894_005, stories: [{ id: STORY.leadId, title: 'Floods cut off Bentiu camps', outlets: 2, verified: true }] },
          { rank: 2, code: 'CF', name: 'Central African Republic', displaced: 1_184_301, outlets: 1, peoplePerOutlet: 1_184_301, stories: [] },
        ],
        mostCovered: [{ code: 'US', name: 'United States', outlets: 412, articles: 9000 }],
        totals: { crisisShare: 0.0612, crisisDisplaced: 94_989_774 },
      },
    }
  })
  app.get('/api/v1/search/semantic', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, semantic: true, results: [{ id: STORY.leadId, title: STORY.title, status: 'verified', locationName: 'Doha', createdAt: '2026-10-20T08:00:00.000Z', category: 'conflict', score: 0.61 }] }
  })
  await app.register(registerMcpRoutes, { prefix: '/mcp' })
  return app
}

const rpc = (app: FastifyInstance, body: unknown) =>
  app.inject({ method: 'POST', url: '/mcp', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, payload: JSON.stringify(body) })

const call = async (app: FastifyInstance, name: string, args: Record<string, unknown> = {}) =>
  (await rpc(app, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).json().result

describe('MCP server', () => {
  beforeEach(() => { asked = [] })

  it('answers initialize with the version asked for, or its newest', async () => {
    const app = await build()
    const a = (await rpc(app, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()
    expect(a).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'worldpulse' } } })
    expect(a.result.instructions).toMatch(/how-we-count/)
    const b = (await rpc(app, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json()
    expect(b.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0])
  })

  it('takes notifications with 202 and no body, and answers ping', async () => {
    const app = await build()
    const n = await rpc(app, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(n.statusCode).toBe(202)
    expect(n.body).toBe('')
    expect((await rpc(app, { jsonrpc: '2.0', id: 3, method: 'ping' })).json()).toEqual({ jsonrpc: '2.0', id: 3, result: {} })
  })

  it('lists six read-only tools with their input schemas', async () => {
    const app = await build()
    const { tools } = (await rpc(app, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).json().result
    expect(tools.map((t: { name: string }) => t.name)).toEqual(['top_stories', 'story', 'search_reports', 'week', 'check_link', 'under_reported'])
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.annotations.readOnlyHint).toBe(true)
    }
  })

  it('top_stories asks the stories list, as the client who asked, and cites world-pulse.io', async () => {
    const app = await build()
    const r = await call(app, 'top_stories', { hours: 24, limit: 5, country: 'qa' })
    expect(asked).toEqual([{ url: '/api/v1/stories?hours=24&limit=5&country=QA', client: 'ip:127.0.0.1' }])
    expect(r.isError).toBe(false)
    expect(r.content[0].text).toContain('1. Ceasefire talks resume in Doha')
    expect(r.content[0].text).toContain('Verified · 14 outlets')
    expect(r.content[0].text).toContain(`https://world-pulse.io/signals/${STORY.leadId}`)
    expect(r.structuredContent.stories[0]).toMatchObject({ id: STORY.id, outlets: 14, verified: true, url: `https://world-pulse.io/signals/${STORY.leadId}` })
  })

  it('story lists every outlet and report; a wrong id is a tool error, not a crash', async () => {
    const app = await build()
    const r = await call(app, 'story', { id: STORY.leadId })
    // each outlet with what it is (lib/outlets.ts, plan 15, Oct 22, 2026)
    expect(r.content[0].text).toContain('Outlets: Al Jazeera (international, QA), BBC (international, GB)')
    expect(r.structuredContent.outletInfo[1]).toEqual({ site: 'bbc.co.uk', name: 'BBC', kind: 'international', country: 'GB', stateMedia: false })
    expect(r.content[0].text).toContain('https://www.bbc.co.uk/b')
    expect(r.structuredContent).toMatchObject({ outlets: 2, reports: 2 })
    const missing = await call(app, 'story', { id: '44444444-4444-4444-8444-444444444444' })
    expect(missing).toMatchObject({ isError: true, content: [{ type: 'text', text: 'No story or report with that id' }] })
    const bad = await call(app, 'story', { id: 'not-an-id' })
    expect(bad.isError).toBe(true)
  })

  it('search_reports searches by meaning; week reads a week', async () => {
    const app = await build()
    const s = await call(app, 'search_reports', { query: 'talks in Qatar', limit: 3 })
    expect(asked[0]).toEqual({ url: '/api/v1/search/semantic?q=talks%20in%20Qatar&limit=3', client: 'ip:127.0.0.1' })
    expect(s.content[0].text).toContain('Reports about "talks in Qatar"')
    const w = await call(app, 'week')
    expect(w.content[0].text).toContain('WorldPulse Week 2026-W43 (so far)')
    expect(w.content[0].text).toContain('Qatar 31')
    const future = await call(app, 'week', { week: '2099-W10' })
    expect(future).toMatchObject({ isError: true })
    const preparing = await call(app, 'week', { week: '2026-W30' })
    expect(preparing).toMatchObject({ isError: true, content: [{ text: 'This week is being put together; try again in a couple of minutes' }] })
  })

  it('check_link says how many outlets reported an article\'s story, or why it can\'t (Oct 20, 2026)', async () => {
    const app = await build()
    const r = await call(app, 'check_link', { url: 'https://www.aljazeera.com/a' })
    expect(asked[0]).toEqual({ url: '/api/v1/stories/by-link?url=https%3A%2F%2Fwww.aljazeera.com%2Fa', client: 'ip:127.0.0.1' })
    expect(r.isError).toBe(false)
    expect(r.content[0].text).toContain('Ceasefire talks resume in Doha (aljazeera.com)')
    expect(r.content[0].text).toContain('Verified · 2 outlets · aljazeera.com, bbc.co.uk')
    expect(r.structuredContent).toMatchObject({ found: true, story: { outlets: 2, verified: true } })
    const one = await call(app, 'check_link', { url: 'https://lonely.example/strike' })
    expect(one.content[0].text).toContain('Only one outlet so far: treat it as unconfirmed')
    const unseen = await call(app, 'check_link', { url: 'https://example.org/unseen' })
    expect(unseen).toMatchObject({ isError: false, structuredContent: { found: false, reason: 'not_seen' } })
    expect(unseen.content[0].text).toMatch(/has not collected this article/)
    const front = await call(app, 'check_link', { url: 'https://www.aljazeera.com/' })
    expect(front.content[0].text).toMatch(/not the address of an article/)
    expect((await call(app, 'check_link', {})).isError).toBe(true)
  })

  it('under_reported lists the crises with the fewest outlets per person displaced, crediting UNHCR (Oct 21, 2026)', async () => {
    const app = await build()
    const r = await call(app, 'under_reported')
    expect(asked[0]).toEqual({ url: '/api/v1/coverage-gap', client: 'ip:127.0.0.1' })
    expect(r.isError).toBe(false)
    const text = r.content[0].text as string
    expect(text).toContain('Under-reported crises, the last 7 days: 2 countries with at least a million people displaced (UNHCR 2025 figures)')
    expect(text).toContain('Page: https://world-pulse.io/under-reported')
    expect(text).toContain('1. South Sudan: 3.8M displaced, 2 outlets, 1 based abroad (1,894,005 people per outlet) · top story: Floods cut off Bentiu camps')
    expect(text).toContain('2. Central African Republic: 1.2M displaced, 1 outlet (1,184,301 people per outlet)')
    expect(text).toContain('6.1% of the news articles')
    expect(text).toContain('United States 412 outlets')
    expect(r.structuredContent.crises[0]).toMatchObject({ code: 'SS', outlets: 2, topStory: { url: `https://world-pulse.io/signals/${STORY.leadId}` } })
    const week = await call(app, 'under_reported', { week: '2026-W42' })
    expect(asked[1].url).toBe('/api/v1/coverage-gap?week=2026-W42')
    expect(week.structuredContent.url).toBe('https://world-pulse.io/under-reported/2026-W42')
    expect(await call(app, 'under_reported', { week: '2026-W43' })).toMatchObject({ isError: true, content: [{ text: 'That week is not over yet: leave out week for the last 7 days' }] })
    expect((await call(app, 'under_reported', { week: 'last week' })).isError).toBe(true)
  })

  it('answers an unknown tool and an unknown method with JSON-RPC errors, and a batch with a list', async () => {
    const app = await build()
    const unknownTool = (await rpc(app, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_everything' } })).json()
    expect(unknownTool.error.code).toBe(-32602)
    const unknownMethod = (await rpc(app, { jsonrpc: '2.0', id: 6, method: 'resources/list' })).json()
    expect(unknownMethod.error.code).toBe(-32601)
    const batch = (await rpc(app, [{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 8, method: 'ping' }])).json()
    expect(batch.map((a: { id: number }) => a.id)).toEqual([7, 8])
  })

  it('answers GET with 405, pointing to POST (no event stream)', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/mcp' })
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
  })
})

describe('inner calls and the rate limiter', () => {
  // the API's own key function, with the plugin's in-memory store instead of Redis
  async function limited() {
    const app = Fastify({ logger: false })
    await app.register(rateLimit, { max: 100, timeWindow: '1 minute', keyGenerator: rateLimitKey })
    app.get('/api/v1/search/semantic', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ success: true, semantic: true, results: [] }))
    await app.register(registerMcpRoutes, { prefix: '/mcp' })
    await app.ready()
    return app
  }
  const search = (app: FastifyInstance, from: string) =>
    app.inject({ method: 'POST', url: '/mcp', remoteAddress: from, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_reports', arguments: { query: 'ports' } } }) })

  it("counts each tool's inner call in the asking client's own budget for that route, so MCP is no way around a limit", async () => {
    const app = await limited()
    expect((await search(app, '203.0.113.7')).json().result.isError).toBe(false)
    expect((await search(app, '203.0.113.7')).json().result.isError).toBe(false)
    const third = (await search(app, '203.0.113.7')).json().result
    expect(third).toMatchObject({ isError: true, content: [{ text: 'Too many questions from you just now; try again in a minute' }] })
    // and a direct call by the same client is over the limit too: one budget
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/semantic?q=ports', remoteAddress: '203.0.113.7' })).statusCode).toBe(429)
  })

  it("keeps clients apart: one busy assistant doesn't use up another's budget", async () => {
    const app = await limited()
    for (let i = 0; i < 3; i++) await search(app, '203.0.113.7')
    expect((await search(app, '198.51.100.4')).json().result.isError).toBe(false)
  })

  it('ignores a client key sent from outside', async () => {
    const app = await limited()
    const asOther = { 'x-worldpulse-internal': 'guess', 'x-worldpulse-client': 'ip:198.51.100.4' }
    for (let i = 0; i < 2; i++) await app.inject({ method: 'GET', url: '/api/v1/search/semantic?q=ports', remoteAddress: '203.0.113.7', headers: asOther })
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/semantic?q=ports', remoteAddress: '203.0.113.7', headers: asOther })).statusCode).toBe(429)
    expect((await search(app, '198.51.100.4')).json().result.isError).toBe(false)
  })
})
