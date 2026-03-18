/**
 * Geographic Data Extraction
 *
 * Extracts location information from article text using:
 * 1. Enhanced NER-based location extraction from text patterns
 * 2. Gazetteer lookup (fast-path cache with 140+ locations)
 * 3. Nominatim geocoding fallback (OSM, no API key required)
 * 4. Redis caching to avoid repeat Nominatim lookups
 * 5. Rate limiting — max 1 Nominatim request/second per ToS
 */

import { redis } from '../lib/redis'
import { logger } from '../lib/logger'

interface GeoResult {
  point:        boolean
  lat?:         number
  lng?:         number
  name?:        string
  countryCode?: string
  region?:      string
}

// ─── RATE LIMITER (1 req/s for Nominatim) ───────────────────────────────────
let lastNominatimCall = 0

async function throttleNominatim(): Promise<void> {
  const now    = Date.now()
  const waited = now - lastNominatimCall
  if (waited < 1000) {
    await new Promise(r => setTimeout(r, 1000 - waited))
  }
  lastNominatimCall = Date.now()
}

// ─── GAZETTEER (fast-path; ~140 locations) ───────────────────────────────────
const GAZETTEER: Record<string, { lat: number; lng: number; country: string; region?: string }> = {
  'manila':           { lat: 14.5995, lng: 120.9842, country: 'PH', region: 'Metro Manila' },
  'philippines':      { lat: 12.8797, lng: 121.7740, country: 'PH' },
  'tokyo':            { lat: 35.6762, lng: 139.6503, country: 'JP', region: 'Kanto' },
  'osaka':            { lat: 34.6937, lng: 135.5023, country: 'JP' },
  'beijing':          { lat: 39.9042, lng: 116.4074, country: 'CN', region: 'Beijing' },
  'shanghai':         { lat: 31.2304, lng: 121.4737, country: 'CN' },
  'hong kong':        { lat: 22.3193, lng: 114.1694, country: 'HK' },
  'moscow':           { lat: 55.7558, lng: 37.6173, country: 'RU' },
  'saint petersburg': { lat: 59.9343, lng: 30.3351, country: 'RU' },
  'kyiv':             { lat: 50.4501, lng: 30.5234, country: 'UA' },
  'kiev':             { lat: 50.4501, lng: 30.5234, country: 'UA' },
  'ukraine':          { lat: 48.3794, lng: 31.1656, country: 'UA' },
  'kherson':          { lat: 46.6354, lng: 32.6169, country: 'UA' },
  'zaporizhzhia':     { lat: 47.8388, lng: 35.1396, country: 'UA' },
  'washington':       { lat: 38.9072, lng: -77.0369, country: 'US', region: 'DC' },
  'new york':         { lat: 40.7128, lng: -74.0060, country: 'US', region: 'New York' },
  'los angeles':      { lat: 34.0522, lng: -118.2437, country: 'US', region: 'California' },
  'chicago':          { lat: 41.8781, lng: -87.6298, country: 'US', region: 'Illinois' },
  'miami':            { lat: 25.7617, lng: -80.1918, country: 'US', region: 'Florida' },
  'houston':          { lat: 29.7604, lng: -95.3698, country: 'US', region: 'Texas' },
  'london':           { lat: 51.5074, lng: -0.1278, country: 'GB', region: 'England' },
  'manchester':       { lat: 53.4808, lng: -2.2426, country: 'GB', region: 'England' },
  'paris':            { lat: 48.8566, lng: 2.3522, country: 'FR' },
  'marseille':        { lat: 43.2965, lng: 5.3698, country: 'FR' },
  'berlin':           { lat: 52.5200, lng: 13.4050, country: 'DE' },
  'munich':           { lat: 48.1351, lng: 11.5820, country: 'DE' },
  'frankfurt':        { lat: 50.1109, lng: 8.6821, country: 'DE' },
  'brussels':         { lat: 50.8503, lng: 4.3517, country: 'BE' },
  'amsterdam':        { lat: 52.3676, lng: 4.9041, country: 'NL' },
  'rome':             { lat: 41.9028, lng: 12.4964, country: 'IT' },
  'milan':            { lat: 45.4642, lng: 9.1900, country: 'IT' },
  'madrid':           { lat: 40.4168, lng: -3.7038, country: 'ES' },
  'barcelona':        { lat: 41.3851, lng: 2.1734, country: 'ES' },
  'lisbon':           { lat: 38.7223, lng: -9.1393, country: 'PT' },
  'vienna':           { lat: 48.2082, lng: 16.3738, country: 'AT' },
  'warsaw':           { lat: 52.2297, lng: 21.0122, country: 'PL' },
  'stockholm':        { lat: 59.3293, lng: 18.0686, country: 'SE' },
  'oslo':             { lat: 59.9139, lng: 10.7522, country: 'NO' },
  'copenhagen':       { lat: 55.6761, lng: 12.5683, country: 'DK' },
  'helsinki':         { lat: 60.1699, lng: 24.9384, country: 'FI' },
  'istanbul':         { lat: 41.0082, lng: 28.9784, country: 'TR' },
  'ankara':           { lat: 39.9334, lng: 32.8597, country: 'TR' },
  'tehran':           { lat: 35.6892, lng: 51.3890, country: 'IR' },
  'riyadh':           { lat: 24.7136, lng: 46.6753, country: 'SA' },
  'dubai':            { lat: 25.2048, lng: 55.2708, country: 'AE' },
  'abu dhabi':        { lat: 24.4539, lng: 54.3773, country: 'AE' },
  'tel aviv':         { lat: 32.0853, lng: 34.7818, country: 'IL' },
  'jerusalem':        { lat: 31.7683, lng: 35.2137, country: 'IL' },
  'gaza':             { lat: 31.5017, lng: 34.4668, country: 'PS' },
  'west bank':        { lat: 31.9522, lng: 35.2332, country: 'PS' },
  'beirut':           { lat: 33.8938, lng: 35.5018, country: 'LB' },
  'amman':            { lat: 31.9454, lng: 35.9284, country: 'JO' },
  'nairobi':          { lat: -1.2921, lng: 36.8219, country: 'KE' },
  'cairo':            { lat: 30.0444, lng: 31.2357, country: 'EG' },
  'alexandria':       { lat: 31.2001, lng: 29.9187, country: 'EG' },
  'johannesburg':     { lat: -26.2041, lng: 28.0473, country: 'ZA' },
  'cape town':        { lat: -33.9249, lng: 18.4241, country: 'ZA' },
  'lagos':            { lat: 6.5244, lng: 3.3792, country: 'NG' },
  'abuja':            { lat: 9.0579, lng: 7.4951, country: 'NG' },
  'accra':            { lat: 5.6037, lng: -0.1870, country: 'GH' },
  'addis ababa':      { lat: 9.0320, lng: 38.7469, country: 'ET' },
  'kinshasa':         { lat: -4.3317, lng: 15.3222, country: 'CD' },
  'dakar':            { lat: 14.7167, lng: -17.4677, country: 'SN' },
  'mumbai':           { lat: 19.0760, lng: 72.8777, country: 'IN', region: 'Maharashtra' },
  'new delhi':        { lat: 28.6139, lng: 77.2090, country: 'IN' },
  'delhi':            { lat: 28.7041, lng: 77.1025, country: 'IN' },
  'bangalore':        { lat: 12.9716, lng: 77.5946, country: 'IN' },
  'kolkata':          { lat: 22.5726, lng: 88.3639, country: 'IN' },
  'chennai':          { lat: 13.0827, lng: 80.2707, country: 'IN' },
  'karachi':          { lat: 24.8607, lng: 67.0011, country: 'PK' },
  'islamabad':        { lat: 33.6844, lng: 73.0479, country: 'PK' },
  'lahore':           { lat: 31.5204, lng: 74.3587, country: 'PK' },
  'dhaka':            { lat: 23.8103, lng: 90.4125, country: 'BD' },
  'colombo':          { lat: 6.9271, lng: 79.8612, country: 'LK' },
  'bangkok':          { lat: 13.7563, lng: 100.5018, country: 'TH' },
  'jakarta':          { lat: -6.2088, lng: 106.8456, country: 'ID' },
  'hanoi':            { lat: 21.0285, lng: 105.8542, country: 'VN' },
  'ho chi minh city': { lat: 10.8231, lng: 106.6297, country: 'VN' },
  'kuala lumpur':     { lat: 3.1390, lng: 101.6869, country: 'MY' },
  'singapore':        { lat: 1.3521, lng: 103.8198, country: 'SG' },
  'pyongyang':        { lat: 39.0392, lng: 125.7625, country: 'KP' },
  'seoul':            { lat: 37.5665, lng: 126.9780, country: 'KR', region: 'Seoul Capital Area' },
  'kabul':            { lat: 34.5553, lng: 69.2075, country: 'AF' },
  'baghdad':          { lat: 33.3152, lng: 44.3661, country: 'IQ' },
  'mosul':            { lat: 36.3350, lng: 43.1189, country: 'IQ' },
  'damascus':         { lat: 33.5138, lng: 36.2765, country: 'SY' },
  'aleppo':           { lat: 36.2021, lng: 37.1343, country: 'SY' },
  'tripoli':          { lat: 32.8872, lng: 13.1913, country: 'LY' },
  'khartoum':         { lat: 15.5007, lng: 32.5599, country: 'SD' },
  'mogadishu':        { lat: 2.0469, lng: 45.3182, country: 'SO' },
  'kyoto':            { lat: 35.0116, lng: 135.7681, country: 'JP' },
  'sydney':           { lat: -33.8688, lng: 151.2093, country: 'AU' },
  'melbourne':        { lat: -37.8136, lng: 144.9631, country: 'AU' },
  'toronto':          { lat: 43.6510, lng: -79.3470, country: 'CA' },
  'montreal':         { lat: 45.5017, lng: -73.5673, country: 'CA' },
  'vancouver':        { lat: 49.2827, lng: -123.1207, country: 'CA' },
  'mexico city':      { lat: 19.4326, lng: -99.1332, country: 'MX' },
  'sao paulo':        { lat: -23.5505, lng: -46.6333, country: 'BR' },
  'rio de janeiro':   { lat: -22.9068, lng: -43.1729, country: 'BR' },
  'buenos aires':     { lat: -34.6037, lng: -58.3816, country: 'AR' },
  'bogota':           { lat: 4.7110, lng: -74.0721, country: 'CO' },
  'lima':             { lat: -12.0464, lng: -77.0428, country: 'PE' },
  'santiago':         { lat: -33.4489, lng: -70.6693, country: 'CL' },
  'arctic':           { lat: 90.0000, lng: 0.0000, country: 'INT', region: 'Arctic' },
  'antarctic':        { lat: -90.0000, lng: 0.0000, country: 'INT', region: 'Antarctic' },
}

