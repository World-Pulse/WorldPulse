/**
 * Where a story's outlets are from (Nov 8, 2026; Devon: "we have to lead with coverage" once another site
 * started counting outlets too): how many countries they are from ("81 outlets · 36 countries") and how many
 * are newsrooms of the country the story is in ("2 from Poland"). The API counts both from its outlet
 * directory (apps/api/src/lib/outlets.ts, outletReach); websites the directory doesn't know count for
 * neither, so a story's outlets are from at least that many countries. The story's country is the one most
 * of its reports are pinned to on the map.
 */

export interface StoryReach {
  /** The country most of its reports are in (two letters), when known */
  country: string | null
  /** How many countries its outlets are from */
  countries: number
  /** How many of them are the story's own country's, and up to three of their names */
  local: number
  localNames: string[]
}

/** Names that read better than Unicode's ("Congo - Kinshasa", "Myanmar (Burma)"), or as the site writes them */
const COUNTRY_LABELS: Record<string, string> = {
  CD: 'DR Congo', CG: 'Congo', MM: 'Myanmar', HK: 'Hong Kong', MO: 'Macau', PS: 'Palestine', TR: 'Turkey',
  CZ: 'Czech Republic', BA: 'Bosnia and Herzegovina', TT: 'Trinidad and Tobago', AG: 'Antigua and Barbuda',
  KN: 'St Kitts and Nevis', LC: 'St Lucia', VC: 'St Vincent and the Grenadines', ST: 'São Tomé and Príncipe',
  VA: 'Vatican City', FM: 'Micronesia',
}

/** Countries said with "the": "2 from the United States" */
const WITH_THE = new Set(['US', 'GB', 'NL', 'PH', 'AE', 'CF', 'DO', 'BS', 'GM', 'MV', 'KM', 'SB', 'MH', 'KY', 'FO', 'FK', 'TC', 'VG', 'VI', 'MP', 'CK'])

let regionNames: Intl.DisplayNames | null | undefined
function regionName(code: string): string | null {
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }) } catch { regionNames = null }
  }
  try {
    const name = regionNames?.of(code)
    return name && name !== code ? name : null
  } catch {
    return null
  }
}

/** "Poland", "the United States" (`the` false: "United States"); null when the code isn't a country */
export function countryLabel(code: string | null | undefined, the = true): string | null {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return null
  const c = code.toUpperCase()
  const name = COUNTRY_LABELS[c] ?? regionName(c)
  if (!name) return null
  return the && WITH_THE.has(c) ? `the ${name}` : name
}

const count = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** The API's reach fields, checked; null when it sent none (an older API, or a story of unknown outlets) */
export function reachOf(country: unknown, countries: unknown, local: unknown, names: unknown): StoryReach | null {
  const code = typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null
  const reach: StoryReach = {
    country: code,
    countries: count(countries),
    local: code ? count(local) : 0,
    localNames: code && Array.isArray(names)
      ? names.filter((n): n is string => typeof n === 'string' && n.trim() !== '').slice(0, 3)
      : [],
  }
  return reach.countries > 0 || reach.local > 0 ? reach : null
}

/** "36 countries", or null under two */
export function countriesLabel(reach: Pick<StoryReach, 'countries'> | null | undefined): string | null {
  return reach && reach.countries >= 2 ? `${reach.countries} countries` : null
}

export interface LocalLabel {
  /** "2 from Poland" */
  label: string
  /** "2 outlets from Poland" */
  long: string
  /** "Defence24, Notes from Poland" ("... and 3 more"); '' when the API named none */
  names: string
  /** The hover text: "Defence24, Notes from Poland: outlets from Poland, where the story is" */
  title: string
}

/** The newsrooms of the story's own country; null when none is, or the country is unknown */
export function localLabel(reach: StoryReach | null | undefined): LocalLabel | null {
  if (!reach || reach.local < 1) return null
  const where = countryLabel(reach.country)
  if (!where) return null
  const more = reach.local - reach.localNames.length
  const names = reach.localNames.length > 0 ? `${reach.localNames.join(', ')}${more > 0 ? ` and ${more} more` : ''}` : ''
  const word = reach.local === 1 ? 'outlet' : 'outlets'
  return {
    label: `${reach.local} from ${where}`,
    long: `${reach.local} ${word} from ${where}`,
    names,
    title: `${names ? `${names}: ` : ''}${reach.local === 1 ? 'an outlet' : 'outlets'} from ${where}, where the story is`,
  }
}
