/**
 * US travel advisories (Nov 5, 2026; Devon: "Figure out how to add more feeds/signals").
 *
 * The State Department rates every country from Level 1 (exercise normal
 * precautions) to Level 4 (do not travel) and reissues an advisory when it
 * looks at a country again. A raised level is a government saying, on the
 * record, that a place has become more dangerous and why (armed conflict,
 * unrest, kidnapping, health); a lowered one, that it has calmed down.
 *
 * Feed: https://travel.state.gov/_res/rss/TAsTWs.xml (RSS, no key): every
 * country's current advisory, about 220 items ("Iran - Level 4: Do Not
 * Travel"), each dated by day and linking its page. A work of the US
 * government (public domain); every signal names the State Department and
 * links the advisory.
 *
 * Each country's level and date are kept (osint:travel-us:<code>, a year).
 * A signal when a level is raised or lowered, or when a Level 3 or 4
 * advisory is reissued; routine Level 1 and 2 reissues are only kept. The
 * first read keeps every country's level and signals only Level 3 and 4
 * advisories dated in the last 3 days, so a first start doesn't fill the
 * feed with old ones.
 *
 * Reliability: 0.95 (the US government's own rating). Category: security.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import type { SignalSeverity } from '@worldpulse/types'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'
import { iso3Centroid } from '../pipeline/country-centroids'
import { inferGeo, type NewsSource } from './news-rss'

const log = rootLogger.child({ module: 'travel-advisories-source' })

export const US_ADVISORIES_URL = 'https://travel.state.gov/_res/rss/TAsTWs.xml'
const SOURCE_ID = 'us-travel-advisories'
const RELIABILITY = 0.95
const KEEP_S = 400 * 86_400
const MAX_AGE_MS = 3 * 86_400_000
const MAX_PER_POLL = 15
const MAX_BYTES = 3_000_000
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io)'
const POLL_INTERVAL_MS = Number(process.env.TRAVEL_ADVISORIES_INTERVAL_MS) || 60 * 60_000 // hourly
const seenKey = (code: string) => `osint:travel-us:${code}`

/** One advisory as the feed gives it */
export interface Advisory {
  /** The State Department's code for the place, from its page's address ("irn"; "french-west-indies" on an older page) */
  code:    string
  country: string
  level:   1 | 2 | 3 | 4
  /** "Do Not Travel" */
  label:   string
  link:    string
  /** YYYY-MM-DD (the feed dates advisories by day) */
  day:     string
  /** The advisory's opening lines as plain text */
  text:    string
}

/** What was kept for a country: its level and the advisory's day */
export interface SeenAdvisory { level: number; day: string }

export type AdvisoryChange = 'raised' | 'lowered' | 'reissued' | 'new'

/**
 * The State Department's codes (ISO 3166-1 alpha-3, and X codes for places
 * the standard leaves out) → ISO alpha-2. The place-finder alone gets some
 * wrong: "Republic of Congo" reads as the DR Congo, and "Jordan", "Chad"
 * and "Georgia" are first names or a US state to it.
 */