// ─── NER PATTERNS ────────────────────────────────────────────────────────────
// Ordered from most-specific to least-specific
const LOCATION_PATTERNS: RegExp[] = [
  // "in [City], [Country]" — most reliable
  /\bin ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/,
  // "from [City]" / "near [City]"
  /\b(?:from|near|outside|inside|in)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/,
  // "[City], [Country Code]"  e.g. "Kyiv, UA"
  /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z]{2})\b/,
  // Standalone proper noun that may be a city (5+ chars, Title Case)
  /\b([A-Z][a-z]{4,}(?:\s[A-Z][a-z]+)?)\b/,
]

function extractCandidateLocations(text: string): string[] {
  const candidates = new Set<string>()

  for (const pattern of LOCATION_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern.source, 'g'))
    for (const m of matches) {
      // m[1] is always the primary candidate; m[2] optional secondary
      if (m[1]) candidates.add(m[1].trim().toLowerCase())
      if (m[2] && m[2].length > 2) candidates.add(m[2].trim().toLowerCase())
    }
  }

  return [...candidates]
}

// ─── COUNTRY CODE PATTERNS ───────────────────────────────────────────────────
const COUNTRY_PATTERNS: [RegExp, string][] = [
  [/\bunited states|usa|u\.s\.a?\.?\b/i, 'US'],
  [/\bunited kingdom|britain|england|scotland|wales\b/i, 'GB'],
  [/\bchina|chinese\b/i, 'CN'],
  [/\brussia|russian federation\b/i, 'RU'],
  [/\bfrance|french\b/i, 'FR'],
  [/\bgermany|german\b/i, 'DE'],
  [/\bjapan|japanese\b/i, 'JP'],
  [/\bindia|indian\b/i, 'IN'],
  [/\bbrazil|brazilian\b/i, 'BR'],
  [/\bcanada|canadian\b/i, 'CA'],
  [/\baustralia|australian\b/i, 'AU'],
  [/\bisrael|israeli\b/i, 'IL'],
  [/\biran|iranian\b/i, 'IR'],
  [/\bnorth korea|dprk\b/i, 'KP'],
  [/\bsouth korea|south korean\b/i, 'KR'],
  [/\bpakistan|pakistani\b/i, 'PK'],
  [/\bafghanistan|afghan\b/i, 'AF'],
  [/\bsyria|syrian\b/i, 'SY'],
  [/\biraq|iraqi\b/i, 'IQ'],
  [/\bsaudi arabia|saudi\b/i, 'SA'],
  [/\bturkey|turkish\b/i, 'TR'],
  [/\bukraine|ukrainian\b/i, 'UA'],
  [/\bmexico|mexican\b/i, 'MX'],
  [/\bargentina|argentine\b/i, 'AR'],
  [/\bcolumbia|colombian\b/i, 'CO'],
  [/\bnigeria|nigerian\b/i, 'NG'],
  [/\bsouth africa|south african\b/i, 'ZA'],
  [/\bkenya|kenyan\b/i, 'KE'],
  [/\bethiopia|ethiopian\b/i, 'ET'],
  [/\bindonesia|indonesian\b/i, 'ID'],
  [/\bphilippines|philippine|filipino\b/i, 'PH'],
  [/\bvietnam|vietnamese\b/i, 'VN'],
  [/\bthailand|thai\b/i, 'TH'],
  [/\bmalaysia|malaysian\b/i, 'MY'],
]

