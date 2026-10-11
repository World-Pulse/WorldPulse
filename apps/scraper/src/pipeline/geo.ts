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
import { MORE_COUNTRIES, ABBREVIATED_COUNTRIES, US_STATES, countryNameOf } from './world-countries'

export interface GeoResult {
  point:        boolean
  lat?:         number
  lng?:         number
  name?:        string
  countryCode?: string
  region?:      string
}

// ─── RATE LIMITER (Nominatim allows 1 request a second) ─────────────────────
// Each caller books the next free slot before it waits, so callers arriving
// together go one per slot. The old check only noted the time after waiting:
// callers arriving together (news feeds, GDELT, the scrape loop, the startup
// pin repair) all waited the same remainder and then fired at once, and on
// Oct 11, 2026 Nominatim began refusing requests.
export const NOMINATIM_GAP_MS = 1_100
let nextNominatimSlot = 0

export async function throttleNominatim(gapMs = NOMINATIM_GAP_MS): Promise<void> {
  const now = Date.now()
  const start = Math.max(now, nextNominatimSlot)
  nextNominatimSlot = start + gapMs
  if (start > now) await new Promise(r => setTimeout(r, start - now))
}

/** After a refusal (429, 403) or server error, no requests for this long */
const NOMINATIM_COOLDOWN_S = 15 * 60
const COOLDOWN_KEY = 'nominatim:cooldown'

async function nominatimCoolingDown(): Promise<boolean> {
  try { return (await redis.get(COOLDOWN_KEY)) !== null } catch { return false }
}

async function startNominatimCooldown(status: number): Promise<void> {
  logger.warn({ status, minutes: NOMINATIM_COOLDOWN_S / 60 }, 'Nominatim refused requests; pausing geocoder lookups')
  try { await redis.setex(COOLDOWN_KEY, NOMINATIM_COOLDOWN_S, String(status)) } catch { /* best effort */ }
}

