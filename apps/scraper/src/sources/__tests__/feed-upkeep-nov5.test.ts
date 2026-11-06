/**
 * Feed upkeep, Nov 5, 2026 (Devon: "replace broken feeds if they're not live and give us time to fix the
 * broken feeds, find a way to fix the 19 failing"). Six of the 19 failing feeds' sites answer every automated
 * reader with a bot check: they are parked (tried once a day, not counted as failing, read as usual again
 * once they answer). Two outlets come in for places those six and four sites that are down left thin; six
 * more held back on their terms that morning went in at 8:18 PM on Devon's call ("Go in anyway"). The other
 * nine failing feeds answer from other networks and come back by themselves.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Redis } from 'ioredis'
import {
  NEWS_SOURCE_REGISTRY, HOME_PIN_SOURCES, inferGeo, parkedFeedDue, noteParkedResult, noteParkedFeeds, noteFeedFailure,
} from '../news-rss'

const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)
const PARKED = ['nation-news-bb', 'borba-me', 'sunday-standard-bw', 'scr-whats-in-blue', 'cuenca-high-life-ec', 'vant-bef-info-ht']
const ADDED = ['haitilibre-ht', 'noticel-pr']
const ANYWAY = ['barbados-today-bb', 'dan-me', 'portal-analitika-me', 'le-nouvelliste-ht', 'observer-ug', 'the-citizen-tz']
const host = (url: string) => new URL(url).hostname.replace(/^(?:www|rss)\./, '')

function fakeRedis() {
  const store = new Map<string, string>()
  const sets = new Map<string, Set<string>>()
  return {
    store, sets,
    async incr(key: string) { const n = Number(store.get(key) ?? 0) + 1; store.set(key, String(n)); return n },
    async expire() { return 1 },
    async set(key: string, value: string, ...opts: (string | number)[]) {
      if (opts.includes('NX') && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    },
    async exists(key: string) { return store.has(key) ? 1 : 0 },
    async get(key: string) { return store.get(key) ?? null },
    async del(...keys: string[]) { return keys.filter(k => store.delete(k) || sets.delete(k)).length },
    async sadd(key: string, ...members: string[]) {
      const s = sets.get(key) ?? new Set<string>()
      members.forEach(m => s.add(m))
      sets.set(key, s)
      return members.length
    },
  }
}

describe('feed upkeep (Nov 5, 2026)', () => {
  it('parks the six feeds behind a bot check, and only those, saying why', () => {
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.parked).map(s => s.id).sort()).toEqual([...PARKED].sort())
    for (const id of PARKED) expect(src(id)!.parked, id).toMatch(/check .*\(HTTP 40[39]\), Nov 5, 2026$/)
  })

  it('adds HaitiLibre and NotiCel, each read once, over https', () => {
    expect(ADDED.map(id => src(id)?.countryCode)).toEqual(['HT', 'PR'])
    for (const id of ADDED) {
      const s = src(id)!
      expect(s.feedUrl, id).toMatch(/^https:\/\//)
      expect(NEWS_SOURCE_REGISTRY.filter(x => x.feedUrl === s.feedUrl), id).toHaveLength(1)
      expect(NEWS_SOURCE_REGISTRY.filter(x => x.id === id), id).toHaveLength(1)
      expect(s.parked, id).toBeUndefined()
    }
  })

  it('adds the six held back on terms, on Devon\'s call at 8:18 PM ("Go in anyway")', () => {
    expect(ANYWAY.map(id => src(id)?.countryCode)).toEqual(['BB', 'ME', 'ME', 'HT', 'UG', 'TZ'])
    for (const id of ANYWAY) {
      const s = src(id)!
      expect(s.feedUrl, id).toMatch(/^https:\/\//)
      expect(NEWS_SOURCE_REGISTRY.filter(x => host(x.feedUrl) === host(s.feedUrl)), id).toHaveLength(1)
      expect(NEWS_SOURCE_REGISTRY.filter(x => x.id === id), id).toHaveLength(1)
    }
    // Le Nouvelliste's feed is its English edition; Dan and Portal Analitika write Montenegrin in Latin script
    expect(src('le-nouvelliste-ht')!.language).toBe('en')
    expect(['dan-me', 'portal-analitika-me'].map(id => src(id)!.language)).toEqual(['sr', 'sr'])
  })

  it('still leaves out Kuensel and the feeds held back for what they publish', () => {
    // Kuensel stays out on Devon's Oct 31 call. The Bhutanese's newest item was 5 days old, half of Business
    // Bhutan's were paid casino reviews, and much of Metro Puerto Rico's is lifestyle and opinion
    for (const h of ['kuenselonline.com', 'thebhutanese.bt', 'businessbhutan.bt', 'metro.pr']) {
      expect(NEWS_SOURCE_REGISTRY.some(s => host(s.feedUrl) === h), h).toBe(false)
    }
  })

  it('pins their stories at home, or where they name', () => {
    for (const id of [...ADDED, ...ANYWAY.filter(i => i !== 'the-citizen-tz' && i !== 'dan-me')]) expect(HOME_PIN_SOURCES.has(id), id).toBe(true)
    // about a third of The Citizen's feed is world news, and Dan's site-wide feed carries world, celebrity and
    // sport: their stories are placed by name
    expect(HOME_PIN_SOURCES.has('the-citizen-tz')).toBe(false)
    expect(HOME_PIN_SOURCES.has('dan-me')).toBe(false)
    expect(inferGeo('Rasel Brend proglašen krivim za silovanje i tri seksualna napada', '', src('dan-me')).countryCode).not.toBe('ME')
    expect(inferGeo('Budva bolja od BVSC Mane', '', src('dan-me')).countryCode).toBe('ME')
    // and a horoscope has no place of its own, even from an outlet whose other stories are pinned at home
    expect(inferGeo('Horoskop za 6. novembar: Lav okreće stvari u svoju korist, Jarac mora da se prilagodi', '', src('portal-analitika-me')).countryCode).not.toBe('ME')
    expect(inferGeo('DPS Zeta: Zamjena na mjestu predsjednika neće izbrisati pitanje', '', src('portal-analitika-me')).countryCode).toBe('ME')
    expect(inferGeo('Ronaldo retires from Portugal duty amid reported tensions with coach Jesus', '', src('the-citizen-tz')).countryCode).not.toBe('TZ')
    expect(inferGeo('Tanesco explains power cuts affecting four areas in Dar es Salaam, Coast', '', src('the-citizen-tz')).countryCode).toBe('TZ')
    expect(inferGeo('Police seek public’s help to identify person of interest', '', src('barbados-today-bb')).countryCode).toBe('BB')
    expect(inferGeo('Pronostican otra tarde lluviosa para el interior y noreste', '', src('noticel-pr')).countryCode).toBe('PR')
    expect(inferGeo('Latinos en EE.UU. fueron los votantes que más se alejaron de los republicanos y Trump', '', src('noticel-pr')).countryCode).toBe('US')
    expect(inferGeo("Haïti - FLASH : L'État passe à l'offensive contre les terroristes, adresse à la Nation", '', src('haitilibre-ht')).countryCode).toBe('HT')
    expect(inferGeo("Haïti - Quito : Les ministres de l'Éducation des Amériques approuvent une feuille de route", '', src('haitilibre-ht')).countryCode).toBe('EC')
  })

  it('leaves every place with a parked feed at least two feeds that are read every 30 minutes', () => {
    const read = (cc: string) => NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === cc && !s.parked).length
    expect(['BB', 'ME', 'HT', 'BW', 'EC'].map(read)).toEqual([3, 4, 4, 2, 3])
    // and the places with a site down, or one that turns the server away for now, have one more
    expect(['PR', 'UG', 'TZ'].map(read)).toEqual([3, 4, 3])
  })
})

describe('parked feeds (Nov 5, 2026)', () => {
  it('tries a parked feed once a day while it doesn\'t answer', async () => {
    const redis = fakeRedis()
    const r = redis as unknown as Redis
    expect(await parkedFeedDue(r, 'walled')).toBe('daily-try')
    expect(await parkedFeedDue(r, 'walled')).toBeNull()        // the rest of that day
    await noteParkedResult(r, 'walled', false)
    expect(await parkedFeedDue(r, 'walled')).toBeNull()
    redis.store.delete('news-rss:parked-try:walled')            // the day is up
    expect(await parkedFeedDue(r, 'walled')).toBe('daily-try')
  })

  it('reads it as usual from the first time it answers, and goes back to once a day when it stops', async () => {
    const redis = fakeRedis()
    const r = redis as unknown as Redis
    expect(await parkedFeedDue(r, 'walled')).toBe('daily-try')
    await noteParkedResult(r, 'walled', true)
    expect(await parkedFeedDue(r, 'walled')).toBe('answering')
    expect(await parkedFeedDue(r, 'walled')).toBe('answering')
    await noteParkedResult(r, 'walled', false)
    expect(await parkedFeedDue(r, 'walled')).toBeNull()        // its try for the day is used up
  })

  it('takes the parked feeds off the failing list when the poller starts, and lists them', async () => {
    const redis = fakeRedis()
    const r = redis as unknown as Redis
    const warn = vi.fn()
    for (const id of ['walled', 'broken']) {
      for (let i = 0; i < 3; i++) await noteFeedFailure(r, { id, feedUrl: 'https://example.com/rss' }, { warn }, 'HTTP 403')
    }
    redis.sets.set('news-rss:parked', new Set(['unparked-since']))
    expect(await noteParkedFeeds(r, [{ id: 'walled', parked: 'bot check page (HTTP 403)' }, { id: 'broken' }])).toBe(1)
    expect([...redis.store.keys()].filter(k => k.endsWith(':walled'))).toEqual([])
    expect([...redis.store.keys()].filter(k => k.endsWith(':broken')).sort())
      .toEqual(['news-rss:fail:broken', 'news-rss:pause:broken', 'news-rss:why:broken'])
    expect([...redis.sets.get('news-rss:parked')!]).toEqual(['walled'])
  })

  it('reads nothing when Redis is down, rather than reading a walled site every 30 minutes', async () => {
    const down = { exists: async () => { throw new Error('connection lost') }, set: async () => { throw new Error('connection lost') } }
    expect(await parkedFeedDue(down as unknown as Redis, 'walled')).toBeNull()
  })
})
