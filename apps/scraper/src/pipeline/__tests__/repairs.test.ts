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
    for (const m of ['select', 'where', 'whereRaw']) b[m] = () => b
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

import { fixLocalhostUploadUrls, undoTemplateCorroboration, undoCopyVerifications, retractStaleFeedItems, recheckGeocodedPlaces, decodeStoredEntities } from '../repairs'
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