// ─── GAZETTEER (fast-path; ~140 locations) ───────────────────────────────────
const GAZETTEER: Record<string, { lat: number; lng: number; country: string; region?: string; name?: string }> = {
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
  'kiev':             { lat: 50.4501, lng: 30.5234, country: 'UA', name: 'Kyiv' },
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
  // Places often in the news whose names the geocoder gets wrong or misses:
  // its first answer for "Rafah" is a Syrian village, for "Darfur" a US
  // village, for "Donbas" a road in North Macedonia, for "Dnipro" the river.
  'rafah':            { lat: 31.2969, lng: 34.2455, country: 'PS' },
  'khan younis':      { lat: 31.3462, lng: 34.3060, country: 'PS' },
  'jenin':            { lat: 32.4610, lng: 35.3027, country: 'PS' },
  'nablus':           { lat: 32.2211, lng: 35.2544, country: 'PS' },
  'ramallah':         { lat: 31.9038, lng: 35.2034, country: 'PS' },
  'hebron':           { lat: 31.5326, lng: 35.0998, country: 'PS' },
  'darfur':           { lat: 13.0000, lng: 24.5000, country: 'SD', region: 'Darfur' },
  'el fasher':        { lat: 13.6290, lng: 25.3494, country: 'SD', region: 'Darfur' },
  'el-fasher':        { lat: 13.6290, lng: 25.3494, country: 'SD', region: 'Darfur', name: 'El Fasher' },
  'port sudan':       { lat: 19.6158, lng: 37.2164, country: 'SD' },
  'kharkiv':          { lat: 49.9935, lng: 36.2304, country: 'UA' },
  'odesa':            { lat: 46.4825, lng: 30.7233, country: 'UA' },
  'lviv':             { lat: 49.8397, lng: 24.0297, country: 'UA' },
  'dnipro':           { lat: 48.4647, lng: 35.0462, country: 'UA' },
  'bakhmut':          { lat: 48.5947, lng: 38.0004, country: 'UA' },
  'pokrovsk':         { lat: 48.2829, lng: 37.1810, country: 'UA' },
  'donetsk':          { lat: 48.0159, lng: 37.8028, country: 'UA' },
  'luhansk':          { lat: 48.5740, lng: 39.3078, country: 'UA' },
  'donbas':           { lat: 48.3000, lng: 38.3000, country: 'UA', region: 'Donbas' },
  'donbass':          { lat: 48.3000, lng: 38.3000, country: 'UA', region: 'Donbas', name: 'Donbas' },
  'crimea':           { lat: 45.0000, lng: 34.1000, country: 'UA', region: 'Crimea' },
  'sevastopol':       { lat: 44.6166, lng: 33.5254, country: 'UA', region: 'Crimea' },
  'belgorod':         { lat: 50.5997, lng: 36.5983, country: 'RU' },
  'kursk':            { lat: 51.7304, lng: 36.1926, country: 'RU' },
  'idlib':            { lat: 35.9306, lng: 36.6339, country: 'SY' },
  'homs':             { lat: 34.7324, lng: 36.7137, country: 'SY' },
  'latakia':          { lat: 35.5317, lng: 35.7901, country: 'SY' },
  'raqqa':            { lat: 35.9594, lng: 39.0079, country: 'SY' },
  'sanaa':            { lat: 15.3694, lng: 44.1910, country: 'YE' },
  "sana'a":           { lat: 15.3694, lng: 44.1910, country: 'YE', name: 'Sanaa' },
  'hodeidah':         { lat: 14.7978, lng: 42.9545, country: 'YE' },
  'erbil':            { lat: 36.1911, lng: 44.0092, country: 'IQ' },
  'basra':            { lat: 30.5085, lng: 47.7804, country: 'IQ' },
  'kirkuk':           { lat: 35.4681, lng: 44.3922, country: 'IQ' },
  'bukavu':           { lat: -2.5083, lng: 28.8608, country: 'CD' },
  'kampala':          { lat: 0.3476,  lng: 32.5825, country: 'UG' },
  'kigali':           { lat: -1.9441, lng: 30.0619, country: 'RW' },
  'maiduguri':        { lat: 11.8333, lng: 13.1500, country: 'NG' },
  'bamako':           { lat: 12.6392, lng: -8.0029, country: 'ML' },
  'niamey':           { lat: 13.5116, lng: 2.1254,  country: 'NE' },
  'ouagadougou':      { lat: 12.3714, lng: -1.5197, country: 'BF' },
  "n'djamena":        { lat: 12.1348, lng: 15.0557, country: 'TD', name: "N'Djamena" },
  'tigray':           { lat: 14.0323, lng: 38.3166, country: 'ET', region: 'Tigray' },
  'mekelle':          { lat: 13.4967, lng: 39.4753, country: 'ET', region: 'Tigray' },
  'benghazi':         { lat: 32.1167, lng: 20.0667, country: 'LY' },
  'misrata':          { lat: 32.3754, lng: 15.0925, country: 'LY' },
  'srinagar':         { lat: 34.0837, lng: 74.7973, country: 'IN' },
  'quetta':           { lat: 30.1798, lng: 66.9750, country: 'PK' },
  'peshawar':         { lat: 34.0151, lng: 71.5249, country: 'PK' },
  'herat':            { lat: 34.3529, lng: 62.2040, country: 'AF' },
  'kandahar':         { lat: 31.6289, lng: 65.7372, country: 'AF' },
  'yangon':           { lat: 16.8409, lng: 96.1735, country: 'MM' },
  'naypyidaw':        { lat: 19.7633, lng: 96.0785, country: 'MM' },
  'taipei':           { lat: 25.0330, lng: 121.5654, country: 'TW' },
  'caracas':          { lat: 10.4806, lng: -66.9036, country: 'VE' },
  'havana':           { lat: 23.1136, lng: -82.3666, country: 'CU' },
  'port-au-prince':   { lat: 18.5944, lng: -72.3074, country: 'HT', name: 'Port-au-Prince' },
  'tbilisi':          { lat: 41.7151, lng: 44.8271, country: 'GE' },
  'yerevan':          { lat: 40.1792, lng: 44.4991, country: 'AM' },
  'baku':             { lat: 40.4093, lng: 49.8671, country: 'AZ' },
  'minsk':            { lat: 53.9006, lng: 27.5590, country: 'BY' },
  'chisinau':         { lat: 47.0105, lng: 28.8638, country: 'MD' },
  'belgrade':         { lat: 44.7866, lng: 20.4489, country: 'RS' },
  'culiacan':         { lat: 24.8091, lng: -107.3940, country: 'MX', region: 'Sinaloa' },
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

// ─── COUNTRY CENTROIDS (capital / geographic center) ─────────────────────────
const COUNTRY_CENTROIDS: Record<string, { lat: number; lng: number; name: string }> = {
  US: { lat: 38.9072, lng: -77.0369, name: 'Washington DC' },
  GB: { lat: 51.5074, lng: -0.1278,  name: 'London' },
  DE: { lat: 52.5200, lng: 13.4050,  name: 'Berlin' },
  FR: { lat: 48.8566, lng: 2.3522,   name: 'Paris' },
  CN: { lat: 39.9042, lng: 116.4074, name: 'Beijing' },
  RU: { lat: 55.7558, lng: 37.6173,  name: 'Moscow' },
  JP: { lat: 35.6762, lng: 139.6503, name: 'Tokyo' },
  IN: { lat: 28.6139, lng: 77.2090,  name: 'New Delhi' },
  BR: { lat: -15.7975, lng: -47.8919, name: 'Brasília' },
  CA: { lat: 45.4215, lng: -75.6972, name: 'Ottawa' },
  AU: { lat: -35.2809, lng: 149.1300, name: 'Canberra' },
  IL: { lat: 31.7683, lng: 35.2137,  name: 'Jerusalem' },
  IR: { lat: 35.6892, lng: 51.3890,  name: 'Tehran' },
  KP: { lat: 39.0392, lng: 125.7625, name: 'Pyongyang' },
  KR: { lat: 37.5665, lng: 126.9780, name: 'Seoul' },
  PK: { lat: 33.6844, lng: 73.0479,  name: 'Islamabad' },
  AF: { lat: 34.5553, lng: 69.2075,  name: 'Kabul' },
  SY: { lat: 33.5138, lng: 36.2765,  name: 'Damascus' },
  IQ: { lat: 33.3152, lng: 44.3661,  name: 'Baghdad' },
  SA: { lat: 24.7136, lng: 46.6753,  name: 'Riyadh' },
  TR: { lat: 39.9334, lng: 32.8597,  name: 'Ankara' },
  UA: { lat: 50.4501, lng: 30.5234,  name: 'Kyiv' },
  MX: { lat: 19.4326, lng: -99.1332, name: 'Mexico City' },
  AR: { lat: -34.6037, lng: -58.3816, name: 'Buenos Aires' },
  CO: { lat: 4.7110,  lng: -74.0721, name: 'Bogotá' },
  NG: { lat: 9.0579,  lng: 7.4951,   name: 'Abuja' },
  ZA: { lat: -25.7479, lng: 28.2293, name: 'Pretoria' },
  KE: { lat: -1.2921, lng: 36.8219,  name: 'Nairobi' },
  ET: { lat: 9.0320,  lng: 38.7469,  name: 'Addis Ababa' },
  ID: { lat: -6.2088, lng: 106.8456, name: 'Jakarta' },
  PH: { lat: 14.5995, lng: 120.9842, name: 'Manila' },
  VN: { lat: 21.0285, lng: 105.8542, name: 'Hanoi' },
  TH: { lat: 13.7563, lng: 100.5018, name: 'Bangkok' },
  MY: { lat: 3.1390,  lng: 101.6869, name: 'Kuala Lumpur' },
  BD: { lat: 23.8103, lng: 90.4125,  name: 'Dhaka' },
  EG: { lat: 30.0444, lng: 31.2357,  name: 'Cairo' },
  SD: { lat: 15.5007, lng: 32.5599,  name: 'Khartoum' },
  LY: { lat: 32.8872, lng: 13.1913,  name: 'Tripoli' },
  SO: { lat: 2.0469,  lng: 45.3182,  name: 'Mogadishu' },
  PS: { lat: 31.5017, lng: 34.4668,  name: 'Gaza' },
  LB: { lat: 33.8938, lng: 35.5018,  name: 'Beirut' },
  AE: { lat: 25.2048, lng: 55.2708,  name: 'Dubai' },
  BE: { lat: 50.8503, lng: 4.3517,   name: 'Brussels' },
  NL: { lat: 52.3676, lng: 4.9041,   name: 'Amsterdam' },
  IT: { lat: 41.9028, lng: 12.4964,  name: 'Rome' },
  ES: { lat: 40.4168, lng: -3.7038,  name: 'Madrid' },
  PL: { lat: 52.2297, lng: 21.0122,  name: 'Warsaw' },
  SE: { lat: 59.3293, lng: 18.0686,  name: 'Stockholm' },
  NO: { lat: 59.9139, lng: 10.7522,  name: 'Oslo' },
  DK: { lat: 55.6761, lng: 12.5683,  name: 'Copenhagen' },
  FI: { lat: 60.1699, lng: 24.9384,  name: 'Helsinki' },
  AT: { lat: 48.2082, lng: 16.3738,  name: 'Vienna' },
  PT: { lat: 38.7223, lng: -9.1393,  name: 'Lisbon' },
  CZ: { lat: 50.0755, lng: 14.4378,  name: 'Prague' },
  HU: { lat: 47.4979, lng: 19.0402,  name: 'Budapest' },
}
// Every other country (world-countries.ts); the capitals above stay as they are
for (const entry of MORE_COUNTRIES) COUNTRY_CENTROIDS[entry.code] ??= { lat: entry.lat, lng: entry.lng, name: entry.capital }

// ─── COUNTRY CODE PATTERNS ───────────────────────────────────────────────────
const COUNTRY_PATTERNS: [RegExp, string][] = [
  // Each alternation is grouped and bounded: /\bindia|indian\b/ used to match
  // "Indiana", and "usa" matched inside "accusation" and "causal" (pinning
  // stories to Washington DC). "Colombia" was misspelled "columbia", so
  // British Columbia and Columbia University counted as Colombia.
  [/\b(?:united states|usa|u\.s\.a?\.?)(?!\w)/i, 'US'],
  [/\b(?:united kingdom|britain|(?<!new )england|scotland|(?<!new south )wales)\b/i, 'GB'],
  [/\b(?:china|chinese)\b/i, 'CN'],
  [/\b(?:russia|russian federation)\b/i, 'RU'],
  [/\b(?:france|french)\b/i, 'FR'],
  [/\b(?:germany|german)\b/i, 'DE'],
  [/\b(?:japan|japanese)\b/i, 'JP'],
  [/\b(?:india|indian)\b/i, 'IN'],
  [/\b(?:brazil|brazilian)\b/i, 'BR'],
  [/\b(?:canada|canadian)\b/i, 'CA'],
  [/\b(?:australia|australian)\b/i, 'AU'],
  [/\b(?:israel|israeli)\b/i, 'IL'],
  [/\b(?:iran|iranian)\b/i, 'IR'],
  [/\b(?:north korea|north korean|dprk)\b/i, 'KP'],
  [/\b(?:south korea|south korean)\b/i, 'KR'],
  [/\b(?:pakistan|pakistani)\b/i, 'PK'],
  [/\b(?:afghanistan|afghan)\b/i, 'AF'],
  [/\b(?:syria|syrian)\b/i, 'SY'],
  [/\b(?:iraq|iraqi)\b/i, 'IQ'],
  [/\b(?:saudi arabia|saudi)\b/i, 'SA'],
  [/\b(?:turkey|turkish|t[uü]rkiye)\b/i, 'TR'],
  [/\b(?:ukraine|ukrainian)\b/i, 'UA'],
  [/\b(?:(?<!new )mexico|mexican)\b/i, 'MX'],
  [/\b(?:argentina|argentine|argentinian)\b/i, 'AR'],
  [/\b(?:colombia|colombian)\b/i, 'CO'],
  [/\b(?:nigeria|nigerian)\b/i, 'NG'],
  [/\b(?:south africa|south african)\b/i, 'ZA'],
  [/\b(?:kenya|kenyan)\b/i, 'KE'],
  [/\b(?:ethiopia|ethiopian)\b/i, 'ET'],
  [/\b(?:indonesia|indonesian)\b/i, 'ID'],
  [/\b(?:philippines|philippine|filipino)\b/i, 'PH'],
  [/\b(?:vietnam|vietnamese)\b/i, 'VN'],
  [/\b(?:thailand|thai)\b/i, 'TH'],
  [/\b(?:malaysia|malaysian)\b/i, 'MY'],
  // …and every other country (world-countries.ts: "Panama", "Vanuatu", "Slovenia" named no country before Oct 11, 2026)
  ...MORE_COUNTRIES.map((entry): [RegExp, string] => [entry.pattern, entry.code]),
  ...ABBREVIATED_COUNTRIES,
]

/**
 * The patterns with plural people-words too ("Afghans", "Israelis",
 * "Ukrainians" named no country). Not for Turkey ("turkeys"), Chile ("chiles")
 * or Guinea ("the 2,000 Guineas").
 */
const NO_PLURAL = new Set(['TR', 'CL', 'GN'])
const COUNTRY_MATCHERS: [RegExp, string][] = COUNTRY_PATTERNS.map(([pattern, code]) =>
  NO_PLURAL.has(code) || !pattern.source.endsWith(')\\b')
    ? [pattern, code]
    : [new RegExp(`${pattern.source.slice(0, -2)}s?\\b`, pattern.flags), code])

/** Countries the text names, in order of first mention (the headline comes first) */
export function mentionedCountries(text: string): string[] {
  const hits: Array<{ code: string; index: number }> = []
  for (const [pattern, code] of COUNTRY_MATCHERS) {
    const m = pattern.exec(text)
    if (m) hits.push({ code, index: m.index })
  }
  return [...new Set(hits.sort((a, b) => a.index - b.index).map(h => h.code))]
}

// ─── NOMINATIM LOOKUP ────────────────────────────────────────────────────────
export interface NominatimResult {
  lat:          string
  lon:          string
  display_name: string
  /** The place's name (in English, as requested) */
  name?:        string
  /** What kind of place it is: city, town, village, state, country, road, shop… */
  addresstype?: string
  /** 0–1, from how much Wikipedia links to it */
  importance?:  number
  /** Every name the place has (namedetails=1): alt_name, official_name, … */
  namedetails?: Record<string, string>
  address?: {
    country_code?: string
    state?:        string
    county?:       string
  }
}

/**
 * The kinds of place a geocoder answer may be, with the importance each needs.
 * The geocoder has an answer for almost any word, so before Oct 11, 2026 any
 * capitalised word became a map pin: "Trump" (a US hamlet), "Gravel" (a
 * French hamlet), "Nishiyama" (a railway station), "Anthropic" (housing in
 * Afghanistan), "Energy" (a village in Illinois). Only notable cities,
 * regions and countries are taken now; villages, hamlets, roads, shops and
 * stations never are.
 */
const GEOCODER_PLACE_TYPES: Record<string, number> = {
  country: 0.45, state: 0.45, province: 0.45, region: 0.45, island: 0.45, archipelago: 0.45,
  peninsula: 0.5, state_district: 0.5,
  city: 0.4,
  town: 0.5,
  municipality: 0.55,   // "Police" is a municipality in Czechia (0.51)
}

/** The namedetails keys that hold a name people use for the place */
const NAME_KEYS = /^(?:name|name:en|int_name|alt_name|alt_name:en|official_name|official_name:en|short_name|short_name:en|loc_name)$/

/** Lowercase, accents and punctuation removed ("Port-au-Prince" → "port au prince") */
function normalizePlaceName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Whether a geocoder answer is a notable place called what the text said.
 * The name check catches answers the geocoder found under some other name
 * ("Meta" → Metz); a place's full name may add a word ("Kherson" → Kherson
 * Oblast, "Britain" → Great Britain).
 */
