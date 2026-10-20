import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  raws: [] as Array<{ sql: string; params?: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ ids: string[]; data: Record<string, unknown> }>,
}))

vi.mock('../../lib/postgres', () => {
  function builder() {
    let ids: string[] = []
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'where', 'whereRaw', 'limit']) b[m] = () => b
    b.whereIn = (_c: string, list: string[]) => { ids = list; return b }
    b.update = (data: Record<string, unknown>) => { h.updates.push({ ids, data }); return Promise.resolve(ids.length) }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(h.rows).then(res, rej)
    return b
  }
  return {
    db: Object.assign(vi.fn(() => builder()), {
      raw: vi.fn(async (sql: string, params?: unknown[]) => { h.raws.push({ sql, params }); return { rowCount: 3 } }),
    }),
  }
})

import { fixLocalhostUploadUrls, undoTemplateCorroboration, undoCopyVerifications, retractStaleFeedItems, recheckGeocodedPlaces, decodeStoredEntities, recategorizeRecentArticles, retractShoppingItems, recalibrateFlatReliability, stripOutletNames, switchOffRetiredSources, RETIRED_SOURCE_SLUGS, fixGdeltFipsCountries } from '../repairs'
import { db } from '../../lib/postgres'
import { EVENT_TEMPLATE_SQL } from '../event-titles'

describe('fixLocalhostUploadUrls', () => {
  beforeEach(() => { h.raws.length = 0 })

  it('points localhost upload URLs at the public site and reports how many posts changed', async () => {
    expect(await fixLocalhostUploadUrls()).toBe(3)
    const [{ sql, params }] = h.raws
    expect(sql).toMatch(/UPDATE posts/)
    expect(sql).toMatch(/WITH ORDINALITY/) // keeps the order of a post's media
    expect(params?.[1]).toBe('https://world-pulse.io/uploads/')
  })

  it('only rewrites the API-internal prefix', () => {
    const re = new RegExp('^https?://(localhost|127\\.0\\.0\\.1):3001/uploads/')
    const fix = (u: string) => u.replace(re, 'https://world-pulse.io/uploads/')
    expect(fix('http://localhost:3001/uploads/post-media/abc.webp')).toBe('https://world-pulse.io/uploads/post-media/abc.webp')
    expect(fix('http://127.0.0.1:3001/uploads/post-media/x.mp4')).toBe('https://world-pulse.io/uploads/post-media/x.mp4')
    expect(fix('https://cdn.example.com/uploads/a.png')).toBe('https://cdn.example.com/uploads/a.png')
    expect(fix('https://world-pulse.io/uploads/post-media/ok.webp')).toBe('https://world-pulse.io/uploads/post-media/ok.webp')
  })
})

describe('undoTemplateCorroboration', () => {
  beforeEach(() => { h.raws.length = 0 })

  it('puts corroborated GDELT event-label signals back to one source and pending', async () => {
    expect(await undoTemplateCorroboration()).toBe(3)
    const [{ sql, params }] = h.raws
    expect(sql).toMatch(/SET status = 'pending'/)
    expect(sql).toMatch(/source_count = 1/)
    expect(sql).toMatch(/original_urls = original_urls\[1:1\]/) // its own link only
    expect(sql).toMatch(/tags @> ARRAY\['gdelt'\]/)
    expect(sql).toMatch(/INTERVAL '7 days'/)
    expect(sql).toMatch(/status = 'verified' OR source_count > 1/) // nothing to do on a later start
    expect(params).toEqual([0.65, EVENT_TEMPLATE_SQL])
  })

  it('matches the event-label titles and not real headlines (POSIX classes read as Unicode classes)', () => {
    const js = new RegExp(EVENT_TEMPLATE_SQL.replace(/\[\[:upper:\]\]/g, '\\p{Lu}').replace(/\[:alpha:\]/g, '\\p{L}'), 'u')
    expect(js.test('Armed conflict in Washington, District of Columbia, United States')).toBe(true)
    expect(js.test('Disapproval in Ghazipur, Uttar Pradesh, India')).toBe(true)
    expect(js.test('Consultation in Sydney, New South Wales, Australia')).toBe(true)
    expect(js.test('Protest')).toBe(true)
    expect(js.test('Protest in Paris over pension reform turns violent')).toBe(false)
    expect(js.test('At least 12 dead in Riyadh airport attack')).toBe(false)
  })
})

