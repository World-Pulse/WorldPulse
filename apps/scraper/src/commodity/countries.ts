/**
 * The commodity watch's countries: a name for each, and the words the news uses for it (to count
 * how much our sources say about a country's crop). The European Union is one entry, as USDA
 * reports it; its member states are counted for it too.
 */

export interface WatchCountry {
  iso: string
  name: string
  /** Whole words, case-insensitive (the US's are case-sensitive: "US", not "us") */
  words: RegExp
  /** For the EU, its member states' codes */
  members?: string[]
}

const w = (iso: string, name: string, words: string, flags = 'i'): WatchCountry => ({ iso, name, words: new RegExp(`\\b(?:${words})\\b`, flags) })

export const EU_MEMBERS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']

const LIST: WatchCountry[] = [
  { iso: 'EU', name: 'European Union', words: /\b(?:European Union|EU|France|French|Germany|German|Poland|Polish farmers|Romania|Romanian|Spain|Spanish farmers|Italy|Italian|Hungary|Hungarian|Bulgaria|Bulgarian|Netherlands|Dutch|Belgium|Belgian|Denmark|Danish|Austria|Czech|Greece|Greek|Portugal)\b/, members: EU_MEMBERS },
  w('US', 'United States', 'United States|U\\.S\\.|US|USA|American|USDA|Midwest|Corn Belt|Iowa|Illinois|Nebraska|Kansas|Minnesota|Indiana|Ohio|Texas|Georgia farmers|Florida citrus|California almonds|North Dakota|Arkansas|Mississippi Delta', ''),
  w('BR', 'Brazil', 'brazil|brazilian|minas gerais|mato grosso|paraná|parana|são paulo|sao paulo|goiás|goias|rio grande do sul|bahia|espírito santo|espirito santo|conab'),
  w('AR', 'Argentina', 'argentina|argentine|argentinian|buenos aires|córdoba|cordoba|santa fe|rosario'),
  w('CA', 'Canada', 'canada|canadian|saskatchewan|alberta|manitoba|prairies'),
  w('MX', 'Mexico', 'mexico|mexican|sinaloa|jalisco|veracruz|chiapas|tamaulipas'),
  w('CN', 'China', 'china|chinese|beijing|heilongjiang|jilin|henan|shandong|hebei|xinjiang|guangxi|yunnan|hunan|jiangxi|jiangsu|hubei|sichuan|fujian|hainan|inner mongolia'),
  w('IN', 'India', 'india|indian|punjab|uttar pradesh|maharashtra|karnataka|gujarat|madhya pradesh|west bengal|andhra pradesh|telangana|rajasthan|assam|kerala|odisha'),
  w('PK', 'Pakistan', 'pakistan|pakistani|sindh'),
  w('BD', 'Bangladesh', 'bangladesh|bangladeshi'),
  w('ID', 'Indonesia', 'indonesia|indonesian|sumatra|java|kalimantan|sulawesi|lampung|riau'),
  w('MY', 'Malaysia', 'malaysia|malaysian|sabah|sarawak|johor'),
  w('TH', 'Thailand', 'thailand|thai'),
  w('VN', 'Vietnam', 'vietnam|vietnamese|viet nam|mekong|central highlands'),
  w('PH', 'Philippines', 'philippines|philippine|filipino'),
  w('MM', 'Myanmar', 'myanmar|burma|burmese'),
  w('KH', 'Cambodia', 'cambodia|cambodian'),
  w('JP', 'Japan', 'japan|japanese'),
  w('KR', 'South Korea', 'south korea|korean'),
  w('RU', 'Russia', 'russia|russian|krasnodar|rostov|stavropol|volga|siberia|voronezh|saratov'),
  w('UA', 'Ukraine', 'ukraine|ukrainian|odesa|odessa'),
  w('KZ', 'Kazakhstan', 'kazakhstan|kazakh'),
  w('UZ', 'Uzbekistan', 'uzbekistan|uzbek'),
  w('TR', 'Turkey', 'turkey|türkiye|turkiye|turkish|anatolia'),
  w('IR', 'Iran', 'iran|iranian'),
  w('GB', 'United Kingdom', 'united kingdom|britain|british|england|english farmers|uk', 'i'),
  w('AU', 'Australia', 'australia|australian|queensland|new south wales|western australia|victoria'),
  w('NZ', 'New Zealand', 'new zealand'),
  w('ZA', 'South Africa', 'south africa|south african'),
  w('EG', 'Egypt', 'egypt|egyptian'),
  w('NG', 'Nigeria', 'nigeria|nigerian'),
  w('ET', 'Ethiopia', 'ethiopia|ethiopian'),
  w('KE', 'Kenya', 'kenya|kenyan'),
  w('UG', 'Uganda', 'uganda|ugandan'),
  w('TZ', 'Tanzania', 'tanzania|tanzanian'),
  w('SD', 'Sudan', 'sudan|sudanese'),
  w('SN', 'Senegal', 'senegal|senegalese'),
  w('CI', "Côte d'Ivoire", "ivory coast|côte d'ivoire|cote d'ivoire|ivorian"),
  w('GH', 'Ghana', 'ghana|ghanaian|cocobod'),
  w('CM', 'Cameroon', 'cameroon|cameroonian'),
  w('LK', 'Sri Lanka', 'sri lanka|sri lankan|ceylon'),
  w('CO', 'Colombia', 'colombia|colombian'),
  w('EC', 'Ecuador', 'ecuador|ecuadorian|ecuadorean'),
  w('PE', 'Peru', 'peru|peruvian'),
  w('PY', 'Paraguay', 'paraguay|paraguayan'),
  w('UY', 'Uruguay', 'uruguay|uruguayan'),
  w('BO', 'Bolivia', 'bolivia|bolivian'),
  w('HN', 'Honduras', 'honduras|honduran'),
  w('GT', 'Guatemala', 'guatemala|guatemalan'),
  w('NI', 'Nicaragua', 'nicaragua|nicaraguan'),
  w('CR', 'Costa Rica', 'costa rica|costa rican'),
  w('BJ', 'Benin', 'benin|beninese'),
  w('BF', 'Burkina Faso', 'burkina faso|burkinabe'),
  w('ML', 'Mali', 'mali|malian'),
  w('MA', 'Morocco', 'morocco|moroccan'),
  w('DZ', 'Algeria', 'algeria|algerian'),
  w('SA', 'Saudi Arabia', 'saudi arabia|saudi'),
  w('IL', 'Israel', 'israel|israeli'),
  w('NO', 'Norway', 'norway|norwegian'),
  w('CL', 'Chile', 'chile|chilean'),
  w('PG', 'Papua New Guinea', 'papua new guinea'),
]

export const COUNTRIES: ReadonlyMap<string, WatchCountry> = new Map(LIST.map(x => [x.iso, x]))

/** A country's name (USDA's when it isn't listed here) */
export function countryName(iso: string, fallback?: string): string {
  return COUNTRIES.get(iso)?.name ?? fallback ?? iso
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The words for a country: the listed ones, or its name */
export function countryWords(iso: string, name: string): RegExp {
  return COUNTRIES.get(iso)?.words ?? new RegExp(`\\b${escape(name)}\\b`, 'i')
}

/** Whether a story's country code is the country's (any member state for the EU) */
export function sameCountry(iso: string, code: string | null | undefined): boolean {
  if (!code) return false
  const c = code.toUpperCase()
  return c === iso || (COUNTRIES.get(iso)?.members?.includes(c) ?? false)
}