export function acceptGeocoderHit(candidate: string, hit: NominatimResult): boolean {
  const min = GEOCODER_PLACE_TYPES[hit.addresstype ?? '']
  if (min === undefined || (hit.importance ?? 0) < min) return false
  const wanted = normalizePlaceName(candidate)
  if (!wanted) return false
  const names = [
    hit.name ?? '',
    ...Object.entries(hit.namedetails ?? {}).filter(([key]) => NAME_KEYS.test(key)).flatMap(([, value]) => value.split(';')),
  ]
  return names.some(name => {
    const have = normalizePlaceName(name)
    return have !== '' && ` ${have} `.includes(` ${wanted} `)
  })
}

/**
 * Places the geocoder knows by this name that pass acceptGeocoderHit, best
 * first (at most 3; often none). Cached for a day. null when the geocoder
 * couldn't be asked (it refused, failed, or is in its cooldown): that is not
 * an answer, so nothing is cached and callers must not act on it.
 */
export async function geocodePlace(location: string): Promise<GeoResult[] | null> {
  // geocode2: failed lookups were cached as "nothing found" under geocode: (Oct 11, 2026)
  const cacheKey = `geocode2:${location.toLowerCase().replace(/\s+/g, '_')}`
  const cached   = await redis.get(cacheKey)
  if (cached) {
    try { return JSON.parse(cached) as GeoResult[] } catch { /* look it up again */ }
  }
  if (await nominatimCoolingDown()) return null

  await throttleNominatim()

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}`
      + '&format=json&limit=3&addressdetails=1&namedetails=1&accept-language=en'
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WorldPulse/1.0 (world-pulse.io)' },
      signal:  AbortSignal.timeout(5_000),
    })

    if (!res.ok) {
      logger.warn({ status: res.status, location }, 'Nominatim request failed')
      if (res.status === 429 || res.status === 403 || res.status >= 500) await startNominatimCooldown(res.status)
      return null
    }

    const data = await res.json() as NominatimResult[]
    const places: GeoResult[] = data
      .filter(hit => acceptGeocoderHit(location, hit))
      .map(hit => ({
        point:       true,
        lat:         parseFloat(hit.lat),
        lng:         parseFloat(hit.lon),
        name:        hit.name || titleCase(location),
        countryCode: hit.address?.country_code?.toUpperCase(),
        region:      hit.address?.state ?? hit.address?.county,
      }))
      .filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lng))

    await redis.setex(cacheKey, 86_400, JSON.stringify(places))
    if (data.length > 0 && places.length === 0) {
      logger.debug({ location, type: data[0].addresstype, importance: data[0].importance }, 'Nominatim: no notable place of that name')
    }
    return places
  } catch (err) {
    logger.warn({ err, location }, 'Nominatim lookup error')
    return null
  }
}

// ─── PLACE MATCHING ──────────────────────────────────────────────────────────
// Newspaper names mention a city without the story being about it ("the
// Washington Post reported..."), so they are blanked out before matching.
const OUTLET_NAMES = /\b(?:usa today|washington (?:post|times|examiner)|new york (?:times|post|daily news)|los angeles times|chicago tribune|miami herald|houston chronicle|jerusalem post|sydney morning herald|toronto star|london evening standard|manila times)\b/gi

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Gazetteer places as whole words, longest names first. Plain substring
 *  matching pinned "climate" stories to Lima, "comparison" to Paris and
 *  "promote" to Rome. */
// US states (world-countries.ts); a place already in the gazetteer keeps its entry
for (const [place, entry] of Object.entries(US_STATES)) GAZETTEER[place] ??= entry

const GAZETTEER_MATCHERS = Object.entries(GAZETTEER)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([place, coords]) => ({ place, coords, re: new RegExp(`\\b${escapeRegExp(place)}\\b`, 'i') }))

/** The gazetteer place mentioned first (the headline comes first); the longer name on a tie */
export function findGazetteerPlace(text: string): { place: string; coords: typeof GAZETTEER[string] } | null {
  const clean = text.replace(OUTLET_NAMES, ' ')
  let best: { place: string; coords: typeof GAZETTEER[string]; index: number } | null = null
  for (const m of GAZETTEER_MATCHERS) {
    const hit = m.re.exec(clean)
    if (hit && (!best || hit.index < best.index)) best = { place: m.place, coords: m.coords, index: hit.index }
  }
  return best ? { place: best.place, coords: best.coords } : null
}

/** At most this many geocoder lookups per text (each one waits about a second) */
const MAX_NOMINATIM_LOOKUPS = 4

/** The gazetteer place the text names first, as a map point */
function gazetteerPoint(text: string): GeoResult | null {
  const found = findGazetteerPlace(text.toLowerCase())
  return found
    ? {
        point:       true,
        lat:         found.coords.lat,
        lng:         found.coords.lng,
        name:        found.coords.name ?? titleCase(found.place),
        countryCode: found.coords.country,
        region:      found.coords.region,
      }
    : null
}

/**
 * The first named country, pinned at its capital (or without a pin if we have
 * no capital for it). It's named as the country ("Panama", not "Panama City"):
 * the story is about the country, not its capital.
 */
function countryPoint(countries: string[]): GeoResult {
  const code = countries[0]
  if (!code) return { point: false }
  const capital = COUNTRY_CENTROIDS[code]
  return capital
    ? { point: true, lat: capital.lat, lng: capital.lng, name: countryNameOf(code) ?? capital.name, countryCode: code }
    : { point: false, countryCode: code }
}

/**
 * A place for the text without asking the geocoder: a gazetteer place, else
 * the capital of the first country it names, else none.
 */
export function placeFromText(text: string): GeoResult {
  return gazetteerPoint(text) ?? countryPoint(mentionedCountries(text.replace(OUTLET_NAMES, ' ')))
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export async function extractGeo(text: string): Promise<GeoResult> {
  const lower = text.toLowerCase()

  // Cache by text fingerprint (1h TTL; geo2: since the Oct 11, 2026 geocoder rules)
  const cacheKey = `geo2:${hashText(lower)}`
  const cached   = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as GeoResult

  const remember = async (result: GeoResult): Promise<GeoResult> => {
    await redis.setex(cacheKey, 3600, JSON.stringify(result))
    return result
  }

  // 1. Gazetteer: whole words only, the place mentioned first
  const fromGazetteer = gazetteerPoint(lower)
  if (fromGazetteer) return remember(fromGazetteer)

  // 2. NER extraction → Nominatim fallback (notable places only, see
  //    acceptGeocoderHit). When the text names countries, the place must be
  //    in one of them (a Saudi airport was pinned in Romania by an ambiguous
  //    name).
  const countries = mentionedCountries(text.replace(OUTLET_NAMES, ' '))
  const candidates = extractCandidateLocations(text)
  let lookups = 0
  for (const candidate of candidates) {
    // Skip very common English words that match Title Case regex
    if (COMMON_WORDS.has(candidate)) continue
    if (lookups++ >= MAX_NOMINATIM_LOOKUPS) break
    const places = await geocodePlace(candidate)
    if (places === null) break   // the geocoder can't be asked right now
    const geo = countries.length > 0
      ? places.find(p => !p.countryCode || countries.includes(p.countryCode))
      : places[0]
    if (geo) return remember(geo)
  }

  // 3. Country detection → use the capital as the map point (the country
  //    mentioned first)
  return remember(countryPoint(countries))
}

// ─── REVERSE GEOCODING (lat/lng → location name) ────────────────────────────
// Used by FIRMS and other coordinate-based sources to generate human-readable
// location names instead of raw coordinates like "24.5°N, 94.5°E".

interface ReverseGeoResult {
  name:        string   // Human-readable location name
  countryCode: string | null
  region:      string | null
}

/**
 * Reverse-geocode coordinates into a human-readable place name.
 * Falls back to Nominatim with Redis caching (24h TTL).
 *
 * @returns e.g. { name: "Shan State, Myanmar", countryCode: "MM", region: "Shan State" }
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeoResult> {
  // Round to 1 decimal place for cache key (same ~10km grid as FIRMS)
  const roundLat = Math.round(lat * 10) / 10
  const roundLng = Math.round(lng * 10) / 10
  const cacheKey = `revgeo:${roundLat}:${roundLng}`

  const cached = await redis.get(cacheKey)
  if (cached && cached !== 'null') {
    return JSON.parse(cached) as ReverseGeoResult
  }

  // 1. Fast-path: check if coords are near any gazetteer city (within ~1°)
  for (const [place, coords] of Object.entries(GAZETTEER)) {
    const dLat = Math.abs(coords.lat - lat)
    const dLng = Math.abs(coords.lng - lng)
    if (dLat < 1.5 && dLng < 1.5) {
      const result: ReverseGeoResult = {
        name:        coords.region ? `${titleCase(place)}, ${coords.region}` : titleCase(place),
        countryCode: coords.country,
        region:      coords.region ?? null,
      }
      await redis.setex(cacheKey, 86_400, JSON.stringify(result))
      return result
    }
  }

  // 2. Nominatim reverse geocode (not while it's refusing requests)
  if (await nominatimCoolingDown()) return { name: `${roundLat}°N, ${roundLng}°E`, countryCode: null, region: null }
  await throttleNominatim()

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${roundLat}&lon=${roundLng}&format=json&zoom=8&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WorldPulse/1.0 (world-pulse.io)' },
      signal:  AbortSignal.timeout(5_000),
    })

    if (!res.ok) {
      logger.warn({ status: res.status, lat, lng }, 'Nominatim reverse request failed')
      if (res.status === 429 || res.status === 403 || res.status >= 500) await startNominatimCooldown(res.status)
      await redis.setex(cacheKey, 3600, 'null')
      return { name: `${roundLat}°N, ${roundLng}°E`, countryCode: null, region: null }
    }

    const data = await res.json() as {
      address?: {
        country_code?: string
        country?:      string
        state?:        string
        county?:       string
        city?:         string
        town?:         string
        village?:      string
      }
    }

    const addr = data.address
    if (!addr) {
      await redis.setex(cacheKey, 86_400, 'null')
      return { name: `${roundLat}°N, ${roundLng}°E`, countryCode: null, region: null }
    }

    // Build a readable name: "State/Region, Country" or "City, Country"
    const locality = addr.city ?? addr.town ?? addr.village ?? addr.county ?? addr.state ?? ''
    const region   = addr.state ?? addr.county ?? ''
    const country  = addr.country ?? ''
    const cc       = addr.country_code?.toUpperCase() ?? null

    let name: string
    if (locality && country && locality !== country) {
      name = region && region !== locality
        ? `${locality}, ${region}, ${country}`
        : `${locality}, ${country}`
    } else if (region && country) {
      name = `${region}, ${country}`
    } else {
      name = country || `${roundLat}°N, ${roundLng}°E`
    }

    const result: ReverseGeoResult = { name, countryCode: cc, region: region || null }
    await redis.setex(cacheKey, 86_400, JSON.stringify(result))
    logger.debug({ lat: roundLat, lng: roundLng, name }, 'Reverse geocoded')
    return result
  } catch (err) {
    logger.warn({ err, lat, lng }, 'Nominatim reverse lookup error')
    await redis.setex(cacheKey, 3600, 'null')
    return { name: `${roundLat}°N, ${roundLng}°E`, countryCode: null, region: null }
  }
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
