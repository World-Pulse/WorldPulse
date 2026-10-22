/**
 * The coverage gap, GET /api/v1/coverage-gap (Devon, Oct 21, 2026, 10:02 PM:
 * "Let's get after it"): UNHCR's displaced people for each crisis against the
 * news outlets WorldPulse placed in the country, the most people for the
 * fewest outlets first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  hostRows: [] as Array<Record<string, unknown>>,
  storyRows: [] as Array<Record<string, unknown>>,
  sql: [] as string[],
  bindings: [] as unknown[][],
  kept: new Map<string, string>(),
  ttl: new Map<string, number>(),
}))

vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => h.kept.get(k) ?? null),
    setex: vi.fn(async (k: string, ttl: number, v: string) => { h.kept.set(k, v); h.ttl.set(k, ttl); return 'OK' }),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
}))
vi.mock('../db/postgres', () => {
  const raw = vi.fn(async (sql: string, bindings: unknown[]) => {
    h.sql.push(sql)
    h.bindings.push(bindings)
    return { rows: sql.includes('row_number()') ? h.storyRows : h.hostRows }
  })
  return { db: Object.assign(vi.fn(), { raw }) }
})
vi.mock('../lib/long-query', async () => {
  const { db } = await import('../db/postgres')
  return { longQuery: vi.fn(async (_s: number, run: (trx: unknown) => Promise<unknown>) => run({ raw: db.raw })) }
})

const gap = await import('../lib/coverage-gap')
const { registerCoverageGapRoutes } = await import('../routes/coverage-gap')
const { EVENT_TEMPLATE_SQL } = await import('../lib/story-list')
const { isoWeekOf, weekName } = await import('../lib/week')
const { UNHCR_DISPLACED } = await import('../lib/unhcr-displaced')

const displaced = (code: string) => UNHCR_DISPLACED[code]![0] + UNHCR_DISPLACED[code]![1]
/** knex's placeholders: a ? not written \? */
const placeholders = (sql: string) => (sql.match(/(?<!\\)\?/g) ?? []).length

const ten = (prefix: string, n: number, articles: number) =>
  Array.from({ length: n }, (_, i) => ({ code: prefix, host: `${prefix.toLowerCase()}-outlet-${i}.com`, articles }))

function rowsForAWeek() {
  h.hostRows = [
    { code: 'SD', host: 'dabangasudan.org', articles: 12 },
    { code: 'SD', host: 'sudanspost.com', articles: 4 },
    { code: 'SD', host: 'www.aljazeera.com', articles: 3 },
    { code: 'SD', host: 'aljazeera.com', articles: 2 },
    // data feeds and press offices: not outlets
    { code: 'SD', host: 'earthquake.usgs.gov', articles: 9 },
    { code: 'SD', host: 'reliefweb.int', articles: 3 },
    { code: 'SD', host: 'www.icrc.org', articles: 2 },
    { code: 'SD', host: null, articles: 5 },
    { code: 'CF', host: 'oubanguimedias.com', articles: 2 },
    { code: 'US', host: 'cnn.com', articles: 50 },
    { code: 'US', host: 'nytimes.com', articles: 40 },
    { code: 'US', host: 'foxnews.com', articles: 30 },
    { code: 'US', host: 'npr.org', articles: 20 },
    { code: 'US', host: 'apnews.com', articles: 10 },
    { code: 'US', host: 'reuters.com', articles: 5 },
    ...ten('UA', 7, 10),
    // not a country code
    { code: 'u1', host: 'example.com', articles: 4 },
  ]
  h.storyRows = [
    { code: 'SD', lead_id: 'a1', title: 'Drone strike kills 40 at El Fasher market | Radio Dabanga', sites: 3, verified: true },
    { code: 'SD', lead_id: 'a2', title: 'Aid convoy reaches Tawila camp after weeks of delays', sites: 2, verified: true },
    { code: 'SD', lead_id: 'a3', title: 'Cholera cases rise in North Darfur camps', sites: 1, verified: false },
    { code: 'SD', lead_id: 'a4', title: 'A fourth story the page has no room for', sites: 1, verified: false },
    { code: 'CF', lead_id: 'b1', title: 'Armed group attacks village near Bangui', sites: 1, verified: false },
  ]
}

