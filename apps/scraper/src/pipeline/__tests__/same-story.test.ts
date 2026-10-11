/**
 * Corroboration only counts independent reports of the same story.
 *
 * On Oct 10, 2026 the correlation engine went live for the first time in months
 * and verified unrelated single-source stories that merely shared an hour and a
 * related category. These tests pin down the stricter rule.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const updates: Array<{ ids: string[]; data: Record<string, unknown> }> = []
  const state = {
    recentRows: [] as Record<string, unknown>[],   // the 200 newest signals
    textRows: [] as Record<string, unknown>[],     // headline-word search over the window
    firstRow: undefined as Record<string, unknown> | undefined,  // .first() lookups
    textQueries: [] as string[],
  }
  function builder() {
    let ids: string[] = []
    let mode: 'rows' | 'text' | 'first' = 'rows'
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'whereNot', 'orderBy', 'limit']) b[m] = () => b
    b.where = (col: unknown, val: unknown) => { if (col === 'id' && typeof val === 'string') ids = [val]; return b }
    b.whereIn = (_col: string, list: string[]) => { ids = list; return b }
    b.whereRaw = (_sql: string, params: string[]) => { mode = 'text'; state.textQueries.push(params[0]); return b }
    b.orderByRaw = () => b
    b.first = () => { mode = 'first'; return b }
    b.update = (data: Record<string, unknown>) => { updates.push({ ids, data }); return Promise.resolve(ids.length) }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(mode === 'first' ? state.firstRow : mode === 'text' ? state.textRows : state.recentRows).then(res, rej)
    return b
  }
  return { updates, state, builder }
})

vi.mock('../../lib/postgres', () => {
  const db = Object.assign(vi.fn(() => h.builder()), { raw: vi.fn((sql: string) => ({ sql })) })
  return { db }
})
vi.mock('../../lib/redis', () => {
  const pipe = { setex: () => pipe, zadd: () => pipe, zremrangebyrank: () => pipe, exec: async () => [] }
  return { redis: { get: vi.fn(async () => null), pipeline: () => pipe } }
})
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { isSameStory, correlateSignal, corroborateWithDuplicate, confirmMergedArticle, namesDiffer, type CorrelationCandidate } from '../correlate'

const now = new Date('2026-10-10T15:40:00Z')

function sig(over: Partial<CorrelationCandidate> = {}): CorrelationCandidate {
  return {
    id: 'sig-a', title: 'Magnitude 6.1 earthquake strikes off the coast of northern Japan',
    category: 'disaster', severity: 'high', source_id: 'nhk.or.jp', location_name: null,
    lat: null, lng: null, published_at: now.toISOString(), reliability_score: 0.7, tags: [],
    ...over,
  }
}

/** A stored signal row the way fetchRecentSignals reads it from the database */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sig-b', title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast',
    category: 'disaster', severity: 'high', source_id: null, first_url: 'https://www.reuters.com/world/asia/x',
    location_name: null, reliability_score: 0.7, tags: [], published_at: now.toISOString(), lat: null, lng: null,
    ...over,
  }
}

