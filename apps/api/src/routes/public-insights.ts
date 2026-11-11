/**
 * Open counts for the AI tools of Nov 10, 2026, night (Devon, 6:48 PM: "Let's get to 100 AI tools before we list it
 * on the directories"), under /api/v1/public like the other open endpoints: no sign-in or key, each kept a few
 * minutes and served while it is remade, each query a long one (the pool's 5-second limit is for pages).
 *
 *   GET /chokepoints            the shipping chokepoints named in the news, the most first
 *   GET /vulnerabilities        CISA's newest Known Exploited Vulnerabilities, as WorldPulse read them
 *   GET /travel-advice          the US State Department's levels, and a country's US and UK travel notices
 *   GET /first-reporters        the outlets that most often reported a story first
 *   GET /verification-speed     how long the last hours' verified stories took to find a second outlet
 *   GET /topics                 the last hours' news reports by topic, against the hours before
 *   GET /outlet-reports         one outlet's newest reports
 *   GET /feed-reports           a government feed's newest reports (sanctions, US weather alerts, carriers)
 *   GET /news-watch             one kind of news by country: cyber attacks, elections, disasters
 *   GET /busiest-outlets        the outlets WorldPulse read the most reports from
 *   GET /news-by-hour           the last hours' news reports hour by hour
 *   GET /serious-places         the countries with the most critical and high-severity news reports
 *   GET /country-changes        each country's news reports of the last days against the days before
 *   GET /news-by-day            the news reports of the last days, day by day: the world's or one topic's
 *   GET /topic-countries        one topic's news reports by the country they are placed in
 *   GET /country-coverage       who reports on a country: its news reports by outlet and by language
 */
import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'
import { longQuery } from '../lib/long-query'
import { staleWhileRevalidate } from '../lib/swr-cache'
import { outletOf } from '../lib/outlets'
import { REGION_IDS, regionCountries, type RegionId } from '../lib/regions'
import { READER_TOPICS, isReaderTopic } from '../lib/topics'

/** News reports, not a machine feed's (aircraft, fires, quakes): GDELT's articles are news (as public.ts counts) */
const NEWS_ONLY = "(NOT (tags @> ARRAY['osint']::text[]) OR tags @> ARRAY['gdelt']::text[])"
/** A report's website: its first link's host, without "www." */
const SITE_OF = "lower(regexp_replace(split_part(original_urls[1], '/', 3), '^www\\.', ''))"

function boundedInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

const rowsOf = (r: unknown) => ((r as { rows?: Array<Record<string, unknown>> }).rows ?? [])
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null)

// ─── Chokepoints ─────────────────────────────────────────────────────────────

/**
 * Each chokepoint's names in the languages WorldPulse reads most (lib/chokepoints.ts has its place): `words` decides
 * whether a headline names it; `like`, simple fragments every such headline holds, finds the candidates fast (a
 * case-blind regex over a week of headlines ran past 20 seconds, Nov 10, 2026). A Russian fragment leaves out its
 * first letter, so "Ормуз" and "ормуз" both hold "рмуз" whatever the database's locale makes of case.
 */
export const CHOKEPOINT_NAMES: Array<{ id: string; name: string; words: string; like: string[] }> = [
  { id: 'hormuz', name: 'Strait of Hormuz', words: 'hormuz|ormuz|hormus|هرمز|[Оо]рмуз', like: ['ormuz', 'hormus', 'هرمز', 'рмуз'] },
  { id: 'suez', name: 'Suez Canal', words: 'suez|السويس|[Сс]уэц', like: ['suez', 'السويس', 'уэц'] },
  { id: 'bab-el-mandeb', name: 'Bab el-Mandeb', words: 'bab[ -]?el[ -]?mandeb|bab al[ -]mandab|باب المندب|[Бб]аб-эль-[Мм]андеб', like: ['mandeb', 'mandab', 'المندب', 'андеб'] },
  { id: 'malacca', name: 'Strait of Malacca', words: 'malacca|malaca|malakka|selat melaka', like: ['malac', 'malakka', 'selat melaka'] },
  { id: 'panama', name: 'Panama Canal', words: 'panama canal|canal de panam[aá]|canal du panama|panamakanal|[Пп]анамск[а-я]* канал', like: ['panama canal', 'canal de panam', 'canal du panama', 'panamakanal', 'анамск'] },
  { id: 'taiwan', name: 'Taiwan Strait', words: 'taiwan strait|strait of taiwan|estrecho de taiw[aá]n|d[ée]troit de ta[iï]wan|taiwanstra[sß]e|[Тт]айваньск[а-я]* пролив', like: ['taiwan strait', 'strait of taiwan', 'estrecho de taiw', 'troit de ta', 'taiwanstra', 'айваньск'] },
  { id: 'bosporus', name: 'Turkish Straits', words: 'bosporus|bosphorus|b[oó]sforo|bosphore|dardanelles|dardanelos|turkish straits|[Бб]осфор', like: ['bospor', 'bosphor', 'sforo', 'dardanel', 'turkish straits', 'осфор'] },
  { id: 'gibraltar', name: 'Strait of Gibraltar', words: 'strait of gibraltar|gibraltar strait|estrecho de gibraltar|d[ée]troit de gibraltar|stra[sß]e von gibraltar', like: ['strait of gibraltar', 'gibraltar strait', 'estrecho de gibraltar', 'troit de gibraltar', 'von gibraltar'] },
  { id: 'dover', name: 'Strait of Dover', words: 'strait of dover|dover strait|d[ée]troit du pas[ -]de[ -]calais', like: ['strait of dover', 'dover strait', 'troit du pas'] },
  { id: 'good-hope', name: 'Cape of Good Hope', words: 'cape of good hope|cabo da boa esperan[çc]a|cap de bonne[ -]esp[ée]rance|cabo de buena esperanza|kap der guten hoffnung', like: ['good hope', 'boa esperan', 'bonne-esp', 'bonne esp', 'buena esperanza', 'guten hoffnung'] },
  { id: 'danish-straits', name: 'Danish Straits', words: 'danish straits|[øöo]resund|great belt|storeb[æa]lt', like: ['danish straits', 'resund', 'great belt', 'storeb'] },
  { id: 'lombok', name: 'Lombok Strait', words: 'lombok strait|selat lombok', like: ['lombok strait', 'selat lombok'] },
]

