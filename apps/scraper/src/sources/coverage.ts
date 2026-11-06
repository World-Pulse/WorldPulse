/**
 * The Dev Room's coverage map, kept current by itself (Devon, Nov 6, 2026: "Update the coverage map
 * automatically when these updates happen"). Each time the news poller starts (after every deploy) and
 * with every poll cycle, it writes how many of its feeds each country and territory has, in which
 * languages, and their outlets' names to news-rss:coverage. /ops-status.json carries that block with the
 * verified reports pinned in each country over the last 7 days (scripts/ops-status.sh, coverage_stats),
 * and HQ's hourly cloud sync turns it into the Dev Room's Coverage tab (the hq/coverage document).
 * Names and counts only: no feed addresses.
 */
import type Redis from 'ioredis'
import type { NewsSource } from './news-rss'

export const COVERAGE_KEY = 'news-rss:coverage'

/**
 * The 202 places the map counts, with the names the Dev Room uses: the UN's 193 members, its two observer
 * states (Palestine and the Holy See), and Kosovo, Taiwan, Hong Kong, Macau, Puerto Rico, Greenland and New
 * Caledonia. Any other place with feeds of its own (Bermuda, Guam...) is a territory: shown, not counted.
 */
export const COUNTED_PLACES: Readonly<Record<string, string>> = {
  AD: 'Andorra', AE: 'United Arab Emirates', AF: 'Afghanistan', AG: 'Antigua and Barbuda', AL: 'Albania',
  AM: 'Armenia', AO: 'Angola', AR: 'Argentina', AT: 'Austria', AU: 'Australia', AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina', BB: 'Barbados', BD: 'Bangladesh', BE: 'Belgium', BF: 'Burkina Faso', BG: 'Bulgaria',
  BH: 'Bahrain', BI: 'Burundi', BJ: 'Benin', BN: 'Brunei', BO: 'Bolivia', BR: 'Brazil', BS: 'Bahamas', BT: 'Bhutan',
  BW: 'Botswana', BY: 'Belarus', BZ: 'Belize', CA: 'Canada', CD: 'DR Congo', CF: 'Central African Republic',
  CG: 'Republic of the Congo', CH: 'Switzerland', CI: "Côte d'Ivoire", CL: 'Chile', CM: 'Cameroon', CN: 'China',
  CO: 'Colombia', CR: 'Costa Rica', CU: 'Cuba', CV: 'Cabo Verde', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany',
  DJ: 'Djibouti', DK: 'Denmark', DM: 'Dominica', DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia',
  EG: 'Egypt', ER: 'Eritrea', ES: 'Spain', ET: 'Ethiopia', FI: 'Finland', FJ: 'Fiji', FM: 'Micronesia', FR: 'France',
  GA: 'Gabon', GB: 'United Kingdom', GD: 'Grenada', GE: 'Georgia', GH: 'Ghana', GL: 'Greenland', GM: 'Gambia',
  GN: 'Guinea', GQ: 'Equatorial Guinea', GR: 'Greece', GT: 'Guatemala', GW: 'Guinea-Bissau', GY: 'Guyana',
  HK: 'Hong Kong', HN: 'Honduras', HR: 'Croatia', HT: 'Haiti', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland',
  IL: 'Israel', IN: 'India', IQ: 'Iraq', IR: 'Iran', IS: 'Iceland', IT: 'Italy', JM: 'Jamaica', JO: 'Jordan',
  JP: 'Japan', KE: 'Kenya', KG: 'Kyrgyzstan', KH: 'Cambodia', KI: 'Kiribati', KM: 'Comoros',
  KN: 'Saint Kitts and Nevis', KP: 'North Korea', KR: 'South Korea', KW: 'Kuwait', KZ: 'Kazakhstan', LA: 'Laos',
  LB: 'Lebanon', LC: 'Saint Lucia', LI: 'Liechtenstein', LK: 'Sri Lanka', LR: 'Liberia', LS: 'Lesotho',
  LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', LY: 'Libya', MA: 'Morocco', MC: 'Monaco', MD: 'Moldova',
  ME: 'Montenegro', MG: 'Madagascar', MH: 'Marshall Islands', MK: 'North Macedonia', ML: 'Mali', MM: 'Myanmar',
  MN: 'Mongolia', MO: 'Macau', MR: 'Mauritania', MT: 'Malta', MU: 'Mauritius', MV: 'Maldives', MW: 'Malawi',
  MX: 'Mexico', MY: 'Malaysia', MZ: 'Mozambique', NA: 'Namibia', NC: 'New Caledonia', NE: 'Niger', NG: 'Nigeria',
  NI: 'Nicaragua', NL: 'Netherlands', NO: 'Norway', NP: 'Nepal', NR: 'Nauru', NZ: 'New Zealand', OM: 'Oman',
  PA: 'Panama', PE: 'Peru', PG: 'Papua New Guinea', PH: 'Philippines', PK: 'Pakistan', PL: 'Poland', PR: 'Puerto Rico',
  PS: 'Palestine', PT: 'Portugal', PW: 'Palau', PY: 'Paraguay', QA: 'Qatar', RO: 'Romania', RS: 'Serbia', RU: 'Russia',
  RW: 'Rwanda', SA: 'Saudi Arabia', SB: 'Solomon Islands', SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden',
  SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', SL: 'Sierra Leone', SM: 'San Marino', SN: 'Senegal', SO: 'Somalia',
  SR: 'Suriname', SS: 'South Sudan', ST: 'São Tomé and Príncipe', SV: 'El Salvador', SY: 'Syria', SZ: 'Eswatini',
  TD: 'Chad', TG: 'Togo', TH: 'Thailand', TJ: 'Tajikistan', TL: 'Timor-Leste', TM: 'Turkmenistan', TN: 'Tunisia',
  TO: 'Tonga', TR: 'Türkiye', TT: 'Trinidad and Tobago', TV: 'Tuvalu', TW: 'Taiwan', TZ: 'Tanzania', UA: 'Ukraine',
  UG: 'Uganda', US: 'United States', UY: 'Uruguay', UZ: 'Uzbekistan', VA: 'Vatican City',
  VC: 'Saint Vincent and the Grenadines', VE: 'Venezuela', VN: 'Vietnam', VU: 'Vanuatu', WS: 'Samoa', XK: 'Kosovo',
  YE: 'Yemen', ZA: 'South Africa', ZM: 'Zambia', ZW: 'Zimbabwe',
}

