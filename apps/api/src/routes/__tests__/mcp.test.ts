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
const OTHER_REPORT = '99999999-9999-4999-8999-999999999999'
const LONE_REPORT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NATO = { id: '5d5292fe23563321', type: 'organisation', canonical_name: 'NATO', aliases: ['North Atlantic Treaty Organization'], mention_count: 1010 }
const ANATOLIE = { id: '1959a1b94db30907', type: 'person', canonical_name: 'Anatolie Nosatîi', aliases: [], mention_count: 1 }
const NATO_PA = { id: '7c1e2d3f4a5b6c7d', type: 'organisation', canonical_name: 'NATO Parliamentary Assembly', aliases: [], mention_count: 40 }
const WORLD_REPORT = '55555555-5555-4555-8555-555555555555'
const SQUAWK_REPORT = '44444444-4444-4444-8444-444444444444'
const DAM_REPORT = '88888888-8888-4888-8888-888888888888'
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const days = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 10 + i)).toISOString().slice(0, 10), n: f(i) }))

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
    if (id === WORLD_REPORT) {
      asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
      return {
        success: true,
        data: {
          storyId: 'world-story', size: 9, outlets: 7, outletsAll: 90, verifiedAt: '2026-11-07T16:00:00.000Z', country: 'PL',
          firstReportAt: '2026-11-07T15:31:00.000Z', latestReportAt: hoursAgo(2),
          outletNames: ['aljazeera.com', 'bbc.co.uk', 'bbc.com', 'notesfrompoland.com', 'tass.com', 'tvpworld.com', 'unknown-site.example'],
          outletInfo: [
            { site: 'aljazeera.com', name: 'Al Jazeera', kind: 'international', country: 'QA', stateMedia: false },
            { site: 'bbc.co.uk', name: 'BBC', kind: 'international', country: 'GB', stateMedia: false },
            { site: 'bbc.com', name: 'BBC', kind: 'international', country: 'GB', stateMedia: false },
            { site: 'notesfrompoland.com', name: 'Notes from Poland', kind: 'national', country: 'PL', stateMedia: false },
            { site: 'tass.com', name: 'TASS', kind: 'agency', country: 'RU', stateMedia: true },
            { site: 'tvpworld.com', name: 'TVP World', kind: 'national', country: 'PL', stateMedia: true },
            { site: 'unknown-site.example', name: null, kind: 'unknown', country: null, stateMedia: false },
          ],
          signals: [
            { id: WORLD_REPORT, title: 'Six killed in Krakow shooting', status: 'verified', outlet: 'notesfrompoland.com', url: 'https://notesfrompoland.com/x', createdAt: '2026-11-07T15:31:00.000Z' },
            { id: '66666666-6666-4666-8666-666666666666', title: 'Gunman kills six in Polish city', status: 'verified', outlet: 'bbc.co.uk', url: 'https://www.bbc.co.uk/y', createdAt: '2026-11-07T15:40:00.000Z' },
            { id: '77777777-7777-4777-8777-777777777777', title: 'Shooting in Krakow: six dead', status: 'verified', outlet: 'tass.com', url: 'https://tass.com/z', createdAt: '2026-11-07T16:10:00.000Z' },
          ],
        },
      }
    }
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
    if (![STORY.leadId, STORY.id].includes((req.params as { id: string }).id)) return reply.code(404).send({ success: false, code: 'NOT_FOUND', error: 'Story not found' })
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
    const q = req.query as { status?: string; limit?: string; category?: string; country?: string }
    const st = q.status
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
    // the latest tool asks for 50, with no area
    if (q.limit === '50') {
      if (q.category === 'sports') return { success: true, data: { items: [], cursor: null, hasMore: false } }
      return {
        success: true,
        data: {
          items: [
            { id: OTHER_REPORT, title: 'Talks in Doha go on', status: 'verified', locationName: 'Doha', countryCode: 'QA', category: 'geopolitics', createdAt: ago(1) },
            { id: STORY.leadId, title: STORY.title, status: 'verified', locationName: 'Doha', countryCode: 'QA', category: 'geopolitics', createdAt: ago(2) },
            { id: LONE_REPORT, title: 'Trains collide near Cairo', status: 'verified', locationName: null, countryCode: 'EG', category: 'disaster', createdAt: ago(3) },
          ],
          cursor: null, hasMore: false,
        },
      }
    }
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
    return {
      success: true,
      data: {
        stories: {
          [STORY.leadId]: { storyId: STORY.id, size: 20, outlets: 14, outletsAll: 14, verified: true, countries: 9, canonicalId: STORY.leadId, firstReportAt: '2026-10-20T08:00:00.000Z' },
          [OTHER_REPORT]: { storyId: STORY.id, size: 20, outlets: 14, outletsAll: 14, verified: true, countries: 9, canonicalId: STORY.leadId },
          [LONE_REPORT]: { storyId: LONE_REPORT, size: 1, outlets: 1, outletsAll: 1, verified: false },
        },
      },
    }
  })
  app.get('/api/v1/knowledge-graph/entities', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const q = String((req.query as { search?: string }).search ?? '').toLowerCase()
    // as the API matches: the name contains it (any case), or one of its other names is it exactly; the most mentioned first
    const data = [NATO, NATO_PA, ANATOLIE].filter(e => e.canonical_name.toLowerCase().includes(q) || e.aliases.some(a => a.toLowerCase() === q))
    return { data, pagination: { total: data.length, limit: 8, offset: 0, has_more: false } }
  })
  app.get('/api/v1/knowledge-graph/entities/:id/profile', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const { id } = req.params as { id: string }
    if (id !== NATO.id) return reply.code(404).send({ error: 'Entity not found' })
    return {
      success: true,
      data: {
        entity: { id: NATO.id, type: 'organisation', name: 'NATO', firstSeen: '2026-04-26T15:25:17.423Z', lastSeen: '2026-11-08T16:27:44.575Z' },
        activity: { last24h: 10, previous24h: 21, last7d: 178, daily: days(30, i => (i >= 23 ? 30 : 10)) },
        stories: [STORY],
        latest: [],
        connections: [{ id: 'u1', type: 'location', name: 'Ukraine', shared: 25 }, { id: 'u2', type: 'location', name: 'United States', shared: 1 }],
      },
    }
  })
  app.get('/api/v1/countries/:code/daily', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const { code } = req.params as { code: string }
    const n = Number((req.query as { days?: string }).days) || 30
    return { success: true, data: { code, name: code, days: n, daily: days(n, i => (i === 5 ? 40 : i >= n - 7 ? 12 : 6)).map(d => ({ day: d.day, reports: d.n, verified: Math.floor(d.n / 3) })) } }
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
    const q = String((req.query as { q?: string }).q ?? '')
    if (q.includes('Atlantis')) return { success: true, semantic: true, results: [] }
    if (q.includes('dragon')) return { success: true, semantic: true, results: [{ id: LONE_REPORT, title: 'Dragon boat festival ends', status: 'pending', locationName: 'Basra', createdAt: '2026-10-19T09:00:00.000Z', score: 0.53 }] }
    if (q.includes('nine')) {
      return {
        success: true, semantic: true,
        results: [
          { id: STORY.leadId, title: 'Six people killed in attack', status: 'verified', locationName: 'Doha', createdAt: '2026-10-20T08:00:00.000Z', score: 0.9 },
          { id: OTHER_REPORT, title: 'Nine dead in attack', status: 'pending', locationName: 'Doha', createdAt: '2026-10-20T09:00:00.000Z', score: 0.88 },
          { id: LONE_REPORT, title: 'A different attack', status: 'pending', locationName: 'Basra', createdAt: '2026-10-19T09:00:00.000Z', score: 0.7 },
        ],
      }
    }
    return { success: true, semantic: true, results: [{ id: STORY.leadId, title: STORY.title, status: 'verified', locationName: 'Doha', createdAt: '2026-10-20T08:00:00.000Z', category: 'conflict', score: 0.61 }] }
  })
  app.get('/api/v1/breaking/alerts', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const until = new Date(Date.now() + 3_600_000).toISOString()
    return {
      success: true,
      data: {
        count: 5,
        alerts: [
          { alertId: 'a1', signalId: STORY.leadId, title: STORY.title, severity: 'critical', category: 'conflict', locationName: 'Doha', countryCode: 'QA', timestamp: hoursAgo(2), expiresAt: until },
          { alertId: 'a2', signalId: LONE_REPORT, title: 'Trains collide near Cairo', severity: 'high', category: 'disaster', locationName: 'Cairo', countryCode: 'EG', timestamp: hoursAgo(0.5), expiresAt: until },
          { alertId: 'a3', signalId: SQUAWK_REPORT, title: 'Aircraft FDX382 squawking 7500 — Unlawful interference (hijacking) (United States)', severity: 'high', category: 'security', locationName: 'United States', countryCode: null, timestamp: hoursAgo(0.2), expiresAt: until },
          { alertId: 'a4', signalId: STORY.leadId, title: STORY.title, severity: 'critical', category: 'conflict', locationName: 'Doha', countryCode: 'QA', timestamp: hoursAgo(3), expiresAt: until },
          { alertId: 'a5', signalId: OTHER_REPORT, title: 'An alert past its six hours', severity: 'high', category: 'disaster', locationName: 'Doha', countryCode: 'QA', timestamp: hoursAgo(7), expiresAt: hoursAgo(1) },
          // another report of the Doha story: the story once, as its newest alert
          { alertId: 'a6', signalId: OTHER_REPORT, title: 'Talks in Doha go on', severity: 'high', category: 'conflict', locationName: 'Doha', countryCode: 'QA', timestamp: hoursAgo(1), expiresAt: until },
          { alertId: 'a7', signalId: '12121212-1212-4212-8212-121212121212', title: 'Large wildfire detected near Western Australia, Australia', severity: 'high', category: 'disaster', locationName: 'Western Australia, Australia', countryCode: 'AU', timestamp: hoursAgo(0.3), expiresAt: until },
          { alertId: 'a8', signalId: '13131313-1313-4313-8313-131313131313', title: 'DAVID MARCUS: Where does the blue tsunami leave old school Dems?', severity: 'high', category: 'disaster', locationName: 'Pennsylvania', countryCode: 'US', timestamp: hoursAgo(0.4), expiresAt: until },
          { alertId: 'a9', signalId: '14141414-1414-4414-8414-141414141414', title: '[Aziz Huq] Utilizing US midterm tsunami', severity: 'high', category: 'disaster', locationName: 'United States', countryCode: 'US', timestamp: hoursAgo(0.45), expiresAt: until },
          { alertId: 'a10', signalId: DAM_REPORT, title: 'BREAKING: Dam bursts above Valencia', severity: 'critical', category: 'disaster', locationName: 'Valencia', countryCode: 'ES', timestamp: hoursAgo(0.1), expiresAt: until },
        ],
      },
    }
  })
  app.get('/api/v1/knowledge-graph/trending', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const type = (req.query as { type?: string }).type
    const rows = [
      { entity: { id: '4883865b2f6813ce', type: 'location', canonical_name: 'Egypt', signal_ids: [] }, recent_mentions: 113, previous_mentions: 31, daily_avg: 31, spike_ratio: 3.4, is_new: false },
      { entity: { id: '73bf81678b4cf07b', type: 'person', canonical_name: 'Javier Milei', signal_ids: [] }, recent_mentions: 57, previous_mentions: 11, daily_avg: 11, spike_ratio: 4.5, is_new: false },
      { entity: { id: 'aa00bb11cc22dd33', type: 'organisation', canonical_name: 'Aramco', signal_ids: [] }, recent_mentions: 12, previous_mentions: 0, daily_avg: 0, spike_ratio: null, is_new: true },
    ].filter(r => !type || r.entity.type === type)
    return { trending: rows, window_hours: 24, generated_at: '2026-11-08T23:00:00.000Z' }
  })
  app.get('/api/v1/signals/map/hotspots', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return {
      success: true,
      data: {
        hours: 24, minCategoryCount: 2, generatedAt: '2026-11-08T23:00:00.000Z',
        hotspots: [
          {
            cellLat: 30, cellLng: 31, centerLat: 30.0444, centerLng: 31.2357, place: 'Egypt', signalCount: 133, categoryCount: 3, categories: ['conflict', 'disaster', 'economy'],
            maxSeverity: 'critical', avgReliability: 0.86, latestSignalAt: hoursAgo(1 / 6),
            sampleTitles: ['Aircraft N857ER squawking 7700 — General emergency (Egypt)', 'Seven killed in train collision in Egypt', 'Trains collide near Cairo'],
            sampleIds: [SQUAWK_REPORT, STORY.leadId, LONE_REPORT],
          },
          {
            cellLat: 50, cellLng: 20, centerLat: 50.06, centerLng: 19.94, place: 'Krakow', signalCount: 113, categoryCount: 2, categories: ['conflict', 'security'],
            maxSeverity: 'high', avgReliability: 0.85, latestSignalAt: hoursAgo(1), sampleTitles: ['A shooting in Krakow killed 6'], sampleIds: ['not-a-report-id'],
          },
        ],
      },
    }
  })
  app.get('/api/v1/maritime/signals', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    if ((req.query as { type?: string }).type === 'sanctions') return { success: true, data: [], total: 0, limit: 30, offset: 0 }
    return {
      success: true, total: 2, limit: 30, offset: 0,
      data: [
        { id: LONE_REPORT, title: 'Tanker burns after strike in Strait of Hormuz', category: 'conflict', severity: 'high', reliability_score: 0.8, location_name: 'Strait of Hormuz', source_url: null, lat: 26.5, lng: 56.3, created_at: hoursAgo(3) },
        { id: STORY.leadId, title: 'Navy escorts a convoy through the strait', category: 'military', severity: 'medium', reliability_score: 0.8, location_name: 'Doha', source_url: null, lat: 25.3, lng: 51.5, created_at: hoursAgo(5) },
      ],
    }
  })
  app.get('/api/v1/hazards/map/points', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const p = (n: number, title: string, lat: number, lng: number, slug: string, severity: string, h: number) =>
      ({ id: `${String(n).repeat(8)}-0000-4000-8000-000000000000`, title, lat, lng, severity, category: 'disaster', source_slug: slug, published_at: hoursAgo(h), reliability_score: 0.95 })
    return {
      success: true, cached: false,
      data: {
        hours: 48, count: 6,
        points: [
          p(1, 'M 4.5 - 43 km E of Onagawa Chō, Japan', 38.38, 141.94, 'seismic', 'low', 3),
          p(2, 'M 6.2 - 120 km E of Miyako, Japan', 39.86, 143.53, 'seismic', 'high', 10),
          p(3, 'M 4.8 - central Mid-Atlantic Ridge', 7.7, -36.9, 'seismic', 'low', 1),
          p(4, 'Volcanic Alert — Kilauea: ADVISORY | Aviation: YELLOW', 19.42, -155.29, 'gvp-volcano', 'medium', 20),
          p(5, 'Large wildfire detected near Western Australia, Australia', -19.5, 124.5, 'firms', 'medium', 30),
          p(6, 'Major wildfire detected near Western Australia, Australia', -19.5, 123.5, 'firms', 'high', 40),
          // stored in the window, sent 100 hours ago
          p(7, 'Tsunami Alert: 75 miles SW of Eureka, California', 40.4, -125.2, 'tsunami-warnings', 'medium', 100),
        ],
      },
    }
  })
  app.get('/api/v1/signals/:id/verifications', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const { id } = req.params as { id: string }
    const items = id !== STORY.leadId ? [] : [
      { id: 'v2', verifierType: 'cross_check', checkType: 'cross_check', verdict: null, result: 'warning', confidence: 0.6, scoreDelta: null, notes: '[Claude] The outlets differ: one gives 60 injured, the others 100.', createdAt: '2026-11-08T23:40:00.000Z' },
      { id: 'v1', verifierType: 'cross_check', checkType: 'cross_check', verdict: null, result: 'confirmed', confidence: 0.9, scoreDelta: null, notes: '[Claude] All three reports describe the same talks.', createdAt: '2026-11-08T13:32:00.000Z' },
    ]
    return { success: true, data: { items, total: items.length, page: 1, limit: 20 } }
  })
  app.get('/api/v1/signals/map/conflict-zones', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const f = (id: string | null, title: string, severity: string, place: string | null, h: number) =>
      ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id, title, severity, category: 'conflict', reliability_score: 0.7, source_name: place, published_at: hoursAgo(h) } })
    return {
      type: 'FeatureCollection',
      features: [
        f(STORY.leadId, 'Strikes reported in Gaza City', 'high', 'Gaza', 5),
        f(LONE_REPORT, 'Shelling near Khan Younis', 'critical', 'Gaza', 1),
        f(null, 'Gaza ceasefire talks stall', 'medium', 'Gaza', 9),
        f(OTHER_REPORT, 'Drones hit Kyiv overnight', 'high', 'Kyiv', 2),
        f(null, 'Air raid alert in Kyiv', 'high', 'Kyiv', 4),
        f(null, 'Iran warns of response', 'medium', 'Tehran', 6),
        // newer, but an opinion piece: not the place's newest headline
        f(null, 'The Unavoidable War – OpEd', 'medium', 'Tehran', 0.5),
        f(null, 'Troops move at sea', 'medium', null, 3),
      ],
    }
  })
  app.get('/api/v1/outages/recent', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return {
      success: true, cached: false,
      data: {
        hours: 72, count: 2,
        events: [
          { id: '21212121-2121-4121-8121-212121212121', title: 'Internet outage in Iran', summary: 'IODA saw routing drop by 40%. It had not recovered by 21:00 UTC.', severity: 'high', category: 'technology', country_code: 'IR', location_name: 'Iran', published_at: hoursAgo(3) },
          { id: '23232323-2323-4323-8323-232323232323', title: 'Internet outage in Cuba', summary: null, severity: 'medium', category: 'technology', country_code: 'CU', location_name: 'Cuba', published_at: hoursAgo(30) },
        ],
      },
    }
  })
  app.get('/api/v1/knowledge-graph/entities/:id/with/:other', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const { id, other } = req.params as { id: string; other: string }
    if (id !== NATO.id || other !== NATO_PA.id) return reply.code(404).send({ error: 'Entity not found' })
    return {
      success: true,
      data: {
        stories: [STORY],
        latest: [
          { id: LONE_REPORT, title: 'NATO assembly meets in Dayton', category: 'geopolitics', severity: 'low', place: 'Dayton, United States', verified: false, createdAt: hoursAgo(5) },
          { id: 'not-a-uuid', title: 'Dropped: no report id', createdAt: hoursAgo(6) },
        ],
      },
    }
  })
  app.get('/api/v1/map/topics/:topic', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const { topic } = req.params as { topic: string }
    const f = (id: string, title: string, severity: string, place: string | null, h: number) =>
      ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id, title, place, severity, created_at: hoursAgo(h) } })
    if (topic === 'protests') {
      return {
        success: true, cached: true, topic, hours: 48, type: 'FeatureCollection',
        features: [
          f(STORY.leadId, 'Police fire tear gas at protesters in Nairobi', 'high', 'Nairobi, Kenya', 3),
          f(OTHER_REPORT, 'Teachers strike for a second day', 'medium', 'Nairobi', 10),
          f(LONE_REPORT, 'Farmers protest in Niamey', 'medium', 'Niamey, Niger', 2),
          f('12121212-1212-4121-8121-121212121212', 'Protesters rally against fuel prices in Lagos', 'critical', 'Lagos, Nigeria', 20),
          f('not-a-uuid', 'Dropped: no report id', 'high', 'Paris, France', 1),
        ],
      }
    }
    if (topic === 'outbreaks' || topic === 'displacement') return { success: true, cached: true, topic, hours: 72, type: 'FeatureCollection', features: [] }
    return reply.code(404).send({ success: false, error: 'Unknown topic' })
  })
  await app.register(registerMcpRoutes, { prefix: '/mcp' })
  return app
}

