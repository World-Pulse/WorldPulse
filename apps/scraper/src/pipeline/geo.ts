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

import { partOfAName, betweenNames, afterAName } from './place-words'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { MORE_COUNTRIES, ABBREVIATED_COUNTRIES, US_STATES, countryNameOf } from './world-countries'
import { WORLD_TOWNS, HOME_TOWNS, type TownEntry } from './world-gazetteer'
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
// asWritten: read only as written, with its capital, where the name is also a common word in a feed's language
// (Nov 6, 2026: Spanish "un nuevo tema" was pinned in Ghana's Tema; Croatian "puno" (a lot) is Peru's Puno, Albanian
// "punë" Pune, Portuguese "mataram" (they killed) Mataram, "à beira de" Beira, "contagem" Contagem, Slovenian "varna"
// Varna, Serbian "davao" Davao, Spanish "huye" Huye and "quito" Quito, Romanian "bursa" Bursa, Portuguese "lagos" Lagos),
// or where the name's accented spelling is one (French "détroit d'Ormuz" isn't Detroit, "crête" Crete; Romanian "moșul"
// Mosul, "constantă" Constanța; Lithuanian "turkų" Turku; Portuguese "quântico" Quantico), and names made of everyday
// words: Spanish "dar el paso" isn't El Paso, "el Alto Mando" El Alto, "los ángeles" Los Angeles; English "the port said"
// isn't Port Said, "the west bank of the Nile" the West Bank; French "des moines" (monks) isn't Des Moines
const GAZETTEER: Record<string, { lat: number; lng: number; country: string; region?: string; name?: string; asWritten?: string }> = {
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
  'los angeles':      { lat: 34.0522, lng: -118.2437, country: 'US', region: 'California', asWritten: 'Los Angeles' },
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
  'west bank':        { lat: 31.9522, lng: 35.2332, country: 'PS', asWritten: 'West Bank' },
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
  'lille':            { lat: 50.6292, lng: 3.0573, country: 'FR', asWritten: 'Lille' },
  'bordeaux':         { lat: 44.8378, lng: -0.5792, country: 'FR' },
  'nantes':           { lat: 47.2184, lng: -1.5536, country: 'FR' },
  'strasbourg':       { lat: 48.5734, lng: 7.7521, country: 'FR' },
  'nairobi':          { lat: -1.2921, lng: 36.8219, country: 'KE' },
  'cairo':            { lat: 30.0444, lng: 31.2357, country: 'EG' },
  'alexandria':       { lat: 31.2001, lng: 29.9187, country: 'EG' },
  'johannesburg':     { lat: -26.2041, lng: 28.0473, country: 'ZA' },
  'cape town':        { lat: -33.9249, lng: 18.4241, country: 'ZA' },
  'lagos':            { lat: 6.5244, lng: 3.3792, country: 'NG', asWritten: 'Lagos' },
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
  'colombo':          { lat: 6.9271, lng: 79.8612, country: 'LK', asWritten: 'Colombo' },
  'bangkok':          { lat: 13.7563, lng: 100.5018, country: 'TH' },
  'jakarta':          { lat: -6.2088, lng: 106.8456, country: 'ID' },
  'hanoi':            { lat: 21.0285, lng: 105.8542, country: 'VN' },
  'ho chi minh city': { lat: 10.8231, lng: 106.6297, country: 'VN' },
  'thai nguyen':      { lat: 21.5928, lng: 105.8442, country: 'VN' },
  'thai binh':        { lat: 20.4463, lng: 106.3366, country: 'VN' },
  'can tho':          { lat: 10.0452, lng: 105.7469, country: 'VN' },
  'long thanh':       { lat: 10.7833, lng: 107.0167, country: 'VN' },
  'masindi':          { lat: 1.6744, lng: 31.7150, country: 'UG' },
  'mukono':           { lat: 0.3533, lng: 32.7553, country: 'UG' },
  'algarve':          { lat: 37.0179, lng: -7.9304, country: 'PT', region: 'Algarve' },
  // M57, Oct 30, 2026: "Antigua Guatemala" was pinned in Antigua and Barbuda, Merz "at DMZ" in Beijing
  'antigua guatemala': { lat: 14.5586, lng: -90.7295, country: 'GT' },
  'dmz':              { lat: 37.9560, lng: 126.6770, country: 'KR', name: 'Korean DMZ' },
  'panmunjom':        { lat: 37.9560, lng: 126.6770, country: 'KR' },
  'kuala lumpur':     { lat: 3.1390, lng: 101.6869, country: 'MY' },
  'singapore':        { lat: 1.3521, lng: 103.8198, country: 'SG' },
  'pyongyang':        { lat: 39.0392, lng: 125.7625, country: 'KP' },
  'seoul':            { lat: 37.5665, lng: 126.9780, country: 'KR', region: 'Seoul Capital Area' },
  'kabul':            { lat: 34.5553, lng: 69.2075, country: 'AF' },
  'baghdad':          { lat: 33.3152, lng: 44.3661, country: 'IQ' },
  'mosul':            { lat: 36.3350, lng: 43.1189, country: 'IQ', asWritten: 'Mosul' },
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
  'maiduguri':        { lat: 11.8333, lng: 13.1500, country: 'NG', region: 'Borno' },
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
  'pune':             { lat: 18.5204, lng: 73.8567, country: 'IN', region: 'Maharashtra', asWritten: 'Pune' },
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
  'caracas':          { lat: 10.4806, lng: -66.9036, country: 'VE', asWritten: 'Caracas' },
  'havana':           { lat: 23.1136, lng: -82.3666, country: 'CU' },
  'port-au-prince':   { lat: 18.5944, lng: -72.3074, country: 'HT', name: 'Port-au-Prince' },
  'tbilisi':          { lat: 41.7151, lng: 44.8271, country: 'GE' },
  'yerevan':          { lat: 40.1792, lng: 44.4991, country: 'AM' },
  'baku':             { lat: 40.4093, lng: 49.8671, country: 'AZ' },
  'minsk':            { lat: 53.9006, lng: 27.5590, country: 'BY' },
  'chisinau':         { lat: 47.0105, lng: 28.8638, country: 'MD' },
  'belgrade':         { lat: 44.7866, lng: 20.4489, country: 'RS' },
  'culiacan':         { lat: 24.8091, lng: -107.3940, country: 'MX', region: 'Sinaloa' },
  // Oct 30, 2026: places that 72 hours of verified headlines named and the gazetteer didn't know. Reports from
  // Nigeria's states sat at their outlet's home (Lagos or Abuja), "Hajj ... Makkah" stories in Abuja, Incheon's
  // airport in China and Guayaquil's reports nowhere. Each state comes after its capital (a state is pinned at
  // its capital), and both carry the state as region (oneArea: "Borno" and "Maiduguri" are one area). Left out:
  // names that are also other words, names or clubs (Oyo, Imo, Jos, Rabat, Punjab, Quito's football club)
  'kano':             { lat: 12.0022, lng: 8.5920,  country: 'NG', region: 'Kano', name: 'Kano' },
  'borno':            { lat: 11.8333, lng: 13.1500, country: 'NG', region: 'Borno', name: 'Borno' },
  'makurdi':          { lat: 7.7337,  lng: 8.5214,  country: 'NG', region: 'Benue' },
  'benue':            { lat: 7.7337,  lng: 8.5214,  country: 'NG', region: 'Benue', name: 'Benue' },
  'akure':            { lat: 7.2571,  lng: 5.2058,  country: 'NG', region: 'Ondo' },
  'ondo':             { lat: 7.2571,  lng: 5.2058,  country: 'NG', region: 'Ondo', name: 'Ondo' },
  'birnin kebbi':     { lat: 12.4539, lng: 4.1975,  country: 'NG', region: 'Kebbi', name: 'Birnin Kebbi' },
  'kebbi':            { lat: 12.4539, lng: 4.1975,  country: 'NG', region: 'Kebbi', name: 'Kebbi' },
  'dutse':            { lat: 11.7562, lng: 9.3388,  country: 'NG', region: 'Jigawa' },
  'jigawa':           { lat: 11.7562, lng: 9.3388,  country: 'NG', region: 'Jigawa', name: 'Jigawa' },
  'damaturu':         { lat: 11.7470, lng: 11.9608, country: 'NG', region: 'Yobe' },
  'yobe':             { lat: 11.7470, lng: 11.9608, country: 'NG', region: 'Yobe', name: 'Yobe' },
  'benin city':       { lat: 6.3350,  lng: 5.6037,  country: 'NG', region: 'Edo', name: 'Benin City' },
  'edo':              { lat: 6.3350,  lng: 5.6037,  country: 'NG', region: 'Edo', name: 'Edo' },
  'ekiti':            { lat: 7.6211,  lng: 5.2214,  country: 'NG', region: 'Ekiti', name: 'Ekiti' },
  'katsina':          { lat: 12.9908, lng: 7.6018,  country: 'NG', region: 'Katsina', name: 'Katsina' },
  'abakaliki':        { lat: 6.3249,  lng: 8.1137,  country: 'NG', region: 'Ebonyi' },
  'ebonyi':           { lat: 6.3249,  lng: 8.1137,  country: 'NG', region: 'Ebonyi', name: 'Ebonyi' },
  'adamawa':          { lat: 9.2035,  lng: 12.4954, country: 'NG', region: 'Adamawa', name: 'Adamawa' },
  'yenagoa':          { lat: 4.9267,  lng: 6.2676,  country: 'NG', region: 'Bayelsa' },
  'bayelsa':          { lat: 4.9267,  lng: 6.2676,  country: 'NG', region: 'Bayelsa', name: 'Bayelsa' },
  'gusau':            { lat: 12.1704, lng: 6.6641,  country: 'NG', region: 'Zamfara' },
  'zamfara':          { lat: 12.1704, lng: 6.6641,  country: 'NG', region: 'Zamfara', name: 'Zamfara' },
  'umuahia':          { lat: 5.5250,  lng: 7.4922,  country: 'NG', region: 'Abia' },
  'abia':             { lat: 5.5250,  lng: 7.4922,  country: 'NG', region: 'Abia', name: 'Abia', asWritten: 'Abia' },
  'uyo':              { lat: 5.0377,  lng: 7.9128,  country: 'NG', region: 'Akwa Ibom' },
  'akwa ibom':        { lat: 5.0377,  lng: 7.9128,  country: 'NG', region: 'Akwa Ibom', name: 'Akwa Ibom' },
  'calabar':          { lat: 4.9757,  lng: 8.3417,  country: 'NG', region: 'Cross River' },
  'cross river state':{ lat: 4.9757,  lng: 8.3417,  country: 'NG', region: 'Cross River', name: 'Cross River' },
  'enugu':            { lat: 6.4584,  lng: 7.5464,  country: 'NG', region: 'Enugu', name: 'Enugu' },
  'osogbo':           { lat: 7.7827,  lng: 4.5418,  country: 'NG', region: 'Osun' },
  'osun':             { lat: 7.7827,  lng: 4.5418,  country: 'NG', region: 'Osun', name: 'Osun' },
  'ibadan':           { lat: 7.3775,  lng: 3.9470,  country: 'NG', region: 'Oyo' },
  'ikeja':            { lat: 6.6018,  lng: 3.3515,  country: 'NG', region: 'Lagos' },
  'plateau state':    { lat: 9.8965,  lng: 8.8583,  country: 'NG', region: 'Plateau', name: 'Plateau' },
  'ilorin':           { lat: 8.4966,  lng: 4.5421,  country: 'NG', region: 'Kwara' },
  'kwara':            { lat: 8.4966,  lng: 4.5421,  country: 'NG', region: 'Kwara', name: 'Kwara' },
  'gombe':            { lat: 10.2897, lng: 11.1673, country: 'NG', region: 'Gombe', name: 'Gombe' },
  'bauchi':           { lat: 10.3158, lng: 9.8442,  country: 'NG', region: 'Bauchi', name: 'Bauchi' },
  'abeokuta':         { lat: 7.1475,  lng: 3.3619,  country: 'NG', region: 'Ogun' },
  'ogun':             { lat: 7.1475,  lng: 3.3619,  country: 'NG', region: 'Ogun', name: 'Ogun' },
  'owerri':           { lat: 5.4836,  lng: 7.0333,  country: 'NG', region: 'Imo' },
  'awka':             { lat: 6.2104,  lng: 7.0719,  country: 'NG', region: 'Anambra' },
  'onitsha':          { lat: 6.1499,  lng: 6.7857,  country: 'NG', region: 'Anambra' },
  'anambra':          { lat: 6.2104,  lng: 7.0719,  country: 'NG', region: 'Anambra', name: 'Anambra' },
  'asaba':            { lat: 6.1980,  lng: 6.7318,  country: 'NG', region: 'Delta' },
  'warri':            { lat: 5.5167,  lng: 5.7500,  country: 'NG', region: 'Delta' },
  'delta state':      { lat: 6.1980,  lng: 6.7318,  country: 'NG', region: 'Delta', name: 'Delta' },
  'port harcourt':    { lat: 4.8156,  lng: 7.0498,  country: 'NG', region: 'Rivers', name: 'Port Harcourt' },
  'rivers state':     { lat: 4.8156,  lng: 7.0498,  country: 'NG', region: 'Rivers', name: 'Rivers' },
  'nasarawa':         { lat: 8.4939,  lng: 8.5153,  country: 'NG', region: 'Nasarawa', name: 'Nasarawa' },
  'lokoja':           { lat: 7.8023,  lng: 6.7333,  country: 'NG', region: 'Kogi' },
  'kogi':             { lat: 7.8023,  lng: 6.7333,  country: 'NG', region: 'Kogi', name: 'Kogi' },
  'guayaquil':        { lat: -2.1709, lng: -79.9224, country: 'EC' },
  'samborondón':      { lat: -1.9606, lng: -79.7246, country: 'EC', name: 'Samborondón' },
  'durban':           { lat: -29.8587, lng: 31.0218, country: 'ZA' },
  'aden':             { lat: 12.7855, lng: 45.0187, country: 'YE' },
  'taiz':             { lat: 13.5795, lng: 44.0209, country: 'YE' },
  'makkah':           { lat: 21.3891, lng: 39.8579, country: 'SA' },
  'muscat':           { lat: 23.5880, lng: 58.3829, country: 'OM', asWritten: 'Muscat' },
  'incheon':          { lat: 37.4563, lng: 126.7052, country: 'KR' },
  'kathmandu':        { lat: 27.7172, lng: 85.3240, country: 'NP' },
  'athens':           { lat: 37.9838, lng: 23.7275, country: 'GR' },
  'harare':           { lat: -17.8252, lng: 31.0335, country: 'ZW' },
  'dushanbe':         { lat: 38.5598, lng: 68.7870, country: 'TJ' },
  'ajman':            { lat: 25.4052, lng: 55.5136, country: 'AE' },
  'gazipur':          { lat: 23.9999, lng: 90.4203, country: 'BD' },
  'arequipa':         { lat: -16.4090, lng: -71.5375, country: 'PE' },
  'belfast':          { lat: 54.5973, lng: -5.9301, country: 'GB' },
  'glasgow':          { lat: 55.8642, lng: -4.2518, country: 'GB' },
  'samarkand':        { lat: 39.6542, lng: 66.9597, country: 'UZ' },
  'el obeid':         { lat: 13.1843, lng: 30.2167, country: 'SD', name: 'El Obeid' },
  'nyala':            { lat: 12.0489, lng: 24.8807, country: 'SD', region: 'Darfur' },
  'chiba':            { lat: 35.6074, lng: 140.1065, country: 'JP' },
  'kumamoto':         { lat: 32.8031, lng: 130.7079, country: 'JP' },
  'kaliningrad':      { lat: 54.7104, lng: 20.4522, country: 'RU' },
  'dublin':           { lat: 53.3498, lng: -6.2603, country: 'IE' },
  'tallinn':          { lat: 59.4370, lng: 24.7536, country: 'EE' },
  'vilnius':          { lat: 54.6872, lng: 25.2797, country: 'LT' },
  'agadez':           { lat: 16.9733, lng: 7.9911,  country: 'NE' },
  'alicante':         { lat: 38.3452, lng: -0.4810, country: 'ES' },
  'guiyang':          { lat: 26.6470, lng: 106.6302, country: 'CN' },
  'bishkek':          { lat: 42.8746, lng: 74.5698, country: 'KG' },
  'astana':           { lat: 51.1694, lng: 71.4491, country: 'KZ' },
  'calgary':          { lat: 51.0447, lng: -114.0719, country: 'CA' },
  'ottawa':           { lat: 45.4215, lng: -75.6972, country: 'CA' },
  'kumasi':           { lat: 6.6885,  lng: -1.6244, country: 'GH' },
  'tangier':          { lat: 35.7595, lng: -5.8340, country: 'MA' },
  'casablanca':       { lat: 33.5731, lng: -7.5898, country: 'MA' },
  'bissau':           { lat: 11.8636, lng: -15.5977, country: 'GW' },
  'culiacán':         { lat: 24.8091, lng: -107.3940, country: 'MX', region: 'Sinaloa', name: 'Culiacán' },
  // Oct 30, 2026, evening: Australian, New Zealand and Caribbean local stories read off the live map points sat at
  // Melbourne, Wellington and Port of Spain ("... house sales in Alice Springs", "Wairarapa drug kingpin",
  // "Four held for drunk driving in Tobago"). Wanaka is also kept with its macron: names are matched as written
  'alice springs':    { lat: -23.6980, lng: 133.8807, country: 'AU', region: 'Northern Territory' },
  'canberra':         { lat: -35.2809, lng: 149.1300, country: 'AU' },
  'hobart':           { lat: -42.8821, lng: 147.3272, country: 'AU', region: 'Tasmania' },
  'cairns':           { lat: -16.9186, lng: 145.7781, country: 'AU', region: 'Queensland' },
  'townsville':       { lat: -19.2590, lng: 146.8169, country: 'AU', region: 'Queensland' },
  'geelong':          { lat: -38.1499, lng: 144.3617, country: 'AU', region: 'Victoria' },
  'dunedin':          { lat: -45.8788, lng: 170.5028, country: 'NZ' },
  'tauranga':         { lat: -37.6878, lng: 176.1651, country: 'NZ' },
  'rotorua':          { lat: -38.1368, lng: 176.2497, country: 'NZ' },
  'wairarapa':        { lat: -40.9511, lng: 175.6576, country: 'NZ', region: 'Wairarapa', name: 'Wairarapa' },
  'masterton':        { lat: -40.9511, lng: 175.6576, country: 'NZ', region: 'Wairarapa' },
  'wanaka':           { lat: -44.7032, lng: 169.1321, country: 'NZ' },
  'wānaka':           { lat: -44.7032, lng: 169.1321, country: 'NZ' },
  'daytona beach':    { lat: 29.2108, lng: -81.0228, country: 'US', region: 'Florida' },
  'tobago':           { lat: 11.1800, lng: -60.7400, country: 'TT', region: 'Tobago', name: 'Tobago' },
  // Oct 31, 2026, 12:42 AM: large cities no headline could be pinned to (Faisalabad, Shenzhen, Edinburgh and 40 more tested missing);
  // cities that are also a club, a treaty or another town of the same name (Liverpool, Geneva, Valencia, Birmingham, Naples) are left out
  'faisalabad':       { lat: 31.4504, lng: 73.135, country: 'PK', region: 'Punjab' },
  'multan':           { lat: 30.1575, lng: 71.5249, country: 'PK', region: 'Punjab' },
  'rawalpindi':       { lat: 33.5651, lng: 73.0169, country: 'PK', region: 'Punjab' },
  'chittagong':       { lat: 22.3569, lng: 91.7832, country: 'BD' },
  'chattogram':       { lat: 22.3569, lng: 91.7832, country: 'BD' },
  'sylhet':           { lat: 24.8949, lng: 91.8687, country: 'BD' },
  'khulna':           { lat: 22.8456, lng: 89.5403, country: 'BD' },
  'kandy':            { lat: 7.2906, lng: 80.6337, country: 'LK' },
  'pokhara':          { lat: 28.2096, lng: 83.9856, country: 'NP' },
  'mandalay':         { lat: 21.9588, lng: 96.0891, country: 'MM' },
  'da nang':          { lat: 16.0544, lng: 108.2022, country: 'VN' },
  'cebu':             { lat: 10.3157, lng: 123.8854, country: 'PH' },
  'davao':            { lat: 7.1907, lng: 125.4553, country: 'PH', region: 'Mindanao', asWritten: 'Davao' },
  'surabaya':         { lat: -7.2575, lng: 112.7521, country: 'ID', region: 'East Java' },
  'bandung':          { lat: -6.9175, lng: 107.6191, country: 'ID', region: 'West Java' },
  'medan':            { lat: 3.5952, lng: 98.6722, country: 'ID', region: 'North Sumatra' },
  'makassar':         { lat: -5.1477, lng: 119.4327, country: 'ID', region: 'South Sulawesi' },
  'denpasar':         { lat: -8.65, lng: 115.2167, country: 'ID', region: 'Bali' },
  'ipoh':             { lat: 4.5975, lng: 101.0901, country: 'MY', region: 'Perak' },
  'chiang mai':       { lat: 18.7883, lng: 98.9853, country: 'TH' },
  'phuket':           { lat: 7.8804, lng: 98.3923, country: 'TH' },
  'pattaya':          { lat: 12.9236, lng: 100.8825, country: 'TH' },
  'nagoya':           { lat: 35.1815, lng: 136.9066, country: 'JP' },
  'sapporo':          { lat: 43.0618, lng: 141.3545, country: 'JP', region: 'Hokkaido' },
  'fukuoka':          { lat: 33.5904, lng: 130.4017, country: 'JP' },
  'busan':            { lat: 35.1796, lng: 129.0756, country: 'KR' },
  'daegu':            { lat: 35.8714, lng: 128.6014, country: 'KR' },
  'kaohsiung':        { lat: 22.6273, lng: 120.3014, country: 'TW' },
  'shenzhen':         { lat: 22.5431, lng: 114.0579, country: 'CN', region: 'Guangdong' },
  'guangzhou':        { lat: 23.1291, lng: 113.2644, country: 'CN', region: 'Guangdong' },
  'chengdu':          { lat: 30.5728, lng: 104.0668, country: 'CN', region: 'Sichuan' },
  'chongqing':        { lat: 29.4316, lng: 106.9123, country: 'CN' },
  'wuhan':            { lat: 30.5928, lng: 114.3055, country: 'CN', region: 'Hubei' },
  'hangzhou':         { lat: 30.2741, lng: 120.1551, country: 'CN', region: 'Zhejiang' },
  'nanjing':          { lat: 32.0603, lng: 118.7969, country: 'CN', region: 'Jiangsu' },
  'tianjin':          { lat: 39.3434, lng: 117.3616, country: 'CN' },
  'harbin':           { lat: 45.8038, lng: 126.535, country: 'CN', region: 'Heilongjiang' },
  'almaty':           { lat: 43.222, lng: 76.8512, country: 'KZ' },
  'mariupol':         { lat: 47.0971, lng: 37.5434, country: 'UA', region: 'Donetsk' },
  'gothenburg':       { lat: 57.7089, lng: 11.9746, country: 'SE' },
  'malmö':            { lat: 55.605, lng: 13.0038, country: 'SE' },
  'malmo':            { lat: 55.605, lng: 13.0038, country: 'SE' },
  'bergen':           { lat: 60.3913, lng: 5.3221, country: 'NO', asWritten: 'Bergen' },
  'cork':             { lat: 51.8985, lng: -8.4756, country: 'IE', asWritten: 'Cork' },
  'edinburgh':        { lat: 55.9533, lng: -3.1883, country: 'GB', region: 'Scotland' },
  'cardiff':          { lat: 51.4816, lng: -3.1791, country: 'GB', region: 'Wales' },
  'hamburg':          { lat: 53.5511, lng: 9.9937, country: 'DE' },
  'stuttgart':        { lat: 48.7758, lng: 9.1829, country: 'DE' },
  'dresden':          { lat: 51.0504, lng: 13.7373, country: 'DE' },
  'leipzig':          { lat: 51.3397, lng: 12.3731, country: 'DE' },
  'zurich':           { lat: 47.3769, lng: 8.5417, country: 'CH' },
  'zürich':           { lat: 47.3769, lng: 8.5417, country: 'CH' },
  'krakow':           { lat: 50.0647, lng: 19.945, country: 'PL' },
  'kraków':           { lat: 50.0647, lng: 19.945, country: 'PL' },
  'gdansk':           { lat: 54.352, lng: 18.6466, country: 'PL' },
  'gdańsk':           { lat: 54.352, lng: 18.6466, country: 'PL' },
  'thessaloniki':     { lat: 40.6401, lng: 22.9444, country: 'GR' },
  'turin':            { lat: 45.0703, lng: 7.6869, country: 'IT', asWritten: 'Turin' },
  'antwerp':          { lat: 51.2194, lng: 4.4025, country: 'BE' },
  'rotterdam':        { lat: 51.9244, lng: 4.4777, country: 'NL' },
  // Oct 31, 2026, 6:43 PM (M63): 300 more large cities tested in "Police say a man was arrested in <city> on Friday"; these had no place of their own.
  // Left out on purpose: names that are also words, people or other towns (Valencia, Santa Cruz, Cordoba, Salvador, Portland, Richmond, Columbus, Hamilton, Newcastle, Nice, Split, Essen, Porto, Hue, Tyre, Gao, Cali, Austin, Charlotte, Orlando, Phoenix, Buffalo, Hyderabad)
  'tamale':            { lat: 9.4034, lng: -0.8424, country: 'GH' },
  'bulawayo':          { lat: -20.1325, lng: 28.6265, country: 'ZW' },
  'ndola':             { lat: -12.9587, lng: 28.6366, country: 'ZM' },
  'kitwe':             { lat: -12.8024, lng: 28.2132, country: 'ZM' },
  'blantyre':          { lat: -15.7861, lng: 35.0058, country: 'MW' },
  'mombasa':           { lat: -4.0435, lng: 39.6682, country: 'KE' },
  'kisumu':            { lat: -0.0917, lng: 34.768, country: 'KE' },
  'nakuru':            { lat: -0.3031, lng: 36.08, country: 'KE' },
  'eldoret':           { lat: 0.5143, lng: 35.2698, country: 'KE' },
  'arusha':            { lat: -3.3869, lng: 36.683, country: 'TZ' },
  'mwanza':            { lat: -2.5164, lng: 32.9175, country: 'TZ' },
  'zanzibar':          { lat: -6.1659, lng: 39.2026, country: 'TZ' },
  'goma':              { lat: -1.6585, lng: 29.2205, country: 'CD', asWritten: 'Goma' },
  'lubumbashi':        { lat: -11.6609, lng: 27.4794, country: 'CD' },
  'kisangani':         { lat: 0.5153, lng: 25.19, country: 'CD' },
  'bouake':            { lat: 7.6906, lng: -5.0366, country: 'CI' },
  'sfax':              { lat: 34.7406, lng: 10.7603, country: 'TN' },
  'marrakech':         { lat: 31.6295, lng: -7.9811, country: 'MA' },
  'agadir':            { lat: 30.4278, lng: -9.5981, country: 'MA' },
  'luxor':             { lat: 25.6872, lng: 32.6396, country: 'EG' },
  'aswan':             { lat: 24.0889, lng: 32.8998, country: 'EG' },
  'port said':         { lat: 31.2653, lng: 32.3019, country: 'EG', asWritten: 'Port Said' },
  'omdurman':          { lat: 15.6445, lng: 32.4777, country: 'SD' },
  'kismayo':           { lat: -0.3582, lng: 42.5454, country: 'SO' },
  'bosaso':            { lat: 11.2842, lng: 49.1816, country: 'SO' },
  'bahir dar':         { lat: 11.5742, lng: 37.3614, country: 'ET' },
  'gondar':            { lat: 12.6, lng: 37.4667, country: 'ET' },
  'timbuktu':          { lat: 16.7666, lng: -3.0026, country: 'ML' },
  'zinder':            { lat: 13.8069, lng: 8.9881, country: 'NE' },
  'bobo-dioulasso':    { lat: 11.1771, lng: -4.2979, country: 'BF' },
  'douala':            { lat: 4.0511, lng: 9.7679, country: 'CM' },
  'pointe-noire':      { lat: -4.7692, lng: 11.8664, country: 'CG' },
  'huambo':            { lat: -12.7761, lng: 15.7392, country: 'AO' },
  'beira':             { lat: -19.8436, lng: 34.8389, country: 'MZ', asWritten: 'Beira' },
  'gqeberha':          { lat: -33.9608, lng: 25.6022, country: 'ZA' },
  'port elizabeth':    { lat: -33.9608, lng: 25.6022, country: 'ZA' },
  'bloemfontein':      { lat: -29.0852, lng: 26.1596, country: 'ZA' },
  'soweto':            { lat: -26.2678, lng: 27.8585, country: 'ZA' },
  'pietermaritzburg':  { lat: -29.6006, lng: 30.3794, country: 'ZA' },
  'quito':             { lat: -0.1807, lng: -78.4678, country: 'EC', asWritten: 'Quito' },
  'medellin':          { lat: 6.2476, lng: -75.5658, country: 'CO' },
  'medellín':          { lat: 6.2476, lng: -75.5658, country: 'CO' },
  'barranquilla':      { lat: 10.9685, lng: -74.7813, country: 'CO' },
  'cucuta':            { lat: 7.8939, lng: -72.5078, country: 'CO' },
  'maracaibo':         { lat: 10.6666, lng: -71.6124, country: 'VE' },
  'barquisimeto':      { lat: 10.0647, lng: -69.3570, country: 'VE' },
  'cochabamba':        { lat: -17.3895, lng: -66.1568, country: 'BO' },
  'cusco':             { lat: -13.5319, lng: -71.9675, country: 'PE' },
  'valparaiso':        { lat: -33.0472, lng: -71.6127, country: 'CL' },
  'valparaíso':        { lat: -33.0472, lng: -71.6127, country: 'CL' },
  'recife':            { lat: -8.0476, lng: -34.877, country: 'BR', asWritten: 'Recife' },
  'fortaleza':         { lat: -3.7319, lng: -38.5267, country: 'BR', asWritten: 'Fortaleza' },
  'manaus':            { lat: -3.119, lng: -60.0217, country: 'BR' },
  'curitiba':          { lat: -25.4284, lng: -49.2733, country: 'BR' },
  'porto alegre':      { lat: -30.0346, lng: -51.2177, country: 'BR', asWritten: 'Porto Alegre' },
  'belo horizonte':    { lat: -19.9167, lng: -43.9345, country: 'BR' },
  'guadalajara':       { lat: 20.6597, lng: -103.3496, country: 'MX' },
  'monterrey':         { lat: 25.6866, lng: -100.3161, country: 'MX' },
  'tijuana':           { lat: 32.5149, lng: -117.0382, country: 'MX' },
  'ciudad juarez':     { lat: 31.6904, lng: -106.4245, country: 'MX' },
  'ciudad juárez':     { lat: 31.6904, lng: -106.4245, country: 'MX' },
  'acapulco':          { lat: 16.8531, lng: -99.8237, country: 'MX' },
  'oaxaca':            { lat: 17.0732, lng: -96.7266, country: 'MX' },
  'cancun':            { lat: 21.1619, lng: -86.8515, country: 'MX' },
  'cancún':            { lat: 21.1619, lng: -86.8515, country: 'MX' },
  'san pedro sula':    { lat: 15.5042, lng: -88.0250, country: 'HN' },
  'guatemala city':    { lat: 14.6349, lng: -90.5069, country: 'GT' },
  'deir ez-zor':       { lat: 35.3359, lng: 40.1408, country: 'SY' },
  'najaf':             { lat: 31.9961, lng: 44.3148, country: 'IQ' },
  'karbala':           { lat: 32.616, lng: 44.0249, country: 'IQ' },
  'sulaymaniyah':      { lat: 35.5613, lng: 45.4309, country: 'IQ' },
  'tabriz':            { lat: 38.0962, lng: 46.2738, country: 'IR' },
  'isfahan':           { lat: 32.6546, lng: 51.668, country: 'IR' },
  'shiraz':            { lat: 29.5918, lng: 52.5837, country: 'IR' },
  'mashhad':           { lat: 36.2605, lng: 59.6168, country: 'IR' },
  'ahvaz':             { lat: 31.3183, lng: 48.6706, country: 'IR' },
  'bandar abbas':      { lat: 27.1865, lng: 56.2808, country: 'IR' },
  'medina':            { lat: 24.5247, lng: 39.5692, country: 'SA', asWritten: 'Medina' },
  'kuwait city':       { lat: 29.3759, lng: 47.9774, country: 'KW' },
  'salalah':           { lat: 17.0151, lng: 54.0924, country: 'OM' },
  'haifa':             { lat: 32.794, lng: 34.9896, country: 'IL' },
  'eilat':             { lat: 29.5577, lng: 34.9519, country: 'IL' },
  'baalbek':           { lat: 34.0047, lng: 36.2110, country: 'LB' },
  'gaziantep':         { lat: 37.0662, lng: 37.3833, country: 'TR' },
  'izmir':             { lat: 38.4237, lng: 27.1428, country: 'TR' },
  'i̇zmir':            { lat: 38.4237, lng: 27.1428, country: 'TR' },
  'antalya':           { lat: 36.8969, lng: 30.7133, country: 'TR' },
  'diyarbakir':        { lat: 37.9144, lng: 40.2306, country: 'TR' },
  'diyarbakır':        { lat: 37.9144, lng: 40.2306, country: 'TR' },
  'trabzon':           { lat: 41.0027, lng: 39.7168, country: 'TR' },
  'batumi':            { lat: 41.6168, lng: 41.6367, country: 'GE' },
  'karaganda':         { lat: 49.8047, lng: 73.1094, country: 'KZ' },
  'shymkent':          { lat: 42.3417, lng: 69.5901, country: 'KZ' },
  'mazar-i-sharif':    { lat: 36.7069, lng: 67.1128, country: 'AF' },
  'jalalabad':         { lat: 34.4415, lng: 70.4361, country: 'AF' },
  'kanpur':            { lat: 26.4499, lng: 80.3319, country: 'IN' },
  'ludhiana':          { lat: 30.901, lng: 75.8573, country: 'IN' },
  'amritsar':          { lat: 31.634, lng: 74.8723, country: 'IN' },
  'coimbatore':        { lat: 11.0168, lng: 76.9558, country: 'IN' },
  'vijayawada':        { lat: 16.5062, lng: 80.648, country: 'IN' },
  'siem reap':         { lat: 13.3671, lng: 103.8448, country: 'KH' },
  'haiphong':          { lat: 20.8449, lng: 106.6881, country: 'VN' },
  'quezon city':       { lat: 14.676, lng: 121.0437, country: 'PH' },
  'zamboanga':         { lat: 6.9214, lng: 122.079, country: 'PH' },
  'palembang':         { lat: -2.9761, lng: 104.7754, country: 'ID' },
  'semarang':          { lat: -6.9667, lng: 110.4167, country: 'ID' },
  'yogyakarta':        { lat: -7.7956, lng: 110.3695, country: 'ID' },
  'yokohama':          { lat: 35.4437, lng: 139.638, country: 'JP' },
  'hiroshima':         { lat: 34.3853, lng: 132.4553, country: 'JP' },
  'nagasaki':          { lat: 32.7503, lng: 129.8779, country: 'JP' },
  'sendai':            { lat: 38.2682, lng: 140.8694, country: 'JP' },
  'gwangju':           { lat: 35.1595, lng: 126.8526, country: 'KR' },
  'daejeon':           { lat: 36.3504, lng: 127.3845, country: 'KR' },
  "xi'an":             { lat: 34.3416, lng: 108.9398, country: 'CN' },
  'shenyang':          { lat: 41.8057, lng: 123.4315, country: 'CN' },
  'dalian':            { lat: 38.914, lng: 121.6147, country: 'CN' },
  'qingdao':           { lat: 36.0671, lng: 120.3826, country: 'CN' },
  'zhengzhou':         { lat: 34.7466, lng: 113.6253, country: 'CN' },
  'changsha':          { lat: 28.2282, lng: 112.9388, country: 'CN' },
  'kunming':           { lat: 25.0389, lng: 102.7183, country: 'CN' },
  'hohhot':            { lat: 40.8426, lng: 111.7492, country: 'CN' },
  'xiamen':            { lat: 24.4798, lng: 118.0894, country: 'CN' },
  'ningbo':            { lat: 29.8683, lng: 121.544, country: 'CN' },
  'hefei':             { lat: 31.8206, lng: 117.2272, country: 'CN' },
  'taichung':          { lat: 24.1477, lng: 120.6736, country: 'TW' },
  'tainan':            { lat: 22.9999, lng: 120.227, country: 'TW' },
  'hualien':           { lat: 23.9872, lng: 121.6015, country: 'TW' },
  'vladivostok':       { lat: 43.1332, lng: 131.9113, country: 'RU' },
  'krasnodar':         { lat: 45.0355, lng: 38.9753, country: 'RU' },
  'murmansk':          { lat: 68.9585, lng: 33.0827, country: 'RU' },
  'makhachkala':       { lat: 42.9849, lng: 47.5047, country: 'RU' },
  'chernihiv':         { lat: 51.4982, lng: 31.2893, country: 'UA' },
  'timisoara':         { lat: 45.7489, lng: 21.2087, country: 'RO' },
  'timișoara':         { lat: 45.7489, lng: 21.2087, country: 'RO' },
  'constanta':         { lat: 44.1598, lng: 28.6348, country: 'RO', asWritten: 'Constanta' },
  'plovdiv':           { lat: 42.1354, lng: 24.7453, country: 'BG' },
  'mostar':            { lat: 43.3438, lng: 17.8078, country: 'BA' },
  'banja luka':        { lat: 44.7722, lng: 17.191, country: 'BA' },
  'novi sad':          { lat: 45.2671, lng: 19.8335, country: 'RS' },
  'kosice':            { lat: 48.7164, lng: 21.2611, country: 'SK' },
  'košice':            { lat: 48.7164, lng: 21.2611, country: 'SK' },
  'brno':              { lat: 49.1951, lng: 16.6068, country: 'CZ' },
  'ostrava':           { lat: 49.8209, lng: 18.2625, country: 'CZ' },
  'katowice':          { lat: 50.2649, lng: 19.0238, country: 'PL' },
  'wroclaw':           { lat: 51.1079, lng: 17.0385, country: 'PL' },
  'wrocław':           { lat: 51.1079, lng: 17.0385, country: 'PL' },
  'poznan':            { lat: 52.4064, lng: 16.9252, country: 'PL' },
  'poznań':            { lat: 52.4064, lng: 16.9252, country: 'PL' },
  'lodz':              { lat: 51.7592, lng: 19.456, country: 'PL' },
  'łódź':              { lat: 51.7592, lng: 19.456, country: 'PL' },
  'kaunas':            { lat: 54.8985, lng: 23.9036, country: 'LT' },
  'tartu':             { lat: 58.378, lng: 26.729, country: 'EE' },
  'tampere':           { lat: 61.4978, lng: 23.761, country: 'FI' },
  'aarhus':            { lat: 56.1629, lng: 10.2039, country: 'DK' },
  'trondheim':         { lat: 63.4305, lng: 10.3951, country: 'NO' },
  'stavanger':         { lat: 58.97, lng: 5.7331, country: 'NO' },
  'tromso':            { lat: 69.6492, lng: 18.9553, country: 'NO' },
  'tromsø':            { lat: 69.6492, lng: 18.9553, country: 'NO' },
  'uppsala':           { lat: 59.8586, lng: 17.6389, country: 'SE' },
  'galway':            { lat: 53.2707, lng: -9.0568, country: 'IE' },
  'aberdeen':          { lat: 57.1497, lng: -2.0943, country: 'GB', region: 'Scotland' },
  'sheffield':         { lat: 53.3811, lng: -1.4701, country: 'GB', region: 'England' },
  'southampton':       { lat: 50.9097, lng: -1.4044, country: 'GB', region: 'England' },
  'dusseldorf':        { lat: 51.2277, lng: 6.7735, country: 'DE' },
  'düsseldorf':        { lat: 51.2277, lng: 6.7735, country: 'DE' },
  'dortmund':          { lat: 51.5136, lng: 7.4653, country: 'DE' },
  'nuremberg':         { lat: 49.4521, lng: 11.0767, country: 'DE' },
  'nürnberg':          { lat: 49.4521, lng: 11.0767, country: 'DE' },
  'lausanne':          { lat: 46.5197, lng: 6.6323, country: 'CH' },
  'palermo':           { lat: 38.1157, lng: 13.3615, country: 'IT', region: 'Sicily' },
  'catania':           { lat: 37.5079, lng: 15.083, country: 'IT', region: 'Sicily' },
  'lampedusa':         { lat: 35.5, lng: 12.6, country: 'IT', region: 'Sicily' },
  'seville':           { lat: 37.3891, lng: -5.9845, country: 'ES' },
  'sevilla':           { lat: 37.3891, lng: -5.9845, country: 'ES' },
  'malaga':            { lat: 36.7213, lng: -4.4214, country: 'ES' },
  'málaga':            { lat: 36.7213, lng: -4.4214, country: 'ES' },
  'bilbao':            { lat: 43.263, lng: -2.935, country: 'ES' },
  'zaragoza':          { lat: 41.6488, lng: -0.8891, country: 'ES' },
  'eindhoven':         { lat: 51.4416, lng: 5.4697, country: 'NL' },
  'limassol':          { lat: 34.6841, lng: 33.0379, country: 'CY' },
  'larnaca':           { lat: 34.9229, lng: 33.6233, country: 'CY' },
  'edmonton':          { lat: 53.5461, lng: -113.4937, country: 'CA', region: 'Alberta' },
  'winnipeg':          { lat: 49.8951, lng: -97.1384, country: 'CA', region: 'Manitoba' },
  'seattle':           { lat: 47.6062, lng: -122.3321, country: 'US', region: 'Washington' },
  'san francisco':     { lat: 37.7749, lng: -122.4194, country: 'US', region: 'California' },
  'oakland':           { lat: 37.8044, lng: -122.2712, country: 'US', region: 'California' },
  'sacramento':        { lat: 38.5816, lng: -121.4944, country: 'US', region: 'California' },
  'las vegas':         { lat: 36.1699, lng: -115.1398, country: 'US', region: 'Nevada', asWritten: 'Las Vegas' },
  'tucson':            { lat: 32.2226, lng: -110.9747, country: 'US', region: 'Arizona' },
  'salt lake city':    { lat: 40.7608, lng: -111.891, country: 'US', region: 'Utah' },
  'albuquerque':       { lat: 35.0844, lng: -106.6504, country: 'US', region: 'New Mexico' },
  'dallas':            { lat: 32.7767, lng: -96.797, country: 'US', region: 'Texas' },
  'san antonio':       { lat: 29.4241, lng: -98.4936, country: 'US', region: 'Texas' },
  'el paso':           { lat: 31.7619, lng: -106.485, country: 'US', region: 'Texas', asWritten: 'El Paso' },
  'minneapolis':       { lat: 44.9778, lng: -93.265, country: 'US', region: 'Minnesota' },
  'milwaukee':         { lat: 43.0389, lng: -87.9065, country: 'US', region: 'Wisconsin' },
  'detroit':           { lat: 42.3314, lng: -83.0458, country: 'US', region: 'Michigan', asWritten: 'Detroit' },
  'cleveland':         { lat: 41.4993, lng: -81.6944, country: 'US', region: 'Ohio' },
  'cincinnati':        { lat: 39.1031, lng: -84.512, country: 'US', region: 'Ohio' },
  'pittsburgh':        { lat: 40.4406, lng: -79.9959, country: 'US', region: 'Pennsylvania' },
  'philadelphia':      { lat: 39.9526, lng: -75.1652, country: 'US', region: 'Pennsylvania' },
  'baltimore':         { lat: 39.2904, lng: -76.6122, country: 'US', region: 'Maryland' },
  'atlanta':           { lat: 33.749, lng: -84.388, country: 'US', region: 'Georgia' },
  'nashville':         { lat: 36.1627, lng: -86.7816, country: 'US', region: 'Tennessee' },
  'memphis':           { lat: 35.1495, lng: -90.049, country: 'US', region: 'Tennessee' },
  'new orleans':       { lat: 29.9511, lng: -90.0715, country: 'US', region: 'Louisiana' },
  'honolulu':          { lat: 21.3069, lng: -157.8583, country: 'US', region: 'Hawaii' },
  'anchorage':         { lat: 61.2181, lng: -149.9003, country: 'US', region: 'Alaska' },
  'indianapolis':      { lat: 39.7684, lng: -86.1581, country: 'US', region: 'Indiana' },
  // Oct 31, 2026 (sources round 6): towns of the 18 countries that had no outlet of their own, as English and their
  // own press write them ("Bălți" is matched as written; local-names.ts turns "Prishtinës", "Nikšiću" or "Kopru" into
  // these names for a feed in that language). Their capitals come from the country table (after the US states, below).
  // Left out: names that are words elsewhere ("encamp", Italian "ordino" (I order), Dutch "koper" (copper), French "la
  // digue" (the dike), English "bled")
  'graz':             { lat: 47.0707, lng: 15.4395, country: 'AT' },
  'linz':             { lat: 48.3069, lng: 14.2858, country: 'AT' },
  'salzburg':         { lat: 47.8095, lng: 13.0550, country: 'AT' },
  'innsbruck':        { lat: 47.2692, lng: 11.4041, country: 'AT' },
  'klagenfurt':       { lat: 46.6247, lng: 14.3053, country: 'AT' },
  'villach':          { lat: 46.6103, lng: 13.8558, country: 'AT' },
  'bregenz':          { lat: 47.5031, lng: 9.7471,  country: 'AT' },
  'dornbirn':         { lat: 47.4125, lng: 9.7417,  country: 'AT' },
  'eisenstadt':       { lat: 47.8456, lng: 16.5233, country: 'AT' },
  'wiener neustadt':  { lat: 47.8151, lng: 16.2461, country: 'AT' },
  'schaan':           { lat: 47.1650, lng: 9.5097,  country: 'LI' },
  'balzers':          { lat: 47.0667, lng: 9.5000,  country: 'LI' },
  'triesen':          { lat: 47.1000, lng: 9.5333,  country: 'LI' },
  'maribor':          { lat: 46.5547, lng: 15.6459, country: 'SI' },
  'celje':            { lat: 46.2309, lng: 15.2604, country: 'SI' },
  'kranj':            { lat: 46.2389, lng: 14.3556, country: 'SI' },
  'novo mesto':       { lat: 45.8034, lng: 15.1689, country: 'SI', asWritten: 'Novo Mesto' },
  'nova gorica':      { lat: 45.9559, lng: 13.6483, country: 'SI' },
  'velenje':          { lat: 46.3592, lng: 15.1100, country: 'SI' },
  'ptuj':             { lat: 46.4200, lng: 15.8700, country: 'SI' },
  'murska sobota':    { lat: 46.6625, lng: 16.1664, country: 'SI' },
  'trieste':          { lat: 45.6495, lng: 13.7768, country: 'IT' },
  'transnistria':     { lat: 46.8403, lng: 29.6433, country: 'MD', region: 'Transnistria', name: 'Transnistria' },
  'tiraspol':         { lat: 46.8403, lng: 29.6433, country: 'MD', region: 'Transnistria' },
  'tighina':          { lat: 46.8317, lng: 29.4744, country: 'MD', region: 'Transnistria', name: 'Bender' },
  'gagauzia':         { lat: 46.3003, lng: 28.6572, country: 'MD', region: 'Gagauzia', name: 'Gagauzia' },
  'comrat':           { lat: 46.3003, lng: 28.6572, country: 'MD', region: 'Gagauzia' },
  'bălți':            { lat: 47.7617, lng: 27.9289, country: 'MD', name: 'Bălți' },
  'bălţi':            { lat: 47.7617, lng: 27.9289, country: 'MD', name: 'Bălți' },
  'cahul':            { lat: 45.9075, lng: 28.1944, country: 'MD' },
  'orhei':            { lat: 47.3831, lng: 28.8231, country: 'MD' },
  'ungheni':          { lat: 47.2108, lng: 27.8006, country: 'MD' },
  'soroca':           { lat: 48.1561, lng: 28.2975, country: 'MD' },
  'niksic':           { lat: 42.7731, lng: 18.9445, country: 'ME', name: 'Nikšić' },
  'budva':            { lat: 42.2864, lng: 18.8400, country: 'ME' },
  'herceg novi':      { lat: 42.4531, lng: 18.5375, country: 'ME' },
  'cetinje':          { lat: 42.3906, lng: 18.9142, country: 'ME' },
  'bijelo polje':     { lat: 43.0383, lng: 19.7476, country: 'ME' },
  'pljevlja':         { lat: 43.3567, lng: 19.3584, country: 'ME' },
  'ulcinj':           { lat: 41.9294, lng: 19.2244, country: 'ME' },
  'kotor':            { lat: 42.4247, lng: 18.7712, country: 'ME' },
  'tivat':            { lat: 42.4350, lng: 18.6961, country: 'ME' },
  'berane':           { lat: 42.8425, lng: 19.8733, country: 'ME' },
  'prishtina':        { lat: 42.6629, lng: 21.1655, country: 'XK', name: 'Pristina' },
  'prizren':          { lat: 42.2139, lng: 20.7397, country: 'XK' },
  'mitrovica':        { lat: 42.8914, lng: 20.8660, country: 'XK' },
  'sremska mitrovica': { lat: 44.9764, lng: 19.6122, country: 'RS' },
  'peja':             { lat: 42.6593, lng: 20.2887, country: 'XK' },
  'gjakova':          { lat: 42.3803, lng: 20.4308, country: 'XK' },
  'ferizaj':          { lat: 42.3706, lng: 21.1553, country: 'XK' },
  'gjilan':           { lat: 42.4635, lng: 21.4694, country: 'XK' },
  'podujeva':         { lat: 42.9106, lng: 21.1931, country: 'XK' },
  'vushtrri':         { lat: 42.8231, lng: 20.9675, country: 'XK' },
  'escaldes-engordany': { lat: 42.5089, lng: 1.5397, country: 'AD', name: 'Escaldes-Engordany' },
  'canillo':          { lat: 42.5676, lng: 1.5976,  country: 'AD' },
  'la massana':       { lat: 42.5450, lng: 1.5148,  country: 'AD' },
  'sant julia de loria': { lat: 42.4637, lng: 1.4913, country: 'AD', name: 'Sant Julià de Lòria' },
  'borgo maggiore':   { lat: 43.9408, lng: 12.4486, country: 'SM' },
  'domagnano':        { lat: 43.9486, lng: 12.4686, country: 'SM' },
  'rimini':           { lat: 44.0678, lng: 12.5695, country: 'IT' },
  'ilulissat':        { lat: 69.2198, lng: -51.0986, country: 'GL' },
  'sisimiut':         { lat: 66.9395, lng: -53.6735, country: 'GL' },
  'qaqortoq':         { lat: 60.7184, lng: -46.0356, country: 'GL' },
  'aasiaat':          { lat: 68.7098, lng: -52.8699, country: 'GL' },
  'maniitsoq':        { lat: 65.4167, lng: -52.9000, country: 'GL' },
  'tasiilaq':         { lat: 65.6145, lng: -37.6368, country: 'GL' },
  'kangerlussuaq':    { lat: 67.0086, lng: -50.6892, country: 'GL' },
  'narsarsuaq':       { lat: 61.1600, lng: -45.4200, country: 'GL' },
  'pituffik':         { lat: 76.5312, lng: -68.7031, country: 'GL' },
  'upernavik':        { lat: 72.7869, lng: -56.1472, country: 'GL' },
  'uummannaq':        { lat: 70.6747, lng: -52.1264, country: 'GL' },
  'paamiut':          { lat: 61.9940, lng: -49.6678, country: 'GL' },
  'nanortalik':       { lat: 60.1431, lng: -45.2400, country: 'GL' },
  'narsaq':           { lat: 60.9167, lng: -46.0500, country: 'GL' },
  'nickerie':         { lat: 5.9483,  lng: -56.9714, country: 'SR', name: 'Nieuw Nickerie' },
  'lelydorp':         { lat: 5.7000,  lng: -55.2333, country: 'SR' },
  'moengo':           { lat: 5.6167,  lng: -54.4000, country: 'SR' },
  'brokopondo':       { lat: 5.0667,  lng: -54.9833, country: 'SR' },
  'kuala belait':     { lat: 4.5833,  lng: 114.2333, country: 'BN' },
  'tutong':           { lat: 4.8028,  lng: 114.6492, country: 'BN' },
  'jerudong':         { lat: 4.9500,  lng: 114.8333, country: 'BN' },
  'temburong':        { lat: 4.7000,  lng: 115.0700, country: 'BN' },
  'betio':            { lat: 1.3570,  lng: 172.9300, country: 'KI' },
  'kiritimati':       { lat: 1.8721,  lng: -157.4278, country: 'KI' },
  'ebeye':            { lat: 8.7800,  lng: 167.7400, country: 'MH' },
  'kwajalein':        { lat: 8.7200,  lng: 167.7300, country: 'MH' },
  'bikini atoll':     { lat: 11.5833, lng: 165.3833, country: 'MH' },
  'enewetak':         { lat: 11.3500, lng: 162.3500, country: 'MH' },
  'pohnpei':          { lat: 6.8874,  lng: 158.2150, country: 'FM' },
  'chuuk':            { lat: 7.4167,  lng: 151.7833, country: 'FM' },
  'kosrae':           { lat: 5.3167,  lng: 162.9833, country: 'FM' },
  'weno':             { lat: 7.4447,  lng: 151.8617, country: 'FM' },
  'vaitupu':          { lat: -7.4800, lng: 178.6800, country: 'TV' },
  'praslin':          { lat: -4.3194, lng: 55.7392, country: 'SC' },
  'the hague':        { lat: 52.0705, lng: 4.3007,  country: 'NL' },
  // (other places that start with a capital's name: "San Salvador de Jujuy" is in Argentina)
  'san salvador de jujuy': { lat: -24.1858, lng: -65.2995, country: 'AR', name: 'San Salvador de Jujuy' },
  'santo domingo de los tsachilas': { lat: -0.2530, lng: -79.1754, country: 'EC', name: 'Santo Domingo de los Tsáchilas' },
  'santo domingo de los tsáchilas': { lat: -0.2530, lng: -79.1754, country: 'EC', name: 'Santo Domingo de los Tsáchilas' },
  // Nov 1, 2026, 1:43 AM (M64, H-0038): islands and regions headlines name plainly and the place-finder missed (Galapagos aid, a whale in the Gulf of St. Lawrence).
  // Left out on purpose: seas and straits (no one country), Kashmir, Golan Heights, Kurdistan, Patagonia, Borneo (shared or disputed), and words (Java, Labrador, Rhodes).
  'galapagos': { lat: -0.9538, lng: -90.9656, country: 'EC', name: 'Galápagos' },
  'galápagos': { lat: -0.9538, lng: -90.9656, country: 'EC', name: 'Galápagos' },
  'gulf of st. lawrence': { lat: 47.5, lng: -61.0, country: 'CA', name: 'Gulf of St. Lawrence' },
  'gulf of st lawrence': { lat: 47.5, lng: -61.0, country: 'CA', name: 'Gulf of St. Lawrence' },
  'gulf of saint lawrence': { lat: 47.5, lng: -61.0, country: 'CA', name: 'Gulf of St. Lawrence' },
  'canary islands': { lat: 28.2916, lng: -16.6291, country: 'ES', name: 'Canary Islands' },
  'tenerife': { lat: 28.2916, lng: -16.6291, country: 'ES', name: 'Tenerife' },
  'gran canaria': { lat: 27.9202, lng: -15.5474, country: 'ES', name: 'Gran Canaria' },
  'azores': { lat: 37.7412, lng: -25.6756, country: 'PT', name: 'Azores' },
  'madeira': { lat: 32.6669, lng: -16.9241, country: 'PT', name: 'Madeira', asWritten: 'Madeira' },
  'mallorca': { lat: 39.6953, lng: 3.0176, country: 'ES', name: 'Mallorca' },
  'majorca': { lat: 39.6953, lng: 3.0176, country: 'ES', name: 'Mallorca' },
  'ibiza': { lat: 38.9067, lng: 1.4206, country: 'ES', name: 'Ibiza' },
  'sardinia': { lat: 40.1209, lng: 9.0129, country: 'IT', name: 'Sardinia' },
  'crete': { lat: 35.2401, lng: 24.8093, country: 'GR', name: 'Crete', asWritten: 'Crete' },
  'corsica': { lat: 42.0396, lng: 9.0129, country: 'FR', name: 'Corsica' },
  'mykonos': { lat: 37.4467, lng: 25.3289, country: 'GR', name: 'Mykonos' },
  'santorini': { lat: 36.3932, lng: 25.4615, country: 'GR', name: 'Santorini' },
  'kyushu': { lat: 32.6, lng: 131.0, country: 'JP', name: 'Kyushu' },
  'sumatra': { lat: -0.5897, lng: 101.3431, country: 'ID', name: 'Sumatra' },
  'lombok': { lat: -8.65, lng: 116.32, country: 'ID', name: 'Lombok' },
  'bali': { lat: -8.4095, lng: 115.1889, country: 'ID', name: 'Bali' },
  'mindanao': { lat: 7.1907, lng: 125.4553, country: 'PH', name: 'Mindanao' },
  'luzon': { lat: 16.0, lng: 121.0, country: 'PH', name: 'Luzon' },
  'siberia': { lat: 60.0, lng: 105.0, country: 'RU', name: 'Siberia' },
  'sinai': { lat: 29.5, lng: 33.8, country: 'EG', name: 'Sinai' },
  'nunavut': { lat: 70.3, lng: -83.1, country: 'CA', name: 'Nunavut' },
  'yukon': { lat: 64.28, lng: -135.0, country: 'CA', name: 'Yukon' },
  'newfoundland': { lat: 48.5, lng: -56.0, country: 'CA', name: 'Newfoundland' },
  'cape breton': { lat: 46.1, lng: -60.9, country: 'CA', name: 'Cape Breton' },
  'prince edward island': { lat: 46.5, lng: -63.4, country: 'CA', name: 'Prince Edward Island' },
  'maui': { lat: 20.7984, lng: -156.3319, country: 'US', name: 'Maui' },
  'puerto rico': { lat: 18.2208, lng: -66.5901, country: 'PR', name: 'Puerto Rico' },
  'guam': { lat: 13.4443, lng: 144.7937, country: 'GU', name: 'Guam' },
  'falkland islands': { lat: -51.7963, lng: -59.5236, country: 'FK', name: 'Falkland Islands' },
  'faroe islands': { lat: 62.0, lng: -6.8, country: 'FO', name: 'Faroe Islands' },
  'svalbard': { lat: 78.22, lng: 15.65, country: 'NO', name: 'Svalbard' },
  'tahiti': { lat: -17.65, lng: -149.43, country: 'PF', name: 'Tahiti' },
  'cabo delgado': { lat: -12.3, lng: 39.0, country: 'MZ', name: 'Cabo Delgado' },
  'ituri': { lat: 1.5, lng: 29.0, country: 'CD', name: 'Ituri' },
  'rakhine': { lat: 20.1, lng: 93.5, country: 'MM', name: 'Rakhine' },
  'kordofan': { lat: 13.0, lng: 30.0, country: 'SD', name: 'Kordofan' },
  'macau': { lat: 22.1987, lng: 113.5439, country: 'MO', name: 'Macau' },
  // Nov 1, 2026, 2:30 AM (H-0037): cities that share a name with a word or a person count only with the state or country written
  // right after them ("Austin, Texas"), as headlines and datelines write them; the bare name stays unpinned.
  'austin, texas': { lat: 30.2672, lng: -97.7431, country: 'US', region: 'Texas', name: 'Austin' },
  'charlotte, north carolina': { lat: 35.2271, lng: -80.8431, country: 'US', region: 'North Carolina', name: 'Charlotte' },
  'orlando, florida': { lat: 28.5383, lng: -81.3792, country: 'US', region: 'Florida', name: 'Orlando' },
  'phoenix, arizona': { lat: 33.4484, lng: -112.074, country: 'US', region: 'Arizona', name: 'Phoenix' },
  'buffalo, new york': { lat: 42.8864, lng: -78.8784, country: 'US', region: 'New York', name: 'Buffalo' },
  'portland, oregon': { lat: 45.5152, lng: -122.6784, country: 'US', region: 'Oregon', name: 'Portland' },
  'portland, maine': { lat: 43.6591, lng: -70.2568, country: 'US', region: 'Maine', name: 'Portland' },
  'columbus, ohio': { lat: 39.9612, lng: -82.9988, country: 'US', region: 'Ohio', name: 'Columbus' },
  'hamilton, ontario': { lat: 43.2557, lng: -79.8711, country: 'CA', region: 'Ontario', name: 'Hamilton' },
  'newcastle upon tyne': { lat: 54.9783, lng: -1.6178, country: 'GB', name: 'Newcastle upon Tyne' },
  'valencia, spain': { lat: 39.4699, lng: -0.3763, country: 'ES', name: 'Valencia' },
  'santa cruz de la sierra': { lat: -17.7833, lng: -63.1821, country: 'BO', name: 'Santa Cruz de la Sierra' },
  'cordoba, argentina': { lat: -31.4201, lng: -64.1888, country: 'AR', name: 'Córdoba' },
  'córdoba, argentina': { lat: -31.4201, lng: -64.1888, country: 'AR', name: 'Córdoba' },
  'cordoba, spain': { lat: 37.8882, lng: -4.7794, country: 'ES', name: 'Córdoba' },
  'córdoba, spain': { lat: 37.8882, lng: -4.7794, country: 'ES', name: 'Córdoba' },
  'nice, france': { lat: 43.7102, lng: 7.262, country: 'FR', name: 'Nice' },
  'split, croatia': { lat: 43.5081, lng: 16.4402, country: 'HR', name: 'Split' },
  'tyre, lebanon': { lat: 33.2705, lng: 35.2038, country: 'LB', name: 'Tyre' },
  'gao, mali': { lat: 16.2717, lng: -0.0447, country: 'ML', name: 'Gao' },
  'cali, colombia': { lat: 3.4516, lng: -76.532, country: 'CO', name: 'Cali' },
  // Nov 1, 2026, 11:50 AM (H-0037, second slice): more cities that are also words or names, with the state or country right after them
  'springfield, illinois': { lat: 39.7817, lng: -89.6501, country: 'US', region: 'Illinois', name: 'Springfield' },
  'jackson, mississippi': { lat: 32.2988, lng: -90.1848, country: 'US', region: 'Mississippi', name: 'Jackson' },
  'salem, oregon': { lat: 44.9429, lng: -123.0351, country: 'US', region: 'Oregon', name: 'Salem' },
  'columbia, south carolina': { lat: 34.0007, lng: -81.0348, country: 'US', region: 'South Carolina', name: 'Columbia' },
  'lincoln, nebraska': { lat: 40.8136, lng: -96.7026, country: 'US', region: 'Nebraska', name: 'Lincoln' },
  'madison, wisconsin': { lat: 43.0731, lng: -89.4012, country: 'US', region: 'Wisconsin', name: 'Madison' },
  'augusta, georgia': { lat: 33.4735, lng: -82.0105, country: 'US', region: 'Georgia', name: 'Augusta' },
  'mobile, alabama': { lat: 30.6954, lng: -88.0399, country: 'US', region: 'Alabama', name: 'Mobile' },
  'birmingham, alabama': { lat: 33.5186, lng: -86.8104, country: 'US', region: 'Alabama', name: 'Birmingham' },
  'birmingham, england': { lat: 52.4862, lng: -1.8904, country: 'GB', name: 'Birmingham' },
  'bristol, england': { lat: 51.4545, lng: -2.5879, country: 'GB', name: 'Bristol' },
  'cambridge, massachusetts': { lat: 42.3736, lng: -71.1097, country: 'US', region: 'Massachusetts', name: 'Cambridge' },
  'richmond, virginia': { lat: 37.5407, lng: -77.436, country: 'US', region: 'Virginia', name: 'Richmond' },
  'aurora, colorado': { lat: 39.7294, lng: -104.8319, country: 'US', region: 'Colorado', name: 'Aurora' },
  'kansas city, missouri': { lat: 39.0997, lng: -94.5786, country: 'US', region: 'Missouri', name: 'Kansas City' },
  'santa fe, new mexico': { lat: 35.687, lng: -105.9378, country: 'US', region: 'New Mexico', name: 'Santa Fe' },
  'granada, spain': { lat: 37.1773, lng: -3.5986, country: 'ES', name: 'Granada' },
  'perth, australia': { lat: -31.9505, lng: 115.8605, country: 'AU', region: 'Western Australia', name: 'Perth' },
  'merida, mexico': { lat: 20.9674, lng: -89.5926, country: 'MX', region: 'Yucatán', name: 'Mérida' },
  'mérida, mexico': { lat: 20.9674, lng: -89.5926, country: 'MX', region: 'Yucatán', name: 'Mérida' },
  'victoria, british columbia': { lat: 48.4284, lng: -123.3656, country: 'CA', region: 'British Columbia', name: 'Victoria' },
  'kingston, jamaica': { lat: 17.9712, lng: -76.7936, country: 'JM', name: 'Kingston' },
  'san juan, puerto rico': { lat: 18.4655, lng: -66.1057, country: 'PR', name: 'San Juan' },
  'san jose, costa rica': { lat: 9.9281, lng: -84.0907, country: 'CR', name: 'San José' },
  'san josé, costa rica': { lat: 9.9281, lng: -84.0907, country: 'CR', name: 'San José' },
  'san jose, california': { lat: 37.3382, lng: -121.8863, country: 'US', region: 'California', name: 'San Jose' },
  'san josé, california': { lat: 37.3382, lng: -121.8863, country: 'US', region: 'California', name: 'San José' },
  // Nov 1, 2026, 5:50 PM (H-0037, third slice): more cities that are also words or names, with the state or country right after them
  'santa cruz, california': { lat: 36.9741, lng: -122.0308, country: 'US', region: 'California', name: 'Santa Cruz' },
  'newcastle, england': { lat: 54.9783, lng: -1.6178, country: 'GB', name: 'Newcastle' },
  'orange, california': { lat: 33.7879, lng: -117.8531, country: 'US', region: 'California', name: 'Orange' },
  'reading, england': { lat: 51.4543, lng: -0.9781, country: 'GB', name: 'Reading' },
  'durham, north carolina': { lat: 35.994, lng: -78.8986, country: 'US', region: 'North Carolina', name: 'Durham' },
  'lancaster, pennsylvania': { lat: 40.0379, lng: -76.3055, country: 'US', region: 'Pennsylvania', name: 'Lancaster' },
  'lancaster, england': { lat: 54.0466, lng: -2.8007, country: 'GB', name: 'Lancaster' },
  'independence, missouri': { lat: 39.0911, lng: -94.4155, country: 'US', region: 'Missouri', name: 'Independence' },
  'alexandria, virginia': { lat: 38.8048, lng: -77.0469, country: 'US', region: 'Virginia', name: 'Alexandria' },
  'athens, georgia': { lat: 33.9519, lng: -83.3576, country: 'US', region: 'Georgia', name: 'Athens' },
  'troy, new york': { lat: 42.7284, lng: -73.6918, country: 'US', region: 'New York', name: 'Troy' },
  'bath, england': { lat: 51.3811, lng: -2.359, country: 'GB', name: 'Bath' },
  'derby, england': { lat: 52.9225, lng: -1.4746, country: 'GB', name: 'Derby' },
  'lincoln, england': { lat: 53.2307, lng: -0.5406, country: 'GB', name: 'Lincoln' },
  'salisbury, england': { lat: 51.0688, lng: -1.7945, country: 'GB', name: 'Salisbury' },
  'worcester, massachusetts': { lat: 42.2626, lng: -71.8023, country: 'US', region: 'Massachusetts', name: 'Worcester' },
  'rochester, new york': { lat: 43.1566, lng: -77.6088, country: 'US', region: 'New York', name: 'Rochester' },
  'jackson, tennessee': { lat: 35.6145, lng: -88.8139, country: 'US', region: 'Tennessee', name: 'Jackson' },
  'florence, alabama': { lat: 34.7998, lng: -87.6773, country: 'US', region: 'Alabama', name: 'Florence' },
  'lima, ohio': { lat: 40.7426, lng: -84.1052, country: 'US', region: 'Ohio', name: 'Lima' },
  'chester, england': { lat: 53.1905, lng: -2.8908, country: 'GB', name: 'Chester' },
  'york, england': { lat: 53.959, lng: -1.0815, country: 'GB', name: 'York' },
  'preston, england': { lat: 53.7632, lng: -2.7031, country: 'GB', name: 'Preston' },
  'hull, england': { lat: 53.7457, lng: -0.3367, country: 'GB', name: 'Hull' },
  'santiago, dominican republic': { lat: 19.4517, lng: -70.697, country: 'DO', name: 'Santiago' },
  // Nov 2, 2026, 2:50 AM (H-0037, fourth slice): more cities that are also words or names, with the state or country right after them
  'dover, delaware': { lat: 39.1582, lng: -75.5244, country: 'US', region: 'Delaware', name: 'Dover' },
  'dover, england': { lat: 51.1279, lng: 1.3134, country: 'GB', name: 'Dover' },
  'charleston, south carolina': { lat: 32.7765, lng: -79.9311, country: 'US', region: 'South Carolina', name: 'Charleston' },
  'charleston, west virginia': { lat: 38.3498, lng: -81.6326, country: 'US', region: 'West Virginia', name: 'Charleston' },
  'providence, rhode island': { lat: 41.824, lng: -71.4128, country: 'US', region: 'Rhode Island', name: 'Providence' },
  'hamilton, canada': { lat: 43.2557, lng: -79.8711, country: 'CA', region: 'Ontario', name: 'Hamilton' },
  'hamilton, new zealand': { lat: -37.787, lng: 175.2793, country: 'NZ', name: 'Hamilton' },
  'perth, scotland': { lat: 56.3950, lng: -3.4308, country: 'GB', name: 'Perth' },
  'wells, england': { lat: 51.2094, lng: -2.6475, country: 'GB', name: 'Wells' },
  'ely, england': { lat: 52.3989, lng: 0.2624, country: 'GB', name: 'Ely' },
  'bury, england': { lat: 53.5933, lng: -2.2966, country: 'GB', name: 'Bury' },
  'wigan, england': { lat: 53.5448, lng: -2.6318, country: 'GB', name: 'Wigan' },
  'rugby, england': { lat: 52.3709, lng: -1.2652, country: 'GB', name: 'Rugby' },
  'stafford, england': { lat: 52.8052, lng: -2.1163, country: 'GB', name: 'Stafford' },
  'luton, england': { lat: 51.8787, lng: -0.42, country: 'GB', name: 'Luton' },
  'windsor, england': { lat: 51.4816, lng: -0.6044, country: 'GB', name: 'Windsor' },
  'windsor, ontario': { lat: 42.3149, lng: -83.0364, country: 'CA', region: 'Ontario', name: 'Windsor' },
  'salem, massachusetts': { lat: 42.5195, lng: -70.8967, country: 'US', region: 'Massachusetts', name: 'Salem' },
  'peoria, illinois': { lat: 40.6936, lng: -89.589, country: 'US', region: 'Illinois', name: 'Peoria' },
  'elgin, illinois': { lat: 42.0354, lng: -88.2826, country: 'US', region: 'Illinois', name: 'Elgin' },
  'toledo, ohio': { lat: 41.6528, lng: -83.5379, country: 'US', region: 'Ohio', name: 'Toledo' },
  'cambridge, england': { lat: 52.2053, lng: 0.1218, country: 'GB', name: 'Cambridge' },
  'oxford, england': { lat: 51.752, lng: -1.2577, country: 'GB', name: 'Oxford' },
  // Nov 2, 2026, 9:40 AM (M64 follow-up): second cities of francophone Africa, Uganda, Madagascar and Panama seen in live stories with no pin
  'ntoum': { lat: 0.3905, lng: 9.7617, country: 'GA', name: 'Ntoum' },
  'port-gentil': { lat: -0.7193, lng: 8.7815, country: 'GA', name: 'Port-Gentil' },
  'franceville': { lat: -1.6333, lng: 13.5836, country: 'GA', name: 'Franceville' },
  'oyem': { lat: 1.5995, lng: 11.5793, country: 'GA', name: 'Oyem' },
  'koudougou': { lat: 12.2526, lng: -2.3627, country: 'BF', name: 'Koudougou' },
  'banfora': { lat: 10.6333, lng: -4.7667, country: 'BF', name: 'Banfora' },
  'ouahigouya': { lat: 13.5828, lng: -2.4216, country: 'BF', name: 'Ouahigouya' },
  'sikasso': { lat: 11.3176, lng: -5.6665, country: 'ML', name: 'Sikasso' },
  'kayes': { lat: 14.4469, lng: -11.4445, country: 'ML', name: 'Kayes' },
  'mopti': { lat: 14.4843, lng: -4.183, country: 'ML', name: 'Mopti' },
  'segou': { lat: 13.4317, lng: -6.2157, country: 'ML', name: 'Ségou' },
  'ségou': { lat: 13.4317, lng: -6.2157, country: 'ML', name: 'Ségou' },
  'kidal': { lat: 18.4411, lng: 1.4078, country: 'ML', name: 'Kidal' },
  'maradi': { lat: 13.5, lng: 7.1017, country: 'NE', name: 'Maradi' },
  'tahoua': { lat: 14.8888, lng: 5.2692, country: 'NE', name: 'Tahoua' },
  'thies': { lat: 14.791, lng: -16.9359, country: 'SN', name: 'Thiès' },
  'thiès': { lat: 14.791, lng: -16.9359, country: 'SN', name: 'Thiès' },
  'touba': { lat: 14.85, lng: -15.8833, country: 'SN', name: 'Touba' },
  'kaolack': { lat: 14.1652, lng: -16.0726, country: 'SN', name: 'Kaolack' },
  'ziguinchor': { lat: 12.5833, lng: -16.2719, country: 'SN', name: 'Ziguinchor' },
  'tambacounda': { lat: 13.7707, lng: -13.6673, country: 'SN', name: 'Tambacounda' },
  'kankan': { lat: 10.3854, lng: -9.3057, country: 'GN', name: 'Kankan' },
  'nzerekore': { lat: 7.7562, lng: -8.8179, country: 'GN', name: 'Nzerekore' },
  'kindia': { lat: 10.0569, lng: -12.8658, country: 'GN', name: 'Kindia' },
  'korhogo': { lat: 9.458, lng: -5.6296, country: 'CI', name: 'Korhogo' },
  'daloa': { lat: 6.8774, lng: -6.4502, country: 'CI', name: 'Daloa' },
  'parakou': { lat: 9.337, lng: 2.6303, country: 'BJ', name: 'Parakou' },
  'abomey-calavi': { lat: 6.4486, lng: 2.3556, country: 'BJ', name: 'Abomey-Calavi' },
  'sokode': { lat: 8.9833, lng: 1.1333, country: 'TG', name: 'Sokode' },
  'garoua': { lat: 9.3014, lng: 13.3977, country: 'CM', name: 'Garoua' },
  'maroua': { lat: 10.591, lng: 14.3159, country: 'CM', name: 'Maroua' },
  'bamenda': { lat: 5.9597, lng: 10.146, country: 'CM', name: 'Bamenda' },
  'bafoussam': { lat: 5.4737, lng: 10.4179, country: 'CM', name: 'Bafoussam' },
  'bertoua': { lat: 4.5772, lng: 13.6847, country: 'CM', name: 'Bertoua' },
  'ngaoundere': { lat: 7.3167, lng: 13.5833, country: 'CM', name: 'Ngaoundere' },
  'buea': { lat: 4.1527, lng: 9.241, country: 'CM', name: 'Buea' },
  'kribi': { lat: 2.94, lng: 9.91, country: 'CM', name: 'Kribi' },
  'mbuji-mayi': { lat: -6.136, lng: 23.5898, country: 'CD', name: 'Mbuji-Mayi' },
  'kolwezi': { lat: -10.7148, lng: 25.4666, country: 'CD', name: 'Kolwezi' },
  'uvira': { lat: -3.3758, lng: 29.1383, country: 'CD', name: 'Uvira' },
  'butembo': { lat: 0.1167, lng: 29.2833, country: 'CD', name: 'Butembo' },
  'bunia': { lat: 1.5659, lng: 30.252, country: 'CD', name: 'Bunia' },
  'kananga': { lat: -5.8962, lng: 22.4166, country: 'CD', name: 'Kananga' },
  'kalemie': { lat: -5.9475, lng: 29.1947, country: 'CD', name: 'Kalemie' },
  'mbandaka': { lat: 0.0487, lng: 18.2603, country: 'CD', name: 'Mbandaka' },
  'gulu': { lat: 2.7746, lng: 32.299, country: 'UG', name: 'Gulu' },
  'entebbe': { lat: 0.0512, lng: 32.4637, country: 'UG', name: 'Entebbe' },
  'jinja': { lat: 0.4244, lng: 33.2041, country: 'UG', name: 'Jinja' },
  'mbarara': { lat: -0.6072, lng: 30.6545, country: 'UG', name: 'Mbarara' },
  'arua': { lat: 3.0201, lng: 30.911, country: 'UG', name: 'Arua' },
  'mbale': { lat: 1.0775, lng: 34.175, country: 'UG', name: 'Mbale' },
  'nampula': { lat: -15.1165, lng: 39.2666, country: 'MZ', name: 'Nampula' },
  'quelimane': { lat: -17.8786, lng: 36.8883, country: 'MZ', name: 'Quelimane' },
  'mzuzu': { lat: -11.4656, lng: 34.0207, country: 'MW', name: 'Mzuzu' },
  'toamasina': { lat: -18.1492, lng: 49.4023, country: 'MG', name: 'Toamasina' },
  'mahajanga': { lat: -15.7167, lng: 46.3167, country: 'MG', name: 'Mahajanga' },
  'antsirabe': { lat: -19.8659, lng: 47.0333, country: 'MG', name: 'Antsirabe' },
  'fianarantsoa': { lat: -21.4527, lng: 47.0857, country: 'MG', name: 'Fianarantsoa' },
  'chitre': { lat: 7.9627, lng: -80.4297, country: 'PA', name: 'Chitre' },
  'tocumen': { lat: 9.0714, lng: -79.3834, country: 'PA', name: 'Tocumen' },
  'la chorrera': { lat: 8.8801, lng: -79.7833, country: 'PA', name: 'La Chorrera' },
  'bocas del toro': { lat: 9.3403, lng: -82.2418, country: 'PA', name: 'Bocas Del Toro' },
  'darien gap': { lat: 8.0, lng: -77.9, country: 'PA', name: 'Darién Gap' },
  'darién gap': { lat: 8.0, lng: -77.9, country: 'PA', name: 'Darién Gap' },
  'colon, panama': { lat: 9.3592, lng: -79.9014, country: 'PA', name: 'Colon' },
  'david, panama': { lat: 8.4273, lng: -82.4308, country: 'PA', name: 'David' },
  // Nov 2, 2026, 5:50 PM (M67): second cities of East Africa, the Horn, Central Asia, the Caucasus and southern Africa that gave no pin
  'malindi': { lat: -3.2175, lng: 40.1191, country: 'KE', name: 'Malindi' },
  'lamu': { lat: -2.2717, lng: 40.902, country: 'KE', name: 'Lamu' },
  'garissa': { lat: -0.4532, lng: 39.6461, country: 'KE', name: 'Garissa' },
  'kitale': { lat: 1.0157, lng: 35.0062, country: 'KE', name: 'Kitale' },
  'nyeri': { lat: -0.4201, lng: 36.9476, country: 'KE', name: 'Nyeri' },
  'thika': { lat: -1.0333, lng: 37.0693, country: 'KE', name: 'Thika', asWritten: 'Thika' },
  'naivasha': { lat: -0.7172, lng: 36.431, country: 'KE', name: 'Naivasha' },
  'morogoro': { lat: -6.8211, lng: 37.6595, country: 'TZ', name: 'Morogoro' },
  'mbeya': { lat: -8.9094, lng: 33.4608, country: 'TZ', name: 'Mbeya' },
  'kigoma': { lat: -4.8769, lng: 29.6267, country: 'TZ', name: 'Kigoma' },
  'musanze': { lat: -1.4998, lng: 29.6344, country: 'RW', name: 'Musanze' },
  'butare': { lat: -2.5967, lng: 29.7394, country: 'RW', name: 'Butare' },
  'bujumbura': { lat: -3.3614, lng: 29.3599, country: 'BI', name: 'Bujumbura' },
  'berbera': { lat: 10.4396, lng: 45.0143, country: 'SO', name: 'Berbera' },
  'baidoa': { lat: 3.1138, lng: 43.6498, country: 'SO', name: 'Baidoa' },
  'garowe': { lat: 8.4054, lng: 48.4845, country: 'SO', name: 'Garowe' },
  'galkayo': { lat: 6.7697, lng: 47.4308, country: 'SO', name: 'Galkayo' },
  'dire dawa': { lat: 9.6009, lng: 41.8501, country: 'ET', name: 'Dire Dawa' },
  'hawassa': { lat: 7.0504, lng: 38.4955, country: 'ET', name: 'Hawassa' },
  'jimma': { lat: 7.6733, lng: 36.8344, country: 'ET', name: 'Jimma' },
  'harar': { lat: 9.3126, lng: 42.118, country: 'ET', name: 'Harar' },
  'lalibela': { lat: 12.0319, lng: 39.0473, country: 'ET', name: 'Lalibela' },
  'aksum': { lat: 14.1211, lng: 38.7228, country: 'ET', name: 'Aksum' },
  'gambela': { lat: 8.25, lng: 34.5833, country: 'ET', name: 'Gambela' },
  'kassala': { lat: 15.451, lng: 36.4, country: 'SD', name: 'Kassala' },
  'wad madani': { lat: 14.4012, lng: 33.5199, country: 'SD', name: 'Wad Madani' },
  'malakal': { lat: 9.5334, lng: 31.6605, country: 'SS', name: 'Malakal' },
  'bentiu': { lat: 9.2333, lng: 29.8333, country: 'SS', name: 'Bentiu' },
  'yei': { lat: 4.0947, lng: 30.678, country: 'SS', name: 'Yei' },
  'massawa': { lat: 15.6097, lng: 39.4745, country: 'ER', name: 'Massawa' },
  'aktobe': { lat: 50.2839, lng: 57.167, country: 'KZ', name: 'Aktobe' },
  'atyrau': { lat: 47.0945, lng: 51.9238, country: 'KZ', name: 'Atyrau' },
  'aktau': { lat: 43.65, lng: 51.15, country: 'KZ', name: 'Aktau' },
  'pavlodar': { lat: 52.2873, lng: 76.9674, country: 'KZ', name: 'Pavlodar' },
  'semey': { lat: 50.4111, lng: 80.2275, country: 'KZ', name: 'Semey' },
  'oskemen': { lat: 49.9714, lng: 82.6059, country: 'KZ', name: 'Oskemen' },
  'taraz': { lat: 42.9, lng: 71.3667, country: 'KZ', name: 'Taraz' },
  'kostanay': { lat: 53.2144, lng: 63.6246, country: 'KZ', name: 'Kostanay' },
  'turkistan': { lat: 43.2973, lng: 68.2518, country: 'KZ', name: 'Turkistan' },
  'bukhara': { lat: 39.7747, lng: 64.4286, country: 'UZ', name: 'Bukhara' },
  'namangan': { lat: 40.9983, lng: 71.6726, country: 'UZ', name: 'Namangan' },
  'andijan': { lat: 40.7821, lng: 72.3442, country: 'UZ', name: 'Andijan' },
  'fergana': { lat: 40.3864, lng: 71.7864, country: 'UZ', name: 'Fergana' },
  'nukus': { lat: 42.4531, lng: 59.6103, country: 'UZ', name: 'Nukus' },
  'khiva': { lat: 41.3783, lng: 60.3639, country: 'UZ', name: 'Khiva' },
  'termez': { lat: 37.2242, lng: 67.2783, country: 'UZ', name: 'Termez' },
  'osh': { lat: 40.5283, lng: 72.7985, country: 'KG', name: 'Osh' },
  'jalal-abad': { lat: 40.9333, lng: 72.9833, country: 'KG', name: 'Jalal-Abad' },
  'karakol': { lat: 42.4907, lng: 78.3936, country: 'KG', name: 'Karakol' },
  'khujand': { lat: 40.2826, lng: 69.6222, country: 'TJ', name: 'Khujand' },
  'khorog': { lat: 37.4894, lng: 71.5531, country: 'TJ', name: 'Khorog' },
  'kulob': { lat: 37.9146, lng: 69.7845, country: 'TJ', name: 'Kulob' },
  'turkmenabat': { lat: 39.0733, lng: 63.5786, country: 'TM', name: 'Turkmenabat' },
  'dashoguz': { lat: 41.8363, lng: 59.9666, country: 'TM', name: 'Dashoguz' },
  'turkmenbashi': { lat: 40.0225, lng: 52.955, country: 'TM', name: 'Turkmenbashi' },
  // ("ganja" is also the plant: only with the country after it)
  'ganja, azerbaijan': { lat: 40.6828, lng: 46.3606, country: 'AZ', name: 'Ganja' },
  'ganja city': { lat: 40.6828, lng: 46.3606, country: 'AZ', name: 'Ganja' },
  'sumqayit': { lat: 40.5855, lng: 49.6317, country: 'AZ', name: 'Sumqayit' },
  'gyumri': { lat: 40.7942, lng: 43.8453, country: 'AM', name: 'Gyumri' },
  'vanadzor': { lat: 40.8128, lng: 44.4883, country: 'AM', name: 'Vanadzor' },
  'kutaisi': { lat: 42.2679, lng: 42.6946, country: 'GE', name: 'Kutaisi' },
  'poti': { lat: 42.1462, lng: 41.6719, country: 'GE', name: 'Poti', asWritten: 'Poti' },
  'zugdidi': { lat: 42.5088, lng: 41.8709, country: 'GE', name: 'Zugdidi' },
  'zomba': { lat: -15.3833, lng: 35.3333, country: 'MW', name: 'Zomba' },
  'kabwe': { lat: -14.4469, lng: 28.4464, country: 'ZM', name: 'Kabwe' },
  'mongu': { lat: -15.2484, lng: 23.1274, country: 'ZM', name: 'Mongu' },
  'mutare': { lat: -18.9707, lng: 32.6709, country: 'ZW', name: 'Mutare', asWritten: 'Mutare' },
  'gweru': { lat: -19.45, lng: 29.8167, country: 'ZW', name: 'Gweru' },
  'masvingo': { lat: -20.0637, lng: 30.8277, country: 'ZW', name: 'Masvingo' },
  'kariba': { lat: -16.5167, lng: 28.8, country: 'ZW', name: 'Kariba' },
  'lichinga': { lat: -13.3128, lng: 35.2406, country: 'MZ', name: 'Lichinga' },
  'walvis bay': { lat: -22.9576, lng: 14.5053, country: 'NA', name: 'Walvis Bay' },
  'swakopmund': { lat: -22.6792, lng: 14.5272, country: 'NA', name: 'Swakopmund' },
  'francistown': { lat: -21.17, lng: 27.507, country: 'BW', name: 'Francistown' },
  // Nov 2, 2026, 11:42 PM (M68): second cities of South America, Central America, Mexico, Cuba and Haiti that gave no pin (a plain name that is also a word, person or other town needs its country after it)
  'chiclayo': { lat: -6.7714, lng: -79.8409, country: 'PE', name: 'Chiclayo' },
  'piura': { lat: -5.1945, lng: -80.6328, country: 'PE', name: 'Piura' },
  'iquitos': { lat: -3.7491, lng: -73.2538, country: 'PE', name: 'Iquitos' },
  'huancayo': { lat: -12.0651, lng: -75.2049, country: 'PE', name: 'Huancayo' },
  'ayacucho': { lat: -13.1588, lng: -74.2232, country: 'PE', name: 'Ayacucho' },
  'cajamarca': { lat: -7.1638, lng: -78.5003, country: 'PE', name: 'Cajamarca' },
  'tarija': { lat: -21.5355, lng: -64.7296, country: 'BO', name: 'Tarija' },
  'oruro': { lat: -17.9647, lng: -67.1061, country: 'BO', name: 'Oruro' },
  'potosí': { lat: -19.5836, lng: -65.7531, country: 'BO', name: 'Potosí' },
  'potosi': { lat: -19.5836, lng: -65.7531, country: 'BO', name: 'Potosí' },
  'esmeraldas': { lat: 0.9592, lng: -79.6539, country: 'EC', name: 'Esmeraldas' },
  'machala': { lat: -3.2581, lng: -79.9554, country: 'EC', name: 'Machala' },
  'ambato': { lat: -1.2417, lng: -78.6197, country: 'EC', name: 'Ambato' },
  'bucaramanga': { lat: 7.1254, lng: -73.1198, country: 'CO', name: 'Bucaramanga' },
  'cúcuta': { lat: 7.8939, lng: -72.5078, country: 'CO', name: 'Cúcuta' },
  'santa marta': { lat: 11.2408, lng: -74.199, country: 'CO', name: 'Santa Marta' },
  'manizales': { lat: 5.0689, lng: -75.5174, country: 'CO', name: 'Manizales' },
  'buenaventura': { lat: 3.8801, lng: -77.0312, country: 'CO', name: 'Buenaventura' },
  'tumaco': { lat: 1.7986, lng: -78.8156, country: 'CO', name: 'Tumaco' },
  'villavicencio': { lat: 4.142, lng: -73.6266, country: 'CO', name: 'Villavicencio' },
  'montería': { lat: 8.7479, lng: -75.8814, country: 'CO', name: 'Montería' },
  'monteria': { lat: 8.7479, lng: -75.8814, country: 'CO', name: 'Montería' },
  'popayán': { lat: 2.4448, lng: -76.6147, country: 'CO', name: 'Popayán' },
  'popayan': { lat: 2.4448, lng: -76.6147, country: 'CO', name: 'Popayán' },
  'ibague': { lat: 4.4389, lng: -75.2322, country: 'CO', name: 'Ibagué' },
  'ibagué': { lat: 4.4389, lng: -75.2322, country: 'CO', name: 'Ibagué' },
  'maracay': { lat: 10.2469, lng: -67.5958, country: 'VE', name: 'Maracay' },
  'ciudad guayana': { lat: 8.3535, lng: -62.6527, country: 'VE', name: 'Ciudad Guayana' },
  'maturin': { lat: 9.7457, lng: -63.1832, country: 'VE', name: 'Maturín' },
  'maturín': { lat: 9.7457, lng: -63.1832, country: 'VE', name: 'Maturín' },
  'tucumán': { lat: -26.8083, lng: -65.2176, country: 'AR', name: 'Tucumán' },
  'tucuman': { lat: -26.8083, lng: -65.2176, country: 'AR', name: 'Tucumán' },
  'mar del plata': { lat: -38.0055, lng: -57.5426, country: 'AR', name: 'Mar del Plata' },
  'bariloche': { lat: -41.1335, lng: -71.3103, country: 'AR', name: 'Bariloche' },
  'neuquén': { lat: -38.9516, lng: -68.0591, country: 'AR', name: 'Neuquén' },
  'neuquen': { lat: -38.9516, lng: -68.0591, country: 'AR', name: 'Neuquén' },
  'ushuaia': { lat: -54.8019, lng: -68.303, country: 'AR', name: 'Ushuaia' },
  'jujuy': { lat: -24.1858, lng: -65.2995, country: 'AR', name: 'Jujuy' },
  'bahía blanca': { lat: -38.7196, lng: -62.2724, country: 'AR', name: 'Bahía Blanca' },
  'bahia blanca': { lat: -38.7196, lng: -62.2724, country: 'AR', name: 'Bahía Blanca' },
  'antofagasta': { lat: -23.6509, lng: -70.3975, country: 'CL', name: 'Antofagasta' },
  'temuco': { lat: -38.7359, lng: -72.5904, country: 'CL', name: 'Temuco' },
  'iquique': { lat: -20.2307, lng: -70.1357, country: 'CL', name: 'Iquique' },
  'punta arenas': { lat: -53.1638, lng: -70.9171, country: 'CL', name: 'Punta Arenas' },
  'rancagua': { lat: -34.1708, lng: -70.7444, country: 'CL', name: 'Rancagua' },
  'puerto montt': { lat: -41.4693, lng: -72.9424, country: 'CL', name: 'Puerto Montt' },
  'calama': { lat: -22.4544, lng: -68.9294, country: 'CL', name: 'Calama' },
  'ciudad del este': { lat: -25.5095, lng: -54.6112, country: 'PY', name: 'Ciudad del Este' },
  'encarnacion': { lat: -27.3306, lng: -55.8667, country: 'PY', name: 'Encarnación' },
  'encarnación': { lat: -27.3306, lng: -55.8667, country: 'PY', name: 'Encarnación' },
  'punta del este': { lat: -34.9628, lng: -54.9506, country: 'UY', name: 'Punta del Este' },
  'belem': { lat: -1.4558, lng: -48.5044, country: 'BR', name: 'Belém', asWritten: 'Belem' },
  'belém': { lat: -1.4558, lng: -48.5044, country: 'BR', name: 'Belém', asWritten: 'Belém' },
  'goiania': { lat: -16.6869, lng: -49.2648, country: 'BR', name: 'Goiânia' },
  'goiânia': { lat: -16.6869, lng: -49.2648, country: 'BR', name: 'Goiânia' },
  'campinas': { lat: -22.9099, lng: -47.0626, country: 'BR', name: 'Campinas' },
  'florianópolis': { lat: -27.5954, lng: -48.548, country: 'BR', name: 'Florianópolis' },
  'florianopolis': { lat: -27.5954, lng: -48.548, country: 'BR', name: 'Florianópolis' },
  'cuiabá': { lat: -15.601, lng: -56.0974, country: 'BR', name: 'Cuiabá' },
  'cuiaba': { lat: -15.601, lng: -56.0974, country: 'BR', name: 'Cuiabá' },
  'campo grande, brazil': { lat: -20.4697, lng: -54.6201, country: 'BR', name: 'Campo Grande' },
  'são luís': { lat: -2.5307, lng: -44.3068, country: 'BR', name: 'São Luís' },
  'sao luis': { lat: -2.5307, lng: -44.3068, country: 'BR', name: 'São Luís' },
  'maceió': { lat: -9.6658, lng: -35.7353, country: 'BR', name: 'Maceió' },
  'maceio': { lat: -9.6658, lng: -35.7353, country: 'BR', name: 'Maceió' },
  'teresina': { lat: -5.0892, lng: -42.8019, country: 'BR', name: 'Teresina' },
  'joinville': { lat: -26.3045, lng: -48.8487, country: 'BR', name: 'Joinville' },
  'ribeirão preto': { lat: -21.1775, lng: -47.8103, country: 'BR', name: 'Ribeirão Preto' },
  'ribeirao preto': { lat: -21.1775, lng: -47.8103, country: 'BR', name: 'Ribeirão Preto' },
  'foz do iguaçu': { lat: -25.5163, lng: -54.5854, country: 'BR', name: 'Foz do Iguaçu' },
  'foz do iguacu': { lat: -25.5163, lng: -54.5854, country: 'BR', name: 'Foz do Iguaçu' },
  'porto velho': { lat: -8.7612, lng: -63.9004, country: 'BR', name: 'Porto Velho', asWritten: 'Porto Velho' },
  'macapa': { lat: 0.0349, lng: -51.0694, country: 'BR', name: 'Macapá' },
  'macapá': { lat: 0.0349, lng: -51.0694, country: 'BR', name: 'Macapá' },
  'quetzaltenango': { lat: 14.8347, lng: -91.5181, country: 'GT', name: 'Quetzaltenango' },
  'escuintla': { lat: 14.3011, lng: -90.7858, country: 'GT', name: 'Escuintla' },
  'la ceiba': { lat: 15.7597, lng: -86.7822, country: 'HN', name: 'La Ceiba' },
  'choluteca': { lat: 13.3003, lng: -87.1912, country: 'HN', name: 'Choluteca' },
  'matagalpa': { lat: 12.9256, lng: -85.9175, country: 'NI', name: 'Matagalpa' },
  'bluefields': { lat: 11.9922, lng: -83.7692, country: 'NI', name: 'Bluefields' },
  'puntarenas': { lat: 9.9763, lng: -84.8384, country: 'CR', name: 'Puntarenas' },
  'alajuela': { lat: 10.0163, lng: -84.2116, country: 'CR', name: 'Alajuela' },
  'puerto plata': { lat: 19.7934, lng: -70.6884, country: 'DO', name: 'Puerto Plata' },
  'punta cana': { lat: 18.582, lng: -68.4055, country: 'DO', name: 'Punta Cana' },
  'santiago de los caballeros': { lat: 19.4517, lng: -70.697, country: 'DO', name: 'Santiago de los Caballeros' },
  'cap-haitien': { lat: 19.7578, lng: -72.2042, country: 'HT', name: 'Cap-Haïtien' },
  'cap-haïtien': { lat: 19.7578, lng: -72.2042, country: 'HT', name: 'Cap-Haïtien' },
  'gonaïves': { lat: 19.4511, lng: -72.6892, country: 'HT', name: 'Gonaïves' },
  'gonaives': { lat: 19.4511, lng: -72.6892, country: 'HT', name: 'Gonaïves' },
  'les cayes': { lat: 18.2, lng: -73.75, country: 'HT', name: 'Les Cayes' },
  'jacmel': { lat: 18.2342, lng: -72.5347, country: 'HT', name: 'Jacmel' },
  'camagüey': { lat: 21.3808, lng: -77.9169, country: 'CU', name: 'Camagüey' },
  'camaguey': { lat: 21.3808, lng: -77.9169, country: 'CU', name: 'Camagüey' },
  'santiago de cuba': { lat: 20.0247, lng: -75.8219, country: 'CU', name: 'Santiago de Cuba' },
  'holguin': { lat: 20.8872, lng: -76.2631, country: 'CU', name: 'Holguín' },
  'holguín': { lat: 20.8872, lng: -76.2631, country: 'CU', name: 'Holguín' },
  'matanzas': { lat: 23.0411, lng: -81.5775, country: 'CU', name: 'Matanzas' },
  'varadero': { lat: 23.1539, lng: -81.2511, country: 'CU', name: 'Varadero' },
  'guantánamo': { lat: 20.1444, lng: -75.2092, country: 'CU', name: 'Guantánamo' },
  'guantanamo': { lat: 20.1444, lng: -75.2092, country: 'CU', name: 'Guantánamo' },
  'montego bay': { lat: 18.4762, lng: -77.8939, country: 'JM', name: 'Montego Bay' },
  'hermosillo': { lat: 29.0729, lng: -110.9559, country: 'MX', name: 'Hermosillo' },
  'mexicali': { lat: 32.6245, lng: -115.4523, country: 'MX', name: 'Mexicali' },
  'reynosa': { lat: 26.0923, lng: -98.2776, country: 'MX', name: 'Reynosa' },
  'matamoros': { lat: 25.8694, lng: -97.5028, country: 'MX', name: 'Matamoros' },
  'nuevo laredo': { lat: 27.4763, lng: -99.5164, country: 'MX', name: 'Nuevo Laredo' },
  'torreón': { lat: 25.5428, lng: -103.4068, country: 'MX', name: 'Torreón' },
  'torreon': { lat: 25.5428, lng: -103.4068, country: 'MX', name: 'Torreón' },
  'saltillo': { lat: 25.4232, lng: -101.0053, country: 'MX', name: 'Saltillo' },
  'veracruz': { lat: 19.1738, lng: -96.1342, country: 'MX', name: 'Veracruz' },
  'tuxtla gutiérrez': { lat: 16.7528, lng: -93.1152, country: 'MX', name: 'Tuxtla Gutiérrez' },
  'tuxtla gutierrez': { lat: 16.7528, lng: -93.1152, country: 'MX', name: 'Tuxtla Gutiérrez' },
  'villahermosa': { lat: 17.9892, lng: -92.9475, country: 'MX', name: 'Villahermosa' },
  'morelia': { lat: 19.706, lng: -101.195, country: 'MX', name: 'Morelia' },
  'zacatecas': { lat: 22.7709, lng: -102.5832, country: 'MX', name: 'Zacatecas' },
  'uruapan': { lat: 19.4208, lng: -102.0629, country: 'MX', name: 'Uruapan' },
  'mazatlan': { lat: 23.2494, lng: -106.4111, country: 'MX', name: 'Mazatlán' },
  'mazatlán': { lat: 23.2494, lng: -106.4111, country: 'MX', name: 'Mazatlán' },
  'cuernavaca': { lat: 18.9242, lng: -99.2216, country: 'MX', name: 'Cuernavaca' },
  'queretaro': { lat: 20.5888, lng: -100.3899, country: 'MX', name: 'Querétaro' },
  'querétaro': { lat: 20.5888, lng: -100.3899, country: 'MX', name: 'Querétaro' },
  'aguascalientes': { lat: 21.8853, lng: -102.2916, country: 'MX', name: 'Aguascalientes' },
  'irapuato': { lat: 20.6767, lng: -101.3563, country: 'MX', name: 'Irapuato' },
  'tapachula': { lat: 14.9, lng: -92.2667, country: 'MX', name: 'Tapachula' },
  'ensenada': { lat: 31.8667, lng: -116.5964, country: 'MX', name: 'Ensenada' },
  'playa del carmen': { lat: 20.6296, lng: -87.0739, country: 'MX', name: 'Playa del Carmen' },
  'tulum': { lat: 20.2114, lng: -87.4654, country: 'MX', name: 'Tulum' },
  'chilpancingo': { lat: 17.5506, lng: -99.5006, country: 'MX', name: 'Chilpancingo' },
  'trujillo, peru': { lat: -8.1116, lng: -79.0288, country: 'PE', name: 'Trujillo' },
  'cuenca, ecuador': { lat: -2.9001, lng: -79.0059, country: 'EC', name: 'Cuenca' },
  'valencia, venezuela': { lat: 10.162, lng: -68.0077, country: 'VE', name: 'Valencia' },
  'santa ana, el salvador': { lat: 13.9942, lng: -89.5597, country: 'SV', name: 'Santa Ana' },
  'san miguel, el salvador': { lat: 13.4833, lng: -88.1833, country: 'SV', name: 'San Miguel' },
  'león, nicaragua': { lat: 12.4379, lng: -86.8780, country: 'NI', name: 'León' },
  'leon, nicaragua': { lat: 12.4379, lng: -86.8780, country: 'NI', name: 'León' },
  'granada, nicaragua': { lat: 11.9344, lng: -85.956, country: 'NI', name: 'Granada' },
  'salvador, brazil': { lat: -12.9777, lng: -38.5016, country: 'BR', name: 'Salvador' },
  'rosario, argentina': { lat: -32.9442, lng: -60.6505, country: 'AR', name: 'Rosario' },
  'mendoza, argentina': { lat: -32.8895, lng: -68.8458, country: 'AR', name: 'Mendoza' },
  'salta, argentina': { lat: -24.7821, lng: -65.4232, country: 'AR', name: 'Salta' },
  'concepción, chile': { lat: -36.8201, lng: -73.0444, country: 'CL', name: 'Concepción' },
  'concepcion, chile': { lat: -36.8201, lng: -73.0444, country: 'CL', name: 'Concepción' },
  'georgetown, guyana': { lat: 6.8013, lng: -58.1551, country: 'GY', name: 'Georgetown' },
  'sucre, bolivia': { lat: -19.0196, lng: -65.2619, country: 'BO', name: 'Sucre' },
  'limon, costa rica': { lat: 9.9907, lng: -83.0359, country: 'CR', name: 'Limón' },
  'limón, costa rica': { lat: 9.9907, lng: -83.0359, country: 'CR', name: 'Limón' },
  'natal, brazil': { lat: -5.7945, lng: -35.211, country: 'BR', name: 'Natal' },
  'vitoria, brazil': { lat: -20.3155, lng: -40.3128, country: 'BR', name: 'Vitória' },
  'vitória, brazil': { lat: -20.3155, lng: -40.3128, country: 'BR', name: 'Vitória' },
  'santos, brazil': { lat: -23.9608, lng: -46.3336, country: 'BR', name: 'Santos' },
  'liberia, costa rica': { lat: 10.6346, lng: -85.4407, country: 'CR', name: 'Liberia' },
  // Nov 3, 2026, 10:42 AM (M69): second cities of Ukraine's front line, Russia, Turkey, the Levant and Iraq, and western and central Europe that gave no pin
  'sumy': { lat: 50.9077, lng: 34.7981, country: 'UA', name: 'Sumy' },
  'poltava': { lat: 49.5883, lng: 34.5514, country: 'UA', name: 'Poltava' },
  'mykolaiv': { lat: 46.975, lng: 31.9946, country: 'UA', name: 'Mykolaiv' },
  'kramatorsk': { lat: 48.7389, lng: 37.5844, country: 'UA', name: 'Kramatorsk' },
  'sloviansk': { lat: 48.8667, lng: 37.6167, country: 'UA', name: 'Sloviansk' },
  'avdiivka': { lat: 48.1397, lng: 37.7497, country: 'UA', name: 'Avdiivka' },
  'vuhledar': { lat: 47.7793, lng: 37.2503, country: 'UA', name: 'Vuhledar' },
  'kupiansk': { lat: 49.7106, lng: 37.6156, country: 'UA', name: 'Kupiansk' },
  'kropyvnytskyi': { lat: 48.5079, lng: 32.2623, country: 'UA', name: 'Kropyvnytskyi' },
  'kremenchuk': { lat: 49.0659, lng: 33.4204, country: 'UA', name: 'Kremenchuk' },
  'uzhhorod': { lat: 48.6208, lng: 22.2879, country: 'UA', name: 'Uzhhorod' },
  'ivano-frankivsk': { lat: 48.9226, lng: 24.7111, country: 'UA', name: 'Ivano-Frankivsk' },
  'ternopil': { lat: 49.5535, lng: 25.5948, country: 'UA', name: 'Ternopil' },
  'lutsk': { lat: 50.7472, lng: 25.3254, country: 'UA', name: 'Lutsk' },
  'rivne': { lat: 50.6199, lng: 26.2516, country: 'UA', name: 'Rivne' },
  'zhytomyr': { lat: 50.2547, lng: 28.6587, country: 'UA', name: 'Zhytomyr' },
  'vinnytsia': { lat: 49.2331, lng: 28.4682, country: 'UA', name: 'Vinnytsia' },
  'cherkasy': { lat: 49.4444, lng: 32.0598, country: 'UA', name: 'Cherkasy' },
  'berdiansk': { lat: 46.7553, lng: 36.7885, country: 'UA', name: 'Berdiansk' },
  'melitopol': { lat: 46.8489, lng: 35.3653, country: 'UA', name: 'Melitopol' },
  'enerhodar': { lat: 47.4989, lng: 34.6558, country: 'UA', name: 'Enerhodar' },
  'bucha': { lat: 50.5434, lng: 30.2124, country: 'UA', name: 'Bucha' },
  'irpin': { lat: 50.5218, lng: 30.2506, country: 'UA', name: 'Irpin' },
  'izium': { lat: 49.2082, lng: 37.2663, country: 'UA', name: 'Izium' },
  'siversk': { lat: 48.8667, lng: 38.1, country: 'UA', name: 'Siversk' },
  'chasiv yar': { lat: 48.5867, lng: 37.8386, country: 'UA', name: 'Chasiv Yar' },
  'toretsk': { lat: 48.3978, lng: 37.8486, country: 'UA', name: 'Toretsk' },
  'kurakhove': { lat: 47.9833, lng: 37.2833, country: 'UA', name: 'Kurakhove' },
  'kostiantynivka': { lat: 48.5289, lng: 37.7075, country: 'UA', name: 'Kostiantynivka' },
  'lysychansk': { lat: 48.9042, lng: 38.4417, country: 'UA', name: 'Lysychansk' },
  'severodonetsk': { lat: 48.9483, lng: 38.4928, country: 'UA', name: 'Severodonetsk' },
  'sievierodonetsk': { lat: 48.9483, lng: 38.4928, country: 'UA', name: 'Sievierodonetsk' },
  'huliaipole': { lat: 47.66, lng: 36.2569, country: 'UA', name: 'Huliaipole' },
  'orikhiv': { lat: 47.5667, lng: 35.7833, country: 'UA', name: 'Orikhiv' },
  'voronezh': { lat: 51.672, lng: 39.1843, country: 'RU', name: 'Voronezh' },
  'bryansk': { lat: 53.2434, lng: 34.3634, country: 'RU', name: 'Bryansk' },
  'omsk': { lat: 54.9885, lng: 73.3242, country: 'RU', name: 'Omsk' },
  'chelyabinsk': { lat: 55.1644, lng: 61.4368, country: 'RU', name: 'Chelyabinsk' },
  'sochi': { lat: 43.5855, lng: 39.7231, country: 'RU', name: 'Sochi' },
  'novorossiysk': { lat: 44.7235, lng: 37.7687, country: 'RU', name: 'Novorossiysk' },
  'tuapse': { lat: 44.0983, lng: 39.0714, country: 'RU', name: 'Tuapse' },
  'rostov-on-don': { lat: 47.2357, lng: 39.7015, country: 'RU', name: 'Rostov-on-Don' },
  'nizhny novgorod': { lat: 56.2965, lng: 43.9361, country: 'RU', name: 'Nizhny Novgorod' },
  'taganrog': { lat: 47.2362, lng: 38.8969, country: 'RU', name: 'Taganrog' },
  'yeysk': { lat: 46.7056, lng: 38.2739, country: 'RU', name: 'Yeysk' },
  'kerch': { lat: 45.3562, lng: 36.4674, country: 'UA', name: 'Kerch', region: 'Crimea' },   // in Crimea, as 'crimea' and 'sevastopol'
  'saratov': { lat: 51.5336, lng: 46.0343, country: 'RU', name: 'Saratov' },
  'ryazan': { lat: 54.6269, lng: 39.6916, country: 'RU', name: 'Ryazan' },
  'lipetsk': { lat: 52.6031, lng: 39.5708, country: 'RU', name: 'Lipetsk' },
  'tver': { lat: 56.8587, lng: 35.9176, country: 'RU', name: 'Tver' },
  'yaroslavl': { lat: 57.6261, lng: 39.8845, country: 'RU', name: 'Yaroslavl' },
  'irkutsk': { lat: 52.2869, lng: 104.305, country: 'RU', name: 'Irkutsk' },
  'krasnoyarsk': { lat: 56.0153, lng: 92.8932, country: 'RU', name: 'Krasnoyarsk' },
  'khabarovsk': { lat: 48.4802, lng: 135.0719, country: 'RU', name: 'Khabarovsk' },
  'tyumen': { lat: 57.1522, lng: 65.5272, country: 'RU', name: 'Tyumen' },
  'orenburg': { lat: 51.7727, lng: 55.0988, country: 'RU', name: 'Orenburg' },
  'astrakhan': { lat: 46.3497, lng: 48.0408, country: 'RU', name: 'Astrakhan' },
  'stavropol': { lat: 45.0428, lng: 41.9734, country: 'RU', name: 'Stavropol' },
  'yuzhno-sakhalinsk': { lat: 46.9591, lng: 142.738, country: 'RU', name: 'Yuzhno-Sakhalinsk' },
  'norilsk': { lat: 69.3558, lng: 88.1893, country: 'RU', name: 'Norilsk' },
  'magnitogorsk': { lat: 53.4186, lng: 59.0472, country: 'RU', name: 'Magnitogorsk' },
  'bursa': { lat: 40.1885, lng: 29.061, country: 'TR', name: 'Bursa', asWritten: 'Bursa' },
  'adana': { lat: 37.0, lng: 35.3213, country: 'TR', name: 'Adana' },
  'konya': { lat: 37.8746, lng: 32.4932, country: 'TR', name: 'Konya' },
  'kayseri': { lat: 38.7312, lng: 35.4787, country: 'TR', name: 'Kayseri' },
  'mersin': { lat: 36.8, lng: 34.6333, country: 'TR', name: 'Mersin' },
  'eskişehir': { lat: 39.7767, lng: 30.5206, country: 'TR', name: 'Eskişehir' },
  'eskisehir': { lat: 39.7767, lng: 30.5206, country: 'TR', name: 'Eskisehir' },
  'samsun': { lat: 41.2867, lng: 36.33, country: 'TR', name: 'Samsun' },
  'malatya': { lat: 38.3552, lng: 38.3095, country: 'TR', name: 'Malatya' },
  'şanlıurfa': { lat: 37.1591, lng: 38.7969, country: 'TR', name: 'Şanlıurfa' },
  'sanliurfa': { lat: 37.1591, lng: 38.7969, country: 'TR', name: 'Sanliurfa' },
  'hatay': { lat: 36.4018, lng: 36.3498, country: 'TR', name: 'Hatay' },
  'iskenderun': { lat: 36.5872, lng: 36.1735, country: 'TR', name: 'Iskenderun' },
  'kahramanmaraş': { lat: 37.5858, lng: 36.9371, country: 'TR', name: 'Kahramanmaraş' },
  'kahramanmaras': { lat: 37.5858, lng: 36.9371, country: 'TR', name: 'Kahramanmaras' },
  'erzurum': { lat: 39.9, lng: 41.27, country: 'TR', name: 'Erzurum' },
  'mardin': { lat: 37.3212, lng: 40.7245, country: 'TR', name: 'Mardin' },
  'edirne': { lat: 41.6771, lng: 26.5557, country: 'TR', name: 'Edirne' },
  'daraa': { lat: 32.6189, lng: 36.1021, country: 'SY', name: 'Daraa' },
  'qamishli': { lat: 37.0522, lng: 41.2161, country: 'SY', name: 'Qamishli' },
  'kobani': { lat: 36.89, lng: 38.3533, country: 'SY', name: 'Kobani' },
  'kobane': { lat: 36.89, lng: 38.3533, country: 'SY', name: 'Kobane' },
  'manbij': { lat: 36.5281, lng: 37.9544, country: 'SY', name: 'Manbij' },
  'tartus': { lat: 34.8959, lng: 35.8867, country: 'SY', name: 'Tartus' },
  'sweida': { lat: 32.7089, lng: 36.5695, country: 'SY', name: 'Sweida' },
  'hasakah': { lat: 36.5, lng: 40.75, country: 'SY', name: 'Hasakah' },
  'fallujah': { lat: 33.3528, lng: 43.7761, country: 'IQ', name: 'Fallujah' },
  'ramadi': { lat: 33.4258, lng: 43.2992, country: 'IQ', name: 'Ramadi' },
  'tikrit': { lat: 34.6, lng: 43.6833, country: 'IQ', name: 'Tikrit' },
  'beersheba': { lat: 31.253, lng: 34.7915, country: 'IL', name: 'Beersheba' },
  'ashdod': { lat: 31.8044, lng: 34.6553, country: 'IL', name: 'Ashdod' },
  'ashkelon': { lat: 31.6688, lng: 34.5743, country: 'IL', name: 'Ashkelon' },
  'netanya': { lat: 32.3215, lng: 34.8532, country: 'IL', name: 'Netanya' },
  'sderot': { lat: 31.525, lng: 34.5964, country: 'IL', name: 'Sderot' },
  'tiberias': { lat: 32.7959, lng: 35.5311, country: 'IL', name: 'Tiberias' },
  'kiryat shmona': { lat: 33.2075, lng: 35.5697, country: 'IL', name: 'Kiryat Shmona' },
  'jabalia': { lat: 31.5272, lng: 34.4836, country: 'PS', name: 'Jabalia' },
  'deir al-balah': { lat: 31.4167, lng: 34.35, country: 'PS', name: 'Deir al-Balah' },
  'deir el-balah': { lat: 31.4167, lng: 34.35, country: 'PS', name: 'Deir el-Balah' },
  'sidon': { lat: 33.5631, lng: 35.3689, country: 'LB', name: 'Sidon' },
  'nabatieh': { lat: 33.3772, lng: 35.4836, country: 'LB', name: 'Nabatieh' },
  'marib': { lat: 15.4542, lng: 45.3258, country: 'YE', name: 'Marib' },
  'bochum': { lat: 51.4818, lng: 7.2162, country: 'DE', name: 'Bochum' },
  'duisburg': { lat: 51.4344, lng: 6.7623, country: 'DE', name: 'Duisburg' },
  'bremen': { lat: 53.0793, lng: 8.8017, country: 'DE', name: 'Bremen' },
  'hannover': { lat: 52.3759, lng: 9.732, country: 'DE', name: 'Hannover' },
  'mannheim': { lat: 49.4875, lng: 8.466, country: 'DE', name: 'Mannheim' },
  'karlsruhe': { lat: 49.0069, lng: 8.4037, country: 'DE', name: 'Karlsruhe' },
  'freiburg': { lat: 47.999, lng: 7.8421, country: 'DE', name: 'Freiburg' },
  'augsburg': { lat: 48.3705, lng: 10.8978, country: 'DE', name: 'Augsburg' },
  'wiesbaden': { lat: 50.0782, lng: 8.2398, country: 'DE', name: 'Wiesbaden' },
  'mainz': { lat: 49.9929, lng: 8.2473, country: 'DE', name: 'Mainz' },
  'rostock': { lat: 54.0924, lng: 12.0991, country: 'DE', name: 'Rostock' },
  'magdeburg': { lat: 52.1205, lng: 11.6276, country: 'DE', name: 'Magdeburg' },
  'erfurt': { lat: 50.9848, lng: 11.0299, country: 'DE', name: 'Erfurt' },
  'lübeck': { lat: 53.8655, lng: 10.6866, country: 'DE', name: 'Lübeck' },
  'lubeck': { lat: 53.8655, lng: 10.6866, country: 'DE', name: 'Lubeck' },
  'bonn': { lat: 50.7374, lng: 7.0982, country: 'DE', name: 'Bonn' },
  'münster': { lat: 51.9607, lng: 7.6261, country: 'DE', name: 'Münster' },
  'aachen': { lat: 50.7753, lng: 6.0839, country: 'DE', name: 'Aachen' },
  'solingen': { lat: 51.1652, lng: 7.0671, country: 'DE', name: 'Solingen' },
  'montpellier': { lat: 43.6108, lng: 3.8767, country: 'FR', name: 'Montpellier' },
  'rennes': { lat: 48.1173, lng: -1.6778, country: 'FR', name: 'Rennes' },
  'grenoble': { lat: 45.1885, lng: 5.7245, country: 'FR', name: 'Grenoble' },
  'toulon': { lat: 43.1242, lng: 5.928, country: 'FR', name: 'Toulon' },
  'rouen': { lat: 49.4432, lng: 1.0993, country: 'FR', name: 'Rouen' },
  'le havre': { lat: 49.4944, lng: 0.1079, country: 'FR', name: 'Le Havre' },
  'calais': { lat: 50.9513, lng: 1.8587, country: 'FR', name: 'Calais' },
  'perpignan': { lat: 42.6887, lng: 2.8948, country: 'FR', name: 'Perpignan' },
  'saint-étienne': { lat: 45.4397, lng: 4.3872, country: 'FR', name: 'Saint-Étienne' },
  'saint-etienne': { lat: 45.4397, lng: 4.3872, country: 'FR', name: 'Saint-Etienne' },
  'avignon': { lat: 43.9493, lng: 4.8055, country: 'FR', name: 'Avignon' },
  'clermont-ferrand': { lat: 45.7772, lng: 3.087, country: 'FR', name: 'Clermont-Ferrand' },
  'amiens': { lat: 49.8941, lng: 2.2958, country: 'FR', name: 'Amiens' },
  'limoges': { lat: 45.8336, lng: 1.2611, country: 'FR', name: 'Limoges' },
  'reims': { lat: 49.2583, lng: 4.0317, country: 'FR', name: 'Reims' },
  'la rochelle': { lat: 46.1603, lng: -1.1511, country: 'FR', name: 'La Rochelle' },
  'ajaccio': { lat: 41.9192, lng: 8.7386, country: 'FR', name: 'Ajaccio' },
  'bastia': { lat: 42.6977, lng: 9.4509, country: 'FR', name: 'Bastia' },
  'nîmes': { lat: 43.8367, lng: 4.3601, country: 'FR', name: 'Nîmes' },
  'nimes': { lat: 43.8367, lng: 4.3601, country: 'FR', name: 'Nimes' },
  'murcia': { lat: 37.9922, lng: -1.1307, country: 'ES', name: 'Murcia' },
  'gijón': { lat: 43.5322, lng: -5.6611, country: 'ES', name: 'Gijón' },
  'gijon': { lat: 43.5322, lng: -5.6611, country: 'ES', name: 'Gijon' },
  'pamplona': { lat: 42.8125, lng: -1.6458, country: 'ES', name: 'Pamplona' },
  'san sebastián': { lat: 43.3183, lng: -1.9812, country: 'ES', name: 'San Sebastián' },
  'san sebastian': { lat: 43.3183, lng: -1.9812, country: 'ES', name: 'San Sebastian' },
  'oviedo': { lat: 43.3614, lng: -5.8593, country: 'ES', name: 'Oviedo' },
  'las palmas': { lat: 28.1235, lng: -15.4363, country: 'ES', name: 'Las Palmas', asWritten: 'Las Palmas' },
  'santa cruz de tenerife': { lat: 28.4636, lng: -16.2518, country: 'ES', name: 'Santa Cruz de Tenerife' },
  'badajoz': { lat: 38.8794, lng: -6.9707, country: 'ES', name: 'Badajoz' },
  'almería': { lat: 36.8381, lng: -2.4597, country: 'ES', name: 'Almería' },
  'almeria': { lat: 36.8381, lng: -2.4597, country: 'ES', name: 'Almeria' },
  'cádiz': { lat: 36.5271, lng: -6.2886, country: 'ES', name: 'Cádiz' },
  'cadiz': { lat: 36.5271, lng: -6.2886, country: 'ES', name: 'Cadiz' },
  'burgos': { lat: 42.3439, lng: -3.6969, country: 'ES', name: 'Burgos' },
  'genoa': { lat: 44.4056, lng: 8.9463, country: 'IT', name: 'Genoa' },
  'verona': { lat: 45.4384, lng: 10.9916, country: 'IT', name: 'Verona' },
  'padua': { lat: 45.4064, lng: 11.8768, country: 'IT', name: 'Padua' },
  'brescia': { lat: 45.5416, lng: 10.2118, country: 'IT', name: 'Brescia' },
  'perugia': { lat: 43.1107, lng: 12.3908, country: 'IT', name: 'Perugia' },
  'cagliari': { lat: 39.2238, lng: 9.1217, country: 'IT', name: 'Cagliari' },
  'reggio calabria': { lat: 38.1113, lng: 15.6619, country: 'IT', name: 'Reggio Calabria' },
  'salerno': { lat: 40.6824, lng: 14.7681, country: 'IT', name: 'Salerno' },
  'taranto': { lat: 40.4644, lng: 17.247, country: 'IT', name: 'Taranto' },
  'pescara': { lat: 42.4618, lng: 14.2161, country: 'IT', name: 'Pescara' },
  'ancona': { lat: 43.6158, lng: 13.5189, country: 'IT', name: 'Ancona' },
  'la spezia': { lat: 44.1025, lng: 9.8241, country: 'IT', name: 'La Spezia' },
  'livorno': { lat: 43.5485, lng: 10.3106, country: 'IT', name: 'Livorno' },
  'bergamo': { lat: 45.6983, lng: 9.6773, country: 'IT', name: 'Bergamo' },
  'modena': { lat: 44.6471, lng: 10.9252, country: 'IT', name: 'Modena' },
  'ravenna': { lat: 44.4184, lng: 12.2035, country: 'IT', name: 'Ravenna' },
  'lecce': { lat: 40.3515, lng: 18.175, country: 'IT', name: 'Lecce' },
  'szczecin': { lat: 53.4285, lng: 14.5528, country: 'PL', name: 'Szczecin' },
  'lublin': { lat: 51.2465, lng: 22.5684, country: 'PL', name: 'Lublin' },
  'białystok': { lat: 53.1325, lng: 23.1688, country: 'PL', name: 'Białystok' },
  'bialystok': { lat: 53.1325, lng: 23.1688, country: 'PL', name: 'Bialystok' },
  'rzeszów': { lat: 50.0412, lng: 21.9991, country: 'PL', name: 'Rzeszów' },
  'rzeszow': { lat: 50.0412, lng: 21.9991, country: 'PL', name: 'Rzeszow' },
  'bydgoszcz': { lat: 53.1235, lng: 18.0084, country: 'PL', name: 'Bydgoszcz' },
  'toruń': { lat: 53.0138, lng: 18.5984, country: 'PL', name: 'Toruń' },
  'torun': { lat: 53.0138, lng: 18.5984, country: 'PL', name: 'Torun' },
  'olsztyn': { lat: 53.7784, lng: 20.4801, country: 'PL', name: 'Olsztyn' },
  'kielce': { lat: 50.8661, lng: 20.6286, country: 'PL', name: 'Kielce' },
  'opole': { lat: 50.6751, lng: 17.9213, country: 'PL', name: 'Opole' },
  'plzeň': { lat: 49.7384, lng: 13.3736, country: 'CZ', name: 'Plzeň' },
  'plzen': { lat: 49.7384, lng: 13.3736, country: 'CZ', name: 'Plzen' },
  'basel': { lat: 47.5596, lng: 7.5886, country: 'CH', name: 'Basel' },
  'lugano': { lat: 46.0037, lng: 8.9511, country: 'CH', name: 'Lugano' },
  'ghent': { lat: 51.0543, lng: 3.7174, country: 'BE', name: 'Ghent' },
  'bruges': { lat: 51.2093, lng: 3.2247, country: 'BE', name: 'Bruges' },
  'charleroi': { lat: 50.4108, lng: 4.4446, country: 'BE', name: 'Charleroi' },
  'leuven': { lat: 50.8798, lng: 4.7005, country: 'BE', name: 'Leuven' },
  'utrecht': { lat: 52.0907, lng: 5.1214, country: 'NL', name: 'Utrecht' },
  'groningen': { lat: 53.2194, lng: 6.5665, country: 'NL', name: 'Groningen' },
  'maastricht': { lat: 50.8514, lng: 5.691, country: 'NL', name: 'Maastricht' },
  'odense': { lat: 55.4038, lng: 10.4024, country: 'DK', name: 'Odense' },
  'aalborg': { lat: 57.0488, lng: 9.9217, country: 'DK', name: 'Aalborg' },
  'turku': { lat: 60.4518, lng: 22.2666, country: 'FI', name: 'Turku', asWritten: 'Turku' },
  'oulu': { lat: 65.0121, lng: 25.4651, country: 'FI', name: 'Oulu' },
  'örebro': { lat: 59.2753, lng: 15.2134, country: 'SE', name: 'Örebro' },
  'orebro': { lat: 59.2753, lng: 15.2134, country: 'SE', name: 'Orebro' },
  'linköping': { lat: 58.4108, lng: 15.6214, country: 'SE', name: 'Linköping' },
  'linkoping': { lat: 58.4108, lng: 15.6214, country: 'SE', name: 'Linkoping' },
  'iași': { lat: 47.1585, lng: 27.6014, country: 'RO', name: 'Iași' },
  'iasi': { lat: 47.1585, lng: 27.6014, country: 'RO', name: 'Iasi' },
  'constanța': { lat: 44.1598, lng: 28.6348, country: 'RO', name: 'Constanța' },
  'brașov': { lat: 45.6427, lng: 25.5887, country: 'RO', name: 'Brașov' },
  'brasov': { lat: 45.6427, lng: 25.5887, country: 'RO', name: 'Brasov' },
  'sibiu': { lat: 45.7983, lng: 24.1256, country: 'RO', name: 'Sibiu' },
  'oradea': { lat: 47.0465, lng: 21.9189, country: 'RO', name: 'Oradea' },
  'varna': { lat: 43.2141, lng: 27.9147, country: 'BG', name: 'Varna', asWritten: 'Varna' },
  'burgas': { lat: 42.5048, lng: 27.4626, country: 'BG', name: 'Burgas' },
  'niš': { lat: 43.3209, lng: 21.8958, country: 'RS', name: 'Niš' },
  'bitola': { lat: 41.0297, lng: 21.3292, country: 'MK', name: 'Bitola' },
  'rijeka': { lat: 45.3271, lng: 14.4422, country: 'HR', name: 'Rijeka', asWritten: 'Rijeka' },
  'osijek': { lat: 45.555, lng: 18.6955, country: 'HR', name: 'Osijek' },
  'gomel': { lat: 52.4345, lng: 30.9754, country: 'BY', name: 'Gomel' },
  'homel': { lat: 52.4345, lng: 30.9754, country: 'BY', name: 'Homel' },
  'coimbra': { lat: 40.2033, lng: -8.4103, country: 'PT', name: 'Coimbra' },
  'funchal': { lat: 32.6669, lng: -16.9241, country: 'PT', name: 'Funchal' },
  // Nov 3, 2026, 11:43 PM (M70): second cities of South, Southeast and East Asia, Iran, the Gulf, Iraq, Yemen and Central Asia that gave no pin
  'gujranwala': { lat: 32.1877, lng: 74.1945, country: 'PK', name: 'Gujranwala' },
  'sialkot': { lat: 32.4945, lng: 74.5229, country: 'PK', name: 'Sialkot' },
  'hyderabad, pakistan': { lat: 25.396, lng: 68.3578, country: 'PK', name: 'Hyderabad, Pakistan' },
  'sukkur': { lat: 27.7052, lng: 68.8574, country: 'PK', name: 'Sukkur' },
  'gwadar': { lat: 25.1216, lng: 62.3254, country: 'PK', name: 'Gwadar' },
  'khuzdar': { lat: 27.812, lng: 66.611, country: 'PK', name: 'Khuzdar' },
  'turbat': { lat: 26.0012, lng: 63.044, country: 'PK', name: 'Turbat' },
  'mardan': { lat: 34.1986, lng: 72.0404, country: 'PK', name: 'Mardan' },
  'abbottabad': { lat: 34.1688, lng: 73.2215, country: 'PK', name: 'Abbottabad' },
  'bannu': { lat: 32.9889, lng: 70.6056, country: 'PK', name: 'Bannu' },
  'dera ismail khan': { lat: 31.8626, lng: 70.9019, country: 'PK', name: 'Dera Ismail Khan' },
  'muzaffarabad': { lat: 34.37, lng: 73.4711, country: 'PK', name: 'Muzaffarabad' },
  'gilgit': { lat: 35.9208, lng: 74.3144, country: 'PK', name: 'Gilgit' },
  'bahawalpur': { lat: 29.3956, lng: 71.6836, country: 'PK', name: 'Bahawalpur' },
  'larkana': { lat: 27.559, lng: 68.2123, country: 'PK', name: 'Larkana' },
  'jaranwala': { lat: 31.3357, lng: 73.4197, country: 'PK', name: 'Jaranwala' },
  'vadodara': { lat: 22.3072, lng: 73.1812, country: 'IN', name: 'Vadodara' },
  'rajkot': { lat: 22.3039, lng: 70.8022, country: 'IN', name: 'Rajkot' },
  'jodhpur': { lat: 26.2389, lng: 73.0243, country: 'IN', name: 'Jodhpur' },
  'udaipur': { lat: 24.5854, lng: 73.7125, country: 'IN', name: 'Udaipur' },
  'agra': { lat: 27.1767, lng: 78.0081, country: 'IN', name: 'Agra', asWritten: 'Agra' },
  'prayagraj': { lat: 25.4358, lng: 81.8463, country: 'IN', name: 'Prayagraj' },
  'allahabad': { lat: 25.4358, lng: 81.8463, country: 'IN', name: 'Allahabad' },
  'ayodhya': { lat: 26.7922, lng: 82.1998, country: 'IN', name: 'Ayodhya' },
  'noida': { lat: 28.5355, lng: 77.391, country: 'IN', name: 'Noida' },
  'gurugram': { lat: 28.4595, lng: 77.0266, country: 'IN', name: 'Gurugram' },
  'gurgaon': { lat: 28.4595, lng: 77.0266, country: 'IN', name: 'Gurgaon' },
  'ghaziabad': { lat: 28.6692, lng: 77.4538, country: 'IN', name: 'Ghaziabad' },
  'jalandhar': { lat: 31.326, lng: 75.5762, country: 'IN', name: 'Jalandhar' },
  'dehradun': { lat: 30.3165, lng: 78.0322, country: 'IN', name: 'Dehradun' },
  'haridwar': { lat: 29.9457, lng: 78.1642, country: 'IN', name: 'Haridwar' },
  'shimla': { lat: 31.1048, lng: 77.1734, country: 'IN', name: 'Shimla' },
  'jamshedpur': { lat: 22.8046, lng: 86.2029, country: 'IN', name: 'Jamshedpur' },
  'cuttack': { lat: 20.4625, lng: 85.883, country: 'IN', name: 'Cuttack' },
  'amaravati': { lat: 16.5131, lng: 80.5165, country: 'IN', name: 'Amaravati' },
  'hyderabad, india': { lat: 17.385, lng: 78.4867, country: 'IN', name: 'Hyderabad, India' },
  'kochi': { lat: 9.9312, lng: 76.2673, country: 'IN', name: 'Kochi' },
  'kozhikode': { lat: 11.2588, lng: 75.7804, country: 'IN', name: 'Kozhikode' },
  'madurai': { lat: 9.9252, lng: 78.1198, country: 'IN', name: 'Madurai' },
  'tiruchirappalli': { lat: 10.7905, lng: 78.7047, country: 'IN', name: 'Tiruchirappalli' },
  'puducherry': { lat: 11.9416, lng: 79.8083, country: 'IN', name: 'Puducherry' },
  'nashik': { lat: 19.9975, lng: 73.7898, country: 'IN', name: 'Nashik' },
  'aurangabad': { lat: 19.8762, lng: 75.3433, country: 'IN', name: 'Aurangabad' },
  'gwalior': { lat: 26.2183, lng: 78.1828, country: 'IN', name: 'Gwalior' },
  'raipur': { lat: 21.2514, lng: 81.6296, country: 'IN', name: 'Raipur' },
  'aizawl': { lat: 23.7271, lng: 92.7176, country: 'IN', name: 'Aizawl' },
  'shillong': { lat: 25.5788, lng: 91.8933, country: 'IN', name: 'Shillong' },
  'kohima': { lat: 25.6751, lng: 94.1086, country: 'IN', name: 'Kohima' },
  'itanagar': { lat: 27.0844, lng: 93.6053, country: 'IN', name: 'Itanagar' },
  'agartala': { lat: 23.8315, lng: 91.2868, country: 'IN', name: 'Agartala' },
  'siliguri': { lat: 26.7271, lng: 88.3953, country: 'IN', name: 'Siliguri' },
  'darjeeling': { lat: 27.041, lng: 88.2663, country: 'IN', name: 'Darjeeling' },
  'panaji': { lat: 15.4909, lng: 73.8278, country: 'IN', name: 'Panaji' },
  'pahalgam': { lat: 34.0161, lng: 75.315, country: 'IN', name: 'Pahalgam' },
  'kargil': { lat: 34.5539, lng: 76.1349, country: 'IN', name: 'Kargil' },
  'anantnag': { lat: 33.7311, lng: 75.1487, country: 'IN', name: 'Anantnag' },
  'baramulla': { lat: 34.198, lng: 74.3636, country: 'IN', name: 'Baramulla' },
  'pulwama': { lat: 33.8716, lng: 74.8946, country: 'IN', name: 'Pulwama' },
  'biratnagar': { lat: 26.4525, lng: 87.2718, country: 'NP', name: 'Biratnagar' },
  'lumbini': { lat: 27.4833, lng: 83.2756, country: 'NP', name: 'Lumbini' },
  'rajshahi': { lat: 24.3745, lng: 88.6042, country: 'BD', name: 'Rajshahi' },
  'rangpur': { lat: 25.7439, lng: 89.2752, country: 'BD', name: 'Rangpur' },
  'barisal': { lat: 22.701, lng: 90.3535, country: 'BD', name: 'Barisal' },
  'narayanganj': { lat: 23.6238, lng: 90.5, country: 'BD', name: 'Narayanganj' },
  'mymensingh': { lat: 24.7471, lng: 90.4203, country: 'BD', name: 'Mymensingh' },
  "cox's bazar": { lat: 21.4272, lng: 92.0058, country: 'BD', name: "Cox's Bazar" },
  'kutupalong': { lat: 21.2, lng: 92.1667, country: 'BD', name: 'Kutupalong' },
  'galle': { lat: 6.0535, lng: 80.221, country: 'LK', name: 'Galle' },
  'jaffna': { lat: 9.6615, lng: 80.0255, country: 'LK', name: 'Jaffna' },
  'trincomalee': { lat: 8.5874, lng: 81.2152, country: 'LK', name: 'Trincomalee' },
  'batticaloa': { lat: 7.7102, lng: 81.6924, country: 'LK', name: 'Batticaloa' },
  'negombo': { lat: 7.2008, lng: 79.8737, country: 'LK', name: 'Negombo' },
  'sri jayawardenepura kotte': { lat: 6.9108, lng: 79.8878, country: 'LK', name: 'Sri Jayawardenepura Kotte' },
  'nay pyi taw': { lat: 19.7633, lng: 96.0785, country: 'MM', name: 'Nay Pyi Taw' },
  'sittwe': { lat: 20.1462, lng: 92.8983, country: 'MM', name: 'Sittwe' },
  'myitkyina': { lat: 25.3833, lng: 97.3964, country: 'MM', name: 'Myitkyina' },
  'lashio': { lat: 22.9333, lng: 97.75, country: 'MM', name: 'Lashio' },
  'mawlamyine': { lat: 16.4905, lng: 97.6282, country: 'MM', name: 'Mawlamyine' },
  'pathein': { lat: 16.7792, lng: 94.7324, country: 'MM', name: 'Pathein' },
  'maungdaw': { lat: 20.8167, lng: 92.3667, country: 'MM', name: 'Maungdaw' },
  'hat yai': { lat: 7.0086, lng: 100.4747, country: 'TH', name: 'Hat Yai' },
  'krabi': { lat: 8.0863, lng: 98.9063, country: 'TH', name: 'Krabi' },
  'koh samui': { lat: 9.512, lng: 100.0136, country: 'TH', name: 'Koh Samui' },
  'khon kaen': { lat: 16.4322, lng: 102.8236, country: 'TH', name: 'Khon Kaen' },
  'nakhon ratchasima': { lat: 14.9799, lng: 102.0978, country: 'TH', name: 'Nakhon Ratchasima' },
  'udon thani': { lat: 17.4138, lng: 102.7872, country: 'TH', name: 'Udon Thani' },
  'chiang rai': { lat: 19.9105, lng: 99.8406, country: 'TH', name: 'Chiang Rai' },
  'narathiwat': { lat: 6.4264, lng: 101.8231, country: 'TH', name: 'Narathiwat' },
  'sa kaeo': { lat: 13.824, lng: 102.0646, country: 'TH', name: 'Sa Kaeo' },
  'saigon': { lat: 10.8231, lng: 106.6297, country: 'VN', name: 'Saigon' },
  'hai phong': { lat: 20.8449, lng: 106.6881, country: 'VN', name: 'Hai Phong' },
  'nha trang': { lat: 12.2388, lng: 109.1967, country: 'VN', name: 'Nha Trang' },
  'hoi an': { lat: 15.8801, lng: 108.338, country: 'VN', name: 'Hoi An' },
  'dalat': { lat: 11.9404, lng: 108.4583, country: 'VN', name: 'Dalat' },
  'quang ninh': { lat: 21.0064, lng: 107.2925, country: 'VN', name: 'Quang Ninh' },
  'ha long': { lat: 20.9101, lng: 107.1839, country: 'VN', name: 'Ha Long' },
  'sihanoukville': { lat: 10.6093, lng: 103.5296, country: 'KH', name: 'Sihanoukville' },
  'battambang': { lat: 13.0957, lng: 103.2022, country: 'KH', name: 'Battambang' },
  'poipet': { lat: 13.6581, lng: 102.5636, country: 'KH', name: 'Poipet' },
  'luang prabang': { lat: 19.8845, lng: 102.1348, country: 'LA', name: 'Luang Prabang' },
  'savannakhet': { lat: 16.5565, lng: 104.7539, country: 'LA', name: 'Savannakhet' },
  'pakse': { lat: 15.1202, lng: 105.7819, country: 'LA', name: 'Pakse' },
  'cagayan de oro': { lat: 8.4542, lng: 124.6319, country: 'PH', name: 'Cagayan de Oro' },
  'iloilo': { lat: 10.7202, lng: 122.5621, country: 'PH', name: 'Iloilo' },
  'bacolod': { lat: 10.6407, lng: 122.9689, country: 'PH', name: 'Bacolod' },
  'baguio': { lat: 16.4023, lng: 120.596, country: 'PH', name: 'Baguio' },
  'makati': { lat: 14.5547, lng: 121.0244, country: 'PH', name: 'Makati' },
  'marawi': { lat: 8.0, lng: 124.2833, country: 'PH', name: 'Marawi' },
  'cotabato': { lat: 7.2231, lng: 124.2452, country: 'PH', name: 'Cotabato' },
  'tacloban': { lat: 11.2543, lng: 125.0, country: 'PH', name: 'Tacloban' },
  'legazpi': { lat: 13.1391, lng: 123.7438, country: 'PH', name: 'Legazpi' },
  'general santos': { lat: 6.1164, lng: 125.1716, country: 'PH', name: 'General Santos' },
  'puerto princesa': { lat: 9.7392, lng: 118.7353, country: 'PH', name: 'Puerto Princesa' },
  'subic': { lat: 14.8794, lng: 120.2706, country: 'PH', name: 'Subic' },
  'balikpapan': { lat: -1.2379, lng: 116.8529, country: 'ID', name: 'Balikpapan' },
  'banda aceh': { lat: 5.5483, lng: 95.3238, country: 'ID', name: 'Banda Aceh' },
  'padang': { lat: -0.9471, lng: 100.4172, country: 'ID', name: 'Padang' },
  'pontianak': { lat: -0.0263, lng: 109.3425, country: 'ID', name: 'Pontianak' },
  'manado': { lat: 1.4748, lng: 124.8421, country: 'ID', name: 'Manado' },
  'jayapura': { lat: -2.5337, lng: 140.7181, country: 'ID', name: 'Jayapura' },
  'bekasi': { lat: -6.2383, lng: 106.9756, country: 'ID', name: 'Bekasi' },
  'tangerang': { lat: -6.1783, lng: 106.63, country: 'ID', name: 'Tangerang' },
  'kupang': { lat: -10.1772, lng: 123.607, country: 'ID', name: 'Kupang' },
  'mataram': { lat: -8.5833, lng: 116.1167, country: 'ID', name: 'Mataram', asWritten: 'Mataram' },
  'malacca': { lat: 2.1896, lng: 102.2501, country: 'MY', name: 'Malacca' },
  'putrajaya': { lat: 2.9264, lng: 101.6964, country: 'MY', name: 'Putrajaya' },
  'shah alam': { lat: 3.0738, lng: 101.5183, country: 'MY', name: 'Shah Alam' },
  'petaling jaya': { lat: 3.1073, lng: 101.6067, country: 'MY', name: 'Petaling Jaya' },
  'langkawi': { lat: 6.35, lng: 99.8, country: 'MY', name: 'Langkawi' },
  'naha': { lat: 26.2124, lng: 127.6809, country: 'JP', name: 'Naha' },
  'saitama': { lat: 35.8617, lng: 139.6455, country: 'JP', name: 'Saitama' },
  'niigata': { lat: 37.9162, lng: 139.0364, country: 'JP', name: 'Niigata' },
  'kagoshima': { lat: 31.5966, lng: 130.5571, country: 'JP', name: 'Kagoshima' },
  'fukushima': { lat: 37.7608, lng: 140.4747, country: 'JP', name: 'Fukushima' },
  'yokosuka': { lat: 35.2814, lng: 139.6722, country: 'JP', name: 'Yokosuka' },
  'sasebo': { lat: 33.18, lng: 129.7167, country: 'JP', name: 'Sasebo' },
  'iwakuni': { lat: 34.1667, lng: 132.2167, country: 'JP', name: 'Iwakuni' },
  'ulsan': { lat: 35.5384, lng: 129.3114, country: 'KR', name: 'Ulsan' },
  'suwon': { lat: 37.2636, lng: 127.0286, country: 'KR', name: 'Suwon' },
  'jeju': { lat: 33.4996, lng: 126.5312, country: 'KR', name: 'Jeju' },
  'pohang': { lat: 36.019, lng: 129.3435, country: 'KR', name: 'Pohang' },
  'pyeongtaek': { lat: 36.9921, lng: 127.1128, country: 'KR', name: 'Pyeongtaek' },
  'wonsan': { lat: 39.1528, lng: 127.4436, country: 'KP', name: 'Wonsan' },
  'hamhung': { lat: 39.9183, lng: 127.5358, country: 'KP', name: 'Hamhung' },
  'chongjin': { lat: 41.7956, lng: 129.7758, country: 'KP', name: 'Chongjin' },
  'kaesong': { lat: 37.9708, lng: 126.5542, country: 'KP', name: 'Kaesong' },
  'sinuiju': { lat: 40.1, lng: 124.4, country: 'KP', name: 'Sinuiju' },
  'xian': { lat: 34.3416, lng: 108.9398, country: 'CN', name: 'Xian' },
  'fuzhou': { lat: 26.0745, lng: 119.2965, country: 'CN', name: 'Fuzhou' },
  'jinan': { lat: 36.6512, lng: 117.1201, country: 'CN', name: 'Jinan' },
  'kashgar': { lat: 39.4704, lng: 75.9898, country: 'CN', name: 'Kashgar' },
  'hotan': { lat: 37.1107, lng: 79.9255, country: 'CN', name: 'Hotan' },
  'lanzhou': { lat: 36.0611, lng: 103.8343, country: 'CN', name: 'Lanzhou' },
  'nanning': { lat: 22.817, lng: 108.3665, country: 'CN', name: 'Nanning' },
  'haikou': { lat: 20.044, lng: 110.1999, country: 'CN', name: 'Haikou' },
  'zhuhai': { lat: 22.2707, lng: 113.5767, country: 'CN', name: 'Zhuhai' },
  'dongguan': { lat: 23.0207, lng: 113.7518, country: 'CN', name: 'Dongguan' },
  'suzhou': { lat: 31.2989, lng: 120.5853, country: 'CN', name: 'Suzhou' },
  'wuxi': { lat: 31.4912, lng: 120.3119, country: 'CN', name: 'Wuxi' },
  'wenzhou': { lat: 27.9938, lng: 120.6994, country: 'CN', name: 'Wenzhou' },
  'taiyuan': { lat: 37.8706, lng: 112.5489, country: 'CN', name: 'Taiyuan' },
  'shijiazhuang': { lat: 38.0428, lng: 114.5149, country: 'CN', name: 'Shijiazhuang' },
  'yinchuan': { lat: 38.4872, lng: 106.2309, country: 'CN', name: 'Yinchuan' },
  'xining': { lat: 36.6171, lng: 101.7782, country: 'CN', name: 'Xining' },
  'nanchang': { lat: 28.682, lng: 115.8579, country: 'CN', name: 'Nanchang' },
  'changchun': { lat: 43.8171, lng: 125.3235, country: 'CN', name: 'Changchun' },
  'weihai': { lat: 37.5128, lng: 122.1201, country: 'CN', name: 'Weihai' },
  'yantai': { lat: 37.4638, lng: 121.4479, country: 'CN', name: 'Yantai' },
  'hsinchu': { lat: 24.8138, lng: 120.9675, country: 'TW', name: 'Hsinchu' },
  'taoyuan': { lat: 24.9936, lng: 121.301, country: 'TW', name: 'Taoyuan' },
  'darkhan': { lat: 49.4867, lng: 105.9228, country: 'MN', name: 'Darkhan' },
  'erdenet': { lat: 49.0276, lng: 104.0447, country: 'MN', name: 'Erdenet' },
  'karaj': { lat: 35.8355, lng: 50.9915, country: 'IR', name: 'Karaj' },
  'qom': { lat: 34.6416, lng: 50.8746, country: 'IR', name: 'Qom' },
  'kermanshah': { lat: 34.3277, lng: 47.0778, country: 'IR', name: 'Kermanshah' },
  'zahedan': { lat: 29.4963, lng: 60.8629, country: 'IR', name: 'Zahedan' },
  'natanz': { lat: 33.5133, lng: 51.9163, country: 'IR', name: 'Natanz' },
  'fordow': { lat: 34.8833, lng: 50.9833, country: 'IR', name: 'Fordow' },
  'fordo': { lat: 34.8833, lng: 50.9833, country: 'IR', name: 'Fordo' },
  'bushehr': { lat: 28.9234, lng: 50.8203, country: 'IR', name: 'Bushehr' },
  'kharg island': { lat: 29.2333, lng: 50.3167, country: 'IR', name: 'Kharg Island' },
  'chabahar': { lat: 25.2919, lng: 60.643, country: 'IR', name: 'Chabahar' },
  'urmia': { lat: 37.5527, lng: 45.0761, country: 'IR', name: 'Urmia' },
  'rasht': { lat: 37.2808, lng: 49.5832, country: 'IR', name: 'Rasht' },
  'yazd': { lat: 31.8974, lng: 54.3569, country: 'IR', name: 'Yazd' },
  'kerman': { lat: 30.2839, lng: 57.0834, country: 'IR', name: 'Kerman' },
  'sanandaj': { lat: 35.3219, lng: 46.9862, country: 'IR', name: 'Sanandaj' },
  'hamadan': { lat: 34.7992, lng: 48.5146, country: 'IR', name: 'Hamadan' },
  'zanjan': { lat: 36.6736, lng: 48.4787, country: 'IR', name: 'Zanjan' },
  'semnan': { lat: 35.5769, lng: 53.392, country: 'IR', name: 'Semnan' },
  'parchin': { lat: 35.5167, lng: 51.7667, country: 'IR', name: 'Parchin' },
  'khobar': { lat: 26.2172, lng: 50.1971, country: 'SA', name: 'Khobar' },
  'dhahran': { lat: 26.2361, lng: 50.0393, country: 'SA', name: 'Dhahran' },
  'jizan': { lat: 16.8892, lng: 42.5511, country: 'SA', name: 'Jizan' },
  'tabuk': { lat: 28.3835, lng: 36.5662, country: 'SA', name: 'Tabuk' },
  'neom': { lat: 28.0, lng: 35.2, country: 'SA', name: 'Neom' },
  'najran': { lat: 17.4933, lng: 44.1277, country: 'SA', name: 'Najran' },
  'ras tanura': { lat: 26.6446, lng: 50.1596, country: 'SA', name: 'Ras Tanura' },
  'abqaiq': { lat: 25.9333, lng: 49.6667, country: 'SA', name: 'Abqaiq' },
  'fujairah': { lat: 25.1288, lng: 56.3265, country: 'AE', name: 'Fujairah' },
  'al ain': { lat: 24.2075, lng: 55.7447, country: 'AE', name: 'Al Ain' },
  'jebel ali': { lat: 25.0053, lng: 55.061, country: 'AE', name: 'Jebel Ali' },
  'ras laffan': { lat: 25.9167, lng: 51.5333, country: 'QA', name: 'Ras Laffan' },
  'sohar': { lat: 24.3475, lng: 56.7085, country: 'OM', name: 'Sohar' },
  'duqm': { lat: 19.6667, lng: 57.7, country: 'OM', name: 'Duqm' },
  'mukalla': { lat: 14.5412, lng: 49.1242, country: 'YE', name: 'Mukalla' },
  'baikonur': { lat: 45.9646, lng: 63.3052, country: 'KZ', name: 'Baikonur' },
  'kunduz': { lat: 36.7286, lng: 68.8681, country: 'AF', name: 'Kunduz' },
  'bagram': { lat: 34.9461, lng: 69.265, country: 'AF', name: 'Bagram' },
  'panjshir': { lat: 35.3, lng: 69.5, country: 'AF', name: 'Panjshir' },
  'bamiyan': { lat: 34.8219, lng: 67.8213, country: 'AF', name: 'Bamiyan' },
  // Nov 4, 2026, 8:43 AM (M71): second cities of Africa (Nigeria, Ghana, North Africa, Sudan, South Sudan, the Horn, the Great Lakes, the Sahel, southern Africa) that gave no pin
  'zaria': { lat: 11.0855, lng: 7.7199, country: 'NG', name: 'Zaria' },
  'lafia': { lat: 8.4966, lng: 8.5153, country: 'NG', name: 'Lafia' },
  'bonny': { lat: 4.4333, lng: 7.1667, country: 'NG', name: 'Bonny', asWritten: 'Bonny' },
  'sambisa': { lat: 11.3, lng: 13.5, country: 'NG', name: 'Sambisa' },
  'chibok': { lat: 10.8667, lng: 12.85, country: 'NG', name: 'Chibok' },
  'baga': { lat: 13.2167, lng: 13.8833, country: 'NG', name: 'Baga', asWritten: 'Baga' },
  'gwoza': { lat: 11.0833, lng: 13.6957, country: 'NG', name: 'Gwoza' },
  'konduga': { lat: 11.65, lng: 13.4167, country: 'NG', name: 'Konduga' },
  'minna': { lat: 9.6139, lng: 6.5569, country: 'NG', name: 'Minna' },
  'yola': { lat: 9.2035, lng: 12.4954, country: 'NG', name: 'Yola' },
  'takoradi': { lat: 4.8845, lng: -1.7554, country: 'GH', name: 'Takoradi' },
  'cape coast': { lat: 5.1053, lng: -1.2466, country: 'GH', name: 'Cape Coast' },
  'tema': { lat: 5.6698, lng: -0.0166, country: 'GH', name: 'Tema', asWritten: 'Tema' },
  'sunyani': { lat: 7.3399, lng: -2.3268, country: 'GH', name: 'Sunyani' },
  'bolgatanga': { lat: 10.7856, lng: -0.8514, country: 'GH', name: 'Bolgatanga' },
  'koforidua': { lat: 6.0941, lng: -0.2591, country: 'GH', name: 'Koforidua' },
  'obuasi': { lat: 6.2023, lng: -1.6619, country: 'GH', name: 'Obuasi' },
  'techiman': { lat: 7.5833, lng: -1.9333, country: 'GH', name: 'Techiman' },
  'sekondi': { lat: 4.9344, lng: -1.7137, country: 'GH', name: 'Sekondi' },
  'kenema': { lat: 7.8767, lng: -11.1875, country: 'SL', name: 'Kenema' },
  'makeni': { lat: 8.8833, lng: -12.05, country: 'SL', name: 'Makeni' },
  'koidu': { lat: 8.6439, lng: -10.9714, country: 'SL', name: 'Koidu' },
  'gbarnga': { lat: 6.9956, lng: -9.4722, country: 'LR', name: 'Gbarnga' },
  'giza': { lat: 30.0131, lng: 31.2089, country: 'EG', name: 'Giza' },
  'suez': { lat: 29.9668, lng: 32.5498, country: 'EG', name: 'Suez' },
  'ismailia': { lat: 30.5965, lng: 32.2715, country: 'EG', name: 'Ismailia' },
  'mansoura': { lat: 31.0409, lng: 31.3785, country: 'EG', name: 'Mansoura' },
  'tanta': { lat: 30.7865, lng: 31.0004, country: 'EG', name: 'Tanta', asWritten: 'Tanta' },
  'asyut': { lat: 27.1809, lng: 31.1837, country: 'EG', name: 'Asyut' },
  'assiut': { lat: 27.1809, lng: 31.1837, country: 'EG', name: 'Assiut' },
  'sharm el-sheikh': { lat: 27.9158, lng: 34.33, country: 'EG', name: 'Sharm el-Sheikh' },
  'sharm el sheikh': { lat: 27.9158, lng: 34.33, country: 'EG', name: 'Sharm el Sheikh' },
  'hurghada': { lat: 27.2579, lng: 33.8116, country: 'EG', name: 'Hurghada' },
  'damietta': { lat: 31.4165, lng: 31.8133, country: 'EG', name: 'Damietta' },
  'zagazig': { lat: 30.5877, lng: 31.502, country: 'EG', name: 'Zagazig' },
  'fayoum': { lat: 29.3084, lng: 30.8428, country: 'EG', name: 'Fayoum' },
  'minya': { lat: 28.1099, lng: 30.7503, country: 'EG', name: 'Minya' },
  'sohag': { lat: 26.5569, lng: 31.6948, country: 'EG', name: 'Sohag' },
  'qena': { lat: 26.1551, lng: 32.716, country: 'EG', name: 'Qena' },
  'marsa matruh': { lat: 31.3543, lng: 27.2373, country: 'EG', name: 'Marsa Matruh' },
  'el alamein': { lat: 30.8333, lng: 28.95, country: 'EG', name: 'El Alamein' },
  'arish': { lat: 31.1316, lng: 33.7984, country: 'EG', name: 'Arish' },
  'el arish': { lat: 31.1316, lng: 33.7984, country: 'EG', name: 'El Arish' },
  'beni suef': { lat: 29.0661, lng: 31.0994, country: 'EG', name: 'Beni Suef' },
  'damanhur': { lat: 31.0341, lng: 30.4682, country: 'EG', name: 'Damanhur' },
  'sirte': { lat: 31.2089, lng: 16.5887, country: 'LY', name: 'Sirte' },
  'sabha': { lat: 27.0377, lng: 14.4283, country: 'LY', name: 'Sabha' },
  'zawiya': { lat: 32.7571, lng: 12.7276, country: 'LY', name: 'Zawiya' },
  'tobruk': { lat: 32.0836, lng: 23.9764, country: 'LY', name: 'Tobruk' },
  'derna': { lat: 32.7648, lng: 22.6392, country: 'LY', name: 'Derna' },
  'zliten': { lat: 32.4674, lng: 14.5687, country: 'LY', name: 'Zliten' },
  'ajdabiya': { lat: 30.7554, lng: 20.2263, country: 'LY', name: 'Ajdabiya' },
  'bani walid': { lat: 31.7637, lng: 13.9893, country: 'LY', name: 'Bani Walid' },
  'ghadames': { lat: 30.1337, lng: 9.5007, country: 'LY', name: 'Ghadames' },
  'murzuq': { lat: 25.9155, lng: 13.9184, country: 'LY', name: 'Murzuq' },
  'kufra': { lat: 24.1996, lng: 23.2896, country: 'LY', name: 'Kufra' },
  'gharyan': { lat: 32.1722, lng: 13.0203, country: 'LY', name: 'Gharyan' },
  'tarhuna': { lat: 32.4353, lng: 13.6339, country: 'LY', name: 'Tarhuna' },
  'zuwara': { lat: 32.9312, lng: 12.0819, country: 'LY', name: 'Zuwara' },
  'brega': { lat: 30.4167, lng: 19.5833, country: 'LY', name: 'Brega' },
  'ras lanuf': { lat: 30.5, lng: 18.5667, country: 'LY', name: 'Ras Lanuf' },
  'oran': { lat: 35.6971, lng: -0.6308, country: 'DZ', name: 'Oran' },
  'tlemcen': { lat: 34.8828, lng: -1.3167, country: 'DZ', name: 'Tlemcen' },
  'setif': { lat: 36.1911, lng: 5.4137, country: 'DZ', name: 'Setif' },
  'batna': { lat: 35.5559, lng: 6.1741, country: 'DZ', name: 'Batna' },
  'bejaia': { lat: 36.7509, lng: 5.0567, country: 'DZ', name: 'Bejaia' },
  'ghardaia': { lat: 32.4909, lng: 3.6735, country: 'DZ', name: 'Ghardaia' },
  'tamanrasset': { lat: 22.785, lng: 5.5228, country: 'DZ', name: 'Tamanrasset' },
  'blida': { lat: 36.4703, lng: 2.8277, country: 'DZ', name: 'Blida' },
  'tizi ouzou': { lat: 36.7118, lng: 4.0459, country: 'DZ', name: 'Tizi Ouzou' },
  'skikda': { lat: 36.8762, lng: 6.9092, country: 'DZ', name: 'Skikda' },
  'ouargla': { lat: 31.9493, lng: 5.325, country: 'DZ', name: 'Ouargla' },
  'in salah': { lat: 27.1977, lng: 2.4833, country: 'DZ', name: 'In Salah' },
  'biskra': { lat: 34.8505, lng: 5.7281, country: 'DZ', name: 'Biskra' },
  'mostaganem': { lat: 35.9311, lng: 0.0892, country: 'DZ', name: 'Mostaganem' },
  'oujda': { lat: 34.6814, lng: -1.9086, country: 'MA', name: 'Oujda' },
  'meknes': { lat: 33.8935, lng: -5.5473, country: 'MA', name: 'Meknes' },
  'tetouan': { lat: 35.5785, lng: -5.3684, country: 'MA', name: 'Tetouan' },
  'nador': { lat: 35.1681, lng: -2.9335, country: 'MA', name: 'Nador' },
  'essaouira': { lat: 31.5085, lng: -9.7595, country: 'MA', name: 'Essaouira' },
  'ceuta': { lat: 35.8894, lng: -5.3198, country: 'ES', name: 'Ceuta' },
  'melilla': { lat: 35.2923, lng: -2.9381, country: 'ES', name: 'Melilla' },
  'kenitra': { lat: 34.261, lng: -6.5802, country: 'MA', name: 'Kenitra' },
  'el jadida': { lat: 33.2316, lng: -8.5007, country: 'MA', name: 'El Jadida' },
  'ouarzazate': { lat: 30.9335, lng: -6.937, country: 'MA', name: 'Ouarzazate' },
  'al hoceima': { lat: 35.2517, lng: -3.9372, country: 'MA', name: 'Al Hoceima' },
  'chefchaouen': { lat: 35.1688, lng: -5.2636, country: 'MA', name: 'Chefchaouen' },
  'sousse': { lat: 35.8256, lng: 10.6369, country: 'TN', name: 'Sousse' },
  'gabes': { lat: 33.8815, lng: 10.0982, country: 'TN', name: 'Gabes' },
  'kairouan': { lat: 35.6781, lng: 10.0963, country: 'TN', name: 'Kairouan' },
  'bizerte': { lat: 37.2744, lng: 9.8739, country: 'TN', name: 'Bizerte' },
  'gafsa': { lat: 34.425, lng: 8.7842, country: 'TN', name: 'Gafsa' },
  'monastir': { lat: 35.7643, lng: 10.8113, country: 'TN', name: 'Monastir' },
  'djerba': { lat: 33.8075, lng: 10.8451, country: 'TN', name: 'Djerba' },
  'tataouine': { lat: 32.9297, lng: 10.4518, country: 'TN', name: 'Tataouine' },
  'kasserine': { lat: 35.1676, lng: 8.8365, country: 'TN', name: 'Kasserine' },
  'medenine': { lat: 33.3549, lng: 10.5055, country: 'TN', name: 'Medenine' },
  'zarzis': { lat: 33.5039, lng: 11.1122, country: 'TN', name: 'Zarzis' },
  'tozeur': { lat: 33.9197, lng: 8.1335, country: 'TN', name: 'Tozeur' },
  'nabeul': { lat: 36.4513, lng: 10.7357, country: 'TN', name: 'Nabeul' },
  'jendouba': { lat: 36.5011, lng: 8.7802, country: 'TN', name: 'Jendouba' },
  'hammamet': { lat: 36.4, lng: 10.6167, country: 'TN', name: 'Hammamet' },
  'geneina': { lat: 13.4528, lng: 22.4471, country: 'SD', name: 'Geneina' },
  'kadugli': { lat: 11.0111, lng: 29.7186, country: 'SD', name: 'Kadugli' },
  'dongola': { lat: 19.1654, lng: 30.4763, country: 'SD', name: 'Dongola' },
  'atbara': { lat: 17.7022, lng: 33.9864, country: 'SD', name: 'Atbara' },
  'gedaref': { lat: 14.0349, lng: 35.3834, country: 'SD', name: 'Gedaref' },
  'kosti': { lat: 13.1629, lng: 32.6637, country: 'SD', name: 'Kosti', asWritten: 'Kosti' },
  'zalingei': { lat: 12.9097, lng: 23.4719, country: 'SD', name: 'Zalingei' },
  'el daein': { lat: 11.4608, lng: 26.1307, country: 'SD', name: 'El Daein' },
  'sennar': { lat: 13.5489, lng: 33.6, country: 'SD', name: 'Sennar' },
  'al fashir': { lat: 13.629, lng: 25.3494, country: 'SD', name: 'Al Fashir' },
  'damazin': { lat: 11.7891, lng: 34.3592, country: 'SD', name: 'Damazin' },
  'abu hamad': { lat: 19.5333, lng: 33.3333, country: 'SD', name: 'Abu Hamad' },
  'tawila': { lat: 13.4833, lng: 24.3667, country: 'SD', name: 'Tawila' },
  'dilling': { lat: 12.0561, lng: 29.6532, country: 'SD', name: 'Dilling' },
  'babanusa': { lat: 11.3333, lng: 27.8, country: 'SD', name: 'Babanusa' },
  'abu shouk': { lat: 13.6667, lng: 25.3333, country: 'SD', name: 'Abu Shouk' },
  'juba': { lat: 4.8594, lng: 31.5713, country: 'SS', name: 'Juba' },
  'torit': { lat: 4.4108, lng: 32.5712, country: 'SS', name: 'Torit' },
  'rumbek': { lat: 6.8032, lng: 29.6773, country: 'SS', name: 'Rumbek' },
  'yambio': { lat: 4.5721, lng: 28.3949, country: 'SS', name: 'Yambio' },
  'aweil': { lat: 8.7667, lng: 27.4, country: 'SS', name: 'Aweil' },
  'pibor': { lat: 6.8, lng: 33.1333, country: 'SS', name: 'Pibor' },
  'kuajok': { lat: 8.3, lng: 28.0, country: 'SS', name: 'Kuajok' },
  'polokwane': { lat: -23.9045, lng: 29.4689, country: 'ZA', name: 'Polokwane' },
  'nelspruit': { lat: -25.4753, lng: 30.9694, country: 'ZA', name: 'Nelspruit' },
  'mbombela': { lat: -25.4753, lng: 30.9694, country: 'ZA', name: 'Mbombela' },
  'rustenburg': { lat: -25.6676, lng: 27.2421, country: 'ZA', name: 'Rustenburg' },
  'mthatha': { lat: -31.5889, lng: 28.7844, country: 'ZA', name: 'Mthatha' },
  'richards bay': { lat: -28.783, lng: 32.0377, country: 'ZA', name: 'Richards Bay' },
  'mossel bay': { lat: -34.1831, lng: 22.1461, country: 'ZA', name: 'Mossel Bay' },
  'stellenbosch': { lat: -33.9321, lng: 18.8602, country: 'ZA', name: 'Stellenbosch' },
  'tshwane': { lat: -25.7479, lng: 28.2293, country: 'ZA', name: 'Tshwane' },
  'mahikeng': { lat: -25.8652, lng: 25.6443, country: 'ZA', name: 'Mahikeng' },
  'upington': { lat: -28.4478, lng: 21.2561, country: 'ZA', name: 'Upington' },
  'welkom': { lat: -27.9772, lng: 26.7351, country: 'ZA', name: 'Welkom', asWritten: 'Welkom' },
  'soshanguve': { lat: -25.5167, lng: 28.1, country: 'ZA', name: 'Soshanguve' },
  'khayelitsha': { lat: -34.0383, lng: 18.6772, country: 'ZA', name: 'Khayelitsha' },
  'marikana': { lat: -25.7019, lng: 27.4756, country: 'ZA', name: 'Marikana' },
  'sandton': { lat: -26.1076, lng: 28.0567, country: 'ZA', name: 'Sandton' },
  'midrand': { lat: -25.9992, lng: 28.1263, country: 'ZA', name: 'Midrand' },
  'chitungwiza': { lat: -18.0127, lng: 31.0756, country: 'ZW', name: 'Chitungwiza' },
  'kwekwe': { lat: -18.9281, lng: 29.8149, country: 'ZW', name: 'Kwekwe' },
  'hwange': { lat: -18.3667, lng: 26.5, country: 'ZW', name: 'Hwange' },
  'chinhoyi': { lat: -17.3667, lng: 30.2, country: 'ZW', name: 'Chinhoyi' },
  'marondera': { lat: -18.1853, lng: 31.5519, country: 'ZW', name: 'Marondera' },
  'chipata': { lat: -13.6333, lng: 32.65, country: 'ZM', name: 'Chipata' },
  'solwezi': { lat: -12.1833, lng: 26.3833, country: 'ZM', name: 'Solwezi' },
  'mazabuka': { lat: -15.8583, lng: 27.7536, country: 'ZM', name: 'Mazabuka' },
  'tanga': { lat: -5.0689, lng: 39.0988, country: 'TZ', name: 'Tanga', asWritten: 'Tanga' },
  'mtwara': { lat: -10.2736, lng: 40.1828, country: 'TZ', name: 'Mtwara' },
  'iringa': { lat: -7.7667, lng: 35.7, country: 'TZ', name: 'Iringa' },
  'tabora': { lat: -5.0167, lng: 32.8, country: 'TZ', name: 'Tabora' },
  'bagamoyo': { lat: -6.4333, lng: 38.9, country: 'TZ', name: 'Bagamoyo' },
  'stone town': { lat: -6.1622, lng: 39.1921, country: 'TZ', name: 'Stone Town', asWritten: 'Stone Town' },
  'dar es salaam': { lat: -6.7924, lng: 39.2083, country: 'TZ', name: 'Dar es Salaam' },
  'kakamega': { lat: 0.2827, lng: 34.7519, country: 'KE', name: 'Kakamega' },
  'isiolo': { lat: 0.3546, lng: 37.5822, country: 'KE', name: 'Isiolo' },
  'wajir': { lat: 1.7471, lng: 40.0573, country: 'KE', name: 'Wajir' },
  'mandera': { lat: 3.9366, lng: 41.867, country: 'KE', name: 'Mandera' },
  'machakos': { lat: -1.5177, lng: 37.2634, country: 'KE', name: 'Machakos' },
  'kericho': { lat: -0.3689, lng: 35.2863, country: 'KE', name: 'Kericho' },
  'embu': { lat: -0.5389, lng: 37.4596, country: 'KE', name: 'Embu' },
  'kisii': { lat: -0.6817, lng: 34.7667, country: 'KE', name: 'Kisii' },
  'narok': { lat: -1.0875, lng: 35.8711, country: 'KE', name: 'Narok' },
  'kitui': { lat: -1.3667, lng: 38.0167, country: 'KE', name: 'Kitui' },
  'marsabit': { lat: 2.3284, lng: 37.9899, country: 'KE', name: 'Marsabit' },
  'lodwar': { lat: 3.1191, lng: 35.5973, country: 'KE', name: 'Lodwar' },
  'kapenguria': { lat: 1.2394, lng: 35.1117, country: 'KE', name: 'Kapenguria' },
  'dessie': { lat: 11.1333, lng: 39.6333, country: 'ET', name: 'Dessie' },
  'axum': { lat: 14.1211, lng: 38.7247, country: 'ET', name: 'Axum' },
  'semera': { lat: 11.7939, lng: 41.0067, country: 'ET', name: 'Semera' },
  'nekemte': { lat: 9.0833, lng: 36.55, country: 'ET', name: 'Nekemte' },
  'debre markos': { lat: 10.3333, lng: 37.7167, country: 'ET', name: 'Debre Markos' },
  'debre birhan': { lat: 9.6833, lng: 39.5333, country: 'ET', name: 'Debre Birhan' },
  'jijiga': { lat: 9.35, lng: 42.8, country: 'ET', name: 'Jijiga' },
  'kombolcha': { lat: 11.0833, lng: 39.7333, country: 'ET', name: 'Kombolcha' },
  'adwa': { lat: 14.1667, lng: 38.9, country: 'ET', name: 'Adwa' },
  'humera': { lat: 14.2833, lng: 36.6, country: 'ET', name: 'Humera' },
  'alamata': { lat: 12.4167, lng: 39.5667, country: 'ET', name: 'Alamata' },
  'beledweyne': { lat: 4.7358, lng: 45.2036, country: 'SO', name: 'Beledweyne' },
  'merca': { lat: 1.7119, lng: 44.7747, country: 'SO', name: 'Merca' },
  'jowhar': { lat: 2.7809, lng: 45.5005, country: 'SO', name: 'Jowhar' },
  'burao': { lat: 9.5221, lng: 45.5336, country: 'SO', name: 'Burao' },
  'las anod': { lat: 8.4778, lng: 47.3594, country: 'SO', name: 'Las Anod' },
  'laascaanood': { lat: 8.4778, lng: 47.3594, country: 'SO', name: 'Laascaanood' },
  'afgooye': { lat: 2.1369, lng: 45.1214, country: 'SO', name: 'Afgooye' },
  'dhusamareb': { lat: 5.5333, lng: 46.3833, country: 'SO', name: 'Dhusamareb' },
  'borama': { lat: 9.9361, lng: 43.1828, country: 'SO', name: 'Borama' },
  'ceerigaabo': { lat: 10.6167, lng: 47.3667, country: 'SO', name: 'Ceerigaabo' },
  'erigavo': { lat: 10.6167, lng: 47.3667, country: 'SO', name: 'Erigavo' },
  'baraawe': { lat: 1.1131, lng: 44.0278, country: 'SO', name: 'Baraawe' },
  'luuq': { lat: 3.8017, lng: 42.5469, country: 'SO', name: 'Luuq' },
  'beni': { lat: 0.4914, lng: 29.4731, country: 'CD', name: 'Beni', asWritten: 'Beni' },
  'kindu': { lat: -2.9436, lng: 25.9222, country: 'CD', name: 'Kindu' },
  'matadi': { lat: -5.8167, lng: 13.4667, country: 'CD', name: 'Matadi' },
  'likasi': { lat: -10.9833, lng: 26.7333, country: 'CD', name: 'Likasi' },
  'rutshuru': { lat: -1.1853, lng: 29.4439, country: 'CD', name: 'Rutshuru' },
  'masisi': { lat: -1.4, lng: 28.8167, country: 'CD', name: 'Masisi' },
  'minova': { lat: -1.6333, lng: 29.0667, country: 'CD', name: 'Minova' },
  'kalehe': { lat: -2.0667, lng: 28.9, country: 'CD', name: 'Kalehe' },
  'walikale': { lat: -1.4167, lng: 28.0333, country: 'CD', name: 'Walikale' },
  'kasindi': { lat: 0.0436, lng: 29.7283, country: 'CD', name: 'Kasindi' },
  'tshikapa': { lat: -6.4167, lng: 20.8, country: 'CD', name: 'Tshikapa' },
  'bandundu': { lat: -3.3167, lng: 17.3833, country: 'CD', name: 'Bandundu' },
  'bambari': { lat: 5.7667, lng: 20.6667, country: 'CF', name: 'Bambari' },
  'berberati': { lat: 4.2614, lng: 15.7922, country: 'CF', name: 'Berberati' },
  'bossangoa': { lat: 6.4917, lng: 17.4553, country: 'CF', name: 'Bossangoa' },
  'birao': { lat: 10.2833, lng: 22.7833, country: 'CF', name: 'Birao' },
  'ndele': { lat: 8.4, lng: 20.65, country: 'CF', name: 'Ndele' },
  'abeche': { lat: 13.8292, lng: 20.8324, country: 'TD', name: 'Abeche' },
  'moundou': { lat: 8.5667, lng: 16.0833, country: 'TD', name: 'Moundou' },
  'sarh': { lat: 9.1429, lng: 18.3923, country: 'TD', name: 'Sarh' },
  'faya-largeau': { lat: 17.9242, lng: 19.1117, country: 'TD', name: 'Faya-Largeau' },
  'koumra': { lat: 8.9167, lng: 17.55, country: 'TD', name: 'Koumra' },
  'adre': { lat: 13.4667, lng: 22.2, country: 'TD', name: 'Adre' },
  'nouadhibou': { lat: 20.9333, lng: -17.0333, country: 'MR', name: 'Nouadhibou' },
  'zouerate': { lat: 22.7333, lng: -12.4667, country: 'MR', name: 'Zouerate' },
  'kiffa': { lat: 16.6167, lng: -11.4, country: 'MR', name: 'Kiffa' },
  'diffa': { lat: 13.3154, lng: 12.6113, country: 'NE', name: 'Diffa' },
  'dosso': { lat: 13.05, lng: 3.2, country: 'NE', name: 'Dosso', asWritten: 'Dosso' },
  'arlit': { lat: 18.7369, lng: 7.3853, country: 'NE', name: 'Arlit' },
  'tillaberi': { lat: 14.2089, lng: 1.4531, country: 'NE', name: 'Tillaberi' },
  'menaka': { lat: 15.9167, lng: 2.4, country: 'ML', name: 'Menaka' },
  'tessalit': { lat: 20.2, lng: 1.0167, country: 'ML', name: 'Tessalit' },
  'koulikoro': { lat: 12.8628, lng: -7.5619, country: 'ML', name: 'Koulikoro' },
  'djenne': { lat: 13.9056, lng: -4.555, country: 'ML', name: 'Djenne' },
  'bourem': { lat: 16.9667, lng: -0.35, country: 'ML', name: 'Bourem' },
  'anefis': { lat: 18.0, lng: 0.6, country: 'ML', name: 'Anefis' },
  'tombouctou': { lat: 16.7735, lng: -3.0074, country: 'ML', name: 'Tombouctou' },
  'djibo': { lat: 14.1, lng: -1.6333, country: 'BF', name: 'Djibo' },
  'fada n\'gourma': { lat: 12.0615, lng: 0.3584, country: 'BF', name: 'Fada N\'Gourma' },
  'fada ngourma': { lat: 12.0615, lng: 0.3584, country: 'BF', name: 'Fada Ngourma' },
  'tenkodogo': { lat: 11.7803, lng: -0.3697, country: 'BF', name: 'Tenkodogo' },
  'gaoua': { lat: 10.3, lng: -3.1833, country: 'BF', name: 'Gaoua' },
  'titao': { lat: 13.7667, lng: -2.0667, country: 'BF', name: 'Titao' },
  'arbinda': { lat: 14.5, lng: 0.0833, country: 'BF', name: 'Arbinda' },
  'diapaga': { lat: 12.0667, lng: 1.7833, country: 'BF', name: 'Diapaga' },
  'mbour': { lat: 14.4198, lng: -16.9648, country: 'SN', name: 'Mbour' },
  'kolda': { lat: 12.8833, lng: -14.95, country: 'SN', name: 'Kolda' },
  'louga': { lat: 15.6144, lng: -16.2244, country: 'SN', name: 'Louga' },
  'diourbel': { lat: 14.6554, lng: -16.2314, country: 'SN', name: 'Diourbel' },
  'yamoussoukro': { lat: 6.8276, lng: -5.2893, country: 'CI', name: 'Yamoussoukro' },
  'gagnoa': { lat: 6.1319, lng: -5.9506, country: 'CI', name: 'Gagnoa' },
  'lobito': { lat: -12.3481, lng: 13.5456, country: 'AO', name: 'Lobito' },
  'benguela': { lat: -12.5763, lng: 13.4055, country: 'AO', name: 'Benguela' },
  'lubango': { lat: -14.9172, lng: 13.4925, country: 'AO', name: 'Lubango' },
  'cabinda': { lat: -5.55, lng: 12.2, country: 'AO', name: 'Cabinda' },
  'malanje': { lat: -9.5402, lng: 16.341, country: 'AO', name: 'Malanje' },
  'kuito': { lat: -12.3833, lng: 16.9333, country: 'AO', name: 'Kuito' },
  'namibe': { lat: -15.1961, lng: 12.1522, country: 'AO', name: 'Namibe' },
  'soyo': { lat: -6.1349, lng: 12.3689, country: 'AO', name: 'Soyo' },
  'saurimo': { lat: -9.6608, lng: 20.3917, country: 'AO', name: 'Saurimo' },
  'uige': { lat: -7.6087, lng: 15.0613, country: 'AO', name: 'Uige' },
  'menongue': { lat: -14.6579, lng: 17.691, country: 'AO', name: 'Menongue' },
  'oshakati': { lat: -17.7883, lng: 15.6994, country: 'NA', name: 'Oshakati' },
  'rundu': { lat: -17.9333, lng: 19.7667, country: 'NA', name: 'Rundu', asWritten: 'Rundu' },
  'katima mulilo': { lat: -17.5, lng: 24.2667, country: 'NA', name: 'Katima Mulilo' },
  'maun': { lat: -19.9833, lng: 23.4167, country: 'BW', name: 'Maun' },
  'kasane': { lat: -17.8, lng: 25.15, country: 'BW', name: 'Kasane' },
  'gisenyi': { lat: -1.7028, lng: 29.2564, country: 'RW', name: 'Gisenyi' },
  'rubavu': { lat: -1.7028, lng: 29.2564, country: 'RW', name: 'Rubavu' },
  'huye': { lat: -2.5967, lng: 29.7394, country: 'RW', name: 'Huye', asWritten: 'Huye' },
  'rusizi': { lat: -2.4833, lng: 28.9, country: 'RW', name: 'Rusizi' },
  'ngozi': { lat: -2.9075, lng: 29.8306, country: 'BI', name: 'Ngozi' },
  'muyinga': { lat: -2.845, lng: 30.3417, country: 'BI', name: 'Muyinga' },
  'cibitoke': { lat: -2.8833, lng: 29.1333, country: 'BI', name: 'Cibitoke' },
  'annaba': { lat: 36.9, lng: 7.7667, country: 'DZ', name: 'Annaba' },
  // Nov 4, 2026, 5:42 PM (M72): second cities of the Americas and Oceania (Mexico, Brazil, the Andes, the Caribbean, the United States, Canada, Australia, New Zealand, the Pacific) that gave no pin
  'akron': { lat: 41.0814, lng: -81.519, country: 'US', name: 'Akron' },
  'allentown': { lat: 40.6084, lng: -75.4902, country: 'US', name: 'Allentown' },
  'amarillo': { lat: 35.222, lng: -101.8313, country: 'US', name: 'Amarillo', asWritten: 'Amarillo' },
  'anaheim': { lat: 33.8366, lng: -117.9143, country: 'US', name: 'Anaheim' },
  'anapolis': { lat: -16.3281, lng: -48.9534, country: 'BR', name: 'Anapolis' },
  'ann arbor': { lat: 42.2808, lng: -83.743, country: 'US', name: 'Ann Arbor' },
  'annapolis': { lat: 38.9784, lng: -76.4922, country: 'US', name: 'Annapolis' },
  'aracaju': { lat: -10.9472, lng: -37.0731, country: 'BR', name: 'Aracaju' },
  'arauca': { lat: 7.0903, lng: -70.7617, country: 'CO', name: 'Arauca' },
  'arica': { lat: -18.4783, lng: -70.3126, country: 'CL', name: 'Arica' },
  'bakersfield': { lat: 35.3733, lng: -119.0187, country: 'US', name: 'Bakersfield' },
  'ballarat': { lat: -37.5622, lng: 143.8503, country: 'AU', name: 'Ballarat' },
  'baton rouge': { lat: 30.4515, lng: -91.1871, country: 'US', name: 'Baton Rouge' },
  'bendigo': { lat: -36.757, lng: 144.2794, country: 'AU', name: 'Bendigo' },
  'blumenau': { lat: -26.9194, lng: -49.0661, country: 'BR', name: 'Blumenau' },
  'boise': { lat: 43.615, lng: -116.2023, country: 'US', name: 'Boise' },
  'bondi': { lat: -33.8908, lng: 151.2743, country: 'AU', name: 'Bondi' },
  'brampton': { lat: 43.7315, lng: -79.7624, country: 'CA', name: 'Brampton' },
  'broome': { lat: -17.9614, lng: 122.2359, country: 'AU', name: 'Broome' },
  'brumadinho': { lat: -20.1431, lng: -44.1992, country: 'BR', name: 'Brumadinho' },
  'burnaby': { lat: 49.2488, lng: -122.9805, country: 'CA', name: 'Burnaby' },
  'cabo san lucas': { lat: 22.8905, lng: -109.9167, country: 'MX', name: 'Cabo San Lucas' },
  'campina grande': { lat: -7.2306, lng: -35.8811, country: 'BR', name: 'Campina Grande' },
  'caruaru': { lat: -8.276, lng: -35.9819, country: 'BR', name: 'Caruaru' },
  'caxias do sul': { lat: -29.1678, lng: -51.1794, country: 'BR', name: 'Caxias Do Sul' },
  'celaya': { lat: 20.5235, lng: -100.8157, country: 'MX', name: 'Celaya' },
  'charlottesville': { lat: 38.0293, lng: -78.4767, country: 'US', name: 'Charlottesville' },
  'charlottetown': { lat: 46.2382, lng: -63.1311, country: 'CA', name: 'Charlottetown' },
  'chattanooga': { lat: 35.0456, lng: -85.3097, country: 'US', name: 'Chattanooga' },
  'chinandega': { lat: 12.6292, lng: -87.1311, country: 'NI', name: 'Chinandega' },
  'choloma': { lat: 15.6144, lng: -87.9528, country: 'HN', name: 'Choloma' },
  'cite soleil': { lat: 18.5833, lng: -72.3333, country: 'HT', name: 'Cite Soleil' },
  'ciudad bolivar': { lat: 8.1222, lng: -63.5497, country: 'VE', name: 'Ciudad Bolivar' },
  'ciudad obregon': { lat: 27.4828, lng: -109.9304, country: 'MX', name: 'Ciudad Obregon' },
  'ciudad victoria': { lat: 23.7369, lng: -99.1411, country: 'MX', name: 'Ciudad Victoria' },
  'colima': { lat: 19.2433, lng: -103.725, country: 'MX', name: 'Colima' },
  'colorado springs': { lat: 38.8339, lng: -104.8214, country: 'US', name: 'Colorado Springs' },
  'comodoro rivadavia': { lat: -45.8641, lng: -67.4966, country: 'AR', name: 'Comodoro Rivadavia' },
  'contagem': { lat: -19.9319, lng: -44.0539, country: 'BR', name: 'Contagem', asWritten: 'Contagem' },
  'corpus christi': { lat: 27.8006, lng: -97.3964, country: 'US', name: 'Corpus Christi' },
  'cozumel': { lat: 20.423, lng: -86.9223, country: 'MX', name: 'Cozumel' },
  'croix-des-bouquets': { lat: 18.5772, lng: -72.2272, country: 'HT', name: 'Croix-Des-Bouquets' },
  'dayton': { lat: 39.7589, lng: -84.1916, country: 'US', name: 'Dayton' },
  'des moines': { lat: 41.5868, lng: -93.625, country: 'US', name: 'Des Moines', asWritten: 'Des Moines' },
  'dubbo': { lat: -32.2569, lng: 148.6011, country: 'AU', name: 'Dubbo' },
  'duluth': { lat: 46.7867, lng: -92.1005, country: 'US', name: 'Duluth' },
  'duque de caxias': { lat: -22.7856, lng: -43.3117, country: 'BR', name: 'Duque de Caxias' },
  'ecatepec': { lat: 19.601, lng: -99.06, country: 'MX', name: 'Ecatepec' },
  'el alto': { lat: -16.5047, lng: -68.163, country: 'BO', name: 'El Alto', asWritten: 'El Alto' },
  'evansville': { lat: 37.9716, lng: -87.5711, country: 'US', name: 'Evansville' },
  'fargo': { lat: 46.8772, lng: -96.7898, country: 'US', name: 'Fargo' },
  'feira de santana': { lat: -12.2664, lng: -38.9663, country: 'BR', name: 'Feira de Santana' },
  'fort bragg': { lat: 35.139, lng: -79.006, country: 'US', name: 'Fort Bragg' },
  'fort collins': { lat: 40.5853, lng: -105.0844, country: 'US', name: 'Fort Collins' },
  'fort lauderdale': { lat: 26.1224, lng: -80.1373, country: 'US', name: 'Fort Lauderdale' },
  'fort mcmurray': { lat: 56.7267, lng: -111.379, country: 'CA', name: 'Fort Mcmurray' },
  'fort wayne': { lat: 41.0793, lng: -85.1394, country: 'US', name: 'Fort Wayne' },
  'fredericton': { lat: 45.9636, lng: -66.6431, country: 'CA', name: 'Fredericton' },
  'fresno': { lat: 36.7378, lng: -119.7871, country: 'US', name: 'Fresno' },
  'galveston': { lat: 29.3013, lng: -94.7977, country: 'US', name: 'Galveston' },
  'gatineau': { lat: 45.4765, lng: -75.7013, country: 'CA', name: 'Gatineau' },
  'gold coast': { lat: -28.0167, lng: 153.4, country: 'AU', name: 'Gold Coast', asWritten: 'Gold Coast' },
  'grand rapids': { lat: 42.9634, lng: -85.6681, country: 'US', name: 'Grand Rapids' },
  'green bay': { lat: 44.5192, lng: -88.0198, country: 'US', name: 'Green Bay' },
  'greensboro': { lat: 36.0726, lng: -79.792, country: 'US', name: 'Greensboro' },
  'guanajuato': { lat: 21.019, lng: -101.2574, country: 'MX', name: 'Guanajuato' },
  'guarulhos': { lat: -23.4543, lng: -46.5337, country: 'BR', name: 'Guarulhos' },
  'hagatna': { lat: 13.4757, lng: 144.7489, country: 'GU', name: 'Hagatna' },
  'harrisburg': { lat: 40.2732, lng: -76.8867, country: 'US', name: 'Harrisburg' },
  'hartford': { lat: 41.7658, lng: -72.6734, country: 'US', name: 'Hartford' },
  'iguala': { lat: 18.3456, lng: -99.5398, country: 'MX', name: 'Iguala' },
  'ilheus': { lat: -14.7889, lng: -39.0494, country: 'BR', name: 'Ilheus' },
  'invercargill': { lat: -46.4132, lng: 168.3538, country: 'NZ', name: 'Invercargill' },
  'iqaluit': { lat: 63.7467, lng: -68.517, country: 'CA', name: 'Iqaluit' },
  'jacksonville': { lat: 30.3322, lng: -81.6557, country: 'US', name: 'Jacksonville' },
  'jeremie': { lat: 18.65, lng: -74.1167, country: 'HT', name: 'Jeremie' },
  'joao pessoa': { lat: -7.1195, lng: -34.845, country: 'BR', name: 'Joao Pessoa' },
  'juazeiro do norte': { lat: -7.213, lng: -39.3153, country: 'BR', name: 'Juazeiro Do Norte' },
  'juiz de fora': { lat: -21.7642, lng: -43.3503, country: 'BR', name: 'Juiz de Fora', asWritten: 'Juiz de Fora' },
  'juneau': { lat: 58.3019, lng: -134.4197, country: 'US', name: 'Juneau' },
  'kalgoorlie': { lat: -30.7489, lng: 121.4658, country: 'AU', name: 'Kalgoorlie' },
  'kamloops': { lat: 50.6745, lng: -120.3273, country: 'CA', name: 'Kamloops' },
  'kelowna': { lat: 49.888, lng: -119.496, country: 'CA', name: 'Kelowna' },
  'kenosha': { lat: 42.5847, lng: -87.8212, country: 'US', name: 'Kenosha' },
  'kitchener': { lat: 43.4516, lng: -80.4925, country: 'CA', name: 'Kitchener' },
  'knoxville': { lat: 35.9606, lng: -83.9207, country: 'US', name: 'Knoxville' },
  'lahaina': { lat: 20.8783, lng: -156.6825, country: 'US', name: 'Lahaina' },
  'launceston': { lat: -41.4332, lng: 147.1441, country: 'AU', name: 'Launceston' },
  'lautoka': { lat: -17.6167, lng: 177.45, country: 'FJ', name: 'Lautoka' },
  'lethbridge': { lat: 49.6935, lng: -112.8418, country: 'CA', name: 'Lethbridge' },
  'lismore': { lat: -28.8135, lng: 153.277, country: 'AU', name: 'Lismore' },
  'little rock': { lat: 34.7465, lng: -92.2896, country: 'US', name: 'Little Rock', asWritten: 'Little Rock' },
  'londrina': { lat: -23.3045, lng: -51.1696, country: 'BR', name: 'Londrina' },
  'los cabos': { lat: 22.8905, lng: -109.9167, country: 'MX', name: 'Los Cabos', asWritten: 'Los Cabos' },
  'los mochis': { lat: 25.7903, lng: -108.9858, country: 'MX', name: 'Los Mochis' },
  'louisville': { lat: 38.2527, lng: -85.7585, country: 'US', name: 'Louisville' },
  'lubbock': { lat: 33.5779, lng: -101.8552, country: 'US', name: 'Lubbock' },
  'machu picchu': { lat: -13.1631, lng: -72.545, country: 'PE', name: 'Machu Picchu' },
  'madang': { lat: -5.2246, lng: 145.7966, country: 'PG', name: 'Madang' },
  'mar-a-lago': { lat: 26.6769, lng: -80.0369, country: 'US', name: 'Mar-a-Lago' },
  'maraba': { lat: -5.3686, lng: -49.1178, country: 'BR', name: 'Maraba' },
  'maringa': { lat: -23.4205, lng: -51.9333, country: 'BR', name: 'Maringa' },
  'mcallen': { lat: 26.2034, lng: -98.23, country: 'US', name: 'Mcallen' },
  'medicine hat': { lat: 50.0405, lng: -110.6766, country: 'CA', name: 'Medicine Hat' },
  'mildura': { lat: -34.208, lng: 142.1246, country: 'AU', name: 'Mildura' },
  'mississauga': { lat: 43.589, lng: -79.6441, country: 'CA', name: 'Mississauga' },
  'moncton': { lat: 46.0878, lng: -64.7782, country: 'CA', name: 'Moncton' },
  'mossoro': { lat: -5.1878, lng: -37.3441, country: 'BR', name: 'Mossoro' },
  'mount hagen': { lat: -5.859, lng: 144.228, country: 'PG', name: 'Mount Hagen' },
  'nanaimo': { lat: 49.1659, lng: -123.9401, country: 'CA', name: 'Nanaimo' },
  'new haven': { lat: 41.3083, lng: -72.9279, country: 'US', name: 'New Haven' },
  'nezahualcoyotl': { lat: 19.4003, lng: -99.0148, country: 'MX', name: 'Nezahualcoyotl' },
  'niteroi': { lat: -22.8832, lng: -43.1034, country: 'BR', name: 'Niteroi' },
  'nukualofa': { lat: -21.1394, lng: -175.2018, country: 'TO', name: 'Nukualofa' },
  'omaha': { lat: 41.2565, lng: -95.9345, country: 'US', name: 'Omaha' },
  'oranjestad': { lat: 12.524, lng: -70.027, country: 'AW', name: 'Oranjestad' },
  'pachuca': { lat: 20.1011, lng: -98.7591, country: 'MX', name: 'Pachuca' },
  'palmerston north': { lat: -40.3523, lng: 175.6082, country: 'NZ', name: 'Palmerston North' },
  'papeete': { lat: -17.5516, lng: -149.5585, country: 'PF', name: 'Papeete' },
  'pedro juan caballero': { lat: -22.5472, lng: -55.7258, country: 'PY', name: 'Pedro Juan Caballero' },
  'pelotas': { lat: -31.7654, lng: -52.3376, country: 'BR', name: 'Pelotas', asWritten: 'Pelotas' },
  'pensacola': { lat: 30.4213, lng: -87.2169, country: 'US', name: 'Pensacola' },
  'petion-ville': { lat: 18.5125, lng: -72.2853, country: 'HT', name: 'Petion-Ville' },
  'petropolis': { lat: -22.505, lng: -43.1786, country: 'BR', name: 'Petropolis' },
  'port hedland': { lat: -20.3106, lng: 118.6011, country: 'AU', name: 'Port Hedland' },
  'porto seguro': { lat: -16.4435, lng: -39.0643, country: 'BR', name: 'Porto Seguro', asWritten: 'Porto Seguro' },
  'prince george': { lat: 53.9171, lng: -122.7497, country: 'CA', name: 'Prince George' },
  'pucallpa': { lat: -8.3791, lng: -74.5539, country: 'PE', name: 'Pucallpa' },
  'puebla': { lat: 19.0414, lng: -98.2063, country: 'MX', name: 'Puebla' },
  'puerto barrios': { lat: 15.7278, lng: -88.5944, country: 'GT', name: 'Puerto Barrios' },
  'puerto la cruz': { lat: 10.2136, lng: -64.6306, country: 'VE', name: 'Puerto La Cruz' },
  'puerto vallarta': { lat: 20.6534, lng: -105.2253, country: 'MX', name: 'Puerto Vallarta' },
  'puno': { lat: -15.8402, lng: -70.0219, country: 'PE', name: 'Puno', asWritten: 'Puno' },
  'quantico': { lat: 38.522, lng: -77.2933, country: 'US', name: 'Quantico', asWritten: 'Quantico' },
  'quibdo': { lat: 5.6947, lng: -76.6611, country: 'CO', name: 'Quibdo' },
  'rabaul': { lat: -4.1999, lng: 152.1721, country: 'PG', name: 'Rabaul' },
  'raleigh': { lat: 35.7796, lng: -78.6382, country: 'US', name: 'Raleigh' },
  'salt lake': { lat: 40.7608, lng: -111.891, country: 'US', name: 'Salt Lake', asWritten: 'Salt Lake' },
  'san cristobal de las casas': { lat: 16.737, lng: -92.6376, country: 'MX', name: 'San Cristobal de Las Casas' },
  // as written: Spanish "Santa Bárbara" is the saint, Honduras' department and a dozen towns (Nov 6, 2026: with accents
  // read, Honduras' was California's)
  'santa barbara': { lat: 34.4208, lng: -119.6982, country: 'US', name: 'Santa Barbara', asWritten: 'Santa Barbara' },
  'sao jose dos campos': { lat: -23.2237, lng: -45.9009, country: 'BR', name: 'Sao Jose dos Campos' },
  'saskatoon': { lat: 52.1332, lng: -106.67, country: 'CA', name: 'Saskatoon' },
  'scranton': { lat: 41.409, lng: -75.6624, country: 'US', name: 'Scranton' },
  'sherbrooke': { lat: 45.4042, lng: -71.8929, country: 'CA', name: 'Sherbrooke' },
  'shreveport': { lat: 32.5252, lng: -93.7502, country: 'US', name: 'Shreveport' },
  'sioux falls': { lat: 43.5446, lng: -96.7311, country: 'US', name: 'Sioux Falls' },
  'sorocaba': { lat: -23.5015, lng: -47.4526, country: 'BR', name: 'Sorocaba' },
  'spokane': { lat: 47.6588, lng: -117.426, country: 'US', name: 'Spokane' },
  'sunshine coast': { lat: -26.65, lng: 153.0667, country: 'AU', name: 'Sunshine Coast' },
  'syracuse': { lat: 43.0481, lng: -76.1474, country: 'US', name: 'Syracuse' },
  'tabatinga': { lat: -4.253, lng: -69.938, country: 'BR', name: 'Tabatinga' },
  'tacna': { lat: -18.0066, lng: -70.2463, country: 'PE', name: 'Tacna', asWritten: 'Tacna' },
  'tacoma': { lat: 47.2529, lng: -122.4443, country: 'US', name: 'Tacoma' },
  'tallahassee': { lat: 30.4383, lng: -84.2807, country: 'US', name: 'Tallahassee' },
  'tampa': { lat: 27.9506, lng: -82.4572, country: 'US', name: 'Tampa', asWritten: 'Tampa' },
  'tampico': { lat: 22.2331, lng: -97.8611, country: 'MX', name: 'Tampico' },
  'tamuning': { lat: 13.4894, lng: 144.7833, country: 'GU', name: 'Tamuning' },
  'thunder bay': { lat: 48.3809, lng: -89.2477, country: 'CA', name: 'Thunder Bay' },
  'toluca': { lat: 19.2826, lng: -99.6557, country: 'MX', name: 'Toluca' },
  'toowoomba': { lat: -27.5598, lng: 151.9507, country: 'AU', name: 'Toowoomba' },
  'topeka': { lat: 39.0473, lng: -95.6752, country: 'US', name: 'Topeka' },
  'trenton': { lat: 40.2171, lng: -74.7429, country: 'US', name: 'Trenton' },
  'tulsa': { lat: 36.154, lng: -95.9928, country: 'US', name: 'Tulsa' },
  'uberlandia': { lat: -18.9186, lng: -48.2772, country: 'BR', name: 'Uberlandia' },
  'uvalde': { lat: 29.2097, lng: -99.7862, country: 'US', name: 'Uvalde' },
  'vina del mar': { lat: -33.0153, lng: -71.55, country: 'CL', name: 'Vina del Mar' },
  'wagga wagga': { lat: -35.1082, lng: 147.3598, country: 'AU', name: 'Wagga Wagga' },
  'wewak': { lat: -3.5534, lng: 143.6268, country: 'PG', name: 'Wewak' },
  'whangarei': { lat: -35.7251, lng: 174.3237, country: 'NZ', name: 'Whangarei' },
  'whitehorse': { lat: 60.7212, lng: -135.0568, country: 'CA', name: 'Whitehorse' },
  'wichita': { lat: 37.6872, lng: -97.3301, country: 'US', name: 'Wichita' },
  'willemstad': { lat: 12.1696, lng: -68.99, country: 'CW', name: 'Willemstad' },
  'wollongong': { lat: -34.4278, lng: 150.8931, country: 'AU', name: 'Wollongong' },
  'xalapa': { lat: 19.5438, lng: -96.9102, country: 'MX', name: 'Xalapa' },
  'yellowknife': { lat: 62.454, lng: -114.3718, country: 'CA', name: 'Yellowknife' },
  'youngstown': { lat: 41.0998, lng: -80.6495, country: 'US', name: 'Youngstown' },
  // Nov 5, 2026, 12:43 AM (M73): named hot spots (bases, border towns, camps, test sites, regions) that gave no pin
  'afrin': { lat: 36.51, lng: 36.87, country: 'SY', name: 'Afrin' },
  'al hol': { lat: 36.38, lng: 41.15, country: 'SY', name: 'Al-Hol' },
  'al-hol': { lat: 36.38, lng: 41.15, country: 'SY', name: 'Al-Hol' },
  'amhara': { lat: 11.5, lng: 38.0, country: 'ET', name: 'Amhara' },
  'assab': { lat: 13.0, lng: 42.74, country: 'ER', name: 'Assab' },
  'atacama desert': { lat: -24.5, lng: -69.25, country: 'CL', name: 'Atacama Desert' },
  'beit hanoun': { lat: 31.54, lng: 34.54, country: 'PS', name: 'Beit Hanoun' },
  'bougainville': { lat: -6.3, lng: 155.4, country: 'PG', name: 'Bougainville' },
  'catatumbo': { lat: 8.5, lng: -73.0, country: 'CO', name: 'Catatumbo' },
  'chapare': { lat: -16.9, lng: -65.4, country: 'BO', name: 'Chapare' },
  'chernobyl': { lat: 51.389, lng: 30.099, country: 'UA', name: 'Chernobyl', asWritten: 'Chernobyl' },   // not "el «Chernóbyl argentino»"
  'chiapas': { lat: 16.5, lng: -92.5, country: 'MX', name: 'Chiapas' },
  'dadaab': { lat: 0.054, lng: 40.31, country: 'KE', name: 'Dadaab' },
  'dimona': { lat: 31.07, lng: 35.03, country: 'IL', name: 'Dimona' },
  'gorno-badakhshan': { lat: 38.5, lng: 72.0, country: 'TJ', name: 'Gorno-Badakhshan' },
  'gotland': { lat: 57.47, lng: 18.49, country: 'SE', name: 'Gotland' },
  'hainan': { lat: 19.2, lng: 109.7, country: 'CN', name: 'Hainan' },
  'incirlik': { lat: 37.002, lng: 35.426, country: 'TR', name: 'Incirlik' },
  'iwo jima': { lat: 24.78, lng: 141.32, country: 'JP', name: 'Iwo Jima' },
  'jubail': { lat: 27.0, lng: 49.66, country: 'SA', name: 'Jubail' },
  'kachin': { lat: 25.6, lng: 97.5, country: 'MM', name: 'Kachin' },
  'kakuma': { lat: 3.12, lng: 34.87, country: 'KE', name: 'Kakuma' },
  'kamchatka': { lat: 56.0, lng: 160.0, country: 'RU', name: 'Kamchatka' },
  'kapoeta': { lat: 4.77, lng: 33.59, country: 'SS', name: 'Kapoeta' },
  'karakalpakstan': { lat: 43.0, lng: 59.0, country: 'UZ', name: 'Karakalpakstan' },
  'kasai': { lat: -5.0, lng: 21.0, country: 'CD', name: 'Kasai' },
  'katanga': { lat: -9.5, lng: 25.5, country: 'CD', name: 'Katanga' },
  'khmeimim': { lat: 35.4, lng: 35.95, country: 'SY', name: 'Khmeimim' },
  'khor fakkan': { lat: 25.34, lng: 56.36, country: 'AE', name: 'Khor Fakkan' },
  'kinmen': { lat: 24.45, lng: 118.38, country: 'TW', name: 'Kinmen' },
  'lac assal': { lat: 11.66, lng: 42.42, country: 'DJ', name: 'Lac Assal' },
  'marajo': { lat: -1.0, lng: -49.6, country: 'BR', name: 'Marajo' },
  'masafer yatta': { lat: 31.4, lng: 35.15, country: 'PS', name: 'Masafer Yatta' },
  'matsu islands': { lat: 26.16, lng: 119.95, country: 'TW', name: 'Matsu Islands' },
  'mayotte': { lat: -12.8275, lng: 45.1662, country: 'YT', name: 'Mayotte' },
  'metula': { lat: 33.28, lng: 35.58, country: 'IL', name: 'Metula' },
  'michoacan': { lat: 19.2, lng: -101.9, country: 'MX', name: 'Michoacan' },
  'michoacán': { lat: 19.2, lng: -101.9, country: 'MX', name: 'Michoacan' },
  'mocimboa da praia': { lat: -11.35, lng: 40.35, country: 'MZ', name: 'Mocimboa da Praia' },
  'narva': { lat: 59.377, lng: 28.19, country: 'EE', name: 'Narva' },
  'new caledonia': { lat: -21.25, lng: 165.5, country: 'NC', name: 'New Caledonia' },
  'niger delta': { lat: 5.0, lng: 6.0, country: 'NG', name: 'Niger Delta' },
  'noumea': { lat: -22.2758, lng: 166.458, country: 'NC', name: 'Noumea' },
  'nouméa': { lat: -22.2758, lng: 166.458, country: 'NC', name: 'Noumea' },
  'nuseirat': { lat: 31.45, lng: 34.39, country: 'PS', name: 'Nuseirat' },
  'obock': { lat: 11.97, lng: 43.29, country: 'DJ', name: 'Obock' },
  'ogaden': { lat: 7.5, lng: 44.5, country: 'ET', name: 'Ogaden' },
  'palmyra': { lat: 34.55, lng: 38.27, country: 'SY', name: 'Palmyra' },
  'plesetsk': { lat: 62.925, lng: 40.577, country: 'RU', name: 'Plesetsk' },
  'pskov': { lat: 57.819, lng: 28.332, country: 'RU', name: 'Pskov' },
  'punggye-ri': { lat: 41.28, lng: 129.08, country: 'KP', name: 'Punggye-ri' },
  'ramstein': { lat: 49.437, lng: 7.6, country: 'DE', name: 'Ramstein' },
  'renk': { lat: 11.75, lng: 32.8, country: 'SS', name: 'Renk' },
  'rondonia': { lat: -10.9, lng: -62.8, country: 'BR', name: 'Rondonia' },
  'rondônia': { lat: -10.9, lng: -62.8, country: 'BR', name: 'Rondonia' },
  'sadr city': { lat: 33.38, lng: 44.46, country: 'IQ', name: 'Sadr City' },
  'sakhalin': { lat: 50.7, lng: 142.9, country: 'RU', name: 'Sakhalin' },
  'severomorsk': { lat: 69.073, lng: 33.416, country: 'RU', name: 'Severomorsk' },
  'sinaloa': { lat: 25.0, lng: -107.5, country: 'MX', name: 'Sinaloa' },
  'sinjar': { lat: 36.32, lng: 41.87, country: 'IQ', name: 'Sinjar' },
  'socotra': { lat: 12.5, lng: 54.0, country: 'YE', name: 'Socotra' },
  'sohae': { lat: 39.66, lng: 124.7, country: 'KP', name: 'Sohae' },
  'suakin': { lat: 19.1, lng: 37.33, country: 'SD', name: 'Suakin' },
  'tabqa': { lat: 35.836, lng: 38.545, country: 'SY', name: 'Tabqa' },
  'tamaulipas': { lat: 24.3, lng: -98.6, country: 'MX', name: 'Tamaulipas' },
  'tulkarem': { lat: 32.31, lng: 35.03, country: 'PS', name: 'Tulkarm' },
  'tulkarm': { lat: 32.31, lng: 35.03, country: 'PS', name: 'Tulkarm' },
  'turkana': { lat: 3.1, lng: 35.6, country: 'KE', name: 'Turkana' },
  'umm qasr': { lat: 30.03, lng: 47.93, country: 'IQ', name: 'Umm Qasr' },
  'vostochny cosmodrome': { lat: 51.884, lng: 128.334, country: 'RU', name: 'Vostochny Cosmodrome' },
  'wakhan': { lat: 36.9, lng: 72.4, country: 'AF', name: 'Wakhan' },
  'waziristan': { lat: 32.5, lng: 69.7, country: 'PK', name: 'Waziristan' },
  'yakutsk': { lat: 62.035, lng: 129.675, country: 'RU', name: 'Yakutsk' },
  'yongbyon': { lat: 39.8, lng: 125.75, country: 'KP', name: 'Yongbyon' },
  // Nov 5, 2026, 8:44 AM (M74): second cities of Britain, the Baltics, western and southern Europe, the Balkans and Belarus that gave no pin
  'dundee': { lat: 56.462, lng: -2.971, country: 'GB', name: 'Dundee' },
  'inverness': { lat: 57.4778, lng: -4.2247, country: 'GB', name: 'Inverness' },
  'swansea': { lat: 51.6214, lng: -3.9436, country: 'GB', name: 'Swansea' },
  'londonderry': { lat: 54.9966, lng: -7.3086, country: 'GB', name: 'Londonderry' },
  'leicester': { lat: 52.6369, lng: -1.1398, country: 'GB', name: 'Leicester' },
  'nottingham': { lat: 52.9548, lng: -1.1581, country: 'GB', name: 'Nottingham' },
  'coventry': { lat: 52.4068, lng: -1.5197, country: 'GB', name: 'Coventry' },
  'stoke-on-trent': { lat: 53.0027, lng: -2.1794, country: 'GB', name: 'Stoke-on-Trent' },
  'wolverhampton': { lat: 52.5870, lng: -2.1288, country: 'GB', name: 'Wolverhampton' },
  'bournemouth': { lat: 50.7192, lng: -1.8808, country: 'GB', name: 'Bournemouth' },
  'luton': { lat: 51.8787, lng: -0.42, country: 'GB', name: 'Luton' },
  'middlesbrough': { lat: 54.5742, lng: -1.2350, country: 'GB', name: 'Middlesbrough' },
  'sunderland': { lat: 54.9069, lng: -1.3838, country: 'GB', name: 'Sunderland' },
  'daugavpils': { lat: 55.8747, lng: 26.5362, country: 'LV', name: 'Daugavpils' },
  'liepaja': { lat: 56.5047, lng: 21.0108, country: 'LV', name: 'Liepaja' },
  'liepāja': { lat: 56.5047, lng: 21.0108, country: 'LV', name: 'Liepaja' },
  'klaipeda': { lat: 55.7033, lng: 21.1443, country: 'LT', name: 'Klaipeda' },
  'klaipėda': { lat: 55.7033, lng: 21.1443, country: 'LT', name: 'Klaipeda' },
  'siauliai': { lat: 55.9349, lng: 23.3137, country: 'LT', name: 'Siauliai' },
  'liege': { lat: 50.6326, lng: 5.5797, country: 'BE', name: 'Liege', asWritten: 'Liege' },
  'liège': { lat: 50.6326, lng: 5.5797, country: 'BE', name: 'Liege', asWritten: 'Liège' },
  'dunkirk': { lat: 51.0343, lng: 2.3768, country: 'FR', name: 'Dunkirk' },
  'dunkerque': { lat: 51.0343, lng: 2.3768, country: 'FR', name: 'Dunkirk' },
  'cannes': { lat: 43.5528, lng: 7.0174, country: 'FR', name: 'Cannes' },
  'dijon': { lat: 47.322, lng: 5.0415, country: 'FR', name: 'Dijon' },
  'cologne': { lat: 50.9375, lng: 6.9603, country: 'DE', name: 'Cologne' },
  'köln': { lat: 50.9375, lng: 6.9603, country: 'DE', name: 'Cologne' },
  'chemnitz': { lat: 50.8278, lng: 12.9214, country: 'DE', name: 'Chemnitz' },
  'kiel': { lat: 54.3233, lng: 10.1228, country: 'DE', name: 'Kiel' },
  'geneva': { lat: 46.2044, lng: 6.1432, country: 'CH', name: 'Geneva' },
  'genève': { lat: 46.2044, lng: 6.1432, country: 'CH', name: 'Geneva' },
  'bologna': { lat: 44.4949, lng: 11.3426, country: 'IT', name: 'Bologna' },
  'bari': { lat: 41.1171, lng: 16.8719, country: 'IT', name: 'Bari', asWritten: 'Bari' },
  'brindisi': { lat: 40.6327, lng: 17.9418, country: 'IT', name: 'Brindisi' },
  'messina': { lat: 38.1938, lng: 15.554, country: 'IT', name: 'Messina' },
  'vigo': { lat: 42.2406, lng: -8.7207, country: 'ES', name: 'Vigo' },
  'porto': { lat: 41.1579, lng: -8.6291, country: 'PT', name: 'Porto', asWritten: 'Porto' },
  'faro': { lat: 37.0194, lng: -7.9304, country: 'PT', name: 'Faro', asWritten: 'Faro' },
  'braga': { lat: 41.5454, lng: -8.4265, country: 'PT', name: 'Braga' },
  'patras': { lat: 38.2466, lng: 21.7346, country: 'GR', name: 'Patras' },
  'heraklion': { lat: 35.3387, lng: 25.1442, country: 'GR', name: 'Heraklion' },
  'larissa': { lat: 39.639, lng: 22.4191, country: 'GR', name: 'Larissa' },
  'lesbos': { lat: 39.1, lng: 26.55, country: 'GR', name: 'Lesbos' },
  'lesvos': { lat: 39.1, lng: 26.55, country: 'GR', name: 'Lesbos' },
  'chios': { lat: 38.3678, lng: 26.1357, country: 'GR', name: 'Chios' },
  'corfu': { lat: 39.6243, lng: 19.9217, country: 'GR', name: 'Corfu' },
  'piraeus': { lat: 37.9475, lng: 23.6469, country: 'GR', name: 'Piraeus' },
  'paphos': { lat: 34.7754, lng: 32.4245, country: 'CY', name: 'Paphos' },
  'famagusta': { lat: 35.1264, lng: 33.9378, country: 'CY', name: 'Famagusta' },
  'przemysl': { lat: 49.7839, lng: 22.7678, country: 'PL', name: 'Przemysl' },
  'przemyśl': { lat: 49.7839, lng: 22.7678, country: 'PL', name: 'Przemysl' },
  'debrecen': { lat: 47.5316, lng: 21.6273, country: 'HU', name: 'Debrecen' },
  'szeged': { lat: 46.253, lng: 20.1414, country: 'HU', name: 'Szeged' },
  'miskolc': { lat: 48.1035, lng: 20.7784, country: 'HU', name: 'Miskolc' },
  'cluj': { lat: 46.7712, lng: 23.6236, country: 'RO', name: 'Cluj-Napoca' },
  'craiova': { lat: 44.3302, lng: 23.7949, country: 'RO', name: 'Craiova' },
  'kragujevac': { lat: 44.0128, lng: 20.9114, country: 'RS', name: 'Kragujevac' },
  'subotica': { lat: 46.1, lng: 19.6667, country: 'RS', name: 'Subotica' },
  'zadar': { lat: 44.1194, lng: 15.2314, country: 'HR', name: 'Zadar', asWritten: 'Zadar' },
  'dubrovnik': { lat: 42.6507, lng: 18.0944, country: 'HR', name: 'Dubrovnik' },
  'tuzla': { lat: 44.5384, lng: 18.6671, country: 'BA', name: 'Tuzla' },
  'bihac': { lat: 44.8169, lng: 15.8708, country: 'BA', name: 'Bihac' },
  'bihać': { lat: 44.8169, lng: 15.8708, country: 'BA', name: 'Bihac' },
  'srebrenica': { lat: 44.1053, lng: 19.2976, country: 'BA', name: 'Srebrenica' },
  'tetovo': { lat: 42.0069, lng: 20.9715, country: 'MK', name: 'Tetovo' },
  'ohrid': { lat: 41.1231, lng: 20.8016, country: 'MK', name: 'Ohrid' },
  'durres': { lat: 41.3246, lng: 19.4565, country: 'AL', name: 'Durres' },
  'durrës': { lat: 41.3246, lng: 19.4565, country: 'AL', name: 'Durres' },
  'vlora': { lat: 40.4661, lng: 19.4914, country: 'AL', name: 'Vlora' },
  'shkoder': { lat: 42.0683, lng: 19.5126, country: 'AL', name: 'Shkoder' },
  'shkodër': { lat: 42.0683, lng: 19.5126, country: 'AL', name: 'Shkoder' },
  'grodno': { lat: 53.6694, lng: 23.8131, country: 'BY', name: 'Grodno' },
  'vitebsk': { lat: 55.1904, lng: 30.2049, country: 'BY', name: 'Vitebsk' },
  'mogilev': { lat: 53.9007, lng: 30.3313, country: 'BY', name: 'Mogilev' },
  // Nov 5, 2026, 5:42 PM (M75): second cities of the Nordics, Japan and South Korea, and Pacific islands that gave no pin
  'espoo': { lat: 60.2055, lng: 24.6559, country: 'FI', name: 'Espoo' },
  'esbjerg': { lat: 55.4765, lng: 8.4594, country: 'DK', name: 'Esbjerg' },
  'kristiansand': { lat: 58.1467, lng: 7.9956, country: 'NO', name: 'Kristiansand' },
  'narvik': { lat: 68.4385, lng: 17.4272, country: 'NO', name: 'Narvik' },
  'vasteras': { lat: 59.6099, lng: 16.5448, country: 'SE', name: 'Vasteras' },
  'västerås': { lat: 59.6099, lng: 16.5448, country: 'SE', name: 'Vasteras' },
  'kiruna': { lat: 67.8558, lng: 20.2253, country: 'SE', name: 'Kiruna' },
  'lulea': { lat: 65.5848, lng: 22.1547, country: 'SE', name: 'Lulea' },
  'luleå': { lat: 65.5848, lng: 22.1547, country: 'SE', name: 'Lulea' },
  'umea': { lat: 63.8258, lng: 20.2630, country: 'SE', name: 'Umea' },
  'umeå': { lat: 63.8258, lng: 20.2630, country: 'SE', name: 'Umea' },
  'akureyri': { lat: 65.6885, lng: -18.1262, country: 'IS', name: 'Akureyri' },
  'hamamatsu': { lat: 34.7108, lng: 137.7261, country: 'JP', name: 'Hamamatsu' },
  'okayama': { lat: 34.6551, lng: 133.9195, country: 'JP', name: 'Okayama' },
  'shizuoka': { lat: 34.9756, lng: 138.3828, country: 'JP', name: 'Shizuoka' },
  'sagamihara': { lat: 35.5714, lng: 139.3733, country: 'JP', name: 'Sagamihara' },
  'kitakyushu': { lat: 33.8834, lng: 130.8752, country: 'JP', name: 'Kitakyushu' },
  'matsuyama': { lat: 33.8392, lng: 132.7657, country: 'JP', name: 'Matsuyama' },
  'kanazawa': { lat: 36.5613, lng: 136.6562, country: 'JP', name: 'Kanazawa' },
  'gifu': { lat: 35.4233, lng: 136.7607, country: 'JP', name: 'Gifu' },
  'himeji': { lat: 34.8151, lng: 134.6853, country: 'JP', name: 'Himeji' },
  'hakodate': { lat: 41.7687, lng: 140.7288, country: 'JP', name: 'Hakodate' },
  'asahikawa': { lat: 43.7706, lng: 142.3649, country: 'JP', name: 'Asahikawa' },
  'aomori': { lat: 40.8244, lng: 140.7400, country: 'JP', name: 'Aomori' },
  'changwon': { lat: 35.2281, lng: 128.6811, country: 'KR', name: 'Changwon' },
  'cheongju': { lat: 36.6424, lng: 127.4890, country: 'KR', name: 'Cheongju' },
  'jeonju': { lat: 35.8242, lng: 127.1480, country: 'KR', name: 'Jeonju' },
  'seongnam': { lat: 37.4200, lng: 127.1265, country: 'KR', name: 'Seongnam' },
  'goyang': { lat: 37.6584, lng: 126.8320, country: 'KR', name: 'Goyang' },
  'yongin': { lat: 37.2411, lng: 127.1776, country: 'KR', name: 'Yongin' },
  'kauai': { lat: 22.0964, lng: -159.5261, country: 'US', name: 'Kauai' },
  'saipan': { lat: 15.1850, lng: 145.7500, country: 'MP', name: 'Saipan' },
  'pago pago': { lat: -14.2756, lng: -170.7020, country: 'AS', name: 'Pago Pago' },
  // Nov 6, 2026: towns of the places with one outlet of their own that the place-finder didn't know ("Pacific climate
  // communicators gather in Rarotonga" sat in Fiji). Not their short names that are everyday words elsewhere: "Paro"
  // (Bhutan; Spanish "paro", a strike), "Seria" (Brunei; Portuguese "seria"), "Eua" (Tonga; Portuguese "EUA", the US),
  // "Nadi" and "Buka" (Fiji, PNG; Malay words), "Mahe" (also Mahé in India), "Nevis" (also Ben Nevis), "Nui", "Daru"
  'rarotonga': { lat: -21.2367, lng: -159.7777, country: 'CK', name: 'Rarotonga' },
  'avarua': { lat: -21.2075, lng: -159.7710, country: 'CK', name: 'Avarua' },
  'aitutaki': { lat: -18.8560, lng: -159.7870, country: 'CK', name: 'Aitutaki' },
  'koror': { lat: 7.3419, lng: 134.4792, country: 'PW', name: 'Koror' },
  'babeldaob': { lat: 7.5150, lng: 134.5825, country: 'PW', name: 'Babeldaob' },
  'lae': { lat: -6.7333, lng: 147.0000, country: 'PG', name: 'Lae' },
  'kokopo': { lat: -4.3500, lng: 152.2667, country: 'PG', name: 'Kokopo' },
  'goroka': { lat: -6.0833, lng: 145.3833, country: 'PG', name: 'Goroka' },
  'kimbe': { lat: -5.5500, lng: 150.1500, country: 'PG', name: 'Kimbe' },
  'kavieng': { lat: -2.5667, lng: 150.8000, country: 'PG', name: 'Kavieng' },
  'alotau': { lat: -10.3167, lng: 150.4333, country: 'PG', name: 'Alotau' },
  'kolonia': { lat: 6.9639, lng: 158.2083, country: 'FM', name: 'Kolonia', asWritten: 'Kolonia' },
  'yap state': { lat: 9.5144, lng: 138.1292, country: 'FM', name: 'Yap' },
  "vava'u": { lat: -18.6500, lng: -173.9833, country: 'TO', name: "Vava'u" },
  'neiafu': { lat: -18.6500, lng: -173.9833, country: 'TO', name: 'Neiafu' },
  "ha'apai": { lat: -19.7500, lng: -174.3667, country: 'TO', name: "Ha'apai" },
  'grand cayman': { lat: 19.3222, lng: -81.2409, country: 'KY', name: 'Grand Cayman' },
  'cayman brac': { lat: 19.7167, lng: -79.8000, country: 'KY', name: 'Cayman Brac' },
  'labasa': { lat: -16.4167, lng: 179.3833, country: 'FJ', name: 'Labasa' },
  'punakha': { lat: 27.5911, lng: 89.8774, country: 'BT', name: 'Punakha' },
  'phuentsholing': { lat: 26.8516, lng: 89.3884, country: 'BT', name: 'Phuentsholing' },
  'issyk-kul': { lat: 42.4500, lng: 77.2500, country: 'KG', name: 'Issyk-Kul' },
  'issyk kul': { lat: 42.4500, lng: 77.2500, country: 'KG', name: 'Issyk-Kul' },
  // Nov 6, 2026: Kyrgyz towns its Russian-language press names (Kyrgyzstan's Arabic-and-Cyrillic round)
  'tokmok': { lat: 42.8421, lng: 75.3015, country: 'KG', name: 'Tokmok' },
  'naryn': { lat: 41.4287, lng: 75.9911, country: 'KG', name: 'Naryn' },
  'batken': { lat: 40.0626, lng: 70.8194, country: 'KG', name: 'Batken' },
  // Nov 6, 2026, 2 PM: Mongolia's provinces (at their centres) and towns its Mongolian-language press names (Ikon.mn),
  // and the Syrian and Moroccan places Syria's and Bahrain's Arabic press names that the map lacked
  'arkhangai': { lat: 47.4747, lng: 101.4542, country: 'MN', name: 'Arkhangai' },
  'bayan-olgii': { lat: 48.9683, lng: 89.9625, country: 'MN', name: 'Bayan-Ölgii' },
  'olgii': { lat: 48.9683, lng: 89.9625, country: 'MN', name: 'Ölgii' },
  'bayankhongor': { lat: 46.1944, lng: 100.7181, country: 'MN', name: 'Bayankhongor' },
  'bulgan': { lat: 48.8125, lng: 103.5347, country: 'MN', name: 'Bulgan' },
  'govi-altai': { lat: 46.3722, lng: 96.2583, country: 'MN', name: 'Govi-Altai' },
  'govisumber': { lat: 46.3611, lng: 108.3611, country: 'MN', name: 'Govisümber' },
  'dornogovi': { lat: 44.8925, lng: 110.1386, country: 'MN', name: 'Dornogovi' },
  'dornod': { lat: 48.0667, lng: 114.5000, country: 'MN', name: 'Dornod' },
  'dundgovi': { lat: 45.7625, lng: 106.2708, country: 'MN', name: 'Dundgovi' },
  'zavkhan': { lat: 47.7417, lng: 96.8444, country: 'MN', name: 'Zavkhan' },
  'orkhon': { lat: 49.0276, lng: 104.0447, country: 'MN', name: 'Orkhon' },
  'uvurkhangai': { lat: 46.2639, lng: 102.7750, country: 'MN', name: 'Övörkhangai' },
  'umnugovi': { lat: 43.5708, lng: 104.4250, country: 'MN', name: 'Ömnögovi' },
  'sukhbaatar province': { lat: 46.6806, lng: 113.2792, country: 'MN', name: 'Sükhbaatar Province' },
  'selenge': { lat: 50.2314, lng: 106.2078, country: 'MN', name: 'Selenge' },
  'tov province': { lat: 47.7069, lng: 106.9472, country: 'MN', name: 'Töv Province' },
  'uvs province': { lat: 49.9811, lng: 92.0667, country: 'MN', name: 'Uvs Province' },
  'khovd': { lat: 48.0056, lng: 91.6419, country: 'MN', name: 'Khovd' },
  'khuvsgul': { lat: 49.6342, lng: 100.1625, country: 'MN', name: 'Khövsgöl' },
  'khentii': { lat: 47.3194, lng: 110.6556, country: 'MN', name: 'Khentii' },
  'zamiin-uud': { lat: 43.7167, lng: 111.9000, country: 'MN', name: 'Zamiin-Üüd' },
  'hama': { lat: 35.1318, lng: 36.7578, country: 'SY', name: 'Hama' },
  'quneitra': { lat: 33.1258, lng: 35.8236, country: 'SY', name: 'Quneitra' },
  'abu kamal': { lat: 34.4506, lng: 40.9187, country: 'SY', name: 'Abu Kamal' },
  'jisr al-shughur': { lat: 35.8126, lng: 36.3176, country: 'SY', name: 'Jisr al-Shughur' },
  'rabat': { lat: 34.0209, lng: -6.8416, country: 'MA', name: 'Rabat', asWritten: 'Rabat' },   // not "rabat" (a discount)
  // Nov 6, 2026, 5 PM: names that held another place's name and landed there ("Baja California" in California, "Los
  // Lagos" in Lagos, "East New Britain" in Britain, "New Ireland" in Ireland, "Republika Srpska" in Serbia, "Niger
  // State" in Niger, "Somali Region" in Somalia); Natural Earth's towns fix the rest (world-gazetteer.ts)
  'baja california': { lat: 32.6245, lng: -115.4523, country: 'MX', name: 'Baja California' },
  'baja california sur': { lat: 24.1426, lng: -110.3128, country: 'MX', name: 'Baja California Sur' },
  'san luis potosí': { lat: 22.1565, lng: -100.9855, country: 'MX', name: 'San Luis Potosí' },
  'san luis potosi': { lat: 22.1565, lng: -100.9855, country: 'MX', name: 'San Luis Potosí' },
  'los lagos region': { lat: -41.4693, lng: -72.9424, country: 'CL', name: 'Los Lagos' },
  'región de los lagos': { lat: -41.4693, lng: -72.9424, country: 'CL', name: 'Los Lagos' },
  'region de los lagos': { lat: -41.4693, lng: -72.9424, country: 'CL', name: 'Los Lagos' },
  'east new britain': { lat: -4.3420, lng: 152.2633, country: 'PG', name: 'East New Britain' },
  'west new britain': { lat: -5.5500, lng: 150.1428, country: 'PG', name: 'West New Britain' },
  'new ireland': { lat: -2.5735, lng: 150.7963, country: 'PG', name: 'New Ireland', asWritten: 'New Ireland' },
  'morona santiago': { lat: -2.3087, lng: -78.1114, country: 'EC', name: 'Morona Santiago' },
  'republika srpska': { lat: 44.7722, lng: 17.1910, country: 'BA', name: 'Republika Srpska' },
  'serbian republic': { lat: 44.7722, lng: 17.1910, country: 'BA', name: 'Republika Srpska' },
  'niger state': { lat: 9.6139, lng: 6.5569, country: 'NG', name: 'Niger State' },
  'somali region': { lat: 9.3500, lng: 42.8000, country: 'ET', name: 'Somali Region' },
  // Nov 6, 2026, batch 2: Lima's largest district, not the San Martín region ("choque ... en San Martín de Porres");
  // Portugal's spa town, not Colombia's Caldas ("Dias do Jazz nas Caldas da Rainha")
  'san martín de porres': { lat: -12.0297, lng: -77.0583, country: 'PE', name: 'San Martín de Porres', region: 'Lima' },
  'san martin de porres': { lat: -12.0297, lng: -77.0583, country: 'PE', name: 'San Martín de Porres', region: 'Lima' },
  'caldas da rainha': { lat: 39.4036, lng: -9.1386, country: 'PT', name: 'Caldas da Rainha' },
  // Bocas del Toro's island, not Colón province ("drenaje en Isla Colón"); Western Province's districts, which
  // Port Moresby's Post-Courier names alone ("North Fly Relief Exercise")
  'isla colón': { lat: 9.4040, lng: -82.2570, country: 'PA', name: 'Isla Colón', region: 'Bocas del Toro' },
  'isla colon': { lat: 9.4040, lng: -82.2570, country: 'PA', name: 'Isla Colón', region: 'Bocas del Toro' },
  'north fly': { lat: -6.1236, lng: 141.2906, country: 'PG', name: 'North Fly', region: 'Western' },
  // Russia's Vladimir region and Colombia's Meta department, without Vladimir Putin and the company
  'vladimir oblast': { lat: 56.1290, lng: 40.4070, country: 'RU', name: 'Vladimir Oblast' },
  'vladimir region': { lat: 56.1290, lng: 40.4070, country: 'RU', name: 'Vladimir Oblast' },
  'del meta': { lat: 4.1420, lng: -73.6266, country: 'CO', name: 'Meta', region: 'Meta', asWritten: 'del Meta' },
  // Names often in the news that Natural Earth spells otherwise, or that are too small or too ambiguous for its tables
  // (Nov 6, 2026: refinery and air-base strikes in Russia, Venezuela's ports, Vietnam's flooded provinces)
  'naberezhnye chelny': { lat: 55.7000, lng: 52.3199, country: 'RU', name: 'Naberezhnye Chelny', region: 'Tatarstan' },
  'togliatti': { lat: 53.4804, lng: 49.5300, country: 'RU', name: 'Tolyatti', region: 'Samara' },
  'engels air base': { lat: 51.4986, lng: 46.1253, country: 'RU', name: 'Engels', region: 'Saratov' },
  'engels airbase': { lat: 51.4986, lng: 46.1253, country: 'RU', name: 'Engels', region: 'Saratov' },
  'engels airfield': { lat: 51.4986, lng: 46.1253, country: 'RU', name: 'Engels', region: 'Saratov' },
  'syzran': { lat: 53.1558, lng: 48.4744, country: 'RU', name: 'Syzran', region: 'Samara' },
  'kstovo': { lat: 56.1500, lng: 44.2000, country: 'RU', name: 'Kstovo', region: 'Nizhny Novgorod' },
  'yelets': { lat: 52.6167, lng: 38.5000, country: 'RU', name: 'Yelets', region: 'Lipetsk' },
  'van province': { lat: 38.5012, lng: 43.3730, country: 'TR', name: 'Van' },
  'lake van': { lat: 38.6500, lng: 42.9000, country: 'TR', name: 'Lake Van' },
  'puerto cabello': { lat: 10.4704, lng: -68.1700, country: 'VE', name: 'Puerto Cabello', region: 'Carabobo', asWritten: 'Puerto Cabello' },
  'la guaira': { lat: 10.6012, lng: -66.9331, country: 'VE', name: 'La Guaira' },
  'huế': { lat: 16.4700, lng: 107.5800, country: 'VN', name: 'Huế' },
  'hue city': { lat: 16.4700, lng: 107.5800, country: 'VN', name: 'Huế' },
  'lào cai': { lat: 22.5014, lng: 103.9660, country: 'VN', name: 'Lào Cai' },
  'lao cai': { lat: 22.5014, lng: 103.9660, country: 'VN', name: 'Lào Cai', asWritten: 'Lao Cai' },
  'yên bái': { lat: 21.7050, lng: 104.8750, country: 'VN', name: 'Yên Bái' },
  'yen bai': { lat: 21.7050, lng: 104.8750, country: 'VN', name: 'Yên Bái', asWritten: 'Yen Bai' },
  'deir el-zor': { lat: 35.3359, lng: 40.1408, country: 'SY', name: 'Deir ez-Zor' },
  'deir al-zor': { lat: 35.3359, lng: 40.1408, country: 'SY', name: 'Deir ez-Zor' },
  // Famous cities that share their name with small American towns, so the tables keep them at home (Nov 6, 2026: no
  // outlet's "Naples" or "Venice" was placed), as written, without their American namesakes ("Naples, Florida")
  'naples': { lat: 40.8518, lng: 14.2681, country: 'IT', name: 'Naples', asWritten: 'Naples' },
  'naples, florida': { lat: 26.1420, lng: -81.7948, country: 'US', region: 'Florida', name: 'Naples' },
  'naples, fla': { lat: 26.1420, lng: -81.7948, country: 'US', region: 'Florida', name: 'Naples' },
  'venice': { lat: 45.4408, lng: 12.3155, country: 'IT', name: 'Venice', asWritten: 'Venice' },
  'venice beach': { lat: 33.9850, lng: -118.4695, country: 'US', name: 'Venice Beach', region: 'California' },
  'venice, florida': { lat: 27.0998, lng: -82.4543, country: 'US', region: 'Florida', name: 'Venice' },
  'florence': { lat: 43.7696, lng: 11.2558, country: 'IT', name: 'Florence', asWritten: 'Florence' },
  'florence, south carolina': { lat: 34.1954, lng: -79.7626, country: 'US', region: 'South Carolina', name: 'Florence' },
  'mecca': { lat: 21.4225, lng: 39.8262, country: 'SA', name: 'Mecca', asWritten: 'Mecca' },
  'los ángeles': { lat: 34.0522, lng: -118.2437, country: 'US', name: 'Los Ángeles', region: 'California', asWritten: 'Los Ángeles' },
  'quebec': { lat: 46.8139, lng: -71.2080, country: 'CA', name: 'Quebec', region: 'Quebec' },
  // Straits in the news: Iran's threats to Hormuz, the Houthis' Bab el-Mandeb
  'strait of hormuz': { lat: 26.5667, lng: 56.2500, country: 'IR', name: 'Strait of Hormuz' },
  'hormuz': { lat: 26.5667, lng: 56.2500, country: 'IR', name: 'Strait of Hormuz', asWritten: 'Hormuz' },
  'bab el-mandeb': { lat: 12.5833, lng: 43.3333, country: 'YE', name: 'Bab el-Mandeb' },
  'bab al-mandab': { lat: 12.5833, lng: 43.3333, country: 'YE', name: 'Bab el-Mandeb' },
  'taiwan strait': { lat: 24.0000, lng: 119.5000, country: 'TW', name: 'Taiwan Strait' },
  'strait of malacca': { lat: 2.5000, lng: 101.4000, country: 'MY', name: 'Strait of Malacca' },
  'malacca strait': { lat: 2.5000, lng: 101.4000, country: 'MY', name: 'Strait of Malacca' },
  'bosporus': { lat: 41.1194, lng: 29.0753, country: 'TR', name: 'Bosporus' },
  'bosphorus': { lat: 41.1194, lng: 29.0753, country: 'TR', name: 'Bosporus' },
  'kerch strait': { lat: 45.3000, lng: 36.5500, country: 'UA', name: 'Kerch Strait', region: 'Crimea' },
  'south fly': { lat: -9.0667, lng: 143.2081, country: 'PG', name: 'South Fly', region: 'Western' },
  'muharraq': { lat: 26.2572, lng: 50.6119, country: 'BH', name: 'Muharraq' },
  'riffa': { lat: 26.1300, lng: 50.5550, country: 'BH', name: 'Riffa' },
  'suwayda': { lat: 32.7089, lng: 36.5695, country: 'SY', name: 'Sweida' },
  'presov': { lat: 48.9984, lng: 21.2339, country: 'SK', name: 'Presov' },
  'prešov': { lat: 48.9984, lng: 21.2339, country: 'SK', name: 'Presov' },
  'zilina': { lat: 49.2231, lng: 18.7394, country: 'SK', name: 'Zilina' },
  'žilina': { lat: 49.2231, lng: 18.7394, country: 'SK', name: 'Zilina' },
  'nitra': { lat: 48.3069, lng: 18.0864, country: 'SK', name: 'Nitra' },
  'la digue': { lat: -4.3586, lng: 55.8413, country: 'SC', name: 'La Digue' },
  'carriacou': { lat: 12.4833, lng: -61.4500, country: 'GD', name: 'Carriacou' },
  'nukulaelae': { lat: -9.3810, lng: 179.8520, country: 'TV', name: 'Nukulaelae' },
  'abaiang': { lat: 1.8333, lng: 173.0000, country: 'KI', name: 'Abaiang' },
  'igbokoda': { lat: 6.3517, lng: 4.8044, country: 'NG', name: 'Igbokoda' },
  'ilaje': { lat: 6.25, lng: 4.8, country: 'NG', name: 'Ilaje' },
  'ikare': { lat: 7.528, lng: 5.76, country: 'NG', name: 'Ikare' },
  'okitipupa': { lat: 6.5011, lng: 4.7833, country: 'NG', name: 'Okitipupa' },
  'ijebu ode': { lat: 6.82, lng: 3.92, country: 'NG', name: 'Ijebu Ode' },
  'sagamu': { lat: 6.84, lng: 3.65, country: 'NG', name: 'Sagamu' },
  'ilesa': { lat: 7.62, lng: 4.73, country: 'NG', name: 'Ilesa' },
  'iseyin': { lat: 7.97, lng: 3.59, country: 'NG', name: 'Iseyin' },
  'ogbomosho': { lat: 8.1333, lng: 4.25, country: 'NG', name: 'Ogbomosho' },
  'ikorodu': { lat: 6.6194, lng: 3.5105, country: 'NG', name: 'Ikorodu' },
  'badagry': { lat: 6.415, lng: 2.881, country: 'NG', name: 'Badagry' },
  'lekki': { lat: 6.4698, lng: 3.5852, country: 'NG', name: 'Lekki' },
  'sapele': { lat: 5.894, lng: 5.676, country: 'NG', name: 'Sapele' },
  'ughelli': { lat: 5.5, lng: 6.0, country: 'NG', name: 'Ughelli' },
  'agbor': { lat: 6.25, lng: 6.2, country: 'NG', name: 'Agbor' },
  'nnewi': { lat: 6.02, lng: 6.91, country: 'NG', name: 'Nnewi' },
  'afikpo': { lat: 5.89, lng: 7.93, country: 'NG', name: 'Afikpo' },
  'eket': { lat: 4.64, lng: 7.93, country: 'NG', name: 'Eket' },
  'ikom': { lat: 5.96, lng: 8.71, country: 'NG', name: 'Ikom' },
  'ogoja': { lat: 6.66, lng: 8.8, country: 'NG', name: 'Ogoja' },
  'gboko': { lat: 7.32, lng: 9.0, country: 'NG', name: 'Gboko' },
  'otukpo': { lat: 7.19, lng: 8.13, country: 'NG', name: 'Otukpo' },
  'keffi': { lat: 8.85, lng: 7.87, country: 'NG', name: 'Keffi' },
  'suleja': { lat: 9.18, lng: 7.18, country: 'NG', name: 'Suleja' },
  'okene': { lat: 7.55, lng: 6.23, country: 'NG', name: 'Okene' },
  'kontagora': { lat: 10.4, lng: 5.47, country: 'NG', name: 'Kontagora' },
  'argungu': { lat: 12.74, lng: 4.52, country: 'NG', name: 'Argungu' },
  'funtua': { lat: 11.52, lng: 7.31, country: 'NG', name: 'Funtua' },
  'daura': { lat: 13.03, lng: 8.32, country: 'NG', name: 'Daura' },
  'dutsinma': { lat: 12.45, lng: 7.5, country: 'NG', name: 'Dutsinma' },
  'kafanchan': { lat: 9.58, lng: 8.29, country: 'NG', name: 'Kafanchan' },
  'azare': { lat: 11.68, lng: 10.19, country: 'NG', name: 'Azare' },
  'potiskum': { lat: 11.71, lng: 11.08, country: 'NG', name: 'Potiskum' },
  'monguno': { lat: 12.67, lng: 13.61, country: 'NG', name: 'Monguno' },
  'wukari': { lat: 7.87, lng: 9.78, country: 'NG', name: 'Wukari' },
  'ekpoma': { lat: 6.74, lng: 6.14, country: 'NG', name: 'Ekpoma' },
  'auchi': { lat: 7.07, lng: 6.27, country: 'NG', name: 'Auchi' },
  'irrua': { lat: 6.74, lng: 6.22, country: 'NG', name: 'Irrua' },
  'nsukka': { lat: 6.8567, lng: 7.3958, country: 'NG', name: 'Nsukka' },
  'orlu': { lat: 5.79, lng: 7.03, country: 'NG', name: 'Orlu' },
  'okigwe': { lat: 5.83, lng: 7.35, country: 'NG', name: 'Okigwe' },
  'wudil': { lat: 11.81, lng: 8.84, country: 'NG', name: 'Wudil' },
  'hadejia': { lat: 12.45, lng: 10.04, country: 'NG', name: 'Hadejia' },
  'illela': { lat: 13.73, lng: 5.3, country: 'NG', name: 'Illela' },
  'shiroro': { lat: 9.97, lng: 6.83, country: 'NG', name: 'Shiroro' },
  'igboho': { lat: 8.85, lng: 3.75, country: 'NG', name: 'Igboho' },
  'ikere': { lat: 7.5, lng: 5.23, country: 'NG', name: 'Ikere' },
  'efon alaaye': { lat: 7.66, lng: 4.92, country: 'NG', name: 'Efon Alaaye' },
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
  [/\b(?:united kingdom|britain|(?<!new )england|scotland|scottish|(?<!new south )wales)\b/i, 'GB'],
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
  [/\b(?:vietnam|viet\s+nam|vietnamese)\b/i, 'VN'],   // "Viet Nam", the UN's and Hanoi's spelling (Nov 7, 2026)
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
  // An Ecuadorian outlet's "Santo Domingo" is Santo Domingo de los Tsáchilas, not the Dominican capital (Oct 31, 2026:
  // El Comercio's and El Universo's "choque frontal en la vía Quinindé – Santo Domingo", once capitals were places)
  EC: { name: /\bsanto domingo\b(?!\s+de\s+los\s+ts[áa]chilas)/gi, as: 'Santo Domingo de los Tsachilas' },
  // A Malaysian outlet's "Bursa" is its stock exchange, not Türkiye's Bursa (Nov 6, 2026: the NST's "Oil price slide
  // hits Bursa energy stocks")
  MY: { name: /\bBursa\b/g, as: 'the bourse', unless: /\bt(?:urkey|ürkiye|urkiye)\b/i },
  // A Mexican outlet's "la Roma" is Mexico City's Colonia Roma (Nov 6, 2026: "5 actividades para este fin de semana en
  // CDMX" was pinned in Rome), as are "Roma Norte" and "Roma-Condesa"
  MX: { name: /\b[Ll]a\s+Roma\b(?![\s-]+(?:Italia|italiana))|\bRoma(?=[\s-]+(?:Norte|Sur|Condesa)\b)/g, as: 'Colonia Roma' },
  // A Nigerian outlet's "Plateau" is Plateau State, not the word (Nov 7, 2026: Punch's and Vanguard's "Soldiers rescue
  // three abducted women in Plateau" was no place; 10 of two days' stories)
  NG: { name: /\bPlateau\b(?!\s+State)/g, as: 'Plateau State' },
}

