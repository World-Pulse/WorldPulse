import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import fr from '../../messages/fr.json'
import pt from '../../messages/pt.json'

// Under-reported crises (the coverage gap, Oct 21, 2026; Devon: "Let's get
// after it"): the countries with at least a million people displaced, ranked
// by how few news outlets reported on them

const h = vi.hoisted(() => ({ status: 200, body: {} as unknown, urls: [] as string[] }))
vi.mock('@/lib/server-fetch', () => ({
  cachedFetch: vi.fn(async (url: string) => {
    h.urls.push(url)
    return { status: h.status, ok: h.status >= 200 && h.status < 300, json: async () => h.body }
  }),
}))

const { CoverageGapView } = await import('@/components/under-reported/CoverageGapView')
const { fetchCoverageGap, gapCardText, gapDescription, gapJsonLd, gapSpan, gapTitle, people } = await import('@/lib/coverage-gap')
type CoverageGapData = import('@/lib/coverage-gap').CoverageGapData

const week: CoverageGapData = {
  window: 'week',
  week: '2026-W40',
  start: '2026-09-28T00:00:00.000Z',
  end: '2026-10-05T00:00:00.000Z',
  minDisplaced: 1_000_000,
  unhcrYear: 2025,
  crises: [
    { rank: 1, code: 'SY', name: 'Syria', displaced: 10_562_346, inside: 5_542_227, abroad: 5_020_119, outlets: 0, articles: 0, peoplePerOutlet: 10_562_346, sites: [], stories: [] },
    {
      rank: 2, code: 'SS', name: 'South Sudan', displaced: 3_788_010, inside: 2_000_000, abroad: 1_788_010, outlets: 7, outletsHome: 2, outletsAbroad: 3, articles: 12, peoplePerOutlet: 541_144,
      sites: [{ site: 'radiotamazuj.org', articles: 4 }, { site: 'eyeradio.org', articles: 3 }, { site: 'sudanspost.net', articles: 2 }, { site: 'aljazeera.com', articles: 1 }, { site: 'bbc.com', articles: 1 }],
      stories: [{ id: 'sig-1', title: 'Floods cut off Bentiu camps', outlets: 3, verified: true }],
    },
    { rank: 3, code: 'CF', name: 'Central African Republic', displaced: 1_184_301, inside: 427_479, abroad: 756_822, outlets: 1, articles: 1, peoplePerOutlet: 1_184_301 / 1, sites: [{ site: 'radiondekeluka.org', articles: 1 }], stories: [{ id: 'sig-2', title: 'Armed group attacks village near Bangui', outlets: 1, verified: false }] },
  ],
  mostCovered: [{ code: 'US', name: 'United States', outlets: 412, articles: 9_000 }, { code: 'IL', name: 'Israel', outlets: 210, articles: 3_100 }],
  totals: { articles: 52_000, outlets: 1_400, countries: 160, crisisArticles: 3_182, crisisShare: 0.0612, crisisDisplaced: 94_989_774 },
  generatedAt: '2026-10-05T00:05:00.000Z',
}

const last7: CoverageGapData = { ...week, window: 'last7days', week: null, start: '2026-10-14T22:00:00.000Z', end: '2026-10-21T22:00:00.000Z' }

beforeEach(() => { h.status = 200; h.body = {}; h.urls = [] })

describe('the words', () => {
  it('counts people in millions, and names the dates', () => {
    expect(people(12_900_343)).toBe('12.9 million')
    expect(people(980_000)).toBe('980,000')
    expect(gapSpan(week)).toBe('Sep 28–Oct 4, 2026')
    expect(gapSpan(last7)).toBe('Oct 14–21, 2026')
    expect(gapTitle(week)).toBe('Under-reported crises: Sep 28–Oct 4, 2026')
    expect(gapTitle(last7)).toBe('Under-reported crises this week')
    expect(gapDescription(week)).toBe("3 countries where at least a million people are displaced, ranked by how few news outlets reported on them in the week of Sep 28–Oct 4, 2026: Syria, South Sudan, Central African Republic first. UNHCR's figures against the outlets WorldPulse reads.")
  })

  it('the share picture names the least covered crisis, with one bar per crisis', () => {
    const t = gapCardText(last7)
    expect(t).toMatchObject({
      name: 'Syria',
      kind: 'MOST UNDER-REPORTED CRISIS · OCT 14–21',
      counts: '10.6 million displaced · 0 outlets in 7 days',
      bars: [0, 7, 1],
      story: 'Then South Sudan, Central African Republic',
      proof: 'UNHCR figures · the outlets WorldPulse reads',
      verified: false,
    })
  })

  it('structured data: a dataset based on UNHCR\'s, with the API as its download', () => {
    const j = gapJsonLd(week)
    expect(j).toMatchObject({
      '@type': 'Dataset',
      url: 'https://world-pulse.io/under-reported/2026-W40',
      temporalCoverage: '2026-09-28/2026-10-05',
      isBasedOn: { url: 'https://www.unhcr.org/refugee-statistics/', license: 'https://creativecommons.org/licenses/by/4.0/' },
      distribution: { contentUrl: 'https://api.world-pulse.io/api/v1/coverage-gap?week=2026-W40' },
    })
  })
})