const W = { window: 'week' as const, week: '2026-W42', start: new Date('2026-10-12T00:00:00Z'), end: new Date('2026-10-19T00:00:00Z') }

beforeEach(() => {
  h.hostRows = []; h.storyRows = []; h.sql = []; h.bindings = []; h.kept.clear(); h.ttl.clear()
})

describe('what counts as a news outlet', () => {
  it('news websites count; data feeds and official press offices don\'t', () => {
    for (const site of ['dabangasudan.org', 'radiookapi.net', 'news.un.org', 'aljazeera.com']) expect(gap.isOutlet(site)).toBe(true)
    for (const site of ['earthquake.usgs.gov', 'firms.modaps.eosdis.nasa.gov', 'reliefweb.int', 'gdacs.org', 'press.un.org', 'icrc.org', 'gov.uk', 'acleddata.com', '', 'localhost', null]) {
      expect(gap.isOutlet(site)).toBe(false)
    }
  })
})

describe('the crises', () => {
  it('are the countries with at least a million people displaced, inside or abroad, largest first', () => {
    const crises = gap.crisisCountries()
    expect(crises.length).toBeGreaterThan(10)
    expect(crises[0]!.code).toBe('SD')
    for (const c of crises) expect(c.displaced).toBeGreaterThanOrEqual(gap.MIN_DISPLACED)
    for (let i = 1; i < crises.length; i++) expect(crises[i - 1]!.displaced).toBeGreaterThanOrEqual(crises[i]!.displaced)
    expect(crises.map(c => c.code)).toContain('CF')
    // UNHCR's figures leave out the refugees UNRWA serves
    expect(crises.map(c => c.code)).not.toContain('PS')
  })

  it('a headline names a crisis country by its name, spellings, capital or places, at the start of a word', () => {
    expect(gap.namesCountry('SY', 'Syrian authorities arrest main suspect in Baniyas killings')).toBe(true)
    expect(gap.namesCountry('SY', 'Palestinian Activist Mahmoud Khalil Appeals to the Supreme Court')).toBe(false)
    expect(gap.namesCountry('IQ', 'Iraqi forces close a border crossing')).toBe(true)
    expect(gap.namesCountry('YE', 'Houthis attack presidential palace in Aden')).toBe(true)
    expect(gap.namesCountry('YE', 'Twenty years after bin Laden')).toBe(false)
    expect(gap.namesCountry('ET', 'En Éthiopie, la guerre reprend au Tigré')).toBe(true)
    expect(gap.namesCountry('CD', 'M23 advances toward Uvira')).toBe(true)
    expect(gap.namesCountry('AF', "CNN's Christiane Amanpour Announces Exit From Network After 43 Years")).toBe(false)
    // a country without its own list: its name's stem
    expect(gap.namesCountry('FR', 'French unions strike')).toBe(false)
    expect(gap.namesCountry('FR', 'France votes')).toBe(true)
  })

  it('full names where the country list abbreviates', () => {
    expect(gap.countryName('CF')).toBe('Central African Republic')
    expect(gap.countryName('SD')).toBe('Sudan')
  })
})