export function withHomeNames(text: string, countryCode: string | null | undefined): string {
  const rule = countryCode ? HOME_NAMES[countryCode.toUpperCase()] : undefined
  if (!rule || !text || (rule.unless && rule.unless.test(text))) return text
  return text.replace(rule.name, rule.as)
}

/** Each country pattern without its plural people-word ending: "Cuban" but not "Cubans" */
const SINGULAR_MATCHERS = new Map(COUNTRY_PATTERNS.map(([pattern, code]) => [code + pattern.source, new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace('g', ''))]))

/**
 * A word that puts what follows it somewhere: "in Ghana", "visits Iran", "visitará Colombia", "en Bolivie", and Arabic
 * "في" (in), as the Arabic press's names are read in English (local-names.ts; Nov 6, 2026: "ملاحقة قضائية للاجئ سوري في
 * بلجيكا", a Syrian refugee prosecuted in Belgium, is Belgium's)
 */
const LOCATIVE_BEFORE = /(?:^|[\s,(])(?:in|inside|visits?|visited|visiting|visitará|visita|visitó|en|em|à|au|aux|في)\s+(?:the\s+)?$/i

/**
 * Countries the text names, in order of first mention (the headline comes first), except that a country
 * named where something happens ("... auto expo in Ghana", "JD Vance ... visitará Colombia") comes before
 * the others, and people named by a plural ("Cubans", "Afghans") after them: they are often abroad (M57,
 * Oct 30, 2026: "ICE nabs Cubans for unlawfully voting in the United States" was pinned in Havana, "Swiss
 * Group unveils Jetour G700 ... at 2026 auto expo in Ghana" in Bern)
 */
export function mentionedCountries(text: string, byNameOnly = false): string[] {
  const hits: Array<{ code: string; index: number; people: boolean; there: boolean }> = []
  COUNTRY_PATTERNS.forEach(([original, code], i) => {
    const pattern = COUNTRY_MATCHERS[i]![0]
    const m = pattern.exec(text)
    if (!m) return
    const singular = SINGULAR_MATCHERS.get(code + original.source)
    const people = pattern !== original && !!singular && !singular.test(m[0])
    if (byNameOnly && people) return
    hits.push({ code, index: m.index, people, there: !people && LOCATIVE_BEFORE.test(text.slice(Math.max(0, m.index - 24), m.index)) })
  })
  const rank = (h: { people: boolean; there: boolean }) => (h.there ? 0 : h.people ? 2 : 1)
  return [...new Set(hits.sort((a, b) => rank(a) - rank(b) || a.index - b.index).map(h => h.code))]
}

/**
 * An embassy, an ambassador or an envoy is where the story says it is, not in its own country (Nov 7, 2026: of two days'
 * 114 headlines about envoys, 25 were pinned in the envoy's country: Uganda's Nile Post's "Chinese Embassy Pledges More
 * Support for Vulnerable Communities" in China, "US Embassy explains how Ghanaians can secure emergency visa interviews"
 * in the US, "South Korean Ambassador pays courtesy call on President Paudel" in Seoul). The country an envoy is from,
 * named before the word ("Chinese Embassy", "Israel's New Ambassador", "US-Botschafter") or after it ("Embassy of Saint
 * Kitts and Nevis", "la embajada de Japón", "l'ambassade du Royaume-Uni", "el embajador chino"), is blanked out of the
 * text, its length kept, so that the place the text names is read ("Embassy in Tajikistan", "Ambassador to Albania"),
 * or else the outlet's own country. Not a country after a possessive: "Trump's Ukraine envoy" is an envoy for Ukraine.
 */
const ENVOY_WORD = String.raw`(?:ambassadors?|embass(?:y|ies)|envoys?|consul(?:ates?|s)?(?:[-\s]generals?)?|vice[-\s]consuls?|high\s+commission(?:ers?|s)?|charg[ée]s?\s+d['’]affaires)`
const ENVOY_AFTER = new RegExp(String.raw`^['’]?s?(?:[\s-]+(?:new|former|ex|outgoing|incoming|special|presidential|deputy|honorary|acting|resident|non-resident|top|chief|first|female|interim|trade))*[\s-]+(?:${ENVOY_WORD}|botschaft(?:er(?:in)?)?|konsulat|generalkonsul(?:at)?)(?![\p{L}\p{N}])`, 'iu')
const ENVOY_BEFORE = new RegExp(String.raw`(?:^|[^\p{L}])(?:${ENVOY_WORD}\s+(?:of|from)\s+(?:the\s+)?(?:(?:people['’]s|democratic|islamic|federal|federative|socialist|arab|united|hashemite|bolivarian|plurinational|cooperative|co-operative|republic|kingdom|state|states|commonwealth|principality|grand|duchy|sultanate|union|of|the)\s+)*|(?:embajad(?:a|ora?|ores)|consulado(?:[-\s]gene?ral)?|c[óo]nsul(?:es)?(?:\s+general)?|encargad[oa]\s+de\s+negocios|embaixad(?:a|ora?|ores)|ambassad(?:e|eurs?|rices?)|consulat(?:\s+g[ée]n[ée]ral)?|vice-consul|consul(?:\s+g[ée]n[ée]ral)?)\s+(?:(?:de\s+la|de\s+los|de\s+las|del|de|du|des|da|do|dos|das)\s+|d['’]|de\s+l['’])?)$`, 'iu')
const ENVOY_ANY = /ambassad|embass|envoy|consul|commission|charg[ée]s?\s+d|embajad|embaixad|botschaft|konsul/i
const ENVOY_LIST = /^\s*(?:,|&|and|y|et|e|und)\s+$/i
const POSSESSIVE_BEFORE = /\p{L}['’]s?\s+$/u
const COUNTRY_SPANS = COUNTRY_PATTERNS.map(([p]) => new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`))

export function withoutEnvoyCountries(text: string): string {
  if (!text || !ENVOY_ANY.test(text)) return text
  const found: Array<[number, number]> = []
  for (const pattern of COUNTRY_SPANS) {
    pattern.lastIndex = 0
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (!m[0]) { pattern.lastIndex++; continue }
      found.push([m.index, m.index + m[0].length])
    }
  }
  // the longest name at each place ("South Korean", not "Korean"), in order
  const spans = found
    .filter(([s, e]) => !found.some(([s2, e2]) => s2 <= s && e <= e2 && e2 - s2 > e - s))
    .sort((a, b) => a[0] - b[0])
    .filter(([s], i, all) => i === 0 || s >= all[i - 1]![1])
  const sender = spans.map(([s, e]) => !POSSESSIVE_BEFORE.test(text.slice(Math.max(0, s - 24), s))
    && (ENVOY_AFTER.test(text.slice(e)) || ENVOY_BEFORE.test(text.slice(Math.max(0, s - 80), s))))
  // ...and a list of them: "U.S, U.K, Australia, Canada & Japan Embassies", "the embassies of France and Germany"
  for (let i = spans.length - 2; i >= 0; i--) if (sender[i + 1] && ENVOY_LIST.test(text.slice(spans[i]![1], spans[i + 1]![0]))) sender[i] = true
  for (let i = 1; i < spans.length; i++) if (sender[i - 1] && ENVOY_LIST.test(text.slice(spans[i - 1]![1], spans[i]![0]))) sender[i] = true
  let out = text
  spans.forEach(([s, e], i) => { if (sender[i]) out = out.slice(0, s) + ' '.repeat(e - s) + out.slice(e) })
  return out
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
  if (!wanted || GENERIC_PLACE_WORDS.has(wanted)) return false
  const names: Array<[key: string, name: string]> = [
    ['name', hit.name ?? ''],
    ...Object.entries(hit.namedetails ?? {}).filter(([key]) => NAME_KEYS.test(key))
      .flatMap(([key, value]) => value.split(';').map(name => [key, name] as [string, string])),
  ]
  return names.some(([key, name]) => {
    const have = normalizePlaceName(name)
    if (have === '' || !` ${have} `.includes(` ${wanted} `)) return false
    // One word inside a long official name is not that place's name ("Nation" in "Nation of Brunei, the
    // Abode of Peace"): its usual names, or the official name whole, or more of it than one word
    return !key.startsWith('official_name') || have === wanted || wanted.includes(' ')
  })
}

/**
 * Words of countries' long official names that name no place by themselves (Nov 5, 2026): "One Nation"
 * (Australia's party) and "State of the Nation Address" stories were pinned in Brunei, "Nation of Brunei,
 * the Abode of Peace", 10 of them in a week
 */
const GENERIC_PLACE_WORDS = new Set([
  'nation', 'nations', 'national', 'republic', 'kingdom', 'state', 'states', 'federation', 'federal', 'commonwealth',
  'union', 'united', 'democratic', 'people', 'peoples', 'socialist', 'islamic', 'abode', 'peace', 'independent',
  'plurinational', 'bolivarian', 'oriental', 'cooperative', 'co operative', 'principality', 'duchy', 'grand duchy',
  'sovereign', 'territory', 'territories',
])

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

/** "LA" in capitals before a word that makes it the city ("LA mayor", "LA County"); on its own it stays
 *  Louisiana or nothing. "LA Times" is an outlet and is blanked out first. */
const LA_WORDS = ['mayor', 'mayoral', 'county', 'metro', 'unified', 'dodgers', 'lakers', 'clippers', 'rams', 'chargers', 'olympics', 'wildfires?', 'city council', 'police', 'fire department']
const LA_CITY = new RegExp(`\\bLA(?=\\s+(?:${LA_WORDS.map(w => w.replace(/^./, c => `[${c}${c.toUpperCase()}]`)).join('|')})\\b)`, 'g')
function cleanText(text: string): string {
  return text.replace(OUTLET_NAMES, ' ').replace(/\bLA Times\b/g, ' ').replace(LA_CITY, 'Los Angeles')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A hand-kept name written without accents is read with them too (Nov 6, 2026: "bogota" didn't find "Bogotá", nor
 * "sao paulo" "São Paulo", in Spanish and Portuguese headlines): each letter matches its accented forms, and a space
 * or a hyphen either ("Tel-Aviv", "Port-Louis", "Addis-Abeba").
 */
const ACCENTED: Record<string, string> = {
  a: 'aàáâãäåāăą', c: 'cçćčĉċ', d: 'dďđ', e: 'eèéêëēĕėęě', g: 'gğĝġģ', h: 'hĥħ', i: 'iìíîïĩīĭįıİ', j: 'jĵ', k: 'kķ',
  // not ñ, a letter of its own: Spanish "montaña" (mountain) isn't Montana
  l: 'lĺļľŀł', n: 'nńņňŉ', o: 'oòóôõöøōŏő', r: 'rŕŗř', s: 'sśŝşšș', t: 'tţťŧț', u: 'uùúûüũūŭůűų', w: 'wŵ',
  y: 'yýÿŷ', z: 'zźżž',
}
function withAccents(name: string): string {
  return [...name].map(ch => ACCENTED[ch] ? `[${ACCENTED[ch]}]` : ch === ' ' || ch === '-' ? '[\\s-]' : escapeRegExp(ch)).join('')
}
const UNACCENTED: Record<string, string> = { ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i' }
/** The text without its accents, and hyphens as spaces, for scanIn's quick look */
function withoutAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[øØłŁđĐı]/g, ch => UNACCENTED[ch]!).replace(/-/g, ' ')
}

/** Gazetteer places as whole words, longest names first. Plain substring
 *  matching pinned "climate" stories to Lima, "comparison" to Paris and
 *  "promote" to Rome. */
// US states (world-countries.ts); a place already in the gazetteer keeps its entry
for (const [place, entry] of Object.entries(US_STATES)) GAZETTEER[place] ??= entry

/**
 * Every country's capital by its name (sources round 6, Oct 31, 2026): 107 of 195 capitals named no place,
 * so "Thousands protest in Budapest", "Prague court jails ex-minister" or "Majuro king tide" had no pin unless
 * the country was named too, among them the capitals of 16 of the 18 countries that had no outlet. Left out:
 * capitals that are more often another place, a name or a word ("Victoria", "Kingston", "Georgetown",
 * "Nassau", "San José", "San Juan", "La Paz", "Wellington", "Juba" (also Somalia's Jubaland), "Praia" (a
 * beach in Portuguese), "Quito" ("I remove" in Spanish), "Malé", "Rabat"), and those the country's own name
 * already finds ("Kuwait City", "Djibouti", "Andorra la Vella"). A name that ends in an accented letter can't
 * be matched as a whole word, so "Lomé" goes by "Lome"; "Brasília" by both its spellings.
 */
const NOT_A_CAPITAL = new Set(['victoria', 'kingston', 'georgetown', 'nassau', 'san jose', 'san juan', 'la paz',
  'wellington', 'juba', 'praia', 'quito', 'male', 'rabat', 'washington dc', "st. george's", "st george's", "saint john's"])
const plainName = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const nameWords = (s: string) => s.split(/[^a-z]+/).filter(Boolean)
const CAPITALS = [
  ...MORE_COUNTRIES.map(({ code, capital, lat, lng }) => ({ code, capital, lat, lng })),
  ...Object.entries(COUNTRY_CENTROIDS).map(([code, { name, lat, lng }]) => ({ code, capital: name, lat, lng })),
]
for (const { code, capital, lat, lng } of CAPITALS) {
  const plain = plainName(capital)
  const inName = nameWords(plainName(countryNameOf(code) ?? ''))
  const words = nameWords(plain)
  // (the country's name says it: "Kuwait City", "São Tomé", but not "Tunis")
  if (NOT_A_CAPITAL.has(plain) || (inName.length > 0 && (words.every(w => inName.includes(w)) || inName.every(w => words.includes(w))))) continue
  for (const key of new Set([plain, capital.toLowerCase()])) {
    if (/[a-z]$/.test(key)) GAZETTEER[key] ??= { lat, lng, country: code, name: capital }
  }
}

// Towns and provinces from Natural Earth (world-gazetteer.ts; Nov 6, 2026: of each country's 10 largest towns the map knew
// fewer than half in 72 of the 202 places counted, and about 1 in 4 of the world's provinces and states). The entries
// above come first. Their names are read as written, with their capitals: "Ganja" is Azerbaijan's city, "ganja" isn't.
for (const [name, entry] of Object.entries(WORLD_TOWNS)) GAZETTEER[name.toLowerCase()] ??= { ...entry, asWritten: name }

const GAZETTEER_MATCHERS = Object.entries(GAZETTEER)
  .sort((a, b) => b[0].length - a[0].length)
  // A name is a whole word where no letter or digit of any script touches it (Nov 6, 2026: \b took accented letters
  // for spaces, so a name was found inside a word: "nica" in "Única", "cesis" in "Arquidiócesis", "kandal" in
  // "škandal"; names starting or ending on one, "Potosí" or "Łódź", had their own rule). The hand-kept names are read
  // in any case, Natural Earth's as written (above).
  .map(([place, coords]) => {
    const plain = !coords.asWritten && /^[a-z' .-]+$/.test(place)
    // as written, or in capitals: a wire story's dateline ("CARACAS, Venezuela (AP) —", "DETROIT (AP) —")
    const pattern = coords.asWritten ? `(?:${escapeRegExp(coords.asWritten)}|${escapeRegExp(coords.asWritten.toUpperCase())})`
      : plain ? withAccents(place) : escapeRegExp(place)
    return { place, coords, plain, re: new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, coords.asWritten ? 'u' : 'iu') }
  })
const GAZETTEER_SCAN = GAZETTEER_MATCHERS.map(m => ({
  place: m.place, coords: m.coords, re: new RegExp(m.re.source, `g${m.re.flags}`),
  // the name as plain text: a text that doesn't hold it needn't run its pattern (scanIn)
  needle: m.coords.asWritten ?? (m.plain ? m.place.replace(/-/g, ' ') : m.place.toLowerCase()), asWritten: !!m.coords.asWritten, plain: m.plain,
  upper: m.coords.asWritten?.toUpperCase(),
}))

/**
 * The gazetteer names a text can hold, in GAZETTEER_SCAN's order: a quick look for each name's letters before its
 * pattern runs (Nov 6, 2026: with Natural Earth's towns and patterns that see every script's letters, running all
 * 4,000 patterns took a story 15 ms; most names are in no given text)
 */
function scanIn(clean: string): typeof GAZETTEER_SCAN {
  const lower = clean.toLowerCase()
  const plain = withoutAccents(lower)
  return GAZETTEER_SCAN.filter(m => m.asWritten ? clean.includes(m.needle) || clean.includes(m.upper!) : (m.plain ? plain : lower).includes(m.needle))
}

/**
 * Whether a gazetteer hit is a name, not the place: part of one (place-words.ts), or, for a hand-kept name found with
 * accents it is written without, inside a person's name or after a capitalised name (Nov 6, 2026: "Aleida Sofía
 * Silvestre" and "Frida Sofía niega" were Sofia, "Octavio Ondó Oyono" Nigeria's Ondo)
 */
function notThePlace(m: { plain: boolean; asWritten?: boolean; needle?: string }, clean: string, index: number, end: number): boolean {
  if (partOfAName(clean, index, end)) return true
  const hit = clean.slice(index, end)
  // a name read as written, found in capitals: only a dateline's ("CARACAS, Venezuela (AP) —", "SEREMBAN:", "MAROVOAY -"),
  // not an acronym or a word of a headline in capitals (Nov 6, 2026: "Gates Foundation faces reckoning over AGRA", GDELT's
  // "PAITA CLARIFIES REPORTS ON PEC MEMBER'S TRAVEL", a Papua New Guinean)
  if (m.asWritten && hit !== m.needle && hit === hit.toUpperCase()) {
    return !(/^\s*[,:(\-–—]/.test(clean.slice(end, end + 3)) || clean.trim() === hit)
  }
  if (!m.plain) return false
  return withoutAccents(hit) !== hit.replace(/-/g, ' ') && (betweenNames(clean, index, end) || afterAName(clean, index, end))
}

/** The gazetteer place mentioned first (the headline comes first); the longer name on a tie */
export function findGazetteerPlace(text: string): { place: string; coords: typeof GAZETTEER[string]; written?: string } | null {
  const clean = cleanText(text)
  let best: { place: string; coords: typeof GAZETTEER[string]; index: number; written: string } | null = null
  for (const m of scanIn(clean)) {
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      const index = hit.index ?? 0
      if (best && index >= best.index) break
      // "Santiago Peña" is a person, "Real Madrid" a club (place-words.ts, plan 0s5)
      if (notThePlace(m, clean, index, index + hit[0].length)) continue
      best = { place: m.place, coords: m.coords, index, written: hit[0] }
      break
    }
  }
  return best ? { place: best.place, coords: best.coords, written: best.written } : null
}

/** A place's shown name, as the story writes it when that is the name with its accents ("Bogotá" for "Bogota") */
function shownName(coords: typeof GAZETTEER[string], place: string, written?: string): string {
  const shown = coords.name ?? titleCase(place)
  if (!written || written === shown || !/^\p{Lu}/u.test(written) || !/\p{Ll}/u.test(written)) return shown
  const accented = withoutAccents(written) !== written.replace(/-/g, ' ')
  return accented && withoutAccents(written.toLowerCase()) === withoutAccents(shown.toLowerCase()) ? written : shown
}

/**
 * Whether two gazetteer places are one area: the same place under two names ("Kiev" and "Kyiv"), or a state or
 * region and a place in it ("Borno" and "Maiduguri", "Maharashtra" and "Pune"). Two cities in one state are two
 * areas ("Pune" and "Nagpur").
 */
export function oneArea(a: { place: string; coords: { region?: string; name?: string } }, b: { place: string; coords: { region?: string; name?: string } }): boolean {
  if (a.place === b.place) return true
  const names = (p: typeof a) => [p.place, p.coords.name?.toLowerCase()].filter((n): n is string => !!n)
  const namesA = names(a), namesB = names(b)
  if (namesA.some(n => namesB.includes(n))) return true
  const regionA = a.coords.region?.toLowerCase(), regionB = b.coords.region?.toLowerCase()
  return (!!regionB && namesA.includes(regionB)) || (!!regionA && namesB.includes(regionA))
}

/** At most this many geocoder lookups per text (each one waits about a second) */
const MAX_NOMINATIM_LOOKUPS = 4

/**
 * Towns read only for their own country's outlets (world-gazetteer.ts HOME_TOWNS, Nov 6, 2026): names that are also
 * words, people, US states or another country's places. A Jamaican outlet's "Mandeville", "Kingston" or "May Pen" is
 * the Jamaican town; anyone else's stays unplaced. Read as written (capitalised), whole words, longest first.
 */
const HOME_MATCHERS: Record<string, Array<{ name: string; entry: TownEntry; re: RegExp }>> = Object.fromEntries(
  Object.entries(HOME_TOWNS).map(([code, towns]) => [code, Object.entries(towns)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([name, entry]) => ({ name, entry, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'gu') }))]))

/**
 * The outlet's own country's town of the same name as the place the text names (Nov 6, 2026: with accents read, a
 * Chilean outlet's "Los Ángeles" found the American city): that town, when its country's home table has the name and the
 * text writes it so
 */
export function homeTwinPlace(text: string, countryCode: string | null | undefined, place: string): GeoResult | null {
  const towns = countryCode ? HOME_MATCHERS[countryCode.toUpperCase()] : undefined
  if (!towns || !text) return null
  const want = withoutAccents(place.toLowerCase())
  const clean = cleanText(text)
  for (const m of towns) {
    if (withoutAccents(m.name.toLowerCase()) !== want) continue
    m.re.lastIndex = 0
    if (m.re.test(clean)) return { point: true, lat: m.entry.lat, lng: m.entry.lng, name: m.entry.name, countryCode: m.entry.country, region: m.entry.region }
  }
  return null
}

const COUNTRY_NAMED = new Map<string, boolean>()
/** Whether the name is a country's name ("Niger", "Georgia", "Mali") */
function isCountryName(name: string): boolean {
  let known = COUNTRY_NAMED.get(name)
  if (known === undefined) COUNTRY_NAMED.set(name, known = mentionedCountries(name, true).length > 0)
  return known
}

/** The first of its own country's home-only towns a text names, for that country's outlets (HOME_MATCHERS) */
export function homePlaceFromText(text: string, countryCode: string | null | undefined): GeoResult | null {
  const towns = countryCode ? HOME_MATCHERS[countryCode.toUpperCase()] : undefined
  if (!towns || !text) return null
  const clean = cleanText(text)
  let best: { entry: TownEntry; index: number } | null = null
  for (const m of towns) {
    // a country's name is the country: Nigeria's Niger state and Guinea's Mali prefecture are written with their kind
    // ("Niger State"; Nov 6, 2026: "réfugiées au Niger et au Bénin" was pinned in Niger State)
    if (isCountryName(m.name)) continue
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      const index = hit.index ?? 0
      if (best && index >= best.index) break
      if (partOfAName(clean, index, index + hit[0].length, m.entry.surname)) continue
      best = { entry: m.entry, index }
      break
    }
  }
  return best
    ? { point: true, lat: best.entry.lat, lng: best.entry.lng, name: best.entry.name, countryCode: best.entry.country, region: best.entry.region }
    : null
}

/**
 * A home-only town of a country the text names by its name, for any outlet: the country says which Rosario or
 * Kingston it is ("Floods in Rosario, Argentina", "KINGSTON, Jamaica (AP)"; Nov 6, 2026, batch 2: Argentina's,
 * Jamaica's and Guyana's largest towns share their names with other places). A people's word ("an Argentine
 * striker") doesn't say it.
 */
export function namedCountryHomePlace(text: string): GeoResult | null {
  for (const code of mentionedCountries(cleanText(text), true)) {
    const place = homePlaceFromText(text, code)
    if (place) return place
  }
  return null
}

/** The gazetteer place the text names first, as a map point */
function gazetteerPoint(text: string): GeoResult | null {
  const found = findGazetteerPlace(text)
  return found
    ? {
        point:       true,
        lat:         found.coords.lat,
        lng:         found.coords.lng,
        name:        shownName(found.coords, found.place, found.written),
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
export function splitPlaces(text: string): { countries: string[]; rest: string; places: Array<{ place: string; coords: typeof GAZETTEER[string] }> } {
  const clean = cleanText(text)
  const spans: Array<[number, number]> = []
  const codes = new Set<string>()
  const found: Array<{ place: string; coords: typeof GAZETTEER[string]; index: number }> = []
  const take = (index: number, length: number): boolean => {
    const end = index + length
    if (length === 0 || spans.some(([a, b]) => index < b && end > a)) return false
    spans.push([index, end])
    return true
  }
  // Longest gazetteer names first ("West Virginia" before "Virginia"), then countries
  for (const m of scanIn(clean)) {
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      if (notThePlace(m, clean, hit.index ?? 0, (hit.index ?? 0) + hit[0].length)) continue
      if (!take(hit.index ?? 0, hit[0].length)) continue
      if (m.coords.country) codes.add(m.coords.country)
      found.push({ place: m.place, coords: m.coords, index: hit.index ?? 0 })
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
  // ...and the gazetteer places it names, in order of mention (correlate.ts isSameStory compares them)
  const places = found.sort((a, b) => a.index - b.index).map(({ place, coords }) => ({ place, coords }))
  return { countries: [...codes], rest, places }
}

/**
 * Every place the text names, in order of first mention: gazetteer places
 * (by their usual names) and countries (by name), each once, at most `max`.
 * Used by the Knowledge Graph's rule-based extraction (pipeline/entity-rules.ts).
 */
export function placesInText(text: string, max = 6): string[] {
  const clean = cleanText(text)
  const hits: Array<{ name: string; index: number; end: number }> = []
  // Longest names first, so "West Virginia" keeps "Virginia" from counting again
  for (const m of scanIn(clean)) {
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      const index = hit.index ?? 0
      const end = index + hit[0].length
      if (hits.some(h => index < h.end && end > h.index)) continue
      if (notThePlace(m, clean, index, end)) continue
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
  return gazetteerPoint(text) ?? countryPoint(mentionedCountries(cleanText(text)))
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
/**
 * Countries a headline names outright, by name ("Ireland", "Romania", "U.S."), not by an adjective ("Irish",
 * "Israeli"): an adjective names the actor, and the story is often elsewhere ("Israeli strike" in Gaza City)
 */
export function countriesNamedOutright(text: string): string[] {
  const clean = cleanText(text)
  const hits: Array<{ code: string; index: number }> = []
  for (const [pattern, code] of COUNTRY_PATTERNS) {
    const name = (countryNameOf(code) ?? '').toLowerCase()
    // the first time the country is named outright ("Irish government ... united Ireland": Ireland)
    for (const m of clean.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))) {
      const said = m[0].replace(/\./g, '').trim().toLowerCase()
      if ((name && said === name) || /^(?:[A-Z]\.?){2,4}$/.test(m[0].trim())) { hits.push({ code, index: m.index ?? 0 }); break }
    }
  }
  return [...new Set(hits.sort((a, b) => a.index - b.index).map(h => h.code))]
}

/** The first town or province the text names in one country, never the country itself (news-rss.ts ownPlace) */
export function placeInCountry(text: string, country: string): GeoResult | null {
  return gazetteerPointIn(text, [country], true)
}

/** Where a text names a country, by its name or another of its patterns: "Trinidad and Tobago" holds no Tobago */
function countryNameSpans(clean: string, code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const name = countryNameOf(code)
  const patterns = COUNTRY_PATTERNS.filter(([, c]) => c === code).map(([p]) => p)
  if (name) patterns.push(new RegExp(name.split(/\s+and\s+/).map(part => part.split(/\s+/).map(escapeRegExp).join('\\s+')).join('\\s+(?:and|&)\\s+'), 'i'))
  for (const p of patterns) {
    for (const m of clean.matchAll(new RegExp(p.source, `${p.flags.replace('g', '')}g`))) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
  }
  return spans
}

/** The first gazetteer place in the text that lies in one of `countries` (not a country kept as a place, if told) */
function gazetteerPointIn(text: string, countries: string[], notACountry = false): GeoResult | null {
  const clean = cleanText(text)
  let best: { place: string; coords: typeof GAZETTEER[string]; index: number; written: string } | null = null
  const inCountryName = notACountry ? countries.flatMap(code => countryNameSpans(clean, code)) : []
  for (const m of scanIn(clean)) {
    if (!m.coords.country || !countries.includes(m.coords.country)) continue
    if (notACountry && (isCountryName(m.place) || m.place === (countryNameOf(m.coords.country) ?? '').toLowerCase())) continue
    m.re.lastIndex = 0
    for (const hit of clean.matchAll(m.re)) {
      const index = hit.index ?? 0
      if (best && index >= best.index) break
      const end = index + hit[0].length
      if (inCountryName.some(([from, to]) => index >= from && end <= to)) continue
      if (notThePlace(m, clean, index, end)) continue
      best = { place: m.place, coords: m.coords, index, written: hit[0] }
      break
    }
  }
  return best
    ? { point: true, lat: best.coords.lat, lng: best.coords.lng, name: shownName(best.coords, best.place, best.written), countryCode: best.coords.country, region: best.coords.region }
    : null
}

/**
 * Where a report is. With `body` (a story's headline as `text`, its article as `body`), the headline speaks first:
 * a place it names, else a country it names outright, at a place the body names in that country or its capital
 * (M57, Oct 30, 2026: "Irish government to assess potential for united Ireland" sat in London, which its summary
 * named; Radio Romania's energy prices in Luxembourg); a headline that names neither goes on as before.
 */
export async function extractGeo(text: string, body?: string): Promise<GeoResult> {
  if (body) {
    let fromHead = gazetteerPoint(text)
    let outright = fromHead ? [] : countriesNamedOutright(text)
    // A country the gazetteer holds ("Ukraine: drone attack...") is still a country: a place the article names
    // in it ("in Kharkiv") is closer, and the country's own point is the fallback
    let countryAsPlace: GeoResult | null = null
    if (fromHead?.countryCode && fromHead.name && fromHead.name.toLowerCase() === (countryNameOf(fromHead.countryCode) ?? '').toLowerCase()) {
      countryAsPlace = fromHead
      outright = [fromHead.countryCode]
      fromHead = null
    }
    if (fromHead || outright.length > 0) {
      const key = `geo3h:${hashText(`${text}\n${body}`.toLowerCase())}`
      const hit = await redis.get(key)
      if (hit) return JSON.parse(hit) as GeoResult
      const result = fromHead ?? gazetteerPointIn(body, outright) ?? countryAsPlace ?? countryPoint(outright)
      await redis.setex(key, 3600, JSON.stringify(result))
      return result
    }
    text = `${text} ${body}`
  }
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
  const countries = mentionedCountries(cleanText(text))
  const candidates = extractCandidateLocations(text)
  let lookups = 0
  for (const candidate of candidates) {
    // Skip very common English words that match Title Case regex
    // ...and words of countries' long official names (GENERIC_PLACE_WORDS), not even asked: the geocoder's answers
    // are kept for a day, so "nation" would still come back as Brunei from the cache (Nov 6, 2026)
    if (COMMON_WORDS.has(candidate) || GENERIC_PLACE_WORDS.has(candidate)) continue
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
      // "Kano", not "Kano, Kano": a state is its own region (Oct 30, 2026)
      const named = coords.name ?? titleCase(place)
      const result: ReverseGeoResult = {
        name:        coords.region && coords.region.toLowerCase() !== named.toLowerCase() ? `${named}, ${coords.region}` : named,
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

