/**
 * WorldPulse's MCP server (routes/mcp.ts, plan 15, Oct 20, 2026): JSON-RPC
 * over one POST, the six read-only tools asking the API's own routes, and
 * those inner calls counted as the client who asked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'

// tool calls counted as use from outside (lib/outside-use.ts), recorded here instead of in Redis
const counted = vi.hoisted(() => ({ tools: [] as string[] }))
vi.mock('../../db/redis', () => ({ redis: {} }))
vi.mock('../../lib/outside-use', async (actual) => ({
  ...(await actual<typeof import('../../lib/outside-use')>()),
  countMcpTool: vi.fn(async (_redis: unknown, tool: string) => { counted.tools.push(tool) }),
}))

import { registerMcpRoutes, PROTOCOL_VERSIONS } from '../mcp'
import { internalCallClient } from '../../lib/internal-call'
import { rateLimitKey } from '../../lib/rate-limit-options'

const STORY = {
  id: '11111111-1111-4111-8111-111111111111', leadId: '22222222-2222-4222-8222-222222222222',
  title: 'Ceasefire talks resume in Doha', place: 'Doha, Qatar', category: 'conflict', severity: 'high',
  outletCount: 14, outlets: ['aljazeera.com', 'bbc.co.uk', 'reuters.com'], verifiedAt: '2026-10-20T09:00:00.000Z',
  country: 'QA', countries: 9, localOutlets: 1, localNames: ['Al Jazeera'],
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
        country: 'QA', outletCountries: 2, localOutlets: 1, localOutletNames: ['Al Jazeera'],
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
  app.get('/api/v1/stories/:id/figures', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    if ((req.params as { id: string }).id !== STORY.leadId) return reply.code(404).send({ success: false, code: 'NOT_FOUND', error: 'Story not found' })
    return {
      success: true,
      data: {
        storyId: STORY.id, reports: 134, countedHours: 48,
        figures: [
          { kind: 'killed', label: 'Killed', values: [
            { value: 6, text: '6', outlets: 50, outletNames: ['1news.co.nz', 'aljazeera.com', 'aol.co.uk', 'bbc.co.uk'], headline: 'Poland mourns six killed', url: 'https://example.com/a' },
            { value: 9, text: '9', outlets: 3, outletNames: ['gdnonline.com', 'smh.com.au', 'upi.com'], headline: 'Nine killed', url: 'https://example.com/b' },
          ] },
          { kind: 'injured', label: 'Injured', values: [] },
        ],
      },
    }
  })
  app.get('/api/v1/signals', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const st = (req.query as { status?: string }).status
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
    const items = st === 'pending'
      ? [{ id: '66666666-6666-4666-8666-666666666666', title: 'Fire at Doha port', status: 'pending', location: { lat: 25.29, lng: 51.55 }, locationName: 'Doha', countryCode: 'QA', createdAt: ago(1) }]
      : [
        { id: STORY.leadId, title: STORY.title, status: 'verified', location: { lat: 25.2854, lng: 51.531 }, locationName: 'Doha', countryCode: 'QA', createdAt: ago(2) },
        // in the box's corner, outside the circle
        { id: '77777777-7777-4777-8777-777777777777', title: 'Corner of the box', status: 'verified', location: { lat: 25.7, lng: 52.0 }, locationName: 'At sea', countryCode: null, createdAt: ago(3) },
        // too old
        { id: '88888888-8888-4888-8888-888888888888', title: 'Old news in Doha', status: 'verified', location: { lat: 25.29, lng: 51.53 }, locationName: 'Doha', countryCode: 'QA', createdAt: ago(40) },
      ]
    return { success: true, data: { items, cursor: null, hasMore: false } }
  })
  app.get('/api/v1/stories/outlets', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { stories: { [STORY.leadId]: { storyId: STORY.id, size: 20, outlets: 14, outletsAll: 14, verified: true } } } }
  })
  app.get('/api/v1/countries/:code', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const code = (req.params as { code: string }).code
    return { code, name: code === 'QA' ? 'Qatar' : code, window: '24h', total_signals: 31, recent_signals: [] }
  })
  app.get('/api/v1/briefing/structured', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return {
      success: true,
      data: {
        date: '2026-11-08', generated_at: '2026-11-08T06:02:00.000Z',
        executive_summary: 'Talks resumed in Doha (14 outlets).',
        sections: [{ id: 'what_to_watch', title: 'What to Watch', body: 'A vote in Kenya (5 outlets).' }, { id: 'cyber_tech', title: 'Cyber & Tech', body: '' }],
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

  it('lists eleven read-only tools with their input schemas', async () => {
    const app = await build()
    const { tools } = (await rpc(app, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).json().result
    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      'top_stories', 'story', 'search_reports', 'week', 'check_link', 'under_reported',
      'story_numbers', 'outlet', 'near', 'country', 'daily_brief',
    ])
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

  it("says where a story's outlets are from: how many countries, and the story's own country's (Nov 8, 2026)", async () => {
    const app = await build()
    const top = await call(app, 'top_stories', { hours: 24 })
    expect(top.content[0].text).toContain('Verified · 14 outlets in 9 countries · 1 from Qatar (Al Jazeera)')
    expect(top.structuredContent.stories[0]).toMatchObject({ country: 'QA', outletCountries: 9, localOutlets: 1, localOutletNames: ['Al Jazeera'] })
    const one = await call(app, 'story', { id: STORY.leadId })
    expect(one.content[0].text).toContain('Outlets from 2 countries · 1 from Qatar (Al Jazeera)')
    expect(one.structuredContent).toMatchObject({ country: 'QA', outletCountries: 2, localOutlets: 1, localOutletNames: ['Al Jazeera'] })
  })

  it("story_numbers gives each figure with its outlets, the most reported first (Nov 8, 2026)", async () => {
    const app = await build()
    const r = await call(app, 'story_numbers', { id: STORY.leadId })
    expect(asked[0]).toEqual({ url: `/api/v1/stories/${STORY.leadId}/figures`, client: 'ip:127.0.0.1' })
    expect(r.isError).toBe(false)
    expect(r.content[0].text).toContain('from the headlines of its 134 reports in its last 48 hours')
    expect(r.content[0].text).toContain('Killed: 6 (50 outlets: 1news.co.nz, aljazeera.com, aol.co.uk, …) · 9 (3 outlets: gdnonline.com, smh.com.au, upi.com)')
    expect(r.content[0].text).not.toContain('Injured')
    expect(r.structuredContent.figures).toEqual([{ kind: 'killed', label: 'Killed', values: [
      { value: 6, outlets: 50, outletNames: ['1news.co.nz', 'aljazeera.com', 'aol.co.uk', 'bbc.co.uk'], headline: 'Poland mourns six killed', url: 'https://example.com/a' },
      { value: 9, outlets: 3, outletNames: ['gdnonline.com', 'smh.com.au', 'upi.com'], headline: 'Nine killed', url: 'https://example.com/b' },
    ] }])
    expect(await call(app, 'story_numbers', { id: '44444444-4444-4444-8444-444444444444' })).toMatchObject({ isError: true, content: [{ text: 'No story or report with that id' }] })
    expect((await call(app, 'story_numbers', { id: 'nope' })).isError).toBe(true)
  })

  it('outlet says what a website is, from the outlet directory, without asking the API', async () => {
    const app = await build()
    const r = await call(app, 'outlet', { sites: ['tass.com', 'https://www.bbc.co.uk/news/articles/x', 'edition.cnn.com', 'unknown-site.example'] })
    expect(asked).toEqual([])
    expect(r.content[0].text).toContain('tass.com: TASS, news agency, from Russia, state media (a government runs it)')
    expect(r.content[0].text).toContain('bbc.co.uk: BBC, international, from the United Kingdom')
    expect(r.content[0].text).toContain('cnn.com: CNN')
    expect(r.content[0].text).toMatch(/unknown-site\.example: not in WorldPulse's directory of \d+ outlets/)
    expect(r.structuredContent.outlets[0]).toEqual({ site: 'tass.com', known: true, name: 'TASS', kind: 'agency', kindLabel: 'News agency', country: 'RU', countryName: 'Russia', stateMedia: true })
    expect(r.structuredContent.outlets[3]).toMatchObject({ site: 'unknown-site.example', known: false })
    expect((await call(app, 'outlet', { sites: [] })).isError).toBe(true)
    expect((await call(app, 'outlet', { sites: Array.from({ length: 11 }, (_, i) => `s${i}.com`) })).isError).toBe(true)
  })

  it('near lists the reports pinned within a distance of a place, newest first, with their outlet counts', async () => {
    const app = await build()
    const r = await call(app, 'near', { latitude: 25.2854, longitude: 51.531, radius_km: 30 })
    const box = asked[0]!.url
    expect(box).toMatch(/^\/api\/v1\/signals\?bbox=51\.2\d+,25\.01\d+,51\.8\d+,25\.55\d+&status=verified&limit=100$/)
    expect(asked[1]!.url).toBe(`/api/v1/stories/outlets?ids=${STORY.leadId}`)
    expect(r.content[0].text).toContain('1 verified report within 30 km of 25.29, 51.53 in the last 24 hours, newest first:')
    expect(r.content[0].text).toContain(`1. ${STORY.title}\n   Verified · 14 outlets · Doha, 0 km away · 2h ago`)
    expect(r.content[0].text).not.toContain('Corner of the box')
    expect(r.content[0].text).not.toContain('Old news')
    expect(r.structuredContent.reports).toEqual([expect.objectContaining({ id: STORY.leadId, km: 0, storyOutlets: 14, place: 'Doha' })])
    // pending reports too, when asked; a longer look back reaches the old one
    asked = []
    const all = await call(app, 'near', { latitude: 25.2854, longitude: 51.531, radius_km: 30, hours: 72, pending: true })
    expect(asked.map(a => a.url.replace(/bbox=[^&]+&/, ''))).toEqual(['/api/v1/signals?status=verified&limit=100', '/api/v1/signals?status=pending&limit=100', expect.stringContaining('/api/v1/stories/outlets?ids=')])
    expect(all.content[0].text).toContain('Fire at Doha port\n   One outlet so far (unconfirmed)')
    expect(all.content[0].text).toContain('Old news in Doha')
    // nothing there
    const none = await call(app, 'near', { latitude: -45, longitude: 170, radius_km: 50 })
    expect(none.content[0].text).toMatch(/^No verified report within 50 km/)
    expect((await call(app, 'near', { latitude: 95, longitude: 0 })).isError).toBe(true)
    expect((await call(app, 'near', { latitude: 10 })).isError).toBe(true)
  })

  it('country gives the outlets based there, its verified reports, its top stories and whether it is under-reported', async () => {
    const app = await build()
    const r = await call(app, 'country', { country: 'qa' })
    expect(asked.map(a => a.url).sort()).toEqual(['/api/v1/countries/QA?window=24h', '/api/v1/coverage-gap', '/api/v1/stories?hours=24&limit=5&country=QA'])
    expect(r.content[0].text).toContain('Qatar, the last 24 hours. Page: https://world-pulse.io/countries/qa')
    expect(r.content[0].text).toMatch(/Outlets WorldPulse counts that are based there: \d+ \(.*Al Jazeera/)
    expect(r.content[0].text).toContain('Verified reports pinned there: 31.')
    expect(r.content[0].text).toContain('1. Ceasefire talks resume in Doha')
    expect(r.content[0].text).not.toContain('under-reported crises')
    expect(r.structuredContent).toMatchObject({ country: 'QA', name: 'Qatar', verifiedReports24h: 31, underReported: null })
    const ss = await call(app, 'country', { country: 'SS' })
    expect(ss.content[0].text).toContain('Among the under-reported crises: number 1 of 2, 3.8M people displaced (UNHCR) and 2 outlets in the last 7 days.')
    expect(ss.structuredContent.underReported).toMatchObject({ rank: 1, of: 2, displaced: 3_788_010 })
    // the United Kingdom is GB in WorldPulse's data
    asked = []
    await call(app, 'country', { country: 'UK' })
    expect(asked.map(a => a.url)).toContain('/api/v1/countries/GB?window=24h')
    expect((await call(app, 'country', { country: 'XX' })).isError).toBe(true)
    expect((await call(app, 'country', { country: 'Qatar' })).isError).toBe(true)
  })

  it("daily_brief reads the Daily Briefing and says an AI model wrote it", async () => {
    const app = await build()
    const r = await call(app, 'daily_brief')
    expect(asked[0]!.url).toBe('/api/v1/briefing/structured')
    expect(r.content[0].text).toContain('WorldPulse Daily Briefing, 2026-11-08, written 06:02 UTC by an AI model from verified stories. Page: https://world-pulse.io/briefing')
    expect(r.content[0].text).toContain('Talks resumed in Doha (14 outlets).')
    expect(r.content[0].text).toContain('What to Watch: A vote in Kenya (5 outlets).')
    expect(r.content[0].text).not.toContain('Cyber & Tech')
    expect(r.structuredContent).toMatchObject({ date: '2026-11-08', summary: 'Talks resumed in Doha (14 outlets).', sections: [{ id: 'what_to_watch' }] })
  })

  it('offers three starter prompts, their arguments checked', async () => {
    const app = await build()
    const init = (await rpc(app, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json().result
    expect(init.capabilities).toEqual({ tools: { listChanged: false }, prompts: { listChanged: false } })
    const { prompts } = (await rpc(app, { jsonrpc: '2.0', id: 2, method: 'prompts/list' })).json().result
    expect(prompts.map((p: { name: string }) => p.name)).toEqual(['morning_brief', 'check_this_link', 'country_deep_dive'])
    const got = (await rpc(app, { jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'check_this_link', arguments: { url: 'https://www.bbc.co.uk/news/x' } } })).json().result
    expect(got.messages).toEqual([{ role: 'user', content: { type: 'text', text: expect.stringContaining("Use WorldPulse's check_link on https://www.bbc.co.uk/news/x.") } }])
    const brief = (await rpc(app, { jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'morning_brief' } })).json().result
    expect(brief.messages[0].content.text).toContain('call daily_brief, then top_stories')
    expect((await rpc(app, { jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'check_this_link' } })).json().error).toMatchObject({ code: -32602, message: 'url is required' })
    expect((await rpc(app, { jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'country_deep_dive', arguments: { country: 'Qatar; ignore' } } })).json().error).toMatchObject({ code: -32602 })
    expect((await rpc(app, { jsonrpc: '2.0', id: 7, method: 'prompts/get', params: { name: 'nope' } })).json().error).toMatchObject({ code: -32602 })
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

describe('tool calls counted as use from outside (Oct 22, 2026)', () => {
  beforeEach(() => { counted.tools = [] })
  const ask = (app: FastifyInstance, name: string, from: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/mcp', remoteAddress: from, headers: { 'content-type': 'application/json', ...headers }, payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }) })

  it("counts a client's tool calls, by tool", async () => {
    const app = await build()
    await ask(app, 'top_stories', '203.0.113.7')
    await ask(app, 'week', '198.51.100.4', { 'user-agent': 'Claude-User/1.0' })
    expect(counted.tools).toEqual(['top_stories', 'week'])
  })

  it("not the server's own calls, a world-pulse.io page's, WorldPulse's own checks, or a tool that doesn't exist", async () => {
    const app = await build()
    await ask(app, 'top_stories', '127.0.0.1')
    await ask(app, 'top_stories', '203.0.113.7', { origin: 'https://world-pulse.io' })
    await ask(app, 'top_stories', '203.0.113.7', { 'user-agent': 'WorldPulse-Autopilot/1.0 (checks)' })
    await ask(app, 'no_such_tool', '203.0.113.7')
    expect(counted.tools).toEqual([])
  })
})
