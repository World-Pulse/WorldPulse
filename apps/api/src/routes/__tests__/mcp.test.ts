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

import { registerMcpRoutes, PROTOCOL_VERSIONS, DAY_WAIT, TOOL_SETS } from '../mcp'
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
const JUST_VERIFIED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FRENCH_REPORT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ARABIC_REPORT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CRIT_REPORT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDIUM_REPORT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
let dayAsks = 0
/** More of the 20 biggest stories (local_press): from 10 or more countries, with few or many outlets from home */
const story = (n: number, over: Record<string, unknown>) => ({
  ...STORY, id: `00000000-0000-4000-8000-00000000000${n}`, leadId: `00000000-0000-4000-8000-0000000000${10 + n}`, ...over,
})
const MORE_STORIES = [
  story(1, { title: 'Migrant boats capsize off Senegal and Greece', country: 'SN', countries: 28, localOutlets: 0, localNames: [], outletCount: 44 }),
  story(2, { title: 'Trump says the Iran war is effectively over', country: 'IR', countries: 36, localOutlets: 1, localNames: ['IranWire'], outletCount: 71, verifiedAt: null }),
  story(3, { title: 'ANC slumps to its worst result', country: 'ZA', countries: 18, localOutlets: 3, localNames: ['Daily Maverick', 'News24', 'SABC News'], outletCount: 29 }),
  story(4, { title: 'A story with no home country', country: null, countries: 30, localOutlets: 0, localNames: [], outletCount: 50 }),
]
const days = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 10 + i)).toISOString().slice(0, 10), n: f(i) }))

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // the API's own routes the tools ask, standing in for the real ones
  app.get('/api/v1/stories', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    // local_press asks for the 20 biggest: stories from more places
    const q = req.query as { limit?: string; hours?: string; region?: string }
    if (q.region) return { success: true, data: { stories: q.region === 'africa' ? [MORE_STORIES[0], MORE_STORIES[2]] : [], hours: Number(q.hours), region: q.region } }
    if (q.limit === '10') return { success: true, data: { stories: [STORY, { ...STORY, id: 'world-story', leadId: WORLD_REPORT, title: 'Six killed in Krakow shooting' }], hours: Number(q.hours) } }
    if (q.limit === '20' && (q as { country?: string }).country === 'PL') {
      const pl = (over: Record<string, unknown>) => ({ ...STORY, country: 'PL', countries: 1, verifiedAt: null, ...over })
      return { success: true, data: { stories: [
        pl({ id: 'pl-1', leadId: LONE_REPORT, title: 'Strike at the Gdańsk shipyard', outletCount: 3, localOutlets: 3, localNames: ['TVN24', 'Onet', 'Notes from Poland'] }),
        pl({ id: 'pl-2', leadId: OTHER_REPORT, title: 'Krakow shooting', outletCount: 40, localOutlets: 5, countries: 12 }),
        pl({ id: 'pl-3', leadId: JUST_VERIFIED, title: 'Village fair', outletCount: 1, localOutlets: 1 }),
        pl({ id: 'pl-4', leadId: DAM_REPORT, title: 'A world story with a Polish pin', country: 'US', outletCount: 3, localOutlets: 0 }),
      ], hours: Number(q.hours), country: 'PL' } }
    }
    if (q.hours === '6' && q.limit === '20') {
      return { success: true, data: { stories: [
        { ...MORE_STORIES[0], firstSeenAt: hoursAgo(2), outletCount: 12 },
        { ...MORE_STORIES[1], firstSeenAt: hoursAgo(1), outletCount: 30 },
        { ...STORY, firstSeenAt: hoursAgo(20) },
      ], hours: 6 } }
    }
    // (long_running_stories reads their first reports' times)
    if ((req.query as { limit?: string }).limit === '20') return { success: true, data: { stories: [{ ...STORY, firstSeenAt: hoursAgo(30), outletCountAll: 300 }, { ...MORE_STORIES[0], firstSeenAt: hoursAgo(24 * 9) }, { ...MORE_STORIES[1], firstSeenAt: hoursAgo(5) }, ...MORE_STORIES.slice(2)], hours: 24 } }
    return { success: true, data: { stories: [STORY], hours: 12 } }
  })
  // one finished day's top stories (Nov 10, 2026): a day not made yet answers 503 once
  app.get('/api/v1/stories/day', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const date = (req.query as { date?: string }).date
    if (date === '2099-01-01') return reply.code(400).send({ success: false, code: 'VALIDATION_ERROR', error: 'That day is not over yet (days are UTC): GET /api/v1/stories?hours=24 lists the stories now' })
    if (date === '2026-01-01') return reply.code(404).send({ success: false, code: 'NOT_FOUND', error: 'Days are kept for the last 30 days' })
    if (date === '2026-11-01' && dayAsks++ === 0) return reply.code(503).header('retry-after', '30').send({ success: false, code: 'SERVICE_UNAVAILABLE', error: 'This day is being put together; try again in half a minute' })
    if (date === '2026-10-31') return reply.code(503).send({ success: false, code: 'SERVICE_UNAVAILABLE', error: 'This day is being put together; try again in half a minute' })
    return { success: true, data: { date: date ?? '2026-11-09', start: `${date ?? '2026-11-09'}T00:00:00.000Z`, stories: [STORY] } }
  })
  // the second outlets found in GDELT's articles (GET /api/v1/public/second-outlets)
  app.get('/api/v1/public/second-outlets', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const today = new Date().toISOString().slice(0, 10)
    return {
      success: true,
      data: {
        days: { [today]: { matched: 158, promoted: 141, waiting: 3036 } },
        latest: [
          { at: hoursAgo(0.2), id: JUST_VERIFIED, severity: 'medium', title: 'Troops rescue three kidnap victims in Adamawa', promoted: true,
            found: [{ site: 'reuters.com', title: 'Nigerian troops free three hostages', url: 'https://www.reuters.com/x' }, { site: 'quicknews.example', title: 'Troops repel attack in Adamawa', url: 'https://quicknews.example/y' }] },
          // the same report again, from a later look: listed once
          { at: hoursAgo(0.1), id: JUST_VERIFIED, severity: 'medium', title: 'Troops rescue three kidnap victims in Adamawa', promoted: true, found: [] },
          // found an outlet but did not turn verified
          { at: hoursAgo(0.3), id: LONE_REPORT, severity: 'high', title: 'Not promoted', promoted: false, found: [{ site: 'x.example', title: 'x', url: 'https://x.example' }] },
          { at: hoursAgo(0.4), id: 'not-a-uuid', severity: 'high', title: 'Dropped: no report id', promoted: true, found: [] },
        ],
      },
    }
  })
  // the languages of the news (GET /api/v1/public/languages, Nov 10, 2026)
  app.get('/api/v1/public/languages', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return {
      success: true,
      data: {
        hours: Number((req.query as { hours?: string }).hours) || 24,
        languages: [
          { language: 'en', reports: 9000, verified: 2700, waiting: 4000, countries: 150 },
          { language: 'fr', reports: 800, verified: 120, waiting: 500, countries: 30 },
          { language: 'ar', reports: 200, verified: 10, waiting: 150, countries: 12 },
          { language: 'xx1', reports: 5, verified: 0, waiting: 5, countries: 1 },
        ],
        verified: [
          { id: FRENCH_REPORT, title: 'Sénégal : au moins 34 morts dans un naufrage de migrants', language: 'fr', country: 'SN', severity: 'high', category: 'disaster', verifiedAt: hoursAgo(1), storyId: 'story-sn', storyLanguages: ['fr'] },
          // the same story's other report: listed once
          { id: '12121212-1212-4212-8212-121212121212', title: 'Naufrage au large de Kébémer', language: 'fr', country: 'SN', severity: 'high', category: 'disaster', verifiedAt: hoursAgo(1.5), storyId: 'story-sn', storyLanguages: ['fr'] },
          { id: ARABIC_REPORT, title: 'قصف إسرائيلي يستهدف بيت جن في ريف دمشق', language: 'ar', country: 'SY', severity: 'high', category: 'conflict', verifiedAt: hoursAgo(2), storyId: 'story-sy', storyLanguages: ['ar', 'en'] },
        ],
      },
    }
  })
  // where news goes unconfirmed (GET /api/v1/public/unconfirmed-places, Nov 10, 2026)
  app.get('/api/v1/public/unconfirmed-places', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return {
      success: true,
      data: {
        days: Number((req.query as { days?: string }).days) || 7,
        places: [
          { country: 'US', reports: 20000, verified: 9000, waiting: 8000, waitingSerious: 2000, languages: ['en', 'es'] },
          { country: 'BI', reports: 40, verified: 1, waiting: 36, waitingSerious: 6, languages: ['fr'] },
          { country: 'SY', reports: 600, verified: 30, waiting: 500, waitingSerious: 90, languages: ['ar', 'en'] },
          // too few reports to rank
          { country: 'TV', reports: 3, verified: 0, waiting: 3, waitingSerious: 0, languages: ['en'] },
        ],
      },
    }
  })
  // the domain check (GET /api/v1/slop/check)
  app.get('/api/v1/slop/check', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const domain = (req.query as { domain?: string }).domain
    const base = { success: true, domain, signals_indexed: 0, checked_at: new Date().toISOString() }
    if (domain === 'dailytrendingnews.net') return { ...base, is_ai_farm: true, ai_farm_confidence: 'confirmed', reliability_score: null, source_name: null, verdict: 'unreliable', warnings: ['dailytrendingnews.net is listed in the WorldPulse AI content farm blocklist'] }
    if (domain === 'reuters.com') return { ...base, is_ai_farm: false, ai_farm_confidence: 'clean', reliability_score: 0.96, source_name: 'Reuters', verdict: 'trusted', warnings: [] }
    if (domain === 'shaky.example') return { ...base, is_ai_farm: false, ai_farm_confidence: 'clean', reliability_score: 0.5, source_name: 'Shaky News', verdict: 'caution', warnings: ['Moderate reliability score (0.50) — verify claims independently'] }
    return { ...base, is_ai_farm: false, ai_farm_confidence: 'clean', reliability_score: null, source_name: null, verdict: 'unknown', warnings: [] }
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
          storyId: 'world-story', size: 9, outlets: 7, outletsAll: 90, verifiedAt: '2026-11-07T16:00:00.000Z', country: 'PL', languages: ['en', 'pl'],
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
    // unconfirmed asks for the newest pending reports of each severity
    if (st === 'pending' && (q as { severity?: string }).severity) {
      const sev = (q as { severity?: string }).severity
      if (sev === 'critical') return { success: true, data: { items: [{ id: CRIT_REPORT, title: 'Explosion reported at refinery near Basra', status: 'pending', severity: 'critical', locationName: 'Basra', countryCode: 'IQ', category: 'disaster', createdAt: ago(0.5), originalUrls: ['https://www.reuters.com/world/x'] }], cursor: null, hasMore: false } }
      if (sev === 'high') return { success: true, data: { items: [
        { id: LONE_REPORT, title: 'Trains collide near Cairo', status: 'pending', severity: 'high', locationName: null, countryCode: 'EG', category: 'disaster', createdAt: ago(2), originalUrls: ['https://lonely.example/a'] },
        // its story was verified since: left out
        { id: STORY.leadId, title: STORY.title, status: 'pending', severity: 'high', locationName: 'Doha', countryCode: 'QA', category: 'conflict', createdAt: ago(1) },
      ], cursor: null, hasMore: false } }
      return { success: true, data: { items: [{ id: MEDIUM_REPORT, title: 'Port workers walk out in Durban', status: 'pending', severity: 'medium', locationName: 'Durban', countryCode: 'ZA', category: 'economy', createdAt: ago(0.2), originalUrls: [] }], cursor: null, hasMore: false } }
    }
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
    if (id === NATO_PA.id) {
      return { success: true, data: {
        entity: { id: NATO_PA.id, type: 'organisation', name: 'NATO Parliamentary Assembly' },
        activity: { last24h: 2, previous24h: 1, last7d: 9 }, stories: [], latest: [],
        connections: [{ id: NATO.id, type: 'organisation', name: 'NATO', shared: 7 }],
      } }
    }
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
  // Nov 10, 2026, night: the routes of the ten tools that make fifty
  app.get('/api/v1/aircraft/live', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const plane = (hex: string, over: Record<string, unknown>) => ({ hex, callsign: null, reg: null, type: null, desc: null, operator: null, lat: 0, lng: 0, alt: null, speed: null, track: null, squawk: null, emergency: null, military: true, ...over })
    return {
      at: '2026-11-10T23:51:33.644Z', source: 'adsb.lol', license: 'ODbL 1.0', failed: [],
      counts: { military: 4, emergency: 1 },
      aircraft: [
        plane('ae01', { callsign: 'RCH431 ', type: 'C17', lat: 50.05, lng: 8.57, alt: 31000, speed: 450.4 }),
        plane('ae02', { callsign: 'QID11', type: 'K35R', lat: 26.3, lng: 52.6, alt: 28000, speed: 420 }),
        plane('ae03', { callsign: 'NAVY7', type: 'P8', lat: 25.0, lng: 55.0, alt: 'ground', speed: 0 }),
        plane('ae04', { callsign: null, reg: '15-0001', type: 'C17', lat: -33.9, lng: 151.2, alt: 12000, speed: 300 }),
        plane('4ca1', { callsign: 'EIN45', type: 'A320', desc: 'AIRBUS A-320', lat: 53.4, lng: -6.2, alt: 9000, speed: 250, squawk: '7700', emergency: 'Emergency', military: false }),
      ],
    }
  })
  app.get('/api/v1/cameras', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const cam = (id: string, name: string, cc: string, city: string, lat: number, lng: number, type: string, sourceName: string) =>
      ({ id, name, region: 'europe', country: cc, countryCode: cc, city, lat, lng, type, isLive: true, sourceName, snapshotUrl: `https://api.world-pulse.io/api/v1/cameras/${id}/image`, embedUrl: 'https://example.org/' })
    const all = [
      cam('tfl:1', 'A406 Billet Upass E', 'GB', 'London', 51.6007, -0.0159, 'traffic', 'Transport for London'),
      cam('tfl:2', 'Strand / Aldwych', 'GB', 'London', 51.5115, -0.1170, 'traffic', 'Transport for London'),
      cam('fi:1', 'Tie 51 Espoo', 'FI', 'Espoo', 60.17, 24.65, 'weather', 'Fintraffic (Digitraffic, CC BY 4.0)'),
    ]
    const type = (req.query as { type?: string }).type
    const cameras = type ? all.filter(c => c.type === type) : all
    return { cameras, total: cameras.length, region: 'global', regions: [], sources: [{ key: 'tfl', name: 'Transport for London', count: 2 }, { key: 'fi', name: 'Fintraffic (Digitraffic, CC BY 4.0)', count: 1 }] }
  })
  app.get('/api/v1/countries', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return {
      window: '24h', total: 3, generated_at: '2026-11-10T23:51:45.134Z',
      countries: [
        { code: 'GB', name: 'United Kingdom', risk_score: 80, risk_label: 'Critical', signal_count: 210, recent_6h: 60, trend: 'stable', avg_reliability: 0.88 },
        { code: 'US', name: 'United States', risk_score: 95, risk_label: 'Critical', signal_count: 439, recent_6h: 132, trend: 'escalating', avg_reliability: 0.91 },
        { code: 'SY', name: 'Syria', risk_score: 70, risk_label: 'High', signal_count: 40, recent_6h: 5, trend: 'de-escalating', avg_reliability: null },
      ],
    }
  })
  app.get('/api/v1/signals/count', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { total: 686672, last24h: 18660, lastHour: 560, verified24h: 3600, countries24h: 199, outlets24h: 1862, bySeverity: { critical: 1 } } }
  })
  app.get('/api/v1/signals/:id/similar', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const { id } = req.params as { id: string }
    return {
      success: true, count: 3,
      similar: [
        { id, title: 'The report itself', status: 'verified' },
        { id: OTHER_REPORT, title: 'Gunman kills six in Polish city', status: 'verified', severity: 'high', location_name: 'Kraków, Poland', created_at: '2026-11-07T15:40:00.000Z' },
        { id: LONE_REPORT, title: 'Strzelanina w Krakowie', status: 'pending', severity: 'medium', country_code: 'PL', created_at: '2026-11-08T09:00:00.000Z' },
      ],
    }
  })
  app.get('/api/v1/signals/:id/flags', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const { id } = req.params as { id: string }
    return { success: true, data: id === WORLD_REPORT ? { count: 3, reasons: { inaccurate: 1, duplicate: 2, outdated: 0 } } : { count: 0, reasons: {} } }
  })
  app.get('/api/v1/space-weather/summary', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, cached: true, data: { geomagnetic_level: 2, solar_radiation_level: 0, radio_blackout_level: 1, active_events: 3, latest_at: hoursAgo(2), satellite_events_24h: 0 } }
  })
  app.get('/api/v1/space-weather/recent', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const ev = (id: string, title: string, at: string) => ({ id, title, severity: 'low', published_at: at })
    return {
      success: true, cached: true,
      data: {
        hours: Number((req.query as { hours?: string }).hours), count: 3,
        events: [
          ev('9fdbbd18-b018-4e2c-a344-e4880d75baf5', 'Space weather watch: Geomagnetic Storm Category G1 Predicted', '2026-11-07T06:26:14.357Z'),
          ev('4d3a0176-48b9-4bcf-8563-7a66a02b03b9', 'Space weather watch: Geomagnetic Storm Category G1 Predicted', '2026-11-07T09:01:00.000Z'),
          ev('5e4b1287-59ca-4adb-9674-f5a3b13c14ca', 'Space weather alert: Geomagnetic K-index of 6 expected (G2)', '2026-11-08T12:00:00.000Z'),
        ],
      },
    }
  })
  // Nov 10, 2026, night, round 2: the open counts of routes/public-insights.ts
  app.get('/api/v1/public/chokepoints', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { days: Number((req.query as { days?: string }).days), chokepoints: [
      { id: 'hormuz', name: 'Strait of Hormuz', reports: 42, verified: 20, latest: { id: STORY.leadId, title: 'Tanker hit near the Strait of Hormuz', at: hoursAgo(3), verified: true } },
      { id: 'suez', name: 'Suez Canal', reports: 5, verified: 1, latest: { id: OTHER_REPORT, title: 'Suez Canal traffic recovers', at: hoursAgo(30), verified: false } },
      { id: 'lombok', name: 'Lombok Strait', reports: 0, verified: 0, latest: null },
    ] } }
  })
  app.get('/api/v1/public/vulnerabilities', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { days: Number((req.query as { days?: string }).days), count: 2, vulnerabilities: [
      { id: OTHER_REPORT, title: 'CVE-2026-125350: Google Chromium Use-After-Free Vulnerability', summary: null, at: '2026-11-09T00:00:00.000Z', cve: 'CVE-2026-125350', vendor: 'google', ransomware: false },
      { id: LONE_REPORT, title: 'CVE-2026-111560: Barracuda Networks OS Command Injection', summary: null, at: '2026-11-05T00:00:00.000Z', cve: 'CVE-2026-111560', vendor: 'barracuda-networks', ransomware: true },
    ] } }
  })
  app.get('/api/v1/public/travel-advice', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const country = (req.query as { country?: string }).country
    const levels = [{ country: 'IR', level: 4, since: '2026-11-03' }, { country: 'VE', level: 4, since: '2026-10-01' }, { country: 'NG', level: 3, since: '2026-09-01' }, { country: 'FR', level: 2, since: '2026-06-01' }, { country: 'JP', level: 1, since: '2026-01-01' }]
    if (!country) return { success: true, data: { country: null, levels } }
    return { success: true, data: { country, us: levels.find(l => l.country === country) ?? null, notices: country === 'IR'
      ? [{ id: OTHER_REPORT, title: 'Iran - Level 4: Do Not Travel', at: '2026-11-05T00:00:00.000Z', url: 'https://travel.state.gov/iran', from: 'us' }, { id: LONE_REPORT, title: 'FCDO advice against all travel to Iran', at: '2026-11-02T00:00:00.000Z', url: 'https://www.gov.uk/foreign-travel-advice/iran', from: 'uk' }]
      : [] } }
  })
  app.get('/api/v1/public/first-reporters', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { days: 7, minOutlets: 5, stories: 40, outlets: [
      { site: 'bbc.co.uk', name: 'BBC', country: 'GB', kind: 'international', firsts: 6 },
      { site: 'reuters.com', name: 'Reuters', country: 'GB', kind: 'agency', firsts: 9 },
      { site: 'bbc.com', name: 'BBC', country: 'GB', kind: 'international', firsts: 4 },
      { site: 'unknown.example', name: null, country: null, kind: null, firsts: 1 },
    ] } }
  })
  app.get('/api/v1/public/verification-speed', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const st = (n: number, minutes: number) => ({ storyId: `s${n}`, reportId: OTHER_REPORT, title: `Story ${n}`, firstAt: null, verifiedAt: null, minutes })
    return { success: true, data: { hours: 24, verified: 3600, medianMinutes: 47, withinHour: 1980, withinDay: 3300, fastest: [st(1, 0), st(2, 3)], slowest: [st(3, 4320), st(4, 90)] } }
  })
  app.get('/api/v1/public/topics', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    if ((req.query as { region?: string }).region === 'africa') return { success: true, data: { hours: 24, country: null, region: 'africa', topics: [{ topic: 'elections', reports: 50, verified: 10, before: 25 }, { topic: 'conflict', reports: 50, verified: 20, before: 0 }] } }
    if ((req.query as { country?: string }).country === 'NG') return { success: true, data: { hours: 24, country: 'NG', topics: [{ topic: 'security', reports: 30, verified: 10, before: 20 }, { topic: 'elections', reports: 10, verified: 2, before: 0 }] } }
    return { success: true, data: { hours: 24, topics: [
      { topic: 'geopolitics', reports: 600, verified: 200, before: 500 },
      { topic: 'conflict', reports: 300, verified: 150, before: 400 },
      { topic: 'sports', reports: 100, verified: 10, before: 0 },
      { topic: 'space', reports: 0, verified: 0, before: 2 },
    ] } }
  })
  app.get('/api/v1/public/outlet-reports', async (req, reply) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const site = (req.query as { site?: string }).site
    if (!site || !site.includes('.')) return reply.code(400).send({ success: false, code: 'VALIDATION_ERROR', error: 'site must be a website' })
    const lemonde = site === 'lemonde.fr'
    return { success: true, data: { site, days: 7, total: lemonde ? 31 : 0, verified: lemonde ? 12 : 0,
      topics: lemonde ? [{ topic: 'geopolitics', reports: 20 }, { topic: 'conflict', reports: 6 }, { topic: 'culture', reports: 5 }] : [],
      places: lemonde ? [{ country: 'FR', reports: 15 }, { country: 'SD', reports: 3 }] : [], reports: lemonde
      ? [{ id: OTHER_REPORT, title: 'Soudan : reprise des pourparlers', status: 'verified', severity: 'medium', topic: 'geopolitics', country: 'SD', at: hoursAgo(2), storyId: 's' }]
      : [] } }
  })
  // Nov 10, 2026, night, round 3
  app.get('/api/v1/public/feed-reports', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const feed = (req.query as { feed?: string }).feed
    const r = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, summary: null, severity: 'medium', country: null, place: null, at: '2026-11-10T00:00:00.000Z', url: null, tags: [], ...over })
    if (feed === 'carriers') {
      return { success: true, data: { feed, days: 7, total: 3, reports: [
        r(OTHER_REPORT, 'USS Harry S. Truman (CVN-75): Deployment', { place: 'Eastern Mediterranean', at: '2026-11-11T00:00:00.000Z' }),
        r(LONE_REPORT, 'USS Theodore Roosevelt (CVN-71): Port Arrival', { place: 'San Diego', at: '2026-11-10T00:00:00.000Z' }),
        r(JUST_VERIFIED, 'USS Harry S. Truman (CVN-75): OSINT Update', { at: '2026-11-09T00:00:00.000Z' }),
      ] } }
    }
    return { success: true, data: { feed, days: 7, total: 17, reports: [
      r(OTHER_REPORT, 'OFAC Sanctions: Iran-related Designations', { country: 'IR', summary: 'Treasury sanctions 12 people and 4 ships that move Iranian oil. More follows.', url: 'https://ofac.treasury.gov/recent-actions/x' }),
      r(LONE_REPORT, 'EU Council: Russia sanctions amended', { country: 'RU' }),
    ] } }
  })
  app.get('/api/v1/public/news-watch', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const watch = (req.query as { watch?: string }).watch
    if (watch === 'disasters') return { success: true, data: { watch, days: 7, total: 0, countries: [], newest: [] } }
    return { success: true, data: { watch, days: 7, total: 40, countries: [
      { country: 'PL', reports: 12, verified: 5, latest: { id: OTHER_REPORT, title: 'Hackers hit Polish water utility', at: hoursAgo(5) } },
      { country: 'FR', reports: 3, verified: 0, latest: null },
    ], newest: [{ id: LONE_REPORT, title: 'Ransomware gang leaks hospital data', status: 'pending', country: 'PL', at: hoursAgo(1) }] } }
  })
  app.get('/api/v1/public/busiest-outlets', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { hours: 24, reports: 18000, outlets: [
      { site: 'bbc.co.uk', name: 'BBC', country: 'GB', kind: 'international', stateMedia: false, reports: 100, verified: 60 },
      { site: 'tass.com', name: 'TASS', country: 'RU', kind: 'agency', stateMedia: true, reports: 150, verified: 30 },
      { site: 'bbc.com', name: 'BBC', country: 'GB', kind: 'international', stateMedia: false, reports: 80, verified: 50 },
    ] } }
  })
  // Nov 10, 2026, night, round 4
  app.get('/api/v1/public/news-by-hour', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { hours: 3, byHour: [
      { hour: '2026-11-10T21:00:00.000Z', reports: 700, verified: 120, serious: 30 },
      { hour: '2026-11-10T22:00:00.000Z', reports: 900, verified: 150, serious: 80 },
      { hour: '2026-11-10T23:00:00.000Z', reports: 650, verified: 100, serious: 20 },
    ] } }
  })
  app.get('/api/v1/public/serious-places', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { hours: 24, places: [
      { country: 'UA', serious: 120, critical: 20, verified: 60, latest: { id: OTHER_REPORT, title: 'Missile strike on Kharkiv', severity: 'critical', at: hoursAgo(2) } },
      { country: 'SD', serious: 40, critical: 5, verified: 0, latest: null },
    ] } }
  })
  // Nov 10, 2026, night, round 6
  app.get('/api/v1/public/topic-countries', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { topic: 'health', days: 1, total: 500, countries: [{ country: 'US', reports: 200, verified: 50 }, { country: 'IN', reports: 100, verified: 10 }] } }
  })
  app.get('/api/v1/public/country-coverage', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    if ((req.query as { country?: string }).country === 'AQ') return { success: true, data: { country: 'AQ', days: 7, total: 0, verified: 0, outlets: [], languages: [] } }
    return { success: true, data: { country: 'SD', days: 7, total: 1000, verified: 300,
      outlets: [{ site: 'aljazeera.com', reports: 200, verified: 120 }, { site: 'bbc.co.uk', reports: 90, verified: 70 }, { site: 'dabangasudan.org', reports: 80, verified: 20 }, { site: 'bbc.com', reports: 60, verified: 40 }, { site: 'unknown.example', reports: 10, verified: 0 }],
      languages: [{ language: 'en', reports: 600 }, { language: 'ar', reports: 350 }, { language: 'fr', reports: 50 }] } }
  })
  app.get('/api/v1/public/news-by-day', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
    if ((req.query as { topic?: string }).topic === 'elections') {
      return { success: true, data: { days: 14, topic: 'elections', byDay: [
        ...Array.from({ length: 14 }, (_, i) => ({ day: day(14 - i), reports: i < 7 ? 10 : 20, verified: 1, serious: 0 })),
        { day: day(0), reports: 5, verified: 0, serious: 0 },
      ] } }
    }
    return { success: true, data: { days: 2, topic: null, byDay: [
      { day: day(2), reports: 18000, verified: 3500, serious: 900 }, { day: day(1), reports: 19000, verified: 3600, serious: 950 }, { day: day(0), reports: 4000, verified: 700, serious: 200 },
    ] } }
  })
  // Nov 10, 2026, night, round 5
  app.get('/api/v1/public/country-changes', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { days: 1, countries: [
      { country: 'US', now: 5000, before: 4800 },
      { country: 'SD', now: 300, before: 100 },
      { country: 'FJ', now: 5, before: 0 },
      { country: 'UA', now: 400, before: 900 },
      { country: 'NG', now: 60, before: 0 },
    ] } }
  })
  app.get('/api/v1/status', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { overall: 'operational', checked_at: hoursAgo(0), services: { api: { status: 'operational' }, scraper: { status: 'operational', message: 'Newest report under a minute ago' } } }
  })
  app.get('/api/v1/signals/:id/connections', async (req) => {
    asked.push({ url: req.url, client: internalCallClient(req.headers as Record<string, unknown>) })
    return { success: true, data: { connections: [], count: 0, entities: [{ id: 'e1', name: 'Kraków', type: 'location', mentionCount: 1200 }, { id: 'e2', name: 'Donald Tusk', type: 'person', mentionCount: 900 }] } }
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
      'day', 'unconfirmed', 'newly_verified', 'local_press', 'site_check',
      'quiet_places', 'story_languages', 'verified_in_languages', 'languages_today', 'missed_in_english',
      'military_aircraft', 'emergency_flights', 'live_cameras', 'busiest_countries', 'news_volume',
      'similar_reports', 'reader_flags', 'outlet_mix', 'country_compare', 'space_weather',
      'chokepoints_news', 'exploited_vulnerabilities', 'travel_advice', 'first_reporters', 'verification_speed',
      'topics_today', 'outlet_reports', 'region_top_stories', 'rising_stories', 'thin_coverage',
      'sanctions_actions', 'us_weather_alerts', 'carrier_groups', 'cyber_attacks', 'elections_watch',
      'disaster_news', 'state_media_stories', 'country_topics', 'busiest_outlets', 'local_only_stories',
      'numbers_differ', 'long_running_stories', 'news_by_hour', 'serious_places', 'state_media_outlets',
      'outlet_languages', 'how_worldpulse_counts', 'worldpulse_status', 'story_compare', 'report_entities',
      'topic_top_stories', 'whats_new_today', 'rising_countries', 'entity_compare', 'outlet_compare',
      'outlet_profile', 'coverage_stats', 'world_today', 'region_snapshot', 'find_outlet',
      'most_global_stories', 'country_rank', 'compare_regions', 'topic_countries', 'who_reports_on',
      'country_languages', 'news_by_day', 'topic_trend', 'region_topics', 'tool_guide',
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

describe('MCP server: the five tools of Nov 10, 2026 (thirty-five in all)', () => {
  beforeEach(() => { asked = []; dayAsks = 0; DAY_WAIT.ms = 0 })

  it("day lists one finished day's top stories; yesterday without a date", async () => {
    const app = await build()
    const r = await call(app, 'day', { date: '2026-11-03' })
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories/day?date=2026-11-03'])
    const text = r.content[0].text as string
    expect(text).toContain('Tuesday, November 3, 2026 (UTC): the top stories by independent outlets')
    expect(text).toContain('1. Ceasefire talks resume in Doha\n   Verified · 14 outlets in 9 countries')
    expect(r.structuredContent).toMatchObject({ date: '2026-11-03', stories: [{ id: STORY.id, outlets: 14 }] })
    asked = []
    const y = await call(app, 'day')
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories/day'])
    expect(y.structuredContent.date).toBe('2026-11-09')
  })

  it('day waits for a day being made, and passes on the reasons a day is refused', async () => {
    const app = await build()
    const r = await call(app, 'day', { date: '2026-11-01' })
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories/day?date=2026-11-01', '/api/v1/stories/day?date=2026-11-01'])
    const stuck = await call(app, 'day', { date: '2026-10-31' })
    expect(stuck).toMatchObject({ isError: true, content: [{ text: 'That day is still being put together; ask again in a minute' }] })
    expect((await call(app, 'day', { date: '2099-01-01' })).content[0].text).toContain('That day is not over yet')
    expect((await call(app, 'day', { date: '2026-01-01' })).content[0].text).toContain('the last 30 days')
    expect((await call(app, 'day', { date: 'Nov 3' })).isError).toBe(true)
  })

  it('unconfirmed lists the newest serious reports no second outlet has confirmed, each story once, newest first', async () => {
    const app = await build()
    const r = await call(app, 'unconfirmed')
    expect(r.isError).toBe(false)
    const urls = asked.map(a => a.url)
    expect(urls).toContain('/api/v1/signals?status=pending&severity=critical&limit=30')
    expect(urls).toContain('/api/v1/signals?status=pending&severity=high&limit=30')
    expect(urls).toContain('/api/v1/public/second-outlets')
    expect(urls.some(u => u.startsWith('/api/v1/stories/outlets?ids='))).toBe(true)
    expect(urls.some(u => u.includes('severity=medium'))).toBe(false)
    const text = r.content[0].text as string
    expect(text).toContain('The newest unconfirmed high and critical reports, newest first: leads to check, not facts (WorldPulse):')
    expect(text).toContain(`1. Explosion reported at refinery near Basra\n   Critical · 30m ago · Basra · via Reuters`)
    expect(text).toContain('Only one outlet so far: unconfirmed')
    expect(text).toContain(`2. Trains collide near Cairo\n   High · 2h ago · Egypt · via lonely.example · Only one outlet so far: unconfirmed\n   https://world-pulse.io/signals/${LONE_REPORT}`)
    // its story was verified since
    expect(text).not.toContain('Ceasefire talks resume in Doha')
    expect(text).toContain('3,036 are waiting now; today 158 found one and 141 turned verified')
    expect(r.structuredContent).toMatchObject({ severity: 'high', waiting: { reports: 3036, foundToday: 158, verifiedToday: 141 } })
    expect(r.structuredContent.reports.map((x: { id: string }) => x.id)).toEqual([CRIT_REPORT, LONE_REPORT])
  })

  it('unconfirmed takes medium ones too, a subject and a country, and refuses others', async () => {
    const app = await build()
    const r = await call(app, 'unconfirmed', { severity: 'medium', category: 'economy', country: 'za', limit: 5 })
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toContain('/api/v1/signals?status=pending&severity=medium&limit=30&category=economy&country=ZA')
    expect(r.content[0].text).toContain('The newest unconfirmed medium, high and critical economy reports from South Africa')
    expect(r.structuredContent.reports[0]).toMatchObject({ id: MEDIUM_REPORT, outlet: null })
    expect((await call(app, 'unconfirmed', { severity: 'low' })).isError).toBe(true)
    expect((await call(app, 'unconfirmed', { category: 'gossip' })).isError).toBe(true)
  })

  it('newly_verified lists the reports that just found a second outlet, with the outlets that confirmed them', async () => {
    const app = await build()
    const r = await call(app, 'newly_verified', { limit: 5 })
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/second-outlets'])
    const text = r.content[0].text as string
    expect(text).toContain('Just verified: reports that turned verified when WorldPulse found a second, separate outlet')
    expect(text).toContain('1. Troops rescue three kidnap victims in Adamawa\n   Medium · 12m ago · confirmed by Reuters')
    expect(text).toContain(': "Nigerian troops free three hostages"; quicknews.example: "Troops repel attack in Adamawa"')
    expect(text).toContain(`https://world-pulse.io/signals/${JUST_VERIFIED}`)
    // listed once; not the one that didn't turn verified, nor one without a report id
    expect(text.match(/Troops rescue/g)).toHaveLength(1)
    expect(text).not.toContain('Not promoted')
    expect(text).not.toContain('Dropped')
    expect(text).toContain('Today so far (UTC): 158 reports found a second outlet and 141 turned verified; 3,036 are waiting')
    expect(r.structuredContent.reports).toHaveLength(1)
    expect(r.structuredContent.reports[0].confirmedBy).toEqual([
      { site: 'reuters.com', title: 'Nigerian troops free three hostages', url: 'https://www.reuters.com/x' },
      { site: 'quicknews.example', title: 'Troops repel attack in Adamawa', url: 'https://quicknews.example/y' },
    ])
    expect(r.structuredContent.today).toEqual({ found: 158, verified: 141, waiting: 3036 })
  })

  it("local_press lists stories many countries' outlets report while few or none are from the story's own country", async () => {
    const app = await build()
    const r = await call(app, 'local_press')
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=24&limit=20'])
    const text = r.content[0].text as string
    expect(text).toContain('Stories outlets from many countries report while one or none of their outlets is from the country where they happen')
    expect(text).toContain('1. Migrant boats capsize off Senegal and Greece\n   44 outlets from 28 countries · none of them from Senegal\n')
    expect(text).toContain('2. Trump says the Iran war is effectively over\n   71 outlets from 36 countries · 1 from Iran (IranWire) · not verified yet\n')
    // three home outlets, too few countries, or no home country: left out
    expect(text).not.toContain('ANC slumps')
    expect(text).not.toContain('Ceasefire talks')
    expect(text).not.toContain('no home country')
    expect(text).toContain('a low count is a lead to check, not proof that the local press is silent')
    expect(r.structuredContent.stories.map((s: { homeOutlets: number; country: string }) => [s.country, s.homeOutlets])).toEqual([['SN', 0], ['IR', 1]])
  })

  it("local_press with a country gives each of its stories' home outlets", async () => {
    const app = await build()
    const r = await call(app, 'local_press', { country: 'za', hours: 48 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=48&limit=20&country=ZA'])
    const text = r.content[0].text as string
    expect(text).toContain('Top stories in South Africa, the last 48 hours: how many of their outlets are based there')
    expect(text).toContain('1. ANC slumps to its worst result\n   29 outlets from 18 countries · 3 from South Africa (Daily Maverick, News24, SABC News)')
    expect((await call(app, 'local_press', { country: 'FR' })).content[0].text).toContain('No story mostly placed in France was reported by two or more outlets')
    expect((await call(app, 'local_press', { country: 'FRA' })).isError).toBe(true)
  })

  it('site_check says whether a website is a known AI content farm, its score as a source and what the directory knows', async () => {
    const app = await build()
    const farm = await call(app, 'site_check', { site: 'https://www.dailytrendingnews.net/2026/11/some-story' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/slop/check?domain=dailytrendingnews.net'])
    expect(farm.isError).toBe(false)
    expect(farm.content[0].text).toMatch(/^dailytrendingnews\.net: on WorldPulse's list of \d+ known AI content farms\. Its articles are likely machine-written/)
    expect(farm.content[0].text).toContain('Overall: red flag.')
    expect(farm.structuredContent).toMatchObject({ site: 'dailytrendingnews.net', aiContentFarm: true, verdict: 'red flag', directory: null })
    const reuters = await call(app, 'site_check', { site: 'reuters.com' })
    expect(reuters.content[0].text).toContain('reuters.com: not on WorldPulse\'s list of')
    expect(reuters.content[0].text).toContain('WorldPulse reads it as a source (Reuters), with a reliability score of 96%.')
    expect(reuters.content[0].text).toContain('In WorldPulse\'s outlet directory: Reuters, ')
    expect(reuters.structuredContent).toMatchObject({ reliabilityScore: 0.96, verdict: 'no red flag known', directory: { name: 'Reuters' } })
    const bbc = await call(app, 'site_check', { site: 'https://www.bbc.co.uk/news/articles/x' })
    expect(bbc.content[0].text).toContain('It is not one of the sources WorldPulse scores.')
    expect(bbc.content[0].text).toContain('In WorldPulse\'s outlet directory: BBC, ')
    const shaky = await call(app, 'site_check', { site: 'shaky.example' })
    expect(shaky.content[0].text).toContain('reliability score of 50%: moderate, check its claims elsewhere.')
    expect(shaky.structuredContent.verdict).toBe('caution')
    expect((await call(app, 'site_check', { site: 'nowhere.example' })).content[0].text).toContain('It is not in WorldPulse\'s directory of')
    expect((await call(app, 'site_check', { site: 'not a site' })).isError).toBe(true)
  })
})

describe('MCP server: the five tools of Nov 10, 2026, evening (forty in all)', () => {
  beforeEach(() => { asked = [] })

  it('quiet_places lists the places whose reports most rarely find a second outlet', async () => {
    const app = await build()
    const r = await call(app, 'quiet_places', {})
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/unconfirmed-places?days=7'])
    const text = r.content[0].text as string
    expect(text).toContain('Where news goes unconfirmed, the last 7 days')
    expect(text).toContain('1. Burundi: 40 reports, 1 verified (3%) · 36 waiting for a second outlet, 6 of them serious · in French')
    expect(text).toContain('2. Syria: 600 reports, 30 verified (5%)')
    // fewer than 10 reports: not ranked
    expect(text).not.toContain('Tuvalu')
    expect(r.structuredContent.places.map((p: { country: string }) => p.country)).toEqual(['BI', 'SY', 'US'])
    const one = await call(app, 'quiet_places', { country: 'bi', days: 3 })
    expect(asked.map(a => a.url)).toContain('/api/v1/public/unconfirmed-places?days=3')
    expect(one.content[0].text).toContain('Burundi, the last 3 days (WorldPulse): 40 reports, 1 verified (3%)')
    expect((await call(app, 'quiet_places', { country: 'XX' })).isError).toBe(true)
  })

  it("story_languages lists a story's languages and its outlets in each", async () => {
    const app = await build()
    const r = await call(app, 'story_languages', { id: WORLD_REPORT })
    expect(r.isError).toBe(false)
    const text = r.content[0].text as string
    expect(text).toContain('Six killed in Krakow shooting')
    expect(text).toMatch(/Reported in 2 languages, by 7 outlets in its last two days/)
    expect(text).toMatch(/- English: \d+ outlets \(Al Jazeera, BBC, Notes from Poland, TASS/)
    expect(text).toContain('- Polish: its own reports')
    expect(text).toContain('unknown-site.example')
    expect(r.structuredContent.languages.map((l: { code: string }) => l.code)).toEqual(['en', 'pl'])
    expect((await call(app, 'story_languages', { id: 'nope' })).isError).toBe(true)
  })

  it('verified_in_languages lists the newest verified reports in other languages, each story once', async () => {
    const app = await build()
    const r = await call(app, 'verified_in_languages', {})
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/languages?hours=24'])
    const text = r.content[0].text as string
    expect(text).toContain('Just verified in languages other than English, the last 24 hours')
    expect(text).toContain('1. Sénégal : au moins 34 morts dans un naufrage de migrants\n   French · Senegal · High · verified 1h ago')
    expect(text).toContain('2. قصف إسرائيلي يستهدف بيت جن في ريف دمشق\n   Arabic · Syria · High · verified 2h ago · its story in Arabic, English')
    expect(text).not.toContain('Naufrage au large')
    const ar = await call(app, 'verified_in_languages', { language: 'AR', hours: 48 })
    expect(asked.map(a => a.url)).toContain('/api/v1/public/languages?hours=48')
    expect(ar.structuredContent.reports.map((x: { id: string }) => x.id)).toEqual([ARABIC_REPORT])
    expect((await call(app, 'verified_in_languages', { language: 'en' })).isError).toBe(true)
  })

  it('languages_today counts the reports in each language, the most first', async () => {
    const app = await build()
    const r = await call(app, 'languages_today', { hours: 12 })
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/languages?hours=12'])
    const text = r.content[0].text as string
    expect(text).toContain('The last 12 hours, WorldPulse read reports in 3 languages (10,000 reports), the most first:')
    expect(text).toContain('1. English: 9,000 reports (90%) from 150 countries · 30% verified · 4,000 waiting for a second outlet')
    expect(text).toContain('2. French: 800 reports (8%) from 30 countries · 15% verified')
    expect(text).not.toContain('xx1')
  })

  it('missed_in_english lists the verified stories with no report in English', async () => {
    const app = await build()
    const r = await call(app, 'missed_in_english', {})
    expect(r.isError).toBe(false)
    const text = r.content[0].text as string
    expect(text).toContain('Verified in the last 24 hours, and reported in no English (WorldPulse), newest first:')
    expect(text).toContain('1. Sénégal : au moins 34 morts dans un naufrage de migrants\n   French · Senegal · High · verified 1h ago')
    // the Syrian story has an English report
    expect(text).not.toContain('بيت جن')
    expect(r.structuredContent.stories).toHaveLength(1)
  })
})

describe('MCP server: the ten tools of Nov 10, 2026, night (fifty in all)', () => {
  beforeEach(() => { asked = [] })

  it('military_aircraft counts the military aircraft now, their types, and lists the nearest to a place', async () => {
    const app = await build()
    const r = await call(app, 'military_aircraft', {})
    expect(r.isError).toBe(false)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/aircraft/live'])
    const text = r.content[0].text as string
    expect(text).toContain('4 military aircraft broadcasting their position now (adsb.lol, 23:51 UTC). Commonest types: C17 (2), K35R (1), P8 (1).')
    expect(text).toContain('Squawking an emergency code now: 1 aircraft (emergency_flights).')
    const gulf = await call(app, 'military_aircraft', { latitude: 26.2, longitude: 52.5, radius_km: 400 })
    const lines = (gulf.content[0].text as string).split('\n')
    expect(lines).toContain('Within 400 km of 26.20°N 52.50°E, nearest first:')
    expect(lines.find(l => l.startsWith('1. '))).toBe('1. QID11 · K35R · 28,000 ft · 420 kt · 26.30°N 52.60°E · 15 km away')
    expect(lines.find(l => l.startsWith('2. '))).toMatch(/^2\. NAVY7 · P8 · on the ground · 0 kt · 25\.00°N 55\.00°E · \d+ km away$/)
    expect(gulf.structuredContent.aircraft.map((a: { callsign: string }) => a.callsign)).toEqual(['QID11', 'NAVY7'])
    expect((await call(app, 'military_aircraft', { latitude: 26.2 })).isError).toBe(true)
  })

  it('emergency_flights lists the aircraft squawking 7700, 7600 or 7500', async () => {
    const app = await build()
    const r = await call(app, 'emergency_flights', { latitude: 53.35, longitude: -6.26 })
    const text = r.content[0].text as string
    expect(text).toContain('1 aircraft squawking an emergency code now (adsb.lol, 23:51 UTC), nearest to 53.35°N 6.26°W first:')
    expect(text).toContain('1. Emergency (7700): EIN45 · AIRBUS A-320 · 9,000 ft · 250 kt · 53.40°N 6.20°W · 7 km away')
    expect(r.structuredContent.aircraft[0]).toMatchObject({ callsign: 'EIN45', squawk: '7700', emergency: 'Emergency', km: 7 })
  })

  it('live_cameras says where its cameras are, and lists the nearest to a place or those of a country', async () => {
    const app = await build()
    const where = await call(app, 'live_cameras', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/cameras?limit=6000'])
    expect(where.content[0].text).toContain('3 public live cameras in United Kingdom (2), Finland (1), from Transport for London (2), Fintraffic (Digitraffic, CC BY 4.0) (1).')
    const london = await call(app, 'live_cameras', { latitude: 51.5074, longitude: -0.1278, radius_km: 20 })
    const text = london.content[0].text as string
    expect(text).toContain('Public live cameras within 20 km of 51.51°N 0.13°W, nearest first:')
    expect(text.indexOf('Strand / Aldwych')).toBeLessThan(text.indexOf('A406 Billet Upass E'))
    expect(text).toContain('Picture: https://api.world-pulse.io/api/v1/cameras/tfl:2/image')
    const fi = await call(app, 'live_cameras', { country: 'fi', type: 'weather' })
    expect(asked.map(a => a.url)).toContain('/api/v1/cameras?limit=6000&type=weather')
    expect(fi.structuredContent.cameras.map((c: { name: string }) => c.name)).toEqual(['Tie 51 Espoo'])
    expect((await call(app, 'live_cameras', { country: 'KE' })).content[0].text).toContain('No public camera WorldPulse shows in Kenya')
    expect((await call(app, 'live_cameras', { type: 'city' })).isError).toBe(true)
  })

  it("busiest_countries ranks the countries by their last 24 hours' reports, with no risk labels", async () => {
    const app = await build()
    const r = await call(app, 'busiest_countries', { limit: 2 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/countries'])
    const text = r.content[0].text as string
    expect(text).toContain('1. United States: 439 reports, 132 in the last 6 hours (rising) · sources 91% reliable on average')
    expect(text).toContain('2. United Kingdom: 210 reports, 60 in the last 6 hours (steady)')
    expect(text).not.toContain('Syria')
    expect(text).not.toContain('Critical')
    expect(r.structuredContent.countries.map((c: { code: string }) => c.code)).toEqual(['US', 'GB'])
  })

  it('news_volume says how much news WorldPulse is reading', async () => {
    const app = await build()
    const r = await call(app, 'news_volume', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/signals/count'])
    // (Nov 12, 2026: every country covered is said, with the day's count beside it; Devon: "Always list total amount of countries covered not just for that day")
    expect(r.content[0].text).toContain('WorldPulse read 560 reports in the last hour and 18,660 in the last 24 hours, from 1,862 outlets. It covers 202 countries and territories (199 had news in the last 24 hours).')
    expect(r.content[0].text).toContain('3,600 turned verified in the last 24 hours')
    expect(r.structuredContent).toMatchObject({ lastHour: 560, total: 686672 })
  })

  it("similar_reports finds a story's lead report and lists the reports closest to it, leaving it out", async () => {
    const app = await build()
    const r = await call(app, 'similar_reports', { id: WORLD_REPORT })
    expect(asked.map(a => a.url)).toEqual([`/api/v1/stories/${WORLD_REPORT}`, `/api/v1/signals/${WORLD_REPORT}/similar?limit=6`])
    const text = r.content[0].text as string
    expect(text).toContain('Reports closest in meaning to "Six killed in Krakow shooting"')
    expect(text).toContain('1. Gunman kills six in Polish city\n   Verified · High · Kraków, Poland · 2026-11-07')
    expect(text).toContain('2. Strzelanina w Krakowie\n   Not verified yet · Medium · Poland · 2026-11-08')
    expect(text).not.toContain('The report itself')
    expect((await call(app, 'similar_reports', { id: 'nope' })).isError).toBe(true)
  })

  it('reader_flags gives how many readers flagged a report and why, never who', async () => {
    const app = await build()
    const r = await call(app, 'reader_flags', { id: WORLD_REPORT })
    expect(asked.map(a => a.url)).toContain(`/api/v1/signals/${WORLD_REPORT}/flags`)
    expect(r.content[0].text).toContain('3 readers flagged "Six killed in Krakow shooting": duplicate (2), inaccurate (1).')
    expect(r.structuredContent.reasons).toEqual({ duplicate: 2, inaccurate: 1 })
    const none = await call(app, 'reader_flags', { id: STORY.leadId })
    expect(none.content[0].text).toContain(`No reader has flagged "${STORY.title}".`)
  })

  it("outlet_mix counts a story's outlets by kind, each outlet once, and names its state media", async () => {
    const app = await build()
    const r = await call(app, 'outlet_mix', { id: WORLD_REPORT })
    const text = r.content[0].text as string
    expect(text).toContain('Verified · 6 outlets in its last two days, by kind')
    expect(text).toContain('- International: 2 (Al Jazeera, BBC)')
    expect(text).toContain('- National: 2 (Notes from Poland, TVP World)')
    expect(text).toContain('- News agency: 1 (TASS)')
    expect(text).toContain('- Not in the directory: 1 (unknown-site.example)')
    expect(text).toContain('State media (a government runs it): 2 of 6 · TASS (Russia), TVP World (Poland)')
    expect(text.indexOf('Not in the directory')).toBeGreaterThan(text.indexOf('News agency'))
    expect(r.structuredContent.stateMedia).toEqual(['TASS (Russia)', 'TVP World (Poland)'])
  })

  it('country_compare sets two countries side by side', async () => {
    const app = await build()
    const r = await call(app, 'country_compare', { a: 'bi', b: 'SY' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/unconfirmed-places?days=7', '/api/v1/countries/BI/daily?days=14', '/api/v1/countries/SY/daily?days=14'])
    const text = r.content[0].text as string
    expect(text).toContain('Burundi and Syria in WorldPulse\'s reports:')
    expect(text).toContain('Burundi:\n- News reports, last 7 days: 40, 1 verified (3%), 36 waiting for a second outlet')
    // the stand-in's 14 days: 6 a day with one 40, then 12 a day
    expect(text).toContain('- Reports a day: 12 this week (+11% on the week before)')
    expect(text).toContain('- Languages: French')
    expect(text).toMatch(/- Newsrooms based there whose feeds WorldPulse reads: \d+/)
    expect((await call(app, 'country_compare', { a: 'SY', b: 'sy' })).isError).toBe(true)
    expect((await call(app, 'country_compare', { a: 'SY', b: 'XX' })).isError).toBe(true)
  })

  it("space_weather gives the last day's highest storm levels and NOAA's alerts, each watch once a day", async () => {
    const app = await build()
    const r = await call(app, 'space_weather', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/space-weather/summary', '/api/v1/space-weather/recent?hours=168&limit=100'])
    const text = r.content[0].text as string
    expect(text).toContain("Highest in NOAA's alerts of the last 24 hours: geomagnetic storms G2, solar radiation S0 (none), radio blackouts R1.")
    expect(text).toContain('1. Geomagnetic K-index of 6 expected (G2) · 2026-11-08 12:00 UTC')
    expect(text).toContain('2. Geomagnetic Storm Category G1 Predicted · 2026-11-07 09:01 UTC')
    expect(text).not.toContain('06:26 UTC')
    expect(r.structuredContent.alerts).toHaveLength(2)
  })
})

describe('MCP server: round 2 of Nov 10, 2026, night (sixty in all)', () => {
  beforeEach(() => { asked = [] })

  it('chokepoints_news ranks the chokepoints by the reports naming them, with their newest headline', async () => {
    const app = await build()
    const r = await call(app, 'chokepoints_news', { days: 3 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/chokepoints?days=3'])
    const text = r.content[0].text as string
    expect(text).toContain("The shipping chokepoints named in the last 3 days' news reports (WorldPulse), the most first:")
    expect(text).toContain('1. Strait of Hormuz: 42 reports, 20 verified\n   Newest verified: Tanker hit near the Strait of Hormuz (3h ago)')
    expect(text).toContain('2. Suez Canal: 5 reports, 1 verified\n   Newest: Suez Canal traffic recovers')
    expect(text).toContain('Not named: Lombok Strait.')
  })

  it("exploited_vulnerabilities lists CISA's newest catalogue entries, one maker's when asked", async () => {
    const app = await build()
    const r = await call(app, 'exploited_vulnerabilities', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/vulnerabilities?days=30'])
    expect(r.content[0].text).toContain("2 new entries in CISA's Known Exploited Vulnerabilities catalogue in the last 30 days, 1 known to be used in ransomware, newest first:")
    expect(r.content[0].text).toContain('2. CVE-2026-111560: Barracuda Networks OS Command Injection (used in ransomware) · added 2026-11-05')
    const one = await call(app, 'exploited_vulnerabilities', { vendor: 'Google' })
    expect(one.structuredContent.vulnerabilities.map((v: { cve: string }) => v.cve)).toEqual(['CVE-2026-125350'])
  })

  it("travel_advice lists the level 4 and 3 countries, or gives one country's level and notices", async () => {
    const app = await build()
    const all = await call(app, 'travel_advice', {})
    expect(all.content[0].text).toContain('- Level 4, do not travel (2): Iran, Venezuela')
    expect(all.content[0].text).toContain('- Level 3, reconsider travel (1): Nigeria')
    expect(all.content[0].text).toContain('- Level 2: 1 countries · Level 1: 1')
    const iran = await call(app, 'travel_advice', { country: 'ir' })
    expect(asked.map(a => a.url)).toContain('/api/v1/public/travel-advice?country=IR')
    const text = iran.content[0].text as string
    expect(text).toContain('Iran: the US State Department says level 4, do not travel (since 2026-11-03).')
    expect(text).toContain('2. UK Foreign Office: FCDO advice against all travel to Iran (2026-11-02)\n   https://www.gov.uk/foreign-travel-advice/iran')
    expect((await call(app, 'travel_advice', { country: 'KE' })).content[0].text).toContain('Kenya: no US State Department level on record.')
  })

  it('first_reporters ranks the outlets first on a story, each outlet once by name', async () => {
    const app = await build()
    const r = await call(app, 'first_reporters', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/first-reporters?days=7&min_outlets=5'])
    const text = r.content[0].text as string
    expect(text).toContain('of the 40 stories of the last 7 days that 5 or more outlets reported')
    expect(text).toContain('1. BBC: first on 10 (25%) · international, United Kingdom')
    expect(text).toContain('2. Reuters: first on 9 (23%) · news agency, United Kingdom')
    expect(text).toContain('3. unknown.example: first on 1 (3%) · not in the directory')
    expect(r.structuredContent.outlets[0].sites).toEqual(['bbc.co.uk', 'bbc.com'])
  })

  it('verification_speed gives the median time to a second outlet, and the fastest and slowest', async () => {
    const app = await build()
    const r = await call(app, 'verification_speed', { limit: 2 })
    const text = r.content[0].text as string
    expect(text).toContain('3,600 stories turned verified in the last 24 hours (WorldPulse). Half found a second outlet within 47 min of their first report; 55% within an hour, 92% within a day.')
    expect(text).toContain('1. Story 1 · 0 min')
    expect(text).toContain('1. Story 3 · 3 days')
    expect(text).toContain('2. Story 4 · 2 h')
  })

  it('topics_today lists the topics of the news, with their change on the hours before', async () => {
    const app = await build()
    const r = await call(app, 'topics_today', {})
    const text = r.content[0].text as string
    expect(text).toContain("The topics of the last 24 hours' 1,000 news reports (WorldPulse), the most first:")
    expect(text).toContain('1. Politics: 600 (60%), 200 verified (+20% on the 24 hours before)')
    expect(text).toContain('2. Conflict: 300 (30%), 150 verified (-25% on the 24 hours before)')
    expect(text).toContain('3. Sports: 100 (10%), 10 verified')
    expect(text).not.toContain('Space')
  })

  it("outlet_reports lists one outlet's newest reports, with what the directory knows of it", async () => {
    const app = await build()
    const r = await call(app, 'outlet_reports', { site: 'https://www.lemonde.fr/international/' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/outlet-reports?site=lemonde.fr&days=7'])
    const text = r.content[0].text as string
    expect(text).toMatch(/^Le Monde \(national, France\): 31 reports in the last 7 days, newest first:/)
    expect(text).toContain('1. Soudan : reprise des pourparlers\n   Verified · Politics · Sudan · 2h ago')
    expect((await call(app, 'outlet_reports', { site: 'quiet.example' })).content[0].text).toContain('No report from quiet.example (not in WorldPulse\'s outlet directory) in the last 7 days.')
    expect((await call(app, 'outlet_reports', { site: 'nope' })).isError).toBe(true)
  })

  it("region_top_stories asks for a region's stories, and refuses a region it doesn't know", async () => {
    const app = await build()
    const r = await call(app, 'region_top_stories', { region: 'Africa' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=24&limit=8&region=africa'])
    const text = r.content[0].text as string
    expect(text).toContain('The top stories of Africa in the last 24 hours (WorldPulse):')
    expect(text).toContain('1. Migrant boats capsize off Senegal and Greece')
    expect(text).toContain('2. ANC slumps to its worst result')
    expect((await call(app, 'region_top_stories', { region: 'the Middle East' })).content[0].text).toContain('No story of the Middle East')
    expect(asked.map(a => a.url)).toContain('/api/v1/stories?hours=24&limit=8&region=middle-east')
    expect((await call(app, 'region_top_stories', { region: 'Atlantis' })).isError).toBe(true)
  })

  it('rising_stories lists the stories that began in the last hours, the most outlets first', async () => {
    const app = await build()
    const r = await call(app, 'rising_stories', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=6&limit=20'])
    const text = r.content[0].text as string
    expect(text).toContain('1. Trump says the Iran war is effectively over\n   First report 1h ago · 30 outlets already · not verified yet')
    expect(text).toContain('2. Migrant boats capsize off Senegal and Greece\n   First report 2h ago · 12 outlets already · verified')
    expect(text).not.toContain(STORY.title)
  })

  it('thin_coverage lists the places WorldPulse reads few newsrooms in, by region, asking nothing', async () => {
    const app = await build()
    const r = await call(app, 'thin_coverage', { at_most: 0, region: 'oceania' })
    expect(r.isError).toBe(false)
    expect(asked).toEqual([])
    const text = r.content[0].text as string
    expect(text).toMatch(/^\d+ places where WorldPulse reads the feeds of no newsroom based there, in Oceania:/)
    for (const p of r.structuredContent.regions[0].places) expect(p.newsrooms).toBe(0)
    expect((await call(app, 'thin_coverage', { region: 'mars' })).isError).toBe(true)
  })
})

describe('MCP server: round 3 of Nov 10, 2026, night (seventy in all)', () => {
  beforeEach(() => { asked = [] })

  it("sanctions_actions lists a feed's newest reports, with a first line and the government's own notice", async () => {
    const app = await build()
    const r = await call(app, 'sanctions_actions', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/feed-reports?feed=sanctions&days=7'])
    const text = r.content[0].text as string
    expect(text).toContain('New sanctions actions, in the last 7 days: 17 (the newest 2 here), newest first (OFAC and the EU, as WorldPulse reads it):')
    expect(text).toContain('1. OFAC Sanctions: Iran-related Designations\n   Iran · 2026-11-10 · Medium\n   Treasury sanctions 12 people and 4 ships that move Iranian oil.')
    expect(text).toContain('source: https://ofac.treasury.gov/recent-actions/x')
    const ru = await call(app, 'sanctions_actions', { country: 'ru' })
    expect(ru.structuredContent.reports.map((x: { title: string }) => x.title)).toEqual(['EU Council: Russia sanctions amended'])
    expect((await call(app, 'us_weather_alerts', { days: 3 })).isError).toBe(false)
    expect(asked.map(a => a.url)).toContain('/api/v1/public/feed-reports?feed=us-weather&days=3')
  })

  it('carrier_groups gives each carrier once, its latest report', async () => {
    const app = await build()
    const r = await call(app, 'carrier_groups', {})
    const text = r.content[0].text as string
    expect(text).toContain("Where the US Navy's carriers are, in the last 7 days: 2, newest first")
    expect(text).toContain('1. USS Harry S. Truman (CVN-75): Deployment\n   Eastern Mediterranean · 2026-11-11')
    expect(text).toContain('2. USS Theodore Roosevelt (CVN-71): Port Arrival')
    expect(text).not.toContain('OSINT Update')
  })

  it('cyber_attacks and elections_watch rank the countries with the most of that news', async () => {
    const app = await build()
    const r = await call(app, 'cyber_attacks', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/news-watch?watch=cyber&days=7'])
    const text = r.content[0].text as string
    expect(text).toContain('40 news reports about cyber attacks in the last 7 days (WorldPulse). The countries with the most:')
    expect(text).toContain('1. Poland: 12 reports, 5 verified\n   Newest verified: Hackers hit Polish water utility (5h ago)')
    expect(text).toContain('2. France: 3 reports, 0 verified')
    expect(text).toContain('Newest of all: Ransomware gang leaks hospital data (1h ago, not verified yet)')
    expect((await call(app, 'elections_watch', { days: 14 })).isError).toBe(false)
    expect(asked.map(a => a.url)).toContain('/api/v1/public/news-watch?watch=elections&days=14')
    expect((await call(app, 'disaster_news', {})).content[0].text).toBe('No news report about disasters in the last 7 days.')
  })

  it("state_media_stories looks at each top story's outlets and puts the most state-carried first", async () => {
    const app = await build()
    const r = await call(app, 'state_media_stories', {})
    // (the stand-in story route notes only the Krakow story's asks)
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=24&limit=10', `/api/v1/stories/${WORLD_REPORT}`])
    const text = r.content[0].text as string
    // Krakow: TASS and TVP World of 6 outlets (BBC once), Doha: none of 2
    expect(text).toContain('1. Six killed in Krakow shooting\n   2 of 6 outlets are state media (33%): TASS (Russia), TVP World (Poland)')
    expect(text).toContain(`2. ${STORY.title}\n   0 of 2 outlets are state media (0%)`)
  })

  it("country_topics counts one country's topics", async () => {
    const app = await build()
    const r = await call(app, 'country_topics', { country: 'ng' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/topics?hours=24&country=NG'])
    const text = r.content[0].text as string
    expect(text).toContain("What Nigeria's news is about: the last 24 hours' 40 reports placed there (WorldPulse), the most first:")
    expect(text).toContain('1. Security: 30 (75%), 10 verified (+50% on the 24 hours before)')
    expect(text).toContain('2. Elections: 10 (25%), 2 verified')
    expect((await call(app, 'country_topics', { country: 'XX' })).isError).toBe(true)
  })

  it('busiest_outlets ranks the outlets by their reports, each outlet once by name', async () => {
    const app = await build()
    const r = await call(app, 'busiest_outlets', {})
    const text = r.content[0].text as string
    expect(text).toContain('The outlets WorldPulse read the most from in the last 24 hours (18,000 news reports in all), the most first:')
    expect(text).toContain('1. BBC: 180 reports, 110 verified · international, United Kingdom')
    expect(text).toContain('2. TASS: 150 reports, 30 verified · news agency, Russia, state media')
  })

  it("local_only_stories keeps a country's stories that only its own outlets report", async () => {
    const app = await build()
    const r = await call(app, 'local_only_stories', { country: 'pl' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=24&limit=20&country=PL'])
    const text = r.content[0].text as string
    expect(text).toContain('1. Strike at the Gdańsk shipyard\n   3 outlets, all based there: TVN24, Onet, Notes from Poland')
    expect(text).not.toContain('Krakow shooting')
    expect(text).not.toContain('Village fair')
    expect(text).not.toContain('A world story with a Polish pin')
  })
})

describe('MCP server: round 4 of Nov 10, 2026, night (eighty in all)', () => {
  beforeEach(() => { asked = [] })

  it("numbers_differ reads each top story's figures and lists those with more than one value", async () => {
    const app = await build()
    const r = await call(app, 'numbers_differ', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=24&limit=10', `/api/v1/stories/${STORY.leadId}/figures`, `/api/v1/stories/${WORLD_REPORT}/figures`])
    const text = r.content[0].text as string
    expect(text).toContain(`1. ${STORY.title}\n   Killed: 6 (50 outlets) · 9 (3 outlets)`)
    expect(text).not.toContain('Injured')
    expect(r.structuredContent.looked).toBe(2)
  })

  it('long_running_stories puts the oldest of the top stories first', async () => {
    const app = await build()
    const r = await call(app, 'long_running_stories', {})
    const text = r.content[0].text as string
    expect(text).toContain('1. Migrant boats capsize off Senegal and Greece\n   Running for 9 days')
    expect(text).toContain(`2. ${STORY.title}\n   Running for 30 hours · 14 outlets in its last two days, 300 since it began`)
    expect(text.indexOf('Trump says')).toBeGreaterThan(text.indexOf(STORY.title))
  })

  it('news_by_hour lists the hours with the busiest and the most serious', async () => {
    const app = await build()
    const r = await call(app, 'news_by_hour', { hours: 3 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/news-by-hour?hours=3'])
    const text = r.content[0].text as string
    expect(text).toContain('2026-11-10 22:00 UTC: 900 · 150 verified · 80 serious')
    expect(text).toContain('Busiest: 2026-11-10 22:00 UTC (900). Most serious reports: 2026-11-10 22:00 UTC (80).')
  })

  it('serious_places ranks the countries by their serious reports', async () => {
    const app = await build()
    const r = await call(app, 'serious_places', {})
    const text = r.content[0].text as string
    expect(text).toContain('1. Ukraine: 120 serious (20 critical), 60 verified\n   Newest verified: Missile strike on Kharkiv (Critical, 2h ago)')
    expect(text).toContain('2. Sudan: 40 serious (5 critical), 0 verified')
  })

  it('state_media_outlets and outlet_languages read the directory, asking nothing', async () => {
    const app = await build()
    const ru = await call(app, 'state_media_outlets', { country: 'ru' })
    expect(asked).toEqual([])
    expect(ru.content[0].text).toContain('TASS (news agency')
    expect(ru.structuredContent.countries[0].code).toBe('RU')
    const all = await call(app, 'state_media_outlets', {})
    expect(all.structuredContent.outlets).toBeGreaterThan(5)
    const langs = await call(app, 'outlet_languages', { limit: 3 })
    expect(langs.content[0].text).toMatch(/^The languages of the [\d,]+ newsrooms WorldPulse reads the feeds of/)
    expect(langs.structuredContent.languages[0].code).toBe('en')
  })

  it('how_worldpulse_counts explains verified, and worldpulse_status reads the status and the counts', async () => {
    const app = await build()
    const how = await call(app, 'how_worldpulse_counts', {})
    expect(how.content[0].text).toContain('Verified means more than one outlet says so, not that every detail is proven true.')
    const st = await call(app, 'worldpulse_status', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/status', '/api/v1/signals/count'])
    expect(st.content[0].text).toContain('WorldPulse is operational')
    expect(st.content[0].text).toContain('- Scraper: operational (Newest report under a minute ago)')
    expect(st.content[0].text).toContain('Reports read: 560 in the last hour, 18,660 in the last 24 hours.')
  })

  it('story_compare sets two stories side by side, and refuses the same story twice', async () => {
    const app = await build()
    const r = await call(app, 'story_compare', { a: STORY.leadId, b: WORLD_REPORT })
    const text = r.content[0].text as string
    expect(text).toContain(`${STORY.title}\n- Outlets: 2 in its last two days, from 2 countries (1 of them Qatar's own)`)
    expect(text).toContain('Six killed in Krakow shooting\n- Outlets: 7 in its last two days, 90 since it began')
    expect(text).toContain('- Languages: English, Polish')
    expect((await call(app, 'story_compare', { a: WORLD_REPORT, b: WORLD_REPORT })).isError).toBe(true)
    expect((await call(app, 'story_compare', { a: WORLD_REPORT, b: 'nope' })).isError).toBe(true)
  })

  it('report_entities lists who and what a report names', async () => {
    const app = await build()
    const r = await call(app, 'report_entities', { id: WORLD_REPORT })
    expect(asked.map(a => a.url)).toContain(`/api/v1/signals/${WORLD_REPORT}/connections?only=entities`)
    expect(r.content[0].text).toContain('1. Kraków (place, in 1,200 reports in all)')
    expect(r.content[0].text).toContain('2. Donald Tusk (person, in 900 reports in all)')
  })
})

describe('MCP server: round 5 of Nov 10, 2026, night (ninety in all)', () => {
  beforeEach(() => { asked = [] })

  it("topic_top_stories asks the stories of one topic, politics as the reader's geopolitics, of a country or a region", async () => {
    const app = await build()
    const r = await call(app, 'topic_top_stories', { topic: 'Sports', country: 'uk' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=24&limit=8&category=sports&country=GB'])
    expect(r.content[0].text).toContain('The top sports stories in the United Kingdom in the last 24 hours, ranked by independent outlets (WorldPulse):\n1. Ceasefire talks resume in Doha')
    asked = []
    const africa = await call(app, 'topic_top_stories', { topic: 'politics', region: 'Africa', hours: 48 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=48&limit=8&category=geopolitics&region=africa'])
    expect(africa.content[0].text).toContain('The top politics stories of Africa in the last 48 hours')
    expect(africa.content[0].text).toContain('ANC slumps to its worst result')
    expect((await call(app, 'topic_top_stories', { topic: 'gossip' })).isError).toBe(true)
  })

  it("whats_new_today keeps the top stories that were not among yesterday's", async () => {
    const app = await build()
    const r = await call(app, 'whats_new_today', {})
    expect(asked.map(a => a.url).sort()).toEqual(['/api/v1/stories/day', '/api/v1/stories?hours=24&limit=20'])
    const text = r.content[0].text as string
    expect(text).toContain("The top stories of the last 24 hours that were not among Monday, November 9's top 1 (UTC), the most outlets first (WorldPulse):\n1. Migrant boats capsize off Senegal and Greece")
    expect(text).toContain('Still running from Monday, November 9: Ceasefire talks resume in Doha (14 outlets)')
    expect(r.structuredContent.new.map((s: { title: string }) => s.title)).not.toContain(STORY.title)
  })

  it('rising_countries ranks the countries by how much their news rose, leaving the small ones out', async () => {
    const app = await build()
    const r = await call(app, 'rising_countries', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/country-changes?days=1'])
    const text = r.content[0].text as string
    expect(text).toContain('1. Nigeria: 60 reports, none before\n2. Sudan: 300 reports, up 200% from 100\n3. United States: 5,000 reports, up 4% from 4,800')
    expect(text).toContain('Fell the most: Ukraine 400 (down 56% from 900)')
    expect(text).not.toContain('Fiji')
  })

  it('entity_compare sets two names side by side with the reports naming both', async () => {
    const app = await build()
    const r = await call(app, 'entity_compare', { a: 'NATO', b: 'NATO Parliamentary Assembly' })
    expect(asked.map(a => a.url)).toContain(`/api/v1/knowledge-graph/entities/${NATO.id}/profile`)
    expect(asked.map(a => a.url)).toContain(`/api/v1/knowledge-graph/entities/${NATO_PA.id}/profile`)
    const text = r.content[0].text as string
    expect(text).toContain('NATO (organisation): 10 reports in the last 24 hours (21 the day before), 178 in the last 7 days\n- Biggest stories: Ceasefire talks resume in Doha (14 outlets)\n- In the news with: Ukraine, United States')
    expect(text).toContain('NATO Parliamentary Assembly (organisation): 2 reports in the last 24 hours (1 the day before), 9 in the last 7 days\n- No story naming it reached two outlets in the last two weeks')
    expect(text).toContain('Named together in 7 reports; the stories naming both: connections with both names.')
    expect((await call(app, 'entity_compare', { a: 'NATO', b: 'North Atlantic Treaty Organization' })).isError).toBe(true)
    expect((await call(app, 'entity_compare', { a: 'NATO', b: 'Zzyzx' })).isError).toBe(true)
  })

  it("outlet_compare and outlet_profile read an outlet's reports, verified share, topics and places", async () => {
    const app = await build()
    const r = await call(app, 'outlet_compare', { a: 'https://www.lemonde.fr/international/x', b: 'bbc.co.uk' })
    expect(asked.map(a => a.url).sort()).toEqual(['/api/v1/public/outlet-reports?site=bbc.co.uk&days=7', '/api/v1/public/outlet-reports?site=lemonde.fr&days=7'])
    const text = r.content[0].text as string
    expect(text).toContain('Le Monde (national, France): 31 reports, 12 verified (39%)\n- Topics: Politics 65%, Conflict 19%, Culture 16%\n- Placed in: France 15, Sudan 3')
    expect(text).toContain('BBC (international, United Kingdom): no report in these days')
    expect((await call(app, 'outlet_compare', { a: 'bbc.co.uk', b: 'www.bbc.co.uk' })).isError).toBe(true)
    const p = await call(app, 'outlet_profile', { site: 'lemonde.fr', days: 7 })
    expect(p.content[0].text).toContain('What Le Monde (national, France) reported in the last 7 days (WorldPulse):\n- Reports: 31, 12 verified (39%)\n- Topics: Politics 65%, Conflict 19%, Culture 16%\n- Placed in: France 15, Sudan 3\n- Newest:\n  Soudan : reprise des pourparlers (2h ago)')
    expect(p.structuredContent).toMatchObject({ site: 'lemonde.fr', reports: 31, verified: 12, outlet: { name: 'Le Monde', country: 'FR' } })
    expect((await call(app, 'outlet_profile', { site: 'bbc.co.uk' })).content[0].text).toBe('No report from BBC (international, United Kingdom) in the last 7 days.')
  })

  it('coverage_stats and find_outlet read the directory, asking nothing', async () => {
    const app = await build()
    const c = await call(app, 'coverage_stats', {})
    const g = await call(app, 'find_outlet', { query: 'guardian' })
    expect(asked).toEqual([])
    expect(c.content[0].text).toMatch(/^WorldPulse reads the feeds of [\d,]+ newsrooms in [\d,]+ countries and territories, in \d+ languages/)
    expect(c.content[0].text).toMatch(/\n- Africa: [\d,]+ newsrooms; \d+ of its 58 countries/)
    expect(c.structuredContent.regions).toHaveLength(6)
    expect(c.structuredContent.newsrooms).toBeGreaterThan(300)
    expect(g.content[0].text).toContain('1. The Guardian (theguardian.com): national, United Kingdom, in English')
    expect(g.content[0].text).toContain('Mail & Guardian (mg.co.za)')
    const ng = await call(app, 'find_outlet', { query: 'guardian', country: 'za' })
    expect(ng.structuredContent.outlets.map((o: { name: string }) => o.name)).toEqual(['Mail & Guardian'])
    expect((await call(app, 'find_outlet', { query: 'zzqzzq' })).content[0].text).toContain('No outlet in WorldPulse\'s directory matches "zzqzzq"')
    expect((await call(app, 'find_outlet', { query: 'x' })).isError).toBe(true)
  })

  it('world_today puts the counts, the biggest stories, the serious places and the topics in one answer', async () => {
    const app = await build()
    const r = await call(app, 'world_today', {})
    expect(asked.map(a => a.url).sort()).toEqual(['/api/v1/public/serious-places?hours=24', '/api/v1/public/topics?hours=24', '/api/v1/signals/count', '/api/v1/stories?hours=24&limit=5'])
    const text = r.content[0].text as string
    expect(text).toContain('The world in the last 24 hours (WorldPulse): 18,660 reports read from 1,862 outlets; 3,600 turned verified. It covers 202 countries and territories (199 had news in that time).')
    expect(text).toContain('The biggest stories:\n1. Ceasefire talks resume in Doha')
    expect(text).toContain('The most serious news (critical and high severity): Ukraine 120 (20 critical), Sudan 40 (5 critical)')
    expect(text).toContain('The news by topic: Politics 60%, Conflict 30%, Sports 10%')
  })

  it("region_snapshot keeps the region's countries of the counts and the serious places", async () => {
    const app = await build()
    const r = await call(app, 'region_snapshot', { region: 'Africa' })
    expect(asked.map(a => a.url).sort()).toEqual(['/api/v1/public/country-changes?days=1', '/api/v1/public/serious-places?hours=24', '/api/v1/stories?hours=24&limit=5&region=africa'])
    const text = r.content[0].text as string
    expect(text).toContain('Africa in the last 24 hours (WorldPulse):\n\nTop stories:\n1. Migrant boats capsize off Senegal and Greece')
    expect(text).toContain('Its countries with the most news reports (change on the 24 hours before): Sudan 300 (+200%), Nigeria 60')
    expect(text).toContain('The most serious news (critical and high severity): Sudan 40 (5 critical)')
    expect(text).not.toContain('Ukraine')
    expect(text).not.toContain('United States')
    expect((await call(app, 'region_snapshot', { region: 'Atlantis' })).isError).toBe(true)
  })
})

describe('MCP server: round 6 of Nov 10, 2026, night (a hundred in all)', () => {
  beforeEach(() => { asked = [] })

  it('most_global_stories puts the stories with outlets from the most countries first', async () => {
    const app = await build()
    const r = await call(app, 'most_global_stories', {})
    expect(asked.map(a => a.url)).toEqual(['/api/v1/stories?hours=24&limit=20'])
    const text = r.content[0].text as string
    expect(text).toContain('1. Trump says the Iran war is effectively over\n   Outlets from 36 countries · 71 outlets · not verified yet')
    expect(text.indexOf('A story with no home country')).toBeLessThan(text.indexOf('Migrant boats'))
    expect(text.indexOf('Migrant boats')).toBeLessThan(text.indexOf(STORY.title))
  })

  it("country_rank gives a country's place among the countries in the news, with its neighbours", async () => {
    const app = await build()
    const r = await call(app, 'country_rank', { country: 'sd' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/country-changes?days=1'])
    expect(r.content[0].text).toBe('Sudan is number 3 of 5 countries in the news in the last 24 hours (WorldPulse): 300 news reports placed there, 5% of all, up 200% on the 24 hours before (100).\nJust above: United States (5,000), Ukraine (400).\nJust below: Nigeria (60), Fiji (5).')
    expect((await call(app, 'country_rank', { country: 'aq' })).content[0].text).toBe('No news report placed in Antarctica in the last 24 hours.')
    // "The United States is number 1", with its "the"
    expect((await call(app, 'country_rank', { country: 'us' })).content[0].text).toMatch(/^The United States is number 1 of 5 countries/)
  })

  it("compare_regions adds up each region's countries", async () => {
    const app = await build()
    const r = await call(app, 'compare_regions', { a: 'africa', b: 'europe' })
    expect(asked.map(a => a.url).sort()).toEqual(['/api/v1/public/country-changes?days=1', '/api/v1/public/serious-places?hours=24', '/api/v1/stories?hours=24&limit=3&region=africa', '/api/v1/stories?hours=24&limit=3&region=europe'])
    const text = r.content[0].text as string
    expect(text).toContain('Africa: 360 news reports (+260% on the 24 hours before), 40 serious (5 critical)\n- Busiest: Sudan 300, Nigeria 60\n- Top stories: Migrant boats capsize off Senegal and Greece (44 outlets); ANC slumps to its worst result (29 outlets)')
    expect(text).toContain('Europe: 400 news reports (-56% on the 24 hours before), 120 serious (20 critical)\n- Busiest: Ukraine 400\n- No story reached two outlets')
    expect((await call(app, 'compare_regions', { a: 'asia', b: 'Asia' })).isError).toBe(true)
    expect((await call(app, 'compare_regions', { a: 'asia', b: 'mars' })).isError).toBe(true)
  })

  it("topic_countries lists where one topic's news is placed, politics as the reader's geopolitics", async () => {
    const app = await build()
    const r = await call(app, 'topic_countries', { topic: 'health' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/topic-countries?topic=health&days=1'])
    expect(r.content[0].text).toContain('Where health news came from in the last 24 hours (WorldPulse; 500 news reports placed in a country), the most first:\n1. United States: 200 (40%), 50 verified\n2. India: 100 (20%), 10 verified')
    asked = []
    await call(app, 'topic_countries', { topic: 'politics', days: 3 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/topic-countries?topic=geopolitics&days=3'])
  })

  it("who_reports_on puts an outlet's websites together and its own press against the rest; country_languages gives the shares", async () => {
    const app = await build()
    const r = await call(app, 'who_reports_on', { country: 'sd' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/country-coverage?country=SD&days=7'])
    const text = r.content[0].text as string
    expect(text).toContain('The outlets reporting the most on Sudan in the last 7 days (WorldPulse; 1,000 news reports placed there, 300 verified):')
    expect(text).toContain('1. Al Jazeera (aljazeera.com): 200 reports, 120 verified · international, Qatar')
    expect(text).toContain('2. BBC (bbc.co.uk, bbc.com): 150 reports, 110 verified · international, United Kingdom')
    expect(text).toContain('3. Radio Dabanga (dabangasudan.org): 80 reports, 20 verified · national, Sudan')
    expect(text).toContain('4. unknown.example: 10 reports, 0 verified · not in the outlet directory')
    expect(text).toContain("Of the reports of the 5 busiest websites, 18% come from Sudan's own press and 82% from elsewhere.")
    const l = await call(app, 'country_languages', { country: 'SD' })
    expect(l.content[0].text).toContain('1. English: 60% (600)\n2. Arabic: 35% (350)\n3. French: 5% (50)')
    expect((await call(app, 'who_reports_on', { country: 'aq' })).content[0].text).toBe('No news report placed in Antarctica in the last 7 days.')
  })

  it('news_by_day and topic_trend list the days, the busiest finished day and the last 7 against the 7 before', async () => {
    const app = await build()
    const r = await call(app, 'news_by_day', { days: 2 })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/news-by-day?days=2'])
    const text = r.content[0].text as string
    expect(text).toContain('(today so far): 4,000 · 700 verified · 200 serious')
    expect(text).toMatch(/Busiest day: [A-Z][a-z]{2} \d{1,2} \(19,000\)\./)
    expect(text).not.toContain('The last 7 days')
    const t = await call(app, 'topic_trend', { topic: 'elections' })
    expect(asked.at(-1)!.url).toBe('/api/v1/public/news-by-day?days=14&topic=elections')
    expect(t.content[0].text).toContain('Elections news reports day by day (UTC, WorldPulse):')
    expect(t.content[0].text).toContain('The last 7 days: 140; the 7 before: 70 (+100%).')
    expect((await call(app, 'topic_trend', { topic: 'gossip' })).isError).toBe(true)
  })

  it("region_topics asks the topics of a region's countries", async () => {
    const app = await build()
    const r = await call(app, 'region_topics', { region: 'Africa' })
    expect(asked.map(a => a.url)).toEqual(['/api/v1/public/topics?hours=24&region=africa'])
    expect(r.content[0].text).toContain("The topics of Africa's 100 news reports of the last 24 hours (WorldPulse; change on the 24 hours before), the most first:\n1. Elections: 50 (50%), 10 verified (+100%)\n2. Conflict: 50 (50%), 20 verified")
  })

  it('tool_guide puts every tool under one kind, and the closest to a question first', async () => {
    const app = await build()
    const r = await call(app, 'tool_guide', { question: 'Who reports on Sudan?' })
    expect(asked).toEqual([])
    expect(r.structuredContent.closest[0].name).toBe('who_reports_on')
    const listed = r.structuredContent.kinds.flatMap((k: { tools: string[] }) => k.tools).sort()
    const { tools } = (await rpc(app, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).json().result
    expect(listed).toEqual(tools.map((t: { name: string }) => t.name).sort())
    expect(r.content[0].text).toContain("WorldPulse's 100 tools by kind:")
    const plain = await call(app, 'tool_guide', {})
    expect(plain.content[0].text).toMatch(/^WorldPulse's 100 tools by kind:\n- The news now: world_today, top_stories/)
  })
})

describe('MCP server: smaller tool sets on their own addresses (Nov 10, 2026)', () => {
  beforeEach(() => { asked = [] })
  const at = (app: FastifyInstance, set: string, body: unknown) =>
    app.inject({ method: 'POST', url: `/mcp/${set}`, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, payload: JSON.stringify(body) })
  const namesAt = async (app: FastifyInstance, set: string) =>
    ((await at(app, set, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json().result.tools as Array<{ name: string }>).map(t => t.name)

  it('keeps each set to 40 tools at most, and every tool in one of the topic sets', async () => {
    const app = await build()
    const all = ((await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json().result.tools as Array<{ name: string }>).map(t => t.name)
    const seen = new Set<string>()
    for (const id of Object.keys(TOOL_SETS)) {
      const names = await namesAt(app, id)
      expect(names.length, id).toBeLessThanOrEqual(40)
      expect(new Set(names).size, id).toBe(names.length)
      for (const n of names) expect(all, `${id} ${n}`).toContain(n)
      if (id !== 'essentials') names.forEach(n => seen.add(n))
    }
    expect([...seen].sort()).toEqual([...all].sort())
    expect(await namesAt(app, 'live')).toEqual(expect.arrayContaining(['military_aircraft', 'hazards', 'sanctions_actions', 'tool_guide']))
    expect(await namesAt(app, 'news')).not.toContain('military_aircraft')
  })

  it('says which set it is, refuses a tool of another set with where to find it, and a set it does not have', async () => {
    const app = await build()
    const init = (await at(app, 'live', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json().result
    expect(init.serverInfo.title).toBe('WorldPulse: live layers and government feeds')
    expect(init.instructions).toMatch(/This address has \d+ of WorldPulse's 100 tools, live layers and government feeds: tool_guide says which answers what\. All of them: https:\/\/api\.world-pulse\.io\/mcp\./)
    const wrong = (await at(app, 'live', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'top_stories', arguments: {} } })).json()
    expect(wrong.error.message).toBe('Unknown tool: top_stories (it is at https://api.world-pulse.io/mcp)')
    const ok = (await at(app, 'news', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'top_stories', arguments: {} } })).json()
    expect(ok.result.isError).toBe(false)
    expect((await at(app, 'everything', { jsonrpc: '2.0', id: 4, method: 'tools/list' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/mcp/news' })).statusCode).toBe(405)
  })

  it("offers a set the prompts whose tools it has, and its guide lists the set's own tools", async () => {
    const app = await build()
    const prompts = async (set: string) => ((await at(app, set, { jsonrpc: '2.0', id: 1, method: 'prompts/list' })).json().result.prompts as Array<{ name: string }>).map(p => p.name)
    expect(await prompts('news')).toEqual(['morning_brief', 'check_this_link'])
    expect(await prompts('places')).toEqual(['country_deep_dive'])
    expect(await prompts('essentials')).toEqual(['morning_brief', 'check_this_link', 'country_deep_dive'])
    expect(await prompts('live')).toEqual([])
    const guide = (await at(app, 'live', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tool_guide', arguments: {} } })).json().result
    expect(guide.content[0].text).toMatch(/^The \d+ tools at this address \(live layers and government feeds; all 100 at https:\/\/api\.world-pulse\.io\/mcp\), by kind:\n- Live layers: military_aircraft/)
    expect(guide.content[0].text).not.toContain('top_stories')
  })
})