describe('undoCopyVerifications', () => {
  beforeEach(() => { h.updates.length = 0 })

  it('puts back to pending only stories whose links are copies of one article', async () => {
    h.rows = [
      { id: 'sinclair', original_urls: [
        'https://foxsanantonio.com/newsletter-daily/metro-healths-baby-buggy-walk-and-health-expo-spotlights-infant-mortality',
        'https://news4sanantonio.com/news/local/metro-healths-baby-buggy-walk-and-health-expo-spotlights-infant-mortality'] },
      { id: 'independent', original_urls: [
        'https://www.aljazeera.com/news/2026/10/10/riyadh-airport-attack-kills-twelve',
        'https://www.npr.org/2026/10/10/nx-s1-1/saudi-airport-attack'] },
      { id: 'one-site', original_urls: ['https://www.bbc.com/news/a', 'https://www.bbc.com/news/b'] },
    ]
    expect(await undoCopyVerifications()).toBe(1)
    expect(h.updates).toEqual([{ ids: ['sinclair'], data: { status: 'pending', verified_at: null, source_count: 1 } }])
  })

  it('changes nothing when every story has independent outlets', async () => {
    h.rows = []
    expect(await undoCopyVerifications()).toBe(0)
    expect(h.updates).toEqual([])
  })
})

describe('retractStaleFeedItems', () => {
  beforeEach(() => { h.raws.length = 0 })

  it('takes recent news-feed signals about long-published stories out of the feed, findably', async () => {
    expect(await retractStaleFeedItems()).toBe(3)
    const [{ sql }] = h.raws
    expect(sql).toMatch(/SET status = 'retracted'/)
    expect(sql).toMatch(/array_append\(tags, 'stale-feed-item'\)/)
    expect(sql).toMatch(/tags @> ARRAY\['news', 'rss'\]/)
    expect(sql).toMatch(/status = 'pending'/) // verified stories are left alone; a re-run changes nothing
    expect(sql).toMatch(/event_time < created_at - INTERVAL '3 days'/)
    expect(sql).toMatch(/created_at > NOW\(\) - INTERVAL '3 days'/)
  })
})

describe('recheckGeocodedPlaces', () => {
  beforeEach(() => { h.raws.length = 0; h.rows = [] })

  it('renames real places, re-pins the rest from their own text, and clears what is left', async () => {
    // The lowercase pin names from the last 7 days
    vi.mocked(db.raw).mockImplementationOnce(async (sql: string, params?: unknown[]) => {
      h.raws.push({ sql, params: params as unknown[] })
      return { rows: [{ name: 'doncaster' }, { name: 'trump' }] } as never
    })
    // Signals pinned "trump": one names a country, one names no place at all
    h.rows = [
      { id: 's1', title: 'Trump jokes supporters would clap for anything', summary: 'Remarks at a rally. Source: Kyiv Independent' },
      { id: 's2', title: 'US and Japanese leaders discuss Trump tariffs', summary: null },
    ]
    const lookup = vi.fn(async (name: string) => name === 'doncaster'
      ? [{ point: true, lat: 53.52, lng: -1.13, name: 'Doncaster', countryCode: 'GB', region: 'England' }]
      : [])
    const fromText = vi.fn((text: string) => /japanese/i.test(text)
      ? { point: true, lat: 35.68, lng: 139.65, name: 'Tokyo', countryCode: 'JP' }
      : { point: false })

    const totals = await recheckGeocodedPlaces(lookup, fromText, 0)

    const [select, rename, clear, repin] = h.raws
    expect(select.sql).toMatch(/location_name ~ \?/)
    expect(select.sql).toMatch(/INTERVAL '7 days'/)
    expect(new RegExp(String(select.params?.[0])).test('gamma delta')).toBe(true)
    expect(new RegExp(String(select.params?.[0])).test('Tehran, Iran')).toBe(false)     // proper names are left alone
    expect(new RegExp(String(select.params?.[0])).test('10 km NE of pahala')).toBe(false)

    expect(rename.sql).toMatch(/SET location_name = \?, location = ST_MakePoint/)
    expect(rename.params).toEqual(['Doncaster', -1.13, 53.52, 'GB', 'England', 'doncaster'])

    expect(clear.sql).toMatch(/SET location_name = NULL, location = NULL/)
    expect(clear.params).toEqual([null, 's1'])
    expect(fromText.mock.calls[0][0]).not.toMatch(/Kyiv/)          // the outlet line is not a place

    expect(repin.params).toEqual(['Tokyo', 139.65, 35.68, 'JP', null, 's2'])
    expect(totals).toEqual({ renamed: 3, repinned: 3, cleared: 3 })  // the mock reports 3 rows per UPDATE
  })
})