describe('isSameStory', () => {
  it('matches two outlets reporting the same event', () => {
    expect(isSameStory(sig(), sig({ id: 'b', source_id: 'reuters.com',
      title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast' }))).toBe(true)
  })

  it('never matches the same outlet, or an unknown one', () => {
    const other = sig({ id: 'b', title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast' })
    expect(isSameStory(sig(), other)).toBe(false)
    expect(isSameStory(sig(), { ...other, source_id: '' })).toBe(false)
  })

  it('does not match different stories that share a few words', () => {
    expect(isSameStory(
      sig({ title: 'Russia launches massive drone attack on Kyiv overnight', category: 'conflict' }),
      sig({ id: 'b', source_id: 'bbc.co.uk', title: 'Ukraine launches drone attack on Russian oil refinery', category: 'conflict' }),
    )).toBe(false)
    expect(isSameStory(
      sig({ title: 'Nobel peace laureate says US sanctions on ICC unacceptable', category: 'economy' }),
      sig({ id: 'b', source_id: 'aljazeera.com', title: 'Global carbon market leaders set their sights on Kigali', category: 'economy' }),
    )).toBe(false)
  })

  it('ignores short or templated headlines', () => {
    expect(isSameStory(
      sig({ title: 'Protest in Mahila, Rajasthan, India' }),
      sig({ id: 'b', source_id: 'thehindu.com', title: 'Protest in Jaipur, Rajasthan, India' }),
    )).toBe(false)
  })

  it('does not match reports far apart on the map or outside the time window', () => {
    const b = sig({ id: 'b', source_id: 'reuters.com', title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast' })
    expect(isSameStory(sig({ lat: 40.8, lng: 141.6 }), { ...b, lat: 33.6, lng: 130.4 })).toBe(false) // Aomori vs Fukuoka
    expect(isSameStory(sig({ lat: 40.8, lng: 141.6 }), { ...b, lat: 40.5, lng: 141.9 })).toBe(true)
    expect(isSameStory(sig(), { ...b, published_at: new Date(now.getTime() - 30 * 3600_000).toISOString() })).toBe(false)
  })
})

describe('correlateSignal corroboration', () => {
  beforeEach(() => {
    h.updates.length = 0
    h.state.textRows = []
    h.state.textQueries.length = 0
  })

  it('does not boost or verify anything for merely related signals', async () => {
    h.state.recentRows = [
      row({ id: 'sig-x', title: 'Volcano on Iceland peninsula erupts again, flights unaffected', first_url: 'https://www.bbc.co.uk/news/y' }),
      row({ id: 'sig-y', title: 'Wildfire forces evacuations in southern California hills', first_url: 'https://apnews.com/z' }),
    ]
    await correlateSignal(sig())
    expect(h.updates).toEqual([])
  })

  it('boosts and verifies only the signal and its same-story report', async () => {
    h.state.recentRows = [
      row(),
      row({ id: 'sig-x', title: 'Volcano on Iceland peninsula erupts again, flights unaffected', first_url: 'https://www.bbc.co.uk/news/y' }),
    ]
    await correlateSignal(sig())
    expect(h.updates).toHaveLength(2)
    const [boost, promote] = h.updates
    expect(boost.ids).toEqual(['sig-a', 'sig-b'])
    expect(boost.data.source_count).toBe(2)
    expect(promote.ids).toEqual(['sig-a', 'sig-b'])
    expect(promote.data.status).toBe('verified')
  })
})

describe('same-story search across the whole window', () => {
  beforeEach(() => {
    h.updates.length = 0
    h.state.recentRows = []
    h.state.textRows = []
    h.state.textQueries.length = 0
  })

  it('searches by headline words and corroborates a match older than the newest 200 signals', async () => {
    h.state.textRows = [row({ id: 'sig-old', first_url: 'https://apnews.com/article/quake',
      published_at: new Date(now.getTime() - 5 * 3600_000).toISOString() })]
    await correlateSignal(sig())
    expect(h.state.textQueries[0].split(' | ')).toEqual(
      expect.arrayContaining(['magnitude', 'earthquake', 'strikes', 'coast', 'northern', 'japan']))
    expect(h.updates[0].ids).toEqual(['sig-a', 'sig-old'])
    expect(h.updates[1].data.status).toBe('verified')
  })

  it('does not search on headlines too short to compare', async () => {
    await correlateSignal(sig({ title: 'Protest in Delhi' }))
    expect(h.state.textQueries).toEqual([])
  })
})

describe('same-story groups share their links', () => {
  beforeEach(() => {
    h.updates.length = 0
    h.state.textRows = []
    h.state.textQueries.length = 0
  })

  it("gives every member the group's article links", async () => {
    h.state.recentRows = [row()]
    await correlateSignal(sig({ url: 'https://www3.nhk.or.jp/news/quake' }))
    expect(h.updates).toHaveLength(3)
    const share = h.updates[2]
    expect(share.ids).toEqual(['sig-a', 'sig-b'])
    expect(share.data).toHaveProperty('original_urls')
  })

  it('does not touch links when only one link is known', async () => {
    h.state.recentRows = [row()]
    await correlateSignal(sig())  // no url on the new signal
    expect(h.updates).toHaveLength(2)
  })
})

describe('corroborateWithDuplicate', () => {
  const incoming = {
    title: 'Strong magnitude 6.1 earthquake hits off northern Japan coast', category: 'disaster', severity: 'high',
    source_id: 'reuters.com', url: 'https://www.reuters.com/world/asia/quake', lat: null, lng: null,
    published_at: now.toISOString(),
  }
  beforeEach(() => {
    h.updates.length = 0
    h.state.firstRow = {
      id: 'sig-held', title: 'Magnitude 6.1 earthquake strikes off the coast of northern Japan',
      category: 'disaster', severity: 'high', source_ids: [], original_urls: ['https://www3.nhk.or.jp/news/quake'],
      published_at: now.toISOString(), lat: null, lng: null,
    }
  })

  it('credits the held signal with a second outlet and verifies it when it qualifies', async () => {
    expect(await corroborateWithDuplicate('sig-held', incoming)).toBe(true)
    expect(h.updates).toHaveLength(2)
    expect(h.updates[0].ids).toEqual(['sig-held'])
    expect(Object.keys(h.updates[0].data)).toEqual(
      expect.arrayContaining(['source_count', 'reliability_score', 'last_corroborated_at', 'original_urls']))
    expect(h.updates[1].data.status).toBe('verified')
  })

  it('does not count an outlet twice', async () => {
    expect(await corroborateWithDuplicate('sig-held', { ...incoming, source_id: 'nhk.or.jp', url: 'https://www3.nhk.or.jp/news/other' })).toBe(false)
    h.state.firstRow = { ...h.state.firstRow!, original_urls: ['https://www3.nhk.or.jp/news/quake', 'https://www.reuters.com/a'] }
    expect(await corroborateWithDuplicate('sig-held', incoming)).toBe(false)
    expect(h.updates).toEqual([])
  })

  it('does not credit a different story or a missing signal', async () => {
    expect(await corroborateWithDuplicate('sig-held', { ...incoming, title: 'Typhoon forces flight cancellations across southern Japan airports' })).toBe(false)
    h.state.firstRow = undefined
    expect(await corroborateWithDuplicate('sig-gone', incoming)).toBe(false)
    expect(h.updates).toEqual([])
  })
})

describe('different places and names are different stories', () => {
  it('rejects headlines that name different known places', () => {
    expect(isSameStory(
      sig({ title: 'Explosion hits Kherson market, killing five people' }),
      sig({ id: 'b', source_id: 'bbc.co.uk', title: 'Explosion hits Kyiv market, killing five people' }),
    )).toBe(false)
  })

  it('namesDiffer: a name each headline has that the other lacks', () => {
    expect(namesDiffer('Russia launches massive drone attack on Kyiv', 'Russia launches massive drone attack on Odesa')).toBe(true)
    expect(namesDiffer('Russia Launches Massive Drone Attack On Kyiv', 'Russia Launches Massive Drone Attack On Odesa')).toBe(true)
    expect(namesDiffer('Christa Pike discharged from hospital and returned to prison',
      'Tennessee execution survivor Christa Pike released from hospital')).toBe(false)
    expect(namesDiffer('Strikes hit Al-Shifa hospital in Gaza', 'Israeli strikes hit Al-Shifa hospital, Gaza officials say')).toBe(false)
    expect(namesDiffer('Massive Drone Attack Hits Kyiv Overnight', 'Massive drone attack hits Kyiv overnight, officials say')).toBe(false)
    expect(namesDiffer('Talks resume as Iran\u2019s envoy meets Oman mediators', "Iran's envoy meets Oman mediators as talks resume")).toBe(false)
  })
})

describe('confirmMergedArticle', () => {
  beforeEach(() => {
    h.updates.length = 0
    h.state.firstRow = {
      id: 'sig-held', title: 'Russia launches massive drone attack on Kyiv overnight, officials say',
      category: 'conflict', severity: 'high', source_ids: ['feed-1'], original_urls: ['https://www.reuters.com/a', 'https://apnews.com/b'],
      published_at: now.toISOString(), lat: null, lng: null,
    }
  })

  it('confirms the same story from a new outlet and verifies it when it qualifies', async () => {
    expect(await confirmMergedArticle('sig-held', {
      title: 'Russia launches massive drone attack on Kyiv overnight', source_id: 'apnews.com', published_at: now,
    })).toBe(true)
    expect(h.updates).toHaveLength(2)
    expect(Object.keys(h.updates[0].data)).toEqual(['reliability_score', 'last_corroborated_at'])
    expect(h.updates[1].data.status).toBe('verified')
  })

  it('does not confirm a topic-hash collision about another city', async () => {
    expect(await confirmMergedArticle('sig-held', {
      title: 'Russia launches massive drone attack on Odesa overnight, officials say', source_id: 'apnews.com', published_at: now,
    })).toBe(false)
    expect(h.updates).toEqual([])
  })
})

describe('GDELT event-label titles', () => {
  it('recognises "<label> in <place>" titles but not headlines that start the same way', async () => {
    const { isEventTemplateTitle } = await import('../event-titles')
    expect(isEventTemplateTitle('Armed conflict in Washington, District of Columbia, United States')).toBe(true)
    expect(isEventTemplateTitle('Disapproval in White House, District of Columbia, United States')).toBe(true)
    expect(isEventTemplateTitle('Consultation in Sydney, New South Wales, Australia')).toBe(true)
    expect(isEventTemplateTitle('Assault in Kyyiv, Kyyiv, Misto, Ukraine')).toBe(true)
    expect(isEventTemplateTitle('Protest in Bogotá, Bogota, Distrito Capital de Bogotá, Colombia')).toBe(true)
    expect(isEventTemplateTitle('CAMEO-0841 in Lagos, Lagos, Nigeria')).toBe(true)
    expect(isEventTemplateTitle('Protest in Paris over pension reform turns violent')).toBe(false)
    expect(isEventTemplateTitle('Investigation in Texas finds ICE detainee died of neglect')).toBe(false)
    expect(isEventTemplateTitle('Attack on Riyadh airport leaves 12 dead')).toBe(false)
    expect(isEventTemplateTitle(null)).toBe(false)
  })
})

describe('isSameStory with GDELT event-label titles', () => {
  it('never matches two "<label> in <place>" titles, even from different outlets', () => {
    const title = 'Armed conflict in Washington, District of Columbia, United States'
    expect(isSameStory(
      sig({ title, source_id: 'aninews.in', category: 'conflict' }),
      sig({ id: 'b', title, source_id: 'rawstory.com', category: 'conflict' }),
    )).toBe(false)
  })
})