export interface ChokepointNews { id: string; name: string; reports: number; verified: number; latest: { id: string; title: string; at: string | null; verified: boolean } | null }

async function chokepointNews(days: number): Promise<ChokepointNews[]> {
  const like = CHOKEPOINT_NAMES.flatMap(c => c.like).map(f => `%${f}%`)
  const result = await longQuery(60, trx => trx.raw(
    `SELECT id::text AS id, title, status::text AS status, created_at
       FROM signals
      WHERE created_at > NOW() - make_interval(days => ?)
        AND status IN ('verified', 'pending')
        AND ${NEWS_ONLY}
        AND title ILIKE ANY (?::text[])
      ORDER BY created_at DESC
      LIMIT 20000`, [days, like]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  return CHOKEPOINT_NAMES.map(c => {
    const re = new RegExp(c.words, 'iu')
    const mine = rows.filter(r => re.test(String(r.title ?? '')))
    const verified = mine.filter(r => r.status === 'verified')
    const latest = verified[0] ?? mine[0]
    return {
      id: c.id, name: c.name, reports: mine.length, verified: verified.length,
      latest: latest ? { id: String(latest.id), title: String(latest.title), at: iso(latest.created_at), verified: latest.status === 'verified' } : null,
    }
  }).sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name))
}

// ─── Exploited vulnerabilities (CISA KEV, sources/cisa-kev.ts in the scraper) ─────────────

export interface Vulnerability { id: string; title: string; summary: string | null; severity: string | null; at: string | null; cve: string | null; vendor: string | null; ransomware: boolean }

const NOT_VENDOR = new Set(['osint', 'cybersecurity', 'cisa', 'kev', 'vulnerability', 'ransomware'])

async function vulnerabilities(days: number): Promise<Vulnerability[]> {
  const result = await longQuery(20, trx => trx.raw(
    `SELECT id::text AS id, title, summary, severity::text AS severity, created_at, tags
       FROM signals
      WHERE created_at > NOW() - make_interval(days => ?)
        AND tags @> ARRAY['kev']::text[]
      ORDER BY created_at DESC
      LIMIT 200`, [days]) as unknown as Promise<unknown>)
  return rowsOf(result).map(r => {
    const tags = Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : []
    const cve = tags.find(t => /^cve-\d{4}-\d+$/.test(t))
    const vendor = tags.find(t => !NOT_VENDOR.has(t) && !/^cve-/.test(t))
    return {
      id: String(r.id), title: String(r.title ?? ''), summary: r.summary ? String(r.summary) : null, severity: r.severity ? String(r.severity) : null,
      at: iso(r.created_at), cve: cve ? cve.toUpperCase() : null, vendor: vendor ?? null, ransomware: tags.includes('ransomware'),
    }
  })
}

// ─── Travel advice (sources/travel-advisories.ts and uk-travel-advice.ts in the scraper) ──────

export interface TravelLevel { country: string; level: number; since: string | null }
export interface TravelNotice { id: string; title: string; at: string | null; url: string | null; from: 'us' | 'uk' }

/** Every country's US level, as the scraper keeps it (osint:travel-us:<code> = "level|day") */
async function usLevels(): Promise<TravelLevel[]> {
  const keys: string[] = []
  let cursor = '0'
  do {
    const [next, found] = await redis.scan(cursor, 'MATCH', 'osint:travel-us:*', 'COUNT', 500)
    cursor = next
    keys.push(...found)
  } while (cursor !== '0' && keys.length < 1_000)
  if (keys.length === 0) return []
  const values = await redis.mget(...keys)
  return keys.map((k, i) => {
    const [level, day] = String(values[i] ?? '').split('|')
    return { country: k.slice('osint:travel-us:'.length).toUpperCase(), level: Number(level), since: day || null }
  }).filter(l => /^[A-Z]{2}$/.test(l.country) && l.level >= 1 && l.level <= 4)
}

async function travelNotices(country: string): Promise<TravelNotice[]> {
  const result = await longQuery(20, trx => trx.raw(
    `SELECT id::text AS id, title, created_at, original_urls[1] AS url, tags
       FROM signals
      WHERE country_code = ?
        AND created_at > NOW() - interval '365 days'
        AND (tags @> ARRAY['travel-advisory']::text[] OR tags @> ARRAY['travel-advice']::text[])
      ORDER BY created_at DESC
      LIMIT 10`, [country]) as unknown as Promise<unknown>)
  return rowsOf(result).map(r => {
    const tags = Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : []
    return { id: String(r.id), title: String(r.title ?? ''), at: iso(r.created_at), url: r.url ? String(r.url) : null, from: tags.includes('uk-fcdo') ? 'uk' : 'us' }
  })
}

// ─── First reporters ─────────────────────────────────────────────────────────────