describe('CoverageGapView', () => {
  it('lists the crises in order, the uncovered one said plainly, each with its outlets and top story', () => {
    const html = renderToStaticMarkup(<CoverageGapView data={week} />)
    expect(html.indexOf('Syria')).toBeLessThan(html.indexOf('South Sudan'))
    expect(html).toContain('href="/countries/SY"')
    expect(html).toContain('No outlet WorldPulse reads reported on it that week.')
    expect(html).toContain('3.8 million displaced')
    expect(html).toContain('541,144 people per outlet')
    // where its outlets are based, for those WorldPulse's outlet list knows (Oct 22, 2026)
    expect(html).toContain('(3 based abroad)')
    expect(html.match(/based abroad\)/g)).toHaveLength(1)
    expect(html).toContain('href="/signals/sig-1"')
    expect(html).toContain('Verified · 3 outlets')
    expect(html).toContain('Reported by radiotamazuj.org, eyeradio.org, sudanspost.net, aljazeera.com, bbc.com and 2 more')
    expect(html).toContain('<strong class="text-wp-text">6.1%</strong>')
    expect(html).toContain('95.0 million displaced people')
  })

  it('compares with the most covered countries, says how it counts and credits UNHCR', () => {
    const html = renderToStaticMarkup(<CoverageGapView data={week} />)
    expect(html).toContain('United States <span class="text-wp-text3">· 412 outlets</span>')
    expect(html).toContain('href="https://www.unhcr.org/refugee-statistics/"')
    expect(html).toContain('CC BY 4.0')
    expect(html).toContain('it counts the outlets WorldPulse reads, not all the world&#x27;s')
    expect(html).toContain('https://api.world-pulse.io/api/v1/coverage-gap?week=2026-W40')
    expect(html).toContain('"@type":"Dataset"')
  })

  it('links the last 7 days, the next week and the four before, and WorldPulse Week', () => {
    const html = renderToStaticMarkup(<CoverageGapView data={week} />)
    expect(html).toContain('href="/under-reported"')
    expect(html).toContain('href="/under-reported/2026-W41"')
    for (const w of ['2026-W39', '2026-W38', '2026-W37', '2026-W36']) expect(html).toContain(`href="/under-reported/${w}"`)
    expect(html).toContain('href="/week"')
    const live = renderToStaticMarkup(<CoverageGapView data={last7} />)
    expect(live).toContain('Last 7 days · Oct 14–21, 2026')
    expect(live).not.toContain('Next week')
  })
})

describe('fetchCoverageGap', () => {
  it('asks the API for the last 7 days or a week; a bad week is missing, an API that fails is unavailable', async () => {
    h.body = { success: true, data: week }
    expect(await fetchCoverageGap('2026-W40')).toEqual(week)
    expect(h.urls[0]).toMatch(/\/api\/v1\/coverage-gap\?week=2026-W40$/)
    await fetchCoverageGap()
    expect(h.urls[1]).toMatch(/\/api\/v1\/coverage-gap$/)
    h.status = 400
    expect(await fetchCoverageGap('2026-W99')).toBe('missing')
    h.status = 503
    expect(await fetchCoverageGap('2026-W30')).toBe('unavailable')
  })
})

describe('how readers find it', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

  it('is in the left menu after WorldPulse Week, in every language the menu offers', () => {
    const src = read('components/sidebar/LeftSidebar.tsx')
    expect(src.indexOf("{ href: '/under-reported'")).toBeGreaterThan(src.indexOf("{ href: '/week'"))
    expect([en.nav.underReported, es.nav.underReported, fr.nav.underReported, pt.nav.underReported]).toEqual(['Under-reported', 'Crisis olvidadas', 'Crises oubliées', 'Crises esquecidas'])
  })

  it('is linked from WorldPulse Week, the sitemap and llms.txt', () => {
    expect(read('components/week/WeekView.tsx')).toContain('href="/under-reported"')
    expect(read('app/sitemap.ts')).toContain("{ path: '/under-reported'")
    expect(read('app/sitemap.ts')).toContain('`${SITE_URL}/under-reported/${w.name}`')
    expect(read('app/llms.txt/route.ts')).toContain('(${SITE_URL}/under-reported)')
  })
})