describe('recheckGeocodedPlaces when the geocoder is down', () => {
  beforeEach(() => { h.raws.length = 0; h.rows = [] })

  it('stops and changes nothing (a failed lookup is not "no such place")', async () => {
    vi.mocked(db.raw).mockImplementationOnce(async (sql: string, params?: unknown[]) => {
      h.raws.push({ sql, params: params as unknown[] })
      return { rows: [{ name: 'doncaster' }, { name: 'trump' }] } as never
    })
    const lookup = vi.fn(async () => null)
    const totals = await recheckGeocodedPlaces(lookup, () => ({ point: false }), 0)
    expect(totals).toEqual({ renamed: 0, repinned: 0, cleared: 0, stopped: true })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(h.raws.filter(r => /UPDATE/.test(r.sql))).toEqual([])
  })
})

describe('decodeStoredEntities', () => {
  beforeEach(() => { h.raws.length = 0; h.updates.length = 0 })

  it('decodes HTML codes in recent titles, summaries and links, and skips rows with nothing to change', async () => {
    vi.mocked(db.raw).mockImplementationOnce(async (sql: string, params?: unknown[]) => {
      h.raws.push({ sql, params: params as unknown[] })
      return { rows: [
        { id: 'a', title: 'Who Are You? &#8211; Analysis', summary: null, original_urls: ['https://x.y/a'] },
        { id: 'b', title: 'Quake MMI&gt;=VII', summary: 'ok', original_urls: ['https://www.gdacs.org/r?e=EQ&amp;id=1'] },
        { id: 'c', title: 'Osaka <i>danjiri</i> float festival', summary: null, original_urls: [] },
        { id: 'd', title: 'Nothing to change &lt;script', summary: null, original_urls: [] },
      ] } as never
    })
    expect(await decodeStoredEntities()).toBe(3)
    const [{ sql }] = h.raws
    expect(sql).toMatch(/INTERVAL '7 days'/)
    expect(sql).toMatch(/LIKE '%&amp;%'/)
    expect(h.updates.map(u => u.data)).toEqual([
      { title: 'Who Are You? – Analysis', summary: null },
      { title: 'Quake MMI>=VII', summary: 'ok', original_urls: ['https://www.gdacs.org/r?e=EQ&id=1'] },
      { title: 'Osaka danjiri float festival', summary: null },
    ])
  })
})