const ISO2: Record<string, string> = {
  abw: 'AW', afg: 'AF', ago: 'AO', aia: 'AI', alb: 'AL', and: 'AD', are: 'AE', arg: 'AR', arm: 'AM', ata: 'AQ',
  atg: 'AG', aus: 'AU', aut: 'AT', aze: 'AZ', bdi: 'BI', bel: 'BE', ben: 'BJ', bes: 'BQ', bfa: 'BF', bgd: 'BD',
  bgr: 'BG', bhr: 'BH', bhs: 'BS', bih: 'BA', blm: 'BL', blr: 'BY', blz: 'BZ', bmu: 'BM', bol: 'BO', bra: 'BR',
  brb: 'BB', brn: 'BN', btn: 'BT', bwa: 'BW', caf: 'CF', can: 'CA', che: 'CH', chl: 'CL', chn: 'CN', civ: 'CI',
  cmr: 'CM', cod: 'CD', cog: 'CG', col: 'CO', com: 'KM', cpv: 'CV', cri: 'CR', cub: 'CU', cuw: 'CW', cym: 'KY',
  cyp: 'CY', cze: 'CZ', deu: 'DE', dji: 'DJ', dma: 'DM', dnk: 'DK', dom: 'DO', dza: 'DZ', ecu: 'EC', egy: 'EG',
  eri: 'ER', esp: 'ES', est: 'EE', eth: 'ET', fin: 'FI', fji: 'FJ', fra: 'FR', fsm: 'FM', gab: 'GA', gbr: 'GB',
  geo: 'GE', gha: 'GH', gin: 'GN', glp: 'GP', gmb: 'GM', gnb: 'GW', gnq: 'GQ', grc: 'GR', grd: 'GD', grl: 'GL',
  gtm: 'GT', guf: 'GF', guy: 'GY', hkg: 'HK', hnd: 'HN', hrv: 'HR', hti: 'HT', hun: 'HU', idn: 'ID', ind: 'IN',
  irl: 'IE', irn: 'IR', irq: 'IQ', isl: 'IS', isr: 'IL', ita: 'IT', jam: 'JM', jor: 'JO', jpn: 'JP', kaz: 'KZ',
  ken: 'KE', kgz: 'KG', khm: 'KH', kir: 'KI', kna: 'KN', kor: 'KR', kwt: 'KW', lao: 'LA', lbn: 'LB', lbr: 'LR',
  lby: 'LY', lca: 'LC', lie: 'LI', lka: 'LK', lso: 'LS', ltu: 'LT', lux: 'LU', lva: 'LV', mac: 'MO', maf: 'MF',
  mar: 'MA', mda: 'MD', mdg: 'MG', mdv: 'MV', mex: 'MX', mhl: 'MH', mkd: 'MK', mli: 'ML', mlt: 'MT', mmr: 'MM',
  mne: 'ME', mng: 'MN', moz: 'MZ', mrt: 'MR', msr: 'MS', mtq: 'MQ', mus: 'MU', mwi: 'MW', mys: 'MY', nam: 'NA',
  ncl: 'NC', ner: 'NE', nga: 'NG', nic: 'NI', nld: 'NL', nor: 'NO', npl: 'NP', nru: 'NR', nzl: 'NZ', omn: 'OM',
  pak: 'PK', pan: 'PA', per: 'PE', phl: 'PH', plw: 'PW', png: 'PG', pol: 'PL', prk: 'KP', prt: 'PT', pry: 'PY',
  pyf: 'PF', qat: 'QA', rou: 'RO', rus: 'RU', rwa: 'RW', sau: 'SA', sdn: 'SD', sen: 'SN', sgp: 'SG', slb: 'SB',
  sle: 'SL', slv: 'SV', som: 'SO', srb: 'RS', ssd: 'SS', stp: 'ST', sur: 'SR', svk: 'SK', svn: 'SI', swe: 'SE',
  swz: 'SZ', sxm: 'SX', syc: 'SC', syr: 'SY', tca: 'TC', tcd: 'TD', tgo: 'TG', tha: 'TH', tjk: 'TJ', tkm: 'TM',
  tls: 'TL', ton: 'TO', tto: 'TT', tun: 'TN', tur: 'TR', tuv: 'TV', twn: 'TW', tza: 'TZ', uga: 'UG', ukr: 'UA',
  ury: 'UY', uzb: 'UZ', vct: 'VC', ven: 'VE', vgb: 'VG', vnm: 'VN', vut: 'VU', wsm: 'WS', yem: 'YE', zaf: 'ZA',
  zmb: 'ZM', zwe: 'ZW',
  xgz: 'PS', xwb: 'PS', xks: 'XK', xqx: 'BQ',
  // an older page names the place in its address
  'french-west-indies': 'GP',
}

/** Older pages' names for places that also have a coded page: one place, one record */
const SAME_PLACE: Record<string, string> = { tonga: 'ton' }

/** Points for the places the centroid table has under another code, or not at all; Antarctica gets none */
const EXTRA_POINTS: Record<string, { lat: number; lon: number } | null> = {
  xgz: { lat: 31.42, lon: 34.37 }, xwb: { lat: 31.95, lon: 35.23 }, xks: { lat: 42.60, lon: 20.90 },
  xqx: { lat: 17.63, lon: -63.24 }, bes: { lat: 12.15, lon: -68.27 }, maf: { lat: 18.07, lon: -63.05 },
  blm: { lat: 17.90, lon: -62.83 }, grl: { lat: 64.18, lon: -51.72 }, 'french-west-indies': { lat: 16.25, lon: -61.58 },
  ata: null,
}

// The place-finder reads the country's name as a US source's headline would be read
const AS_SOURCE: NewsSource = {
  id: SOURCE_ID, name: 'U.S. Department of State', feedUrl: US_ADVISORIES_URL, category: 'security', biasLabel: 'state-media',
  reliability: RELIABILITY, countryCode: 'US', defaultLat: 38.89, defaultLng: -77.05, defaultLocation: 'Washington, DC',
  extraTags: [], language: 'en',
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }

