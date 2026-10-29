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

import { partOfAName } from './place-words'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { MORE_COUNTRIES, ABBREVIATED_COUNTRIES, US_STATES, countryNameOf } from './world-countries'
import { INTL_COUNTRY_NAMES } from './country-names-intl'

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
  // Jordan's other cities, Saudi Arabia's west coast, the northern emirates and France's regional cities:
  // stories about them were pinned at Amman, Riyadh, Dubai and Paris (Oct 24 read of the live points)
  'irbid':            { lat: 32.5556, lng: 35.8479, country: 'JO' },
  'zarqa':            { lat: 32.0728, lng: 36.0876, country: 'JO' },
  'aqaba':            { lat: 29.5321, lng: 35.0063, country: 'JO' },
  'jeddah':           { lat: 21.4858, lng: 39.1925, country: 'SA' },
  'taif':             { lat: 21.2703, lng: 40.4158, country: 'SA' },
  'yanbu':            { lat: 24.0895, lng: 38.0618, country: 'SA' },
  'sharjah':          { lat: 25.3463, lng: 55.4209, country: 'AE' },
  'ras al khaimah':   { lat: 25.7895, lng: 55.9432, country: 'AE' },
  'ras al-khaimah':   { lat: 25.7895, lng: 55.9432, country: 'AE' },
  'lyon':             { lat: 45.7640, lng: 4.8357, country: 'FR' },
  'toulouse':         { lat: 43.6047, lng: 1.4442, country: 'FR' },
  'lille':            { lat: 50.6292, lng: 3.0573, country: 'FR' },
  'bordeaux':         { lat: 44.8378, lng: -0.5792, country: 'FR' },
  'nantes':           { lat: 47.2184, lng: -1.5536, country: 'FR' },
  'strasbourg':       { lat: 48.5734, lng: 7.7521, country: 'FR' },
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
  'bengaluru':        { lat: 12.9716, lng: 77.5946, country: 'IN', name: 'Bangalore' },
  'kolkata':          { lat: 22.5726, lng: 88.3639, country: 'IN' },
  'chennai':          { lat: 13.0827, lng: 80.2707, country: 'IN' },
  'karachi':          { lat: 24.8607, lng: 67.0011, country: 'PK' },
  'port qasim':       { lat: 24.7783, lng: 67.3447, country: 'PK' },
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
  // "Somaliland" didn't match /\bsomali\b/, so 4 of Somaliland Standard's 10 items had no place (round 4, Oct 20, 2026);
  // pinned at Hargeisa, its capital, not Mogadishu, 850 km away
  'somaliland':       { lat: 9.5600, lng: 44.0650, country: 'SO', name: 'Somaliland' },
  'hargeisa':         { lat: 9.5600, lng: 44.0650, country: 'SO' },
  'moroni':           { lat: -11.7022, lng: 43.2551, country: 'KM' },
  'kyoto':            { lat: 35.0116, lng: 135.7681, country: 'JP' },
  'sydney':           { lat: -33.8688, lng: 151.2093, country: 'AU' },
  'melbourne':        { lat: -37.8136, lng: 144.9631, country: 'AU' },
  'brisbane':         { lat: -27.4698, lng: 153.0251, country: 'AU' },
  // Malaysian and New Zealand outlets' local stories were pinned at Kuala Lumpur and Wellington
  'auckland':         { lat: -36.8485, lng: 174.7633, country: 'NZ' },
  'christchurch':     { lat: -43.5321, lng: 172.6362, country: 'NZ' },
  'kuching':          { lat: 1.5535, lng: 110.3593, country: 'MY', region: 'Sarawak' },
  'sarawak':          { lat: 2.5000, lng: 112.5000, country: 'MY', region: 'Sarawak', name: 'Sarawak' },
  'sabah':            { lat: 5.9788, lng: 116.0753, country: 'MY', region: 'Sabah', name: 'Sabah' },
  'kota kinabalu':    { lat: 5.9804, lng: 116.0735, country: 'MY', region: 'Sabah' },
  'penang':           { lat: 5.4141, lng: 100.3288, country: 'MY', region: 'Penang' },
  'johor bahru':      { lat: 1.4927, lng: 103.7414, country: 'MY', region: 'Johor' },
  'melaka':           { lat: 2.1896, lng: 102.2501, country: 'MY', region: 'Melaka', name: 'Melaka' },
  'paya terubong':    { lat: 5.3500, lng: 100.2800, country: 'MY', region: 'Penang' },
  'bagan lalang':     { lat: 2.5842, lng: 101.6990, country: 'MY', region: 'Selangor' },
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
  'pavlohrad':        { lat: 48.5333, lng: 35.8667, country: 'UA' },
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
  'bashkortostan':    { lat: 54.2312, lng: 56.1646, country: 'RU', region: 'Bashkortostan' },
  'ufa':              { lat: 54.7388, lng: 55.9721, country: 'RU', region: 'Bashkortostan' },
  'tatarstan':        { lat: 55.1800, lng: 50.7264, country: 'RU', region: 'Tatarstan' },
  'kazan':            { lat: 55.7887, lng: 49.1221, country: 'RU', region: 'Tatarstan' },
  'yekaterinburg':    { lat: 56.8389, lng: 60.6057, country: 'RU' },
  'novosibirsk':      { lat: 55.0084, lng: 82.9357, country: 'RU' },
  'volgograd':        { lat: 48.7080, lng: 44.5133, country: 'RU' },
  'grozny':           { lat: 43.3178, lng: 45.6949, country: 'RU' },
  'cluj-napoca':      { lat: 46.7712, lng: 23.6236, country: 'RO', region: 'Cluj' },
  'oshkosh':          { lat: 44.0247, lng: -88.5426, country: 'US', region: 'Wisconsin' },
  'burlington':       { lat: 43.3255, lng: -79.7990, country: 'CA', region: 'Ontario' },
  'halton':           { lat: 43.4700, lng: -79.8800, country: 'CA', region: 'Ontario' },
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
  'taraba':           { lat: 8.8937,  lng: 11.3596, country: 'NG', region: 'Taraba', name: 'Taraba' },
  'jalingo':          { lat: 8.8937,  lng: 11.3596, country: 'NG', region: 'Taraba' },
  'kaduna':           { lat: 10.5105, lng: 7.4165,  country: 'NG' },
  'sokoto':           { lat: 13.0059, lng: 5.2476,  country: 'NG' },
  'bamako':           { lat: 12.6392, lng: -8.0029, country: 'ML' },
  'niamey':           { lat: 13.5116, lng: 2.1254,  country: 'NE' },
  'ouagadougou':      { lat: 12.3714, lng: -1.5197, country: 'BF' },
  "n'djamena":        { lat: 12.1348, lng: 15.0557, country: 'TD', name: "N'Djamena" },
  'tigray':           { lat: 14.0323, lng: 38.3166, country: 'ET', region: 'Tigray' },
  'mekelle':          { lat: 13.4967, lng: 39.4753, country: 'ET', region: 'Tigray' },
  'benghazi':         { lat: 32.1167, lng: 20.0667, country: 'LY' },
  'misrata':          { lat: 32.3754, lng: 15.0925, country: 'LY' },
  'srinagar':         { lat: 34.0837, lng: 74.7973, country: 'IN' },
  // India's states and bigger cities: its outlets' stories were pinned at the outlet's home city (Chennai)
  'pune':             { lat: 18.5204, lng: 73.8567, country: 'IN', region: 'Maharashtra' },
  'nagpur':           { lat: 21.1458, lng: 79.0882, country: 'IN', region: 'Maharashtra' },
  'ahmedabad':        { lat: 23.0225, lng: 72.5714, country: 'IN', region: 'Gujarat' },
  'lucknow':          { lat: 26.8467, lng: 80.9462, country: 'IN', region: 'Uttar Pradesh' },
  'varanasi':         { lat: 25.3176, lng: 82.9739, country: 'IN', region: 'Uttar Pradesh' },
  'patna':            { lat: 25.5941, lng: 85.1376, country: 'IN', region: 'Bihar' },
  'jaipur':           { lat: 26.9124, lng: 75.7873, country: 'IN', region: 'Rajasthan' },
  'bhopal':           { lat: 23.2599, lng: 77.4126, country: 'IN', region: 'Madhya Pradesh' },
  'indore':           { lat: 22.7196, lng: 75.8577, country: 'IN', region: 'Madhya Pradesh' },
  'guwahati':         { lat: 26.1445, lng: 91.7362, country: 'IN', region: 'Assam' },
  'chandigarh':       { lat: 30.7333, lng: 76.7794, country: 'IN' },
  'ranchi':           { lat: 23.3441, lng: 85.3096, country: 'IN', region: 'Jharkhand' },
  'bhubaneswar':      { lat: 20.2961, lng: 85.8245, country: 'IN', region: 'Odisha' },
  'thiruvananthapuram':{ lat: 8.5241, lng: 76.9366, country: 'IN', region: 'Kerala' },
  'visakhapatnam':    { lat: 17.6868, lng: 83.2185, country: 'IN', region: 'Andhra Pradesh' },
  'imphal':           { lat: 24.8170, lng: 93.9368, country: 'IN', region: 'Manipur' },
  'mysuru':           { lat: 12.2958, lng: 76.6394, country: 'IN', region: 'Karnataka' },
  'mangaluru':        { lat: 12.9141, lng: 74.8560, country: 'IN', region: 'Karnataka' },
  'jammu':            { lat: 32.7266, lng: 74.8570, country: 'IN' },
  'maharashtra':      { lat: 19.7515, lng: 75.7139, country: 'IN' },
  'karnataka':        { lat: 15.3173, lng: 75.7139, country: 'IN' },
  'telangana':        { lat: 18.1124, lng: 79.0193, country: 'IN' },
  'kerala':           { lat: 10.8505, lng: 76.2711, country: 'IN' },
  'tamil nadu':       { lat: 11.1271, lng: 78.6569, country: 'IN' },
  'andhra pradesh':   { lat: 15.9129, lng: 79.7400, country: 'IN' },
  'gujarat':          { lat: 22.2587, lng: 71.1924, country: 'IN' },
  'rajasthan':        { lat: 27.0238, lng: 74.2179, country: 'IN' },
  'uttar pradesh':    { lat: 26.8467, lng: 80.9462, country: 'IN' },
  'madhya pradesh':   { lat: 22.9734, lng: 78.6569, country: 'IN' },
  'bihar':            { lat: 25.0961, lng: 85.3131, country: 'IN' },
  'west bengal':      { lat: 22.9868, lng: 87.8550, country: 'IN' },
  'odisha':           { lat: 20.9517, lng: 85.0985, country: 'IN' },
  'assam':            { lat: 26.2006, lng: 92.9376, country: 'IN' },
  'manipur':          { lat: 24.6637, lng: 93.9063, country: 'IN' },
  'jharkhand':        { lat: 23.6102, lng: 85.2799, country: 'IN' },
  'chhattisgarh':     { lat: 21.2787, lng: 81.8661, country: 'IN' },
  'uttarakhand':      { lat: 30.0668, lng: 79.0193, country: 'IN' },
  'himachal pradesh': { lat: 31.1048, lng: 77.1734, country: 'IN' },
  'haryana':          { lat: 29.0588, lng: 76.0856, country: 'IN' },
  'meghalaya':        { lat: 25.4670, lng: 91.3662, country: 'IN' },
  'ladakh':           { lat: 34.1526, lng: 77.5771, country: 'IN' },
  'tripura':          { lat: 23.9408, lng: 91.9882, country: 'IN' },
  'nagaland':         { lat: 26.1584, lng: 94.5624, country: 'IN' },
  'mizoram':          { lat: 23.1645, lng: 92.9376, country: 'IN' },
  'sikkim':           { lat: 27.5330, lng: 88.5122, country: 'IN' },
  'arunachal pradesh':{ lat: 28.2180, lng: 94.7278, country: 'IN' },
  'quetta':           { lat: 30.1798, lng: 66.9750, country: 'PK' },
  'peshawar':         { lat: 34.0151, lng: 71.5249, country: 'PK' },
  // Regions a story names instead of a country: without them "Tibet" was pinned in Beijing (plan M54)
  'tibet':            { lat: 29.6500, lng: 91.1000, country: 'CN', region: 'Tibet', name: 'Tibet' },
  'lhasa':            { lat: 29.6500, lng: 91.1000, country: 'CN', region: 'Tibet' },
  'xinjiang':         { lat: 43.8256, lng: 87.6168, country: 'CN', region: 'Xinjiang', name: 'Xinjiang' },
  'urumqi':           { lat: 43.8256, lng: 87.6168, country: 'CN', region: 'Xinjiang' },
  'inner mongolia':   { lat: 40.8174, lng: 111.7656, country: 'CN', region: 'Inner Mongolia', name: 'Inner Mongolia' },
  'balochistan':      { lat: 30.1798, lng: 66.9750, country: 'PK', region: 'Balochistan', name: 'Balochistan' },
  'khyber pakhtunkhwa': { lat: 34.0151, lng: 71.5249, country: 'PK', region: 'Khyber Pakhtunkhwa', name: 'Khyber Pakhtunkhwa' },
  'sindh':            { lat: 25.3960, lng: 68.3578, country: 'PK', region: 'Sindh', name: 'Sindh' },
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