/** A territory's English name, as Node's Intl gives it, written the way the counted places are ("&" as "and") */
export function territoryName(code: string): string {
  let name = ''
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? ''
  } catch {
    name = ''
  }
  if (!name || name === code || /^unknown/i.test(name)) return code
  return name.replace(/ & /g, ' and ').replace(/^St\. /, 'Saint ').replace(/ SAR China$/, '')
}

/** A language's English name ("sq" is "Albanian"), or the code when Intl doesn't know it */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
    return name && name !== code ? name : code
  } catch {
    return code
  }
}

/** A feed's outlet as people call it: "The Guardian — World" is The Guardian, "RTSH (Albania)" is RTSH */
export function outletName(feedName: string): string {
  const name = feedName.split(/\s+[—–-]\s+/)[0].trim().replace(/\s*\([^)]*\)$/, '').trim()
  return name || feedName.trim()
}

export interface CoveragePlace {
  /** ISO 3166-1 alpha-2, upper case */
  c:  string
  /** its name */
  n:  string
  /** news feeds homed there (parked ones included: they're tried once a day) */
  f:  number
  /** of them in English */
  en: number
  /** their languages, most feeds first */
  l:  string[]
  /** their outlets, English ones first, then A to Z */
  o:  string[]
  /** feeds parked (the server can't read them now; tried once a day), when there are any */
  p?: number
  /** a territory: shown, not counted in the totals */
  t?: true
}

export interface Coverage {
  /** when it was worked out */
  at:        string
  feeds:     number
  english:   number
  parked:    number
  /** every language, most feeds first */
  languages: string[]
  /** the counted places (with no feed: f 0) and the territories with feeds, by code */
  places:    CoveragePlace[]
}

type Feed = Pick<NewsSource, 'name' | 'countryCode' | 'language' | 'parked'>

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' })

/** How many feeds each place has, in which languages, and their outlets (the coverage map's numbers) */
export function coverageOf(sources: readonly Feed[], now: Date = new Date()): Coverage {
  const groups = new Map<string, Feed[]>()
  for (const code of Object.keys(COUNTED_PLACES)) groups.set(code, [])
  for (const s of sources) {
    const code = (s.countryCode || '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) continue
    groups.set(code, [...(groups.get(code) ?? []), s])
  }
  const allLanguages = new Map<string, number>()
  const places: CoveragePlace[] = []
  for (const [code, feeds] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const counts = new Map<string, number>()
    for (const s of feeds) {
      const lang = (s.language || 'und').toLowerCase()
      counts.set(lang, (counts.get(lang) ?? 0) + 1)
      allLanguages.set(lang, (allLanguages.get(lang) ?? 0) + 1)
    }
    const languages = [...counts]
      .sort(([a, x], [b, y]) => y - x || Number(a !== 'en') - Number(b !== 'en') || byName(languageName(a), languageName(b)))
      .map(([lang]) => languageName(lang))
    const english = [...new Set(feeds.filter(s => s.language === 'en').map(s => outletName(s.name)))].sort(byName)
    const others = [...new Set(feeds.filter(s => s.language !== 'en').map(s => outletName(s.name)))]
      .filter(n => !english.includes(n)).sort(byName)
    const parked = feeds.filter(s => s.parked).length
    const place: CoveragePlace = {
      c: code, n: COUNTED_PLACES[code] ?? territoryName(code), f: feeds.length,
      en: feeds.filter(s => s.language === 'en').length, l: languages, o: [...english, ...others],
    }
    if (parked > 0) place.p = parked
    if (!(code in COUNTED_PLACES)) place.t = true
    places.push(place)
  }
  return {
    at:        now.toISOString(),
    feeds:     places.reduce((n, p) => n + p.f, 0),
    english:   places.reduce((n, p) => n + p.en, 0),
    parked:    places.reduce((n, p) => n + (p.p ?? 0), 0),
    languages: [...allLanguages].sort(([a, x], [b, y]) => y - x || byName(a, b)).map(([lang]) => languageName(lang)),
    places,
  }
}

/** Write the coverage map's numbers for /ops-status.json; returns how many places have feeds (0 when Redis refused) */
export async function noteCoverage(redis: Pick<Redis, 'set'>, sources: readonly Feed[]): Promise<number> {
  try {
    const coverage = coverageOf(sources)
    await redis.set(COVERAGE_KEY, JSON.stringify(coverage))
    return coverage.places.filter(p => p.f > 0).length
  } catch {
    return 0   // best effort: the next cycle writes it again
  }
}
