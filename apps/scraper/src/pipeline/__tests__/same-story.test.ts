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
    // (a count, or with .returning('id') the rows: the promotion returns the ids it turned verified)
    b.update = (data: Record<string, unknown>) => {
      updates.push({ ids, data })
      return Object.assign(Promise.resolve(ids.length), { returning: () => Promise.resolve(ids.map(id => ({ id }))) })
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(mode === 'first' ? state.firstRow : mode === 'text' ? state.textRows : state.recentRows).then(res, rej)
    return b
  }
  return { updates, state, builder, crossCheck: vi.fn() }
})

vi.mock('../../lib/postgres', () => {
  const raw = vi.fn((sql: string) => ({ sql }))
  const db = Object.assign(vi.fn(() => h.builder()), {
    raw,
    transaction: vi.fn(async (fn: (trx: { raw: typeof raw }) => Promise<void>) => fn({ raw })),
  })
  return { db }
})
vi.mock('../../lib/redis', () => {
  const pipe = { setex: () => pipe, zadd: () => pipe, zremrangebyrank: () => pipe, exec: async () => [] }
  return { redis: { get: vi.fn(async () => null), pipeline: () => pipe } }
})
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
// Ledger's cross-check gets the reports a verification promoted, the ones its gate may hold back (plan D6)
vi.mock('../crosscheck', () => ({ crossCheckLater: (...args: unknown[]) => h.crossCheck(...args) }))