describe('buildCoverageGap', () => {
  it('counts each crisis\'s outlets and articles, leaving out data feeds, and ranks by people displaced per outlet', () => {
    rowsForAWeek()
    const d = gap.buildCoverageGap(h.hostRows as never, h.storyRows as never, W, new Date('2026-10-19T01:00:00Z'))
    const sd = d.crises.find(c => c.code === 'SD')!
    expect(sd).toMatchObject({ name: 'Sudan', outlets: 3, articles: 21, displaced: displaced('SD'), peoplePerOutlet: Math.round(displaced('SD') / 3) })
    // where they're based (the outlet directory): Radio Dabanga in Sudan; Sudans Post (South Sudan) and Al Jazeera (Qatar) abroad
    expect(sd).toMatchObject({ outletsHome: 1, outletsAbroad: 2 })
    expect(sd.sites).toEqual([{ site: 'dabangasudan.org', articles: 12 }, { site: 'aljazeera.com', articles: 5 }, { site: 'sudanspost.com', articles: 4 }])
    // three of its stories, the headline without the outlet's name; those naming the country's places first
    expect(sd.stories).toEqual([
      { id: 'a1', title: 'Drone strike kills 40 at El Fasher market', outlets: 3, verified: true },
      { id: 'a3', title: 'Cholera cases rise in North Darfur camps', outlets: 1, verified: false },
      { id: 'a2', title: 'Aid convoy reaches Tawila camp after weeks of delays', outlets: 2, verified: true },
    ])
    const cf = d.crises.find(c => c.code === 'CF')!
    expect(cf).toMatchObject({ name: 'Central African Republic', outlets: 1, articles: 2, peoplePerOutlet: displaced('CF') })

    // the crises no outlet covered first, the most people first; then the most people for the fewest outlets
    const uncovered = d.crises.filter(c => c.outlets === 0)
    const covered = d.crises.filter(c => c.outlets > 0)
    expect(d.crises).toEqual([...uncovered, ...covered])
    for (let i = 1; i < uncovered.length; i++) expect(uncovered[i - 1]!.displaced).toBeGreaterThanOrEqual(uncovered[i]!.displaced)
    for (let i = 1; i < covered.length; i++) expect(covered[i - 1]!.peoplePerOutlet).toBeGreaterThanOrEqual(covered[i]!.peoplePerOutlet)
    // Sudan 12.9 million for 3 outlets, Ukraine 9.0 million for 7, the Central African Republic 1.2 million for 1
    expect(covered.map(c => c.code)).toEqual(['SD', 'UA', 'CF'])
    expect(d.crises.map(c => c.rank)).toEqual(d.crises.map((_, i) => i + 1))
    expect(uncovered[0]).toMatchObject({ code: 'SY', articles: 0, peoplePerOutlet: displaced('SY'), sites: [], stories: [] })
    expect(d.crises[0]!.code).toBe('SY')
    const ua = d.crises.find(c => c.code === 'UA')!
    // websites the directory doesn't know are neither at home nor abroad
    expect(ua).toMatchObject({ outlets: 7, articles: 70, outletsHome: 0, outletsAbroad: 0 })
  })

  it('the most covered countries for comparison, and the share of the week\'s articles the crises got', () => {
    rowsForAWeek()
    const d = gap.buildCoverageGap(h.hostRows as never, h.storyRows as never, W)
    expect(d.mostCovered.map(c => [c.code, c.outlets])).toEqual([['UA', 7], ['US', 6], ['SD', 3], ['CF', 1]])
    expect(d.mostCovered[1]).toEqual({ code: 'US', name: 'United States', outlets: 6, articles: 155 })
    // 21 (Sudan) + 2 (Central African Republic) + 70 (Ukraine) of 248
    expect(d.totals).toEqual({
      articles: 248, outlets: 17, countries: 4, crisisArticles: 93, crisisShare: 0.375,
      crisisDisplaced: gap.crisisCountries().reduce((t, c) => t + c.displaced, 0),
    })
    expect(d).toMatchObject({ window: 'week', week: '2026-W42', start: '2026-10-12T00:00:00.000Z', end: '2026-10-19T00:00:00.000Z', minDisplaced: 1_000_000 })
  })

  it("a crisis's story that doesn't name it (placed there by mistake) comes after those that do", () => {
    const rows = [
      { code: 'SY', lead_id: 'k1', title: 'Palestinian Activist Mahmoud Khalil Appeals to the Supreme Court', sites: 6, verified: true },
      { code: 'SY', lead_id: 'k2', title: 'Syrian authorities arrest main suspect in 2013 Baniyas mass killing', sites: 4, verified: true },
      { code: 'SY', lead_id: 'k3', title: 'Court in Damascus sentences two over coastal violence', sites: 3, verified: true },
      { code: 'SY', lead_id: 'k4', title: 'Another story about somewhere else', sites: 2, verified: false },
    ]
    const d = gap.buildCoverageGap([{ code: 'SY', host: 'sana.sy', articles: 3 }], rows, W)
    expect(d.crises.find(c => c.code === 'SY')!.stories.map(s => s.id)).toEqual(['k2', 'k3', 'k1'])
  })

  it('a week with no reports: every crisis at zero, nothing to divide', () => {
    const d = gap.buildCoverageGap([], [], W)
    expect(d.crises.every(c => c.outlets === 0 && c.peoplePerOutlet === c.displaced)).toBe(true)
    expect(d.totals).toMatchObject({ articles: 0, outlets: 0, crisisShare: 0 })
    expect(d.mostCovered).toEqual([])
  })
})