/**
 * Where a country's reports are pinned: its capital, as for a story that names
 * the country; null for a code we have no capital for.
 */
export function countryPin(code: string | null | undefined): { lat: number; lng: number } | null {
  const capital = COUNTRY_CENTROIDS[(code ?? '').trim().toUpperCase()]
  return capital ? { lat: capital.lat, lng: capital.lng } : null
}

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
  // …and their French, Spanish and Portuguese names ("Sénégal", "États-Unis", "Moçambique": country-names-intl.ts, Oct 21, 2026)
  ...INTL_COUNTRY_NAMES,
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

/**
 * Names an outlet's own country goes by at home (round 5, Oct 21, 2026). A
 * Brazzaville outlet's bare "Congo" is the Republic of the Congo (ACI's
 * "Congo/Elections : ..."), but read alone "Congo" is DR Congo, the bigger
 * news country: 6 of ACI's 10 items went there. A Mauritian outlet's
 * "Maurice" is Mauritius; elsewhere it is mostly a first name, and 9 of Top
 * FM's 10 items found no place. Applied to the outlet's own headline and
 * summary only, and not when the text names the other Congo.
 */
const HOME_NAMES: Record<string, { name: RegExp; as: string; unless?: RegExp }> = {
  CG: { name: /\bcongo\b(?![-\s]brazzaville)/gi, as: 'Congo-Brazzaville', unless: /\b(?:rdc|rd[-\s]?congo|drc|dr congo|d[ée]mocratique|democratic|kinshasa)\b/i },
  MU: { name: /(?<![\p{L}\p{N}])maurice(?![\p{L}\p{N}])/giu, as: 'Mauritius' },
}

