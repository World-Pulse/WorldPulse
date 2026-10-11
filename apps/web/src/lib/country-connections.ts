/**
 * Connections on the World Map (plan item M13, reworked Oct 11, 2026): the
 * countries a chosen country's news is most tied to in the map's time window,
 * drawn as arcs from it. A signal ties two countries when it's pinned in one
 * and its headline names the other ("Pakistan reaffirms commitment to Saudi
 * Arabia's sovereignty", pinned in Pakistan, ties Pakistan to Saudi Arabia).
 *
 * The country words are the scraper's (pipeline/geo.ts and world-countries.ts):
 * names and words for their people, plurals, "US"/"UK" in capitals; names
 * that are also first names or other places are narrowed there.
 */

import { featureContains, focusBboxOf, type CountryFeature } from './country-shapes'

/** [ISO code, name, words that name it] */
const COUNTRY_WORDS: Array<[string, string, RegExp]> = [
  ['US', 'United States', /\b(?:united states|usa|u\.s\.a?\.?)(?!\w)/i],
  ['GB', 'United Kingdom', /\b(?:united kingdom|britain|(?<!new )england|scotland|(?<!new south )wales)\b/i],
  ['CN', 'China', /\b(?:china|chinese)\b/i],
  ['RU', 'Russia', /\b(?:russia|russian federation)\b/i],
  ['FR', 'France', /\b(?:france|french)\b/i],
  ['DE', 'Germany', /\b(?:germany|german)\b/i],
  ['JP', 'Japan', /\b(?:japan|japanese)\b/i],
  ['IN', 'India', /\b(?:india|indian)\b/i],
  ['BR', 'Brazil', /\b(?:brazil|brazilian)\b/i],
  ['CA', 'Canada', /\b(?:canada|canadian)\b/i],
  ['AU', 'Australia', /\b(?:australia|australian)\b/i],
  ['IL', 'Israel', /\b(?:israel|israeli)\b/i],
  ['IR', 'Iran', /\b(?:iran|iranian)\b/i],
  ['KP', 'North Korea', /\b(?:north korea|north korean|dprk)\b/i],
  ['KR', 'South Korea', /\b(?:south korea|south korean)\b/i],
  ['PK', 'Pakistan', /\b(?:pakistan|pakistani)\b/i],
  ['AF', 'Afghanistan', /\b(?:afghanistan|afghan)\b/i],
  ['SY', 'Syria', /\b(?:syria|syrian)\b/i],
  ['IQ', 'Iraq', /\b(?:iraq|iraqi)\b/i],
  ['SA', 'Saudi Arabia', /\b(?:saudi arabia|saudi)\b/i],
  ['TR', 'Turkey', /\b(?:turkey|turkish|t[uü]rkiye)\b/i],
  ['UA', 'Ukraine', /\b(?:ukraine|ukrainian)\b/i],
  ['MX', 'Mexico', /\b(?:(?<!new )mexico|mexican)\b/i],
  ['AR', 'Argentina', /\b(?:argentina|argentine|argentinian)\b/i],
  ['CO', 'Colombia', /\b(?:colombia|colombian)\b/i],
  ['NG', 'Nigeria', /\b(?:nigeria|nigerian)\b/i],
  ['ZA', 'South Africa', /\b(?:south africa|south african)\b/i],
  ['KE', 'Kenya', /\b(?:kenya|kenyan)\b/i],
  ['ET', 'Ethiopia', /\b(?:ethiopia|ethiopian)\b/i],
  ['ID', 'Indonesia', /\b(?:indonesia|indonesian)\b/i],
  ['PH', 'Philippines', /\b(?:philippines|philippine|filipino)\b/i],
  ['VN', 'Vietnam', /\b(?:vietnam|vietnamese)\b/i],
  ['TH', 'Thailand', /\b(?:thailand|thai)\b/i],
  ['MY', 'Malaysia', /\b(?:malaysia|malaysian)\b/i],
  ['AL', 'Albania', /\b(?:albania|albanian)\b/i],
  ['AD', 'Andorra', /\bandorra\b/i],
  ['AT', 'Austria', /\b(?:austria|austrian)\b/i],
  ['BY', 'Belarus', /\b(?:belarus|belarusian)\b/i],
  ['BE', 'Belgium', /\b(?:belgium|belgian)\b/i],
  ['BA', 'Bosnia and Herzegovina', /\b(?:bosnia|bosnian|herzegovina)\b/i],
  ['BG', 'Bulgaria', /\b(?:bulgaria|bulgarian)\b/i],
  ['HR', 'Croatia', /\b(?:croatia|croatian)\b/i],
  ['CY', 'Cyprus', /\b(?:cyprus|cypriot)\b/i],
  ['CZ', 'Czechia', /\b(?:czechia|czech)\b/i],
  ['DK', 'Denmark', /\b(?:denmark|danish)\b/i],
  ['EE', 'Estonia', /\b(?:estonia|estonian)\b/i],
  ['FI', 'Finland', /\b(?:finland|finnish)\b/i],
  ['GR', 'Greece', /\b(?:greece|greek)\b/i],
  ['HU', 'Hungary', /\b(?:hungary|hungarian)\b/i],
  ['IS', 'Iceland', /\b(?:iceland|icelandic)\b/i],
  ['IE', 'Ireland', /\b(?:(?<!northern )ireland|irish)\b/i],
  ['IT', 'Italy', /\b(?:italy|italian)\b/i],
  ['XK', 'Kosovo', /\b(?:kosovo|kosovar)\b/i],
  ['LV', 'Latvia', /\b(?:latvia|latvian)\b/i],
  ['LI', 'Liechtenstein', /\bliechtenstein\b/i],
  ['LT', 'Lithuania', /\b(?:lithuania|lithuanian)\b/i],
  ['LU', 'Luxembourg', /\bluxembourg\b/i],
  ['MT', 'Malta', /\b(?:malta|maltese)\b/i],
  ['MD', 'Moldova', /\b(?:moldova|moldovan)\b/i],
  ['MC', 'Monaco', /\bmonaco\b/i],
  ['ME', 'Montenegro', /\b(?:montenegro|montenegrin)\b/i],
  ['NL', 'Netherlands', /\b(?:netherlands|dutch|holland)\b/i],
  ['MK', 'North Macedonia', /\b(?:north macedonia|macedonia|macedonian)\b/i],
  ['NO', 'Norway', /\b(?:norway|norwegian)\b/i],
  ['PL', 'Poland', /\bpoland\b/i],
  ['PT', 'Portugal', /\bportugal\b/i],
  ['RO', 'Romania', /\b(?:romania|romanian)\b/i],
  ['SM', 'San Marino', /\bsan marino\b/i],
  ['RS', 'Serbia', /\b(?:serbia|serbian)\b/i],
  ['SK', 'Slovakia', /\b(?:slovakia|slovak)\b/i],
  ['SI', 'Slovenia', /\b(?:slovenia|slovenian|slovene)\b/i],
  ['ES', 'Spain', /\bspain\b/i],
  ['SE', 'Sweden', /\b(?:sweden|swedish)\b/i],
  ['CH', 'Switzerland', /\b(?:switzerland|swiss)\b/i],
  ['VA', 'Vatican City', /\b(?:vatican|holy see)\b/i],
  ['GE', 'Georgia', /\b(?:republic of georgia|georgian dream|tbilisi)\b/i],
  ['AM', 'Armenia', /\b(?:armenia|armenian)\b/i],
  ['AZ', 'Azerbaijan', /\b(?:azerbaijan|azerbaijani|azeri)\b/i],
  ['GL', 'Greenland', /\bgreenland\b/i],
  ['BH', 'Bahrain', /\b(?:bahrain|bahraini)\b/i],
  ['EG', 'Egypt', /\b(?:egypt|egyptian)\b/i],
  ['JO', 'Jordan', /\b(?:jordanian|king of jordan|in jordan|jordan['’]s (?:king|queen|foreign|government|army|prime))\b/i],
  ['KW', 'Kuwait', /\b(?:kuwait|kuwaiti)\b/i],
  ['LB', 'Lebanon', /\b(?:lebanon|lebanese)\b/i],
  ['OM', 'Oman', /\b(?:oman|omani)\b/i],
  ['PS', 'Palestine', /\b(?:palestine|palestinian)\b/i],
  ['QA', 'Qatar', /\b(?:qatar|qatari)\b/i],
  ['AE', 'United Arab Emirates', /\b(?:united arab emirates|uae|emirati)\b/i],
  ['YE', 'Yemen', /\b(?:yemen|yemeni)\b/i],
  ['DZ', 'Algeria', /\b(?:algeria|algerian)\b/i],
  ['LY', 'Libya', /\b(?:libya|libyan)\b/i],
  ['MA', 'Morocco', /\b(?:morocco|moroccan)\b/i],
  ['TN', 'Tunisia', /\b(?:tunisia|tunisian)\b/i],
  ['AO', 'Angola', /\b(?:angola|angolan)\b/i],
  ['BJ', 'Benin', /\b(?:benin(?!\s+city)|beninese)\b/i],
  ['BW', 'Botswana', /\bbotswana\b/i],
  ['BF', 'Burkina Faso', /\b(?:burkina faso|burkina|burkinabe)\b/i],
  ['BI', 'Burundi', /\b(?:burundi|burundian)\b/i],
  ['CV', 'Cabo Verde', /\b(?:cabo verde|cape verde)\b/i],
  ['CM', 'Cameroon', /\b(?:cameroon|cameroonian)\b/i],
  ['CF', 'Central African Republic', /\bcentral african republic\b/i],
  ['TD', 'Chad', /\b(?:chadian|in chad|n['’]djamena)\b/i],
  ['KM', 'Comoros', /\bcomoros\b/i],
  ['CG', 'Republic of the Congo', /\b(?:(?<!democratic )republic of the congo|congo[-\s]brazzaville|brazzaville)\b/i],
  ['CD', 'DR Congo', /\b(?:democratic republic of (?:the )?congo|dr congo|drc|congolese|(?<!republic of the )congo(?![-\s]brazzaville))\b/i],
  ['CI', "Côte d'Ivoire", /\b(?:ivory coast|c[oô]te d['’]ivoire|ivorian)\b/i],
  ['DJ', 'Djibouti', /\bdjibouti\b/i],
  ['GQ', 'Equatorial Guinea', /\bequatorial guinea\b/i],
  ['ER', 'Eritrea', /\b(?:eritrea|eritrean)\b/i],
  ['SZ', 'Eswatini', /\b(?:eswatini|swaziland)\b/i],
  ['GA', 'Gabon', /\b(?:gabon|gabonese)\b/i],
  ['GM', 'Gambia', /\b(?:gambia|gambian)\b/i],
  ['GH', 'Ghana', /\b(?:ghana|ghanaian)\b/i],
  ['GW', 'Guinea-Bissau', /\bguinea[-\s]bissau\b/i],
  ['GN', 'Guinea', /\b(?:(?<!(?:new|equatorial|papua) )guinea(?![-\s](?:bissau|pigs?)\b)|guinean)\b/i],
  ['LS', 'Lesotho', /\blesotho\b/i],
  ['LR', 'Liberia', /\b(?:liberia|liberian)\b/i],
  ['MG', 'Madagascar', /\b(?:madagascar|malagasy)\b/i],
  ['MW', 'Malawi', /\b(?:malawi|malawian)\b/i],
  ['ML', 'Mali', /\b(?:mali|malian)\b/i],
  ['MR', 'Mauritania', /\b(?:mauritania|mauritanian)\b/i],
  ['MU', 'Mauritius', /\b(?:mauritius|mauritian)\b/i],
  ['MZ', 'Mozambique', /\b(?:mozambique|mozambican)\b/i],
  ['NA', 'Namibia', /\b(?:namibia|namibian)\b/i],
  ['NE', 'Niger', /\b(?:niger(?![\s-](?:delta|state|river)\b)|nigerien)\b/i],
  ['RW', 'Rwanda', /\b(?:rwanda|rwandan)\b/i],
  ['ST', 'São Tomé and Príncipe', /\bs[aã]o tom[eé]\b/i],
  ['SN', 'Senegal', /\b(?:senegal|senegalese)\b/i],
  ['SC', 'Seychelles', /\bseychelles\b/i],
  ['SL', 'Sierra Leone', /\bsierra leone(?:an)?\b/i],
  ['SO', 'Somalia', /\b(?:somalia|somali)\b/i],
  ['SS', 'South Sudan', /\bsouth sudan(?:ese)?\b/i],
  ['SD', 'Sudan', /\b(?<!south )sudan(?:ese)?\b/i],
  ['TZ', 'Tanzania', /\b(?:tanzania|tanzanian)\b/i],
  ['TG', 'Togo', /\b(?:togo|togolese)\b/i],
  ['UG', 'Uganda', /\b(?:uganda|ugandan)\b/i],
  ['ZM', 'Zambia', /\b(?:zambia|zambian)\b/i],
  ['ZW', 'Zimbabwe', /\b(?:zimbabwe|zimbabwean)\b/i],
  ['BD', 'Bangladesh', /\b(?:bangladesh|bangladeshi)\b/i],
  ['BT', 'Bhutan', /\b(?:bhutan|bhutanese)\b/i],
  ['BN', 'Brunei', /\bbrunei\b/i],
  ['KH', 'Cambodia', /\b(?:cambodia|cambodian)\b/i],
  ['TL', 'Timor-Leste', /\b(?:timor[-\s]leste|east timor(?:ese)?)\b/i],
  ['HK', 'Hong Kong', /\bhong kong\b/i],
  ['MO', 'Macau', /\bmaca[uo]\b/i],
  ['TW', 'Taiwan', /\b(?:taiwan|taiwanese)\b/i],
  ['KZ', 'Kazakhstan', /\b(?:kazakhstan|kazakh)\b/i],
  ['KG', 'Kyrgyzstan', /\b(?:kyrgyzstan|kyrgyz)\b/i],
  ['LA', 'Laos', /\b(?:laos|laotian)\b/i],
  ['MV', 'Maldives', /\b(?:maldives|maldivian)\b/i],
  ['MN', 'Mongolia', /\b(?:mongolia|mongolian)\b/i],
  ['MM', 'Myanmar', /\b(?:myanmar|burma|burmese)\b/i],
  ['NP', 'Nepal', /\b(?:nepal|nepalese|nepali)\b/i],
  ['SG', 'Singapore', /\bsingapore(?:an)?\b/i],
  ['LK', 'Sri Lanka', /\bsri lanka(?:n)?\b/i],
  ['TJ', 'Tajikistan', /\b(?:tajikistan|tajik)\b/i],
  ['TM', 'Turkmenistan', /\b(?:turkmenistan|turkmen)\b/i],
  ['UZ', 'Uzbekistan', /\b(?:uzbekistan|uzbek)\b/i],
  ['AG', 'Antigua and Barbuda', /\bantigua\b/i],
  ['BS', 'Bahamas', /\b(?:bahamas|bahamian)\b/i],
  ['BB', 'Barbados', /\b(?:barbados|barbadian)\b/i],
  ['BZ', 'Belize', /\bbelize(?:an)?\b/i],
  ['BO', 'Bolivia', /\b(?:bolivia|bolivian)\b/i],
  ['CL', 'Chile', /\b(?:chile|chilean)\b/i],
  ['CR', 'Costa Rica', /\bcosta rica(?:n)?\b/i],
  ['CU', 'Cuba', /\b(?:cuba|cuban)\b/i],
  ['DM', 'Dominica', /\bdominica\b/i],
  ['DO', 'Dominican Republic', /\bdominican republic\b/i],
  ['EC', 'Ecuador', /\b(?:ecuador|ecuadorian|ecuadorean)\b/i],
  ['SV', 'El Salvador', /\b(?:el salvador|salvadoran|salvadorean)\b/i],
  ['GD', 'Grenada', /\bgrenada\b/i],
  ['GT', 'Guatemala', /\bguatemala(?:n)?\b/i],
  ['GY', 'Guyana', /\b(?:guyana|guyanese)\b/i],
  ['HT', 'Haiti', /\b(?:haiti|haitian)\b/i],
  ['HN', 'Honduras', /\b(?:honduras|honduran)\b/i],
  ['JM', 'Jamaica', /\bjamaica(?:n)?\b/i],
  ['NI', 'Nicaragua', /\bnicaragua(?:n)?\b/i],
  ['PA', 'Panama', /\bpanama(?:nians?)?\b/i],
  ['PY', 'Paraguay', /\bparaguay(?:an)?\b/i],
  ['PE', 'Peru', /\b(?:peru|peruvian)\b/i],
  ['PR', 'Puerto Rico', /\bpuerto ric(?:o|an)\b/i],
  ['LC', 'Saint Lucia', /\b(?:saint|st\.?) lucia\b/i],
  ['SR', 'Suriname', /\b(?:suriname|surinamese)\b/i],
  ['TT', 'Trinidad and Tobago', /\b(?:trinidad|trinidadian)\b/i],
  ['UY', 'Uruguay', /\buruguay(?:an)?\b/i],
  ['VE', 'Venezuela', /\bvenezuela(?:n)?\b/i],
  ['FJ', 'Fiji', /\bfiji(?:an)?\b/i],
  ['KI', 'Kiribati', /\bkiribati\b/i],
  ['MH', 'Marshall Islands', /\bmarshall islands\b/i],
  ['FM', 'Micronesia', /\bmicronesia\b/i],
  ['NR', 'Nauru', /\bnauru\b/i],
  ['NZ', 'New Zealand', /\bnew zealand(?:ers?)?\b/i],
  ['PW', 'Palau', /\bpalau\b/i],
  ['PG', 'Papua New Guinea', /\bpapua new guinea(?:n)?\b/i],
  ['WS', 'Samoa', /\bsamoa(?:n)?\b/i],
  ['SB', 'Solomon Islands', /\bsolomon islands?\b/i],
  ['TO', 'Tonga', /\btonga(?:n)?\b/i],
  ['TV', 'Tuvalu', /\btuvalu\b/i],
  ['VU', 'Vanuatu', /\bvanuatu\b/i],
  ['NC', 'New Caledonia', /\bnew caledonia(?:n)?\b/i],
]

/** Plural people-words too ("Afghans", "Israelis"); not "turkeys", "chiles", "the 2,000 Guineas" */
const NO_PLURAL = new Set(['TR', 'CL', 'GN'])
const MATCHERS: Array<[string, RegExp]> = [
  ...COUNTRY_WORDS.map(([code, , re]): [string, RegExp] =>
    NO_PLURAL.has(code) || !re.source.endsWith(')\\b') ? [code, re] : [code, new RegExp(`${re.source.slice(0, -2)}s?\\b`, re.flags)]),
  ['US', /\bUS\b/],
  ['GB', /\bUK\b/],
]

const NAMES = new Map(COUNTRY_WORDS.map(([code, name]) => [code, name]))
/** Headline → the countries it names (countriesMentioned) */
const MENTIONS = new Map<string, string[]>()

/** A country's name from its code (undefined when the list doesn't have it) */
export function countryLabel(code: string): string | undefined {
  return NAMES.get(code)
}

/** The countries a text names, by code, in order of first mention */
export function countriesMentioned(text: string): string[] {
  const known = MENTIONS.get(text)
  if (known) return known
  const hits: Array<{ code: string; index: number }> = []
  for (const [code, re] of MATCHERS) {
    const m = re.exec(text)
    if (m) hits.push({ code, index: m.index })
  }
  const codes = [...new Set(hits.sort((a, b) => a.index - b.index).map(h => h.code))]
  // ~200 patterns a headline: remember the answers, since the map asks again on every live update
  if (MENTIONS.size >= 20_000) MENTIONS.clear()
  MENTIONS.set(text, codes)
  return codes
}

export interface Connection {
  code: string
  name: string
  /** Signals that tie the two countries */
  count: number
}

interface ConnectionSignal { id: string; title: string; lat: number; lng: number }

/**
 * The countries most tied to `code` in these signals: signals pinned inside
 * it that name another country, and signals pinned in another country that
 * name it. At least `min` signals each, the strongest `max`.
 */
export function countryConnections<T extends ConnectionSignal>(
  signals: T[],
  code: string,
  feature: CountryFeature,
  countryOf: (lng: number, lat: number) => string | null,
  max = 6,
  min = 2,
): Connection[] {
  const ties = new Map<string, Set<string>>()
  const tie = (other: string, id: string) => {
    if (other === code) return
    const set = ties.get(other) ?? new Set<string>()
    set.add(id)
    ties.set(other, set)
  }
  for (const s of signals) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !s.title) continue
    const named = countriesMentioned(s.title)
    if (featureContains(feature, s.lng, s.lat)) {
      for (const other of named) tie(other, s.id)
    } else if (named.includes(code)) {
      const home = countryOf(s.lng, s.lat)
      if (home) tie(home, s.id)
    }
  }
  return [...ties]
    .map(([other, ids]) => ({ code: other, name: NAMES.get(other) ?? other, count: ids.size }))
    .filter(c => c.count >= min)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max)
}

/** A country's middle for drawing: the centre of its largest piece */
export function countryCentre(feature: CountryFeature): [number, number] {
  const [w, s, e, n] = focusBboxOf(feature)
  return [(w + e) / 2, (s + n) / 2]
}

const RAD = Math.PI / 180

/** Degrees of longitude from `a` to `b`, the short way round (-180..180) */
const lngDelta = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180

/** The angle between two places, in degrees */
export function arcDegrees(a: [number, number], b: [number, number]): number {
  const [p1, p2] = [a[1] * RAD, b[1] * RAD]
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(lngDelta(a[0], b[0]) * RAD)
  return Math.acos(Math.max(-1, Math.min(1, cos))) / RAD
}

/**
 * The highest zoom at which the places tied to `from` lie within halfW
 * pixels of it across and halfH up and down, with `from` in the middle: on
 * the globe (MapLibre draws it 512·2^zoom / (2π·cos(latitude)) pixels in
 * radius) or on the flat map. Places more than `reach` degrees away are left
 * out: they'd shrink the globe to a marble, and their arcs still run off
 * toward them. Infinity when there's nothing to fit.
 */
export function fitZoom(
  from: [number, number], others: Array<[number, number]>, halfW: number, halfH: number,
  projection: 'globe' | 'mercator' = 'globe', reach = 70,
): number {
  const lat0 = from[1] * RAD
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2))
  let maxX = 0
  let maxY = 0
  for (const [lng, lat] of others) {
    if (arcDegrees(from, [lng, lat]) > reach) continue
    const dl = lngDelta(from[0], lng) * RAD
    const p = lat * RAD
    if (projection === 'globe') {
      maxX = Math.max(maxX, Math.abs(Math.cos(p) * Math.sin(dl)))
      maxY = Math.max(maxY, Math.abs(Math.cos(lat0) * Math.sin(p) - Math.sin(lat0) * Math.cos(p) * Math.cos(dl)))
    } else {
      maxX = Math.max(maxX, Math.abs(dl))
      maxY = Math.max(maxY, Math.abs(merc(lat) - merc(from[1])))
    }
  }
  const radius = Math.min(maxX > 0 ? halfW / maxX : Infinity, maxY > 0 ? halfH / maxY : Infinity)
  if (!Number.isFinite(radius)) return Infinity
  return Math.log2((radius * 2 * Math.PI * (projection === 'globe' ? Math.cos(lat0) : 1)) / 512)
}

/** Ties farther than this (degrees) are over the horizon: their name also runs along the arc */
export const FAR_TIE = 70

type LinkFeature = {
  type: 'Feature'
  properties: { kind: 'arc' | 'end' | 'far'; count?: number; label?: string }
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> } | { type: 'Point'; coordinates: [number, number] }
}

/**
 * What the map draws for a country's ties: an arc to each and, at its far
 * end, a dot with the country's name and count. A country over the horizon
 * (the United States, seen from Saudi Arabia) also gets its name beside the
 * arc 35 degrees out, on the side of the globe you see, so the line says
 * where it goes.
 */
export function connectionFeatures(
  from: [number, number], links: Array<{ name: string; count: number; centre: [number, number] }>,
): { type: 'FeatureCollection'; features: LinkFeature[] } {
  const features: LinkFeature[] = []
  for (const link of links) {
    const arc = greatCircle(from, link.centre)
    const label = `${link.name} · ${link.count}`
    features.push({ type: 'Feature', properties: { kind: 'arc', count: link.count }, geometry: { type: 'LineString', coordinates: arc } })
    features.push({ type: 'Feature', properties: { kind: 'end', label }, geometry: { type: 'Point', coordinates: link.centre } })
    const d = arcDegrees(from, link.centre)
    if (d > FAR_TIE) {
      const point = arc[Math.round((35 / d) * (arc.length - 1))]!
      features.push({ type: 'Feature', properties: { kind: 'far', label }, geometry: { type: 'Point', coordinates: point } })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Points along the great circle from `a` to `b` ([lng, lat]), for an arc on the globe */
export function greatCircle(a: [number, number], b: [number, number], steps = 64): Array<[number, number]> {
  const [lng1, lat1] = [a[0] * RAD, a[1] * RAD]
  const [lng2, lat2] = [b[0] * RAD, b[1] * RAD]
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2))
  if (d === 0) return [a, b]
  const points: Array<[number, number]> = []
  let prevLng: number | null = null
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2)
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    let lng = Math.atan2(y, x) / RAD
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD
    // Keep longitudes continuous across the antimeridian
    if (prevLng !== null) {
      while (lng - prevLng > 180) lng -= 360
      while (lng - prevLng < -180) lng += 360
    }
    prevLng = lng
    points.push([Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000])
  }
  return points
}