const rpc =(app: FastifyInstance, body: unknown) =>
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

  it('lists fourteen read-only tools with their input schemas', async () => {
    const app = await build()
    const { tools } = (await rpc(app, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).json().result
    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      'top_stories', 'story', 'search_reports', 'week', 'check_link', 'under_reported',
      'story_numbers', 'outlet', 'near', 'country', 'daily_brief', 'entity', 'trend', 'check_claim',
      'breaking', 'trending', 'hotspots', 'story_by_country', 'shipping', 'hazards',
      'latest', 'how_verified', 'story_timeline', 'conflicts', 'internet_outages',
      'connections', 'protests', 'outbreaks', 'displacement', 'who_covers',
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

  it('entity finds a person, organisation or place by name and gives its stories and company (Nov 8, 2026)', async () => {
    const app = await build()
    const r = await call(app, 'entity', { name: 'nato' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/knowledge-graph/entities?search=nato&limit=20&sort=mention_count&lean=1', `/api/v1/knowledge-graph/entities/${NATO.id}/profile`])
    expect(r.isError).toBe(false)
    expect(r.content[0].text).toContain(`NATO (organisation). Page: https://world-pulse.io/entities/nato-${NATO.id}`)
    expect(r.content[0].text).toContain('Reports naming it: 10 in the last 24 hours (21 the day before), 178 in the last 7 days.')
    expect(r.content[0].text).toContain('1. Ceasefire talks resume in Doha')
    expect(r.content[0].text).toContain('In the news with: Ukraine (25 reports together), United States (1 report together)')
    // the other matches with the name as a whole word, not the names that only contain its letters
    expect(r.content[0].text).toContain(`Other matches for "nato": NATO Parliamentary Assembly (organisation, id ${NATO_PA.id})`)
    expect(r.content[0].text).not.toContain('Anatolie')
    expect((r.structuredContent as { otherMatches: unknown[] }).otherMatches).toEqual([{ id: NATO_PA.id, type: 'organisation', name: 'NATO Parliamentary Assembly', mentions: 40 }])
    expect(r.structuredContent).toMatchObject({ entity: { id: NATO.id, name: 'NATO' }, activity: { last7d: 178 } })
    // its other name, exactly, and by id
    asked = []
    await call(app, 'entity', { name: 'North Atlantic Treaty Organization' })
    expect(asked[1]!.url).toBe(`/api/v1/knowledge-graph/entities/${NATO.id}/profile`)
    asked = []
    expect((await call(app, 'entity', { id: NATO.id })).isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual([`/api/v1/knowledge-graph/entities/${NATO.id}/profile`])
    // a whole word of a name when nothing is named exactly so
    asked = []
    await call(app, 'entity', { name: 'Nosatîi' })
    expect(asked[1]!.url).toBe(`/api/v1/knowledge-graph/entities/${ANATOLIE.id}/profile`)
    expect(await call(app, 'entity', { name: 'Zzyzx' })).toMatchObject({ isError: true, content: [{ text: 'No person, organisation or place named "Zzyzx" in WorldPulse\'s reports' }] })
    expect((await call(app, 'entity', {})).isError).toBe(true)
  })

  it("trend gives a country's or an entity's coverage day by day, the last 7 days against the 7 before", async () => {
    const app = await build()
    const r = await call(app, 'trend', { country: 'sd', days: 14 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/countries/SD/daily?days=14'])
    expect(r.content[0].text).toContain('Coverage of Sudan on WorldPulse, the last 14 days (reports a day, UTC). Page: https://world-pulse.io/countries/sd')
    // days 0-6: 6 each but day 5 (40); days 7-13: 12 each
    expect(r.content[0].text).toContain('Total: 160 reports (53 verified). The last 7 days: 84; the 7 before: 76 (+11%). Busiest day: Oct 15 (40).')
    expect(r.content[0].text).toContain('By week: Oct 10–Oct 16: 76 · Oct 17–Oct 23: 84')
    expect(r.content[0].text).toContain('The last 7 days: Oct 17: 12 · Oct 18: 12')
    expect(r.structuredContent).toMatchObject({ subject: 'Sudan', kind: 'country', total: 160, last7: 84, previous7: 76 })
    asked = []
    const n = await call(app, 'trend', { name: 'NATO' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/knowledge-graph/entities?search=NATO&limit=20&sort=mention_count&lean=1', `/api/v1/knowledge-graph/entities/${NATO.id}/profile`])
    expect(n.content[0].text).toContain('Coverage of NATO on WorldPulse, the last 30 days')
    expect(n.content[0].text).toContain('The last 7 days: 210; the 7 before: 70 (+200%).')
    expect((await call(app, 'trend', {})).isError).toBe(true)
    expect((await call(app, 'trend', { country: 'SD', name: 'NATO' })).isError).toBe(true)
    expect((await call(app, 'trend', { country: 'XX' })).isError).toBe(true)
  })

  it('check_claim gives the closest stories once each with their counts, and the numbers of the closest; it rules nothing', async () => {
    const app = await build()
    const r = await call(app, 'check_claim', { claim: 'nine people were killed in the Doha attack' })
    expect(asked.map(a => a.url)).toEqual([
      '/api/v1/search/semantic?q=nine%20people%20were%20killed%20in%20the%20Doha%20attack&limit=10',
      `/api/v1/stories/outlets?ids=${STORY.leadId},${OTHER_REPORT},${LONE_REPORT}`,
      `/api/v1/stories/${STORY.id}/figures`,
    ])
    const text = r.content[0].text as string
    expect(text).toContain('WorldPulse does not rule claims true or false')
    // the story once (its closest report), then the other story
    expect(text).toContain(`1. Six people killed in attack (Doha)
   Verified · 14 outlets in 9 countries · reported since Oct 20
   https://world-pulse.io/signals/${STORY.leadId}`)
    expect(text).not.toContain('Nine dead in attack')
    expect(text).toContain('2. A different attack (Basra)\n   Only one outlet so far: unconfirmed')
    expect(text).toContain('Killed: 6 (50 outlets: 1news.co.nz, aljazeera.com, aol.co.uk, …) · 9 (3 outlets: gdnonline.com, smh.com.au, upi.com)')
    expect(r.structuredContent.stories).toHaveLength(2)
    expect(r.structuredContent).toMatchObject({ close: true })
    const none = await call(app, 'check_claim', { claim: 'Atlantis rose from the sea' })
    expect(none.content[0].text).toMatch(/That is not evidence the claim is false/)
    // nothing close (a made-up claim's nearest reports are about 0.55 alike): the nearest, said to be about something else, without numbers
    asked = []
    const far = await call(app, 'check_claim', { claim: 'a dragon flew over the city hall' })
    expect(far.content[0].text).toContain('Nothing WorldPulse holds is close to this claim. The nearest stories are below, probably about something else.')
    expect(far.content[0].text).toContain('1. Dragon boat festival ends (Basra)')
    expect(far.content[0].text).not.toContain('The numbers')
    expect(far.structuredContent).toMatchObject({ close: false, figures: null })
    expect(asked.some(a => a.url.includes('/figures'))).toBe(false)
    expect((await call(app, 'check_claim', { claim: 'no' })).isError).toBe(true)
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

describe('MCP server: the six tools of Nov 8, 2026, evening (twenty in all)', () => {
  beforeEach(() => { asked = [] })

  it('breaking gives the live news alerts newest first, each story once, with its count; never alarms, sensor readings or opinion', async () => {
    const app = await build()
    const r = await call(app, 'breaking')
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/breaking/alerts', `/api/v1/stories/outlets?ids=${DAM_REPORT},${LONE_REPORT},${OTHER_REPORT},${STORY.leadId}`])
    const text = r.content[0].text as string
    expect(text.split('\n')[0]).toBe('Breaking: the critical and high-severity news reports of the last few hours, newest first:')
    expect(text).toContain(`1. BREAKING: Dam bursts above Valencia\n   Critical · disaster · Valencia · 6m ago · Only one outlet so far: unconfirmed\n   https://world-pulse.io/signals/${DAM_REPORT}`)
    expect(text).toContain('2. Trains collide near Cairo\n   High · disaster · Cairo · 30m ago · Only one outlet so far: unconfirmed')
    // the Doha story once, as its newest alert, linked to the story's page
    expect(text).toContain(`3. Talks in Doha go on\n   High · conflict · Doha · 1h ago · Verified · 14 outlets in 9 countries\n   https://world-pulse.io/signals/${STORY.leadId}`)
    expect(text).not.toContain('Ceasefire talks')
    for (const gone of ['FDX382', 'past its six hours', 'wildfire', 'DAVID MARCUS', 'Aziz Huq']) expect(text).not.toContain(gone)
    expect(r.structuredContent).toMatchObject({ alerts: [{ reportId: DAM_REPORT }, { reportId: LONE_REPORT, storyOutlets: 1, verified: false }, { reportId: OTHER_REPORT, storyOutlets: 14, verified: true }] })
    expect((await call(app, 'breaking', { limit: 1 })).structuredContent.alerts).toHaveLength(1)
  })

  it('trending asks the website\'s own question and gives each name\'s reports in both days, its page and its id', async () => {
    const app = await build()
    const r = await call(app, 'trending')
    expect(asked[0]!.url).toBe('/api/v1/knowledge-graph/trending?limit=10&window_hours=24&lean=1')
    const text = r.content[0].text as string
    expect(text).toContain('1. Egypt (place): 113 reports (31 the 24 hours before)\n   https://world-pulse.io/entities/egypt-4883865b2f6813ce (id 4883865b2f6813ce)')
    expect(text).toContain('3. Aramco (organisation): 12 reports (0 the 24 hours before) · new in the news')
    expect(r.structuredContent.entities[1]).toEqual({ id: '73bf81678b4cf07b', type: 'person', name: 'Javier Milei', url: 'https://world-pulse.io/entities/javier-milei-73bf81678b4cf07b', reports24h: 57, reportsDayBefore: 11, newInTheNews: false })
    asked = []
    const people = await call(app, 'trending', { type: 'person' })
    expect(asked[0]!.url).toBe('/api/v1/knowledge-graph/trending?limit=10&window_hours=24&lean=1&type=person')
    expect(people.content[0].text).toContain('(people only)')
    expect(people.content[0].text).not.toContain('Egypt')
    asked = []
    await call(app, 'trending', { type: 'place' })
    expect(asked[0]!.url).toContain('&type=location')
    expect((await call(app, 'trending', { type: 'weapon' })).isError).toBe(true)
  })

  it('hotspots gives the places where reports of several kinds meet, two headlines each and a map link', async () => {
    const app = await build()
    const r = await call(app, 'hotspots')
    expect(asked.map(a => a.url)).toEqual(['/api/v1/signals/map/hotspots?hours=24&min_categories=2&limit=25'])
    const text = r.content[0].text as string
    expect(text).toContain('1. Egypt: 133 reports, 3 kinds (conflict, disaster, economy), worst critical · latest 10m ago')
    expect(text).toContain(`   "Seven killed in train collision in Egypt" https://world-pulse.io/signals/${STORY.leadId}`)
    expect(text).toContain(`   "Trains collide near Cairo" https://world-pulse.io/signals/${LONE_REPORT}`)
    expect(text).not.toContain('squawking')
    expect(text).toContain('   Map: https://world-pulse.io/map?lat=30.04&lng=31.24&z=6')
    // a headline whose id isn't a report's has no link
    expect(text).toContain('   "A shooting in Krakow killed 6"\n   Map:')
    expect((await call(app, 'hotspots', { limit: 1 })).structuredContent.hotspots).toHaveLength(1)
  })

  it('story_by_country puts the story\'s own country first, marks state media and gives each country a headline', async () => {
    const app = await build()
    const r = await call(app, 'story_by_country', { id: WORLD_REPORT })
    expect(asked[0]!.url).toBe(`/api/v1/stories/${WORLD_REPORT}`)
    const text = r.content[0].text as string
    expect(text).toContain(`Verified · 7 outlets in its last two days, from 4 countries (and 1 website the outlet directory doesn't place). Page: https://world-pulse.io/signals/${WORLD_REPORT}`)
    expect(text).toContain('Poland (where the story is): 2 outlets · Notes from Poland, TVP World (state media)\n   "Six killed in Krakow shooting" (Notes from Poland)')
    expect(text).toContain('Russia: 1 outlet · TASS (state media)\n   "Shooting in Krakow: six dead" (TASS)')
    expect(text).toContain('United Kingdom: 2 outlets · BBC (2 websites)\n   "Gunman kills six in Polish city" (BBC)')
    // Qatar's outlet has no report of its own in the story: no headline
    expect(text).toContain('Qatar: 1 outlet · Al Jazeera\nRussia')
    expect(text.indexOf('Poland')).toBeLessThan(text.indexOf('United Kingdom'))
    expect(text.indexOf('United Kingdom')).toBeLessThan(text.indexOf('Qatar'))
    expect(text).toContain('Not placed: unknown-site.example')
    expect(r.structuredContent.countries[0]).toMatchObject({ code: 'PL', ownCountry: true, outlets: 2, stateMedia: ['TVP World'] })
    const two = await call(app, 'story_by_country', { id: WORLD_REPORT, limit: 2 })
    expect(two.content[0].text).toContain('… and 2 more countries (limit takes up to 40).')
    expect((await call(app, 'story_by_country', { id: 'nope' })).isError).toBe(true)
    expect((await call(app, 'story_by_country', { id: '99999999-0000-4000-8000-000000000000' })).isError).toBe(true)
  })

  it('shipping gives the sea\'s reports, near a chokepoint when asked, each with its story\'s count', async () => {
    const app = await build()
    const r = await call(app, 'shipping', { chokepoint: 'hormuz' })
    expect(asked.map(a => a.url)).toEqual([
      '/api/v1/maritime/signals?type=all&limit=30&near=26.57,56.25&radius=500',
      `/api/v1/stories/outlets?ids=${LONE_REPORT},${STORY.leadId}`,
    ])
    const text = r.content[0].text as string
    expect(text).toContain('Ships, ports, straits and navies, the last 7 days, newest first, within 500 km of the Strait of Hormuz:')
    expect(text).toContain('1. Tanker burns after strike in Strait of Hormuz\n   Only one outlet so far: unconfirmed · Strait of Hormuz · 3h ago')
    expect(text).toContain(`2. Navy escorts a convoy through the strait\n   Verified · 14 outlets in 9 countries · Doha · 5h ago\n   https://world-pulse.io/signals/${STORY.leadId}`)
    expect(text).not.toContain('chokepoints: suez')
    expect(r.structuredContent.chokepoint).toEqual({ id: 'hormuz', name: 'Strait of Hormuz', latitude: 26.57, longitude: 56.25, radiusKm: 500 })
    // by its name too, and "Bab el-Mandeb" without "the"
    expect((await call(app, 'shipping', { chokepoint: 'Strait of Hormuz' })).isError).toBe(false)
    expect((await call(app, 'shipping', { chokepoint: 'bab-el-mandeb' })).content[0].text).toContain('within 500 km of Bab el-Mandeb:')
    const all = await call(app, 'shipping')
    expect(all.content[0].text).toContain('chokepoints: suez, panama, hormuz')
    const none = await call(app, 'shipping', { type: 'sanctions' })
    expect(none.content[0].text).toBe('No report about ships, ports or navies in the last 7 days (sanctions). Maritime page: https://world-pulse.io/maritime')
    expect((await call(app, 'shipping', { chokepoint: 'atlantis' })).content[0].text).toContain('chokepoint must be one of suez, panama, hormuz')
  })

  it('hazards counts each kind with its source, the strongest earthquakes and largest fires first, near a place when asked', async () => {
    const app = await build()
    const r = await call(app, 'hazards')
    expect(asked.map(a => a.url)).toEqual(['/api/v1/hazards/map/points?hours=48'])
    const text = r.content[0].text as string
    expect(text).toContain('Natural hazards, the last 48 hours: 3 earthquakes of magnitude 4.5 or more (USGS), 1 volcano alert (USGS, US volcanoes), 0 tsunami messages (NOAA\'s tsunami warning centres), 2 large wildfires (NASA FIRMS, seen by satellite).')
    expect(text).toContain('Earthquakes of magnitude 4.5 or more, the strongest first:\n1. M 6.2 - 120 km E of Miyako, Japan · 10h ago')
    expect(text).toContain('2. M 4.8 - central Mid-Atlantic Ridge · 1h ago')
    expect(text).toContain('Large wildfires, the largest first:\n1. Major wildfire detected near Western Australia, Australia · 40h ago · at -19.5, 123.5')
    expect(text).not.toContain('Tsunami messages,')
    expect(r.structuredContent.kinds[0].items[0]).toMatchObject({ magnitude: 6.2, latitude: 39.86 })
    const strong = await call(app, 'hazards', { kind: 'earthquake', min_magnitude: 5 })
    expect(strong.content[0].text).toContain('Natural hazards, the last 48 hours: 1 earthquake of magnitude 5 or more (USGS).')
    expect(strong.content[0].text).not.toContain('Onagawa')
    const japan = await call(app, 'hazards', { latitude: 38.3, longitude: 141.9, radius_km: 300 })
    expect(japan.content[0].text).toContain('Natural hazards, the last 48 hours within 300 km of 38.30, 141.90: 2 earthquakes')
    expect(japan.content[0].text).toMatch(/Onagawa Chō, Japan · 3h ago · \d+ km away/)
    expect(japan.content[0].text).not.toContain('Kilauea')
    expect((await call(app, 'hazards', { latitude: 38.3 })).content[0].text).toBe('Give latitude and longitude together')
    expect((await call(app, 'hazards', { hours: 168 })).content[0].text).toContain('1 tsunami message (NOAA\'s tsunami warning centres)')
    expect((await call(app, 'hazards', { kind: 'meteor' })).isError).toBe(true)
  })
})

describe('MCP server: the five tools of Nov 8, 2026, 9 PM (twenty-five in all)', () => {
  beforeEach(() => { asked = [] })

  it('latest gives the newest verified reports, each story once, of one subject or country when asked', async () => {
    const app = await build()
    const r = await call(app, 'latest')
    expect(asked.map(a => a.url)).toEqual(['/api/v1/signals?status=verified&limit=50', `/api/v1/stories/outlets?ids=${OTHER_REPORT},${STORY.leadId},${LONE_REPORT}`])
    const text = r.content[0].text as string
    expect(text).toContain(`1. Talks in Doha go on\n   1h ago · Doha · Verified · 14 outlets in 9 countries\n   https://world-pulse.io/signals/${STORY.leadId}`)
    expect(text).toContain('2. Trains collide near Cairo\n   3h ago · Egypt · Only one outlet so far: unconfirmed')
    expect(text).not.toContain('Ceasefire talks')
    asked = []
    await call(app, 'latest', { category: 'Geopolitics', country: 'qa', limit: 1 })
    expect(asked[0]!.url).toBe('/api/v1/signals?status=verified&limit=50&category=geopolitics&country=QA')
    expect((await call(app, 'latest', { category: 'sports' })).content[0].text).toBe('No verified report about sports lately. https://world-pulse.io')
    expect((await call(app, 'latest', { category: 'gossip' })).content[0].text).toContain('category must be one of conflict, geopolitics')
  })

  it('how_verified gives the story\'s count, then each comparison of what its outlets report, from its page when the report has none', async () => {
    const app = await build()
    const r = await call(app, 'how_verified', { id: OTHER_REPORT })
    expect(asked.map(a => a.url)).toEqual([
      `/api/v1/stories/outlets?ids=${OTHER_REPORT}`, `/api/v1/signals/${OTHER_REPORT}/verifications?limit=20`, `/api/v1/signals/${STORY.leadId}/verifications?limit=20`,
    ])
    const text = r.content[0].text as string
    expect(text).toContain(`Verified · 14 outlets in 9 countries. Page: https://world-pulse.io/signals/${STORY.leadId}`)
    expect(text).toContain('1. An AI model compared the outlets\' reports (2026-11-08 23:40 UTC): the outlets differ (confidence 0.6). "The outlets differ: one gives 60 injured, the others 100."')
    expect(text).toContain('2. An AI model compared the outlets\' reports (2026-11-08 13:32 UTC): the outlets agree (confidence 0.9). "All three reports describe the same talks."')
    expect(text).not.toContain('[Claude]')
    expect(r.structuredContent.checks[0]).toEqual({ kind: 'outlets compared by an AI model', result: 'warning', confidence: 0.6, note: 'The outlets differ: one gives 60 injured, the others 100.', at: '2026-11-08T23:40:00.000Z' })
    const lone = await call(app, 'how_verified', { id: LONE_REPORT })
    expect(lone.content[0].text).toContain('Only one outlet so far: unconfirmed. Page:')
    expect(lone.content[0].text).toContain('No check recorded on it yet')
    expect((await call(app, 'how_verified', { id: '99999999-0000-4000-8000-000000000000' })).content[0].text).toBe('No story or report with that id')
  })

  it('story_timeline gives who reported first, the next outlets with their minutes, and how long verification took', async () => {
    const app = await build()
    const r = await call(app, 'story_timeline', { id: WORLD_REPORT })
    const text = r.content[0].text as string
    expect(text).toContain('First reported 2026-11-07 15:31 UTC by Notes from Poland: "Six killed in Krakow shooting"')
    expect(text).toContain('Verified 2026-11-07 16:00 UTC, 29 min after the first report.')
    expect(text).toContain(`Since: 90 outlets in all, 9 reports, the latest 2h ago. Page: https://world-pulse.io/signals/${WORLD_REPORT}`)
    expect(text).toContain('1. Notes from Poland (first): "Six killed in Krakow shooting"\n2. BBC (+9 min): "Gunman kills six in Polish city"\n3. TASS (+39 min): "Shooting in Krakow: six dead"')
    expect(r.structuredContent).toMatchObject({ minutesToVerified: 29, outletsAll: 90, firstOutlets: [{ outlet: 'Notes from Poland' }, { outlet: 'BBC' }, { outlet: 'TASS' }] })
    expect((await call(app, 'story_timeline', { id: '99999999-0000-4000-8000-000000000000' })).isError).toBe(true)
  })

  it('conflicts groups the 72 hours\' conflict and military reports by place, the most first, with the newest headline', async () => {
    const app = await build()
    const r = await call(app, 'conflicts')
    expect(asked.map(a => a.url)).toEqual(['/api/v1/signals/map/conflict-zones'])
    const text = r.content[0].text as string
    expect(text).toContain('(8 reports in 3 places)')
    expect(text).toContain(`1. Gaza: 3 reports, worst critical\n   Newest: "Shelling near Khan Younis" (1h ago) https://world-pulse.io/signals/${LONE_REPORT}`)
    expect(text).toContain(`2. Kyiv: 2 reports, worst high\n   Newest: "Drones hit Kyiv overnight" (2h ago) https://world-pulse.io/signals/${OTHER_REPORT}`)
    expect(text).toContain('3. Tehran: 2 reports, worst medium\n   Newest: "Iran warns of response" (6h ago)\n')
    expect(text).toContain('These count reports, not attacks.')
    expect((await call(app, 'conflicts', { limit: 1 })).structuredContent.places).toHaveLength(1)
  })

  it('internet_outages gives IODA\'s outages newest first, of one country when asked', async () => {
    const app = await build()
    const r = await call(app, 'internet_outages')
    expect(asked.map(a => a.url)).toEqual(['/api/v1/outages/recent?hours=72&limit=100'])
    const text = r.content[0].text as string
    expect(text).toContain('Internet outages in the last 72 hours, newest first (from IODA, Georgia Tech):')
    expect(text).toContain('1. Internet outage in Iran\n   High · Iran · 3h ago\n   IODA saw routing drop by 40%.\n   https://world-pulse.io/signals/21212121-2121-4121-8121-212121212121')
    expect(text).toContain('2. Internet outage in Cuba\n   Medium · Cuba · 30h ago\n   https://world-pulse.io/signals/23232323')
    const cuba = await call(app, 'internet_outages', { country: 'cu', hours: 48 })
    expect(asked.at(-1)!.url).toBe('/api/v1/outages/recent?hours=48&limit=100')
    expect(cuba.content[0].text).toContain('Internet outages in Cuba in the last 48 hours')
    expect(cuba.content[0].text).not.toContain('Iran')
    expect((await call(app, 'internet_outages', { country: 'DE' })).content[0].text).toBe('No internet outage reported in Germany in the last 72 hours (IODA: routing, probing and telescope signals).')
  })
})

describe('MCP server: the five tools of Nov 9, 2026 (thirty in all)', () => {
  beforeEach(() => { asked = [] })

  it('connections lists who and what an entity is named with, most reports together first', async () => {
    const app = await build()
    const r = await call(app, 'connections', { name: 'NATO', limit: 5 })
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual([
      '/api/v1/knowledge-graph/entities?search=NATO&limit=20&sort=mention_count&lean=1',
      `/api/v1/knowledge-graph/entities/${NATO.id}/profile`,
    ])
    const text = r.content[0].text as string
    expect(text).toContain('Who and what NATO (organisation) is named with in WorldPulse\'s reports, the last 30 days')
    expect(text).toContain('1. Ukraine (location): 25 reports together · https://world-pulse.io/entities/ukraine-u1')
    expect(text).toContain('2. United States (location): 1 report together')
    expect(text).toContain('not a tie between them')
    expect(r.structuredContent.namedWith[0]).toEqual({ id: 'u1', type: 'location', name: 'Ukraine', reportsTogether: 25, url: 'https://world-pulse.io/entities/ukraine-u1' })
  })

  it('connections with a second name gives the stories and newest reports naming both', async () => {
    const app = await build()
    const r = await call(app, 'connections', { name: 'NATO', with: 'NATO Parliamentary Assembly' })
    expect(r.isError).toBe(false)
    expect(asked.at(-1)!.url).toBe(`/api/v1/knowledge-graph/entities/${NATO.id}/with/${NATO_PA.id}`)
    const text = r.content[0].text as string
    expect(text).toContain('NATO and NATO Parliamentary Assembly in the same reports (of the newest 100 naming each, the last 30 days):')
    expect(text).toContain('1. Ceasefire talks resume in Doha\n   Verified · 14 outlets')
    expect(text).toContain(`1. NATO assembly meets in Dayton\n   Not verified yet · Dayton, United States · 5h ago\n   https://world-pulse.io/signals/${LONE_REPORT}`)
    expect(text).not.toContain('Dropped')
    expect(r.structuredContent.stories[0]).toMatchObject({ id: STORY.id, outlets: 14 })
    expect(r.structuredContent.latest).toHaveLength(1)
    // the same entity twice, and a name nobody has
    expect((await call(app, 'connections', { name: 'NATO', with: 'North Atlantic Treaty Organization' })).content[0].text).toContain('give two different names')
    const none = await call(app, 'connections', { name: 'NATO', with: 'Zanzibar Hydrofoil Society' })
    expect(none.isError).toBe(true)
    expect(none.content[0].text).toContain('No person, organisation or place named "Zanzibar Hydrofoil Society"')
  })

  it('protests gives the layer\'s reports place by place, the most first, with the newest story\'s outlets', async () => {
    const app = await build()
    const r = await call(app, 'protests')
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/map/topics/protests', expect.stringMatching(/^\/api\/v1\/stories\/outlets\?ids=/)])
    const text = r.content[0].text as string
    expect(text).toContain('Protests and unrest in the last 48 hours: 4 reports in 3 places, the most reports first:')
    expect(text).toContain(`1. Nairobi, Kenya: 2 reports, worst high\n   Newest: "Police fire tear gas at protesters in Nairobi" (3h ago · Verified · 14 outlets in 9 countries)\n   https://world-pulse.io/signals/${STORY.leadId}`)
    // two places with one report each: the worse first
    expect(text.indexOf('Lagos, Nigeria')).toBeLessThan(text.indexOf('Niamey, Niger'))
    expect(text).toContain('Only one outlet so far: unconfirmed')
    expect(text).not.toContain('Dropped')
    expect(r.structuredContent).toMatchObject({ topic: 'protests', hours: 48, reports: 4, placesFound: 3 })
    expect(r.structuredContent.places[0]).toMatchObject({ place: 'Nairobi, Kenya', reports: 2, worstSeverity: 'high', newest: { id: STORY.leadId, outlets: 14, verified: true } })
    // a place as a whole word: Niger is not Nigeria
    const niger = await call(app, 'protests', { place: 'niger' })
    expect(niger.structuredContent.places.map((p: { place: string }) => p.place)).toEqual(['Niamey, Niger'])
  })

  it('outbreaks and displacement say when their layer has nothing', async () => {
    const app = await build()
    const r = await call(app, 'outbreaks', { place: 'Sudan' })
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/map/topics/outbreaks'])
    expect(r.content[0].text).toContain('No outbreak report naming Sudan in the last 72 hours on WorldPulse\'s map.')
    expect((await call(app, 'displacement')).content[0].text).toContain('No report of refugees or displacement in the last 72 hours')
    expect((await call(app, 'displacement', { limit: 50 })).isError).toBe(true)
  })

  it('who_covers lists the newsrooms WorldPulse reads in a country, from the outlet directory', async () => {
    const app = await build()
    const r = await call(app, 'who_covers', { country: 'gl' })
    expect(r.isError).toBe(false)
    expect(asked).toEqual([])
    const text = r.content[0].text as string
    expect(text).toContain('WorldPulse reads 2 newsrooms based in Greenland:')
    expect(text).toContain('Sermitsiaq.AG (sermitsiaq.ag): national, in Danish')
    expect(text).toContain('state media (a government runs it)')
    expect(text).toContain('Thinly covered: 2 newsrooms of its own')
    expect(r.structuredContent).toMatchObject({ country: 'GL', name: 'Greenland', thin: true, url: 'https://world-pulse.io/countries/gl' })
    // an outlet seen only in GDELT's articles is listed apart
    const gb = await call(app, 'who_covers', { country: 'uk' })
    expect(gb.structuredContent.country).toBe('GB')
    expect(gb.structuredContent.seenInGdelt.map((n: { name: string }) => n.name)).toContain('Reuters')
    expect(gb.structuredContent.newsrooms.map((n: { name: string }) => n.name)).not.toContain('Reuters')
    expect(gb.structuredContent.thin).toBe(false)
    expect((await call(app, 'who_covers', { country: 'AQ' })).content[0].text).toContain('WorldPulse reads no newsroom based in Antarctica')
    expect((await call(app, 'who_covers', { country: 'XX' })).isError).toBe(true)
  })
})