export function withHomeNames(text: string, countryCode: string | null | undefined): string {
  const rule = countryCode ? HOME_NAMES[countryCode.toUpperCase()] : undefined
  if (!rule || !text || (rule.unless && rule.unless.test(text))) return text
  return text.replace(rule.name, rule.as)
}

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
const GAZETTEER_SCAN = GAZETTEER_MATCHERS.map(m => ({ place: m.place, coords: m.coords, re: new RegExp(m.re.source, 'gi') }))

/** The gazetteer place mentioned first (the headline comes first); the longer name on a tie */
export function findGazetteerPlace(text: string): { place: string; coords: typeof GAZETTEER[string] } | null {
  const clean = text.replace(OUTLET_NAMES, ' ')
  let best: { place: string; coords: typeof GAZETTEER[string]; index: number } | null = null
  for (const m of GAZETTEER_SCAN) {
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      const index = hit.index ?? 0
      if (best && index >= best.index) break
      // "Santiago Peña" is a person, "Real Madrid" a club (place-words.ts, plan 0s5)
      if (partOfAName(clean, index, index + hit[0].length)) continue
      best = { place: m.place, coords: m.coords, index }
      break
    }
  }
  return best ? { place: best.place, coords: best.coords } : null
}

/** At most this many geocoder lookups per text (each one waits about a second) */
const MAX_NOMINATIM_LOOKUPS = 4