describe('recategorizeRecentArticles', () => {
  beforeEach(() => { h.raws.length = 0 })

  it("files article and GDELT signals by the current rules, with the severity their category allows", async () => {
    vi.mocked(db.raw).mockImplementationOnce(async (sql: string, params?: unknown[]) => {
      h.raws.push({ sql, params: params as unknown[] })
      return { rows: [
        // The old rules read "who" as the WHO
        { id: 'a', title: "Judi Dench says she 'loathes' being called a 'national treasure'", summary: null, category: 'health', severity: 'medium', source_count: 1 },
        { id: 'b', title: 'Migrant shipwreck off Djibouti kills 109, leaves more than 116 missing', summary: null, category: 'breaking', severity: 'medium', source_count: 1 },
        { id: 'c', title: 'Pope Leo XIV to undergo surgery to remove lump on lung', summary: null, category: 'other', severity: 'low', source_count: 3 },
        { id: 'd', title: "Dan Stevens' Best Horror Movie Is a Slasher Surprise", summary: null, category: 'breaking', severity: 'high', source_count: 1 },
        // A serious story whose headline names no kind of event is left alone
        { id: 'e', title: 'Latest news bulletin | October 11th, 2026 – Morning', summary: null, category: 'breaking', severity: 'high', source_count: 1 },
        // Already right
        { id: 'f', title: 'Russia strikes Kyiv with drones overnight', summary: null, category: 'conflict', severity: 'medium', source_count: 1 },
      ] } as never
    })
    expect(await recategorizeRecentArticles(new Date('2026-10-11T14:00:00Z'))).toBe(4)
    const [select, update] = h.raws
    expect(select!.sql).toMatch(/created_at < \?/)
    expect(select!.sql).toMatch(/NOT \(tags @> ARRAY\['rss'\]/) // the RSS reader's own repair covers those
    expect(select!.sql).toMatch(/tags @> ARRAY\['gdelt'\]::text\[\] OR NOT \(tags @> ARRAY\['osint'\]/)
    expect(select!.params).toEqual(['2026-10-11T14:00:00.000Z', EVENT_TEMPLATE_SQL])
    expect(update!.sql).toMatch(/SET category = v\.category::category, severity = v\.severity::signal_severity/)
    expect(update!.params).toEqual([
      'a', 'other', 'low',
      'b', 'disaster', 'high',   // 109 dead, one outlet: a disaster may be high
      'c', 'health', 'low',
      'd', 'culture', 'medium',  // culture stops at medium
    ])
  })
})

describe('retractShoppingItems', () => {
  beforeEach(() => { h.updates.length = 0; h.raws.length = 0 })

  it('takes recent shopping pages out of the feed, tagged so they can be found', async () => {
    h.rows = [
      { id: 'a', title: 'eBay Coupons: 20% Off in October 2026', original_urls: ['https://www.wired.com/story/ebay-coupon-code/'] },
      { id: 'b', title: 'AI Is Getting Really Good at Messing With Cybercriminals', original_urls: ['https://www.wired.com/story/ai-cybercriminals/'] },
      { id: 'c', title: 'Best Lego Gifts for Brick Builders (2026)', original_urls: ['https://www.wired.com/gallery/gifts-for-lego-lovers/'] },
    ]
    expect(await retractShoppingItems()).toBe(2)
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]!.ids).toEqual(['a', 'c'])
    expect(h.updates[0]!.data.status).toBe('retracted')
    h.rows = []
  })
})

describe('stripOutletNames', () => {
  beforeEach(() => { h.raws.length = 0 })

  it("takes the outlet's name off recent headlines, and leaves other endings", async () => {
    h.rows = [
      { id: 'a', title: "S Korea's Lee calls for calm after Riyadh attack - The Korea Times", original_urls: ['https://www.koreatimes.co.kr/www/nation/2026/10/x.html'] },
      { id: 'b', title: 'Russian diesel imports beneficial to Americans — Treasury Secretary', original_urls: ['https://tass.com/economy/1'] },
      { id: 'c', title: 'IIT Kanpur alumnus raises funds for a startup | Mint', original_urls: ['https://www.livemint.com/news/x'] },
    ]
    expect(await stripOutletNames()).toBe(2)
    const { sql, params } = h.raws.find(r => /^\s*UPDATE/.test(r.sql))!
    expect(sql).toMatch(/UPDATE signals AS s SET title = v\.title/)
    expect(params).toEqual(['a', "S Korea's Lee calls for calm after Riyadh attack", 'c', 'IIT Kanpur alumnus raises funds for a startup'])
    h.rows = []
  })
})

