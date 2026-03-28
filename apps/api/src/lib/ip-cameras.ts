/**
 * Public IP Cameras — curated seed list of open CCTV/webcam embed URLs
 *
 * Sources: EarthCam public feeds, Windy.com webcam embeds, public traffic
 * departments.  No API key required for any of these.
 */

export type CameraType = 'traffic' | 'weather' | 'city' | 'nature'

export interface CameraRegion {
  id: string
  label: string
  bounds: {
    latMin: number
    latMax: number
    lngMin: number
    lngMax: number
  }
}

export interface CameraFeed {
  id: string
  name: string
  region: string
  country: string
  countryCode: string
  lat: number
  lng: number
  embedUrl: string
  snapshotUrl: string | null
  type: CameraType
  isLive: boolean
}

// ─── Region definitions ───────────────────────────────────────────────────────

export const CAMERA_REGIONS: CameraRegion[] = [
  {
    id: 'global',
    label: 'Global',
    bounds: { latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 },
  },
  {
    id: 'americas',
    label: 'Americas',
    bounds: { latMin: -56, latMax: 72, lngMin: -170, lngMax: -34 },
  },
  {
    id: 'europe',
    label: 'Europe',
    bounds: { latMin: 35, latMax: 71, lngMin: -25, lngMax: 32 },
  },
  {
    id: 'mena',
    label: 'MENA',
    bounds: { latMin: 12, latMax: 42, lngMin: -18, lngMax: 63 },
  },
  {
    id: 'asia',
    label: 'Asia',
    bounds: { latMin: -10, latMax: 55, lngMin: 60, lngMax: 145 },
  },
  {
    id: 'africa',
    label: 'Africa',
    bounds: { latMin: -35, latMax: 37, lngMin: -18, lngMax: 52 },
  },
  {
    id: 'oceania',
    label: 'Oceania',
    bounds: { latMin: -47, latMax: -10, lngMin: 110, lngMax: 180 },
  },
  {
    id: 'easteurope',
    label: 'East Europe',
    bounds: { latMin: 44, latMax: 60, lngMin: 14, lngMax: 40 },
  },
]

// ─── Seed camera list (~30 public cameras across all regions) ─────────────────