import { isSameStory, correlateSignal, corroborateWithDuplicate, confirmMergedArticle, namesDiffer, corroboratedReliability, RELIABILITY_CEILING, storyWords, takeDates, countryLevelPlace, type CorrelationCandidate } from '../correlate'

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
    // Reliability by the outlets each report gained, toward 0.98 (not +0.07 up to 1.0)
    const sql = String((boost.data.reliability_score as { sql: string }).sql)
    expect(sql).toMatch(/POWER\(\?, GREATEST\(\? - COALESCE\(source_count, 1\), 0\)\)/)
    expect(promote.ids).toEqual(['sig-a', 'sig-b'])
    expect(promote.data.status).toBe('verified')
    // the cross-check reads both, and may hold back the ones this promotion verified
    expect(h.crossCheck).toHaveBeenLastCalledWith(['sig-a', 'sig-b'], [], ['sig-a', 'sig-b'])
  })

  it('puts the signal and its same-story report into one story', async () => {
    const { db } = await import('../../lib/postgres')
    const raw = db.raw as unknown as { mock: { calls: unknown[][] } }
    raw.mock.calls.length = 0
    h.state.recentRows = [row()]
    await correlateSignal(sig())
    const join = raw.mock.calls.find(c => String(c[0]).includes('UPDATE signals SET story_id'))
    expect(join?.[1]).toEqual([['sig-a', 'sig-b'], ['sig-a', 'sig-b']])
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
    // by word stems, as prefixes ("strik:*" finds "strike", "strikes" and "striking")
    expect(h.state.textQueries[0].split(' | ')).toEqual(
      expect.arrayContaining(['magnit:*', 'earthq:*', 'strik:*', 'coast:*', 'northe:*', 'japan:*']))
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
    expect(h.crossCheck).toHaveBeenLastCalledWith(['sig-held'], [{ title: incoming.title }], ['sig-held'])
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
    // a first word with a colon is a place or a name (Oct 22): two states' attacks are two stories, a label changes nothing
    expect(namesDiffer('Benue: Gunmen kill 12 in fresh attack on farmers', 'Delta: Gunmen kill 12 in fresh attack on farmers')).toBe(true)
    expect(namesDiffer('Benue: gunmen kill 12 in fresh attack on farmers', 'Gunmen kill 12 farmers in fresh Benue attack')).toBe(false)
    expect(namesDiffer('Breaking: Gunmen kill 12 farmers in Benue', 'Watch: Gunmen kill 12 farmers in Benue')).toBe(false)
    expect(namesDiffer('Breaking: Gunmen kill 12 farmers in Benue', 'Gunmen kill 12 farmers in Delta')).toBe(true)
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

describe('only independent outlets corroborate', () => {
  beforeEach(() => {
    h.updates.length = 0
    h.state.textRows = []
    h.state.textQueries.length = 0
  })

  it('does not boost a story carried only as copies of one wire headline', async () => {
    const t = 'Magnitude 6.1 earthquake strikes off the coast of northern Japan'
    h.state.recentRows = [row({ title: t, first_url: 'https://www.dw.com/en/quake/a-1' })]
    await correlateSignal(sig({ title: t, source_id: 'channelnewsasia.com', url: 'https://www.channelnewsasia.com/asia/quake-2' }))
    expect(h.updates).toEqual([])
  })

  it('does not boost sister sites publishing the same article', async () => {
    h.state.recentRows = [row({ first_url: 'https://foxrochester.com/news/nation-world/strong-earthquake-hits-off-northern-japan-coast' })]
    await correlateSignal(sig({ source_id: 'cbs12.com', url: 'https://cbs12.com/news/world/strong-earthquake-hits-off-northern-japan-coast' }))
    expect(h.updates).toEqual([])
  })

  it('does not credit a held signal with a word-for-word copy from another site', async () => {
    h.state.firstRow = {
      id: 'sig-held', title: 'Magnitude 6.1 earthquake strikes off the coast of northern Japan',
      category: 'disaster', severity: 'high', source_ids: [], original_urls: ['https://www3.nhk.or.jp/news/quake'],
      published_at: now.toISOString(), lat: null, lng: null,
    }
    expect(await corroborateWithDuplicate('sig-held', {
      title: 'Magnitude 6.1 Earthquake Strikes Off the Coast of Northern Japan', category: 'disaster', severity: 'high',
      source_id: 'dw.com', url: 'https://www.dw.com/en/quake/a-1', lat: null, lng: null, published_at: now.toISOString(),
    })).toBe(false)
    expect(h.updates).toEqual([])
  })
})

describe('rewordings of one event (Oct 11, 2026)', () => {
  const at = (title: string, source_id: string, over: Partial<CorrelationCandidate> = {}) =>
    sig({ id: source_id, title, source_id, ...over })

  it('are one story: counts in words or digits, a city or its country, word forms', async () => {
    const { storyWords, stemWord } = await import('../correlate')
    expect(['attacks', 'attacked', 'attacking'].map(stemWord)).toEqual(['attack', 'attack', 'attack'])
    expect(['injured', 'injuries', 'injury'].map(stemWord)).toEqual(['injur', 'injur', 'injur'])
    // "Saudi" becomes @SA ("Arabian" stays a word); "a dozen" is #12
    expect([...storyWords('A dozen killed in Saudi Arabian airport attack')].sort())
      .toEqual(['#12', '@SA', 'airpor', 'arabia', 'attack', 'kill'])
    expect(isSameStory(
      at('12 killed, 309 injured in Riyadh Airport attack', 'vanguardngr.com'),
      at('A dozen killed in Saudi Arabian airport attack', 'smh.com.au'),
    )).toBe(true)
    // a count only one gives doesn't count against
    expect(isSameStory(
      at('Hurricane Simon strengthens as it nears western Mexico', 'rte.ie'),
      at('Hurricane Simon strengthens into Category 4 storm as it takes aim at Mexico', 'cbsnews.com'),
    )).toBe(true)
  })

  it('are not stretched to two events of one war, or to opposite statements', () => {
    // the kind of event and the country, nothing particular
    expect(isSameStory(
      at("Russian attack on Ukraine's Zaporizhzhia kills seven, governor says", 'thehindu.com'),
      at('Russian attacks kill at least 24, injure 47 across Ukraine as rescue operations continue in Zaporizhzhia', 'kyivindependent.com'),
    )).toBe(false)
    expect(isSameStory(
      at("Russian attack on Ukraine's Zaporizhzhia kills seven, governor says", 'thehindu.com'),
      at('Ukrainian attack on Bryansk Region kills one civilian, injures two others — governor', 'tass.com'),
    )).toBe(false)
    expect(isSameStory(
      at('Ethiopia tells UN it is acting in self-defense against Eritrea', 'abcnews.com'),
      at("Eritrea urges UN to act against Ethiopia's 'declaration of war'", 'standardmedia.co.ke'),
    )).toBe(false)
    // a place named twice still counts once
    expect(isSameStory(
      at('Israeli strikes kill five in Gaza', 'dawn.com'),
      at('Diplomatic reduction in Gaza, Israel (general), Israel', 'aa.com.tr'),
    )).toBe(false)
  })
})

describe('corroboratedReliability (Oct 11, 2026: 252 of 574 verified stories showed a flat 100%)', () => {
  it('rises less with each outlet and never reaches 100%', () => {
    expect(corroboratedReliability(0.85, 1)).toBeCloseTo(0.902, 3)  // 2 outlets
    expect(corroboratedReliability(0.85, 4)).toBeCloseTo(0.963, 3)  // 5 outlets
    expect(corroboratedReliability(0.65, 1)).toBeCloseTo(0.782, 3)  // GDELT, 2 outlets
    expect(corroboratedReliability(0.85, 50)).toBeLessThan(RELIABILITY_CEILING)
  })

  it('gives the same score whatever order the outlets arrive in', () => {
    expect(corroboratedReliability(corroboratedReliability(0.65, 1), 2)).toBeCloseTo(corroboratedReliability(0.65, 3), 10)
  })

  it('never lowers a score', () => {
    expect(corroboratedReliability(0.99, 2)).toBe(0.99)  // a USGS report starts at 0.99
    expect(corroboratedReliability(0.7, 0)).toBe(0.7)
  })
})

describe('dates in headlines (Oct 15, 2026: 10 of 30 "different event" verdicts were daily features)', () => {
  const other = (title: string) => sig({ id: 'b', source_id: 'bbc.co.uk', title })

  it('reads a date as one word, in the usual forms', () => {
    expect(takeDates('Pix of the Day, 15 October, 2026 - Across the world').dates).toEqual(['~10-15'])
    expect(takeDates("News@9: Today's top headlines - October 15, 2026").dates).toEqual(['~10-15'])
    expect(takeDates('Latest news bulletin | October 15th, 2026 – Morning').dates).toEqual(['~10-15'])
    expect(takeDates('Morning Edition: 14th October 2026').dates).toEqual(['~10-14'])
    expect(takeDates('Horizons Middle East & Africa 10/15/2026 (Video)').dates).toEqual(['~10-15'])
    expect(takeDates('Fed decision due Sept. 17').dates).toEqual(['~9-17'])
    expect(takeDates('Jobs report for October 2026 beats forecasts').dates).toEqual(['~10/2026'])
    expect(takeDates('Update 2026-10-15').dates).toEqual(['~10-15'])
  })

  it('leaves counts, and "march" and "may" as verbs, alone', () => {
    expect(takeDates('Ukraine war, day 1,330: key events').dates).toEqual([])
    expect(takeDates('Protesters march 3 miles to parliament').dates).toEqual([])
    expect(takeDates('Thousands march in Paris').dates).toEqual([])
    expect(storyWords('Protesters march 3 miles to parliament').has('#3')).toBe(true)
  })

  it("doesn't count the day and the year as numbers that single out a story", () => {
    const words = storyWords('Pix of the Day, 15 October, 2026 - Across the world')
    expect([...words].sort()).toEqual(['pix', 'world', '~10-15'])
  })

  it('no longer joins daily features by their date', () => {
    for (const [a, b] of [
      ["News@9: Today's top headlines - October 15, 2026", 'Pix of the Day, 15 October, 2026 - Across the world'],
      ['Daily Cartoon, October 15, 2026', 'Cartoon for October 15, 2026'],
      ['Thursday, 15 October 2026', "Today's Wordle #1944: Hints, Clues And Answer For Thursday October 15"],
      ['Latest news bulletin | October 15th, 2026 – Morning', 'The Hindu Morning Digest: October 15, 2026'],
      ['Current price of oil as of October 15, 2026', 'Africa: All of Africa Today - October 15, 2026'],
      ['Cartoon for October 15, 2026', 'World in pictures this week, October 15, 2026'],
    ]) expect(isSameStory(sig({ title: a }), other(b))).toBe(false)
  })

  it('still joins one story whose headlines share a date and more', () => {
    expect(isSameStory(sig({ title: 'Fed holds interest rates steady at September 17 meeting' }), other('Federal Reserve holds interest rates steady on Sept. 17'))).toBe(true)
  })
})

describe('map points (Oct 16, 2026: of 180 pairs turned down for distance alone and read by hand, 166 were one story)', () => {
  const at = (title: string, source_id: string, over: Partial<CorrelationCandidate> = {}) =>
    sig({ id: source_id, title, source_id, category: 'sports', ...over })

  it("joins one story whose reports are pinned to an outlet's home city or a misread place", () => {
    // Madrid (named as the country) and Barcelona, 505 km apart
    expect(isSameStory(
      at('Spain punished by FIFA for Islamophobic chants in Egypt friendly', 'channelnewsasia.com', { location_name: 'Spain', lat: 40.4168, lng: -3.7038 }),
      at('Spain punished by FIFA for Islamophobic chants during Egypt friendly', 'aljazeera.com', { location_name: 'Barcelona', lat: 41.3874, lng: 2.1686 }),
    )).toBe(true)
    // Nigerian papers pinned at Lagos and Abuja, 530 km apart
    expect(isSameStory(
      at('Soldiers kill two terrorists, recover four AK-47 rifles in Sokoto', 'punchng.com', { category: 'conflict', location_name: 'Lagos, Nigeria', lat: 6.5244, lng: 3.3792 }),
      at('Troops gun down terrorists, recover AK-47 rifles in Sokoto', 'dailytrust.com', { category: 'conflict', location_name: 'Abuja, Nigeria', lat: 9.0765, lng: 7.3986 }),
    )).toBe(true)
  })

  it('keeps two events tied to a spot apart when both are pinned far apart and no headline names the place', () => {
    expect(isSameStory(
      at('Flash floods kill 12 as monsoon rains lash the city', 'dawn.com', { category: 'disaster', location_name: 'Karachi', lat: 24.86, lng: 67.01 }),
      at('Flash floods kill 12 after monsoon rains lash city', 'aljazeera.com', { category: 'disaster', location_name: 'Dhaka', lat: 23.81, lng: 90.41 }),
    )).toBe(false)
  })

  it('goes by the headlines when both name the place, or when a point is only the country', () => {
    expect(isSameStory(
      at('Flash floods in Karachi kill 12 as monsoon rains lash the city', 'dawn.com', { category: 'disaster', location_name: 'Karachi', lat: 24.86, lng: 67.01 }),
      at('Karachi flash floods kill 12 after monsoon rains', 'aljazeera.com', { category: 'disaster', location_name: 'Doha', lat: 25.29, lng: 51.53 }),
    )).toBe(true)
    // Canada, pinned at Ottawa, 2,800 km from Calgary
    expect(isSameStory(
      at('3 dead, 16 injured in fiery bus crash in Calgary, Canada', 'upi.com', { category: 'disaster', location_name: 'Canada', lat: 45.4215, lng: -75.6972 }),
      at('Three dead, at least 16 injured in Calgary bus collision and fire', 'discoverairdrie.com', { category: 'disaster', location_name: 'Calgary', lat: 51.0447, lng: -114.0719 }),
    )).toBe(true)
  })

  it('tells a point that is only a country from a real place', () => {
    for (const name of ['Spain', 'United Kingdom', 'DR Congo', 'Canada']) expect(countryLevelPlace(name)).toBe(true)
    for (const name of ['Lagos, Nigeria', 'Barcelona', '76 km NE of Ozernovskiy, Russia', 'Rivers State', null, '']) expect(countryLevelPlace(name)).toBe(false)
  })
})

describe('ordinals (Oct 16, 2026)', () => {
  const at = (title: string, source_id: string) => sig({ id: source_id, title, source_id, category: 'health' })

  it('reads "third" and "3rd" as one word, and two different ones as two occurrences', () => {
    expect(storyWords('Youths clash with police for a 3rd day in Albania’s anti-government protests').has('%3')).toBe(true)
    expect(isSameStory(
      at('Youths clash with police for a 3rd day in Albania’s anti-government protests', 'aljazeera.com'),
      at('Clashes break out for a third day in Albania as anti-govt protests swell', 'euronews.com'),
    )).toBe(true)
    expect(isSameStory(at('Kenya confirms second Ebola case', 'allafrica.com'), at('Kenya confirms third Ebola case', 'nation.africa'))).toBe(false)
    expect(isSameStory(
      at('Kenya confirms first Ebola case imported from Congo after patient dies in Nairobi', 'reuters.com'),
      at('Kenya confirms third Ebola case, a relative of the first patient who died', 'nation.africa'),
    )).toBe(false)
  })

  it('does not read words like "constructor" as numbers or ordinals', () => {
    expect([...storyWords('Constructor wins big contract in Leeds')].some(w => /^[#%]/.test(w))).toBe(false)
  })
})

describe("tolls (Oct 24, 2026: a Nigerian attack's headline on the Saudi airport attacks' story)", () => {
  const at = (title: string, source_id: string) => sig({ id: source_id, title, source_id, category: 'conflict' })

  it('keeps two events apart when a toll is all they share and their headlines name different countries, or only one names one', () => {
    expect(isSameStory(
      at('One Indian killed, 3 injured in attacks in Saudi Arabia', 'navhindtimes.in'),
      at('One killed, three injured as gunmen attack NDC candidate’s convoy', 'premiumtimesng.com'),
    )).toBe(false)
    expect(isSameStory(
      at('One killed, four injured in drive-by shooting near Paris', 'straitstimes.com'),
      at('Suspect wanted in North Philadelphia shooting that killed 1, injured 4', 'nbcphiladelphia.com'),
    )).toBe(false)
  })

  it('still joins reports of one event that share a toll and a country, or a name', () => {
    expect(isSameStory(
      at('1 die, 3 injured in alleged attack on NDC candidate’s convoy in Ebonyi', 'vanguardngr.com'),
      at('One killed, three injured as gunmen attack NDC candidate’s convoy', 'premiumtimesng.com'),
    )).toBe(true)
    expect(isSameStory(
      at('One killed, four injured in drive-by shooting near Paris', 'straitstimes.com'),
      at('France: 1 killed, 4 wounded after shooting near Paris', 'dw.com'),
    )).toBe(true)
  })
})