describe('the queries', () => {
  it('each ? is a value: the link patterns write theirs \\?', () => {
    expect(placeholders(gap.HOSTS_SQL)).toBe(3)
    expect(placeholders(gap.STORIES_SQL)).toBe(7)
    expect(gap.HOSTS_SQL).toContain("'^https\\?://([^/:\\?#]+)'")
  })

  it('news reports only, no press offices, no sports or culture; the crises\' stories for their countries', async () => {
    rowsForAWeek()
    await gap.makeCoverageGap(W)
    const hosts = h.sql.findIndex(s => !s.includes('row_number()'))
    const stories = h.sql.findIndex(s => s.includes('row_number()'))
    expect(h.sql[hosts]).toMatch(/'news' = ANY\(s\.tags\) OR 'gdelt' = ANY\(s\.tags\)/)
    expect(h.sql[hosts]).toMatch(/NOT \('institutional' = ANY\(s\.tags\)\)/)
    expect(h.bindings[hosts]).toEqual([W.start, W.end, ['sports', 'culture', 'technology', 'science', 'space']])
    // up to 8 stories a crisis, crisis topics first (then the headlines naming the country are put first)
    expect(h.bindings[stories]).toEqual([EVENT_TEMPLATE_SQL, W.start, W.end, gap.crisisCountries().map(c => c.code), ['sports', 'culture', 'technology', 'science', 'space'], [...gap.CRISIS_TOPICS], 8])
    expect(h.sql[stories]).toMatch(/ORDER BY k\.has_headline DESC, k\.crisis_topic DESC, k\.sites DESC/)
  })
})

describe('GET /api/v1/coverage-gap', () => {
  async function app() {
    const a = Fastify({ logger: false })
    await a.register(registerCoverageGapRoutes, { prefix: '/api/v1/coverage-gap' })
    return a
  }

  it('the last 7 days: made while the caller waits the first time, then kept an hour and served a day while remade', async () => {
    rowsForAWeek()
    const a = await app()
    const res = await a.inject({ method: 'GET', url: '/api/v1/coverage-gap' })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.window).toBe('last7days')
    expect(d.week).toBeNull()
    expect(new Date(d.end).getTime() - new Date(d.start).getTime()).toBe(7 * 86_400_000)
    expect(d.crises.length).toBe(gap.crisisCountries().length)
    expect(h.ttl.get('coverage:gap:v3:last7days')).toBe(3_600 + 24 * 3_600)
  })

  it('a finished week: made in the background the first time (503 with Retry-After), then served', async () => {
    rowsForAWeek()
    const a = await app()
    const first = await a.inject({ method: 'GET', url: '/api/v1/coverage-gap?week=2026-W42' })
    expect(first.statusCode).toBe(503)
    expect(first.headers['retry-after']).toBe('120')
    await vi.waitFor(() => expect(h.kept.has('coverage:gap:v3:2026-W42')).toBe(true))
    expect(h.ttl.get('coverage:gap:v3:2026-W42')).toBe(24 * 3_600 + 30 * 86_400)
    const res = await a.inject({ method: 'GET', url: '/api/v1/coverage-gap?week=2026-W42' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ window: 'week', week: '2026-W42', start: '2026-10-12T00:00:00.000Z', end: '2026-10-19T00:00:00.000Z' })
  })

  it('a week that isn\'t one, isn\'t over, or hasn\'t begun', async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/v1/coverage-gap?week=last' })).statusCode).toBe(400)
    const current = weekName(isoWeekOf(new Date()))
    const now = await a.inject({ method: 'GET', url: `/api/v1/coverage-gap?week=${current}` })
    expect(now.statusCode).toBe(400)
    expect(now.json().error).toMatch(/not over yet/)
    expect((await a.inject({ method: 'GET', url: '/api/v1/coverage-gap?week=2099-W01' })).statusCode).toBe(404)
    expect(h.sql).toEqual([])
  })
})
