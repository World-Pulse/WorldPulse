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
 */
import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'
import { longQuery } from '../lib/long-query'
import { staleWhileRevalidate } from '../lib/swr-cache'
import { outletOf } from '../lib/outlets'

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

async function topicCounts(hours: number, country: string | null = null): Promise<TopicCount[]> {
  const result = await longQuery(20, trx => trx.raw(
    `SELECT category::text AS topic,
            count(*) FILTER (WHERE created_at > NOW() - make_interval(hours => ?)) AS reports,
            count(*) FILTER (WHERE created_at > NOW() - make_interval(hours => ?) AND status = 'verified') AS verified,
            count(*) FILTER (WHERE created_at <= NOW() - make_interval(hours => ?)) AS before
       FROM signals
      WHERE created_at > NOW() - make_interval(hours => ?)
        AND status IN ('verified', 'pending')
        AND ${NEWS_ONLY}
        ${country ? 'AND country_code = ?' : ''}
      GROUP BY 1
      ORDER BY reports DESC`, [hours, hours, hours, hours * 2, ...(country ? [country] : [])]) as unknown as Promise<unknown>)
  return rowsOf(result).map(r => ({ topic: String(r.topic), reports: Number(r.reports) || 0, verified: Number(r.verified) || 0, before: Number(r.before) || 0 }))
}

// ─── One outlet's reports ─────────────────────────────────────────────────────────────

export interface OutletReport { id: string; title: string; status: string; severity: string | null; topic: string | null; country: string | null; at: string | null; storyId: string | null }

/** "https://www.bbc.co.uk/news/x" → "bbc.co.uk"; null when it isn't a website */
export function siteFrom(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0]!.replace(/^www\./, '').replace(/:\d+$/, '')
  return /^(?=.{3,120}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

async function outletReports(site: string, days: number): Promise<{ total: number; reports: OutletReport[] }> {
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
     SELECT *, count(*) OVER () AS total FROM mine ORDER BY created_at DESC LIMIT 20`, [days, site, `%.${site}`]) as unknown as Promise<unknown>)
  const rows = rowsOf(result)
  return {
    total: Number(rows[0]?.total ?? 0),
    reports: rows.map(r => ({
      id: String(r.id), title: String(r.title ?? ''), status: String(r.status), severity: r.severity ? String(r.severity) : null, topic: r.topic ? String(r.topic) : null,
      country: typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null, at: iso(r.created_at), storyId: r.story_id ? String(r.story_id) : null,
    })),
  }
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
    try {
      const topics = await staleWhileRevalidate(`public:topics:v1:${hours}:${country ?? 'all'}`, SWR(600), () => topicCounts(hours, country))
      return reply.send({ success: true, data: { hours, country, topics } })
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
      const data = await staleWhileRevalidate(`public:outlet-reports:v1:${site}:${days}`, SWR(600), () => outletReports(site, days))
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
}