export interface FirstReporter { site: string; name: string | null; country: string | null; kind: string | null; firsts: number }

async function firstReporters(days: number, minOutlets: number): Promise<{ stories: number; outlets: FirstReporter[] }> {
  const result = await longQuery(30, trx => trx.raw(
    `WITH s AS (
       SELECT story_id, created_at, ${SITE_OF} AS site
         FROM signals
        WHERE story_id IS NOT NULL
          AND created_at > NOW() - make_interval(days => ?)
          AND status IN ('verified', 'pending')
          AND original_urls[1] IS NOT NULL
     ), sized AS (
       SELECT story_id FROM s GROUP BY story_id HAVING count(DISTINCT site) >= ?
     ), firsts AS (
       SELECT DISTINCT ON (s.story_id) s.story_id, s.site
         FROM s JOIN sized ON sized.story_id = s.story_id
        ORDER BY s.story_id, s.created_at
     )
     SELECT site, count(*) AS firsts, sum(count(*)) OVER () AS stories
       FROM firsts
      WHERE site <> ''
      GROUP BY site
      ORDER BY firsts DESC
      LIMIT 60`, [days, minOutlets]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  const outlets = rows.map(r => {
    const e = outletOf(String(r.site))
    return { site: String(r.site), name: e?.name ?? null, country: e?.country ?? null, kind: e?.kind ?? null, firsts: Number(r.firsts) || 0 }
  })
  return { stories: Number(rows[0]?.stories ?? 0), outlets }
}

// ─── Verification speed ─────────────────────────────────────────────────────────────

export interface SpeedStory { storyId: string; reportId: string; title: string; firstAt: string | null; verifiedAt: string | null; minutes: number }

async function verificationSpeed(hours: number): Promise<SpeedStory[]> {
  // a story's first report may be a day or two older than the window it turned verified in
  const result = await longQuery(30, trx => trx.raw(
    `WITH st AS (
       SELECT story_id,
              min(created_at) AS first_at,
              min(verified_at) FILTER (WHERE status = 'verified') AS verified_at,
              (array_agg(id::text ORDER BY created_at))[1] AS report_id,
              (array_agg(title ORDER BY created_at))[1] AS title
         FROM signals
        WHERE story_id IS NOT NULL
          AND created_at > NOW() - make_interval(hours => ?)
          AND status IN ('verified', 'pending')
          AND ${NEWS_ONLY}
        GROUP BY story_id
     )
     SELECT story_id::text AS story_id, report_id, title, first_at, verified_at,
            GREATEST(0, EXTRACT(EPOCH FROM (verified_at - first_at)) / 60) AS minutes
       FROM st
      WHERE verified_at > NOW() - make_interval(hours => ?)
      ORDER BY minutes
      LIMIT 20000`, [hours + 48, hours]) as unknown as Promise<unknown>)
  return rowsOf(result).map(r => ({
    storyId: String(r.story_id), reportId: String(r.report_id), title: String(r.title ?? ''), firstAt: iso(r.first_at), verifiedAt: iso(r.verified_at),
    minutes: Math.round(Number(r.minutes) || 0),
  }))
}

// ─── Topics ─────────────────────────────────────────────────────────────

export interface TopicCount { topic: string; reports: number; verified: number; before: number }

async function topicCounts(hours: number, country: string | null = null, countries: string[] | null = null): Promise<TopicCount[]> {
  const result = await longQuery(20, trx => trx.raw(
    `SELECT category::text AS topic,
            count(*) FILTER (WHERE created_at > NOW() - make_interval(hours => ?)) AS reports,
            count(*) FILTER (WHERE created_at > NOW() - make_interval(hours => ?) AND status = 'verified') AS verified,
            count(*) FILTER (WHERE created_at <= NOW() - make_interval(hours => ?)) AS before
       FROM signals
      WHERE created_at > NOW() - make_interval(hours => ?)
        AND status IN ('verified', 'pending')
        AND ${NEWS_ONLY}
        ${country ? 'AND country_code = ?' : countries ? 'AND country_code = ANY(?::bpchar[])' : ''}
      GROUP BY 1
      ORDER BY reports DESC`, [hours, hours, hours, hours * 2, ...(country ? [country] : countries ? [countries] : [])]) as unknown as Promise<unknown>)
  return rowsOf(result).map(r => ({ topic: String(r.topic), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0, before: Number(r.before) || 0 }))
}

// ─── One outlet's reports ─────────────────────────────────────────────────────────────

export interface OutletReport { id: string; title: string; status: string; severity: string | null; topic: string | null; country: string | null; at: string | null; storyId: string | null }

/** "https://www.bbc.co.uk/news/x" → "bbc.co.uk"; null when it isn't a website */
export function siteFrom(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0]!.replace(/^www\./, '').replace(/:\d+$/, '')
  return /^(?=.{3,120}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

async function outletReports(site: string, days: number): Promise<{ total: number; verified: number; topics: Array<{ topic: string; reports: number }>; places: Array<{ country: string; reports: number }>; reports: OutletReport[] }> {
  // one scan of the outlet's reports (mine is read four times, so Postgres keeps it): the newest 20, the totals, its
  // topics and the countries its reports are placed in
  const result = await longQuery(20, trx => trx.raw(
    `WITH mine AS (
       SELECT id::text AS id, title, status::text AS status, severity::text AS severity, category::text AS topic,
              country_code, created_at, story_id::text AS story_id
         FROM signals
        WHERE created_at > NOW() - make_interval(days => ?)
          AND status IN ('verified', 'pending')
          AND original_urls[1] IS NOT NULL
          AND (${SITE_OF} = ? OR ${SITE_OF} LIKE ?)
     )
     SELECT *, count(*) OVER () AS total, count(*) FILTER (WHERE status = 'verified') OVER () AS verified_total,
            (SELECT json_agg(json_build_object('topic', t.topic, 'reports', t.n) ORDER BY t.n DESC)
               FROM (SELECT topic, count(*) AS n FROM mine GROUP BY topic ORDER BY n DESC LIMIT 8) t) AS topics,
            (SELECT json_agg(json_build_object('country', c.country_code, 'reports', c.n) ORDER BY c.n DESC)
               FROM (SELECT country_code, count(*) AS n FROM mine WHERE country_code IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 6) c) AS places
       FROM mine ORDER BY created_at DESC LIMIT 20`, [days, site, `%.${site}`]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : typeof v === 'string' ? JSON.parse(v) as T[] : [])
  return {
    total: Number(rows[0]?.total ?? 0),
    verified: Number(rows[0]?.verified_total ?? 0),
    topics: list<{ topic: string; reports: number }>(rows[0]?.topics).map(t => ({ topic: String(t.topic), reports: Number(t.reports) || 0 })),
    places: list<{ country: string; reports: number }>(rows[0]?.places).filter(c => /^[A-Z]{2}$/.test(String(c.country))).map(c => ({ country: String(c.country), reports: Number(c.reports) || 0 })),
    reports: rows.map(r => ({
      id: String(r.id), title: String(r.title ?? ''), status: String(r.status), severity: r.severity ? String(r.severity) : null, topic: r.topic ? String(r.topic) : null,
      country: typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null, at: iso(r.created_at), storyId: r.story_id ? String(r.story_id) : null,
    })),
  }
}

// ─── The countries whose news rose or fell the most ─────────────────────────────

export interface CountryChange { country: string; now: number; before: number }

async function countryChanges(days: number): Promise<CountryChange[]> {
  const result = await longQuery(60, trx => trx.raw(
    `SELECT country_code AS country,
            count(*) FILTER (WHERE created_at > NOW() - make_interval(days => ?)) AS now,
            count(*) FILTER (WHERE created_at <= NOW() - make_interval(days => ?)) AS before
       FROM signals
      WHERE created_at > NOW() - make_interval(days => ?)
        AND status IN ('verified', 'pending')
        AND country_code IS NOT NULL
        AND ${NEWS_ONLY}
      GROUP BY 1`, [days, days, days * 2]) as unknown as Promise<unknown>)
  return rowsOf(result)
    .filter(r => typeof r.country === 'string' && /^[A-Z]{2}$/.test(r.country))
    .map(r => ({ country: String(r.country), now: Number(r.now) || 0, before: Number(r.before) || 0 }))
}

// ─── A data feed's reports (the scraper's government and science feeds, by their tags) ─────────────

/** The feeds GET /feed-reports reads: each one's reports carry all of one of its tag sets */
export const FEEDS: Record<string, { label: string; tags: string[][] }> = {
  // IAEA, ReliefWeb and Copernicus EMS had no report in 30 days live (Nov 10, 2026, 8 PM) and Safecast none since
  // Oct 18: left out until their readers work again
  sanctions: { label: 'US Treasury (OFAC) and EU sanctions actions', tags: [['sanctions', 'ofac'], ['sanctions', 'eu']] },
  'us-weather': { label: 'US National Weather Service alerts', tags: [['nws']] },
  carriers: { label: 'US Navy carrier strike groups', tags: [['csg']] },
}

export interface FeedReport { id: string; title: string; summary: string | null; severity: string | null; country: string | null; place: string | null; at: string | null; url: string | null; tags: string[] }

async function feedReports(feed: string, days: number): Promise<{ total: number; reports: FeedReport[] }> {
  const sets = FEEDS[feed]!.tags
  const result = await longQuery(20, trx => trx.raw(
    `WITH mine AS (
       SELECT id::text AS id, title, summary, severity::text AS severity, country_code, location_name, created_at, original_urls[1] AS url, tags
         FROM signals
        WHERE created_at > NOW() - make_interval(days => ?)
          AND (${sets.map(() => 'tags @> ?::text[]').join(' OR ')})
     )
     SELECT *, count(*) OVER () AS total FROM mine ORDER BY created_at DESC LIMIT 50`, [days, ...sets]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  return {
    total: Number(rows[0]?.total ?? 0),
    reports: rows.map(r => ({
      id: String(r.id), title: String(r.title ?? ''), summary: r.summary ? String(r.summary).slice(0, 400) : null, severity: r.severity ? String(r.severity) : null,
      country: typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null,
      place: r.location_name ? String(r.location_name) : null, at: iso(r.created_at), url: r.url ? String(r.url) : null,
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
    })),
  }
}

// ─── News watches: one kind of news, by country (cyber attacks, elections, disasters) ─────────────

/** What each watch reads: a topic the reader gave the reports, or fragments of their headlines */
export const WATCHES: Record<string, { label: string; topic?: string; like?: string[]; not?: string[] }> = {
  cyber: {
    label: 'cyber attacks',
    // "hack" alone is Hackney and hackathons; "Cyber" alone is a ministry's name
    like: ['hacker', 'hacked', 'hacking', 'cyberattack', 'cyber attack', 'cyber-attack', 'cyber-attaque', 'cyberattaque', 'ransomware', 'data breach',
      'ddos', 'malware', 'phishing', 'spyware', 'ciberataque', 'ataque cibern', 'ataque hacker', 'piratage', 'cyberangriff', 'hackerangriff',
      // both cases of a Russian word's first letter: the database's locale may not fold Cyrillic
      'кибератак', 'Кибератак', 'хакер', 'Хакер', 'هجوم سيبراني', 'هجوم إلكتروني', 'قراصنة'],
    // a killing is not a cyber attack ("Mother, son hacked to death")
    not: ['hacked to death', 'hacked to pieces', 'hacking cough'],
  },
  elections: { label: 'elections', topic: 'elections' },
  disasters: { label: 'disasters', topic: 'disaster' },
}

export interface WatchCountry { country: string; reports: number; verified: number; latest: { id: string; title: string; at: string | null } | null }
export interface WatchReport { id: string; title: string; status: string; country: string | null; at: string | null }

async function newsWatch(watch: string, days: number): Promise<{ total: number; countries: WatchCountry[]; newest: WatchReport[] }> {
  const w = WATCHES[watch]!
  const filter = w.topic ? 'category::text = ?' : 'title ILIKE ANY (?::text[])'
  const binding = w.topic ?? (w.like ?? []).map(f => `%${f}%`)
  const notLike = (w.not ?? []).map(f => `%${f}%`)
  const result = await longQuery(60, trx => trx.raw(
    `SELECT id::text AS id, title, status::text AS status, country_code, created_at
       FROM signals
      WHERE created_at > NOW() - make_interval(days => ?)
        AND status IN ('verified', 'pending')
        AND ${NEWS_ONLY}
        AND ${filter}
        ${notLike.length ? 'AND NOT (title ILIKE ANY (?::text[]))' : ''}
      ORDER BY created_at DESC
      LIMIT 20000`, [days, binding, ...(notLike.length ? [notLike] : [])]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  const byCountry = new Map<string, WatchCountry>()
  for (const r of rows) {
    const code = typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null
    if (!code) continue
    const c = byCountry.get(code) ?? { country: code, reports: 0, verified: 0, latest: null }
    c.reports++
    if (r.status === 'verified') {
      c.verified++
      // newest first: the first verified one met is the newest
      c.latest ??= { id: String(r.id), title: String(r.title ?? ''), at: iso(r.created_at) }
    }
    byCountry.set(code, c)
  }
  return {
    total: rows.length,
    countries: [...byCountry.values()].sort((a, b) => b.reports - a.reports || a.country.localeCompare(b.country)).slice(0, 40),
    newest: rows.slice(0, 30).map(r => ({
      id: String(r.id), title: String(r.title ?? ''), status: String(r.status),
      country: typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null, at: iso(r.created_at),
    })),
  }
}

// ─── The busiest outlets ─────────────────────────────────────────────────────────────

export interface BusyOutlet { site: string; name: string | null; country: string | null; kind: string | null; stateMedia: boolean; reports: number; verified: number }

async function busiestOutlets(hours: number): Promise<{ reports: number; outlets: BusyOutlet[] }> {
  const result = await longQuery(30, trx => trx.raw(
    `SELECT ${SITE_OF} AS site, count(*) AS reports, count(*) FILTER (WHERE status = 'verified') AS verified, sum(count(*)) OVER () AS total
       FROM signals
      WHERE created_at > NOW() - make_interval(hours => ?)
        AND status IN ('verified', 'pending')
        AND ${NEWS_ONLY}
        AND original_urls[1] IS NOT NULL
      GROUP BY 1
      ORDER BY reports DESC
      LIMIT 80`, [hours]) as unknown as Promise<unknown>)
  const rows = rowsOf(result).filter(r => r.site)
  return {
    reports: Number(rows[0]?.total ?? 0),
    outlets: rows.map(r => {
      const e = outletOf(String(r.site))
      return { site: String(r.site), name: e?.name ?? null, country: e?.country ?? null, kind: e?.kind ?? null, stateMedia: Boolean(e?.state), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0 }
    }),
  }
}

// ─── The news hour by hour, and the serious reports by country ─────────────────────────────

export interface HourCount { hour: string; reports: number; verified: number; serious: number }

async function newsByHour(hours: number): Promise<HourCount[]> {
  const result = await longQuery(30, trx => trx.raw(
    `SELECT date_trunc('hour', created_at) AS hour, count(*) AS reports,
            count(*) FILTER (WHERE status = 'verified') AS verified,
            count(*) FILTER (WHERE severity IN ('critical', 'high')) AS serious
       FROM signals
      WHERE created_at > NOW() - make_interval(hours => ?)
        AND status IN ('verified', 'pending')
        AND ${NEWS_ONLY}
      GROUP BY 1
      ORDER BY 1`, [hours]) as unknown as Promise<unknown>)
  return rowsOf(result).map(r => ({ hour: iso(r.hour) ?? '', reports: Number(r.reports) || 0, verified: Number(r.verified) || 0, serious: Number(r.serious) || 0 }))
}

export interface SeriousPlace { country: string; serious: number; critical: number; verified: number; latest: { id: string; title: string; severity: string; at: string | null } | null }

async function seriousPlaces(hours: number): Promise<SeriousPlace[]> {
  const result = await longQuery(30, trx => trx.raw(
    `SELECT id::text AS id, title, severity::text AS severity, status::text AS status, country_code, created_at
       FROM signals
      WHERE created_at > NOW() - make_interval(hours => ?)
        AND status IN ('verified', 'pending')
        AND severity IN ('critical', 'high')
        AND country_code IS NOT NULL
        AND ${NEWS_ONLY}
      ORDER BY created_at DESC
      LIMIT 20000`, [hours]) as unknown as Promise<unknown>)
  const by = new Map<string, SeriousPlace>()
  for (const r of rowsOf(result)) {
    const code = typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null
    if (!code) continue
    const p = by.get(code) ?? { country: code, serious: 0, critical: 0, verified: 0, latest: null }
    p.serious++
    if (r.severity === 'critical') p.critical++
    if (r.status === 'verified') {
      p.verified++
      p.latest ??= { id: String(r.id), title: String(r.title ?? ''), severity: String(r.severity), at: iso(r.created_at) }
    }
    by.set(code, p)
  }
  return [...by.values()].sort((a, b) => b.serious - a.serious || b.critical - a.critical).slice(0, 50)
}

// ─── Round 6 (Nov 10, 2026, night): the news day by day, one topic's countries, who reports on a country ─────────────

export interface DayCount { day: string; reports: number; verified: number; serious: number }

/** The news reports of the last `days` finished UTC days and today so far, day by day; one topic's when given */
async function newsByDay(days: number, topic: string | null): Promise<DayCount[]> {
  const result = await longQuery(60, trx => trx.raw(
    `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*) AS reports,
            count(*) FILTER (WHERE status = 'verified') AS verified,
            count(*) FILTER (WHERE severity IN ('critical', 'high')) AS serious
       FROM signals
      WHERE created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') - make_interval(days => ?)) AT TIME ZONE 'UTC'
        AND status IN ('verified', 'pending')
        AND ${NEWS_ONLY}
        ${topic ? 'AND category::text = ?' : ''}
      GROUP BY 1
      ORDER BY 1`, [days, ...(topic ? [topic] : [])]) as unknown as Promise<unknown>)
  return rowsOf(result)
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(String(r.day)))
    .map(r => ({ day: String(r.day), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0, serious: Number(r.serious) || 0 }))
}

export interface TopicCountry { country: string; reports: number; verified: number }

/** One topic's news reports of the last days by the country they are placed in, the most first */
async function topicCountries(topic: string, days: number): Promise<{ total: number; countries: TopicCountry[] }> {
  const result = await longQuery(60, trx => trx.raw(
    `SELECT country_code AS country, count(*) AS reports, count(*) FILTER (WHERE status = 'verified') AS verified,
            sum(count(*)) OVER () AS total
       FROM signals
      WHERE created_at > NOW() - make_interval(days => ?)
        AND category::text = ?
        AND status IN ('verified', 'pending')
        AND country_code IS NOT NULL
        AND ${NEWS_ONLY}
      GROUP BY 1
      ORDER BY reports DESC
      LIMIT 40`, [days, topic]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  return {
    total: Number(rows[0]?.total ?? 0) || 0,
    countries: rows
      .filter(r => typeof r.country === 'string' && /^[A-Z]{2}$/.test(r.country))
      .map(r => ({ country: String(r.country), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0 })),
  }
}

export interface CountryCoverage {
  total: number; verified: number
  outlets: Array<{ site: string; reports: number; verified: number }>
  languages: Array<{ language: string; reports: number }>
}

/** Who reports on a country: its news reports of the last days by outlet (website) and by language, one scan */
async function countryCoverage(country: string, days: number): Promise<CountryCoverage> {
  const result = await longQuery(30, trx => trx.raw(
    `WITH mine AS (
       SELECT ${SITE_OF} AS site, status::text AS status, language::text AS language
         FROM signals
        WHERE created_at > NOW() - make_interval(days => ?)
          AND country_code = ?
          AND status IN ('verified', 'pending')
          AND original_urls[1] IS NOT NULL
          AND ${NEWS_ONLY}
     )
     (SELECT 'site' AS kind, site AS key, count(*) AS reports, count(*) FILTER (WHERE status = 'verified') AS verified
        FROM mine WHERE site <> '' GROUP BY site ORDER BY reports DESC LIMIT 40)
     UNION ALL
     (SELECT 'language', language, count(*), count(*) FILTER (WHERE status = 'verified')
        FROM mine WHERE language IS NOT NULL GROUP BY language ORDER BY 3 DESC LIMIT 20)
     UNION ALL
     (SELECT 'total', '', count(*), count(*) FILTER (WHERE status = 'verified') FROM mine)`, [days, country]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  const total = rows.find(r => r.kind === 'total')
  return {
    total: Number(total?.reports ?? 0) || 0,
    verified: Number(total?.verified ?? 0) || 0,
    outlets: rows.filter(r => r.kind === 'site' && typeof r.key === 'string' && r.key.includes('.'))
      .map(r => ({ site: String(r.key), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0 })),
    languages: rows.filter(r => r.kind === 'language' && typeof r.key === 'string' && /^[a-z]{2}$/.test(r.key.trim()))
      .map(r => ({ language: String(r.key).trim(), reports: Number(r.reports) || 0 })),
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────

const SWR = (fresh: number) => ({ freshSeconds: fresh, staleSeconds: 6 * 3_600, lockSeconds: 60 })
const OPEN = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }

export const registerPublicInsightRoutes: FastifyPluginAsync = async (app) => {
  app.get('/chokepoints', {
    schema: { tags: ['public'], summary: 'The shipping chokepoints named in the news, the most first (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const days = boundedInt((req.query as Record<string, unknown>)?.days, 7, 1, 14)
    try {
      // a week of headlines takes about 25 seconds: kept half an hour, served up to a day old while remade
      const chokepoints = await staleWhileRevalidate(`public:chokepoints:v1:${days}`, { freshSeconds: 1_800, staleSeconds: 86_400, lockSeconds: 120 }, () => chokepointNews(days))
      return reply.send({ success: true, data: { days, chokepoints } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The chokepoints could not be counted just now; try again in a minute')
    }
  })

  app.get('/vulnerabilities', {
    schema: { tags: ['public'], summary: 'CISA\'s newest Known Exploited Vulnerabilities, as WorldPulse read them (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const days = boundedInt((req.query as Record<string, unknown>)?.days, 30, 1, 90)
    try {
      const list = await staleWhileRevalidate(`public:vulnerabilities:v1:${days}`, SWR(1_800), () => vulnerabilities(days))
      return reply.send({ success: true, data: { days, count: list.length, vulnerabilities: list } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The vulnerabilities could not be read just now; try again in a minute')
    }
  })

  app.get('/travel-advice', {
    schema: { tags: ['public'], summary: 'The US State Department\'s travel levels, and a country\'s US and UK travel notices (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const given = String((req.query as Record<string, unknown>)?.country ?? '').toUpperCase()
    const country = /^[A-Z]{2}$/.test(given) ? (given === 'UK' ? 'GB' : given) : null
    try {
      const levels = await staleWhileRevalidate('public:travel-levels:v1', SWR(1_800), () => usLevels())
      if (!country) return reply.send({ success: true, data: { country: null, levels } })
      const notices = await staleWhileRevalidate(`public:travel-notices:v1:${country}`, SWR(1_800), () => travelNotices(country))
      return reply.send({ success: true, data: { country, us: levels.find(l => l.country === country) ?? null, notices } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The travel advice could not be read just now; try again in a minute')
    }
  })

  app.get('/first-reporters', {
    schema: { tags: ['public'], summary: 'The outlets that most often reported a story first (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const days = boundedInt(q.days, 7, 1, 14)
    const minOutlets = boundedInt(q.min_outlets, 5, 2, 50)
    try {
      const data = await staleWhileRevalidate(`public:first-reporters:v1:${days}:${minOutlets}`, SWR(1_800), () => firstReporters(days, minOutlets))
      return reply.send({ success: true, data: { days, minOutlets, ...data } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The first reporters could not be counted just now; try again in a minute')
    }
  })

  app.get('/verification-speed', {
    schema: { tags: ['public'], summary: 'How long the last hours\' verified stories took to find a second outlet (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const hours = boundedInt((req.query as Record<string, unknown>)?.hours, 24, 1, 72)
    try {
      const stories = await staleWhileRevalidate(`public:verification-speed:v1:${hours}`, SWR(900), () => verificationSpeed(hours))
      const minutes = stories.map(s => s.minutes)
      const median = minutes.length ? minutes[Math.floor((minutes.length - 1) / 2)]! : null
      const within = (m: number) => minutes.filter(x => x <= m).length
      return reply.send({
        success: true,
        data: {
          hours, verified: stories.length, medianMinutes: median, withinHour: within(60), withinDay: within(1_440),
          fastest: stories.slice(0, 20), slowest: stories.slice(-10).reverse(),
        },
      })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The verification times could not be counted just now; try again in a minute')
    }
  })

  app.get('/topics', {
    schema: { tags: ['public'], summary: 'The last hours\' news reports by topic, against the hours before, the world\'s or one country\'s (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const hours = boundedInt(q.hours, 24, 1, 72)
    const given = String(q.country ?? '').toUpperCase()
    const country = /^[A-Z]{2}$/.test(given) ? (given === 'UK' ? 'GB' : given) : null
    // a region's (Nov 10, 2026, round 6: region_topics): its countries as lib/regions.ts gives them; a country wins
    const named = q.region === undefined || q.region === '' ? null : String(q.region).trim().toLowerCase()
    if (named !== null && !(REGION_IDS as readonly string[]).includes(named)) return sendError(reply, 400, 'VALIDATION_ERROR', `region must be one of ${REGION_IDS.join(', ')}`)
    const region = country ? null : (named as RegionId | null)
    try {
      const topics = await staleWhileRevalidate(`public:topics:v1:${hours}:${country ?? (region ? `region:${region}` : 'all')}`, SWR(600), () => topicCounts(hours, country, region ? regionCountries(region) : null))
      return reply.send({ success: true, data: { hours, country, ...(region ? { region } : {}), topics } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The topics could not be counted just now; try again in a minute')
    }
  })

  app.get('/outlet-reports', {
    schema: { tags: ['public'], summary: 'One outlet\'s newest reports, by its website (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const site = siteFrom(String(q.site ?? ''))
    if (!site) return sendError(reply, 400, 'VALIDATION_ERROR', 'site must be a website, e.g. bbc.co.uk')
    const days = boundedInt(q.days, 7, 1, 14)
    try {
      const data = await staleWhileRevalidate(`public:outlet-reports:v2:${site}:${days}`, SWR(600), () => outletReports(site, days))
      return reply.send({ success: true, data: { site, days, ...data } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The outlet\'s reports could not be read just now; try again in a minute')
    }
  })

  app.get('/feed-reports', {
    schema: { tags: ['public'], summary: 'A government feed\'s newest reports: sanctions, us-weather, carriers (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const feed = String(q.feed ?? '')
    if (!Object.hasOwn(FEEDS, feed)) return sendError(reply, 400, 'VALIDATION_ERROR', `feed must be one of ${Object.keys(FEEDS).join(', ')}`)
    const days = boundedInt(q.days, 7, 1, 30)
    try {
      const data = await staleWhileRevalidate(`public:feed-reports:v1:${feed}:${days}`, SWR(600), () => feedReports(feed, days))
      return reply.send({ success: true, data: { feed, label: FEEDS[feed]!.label, days, ...data } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The feed could not be read just now; try again in a minute')
    }
  })

  app.get('/news-watch', {
    schema: { tags: ['public'], summary: 'One kind of news by country: cyber attacks, elections or disasters (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const watch = String(q.watch ?? '')
    if (!Object.hasOwn(WATCHES, watch)) return sendError(reply, 400, 'VALIDATION_ERROR', `watch must be one of ${Object.keys(WATCHES).join(', ')}`)
    const days = boundedInt(q.days, 7, 1, 14)
    try {
      const data = await staleWhileRevalidate(`public:news-watch:v1:${watch}:${days}`, { freshSeconds: 1_200, staleSeconds: 86_400, lockSeconds: 120 }, () => newsWatch(watch, days))
      return reply.send({ success: true, data: { watch, label: WATCHES[watch]!.label, days, ...data } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The news could not be counted just now; try again in a minute')
    }
  })

  app.get('/busiest-outlets', {
    schema: { tags: ['public'], summary: 'The outlets WorldPulse read the most reports from in the last hours (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const hours = boundedInt((req.query as Record<string, unknown>)?.hours, 24, 1, 72)
    try {
      const data = await staleWhileRevalidate(`public:busiest-outlets:v1:${hours}`, SWR(900), () => busiestOutlets(hours))
      return reply.send({ success: true, data: { hours, ...data } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The outlets could not be counted just now; try again in a minute')
    }
  })

  app.get('/news-by-hour', {
    schema: { tags: ['public'], summary: 'The last hours\' news reports hour by hour: reports, verified, serious (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const hours = boundedInt((req.query as Record<string, unknown>)?.hours, 24, 1, 72)
    try {
      const byHour = await staleWhileRevalidate(`public:news-by-hour:v1:${hours}`, SWR(300), () => newsByHour(hours))
      return reply.send({ success: true, data: { hours, byHour } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The hours could not be counted just now; try again in a minute')
    }
  })

  app.get('/serious-places', {
    schema: { tags: ['public'], summary: 'The countries with the most critical and high-severity news reports in the last hours (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const hours = boundedInt((req.query as Record<string, unknown>)?.hours, 24, 1, 72)
    try {
      const places = await staleWhileRevalidate(`public:serious-places:v1:${hours}`, SWR(600), () => seriousPlaces(hours))
      return reply.send({ success: true, data: { hours, places } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The places could not be counted just now; try again in a minute')
    }
  })

  app.get('/country-changes', {
    schema: { tags: ['public'], summary: 'Each country\'s news reports of the last days against the days before (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const days = boundedInt((req.query as Record<string, unknown>)?.days, 7, 1, 14)
    try {
      const countries = await staleWhileRevalidate(`public:country-changes:v1:${days}`, { freshSeconds: 1_800, staleSeconds: 86_400, lockSeconds: 120 }, () => countryChanges(days))
      return reply.send({ success: true, data: { days, countries } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The countries could not be counted just now; try again in a minute')
    }
  })

  app.get('/news-by-day', {
    schema: { tags: ['public'], summary: 'The news reports of the last days day by day (UTC), the world\'s or one topic\'s: reports, verified, serious (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const days = boundedInt(q.days, 14, 1, 30)
    const topic = q.topic === undefined || q.topic === '' ? null : String(q.topic).trim().toLowerCase()
    if (topic !== null && !isReaderTopic(topic)) return sendError(reply, 400, 'VALIDATION_ERROR', `topic must be one of ${READER_TOPICS.join(', ')}`)
    try {
      const byDay = await staleWhileRevalidate(`public:news-by-day:v1:${days}:${topic ?? 'all'}`, { freshSeconds: 1_800, staleSeconds: 86_400, lockSeconds: 120 }, () => newsByDay(days, topic))
      return reply.send({ success: true, data: { days, topic, byDay } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The days could not be counted just now; try again in a minute')
    }
  })

  app.get('/topic-countries', {
    schema: { tags: ['public'], summary: 'One topic\'s news reports of the last days by the country they are placed in (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const topic = String(q.topic ?? '').trim().toLowerCase()
    if (!isReaderTopic(topic)) return sendError(reply, 400, 'VALIDATION_ERROR', `topic must be one of ${READER_TOPICS.join(', ')}`)
    const days = boundedInt(q.days, 1, 1, 7)
    try {
      const data = await staleWhileRevalidate(`public:topic-countries:v1:${topic}:${days}`, { freshSeconds: 1_800, staleSeconds: 86_400, lockSeconds: 120 }, () => topicCountries(topic, days))
      return reply.send({ success: true, data: { topic, days, ...data } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The countries could not be counted just now; try again in a minute')
    }
  })

  app.get('/country-coverage', {
    schema: { tags: ['public'], summary: 'Who reports on one country: its news reports of the last days by outlet and by language (public, no auth required)' }, ...OPEN,
  }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    const q = (req.query ?? {}) as Record<string, unknown>
    const given = String(q.country ?? '').trim().toUpperCase()
    const country = given === 'UK' ? 'GB' : given
    if (!/^[A-Z]{2}$/.test(country)) return sendError(reply, 400, 'VALIDATION_ERROR', 'country must be a two-letter country code such as SD')
    const days = boundedInt(q.days, 7, 1, 14)
    try {
      const data = await staleWhileRevalidate(`public:country-coverage:v1:${country}:${days}`, SWR(1_800), () => countryCoverage(country, days))
      return reply.send({ success: true, data: { country, days, ...data } })
    } catch {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'The outlets could not be counted just now; try again in a minute')
    }
  })
}
