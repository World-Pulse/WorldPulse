/**
 * Data sources repaired in October 2026: ReliefWeb (RSS instead of the retired
 * API), OFAC (Recent Actions page instead of the retired RSS feed), USGS
 * volcanoes (the public HANS API), news feeds (gzip bodies, relative
 * redirects, pausing feeds that keep failing) and OTX (off without a key).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import type Redis from 'ioredis'
import { parseReliefWebRss, reliefWebCategory, disasterSeverity, apiDisasterToItem } from '../reliefweb'
import { parseOfacRecentActions, sanctionsSeverity } from '../ofac-sanctions'
import { volcanoLevel, volcanoLevelChanges, describeLevelChange, type ElevatedVolcano } from '../gvp-volcano'
import { fetchUrl, noteFeedFailure, feedPaused, clearFeedFailures, forgetRemovedFeeds, detectNewsSeverity, detectNewsCategory } from '../news-rss'
import { otxEnabled } from '../otx-threats'
import { recentEuAmendments } from '../eu-sanctions'
import { iso3Centroid } from '../../pipeline/country-centroids'

// ─── ReliefWeb ──────────────────────────────────────────────────────────────

const RELIEFWEB_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0"><channel>
  <title>ReliefWeb - Disasters</title>
  <item>
    <title>Niger: Floods - Sep 2026</title>
    <link>https://reliefweb.int/disaster/fl-2026-000181-ner</link>
    <guid isPermaLink="true">https://reliefweb.int/disaster/fl-2026-000181-ner</guid>
    <pubDate>Tue, 01 Sep 2026 00:00:00 +0000</pubDate>
    <description>
      &lt;div class="tag country"&gt;Affected country: Niger&lt;/div&gt;
      &lt;div class="tag glide"&gt;Glide: FL-2026-000181-NER&lt;/div&gt;
      &lt;p&gt;As of 1 September, floods have affected 34,372 people. (&lt;a href="https://reliefweb.int/node/4228914"&gt;OCHA &amp;amp; partners, 8 Sep 2026&lt;/a&gt;)&lt;/p&gt;
    </description>
    <category>Niger</category>
    <category>FL-2026-000181-NER</category>
  </item>
  <item>
    <title>Nepal: Flash Floods - Aug 2026</title>
    <link>https://reliefweb.int/disaster/ff-2026-000162-npl</link>
    <pubDate>Wed, 26 Aug 2026 00:00:00 +0000</pubDate>
    <description>&lt;div class="tag country"&gt;Affected countries: China, Nepal&lt;/div&gt;&lt;p&gt;Heavy rain.&lt;/p&gt;</description>
    <category>China</category>
    <category>Nepal</category>
    <category>FF-2026-000162-NPL</category>
  </item>
  <item>
    <title>Bangladesh: Dengue Outbreak - Sep 2026</title>
    <link>https://reliefweb.int/disaster/ep-2026-000174-bgd</link>
    <pubDate>Tue, 01 Sep 2026 00:00:00 +0000</pubDate>
    <description>&lt;p&gt;More than 51,000 dengue cases.&lt;/p&gt;</description>
    <category>Bangladesh</category>
    <category>EP-2026-000174-BGD</category>
  </item>
</channel></rss>`

describe('parseReliefWebRss', () => {
  const items = parseReliefWebRss(RELIEFWEB_RSS)

  it('reads every disaster with its page, date and GLIDE number', () => {
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      slug: 'fl-2026-000181-ner',
      title: 'Niger: Floods - Sep 2026',
      url: 'https://reliefweb.int/disaster/fl-2026-000181-ner',
      glide: 'FL-2026-000181-NER',
      typeCode: 'FL',
      typeName: 'Flood',
      iso3: 'NER',
      countries: ['Niger'],
    })
    expect(items[0].publishedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('turns the twice-encoded description into plain text without the labels', () => {
    expect(items[0].summary).toBe('As of 1 September, floods have affected 34,372 people. (OCHA & partners, 8 Sep 2026)')
    expect(items[0].summary).not.toContain('Affected country')
    expect(items[0].summary).not.toContain('Glide:')
  })

  it('lists every affected country, not the GLIDE number', () => {
    expect(items[1].countries).toEqual(['China', 'Nepal'])
    expect(items[1].iso3).toBe('NPL')
    expect(items[1].typeName).toBe('Flash Flood')
  })

  it('files epidemics under health and other disasters under disaster', () => {
    expect(reliefWebCategory(items[2].typeCode)).toBe('health')
    expect(reliefWebCategory(items[0].typeCode)).toBe('disaster')
    expect(reliefWebCategory(null)).toBe('disaster')
  })

  it('rates a flood high and an earthquake critical', () => {
    expect(disasterSeverity(items[0].title, items[0].typeName, 'ongoing', 1)).toBe('high')
    expect(disasterSeverity('Colombia: Earthquake - Aug 2026', 'Earthquake', 'ongoing', 1)).toBe('critical')
  })

  it('skips items without a title or link and survives junk', () => {
    expect(parseReliefWebRss('<item><title>No link</title></item>')).toEqual([])
    expect(parseReliefWebRss('not xml')).toEqual([])
  })
})

describe('apiDisasterToItem', () => {
  it('maps an API v2 disaster to the same shape as an RSS item', () => {
    const item = apiDisasterToItem({
      id: 52345,
      fields: {
        name: 'Niger: Floods - Sep 2026',
        glide: 'FL-2026-000181-NER',
        url_alias: 'https://reliefweb.int/disaster/fl-2026-000181-ner',
        date: { created: '2026-09-02T10:00:00+00:00', event: '2026-09-01T00:00:00+00:00' },
        type: [{ name: 'Flood', code: 'FL' }],
        country: [{ name: 'Niger', iso3: 'ner' }],
        primary_country: { name: 'Niger', iso3: 'ner' },
        description: '<p>Floods have affected 34,372 people.</p>',
      },
    })
    expect(item).toMatchObject({
      slug: 'fl-2026-000181-ner', // same dedup key as the RSS item
      typeCode: 'FL',
      typeName: 'Flood',
      iso3: 'NER',
      countries: ['Niger'],
      summary: 'Floods have affected 34,372 people.',
    })
    expect(item!.publishedAt!.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('skips a disaster without a name', () => {
    expect(apiDisasterToItem({ id: 1, fields: {} })).toBeNull()
    expect(apiDisasterToItem({ id: 2 })).toBeNull()
  })
})

describe('iso3Centroid', () => {
  it('finds the centre of a country by its three-letter code', () => {
    expect(iso3Centroid('NER')).toEqual({ lat: 17.61, lon: 8.08 })
    expect(iso3Centroid('lbr')).toEqual({ lat: 6.43, lon: -9.43 })
  })

  it('returns null for unknown or missing codes', () => {
    expect(iso3Centroid('ZZZ')).toBeNull()
    expect(iso3Centroid(null)).toBeNull()
    expect(iso3Centroid('')).toBeNull()
  })
})

// ─── OFAC ───────────────────────────────────────────────────────────────────

const OFAC_PAGE = `<html><body>
<a href="/recent-actions">Recent Actions</a>
<div class="view-content">
<div class="margin-bottom-4 search-result views-row"><div><div class="font-sans-lg margin-bottom-05 margin-top-1 text-no-underline"><a href="/recent-actions/20261009" hreflang="en">Settlement Agreement between the U.S. Department of the Treasury&#039;s Office of Foreign Assets Control and Pegasus Worldwide Logistics; International Criminal Court Designation and General Licenses; Burma-related Designation Removal</a></div></div><div><div class="margin-top-1 font-sans-2xs line-height-sans-3 margin-bottom-1">October 09, 2026 -
<a href="/recent-actions/sanctions-list-updates">Sanctions List Updates</a></div></div></div>
    <div class="margin-bottom-4 search-result views-row"><div><div class="font-sans-lg margin-bottom-05 margin-top-1 text-no-underline"><a href="/recent-actions/20261009_33" hreflang="en">Issuance of Russia-related General License</a></div></div><div><div class="margin-top-1 font-sans-2xs line-height-sans-3 margin-bottom-1">October 09, 2026 -
<a href="/recent-actions/general-licenses">General Licenses</a></div></div></div>
    <div class="margin-bottom-4 search-result views-row"><div><div class="font-sans-lg margin-bottom-05 margin-top-1 text-no-underline"><a href="/recent-actions/20261008" hreflang="en">Iran-related Designations; Issuance of Iran-related General License</a></div></div><div><div class="margin-top-1 font-sans-2xs line-height-sans-3 margin-bottom-1">October 08, 2026 -
<a href="/recent-actions/sanctions-list-updates">Sanctions List Updates</a></div></div></div>
</div>
<a href="/recent-actions/20261008">Iran-related Designations; Issuance of Iran-related General License</a>
</body></html>`

describe('parseOfacRecentActions', () => {
  const actions = parseOfacRecentActions(OFAC_PAGE)

  it('reads each action once, newest first, with its link, date and category', () => {
    expect(actions.map(a => a.path)).toEqual(['/recent-actions/20261009', '/recent-actions/20261009_33', '/recent-actions/20261008'])
    expect(actions[1]).toMatchObject({
      url: 'https://ofac.treasury.gov/recent-actions/20261009_33',
      title: 'Issuance of Russia-related General License',
      category: 'General Licenses',
    })
    expect(actions[1].date?.toISOString()).toBe('2026-10-09T12:00:00.000Z')
    expect(actions[2].category).toBe('Sanctions List Updates')
  })

  it('decodes HTML entities in titles', () => {
    expect(actions[0].title).toContain("Treasury's Office")
  })

  it('finds nothing on a page without actions', () => {
    expect(parseOfacRecentActions('<html><a href="/recent-actions">Recent Actions</a></html>')).toEqual([])
  })

  it('rates designations by programme but general licenses low', () => {
    expect(sanctionsSeverity(actions[2].title, '', actions[2].category)).toBe('critical')
    expect(sanctionsSeverity(actions[1].title, '', actions[1].category)).toBe('low')
    expect(sanctionsSeverity('Publication of Amended Iran-related Frequently Asked Question', '', '')).toBe('low')
    expect(sanctionsSeverity('Counter Terrorism Designations', '', '')).toBe('critical')
  })
})

// ─── USGS volcanoes ─────────────────────────────────────────────────────────

const greatSitkin: ElevatedVolcano = { volcano_name: 'Great Sitkin', vnum: '311120', alert_level: 'WATCH', color_code: 'ORANGE' }
const shishaldin: ElevatedVolcano = { volcano_name: 'Shishaldin', vnum: '311360', alert_level: 'ADVISORY', color_code: 'YELLOW' }

describe('volcano level changes', () => {
  it('writes a level as ALERT/COLOR', () => {
    expect(volcanoLevel(greatSitkin)).toBe('WATCH/ORANGE')
    expect(volcanoLevel({ alert_level: 'advisory', color_code: 'yellow' })).toBe('ADVISORY/YELLOW')
  })

  it('reports every elevated volcano the first time', () => {
    expect(volcanoLevelChanges([greatSitkin, shishaldin], {})).toEqual([greatSitkin, shishaldin])
  })

  it('reports a volcano again only when its level changes', () => {
    const previous = { '311120': 'WATCH/ORANGE', '311360': 'WATCH/ORANGE' }
    expect(volcanoLevelChanges([greatSitkin, shishaldin], previous)).toEqual([shishaldin])
  })

  it('says whether the level went up or down', () => {
    expect(describeLevelChange(undefined, 'WATCH/ORANGE')).toBe('Alert level is above normal: WATCH/ORANGE.')
    expect(describeLevelChange('ADVISORY/YELLOW', 'WATCH/ORANGE')).toBe('Raised from ADVISORY/YELLOW to WATCH/ORANGE.')
    expect(describeLevelChange('WATCH/ORANGE', 'ADVISORY/YELLOW')).toBe('Lowered from WATCH/ORANGE to ADVISORY/YELLOW.')
    expect(describeLevelChange('WATCH/RED', 'WATCH/ORANGE')).toBe('Lowered from WATCH/RED to WATCH/ORANGE.')
  })
})

// ─── News feeds ─────────────────────────────────────────────────────────────

const FEED = '<rss><channel><item><title>Héllo — world</title><link>https://example.com/a</link></item></channel></rss>'

describe('fetchUrl', () => {
  let server: http.Server | null = null
  afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()))
    server = null
  })

  async function serve(handler: http.RequestListener): Promise<string> {
    server = http.createServer(handler)
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
  }

  it('decodes a gzip body even when it was sent unasked', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/rss+xml', 'Content-Encoding': 'gzip' })
      res.end(zlib.gzipSync(Buffer.from(FEED, 'utf8')))
    })
    expect(await fetchUrl(`${base}/rss`)).toBe(FEED)
  })

  it('decodes brotli and follows a relative redirect', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/rss') {
        res.writeHead(301, { Location: '/feed/' })
        res.end()
        return
      }
      expect(req.headers['accept-encoding']).toContain('br')
      res.writeHead(200, { 'Content-Encoding': 'br' })
      res.end(zlib.brotliCompressSync(Buffer.from(FEED, 'utf8')))
    })
    expect(await fetchUrl(`${base}/rss`)).toBe(FEED)
  })

  it('rejects on an HTTP error', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(404)
      res.end('Not Found')
    })
    await expect(fetchUrl(`${base}/rss`)).rejects.toThrow('HTTP 404')
  })
})

function fakeRedis() {
  const store = new Map<string, string>()
  const scans = new Map<string, string[]>()
  return {
    store,
    async incr(key: string) { const n = Number(store.get(key) ?? 0) + 1; store.set(key, String(n)); return n },
    async expire() { return 1 },
    async set(key: string, value: string) { store.set(key, value); return 'OK' },
    async exists(key: string) { return store.has(key) ? 1 : 0 },
    async del(key: string) { return store.delete(key) ? 1 : 0 },
    // Two keys a page, from the keys there when the scan began (as SCAN promises)
    async scan(cursor: string, _match: string, pattern: string) {
      const prefix = pattern.replace(/\*$/, '')
      if (cursor === '0') scans.set(prefix, [...store.keys()].filter(k => k.startsWith(prefix)).sort())
      const all = scans.get(prefix) ?? [], at = Number(cursor)
      return [at + 2 >= all.length ? '0' : String(at + 2), all.slice(at, at + 2)] as [string, string[]]
    },
  }
}

describe('news feed failure pause', () => {
  const source = { id: 'test-feed', feedUrl: 'https://example.com/rss' }

  it('pauses a feed after three failures in a row and logs one shared message', async () => {
    const redis = fakeRedis()
    const warn = vi.fn()
    const r = redis as unknown as Redis
    await noteFeedFailure(r, source, { warn }, 'HTTP 404')
    await noteFeedFailure(r, source, { warn }, 'HTTP 404')
    expect(await feedPaused(r, source.id)).toBe(false)
    await noteFeedFailure(r, source, { warn }, 'HTTP 404')
    expect(await feedPaused(r, source.id)).toBe(true)
    expect(warn.mock.calls.map(c => c[1])).toEqual([
      'News feed fetch failed', 'News feed fetch failed', 'News feed paused after repeated failures',
    ])
  })

  it('starts counting again after a success', async () => {
    const redis = fakeRedis()
    const warn = vi.fn()
    const r = redis as unknown as Redis
    await noteFeedFailure(r, source, { warn }, 'timeout')
    await noteFeedFailure(r, source, { warn }, 'timeout')
    await clearFeedFailures(r, source.id)
    await noteFeedFailure(r, source, { warn }, 'timeout')
    expect(await feedPaused(r, source.id)).toBe(false)
  })

  it('forgets the counts and pauses of feeds taken out of the registry', async () => {
    const redis = fakeRedis()
    const warn = vi.fn()
    const r = redis as unknown as Redis
    for (const id of ['kept-feed', 'removed-a', 'removed-b']) {
      for (let i = 0; i < 3; i++) await noteFeedFailure(r, { id, feedUrl: 'https://example.com/rss' }, { warn }, 'HTTP 403')
    }
    await redis.set('news-rss:item:removed-a:123', '1')   // other keys stay
    expect(await forgetRemovedFeeds(r, ['kept-feed', 'never-failed'])).toBe(2)
    expect([...redis.store.keys()].sort()).toEqual([
      'news-rss:fail:kept-feed', 'news-rss:item:removed-a:123', 'news-rss:pause:kept-feed',
    ])
    expect(await feedPaused(r, 'kept-feed')).toBe(true)
    expect(await feedPaused(r, 'removed-a')).toBe(false)
  })

  it('changes nothing when Redis cannot list its keys', async () => {
    const redis = fakeRedis()
    await redis.set('news-rss:fail:gone', '4')
    const r = { ...redis, scan: async () => { throw new Error('connection lost') } } as unknown as Redis
    expect(await forgetRemovedFeeds(r, [])).toBe(0)
    expect(redis.store.has('news-rss:fail:gone')).toBe(true)
  })
})

describe('news headline keywords', () => {
  it('counts plurals ("sanctions", "elections", "protests") as medium', () => {
    expect(detectNewsSeverity('EU agrees new sanctions on Iran', '')).toBe('medium')
    expect(detectNewsSeverity('Opposition wins regional elections', '')).toBe('medium')
    expect(detectNewsSeverity('Protests spread across the capital', '')).toBe('medium')
    expect(detectNewsSeverity('Two earthquakes shake the island', '')).toBe('medium')   // a quake of unknown strength (plan 0u)
    expect(detectNewsSeverity('Two strong earthquakes shake the island', '')).toBe('high')
  })

  it('files SpaceX and NASA launches under space but not people named Moon', () => {
    expect(detectNewsCategory('NASA astronauts return from the space station', '', 'technology')).toBe('space')
    expect(detectNewsCategory('Former president Moon Jae-in meets envoy', '', 'geopolitics')).toBe('geopolitics')
    expect(detectNewsCategory('Mars Inc. raises chocolate prices', '', 'economy')).toBe('economy')
  })
})

// ─── EU sanctions ───────────────────────────────────────────────────────────

describe('recentEuAmendments', () => {
  const now = Date.UTC(2026, 9, 11, 2, 0) // Oct 11, 2026 02:00 UTC
  const regimes = [
    { id: 48, specification: 'Restrictive measures in view of the situation in Nicaragua', notes: 'Adopted  in 2019.',
      amendment: Date.UTC(2026, 9, 8, 22) / 1000, country: { data: { code: 'NI', title: 'Nicaragua' } }, programme: [{}] },
    { id: 56, specification: "Restrictive measures in view of Iran's military support to Russia's war of aggression against Ukraine",
      amendment: Date.UTC(2026, 9, 7, 22) / 1000, country: { data: { code: 'IR', title: 'Iran' } } },
    { id: 1, specification: 'Restrictive measures imposed with respect to the Taliban',
      amendment: Date.UTC(2024, 8, 12, 22) / 1000, country: { data: { code: 'AF', title: 'Afghanistan' } } },
    { id: 46, specification: 'Restrictive measures against the proliferation and use of chemical weapons',
      amendment: Date.UTC(2026, 9, 5, 22) / 1000, country: { data: [] } },
    { id: 'x', specification: 'bad id', amendment: Date.UTC(2026, 9, 9) / 1000 },
    { id: 99, specification: 'No amendment date' },
  ]

  it('keeps only regimes amended in the last 7 days, newest first', () => {
    expect(recentEuAmendments(regimes, now).map(a => a.id)).toEqual([48, 56, 46])
  })

  it('reads the name, country, date, notes and the map link', () => {
    const [nicaragua] = recentEuAmendments(regimes, now)
    expect(nicaragua).toMatchObject({
      name: 'Restrictive measures in view of the situation in Nicaragua',
      country: 'Nicaragua',
      notes: 'Adopted in 2019.',
      url: 'https://www.sanctionsmap.eu/#/main/details/48',
    })
    expect(nicaragua.amendedAt.toISOString()).toBe('2026-10-08T22:00:00.000Z')
  })

  it('leaves the country empty for thematic regimes and survives junk', () => {
    expect(recentEuAmendments(regimes, now).find(a => a.id === 46)?.country).toBe('')
    expect(recentEuAmendments(null, now)).toEqual([])
    expect(recentEuAmendments({ data: [] }, now)).toEqual([])
  })
})

// ─── OTX ────────────────────────────────────────────────────────────────────

describe('otxEnabled', () => {
  const saved = process.env.OTX_API_KEY
  afterEach(() => {
    if (saved === undefined) delete process.env.OTX_API_KEY
    else process.env.OTX_API_KEY = saved
  })

  it('is on only with an API key', () => {
    delete process.env.OTX_API_KEY
    expect(otxEnabled()).toBe(false)
    process.env.OTX_API_KEY = '  '
    expect(otxEnabled()).toBe(false)
    process.env.OTX_API_KEY = 'abc123'
    expect(otxEnabled()).toBe(true)
  })
})