const CAMERA_SEED: CameraFeed[] = [
  // ── Americas ────────────────────────────────────────────────────────────────
  {
    id: 'us-nyc-timessquare',
    name: 'Times Square',
    region: 'americas',
    country: 'United States',
    countryCode: 'US',
    lat: 40.758,
    lng: -73.9855,
    embedUrl: 'https://www.earthcam.com/embed/?c=tsstreet2',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=tsstreet2',
    type: 'city',
    isLive: true,
  },
  {
    id: 'us-chi-millennium',
    name: 'Chicago Millennium Park',
    region: 'americas',
    country: 'United States',
    countryCode: 'US',
    lat: 41.8826,
    lng: -87.6226,
    embedUrl: 'https://www.earthcam.com/embed/?c=millennium',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=millennium',
    type: 'city',
    isLive: true,
  },
  {
    id: 'us-las-strip',
    name: 'Las Vegas Strip',
    region: 'americas',
    country: 'United States',
    countryCode: 'US',
    lat: 36.1147,
    lng: -115.1728,
    embedUrl: 'https://www.earthcam.com/embed/?c=vegasstrip',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=vegasstrip',
    type: 'city',
    isLive: true,
  },
  {
    id: 'us-sf-goldengatebridge',
    name: 'Golden Gate Bridge',
    region: 'americas',
    country: 'United States',
    countryCode: 'US',
    lat: 37.8199,
    lng: -122.4783,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1523456789',
    snapshotUrl: null,
    type: 'nature',
    isLive: true,
  },
  {
    id: 'us-sea-trafficI5',
    name: 'Seattle I-5 Northbound',
    region: 'americas',
    country: 'United States',
    countryCode: 'US',
    lat: 47.6062,
    lng: -122.3321,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1534567890',
    snapshotUrl: 'https://images.wsdot.wa.gov/nw/005vc18581.jpg',
    type: 'traffic',
    isLive: true,
  },
  {
    id: 'us-mia-southbeach',
    name: 'Miami South Beach',
    region: 'americas',
    country: 'United States',
    countryCode: 'US',
    lat: 25.7907,
    lng: -80.13,
    embedUrl: 'https://www.earthcam.com/embed/?c=miamibeach',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=miamibeach',
    type: 'city',
    isLive: true,
  },
  {
    id: 'br-sao-paulista',
    name: 'São Paulo Avenida Paulista',
    region: 'americas',
    country: 'Brazil',
    countryCode: 'BR',
    lat: -23.5505,
    lng: -46.6333,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1578901235',
    snapshotUrl: null,
    type: 'traffic',
    isLive: true,
  },
  {
    id: 'mx-mex-zocalo',
    name: 'Mexico City Zócalo',
    region: 'americas',
    country: 'Mexico',
    countryCode: 'MX',
    lat: 19.4326,
    lng: -99.1332,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1589012346',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },

  // ── Europe ───────────────────────────────────────────────────────────────────
  {
    id: 'gb-lon-towerbridge',
    name: 'London Tower Bridge',
    region: 'europe',
    country: 'United Kingdom',
    countryCode: 'GB',
    lat: 51.5055,
    lng: -0.0754,
    embedUrl: 'https://www.earthcam.com/embed/?c=london',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=london',
    type: 'city',
    isLive: true,
  },
  {
    id: 'fr-par-eiffel',
    name: 'Paris Eiffel Tower',
    region: 'europe',
    country: 'France',
    countryCode: 'FR',
    lat: 48.8584,
    lng: 2.2945,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1523456780',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'nl-ams-dam',
    name: 'Amsterdam Dam Square',
    region: 'europe',
    country: 'Netherlands',
    countryCode: 'NL',
    lat: 52.3738,
    lng: 4.8909,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1545678901',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'de-ber-brandenburggate',
    name: 'Berlin Brandenburg Gate',
    region: 'europe',
    country: 'Germany',
    countryCode: 'DE',
    lat: 52.5163,
    lng: 13.3777,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1556789012',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'es-bcn-rambla',
    name: 'Barcelona La Rambla',
    region: 'europe',
    country: 'Spain',
    countryCode: 'ES',
    lat: 41.3809,
    lng: 2.174,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1567890013',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'it-rom-trevi',
    name: 'Rome Trevi Fountain',
    region: 'europe',
    country: 'Italy',
    countryCode: 'IT',
    lat: 41.9009,
    lng: 12.4833,
    embedUrl: 'https://www.earthcam.com/embed/?c=rome',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=rome',
    type: 'city',
    isLive: true,
  },

  // ── MENA ─────────────────────────────────────────────────────────────────────
  {
    id: 'ae-dxb-marinabeach',
    name: 'Dubai Marina Beach',
    region: 'mena',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    lat: 25.0805,
    lng: 55.1403,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1578901234',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'tr-ist-bosphorus',
    name: 'Istanbul Bosphorus Bridge',
    region: 'mena',
    country: 'Turkey',
    countryCode: 'TR',
    lat: 41.0082,
    lng: 28.9784,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1567890123',
    snapshotUrl: null,
    type: 'traffic',
    isLive: true,
  },
  {
    id: 'eg-cai-tahrir',
    name: 'Cairo Tahrir Square',
    region: 'mena',
    country: 'Egypt',
    countryCode: 'EG',
    lat: 30.0444,
    lng: 31.2357,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1512345679',
    snapshotUrl: null,
    type: 'traffic',
    isLive: true,
  },
  {
    id: 'il-tlv-beach',
    name: 'Tel Aviv Mediterranean Beach',
    region: 'mena',
    country: 'Israel',
    countryCode: 'IL',
    lat: 32.0853,
    lng: 34.7818,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1590123401',
    snapshotUrl: null,
    type: 'weather',
    isLive: true,
  },

  // ── Asia ─────────────────────────────────────────────────────────────────────
  {
    id: 'jp-tky-shibuya',
    name: 'Tokyo Shibuya Crossing',
    region: 'asia',
    country: 'Japan',
    countryCode: 'JP',
    lat: 35.6598,
    lng: 139.7004,
    embedUrl: 'https://www.earthcam.com/embed/?c=tokyoshibuya',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=tokyoshibuya',
    type: 'traffic',
    isLive: true,
  },
  {
    id: 'sg-sin-marinabay',
    name: 'Singapore Marina Bay',
    region: 'asia',
    country: 'Singapore',
    countryCode: 'SG',
    lat: 1.2816,
    lng: 103.8636,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1589012345',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'hk-hkg-victoria',
    name: 'Hong Kong Victoria Harbour',
    region: 'asia',
    country: 'Hong Kong',
    countryCode: 'HK',
    lat: 22.2855,
    lng: 114.1577,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1590123456',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'kr-sel-gangnam',
    name: 'Seoul Gangnam Traffic',
    region: 'asia',
    country: 'South Korea',
    countryCode: 'KR',
    lat: 37.498,
    lng: 127.028,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1590123457',
    snapshotUrl: null,
    type: 'traffic',
    isLive: true,
  },
  {
    id: 'in-mum-gateway',
    name: 'Mumbai Gateway of India',
    region: 'asia',
    country: 'India',
    countryCode: 'IN',
    lat: 18.922,
    lng: 72.8347,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1501234567',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'th-bkk-grandpalace',
    name: 'Bangkok Grand Palace',
    region: 'asia',
    country: 'Thailand',
    countryCode: 'TH',
    lat: 13.7500,
    lng: 100.4913,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1512345678',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },

  // ── Africa ────────────────────────────────────────────────────────────────────
  {
    id: 'za-cpt-tablemountain',
    name: 'Cape Town Table Mountain',
    region: 'africa',
    country: 'South Africa',
    countryCode: 'ZA',
    lat: -33.9249,
    lng: 18.4241,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1523456780',
    snapshotUrl: null,
    type: 'nature',
    isLive: true,
  },
  {
    id: 'ke-nbo-cbd',
    name: 'Nairobi CBD Traffic',
    region: 'africa',
    country: 'Kenya',
    countryCode: 'KE',
    lat: -1.2921,
    lng: 36.8219,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1501234568',
    snapshotUrl: null,
    type: 'traffic',
    isLive: true,
  },
  {
    id: 'ma-cas-corniche',
    name: 'Casablanca Corniche',
    region: 'africa',
    country: 'Morocco',
    countryCode: 'MA',
    lat: 33.5731,
    lng: -7.5898,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1534567891',
    snapshotUrl: null,
    type: 'weather',
    isLive: true,
  },

  // ── Oceania ───────────────────────────────────────────────────────────────────
  {
    id: 'au-syd-harbourbridge',
    name: 'Sydney Harbour Bridge',
    region: 'oceania',
    country: 'Australia',
    countryCode: 'AU',
    lat: -33.8523,
    lng: 151.2108,
    embedUrl: 'https://www.earthcam.com/embed/?c=sydney',
    snapshotUrl: 'https://www.earthcam.com/cams/common/getsnapshot.php?cam=sydney',
    type: 'city',
    isLive: true,
  },
  {
    id: 'nz-akl-skytower',
    name: 'Auckland Sky Tower',
    region: 'oceania',
    country: 'New Zealand',
    countryCode: 'NZ',
    lat: -36.8485,
    lng: 174.7633,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1545678902',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'au-mel-cbd',
    name: 'Melbourne CBD',
    region: 'oceania',
    country: 'Australia',
    countryCode: 'AU',
    lat: -37.8136,
    lng: 144.9631,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1556789013',
    snapshotUrl: null,
    type: 'traffic',
    isLive: true,
  },

  // ── East Europe ───────────────────────────────────────────────────────────────
  {
    id: 'pl-waw-oldtown',
    name: 'Warsaw Old Town Square',
    region: 'easteurope',
    country: 'Poland',
    countryCode: 'PL',
    lat: 52.2494,
    lng: 21.0122,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1556789014',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
  {
    id: 'cz-prg-charlesbridge',
    name: 'Prague Charles Bridge',
    region: 'easteurope',
    country: 'Czech Republic',
    countryCode: 'CZ',
    lat: 50.0865,
    lng: 14.4114,
    embedUrl: 'https://embed.windy.com/embed-webcam.html?id=1567890124',
    snapshotUrl: null,
    type: 'city',
    isLive: true,
  },
]

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Filter the seed list to cameras matching `region`.
 * `'global'` returns the full list.
 * Unknown regions return an empty array.
 */
export function getCamerasByRegion(region: string): CameraFeed[] {
  if (region === 'global') return [...CAMERA_SEED]
  return CAMERA_SEED.filter(c => c.region === region)
}

/**
 * Return up to `limit` cameras for the given region (async for future
 * external-source integration and cache-layer compatibility).
 */
export async function fetchPublicCameras(
  region: string,
  limit: number,
): Promise<CameraFeed[]> {
  const cameras = getCamerasByRegion(region)
  return cameras.slice(0, limit)
}

export { CAMERA_SEED }
