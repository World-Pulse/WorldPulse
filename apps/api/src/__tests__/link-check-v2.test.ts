/**
 * Paste a link, version 2 (plan G22; Devon, Oct 21, 2026: "Yes, with
 * safeguards"): a link WorldPulse hasn't collected, found by its page's
 * canonical address or headline. The matching cases are the ones measured on
 * the live search by meaning on Oct 21.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  counts: new Map<string, number>(),
  linkRows: [] as Array<{ id: string }>,
  linkAsked: [] as unknown[],
}))

vi.mock('../db/redis', () => ({
  redis: {
    get: async (k: string) => h.kv.get(k) ?? null,
    setex: async (k: string, _s: number, v: string) => { h.kv.set(k, v); return 'OK' },
    incr: async (k: string) => { const n = (h.counts.get(k) ?? 0) + 1; h.counts.set(k, n); return n },
    expire: async () => 1,
  },
}))
vi.mock('../db/postgres', () => ({ db: Object.assign(() => ({}), { raw: async () => ({ rows: [] }) }) }))
vi.mock('../lib/long-query', () => ({
  longQuery: async (_s: number, run: (trx: { raw: (sql: string, params: unknown[]) => unknown }) => unknown) =>
    run({ raw: async (_sql: string, params: unknown[]) => { h.linkAsked.push(params); return { rows: h.linkRows } } }),
}))
vi.mock('../lib/fingerprint-search', () => ({ searchByMeaning: async () => [] }))

import { headlineOnly, particularWords, bestMatch, lookUpByPage, CLIENT_FETCHES_A_MINUTE } from '../lib/link-check'

beforeEach(() => { h.kv.clear(); h.counts.clear(); h.linkRows = []; h.linkAsked = [] })

describe('headlineOnly', () => {
  it('takes the site\'s name off', () => {
    expect(headlineOnly('Sudan drone strike kills 150 | Reuters', 'Reuters', 'www.reuters.com')).toBe('Sudan drone strike kills 150')
    expect(headlineOnly('Sudan drone strike kills 150 - BBC News', null, 'www.bbc.com')).toBe('Sudan drone strike kills 150')
    expect(headlineOnly('Gaza ceasefire - what we know', null, 'example.com')).toBe('Gaza ceasefire - what we know')
    expect(headlineOnly('Gaza ceasefire holds - AP News', null, 'apnews.com')).toBe('Gaza ceasefire holds')
    expect(headlineOnly('A headline with no site', null, 'example.com')).toBe('A headline with no site')
  })
})

describe('particularWords', () => {
  it('names, places and numbers; every word in a title-case headline', () => {
    expect([...particularWords('Abyei: dozens dead after drone hits crowded market')]).toEqual([])
    expect([...particularWords('Drone strike on market in disputed region of Abyei kills 150')].sort()).toEqual(['150', 'abyei'])
    expect(particularWords('Macron Says Trump Does Not Like France').has('franc')).toBe(true)
  })
})

describe('bestMatch: the same event, not just the same topic', () => {
  it('a rewritten headline finds its story', () => {
    const m = bestMatch('Abyei: dozens dead after drone hits crowded market', [
      { id: 'a', title: 'Drone strike on a market in disputed African region of Abyei kills at least 150', score: 0.664 },
      { id: 'b', title: 'Death toll from Abyei market drone strike rises to more than 220', score: 0.654 },
    ])
    expect(m?.id).toBe('a')
  })
  it('a different place, or only a topic in common, finds nothing', () => {
    expect(bestMatch('Minor flooding closes two roads in rural Vermont after heavy rain', [
      { id: 's', title: 'Roads and cars submerged as heavy rain floods eastern Spain', score: 0.605 },
      { id: 'k', title: 'Roads Authority closes 14 ||Kharas roads due to rain damage', score: 0.554 },
    ])).toBeNull()
    expect(bestMatch('Zoo welcomes twin red panda cubs born last week', [
      { id: 'z', title: 'Henry Vilas Zoo bids farewell to Bandit the red panda', score: 0.637 },
    ])).toBeNull()
  })
  it('of two equally close, the one with the most words in common', () => {
    const m = bestMatch('Macron says Trump does not like France', [
      { id: 'paris', title: "Trump says Paris will soon be 'a Muslim city' under Macron's immigration policy", score: 0.823 },
      { id: 'like', title: 'Macron Says Trump Does Not Like France and Distorts Its Troubles', score: 0.823 },
    ])
    expect(m?.id).toBe('like')
  })
})

describe('lookUpByPage', () => {
  const page = (title: string, extra = '') => async (url: URL) => ({ url: url.toString(), html: `<head><title>${title}</title>${extra}</head>` })
  const abyei = [{ id: '11111111-1111-1111-1111-111111111111', title: 'Drone strike on a market in disputed African region of Abyei kills at least 150', score: 0.66 }]

  it('finds the story by the page\'s headline, and keeps only the headline, 6 hours', async () => {
    const fetchPage = vi.fn(page('Abyei: dozens dead after drone hits crowded market | Example News'))
    const got = await lookUpByPage('https://news.example.com/africa/abyei-1', 'client-1', { fetchPage, similar: async () => abyei })
    expect(got).toMatchObject({ status: 'found', via: 'similar', reportId: abyei[0]!.id, page: { title: 'Abyei: dozens dead after drone hits crowded market' } })
    // asked again: the page isn't opened again
    await lookUpByPage('https://news.example.com/africa/abyei-1?utm_source=x', 'client-1', { fetchPage, similar: async () => abyei })
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect([...h.kv.values()][0]).toBe(JSON.stringify({ title: 'Abyei: dozens dead after drone hits crowded market', site: null, canonical: null }))
  })

  it('by the canonical address when the feed gave that one', async () => {
    h.linkRows = [{ id: '22222222-2222-2222-2222-222222222222' }]
    const got = await lookUpByPage('https://m.example.com/a/1', 'client-1', {
      fetchPage: page('Quake hits coast', '<link rel="canonical" href="https://www.example.com/a/1">'),
      similar: async () => [],
    })
    expect(got).toMatchObject({ status: 'found', via: 'canonical', reportId: '22222222-2222-2222-2222-222222222222' })
  })

  it('says so when it read the headline and has no story like it', async () => {
    const got = await lookUpByPage('https://a.example/x', 'c', { fetchPage: page('Zoo welcomes twin red panda cubs'), similar: async () => [] })
    expect(got).toEqual({ status: 'not_seen', page: { title: 'Zoo welcomes twin red panda cubs', site: null, canonical: null } })
  })

  it('never opens a private address, and remembers a page it couldn\'t read', async () => {
    const fetchPage = vi.fn(async () => { throw new Error('boom') })
    expect(await lookUpByPage('http://192.168.1.1/admin', 'c', { fetchPage })).toEqual({ status: 'unreadable', reason: 'not_public' })
    expect(fetchPage).not.toHaveBeenCalled()
    expect(await lookUpByPage('https://a.example/broken', 'c', { fetchPage })).toEqual({ status: 'unreadable', reason: 'unreachable' })
    await lookUpByPage('https://a.example/broken', 'c', { fetchPage })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('opens at most a few pages a minute for one client', async () => {
    const fetchPage = vi.fn(page('Something happened somewhere'))
    for (let i = 0; i < CLIENT_FETCHES_A_MINUTE; i++) {
      expect((await lookUpByPage(`https://a.example/p${i}`, 'busy-client', { fetchPage, similar: async () => [], now: new Date('2026-10-21T16:00:10Z') })).status).toBe('not_seen')
    }
    expect(await lookUpByPage('https://a.example/one-more', 'busy-client', { fetchPage, similar: async () => [], now: new Date('2026-10-21T16:00:40Z') })).toEqual({ status: 'busy' })
    expect(fetchPage).toHaveBeenCalledTimes(CLIENT_FETCHES_A_MINUTE)
  })
})