/** The gazetteer place the text names first, as a map point */
function gazetteerPoint(text: string): GeoResult | null {
  const found = findGazetteerPlace(text)
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

const COUNTRY_SCAN = COUNTRY_MATCHERS.map(([pattern, code]) => ({ code, re: new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`) }))

/**
 * The countries a text is about (those it names, and those its gazetteer
 * places are in: "Riyadh" and "Saudi Arabian" both say SA), and the text
 * with those names blanked out. For comparing headlines (correlate.ts
 * storyWords), where a place should count once, as its country.
 */
export function splitPlaces(text: string): { countries: string[]; rest: string } {
  const clean = text.replace(OUTLET_NAMES, ' ')
  const spans: Array<[number, number]> = []
  const codes = new Set<string>()
  const take = (index: number, length: number): boolean => {
    const end = index + length
    if (length === 0 || spans.some(([a, b]) => index < b && end > a)) return false
    spans.push([index, end])
    return true
  }
  // Longest gazetteer names first ("West Virginia" before "Virginia"), then countries
  for (const m of GAZETTEER_SCAN) {
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      if (partOfAName(clean, hit.index ?? 0, (hit.index ?? 0) + hit[0].length)) continue
      if (take(hit.index ?? 0, hit[0].length) && m.coords.country) codes.add(m.coords.country)
    }
  }
  for (const m of COUNTRY_SCAN) {
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      if (take(hit.index ?? 0, hit[0].length)) codes.add(m.code)
    }
  }
  let rest = clean
  for (const [a, b] of spans) rest = rest.slice(0, a) + ' '.repeat(b - a) + rest.slice(b)
  return { countries: [...codes], rest }
}

/**
 * Every place the text names, in order of first mention: gazetteer places
 * (by their usual names) and countries (by name), each once, at most `max`.
 * Used by the Knowledge Graph's rule-based extraction (pipeline/entity-rules.ts).
 */
export function placesInText(text: string, max = 6): string[] {
  const clean = text.replace(OUTLET_NAMES, ' ')
  const hits: Array<{ name: string; index: number; end: number }> = []
  // Longest names first, so "West Virginia" keeps "Virginia" from counting again
  for (const m of GAZETTEER_SCAN) {
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      const index = hit.index ?? 0
      const end = index + hit[0].length
      if (hits.some(h => index < h.end && end > h.index)) continue
      if (partOfAName(clean, index, end)) continue
      hits.push({ name: m.coords.name ?? titleCase(m.place), index, end })
    }
  }
  for (const [pattern, code] of COUNTRY_MATCHERS) {
    const hit = pattern.exec(clean)
    if (!hit) continue
    const index = hit.index
    const end = index + hit[0].length
    if (hits.some(h => index < h.end && end > h.index)) continue
    hits.push({ name: countryNameOf(code) ?? code, index, end })
  }
  const names: string[] = []
  for (const h of hits.sort((a, b) => a.index - b.index)) {
    if (!names.includes(h.name)) names.push(h.name)
    if (names.length >= max) break
  }
  return names
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
  const fromGazetteer = gazetteerPoint(text)
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
  // "en": names asked for in English since Oct 11, 2026 (the older entries are in the local language)
  const cacheKey = `revgeo:en:${roundLat}:${roundLng}`

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
    // In English: without it, names came in the local script ("near 内蒙古自治区 ᠥᠪᠥᠷ …" in the ticker)
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${roundLat}&lon=${roundLng}&format=json&zoom=8&addressdetails=1&accept-language=en`
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
  // The first word of a longer place name: the geocoder takes "French" for French
  // Guiana (Oct 25, 2026: a French presidential campaign story was pinned there)
  'french', 'british', 'american', 'northern', 'southern', 'eastern', 'western',
  // Words that are also small towns elsewhere (Oct 27, 2026, H-0032): "Council" Idaho
  // pinned two unrelated stories, "Spring" Texas a Latin America column, "Sabha"
  // Libya an Indian parliament story (Lok Sabha, Rajya Sabha)
  'council', 'spring', 'summer', 'winter', 'autumn', 'sabha',
])