/** "Fri, 23 Oct 2026" (or an ISO date) → "2026-10-23", else null */
export function advisoryDay(raw: string): string | null {
  const s = String(raw || '').trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(s)
  const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined
  return m && month ? `${m[3]}-${month}-${m[1]!.padStart(2, '0')}` : null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, '’').replace(/&ldquo;|&rdquo;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** The advisory's opening lines as plain text: about 500 characters, ending on a sentence */
export function advisoryText(html: string): string {
  const text = decodeEntities(String(html || '')
    .replace(/<\/?(?:p|li|ul|ol|h\d|div|br)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1')
    .replace(/\s*Read the entire Travel Advisory\.?/gi, '')
    .trim()
  if (text.length <= 500) return text
  const cut = text.slice(0, 500)
  const end = cut.lastIndexOf('. ')
  return end > 200 ? cut.slice(0, end + 1) : `${cut.slice(0, 497).trimEnd()}...`
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  if (!m) return ''
  return m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim()
}

/** Every advisory in the feed, one per place (the newest when a place is listed twice) */
export function parseAdvisories(xml: string): Advisory[] {
  const out = new Map<string, Advisory>()
  for (const block of String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const title = decodeEntities(tag(block, 'title')).replace(/\s+/g, ' ').trim()
    const t = /^(.+?)\s+-\s+Level\s+([1-4])\s*:\s*(.+)$/i.exec(title)
    const link = decodeEntities(tag(block, 'link')).trim()
    const c = /destination\.([a-z0-9-]+)\.html/i.exec(link) ?? /\/([a-z0-9-]+)-travel-advisory\.html/i.exec(link)
    const day = advisoryDay(tag(block, 'pubDate') || tag(block, 'dc:date'))
    if (!t || !c || !day || !/^https:\/\//.test(link)) continue
    const code = SAME_PLACE[c[1]!.toLowerCase()] ?? c[1]!.toLowerCase()
    const a: Advisory = {
      code,
      country: t[1]!.replace(/\s+Travel Advisory$/i, '').trim(),
      level:   Number(t[2]) as Advisory['level'],
      label:   t[3]!.trim(),
      link,
      day,
      text:    advisoryText(tag(block, 'description')),
    }
    const had = out.get(code)
    if (!had || a.day > had.day) out.set(code, a)
  }
  return [...out.values()]
}

/** Parse what was kept ("4|2026-10-23"), or null */
export function parseSeen(raw: string | null | undefined): SeenAdvisory | null {
  const m = /^([1-4])\|(\d{4}-\d{2}-\d{2})$/.exec(String(raw ?? ''))
  return m ? { level: Number(m[1]), day: m[2]! } : null
}

/**
 * Whether an advisory is news, given what was kept for its place: a level
 * raised or lowered; a Level 3 or 4 advisory reissued; or, the first time a
 * place is seen, a Level 3 or 4 advisory of the last 3 days. Otherwise null.
 */
export function advisoryChange(a: Advisory, seen: SeenAdvisory | null, now = Date.now()): AdvisoryChange | null {
  if (seen) {
    if (a.level > seen.level) return 'raised'
    if (a.level < seen.level) return 'lowered'
    return a.day > seen.day && a.level >= 3 ? 'reissued' : null
  }
  const at = Date.parse(`${a.day}T00:00:00Z`)
  return a.level >= 3 && Number.isFinite(at) && now - at <= MAX_AGE_MS ? 'new' : null
}

/** A raise to Level 4 is high; a raise to 3, or any Level 4 advisory, medium; the rest low */
export function advisorySeverity(a: Pick<Advisory, 'level'>, change: AdvisoryChange): SignalSeverity {
  if (change === 'raised' && a.level === 4) return 'high'
  if ((change === 'raised' && a.level === 3) || (change !== 'lowered' && a.level === 4)) return 'medium'
  return 'low'
}

/** The signal's headline and summary, with the State Department named */
export function advisorySignalText(a: Advisory, change: AdvisoryChange, seen: SeenAdvisory | null): { title: string; summary: string } {
  const was = seen && seen.level !== a.level ? ` (was Level ${seen.level})` : ''
  const title = (
    change === 'raised' ? `US raises its travel advisory for ${a.country} to Level ${a.level}: ${a.label}${was}`
    : change === 'lowered' ? `US lowers its travel advisory for ${a.country} to Level ${a.level}: ${a.label}${was}`
    : change === 'reissued' ? `US reissues its travel advisory for ${a.country}: Level ${a.level}, ${a.label}`
    : `US travel advisory for ${a.country}: Level ${a.level}, ${a.label}`
  ).slice(0, 500)
  const summary = [a.text, `Source: U.S. Department of State, travel advisory of ${a.day}.`].filter(Boolean).join('\n').slice(0, 2000)
  return { title, summary }
}

/** Where the advisory goes on the map: the capital when the place-finder agrees on the country, else its centre */
export function advisoryPlace(a: Pick<Advisory, 'code' | 'country'>): { lat: number | null; lng: number | null; name: string; countryCode: string | null } {
  const iso2 = ISO2[a.code] ?? null
  const g = inferGeo(a.country.replace(/^The\s+/i, ''), '', AS_SOURCE)
  if (g.countryCode && g.lat != null && g.lng != null && (!iso2 || g.countryCode === iso2)) {
    return { lat: g.lat, lng: g.lng, name: a.country, countryCode: g.countryCode }
  }
  const p = a.code in EXTRA_POINTS ? EXTRA_POINTS[a.code]! : iso3Centroid(a.code)
  return { lat: p?.lat ?? null, lng: p?.lon ?? null, name: a.country, countryCode: iso2 }
}

async function fetchFeed(): Promise<string> {
  return fetchWithResilience(SOURCE_ID, 'US travel advisories', US_ADVISORIES_URL, async () => {
    const res = await fetch(US_ADVISORIES_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      void res.body?.cancel().catch(() => {})
      throw Object.assign(new Error(`US travel advisories: HTTP ${res.status}`), { statusCode: res.status })
    }
    const body = await res.text()
    if (body.length > MAX_BYTES) throw new Error(`US travel advisories: over ${MAX_BYTES} bytes`)
    return body
  })
}

async function pollAdvisories(db: Knex, redis: Redis, producer?: Producer | null): Promise<void> {
  try {
    let xml: string
    try {
      xml = await fetchFeed()
    } catch (err) {
      if (err instanceof CircuitOpenError) return
      throw err
    }
    const list = parseAdvisories(xml)
    if (list.length === 0) {
      log.warn('US travel advisories: no advisories in the feed')
      return
    }

    const kept = await redis.mget(...list.map(a => seenKey(a.code)))
    let ingested = 0
    const keep = redis.multi()
    let keepCount = 0
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!
      const seen = parseSeen(kept[i])
      if (seen && seen.level === a.level && seen.day >= a.day) continue
      const change = advisoryChange(a, seen)
      if (change && ingested < MAX_PER_POLL) {
        const { title, summary } = advisorySignalText(a, change, seen)
        const place = advisoryPlace(a)
        const at = Date.parse(`${a.day}T00:00:00Z`)
        // The feed dates by day: an advisory of today or yesterday is dated when it is read
        const eventTime = Number.isFinite(at) && Date.now() - at > 2 * 86_400_000 ? new Date(at) : new Date()
        try {
          const signal = await insertAndCorrelate({
            title,
            summary,
            original_urls: [a.link],
            source_ids: [],
            category: 'security',
            severity: advisorySeverity(a, change),
            status: 'pending',
            reliability_score: RELIABILITY,
            location: place.lat != null && place.lng != null ? db.raw('ST_MakePoint(?, ?)', [place.lng, place.lat]) : null,
            location_name: place.name,
            country_code: place.countryCode,
            region: null,
            tags: ['osint', 'travel-advisory', 'us-state-department', `level-${a.level}`],
            language: 'en',
            event_time: eventTime,
            source_count: 1,
          }, { lat: place.lat, lng: place.lng, sourceId: SOURCE_ID })
          if (producer) {
            await producer.send({ topic: 'signals.verified', messages: [{ value: JSON.stringify(signal) }] })
          }
          ingested++
        } catch (err) {
          log.warn({ err, code: a.code }, 'Failed to ingest a US travel advisory')
          continue   // not kept, so it is tried again next poll
        }
      } else if (change) {
        continue     // over this poll's limit: tried again next poll
      }
      keep.set(seenKey(a.code), `${a.level}|${a.day}`, 'EX', KEEP_S)
      keepCount++
    }
    if (keepCount > 0) await keep.exec()
    if (ingested > 0) log.info({ ingested }, 'US travel advisories ingested')
  } catch (err) {
    log.error({ err }, 'US travel advisories poll failed')
  }
}

export function startTravelAdvisoriesPoller(db: Knex, redis: Redis, producer?: Producer | null): () => void {
  log.info({ intervalMs: POLL_INTERVAL_MS }, 'US travel advisories poller started')
  void pollAdvisories(db, redis, producer)
  const timer = setInterval(() => void pollAdvisories(db, redis, producer), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