// ─── NOMINATIM LOOKUP ────────────────────────────────────────────────────────
interface NominatimResult {
  lat:        string
  lon:        string
  display_name: string
  address?: {
    country_code?: string
    state?:        string
    county?:       string
  }
}

async function nominatimLookup(location: string): Promise<GeoResult | null> {
  // Check Redis cache first (24h TTL for Nominatim results)
  const cacheKey = `nominatim:${location.toLowerCase().replace(/\s+/g, '_')}`
  const cached   = await redis.get(cacheKey)
  if (cached) {
    return cached === 'null' ? null : JSON.parse(cached) as GeoResult
  }

  await throttleNominatim()

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WorldPulse/1.0 (world-pulse.io)' },
      signal:  AbortSignal.timeout(5_000),
    })

    if (!res.ok) {
      logger.warn({ status: res.status, location }, 'Nominatim request failed')
      await redis.setex(cacheKey, 3600, 'null')
      return null
    }

    const data = await res.json() as NominatimResult[]
    if (!data.length) {
      await redis.setex(cacheKey, 86_400, 'null')
      return null
    }

    const hit = data[0]
    const result: GeoResult = {
      point:       true,
      lat:         parseFloat(hit.lat),
      lng:         parseFloat(hit.lon),
      name:        location,
      countryCode: hit.address?.country_code?.toUpperCase(),
      region:      hit.address?.state ?? hit.address?.county,
    }

    await redis.setex(cacheKey, 86_400, JSON.stringify(result))
    logger.debug({ location, lat: result.lat, lng: result.lng }, 'Nominatim geocoded')
    return result
  } catch (err) {
    logger.warn({ err, location }, 'Nominatim lookup error')
    await redis.setex(cacheKey, 3600, 'null')
    return null
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export async function extractGeo(text: string): Promise<GeoResult> {
  const lower = text.toLowerCase()

  // Cache by text fingerprint (1h TTL)
  const cacheKey = `geo:${hashText(lower)}`
  const cached   = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as GeoResult

  // 1. Find matches in gazetteer (longest match first = most specific)
  const entries = Object.entries(GAZETTEER).sort((a, b) => b[0].length - a[0].length)
  for (const [place, coords] of entries) {
    if (lower.includes(place)) {
      const result: GeoResult = {
        point:       true,
        lat:         coords.lat,
        lng:         coords.lng,
        name:        titleCase(place),
        countryCode: coords.country,
        region:      coords.region,
      }
      await redis.setex(cacheKey, 3600, JSON.stringify(result))
      return result
    }
  }

  // 2. NER extraction → Nominatim fallback
  const candidates = extractCandidateLocations(text)
  for (const candidate of candidates) {
    // Skip very common English words that match Title Case regex
    if (COMMON_WORDS.has(candidate)) continue
    const geo = await nominatimLookup(candidate)
    if (geo) {
      await redis.setex(cacheKey, 3600, JSON.stringify(geo))
      return geo
    }
  }

  // 3. Country code detection from country names
  for (const [pattern, code] of COUNTRY_PATTERNS) {
    if (pattern.test(text)) {
      const result: GeoResult = { point: false, countryCode: code }
      await redis.setex(cacheKey, 3600, JSON.stringify(result))
      return result
    }
  }

  const result: GeoResult = { point: false }
  await redis.setex(cacheKey, 3600, JSON.stringify(result))
  return result
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function titleCase(s: string): string {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function hashText(text: string): string {
  let hash = 0
  for (let i = 0; i < Math.min(text.length, 200); i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

// Common English words that look like proper nouns but aren't city names
const COMMON_WORDS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'breaking', 'update', 'report', 'source', 'official', 'minister',
  'president', 'prime', 'police', 'government', 'military', 'forces',
  'united', 'national', 'international', 'world', 'global', 'local',
  'north', 'south', 'east', 'west', 'central',
])
