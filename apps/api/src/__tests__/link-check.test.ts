/**
 * "Paste a link, get the count", version 1 (Oct 20, 2026): an article's
 * address finds its story among the articles WorldPulse has collected, by the
 * news readers' article claims or the reports' own links (lib/link-check.ts,
 * GET /api/v1/stories/by-link). The link itself is never fetched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  claims: new Map<string, string>(),
  linkRows: [] as Array<{ id: string }>,
  storyRows: [] as Array<Record<string, unknown>>,
  sql: [] as string[],
  bindings: [] as unknown[][],
  limits: [] as number[],
  slow: false,
}))

vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => h.claims.get(k) ?? null),
    setex: vi.fn(async () => 'OK'),
  },
}))
vi.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../db/postgres', () => {
  const raw = vi.fn(async (sql: string, bindings: unknown[]) => {
    h.sql.push(sql)
    h.bindings.push(bindings)
    return { rows: /LIKE ANY/.test(sql) ? h.linkRows : h.storyRows }
  })
  return {
    db: Object.assign(
      vi.fn(() => ({ where: () => ({ first: async () => ({ story_id: STORY }) }) })),
      { schema: { hasColumn: vi.fn(async () => true) }, raw },
    ),
  }
})
vi.mock('../lib/long-query', async () => {
  const { db } = await import('../db/postgres')
  return {
    longQuery: vi.fn(async (seconds: number, run: (trx: unknown) => Promise<unknown>) => {
      h.limits.push(seconds)
      if (h.slow) throw new Error('canceling statement due to statement timeout')
      return run({ raw: db.raw })
    }),
  }
})

const STORY = '11111111-1111-4111-8111-111111111111'
const SIGNAL = '22222222-2222-4222-8222-222222222222'
const BBC = 'https://www.bbc.com/news/articles/c4g9xk2v7lzo?at_medium=RSS&at_campaign=rss'
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

const { readLink, articleKey, storedForms, findReport, LINK_DAYS, LINK_SECONDS } = await import('../lib/link-check')
const { registerStoryRoutes } = await import('../routes/stories')

function member(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SIGNAL, title: 'Swimmer, 65, killed in shark attack', status: 'verified', severity: 'high',
    category: 'disaster', reliability_score: '0.9', location_name: 'Sydney',
    original_urls: ['https://www.bbc.com/news/articles/c4g9xk2v7lzo', 'https://www.abc.net.au/news/x'],
    created_at: '2026-10-20T16:13:00Z', verified_at: '2026-10-20T16:40:00Z',
    position: 1, from_end: 1, total: 1, first_verified: '2026-10-20T16:40:00Z',
    outlets: 2, outlet_names: ['abc.net.au', 'bbc.com'],
    ...over,
  }
}

async function check(url?: string) {
  const app = Fastify({ logger: false })
  await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
  return app.inject({ method: 'GET', url: `/api/v1/stories/by-link${url === undefined ? '' : `?url=${encodeURIComponent(url)}`}` })
}

beforeEach(() => {
  h.claims.clear(); h.linkRows = []; h.storyRows = [member()]
  h.sql = []; h.bindings = []; h.limits = []; h.slow = false
})

describe('reading a pasted address', () => {
  it('takes web addresses, with or without https://, and nothing else', () => {
    expect(readLink(BBC)?.hostname).toBe('www.bbc.com')
    expect(readLink('  bbc.com/news/articles/c4g9xk2v7lzo ')?.toString()).toBe('https://bbc.com/news/articles/c4g9xk2v7lzo')
    expect(readLink('https://www.bbc.com/news?a=1&amp;b=2')?.search).toBe('?a=1&b=2')
    for (const bad of ['javascript:alert(1)', 'ftp://example.org/a', 'not a link', 'localhost/x', '', 'x'.repeat(3000)]) {
      expect(readLink(bad)).toBeNull()
    }
  })

  it("keys an article as the news readers do: any spelling of one address, one key", () => {
    // apps/scraper/src/pipeline/dedup.ts hashes "<host without www><path>[?<query without tracking tags, in order>]"
    const key = sha('bbc.com/news/articles/c4g9xk2v7lzo')
    for (const same of [
      BBC,
      'http://bbc.com/news/articles/c4g9xk2v7lzo/',
      'https://www.BBC.com/news/articles/c4g9xk2v7lzo#comments',
      'https://www.bbc.com/news/articles/c4g9xk2v7lzo?utm_source=twitter&at_campaign=other',
    ]) expect(articleKey(readLink(same)!)).toBe(key)
    expect(articleKey(readLink('https://example.org/story.php?lang=en&id=12&utm_medium=rss')!)).toBe(sha('example.org/story.php?id=12&lang=en'))
    expect(articleKey(readLink('https://www.aljazeera.com/')!)).toBeNull()
  })

  it('looks for the forms a report may have stored, with any query, its % and _ taken literally', () => {
    const { exact, anyQuery } = storedForms(readLink('https://www.example.org/100%_news/')!)
    expect(exact).toEqual(expect.arrayContaining([
      'https://example.org/100%_news', 'https://www.example.org/100%_news/', 'http://www.example.org/100%_news',
    ]))
    expect(anyQuery).toContain('https://www.example.org/100\\%\\_news?%')
  })
})

describe('findReport', () => {
  it("finds the report by the readers' article claim first, without asking the database", async () => {
    h.claims.set(`dedup:article:${sha('bbc.com/news/articles/c4g9xk2v7lzo')}`, SIGNAL)
    expect(await findReport('bbc.com/news/articles/c4g9xk2v7lzo')).toEqual({ status: 'found', reportId: SIGNAL, via: 'claim' })
    expect(h.sql).toHaveLength(0)
  })

  it("then by the reports' links over the last two weeks, under a time limit", async () => {
    h.linkRows = [{ id: SIGNAL }]
    expect(await findReport(BBC)).toEqual({ status: 'found', reportId: SIGNAL, via: 'links' })
    expect(h.limits).toEqual([LINK_SECONDS])
    expect(h.bindings[0]![0]).toBe(LINK_DAYS)
    expect(h.bindings[0]![1]).toEqual(expect.arrayContaining(['https://www.bbc.com/news/articles/c4g9xk2v7lzo']))
  })

  it('says when an article is being stored right now, has not been seen, or is no article', async () => {
    h.claims.set(`dedup:article:${sha('bbc.com/news/articles/c4g9xk2v7lzo')}`, 'pending')
    expect(await findReport(BBC)).toEqual({ status: 'pending' })
    h.claims.clear()
    expect(await findReport(BBC)).toEqual({ status: 'not_seen' })
    h.slow = true
    expect(await findReport(BBC)).toEqual({ status: 'not_seen' })
    h.sql = []
    expect(await findReport('https://www.aljazeera.com/')).toEqual({ status: 'not_an_article' })
    expect(await findReport('javascript:alert(1)')).toEqual({ status: 'not_an_article' })
    expect(h.sql).toHaveLength(0)
  })
})

describe('GET /api/v1/stories/by-link', () => {
  it("answers the story with its outlets, as the story's own page counts them", async () => {
    h.claims.set(`dedup:article:${sha('bbc.com/news/articles/c4g9xk2v7lzo')}`, SIGNAL)
    const res = await check(BBC)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      found: true,
      via: 'claim',
      report: {
        id: SIGNAL, title: 'Swimmer, 65, killed in shark attack', outlet: 'bbc.com',
        url: 'https://www.bbc.com/news/articles/c4g9xk2v7lzo', status: 'verified', createdAt: '2026-10-20T16:13:00.000Z',
      },
      story: {
        id: STORY, outlets: 2, outletNames: ['abc.net.au', 'bbc.com'], verified: true, verifiedAt: '2026-10-20T16:40:00.000Z',
        size: 1, firstReportAt: '2026-10-20T16:13:00.000Z', latestReportAt: '2026-10-20T16:13:00.000Z',
      },
      link: `https://world-pulse.io/signals/${SIGNAL}`,
    })
  })

  it("says why when there is nothing to show, and asks for a link when there is none", async () => {
    expect((await check(BBC)).json().data).toEqual({ found: false, reason: 'not_seen' })
    expect((await check('https://www.aljazeera.com/')).json().data).toEqual({ found: false, reason: 'not_an_article' })
    const none = await check()
    expect(none.statusCode).toBe(400)
    expect(none.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect((await check('   ')).statusCode).toBe(400)
  })
})