describe('recalibrateFlatReliability', () => {
  beforeEach(() => { h.raws.length = 0 })

  it("rescores stories at a flat 100% by their outlets, from the report's own start", async () => {
    h.rows = [
      { id: 'a', tags: ['news', 'rss', 'bbc-world'], source_count: 3, reliability_score: '1.000' },
      { id: 'b', tags: ['osint', 'gdelt', 'cameo-19'], source_count: 2, reliability_score: '1.000' },
      { id: 'c', tags: [], source_count: 2, reliability_score: '0.990' },
    ]
    expect(await recalibrateFlatReliability()).toBe(3)
    const update = h.raws.find(r => /UPDATE/.test(r.sql))
    expect(update!.sql).toMatch(/UPDATE signals AS s SET reliability_score = v\.score/)
    const params = update!.params as Array<string | number>
    expect(params.filter((_, i) => i % 2 === 0)).toEqual(['a', 'b', 'c'])
    const scores = params.filter((_, i) => i % 2 === 1) as number[]
    expect(scores[1]).toBe(0.782)       // GDELT's 0.65 with a second outlet
    expect(scores[2]).toBe(0.812)       // an article group's 0.7 with a second outlet
    expect(scores[0]).toBeGreaterThan(0.9)
    expect(scores[0]).toBeLessThan(0.98)
    h.rows = []
  })
})

describe('switchOffRetiredSources', () => {
  beforeEach(() => { h.updates.length = 0; vi.mocked(db).mockClear() })

  it('switches off the 11 database feeds that no longer answer, and only those', async () => {
    expect(await switchOffRetiredSources()).toBe(11)
    expect(db).toHaveBeenCalledWith('sources')
    const [{ ids, data }] = h.updates
    expect(ids).toEqual(['ap-news', 'swissinfo', 'trt-world', 'emsc-quakes', 'gdacs', 'reliefweb', 'voa-news', 'rferl', 'dawn-pk',
      'cbc-news', 'nhk-world'])
    expect(data.active).toBe(false)
    expect(data.updated_at).toBeInstanceOf(Date)
  })

  it('retires CBC News and NHK World, which never answered our server (Oct 17, 2026)', () => {
    expect(RETIRED_SOURCE_SLUGS).toContain('cbc-news')
    expect(RETIRED_SOURCE_SLUGS).toContain('nhk-world')
  })

  it('keeps sources that still answer, and the adapters, off the list', () => {
    for (const slug of ['bbc-world', 'reuters-world', 'aljazeera', 'un-news', 'acled', 'ioda', 'japan-times']) {
      expect(RETIRED_SOURCE_SLUGS).not.toContain(slug)
    }
  })
})

describe('fixGdeltFipsCountries (Oct 20, 2026, H-0022)', () => {
  beforeEach(() => { h.updates.length = 0; vi.mocked(db).mockClear() })

  it("gives GDELT stories the ISO code of the country their place names, and leaves the rest", async () => {
    h.rows = [
      { id: 'lagos', country_code: 'NI', location_name: 'Gwagwalada, Abuja Federal Capital Territory, Nigeria' },
      { id: 'managua', country_code: 'NI', location_name: 'Managua, Nicaragua' },   // the article's own place: ISO already
      { id: 'dublin', country_code: 'EI', location_name: 'Dublin, Ireland' },
      { id: 'kano', country_code: 'NI', location_name: 'Kano State, Kano, Nigeria' },
      { id: 'sydney', country_code: 'AU', location_name: 'Sydney, New South Wales, Australia' },
      { id: 'vienna', country_code: 'AU', location_name: 'Vienna, Wien, Austria' },
      { id: 'nowhere', country_code: 'EI', location_name: null },
    ]
    expect(await fixGdeltFipsCountries()).toBe(4)
    expect(db).toHaveBeenCalledWith('signals')
    expect(h.updates).toEqual([
      { ids: ['lagos', 'kano'], data: { country_code: 'NG' } },
      { ids: ['dublin'], data: { country_code: 'IE' } },
      { ids: ['vienna'], data: { country_code: 'AT' } },
    ])
    h.rows = []
  })

  it('changes nothing when every row is right already (a later start)', async () => {
    h.rows = [{ id: 'abuja', country_code: 'NG', location_name: 'Abuja, Nigeria' }]
    expect(await fixGdeltFipsCountries()).toBe(0)
    expect(h.updates).toEqual([])
    h.rows = []
  })
})
