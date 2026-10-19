/**
 * Live cameras (Oct 19, 2026, Map Lab; Devon: "The cameras keep failing and
 * going to this wind website which has always been the problem since we
 * started this feature").
 *
 * The old list was 32 hand-written cameras: its Windy ids were made up
 * (1512345679, 1523456780 twice, ...), so "Open feed" showed Windy's wind map,
 * and EarthCam's players and pictures only work for EarthCam's partners. Now
 * every camera comes from a public road-camera service that publishes its own
 * list and current pictures, free and without a key:
 *
 *   London       Transport for London JamCams       api.tfl.gov.uk
 *   New York     NYC DOT traffic cameras            webcams.nyctmc.org
 *   Los Angeles  Caltrans District 7                cwwp2.dot.ca.gov
 *   Bay Area     Caltrans District 4                cwwp2.dot.ca.gov
 *   Finland      Fintraffic road weather cameras    tie.digitraffic.fi (CC BY 4.0)
 *   Hong Kong    Transport Department               data.gov.hk
 *   New Zealand  NZ Transport Agency                trafficnz.info
 *
 * Each list is read on the server at most every 6 hours and kept when a source
 * fails; cameras their source marks offline are left out. Pictures go through
 * our own GET /api/v1/cameras/:id/image (kept a minute), so browsers load only
 * our API, and a camera whose picture fails or hasn't changed for 6 hours is
 * hidden for an hour.
 */

import { redis } from '../db/redis'

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

/** A camera as the API lists it */
export interface CameraFeed {
  /** "<source>:<the source's own id>", e.g. "tfl:00002.00865" */
  id: string
  name: string
  region: string
  country: string
  countryCode: string
  /** Where it is: a borough, district or town */
  city: string
  lat: number
  lng: number
  /** Its current picture, through our API (the picture updates every few minutes) */
  snapshotUrl: string
  /** The source's own camera page (older pages opened it as "the feed") */
  embedUrl: string
  sourceName: string
  type: CameraType
  isLive: boolean
}

/** A camera as the server keeps it: the listing plus where its picture really is (never sent) */
export interface CameraEntry extends CameraFeed {
  image: string
}

/** One camera as a source's parser reads it */
export interface ParsedCamera {
  id: string
  name: string
  lat: number
  lng: number
  image: string
  city?: string
}

export interface CameraSource {
  key: string
  name: string
  /** The source's own page for its cameras */
  page: string
  /** Its list of cameras */
  list: string
  city: string
  country: string
  countryCode: string
  region: string
  type: CameraType
  /** A picture is only ever fetched from an address that starts with one of these */
  imagePrefixes: string[]
  headers?: Record<string, string>
  parse: (body: string) => ParsedCamera[]
}

// ─── Region definitions ───────────────────────────────────────────────────────

export const CAMERA_REGIONS: CameraRegion[] = [
  { id: 'global',     label: 'Global',      bounds: { latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 } },
  { id: 'americas',   label: 'Americas',    bounds: { latMin: -56, latMax: 72, lngMin: -170, lngMax: -34 } },
  { id: 'europe',     label: 'Europe',      bounds: { latMin: 35, latMax: 71, lngMin: -25, lngMax: 32 } },
  { id: 'mena',       label: 'MENA',        bounds: { latMin: 12, latMax: 42, lngMin: -18, lngMax: 63 } },
  { id: 'asia',       label: 'Asia',        bounds: { latMin: -10, latMax: 55, lngMin: 60, lngMax: 145 } },
  { id: 'africa',     label: 'Africa',      bounds: { latMin: -35, latMax: 37, lngMin: -18, lngMax: 52 } },
  { id: 'oceania',    label: 'Oceania',     bounds: { latMin: -47, latMax: -10, lngMin: 110, lngMax: 180 } },
  { id: 'easteurope', label: 'East Europe', bounds: { latMin: 44, latMax: 60, lngMin: 14, lngMax: 40 } },
]

// ─── Small helpers ────────────────────────────────────────────────────────────

export const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || 'https://api.world-pulse.io').replace(/\/+$/, '')
const USER_AGENT = 'WorldPulse/1.0 (+https://world-pulse.io)'
/** Every camera id: a source key and the source's own id */
export const CAMERA_ID = /^[a-z0-9-]{2,12}:[A-Za-z0-9._-]{1,80}$/
const MAX_PER_SOURCE = 1200

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : NaN
}

const onEarth = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

const round5 = (n: number) => Math.round(n * 1e5) / 1e5

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e] ?? '')
}

/** The text of the first <tag>…</tag> in an XML fragment */
function xmlText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return m ? decodeXml(m[1]).trim() : ''
}

/** One line, single spaces, at most 90 characters */
export function tidy(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)
}

export function cameraImageUrl(id: string): string {
  return `${API_PUBLIC_URL}/api/v1/cameras/${encodeURIComponent(id)}/image`
}

// ─── Parsers, one per source ─────────────────────────────────────────────────

/** TfL: [{id: "JamCams_00002.00865", commonName, lat, lon, additionalProperties: [{key, value}]}] */
export function parseTfl(body: string): ParsedCamera[] {
  const rows = JSON.parse(body) as Array<{
    id?: string; commonName?: string; lat?: number; lon?: number
    additionalProperties?: Array<{ key?: string; value?: string }>
  }>
  const out: ParsedCamera[] = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const props = new Map((r.additionalProperties ?? []).map(p => [String(p.key), String(p.value ?? '')]))
    if (props.get('available') !== 'true') continue
    out.push({
      id:    String(r.id ?? '').replace(/^JamCams_/, ''),
      name:  tidy(r.commonName),
      lat:   num(r.lat),
      lng:   num(r.lon),
      image: props.get('imageUrl') ?? '',
    })
  }
  return out
}

/** NYC DOT: [{id, name, latitude, longitude, area, isOnline: "true", imageUrl}] */
export function parseNyc(body: string): ParsedCamera[] {
  const rows = JSON.parse(body) as Array<{
    id?: string; name?: string; latitude?: number; longitude?: number
    area?: string; isOnline?: string | boolean; imageUrl?: string
  }>
  return (Array.isArray(rows) ? rows : [])
    .filter(r => String(r.isOnline) === 'true')
    .map(r => ({
      id:    String(r.id ?? ''),
      name:  tidy(r.name),
      lat:   num(r.latitude),
      lng:   num(r.longitude),
      image: String(r.imageUrl ?? ''),
      city:  r.area ? `${tidy(r.area)}, New York` : undefined,
    }))
}

/** Caltrans: {data: [{cctv: {inService, location: {locationName, nearbyPlace, latitude, longitude}, imageData: {static: {currentImageURL}}}}]} */
export function parseCaltrans(body: string): ParsedCamera[] {
  const d = JSON.parse(body) as {
    data?: Array<{ cctv?: {
      inService?: string
      location?: { locationName?: string; nearbyPlace?: string; latitude?: string; longitude?: string }
      imageData?: { static?: { currentImageURL?: string } }
    } }>
  }
  const out: ParsedCamera[] = []
  for (const row of d?.data ?? []) {
    const c = row?.cctv
    if (!c || c.inService !== 'true') continue
    const image = c.imageData?.static?.currentImageURL ?? ''
    // the picture's folder is the camera's lasting name (".../image/i110196avenue26offramp/i110196avenue26offramp.jpg")
    const folder = image.split('/').slice(-2, -1)[0] ?? ''
    out.push({
      id:    folder,
      name:  tidy(c.location?.locationName),
      lat:   num(c.location?.latitude),
      lng:   num(c.location?.longitude),
      image,
      city:  c.location?.nearbyPlace ? tidy(c.location.nearbyPlace) : undefined,
    })
  }
  return out
}

/**
 * A Finnish camera's name ("vt1_Espoo_Kehä_III": road, town, spot) as
 * "Kehä III (road 1)" in Espoo
 */
export function finnishName(raw: string): { name: string; city: string } {
  const parts = String(raw ?? '').split('_').map(s => s.trim()).filter(Boolean)
  const road = parts[0]?.match(/^(?:vt|kt|st|mt|yt)(\d+)$/i)
  const rest = road ? parts.slice(1) : parts
  const city = rest[0] ?? ''
  const spot = rest.slice(1).join(' ') || city
  return { name: tidy(road ? `${spot} (road ${road[1]})` : spot), city: tidy(city) }
}

/** Digitraffic: GeoJSON stations, each with presets (camera directions); the first preset still photographing */
export function parseDigitraffic(body: string): ParsedCamera[] {
  const d = JSON.parse(body) as {
    features?: Array<{
      geometry?: { coordinates?: number[] }
      properties?: { name?: string; collectionStatus?: string; presets?: Array<{ id?: string; inCollection?: boolean }> }
    }>
  }
  const out: ParsedCamera[] = []
  for (const f of d?.features ?? []) {
    const p = f.properties
    if (!p || p.collectionStatus !== 'GATHERING') continue
    const preset = (p.presets ?? []).find(x => x.inCollection && x.id)
    if (!preset?.id) continue
    const [lng, lat] = f.geometry?.coordinates ?? []
    const { name, city } = finnishName(p.name ?? '')
    out.push({ id: preset.id, name, city: city || undefined, lat: num(lat), lng: num(lng), image: `https://weathercam.digitraffic.fi/${preset.id}.jpg` })
  }
  return out
}

/** Hong Kong: <image-list><image><key/><district/><description/><latitude/><longitude/><url/></image>…</image-list> */
export function parseHongKong(body: string): ParsedCamera[] {
  const out: ParsedCamera[] = []
  for (const block of body.split('<image>').slice(1)) {
    const key = xmlText(block, 'key')
    const district = xmlText(block, 'district')
    out.push({
      id:    key,
      // "Aberdeen Praya Road near Fish Market [H429F]": without the code
      name:  tidy(xmlText(block, 'description').replace(/\s*\[[^\]]*\]\s*$/, '')),
      lat:   num(xmlText(block, 'latitude')),
      lng:   num(xmlText(block, 'longitude')),
      image: xmlText(block, 'url'),
      city:  district ? `${district}, Hong Kong` : undefined,
    })
  }
  return out
}

/** NZTA: <response><camera><id/><name/><latitude/><longitude/><offline/><underMaintenance/><imageUrl>/camera/714.jpg</imageUrl>… */
export function parseNewZealand(body: string): ParsedCamera[] {
  const out: ParsedCamera[] = []
  for (const raw of body.match(/<camera>[\s\S]*?<\/camera>/g) ?? []) {
    // the camera's own fields, without its journey's and region's (they have ids and names too)
    const region = raw.match(/<region>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/region>/)
    const own = raw
      .replace(/<journey>[\s\S]*?<\/journey>/g, '')
      .replace(/<journeyLeg>[\s\S]*?<\/journeyLeg>/g, '')
      .replace(/<region>[\s\S]*?<\/region>/g, '')
    if (xmlText(own, 'offline') === 'true' || xmlText(own, 'underMaintenance') === 'true') continue
    const path = xmlText(own, 'imageUrl')
    out.push({
      id:    xmlText(own, 'id'),
      name:  tidy(xmlText(own, 'name') || xmlText(own, 'description')),
      lat:   num(xmlText(own, 'latitude')),
      lng:   num(xmlText(own, 'longitude')),
      image: path.startsWith('/camera/') ? `https://www.trafficnz.info${path}` : path,
      city:  region ? tidy(decodeXml(region[1])) : undefined,
    })
  }
  return out
}

// ─── The sources ──────────────────────────────────────────────────────────────

export const CAMERA_SOURCES: CameraSource[] = [
  {
    key: 'tfl', name: 'Transport for London', page: 'https://tfl.gov.uk/traffic/status/',
    list: 'https://api.tfl.gov.uk/Place/Type/JamCam',
    city: 'London', country: 'United Kingdom', countryCode: 'GB', region: 'europe', type: 'traffic',
    imagePrefixes: ['https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/'],
    parse: parseTfl,
  },
  {
    key: 'nyc', name: 'NYC DOT', page: 'https://webcams.nyctmc.org/',
    list: 'https://webcams.nyctmc.org/api/cameras',
    city: 'New York', country: 'United States', countryCode: 'US', region: 'americas', type: 'traffic',
    imagePrefixes: ['https://webcams.nyctmc.org/api/cameras/'],
    parse: parseNyc,
  },
  {
    key: 'ca-la', name: 'Caltrans', page: 'https://quickmap.dot.ca.gov/',
    list: 'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json',
    city: 'Los Angeles', country: 'United States', countryCode: 'US', region: 'americas', type: 'traffic',
    imagePrefixes: ['https://cwwp2.dot.ca.gov/data/d7/cctv/image/'],
    parse: parseCaltrans,
  },
  {
    key: 'ca-sf', name: 'Caltrans', page: 'https://quickmap.dot.ca.gov/',
    list: 'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json',
    city: 'San Francisco Bay Area', country: 'United States', countryCode: 'US', region: 'americas', type: 'traffic',
    imagePrefixes: ['https://cwwp2.dot.ca.gov/data/d4/cctv/image/'],
    parse: parseCaltrans,
  },
  {
    key: 'fi', name: 'Fintraffic (Digitraffic, CC BY 4.0)', page: 'https://liikennetilanne.fintraffic.fi/',
    list: 'https://tie.digitraffic.fi/api/weathercam/v1/stations',
    city: 'Finland', country: 'Finland', countryCode: 'FI', region: 'europe', type: 'weather',
    imagePrefixes: ['https://weathercam.digitraffic.fi/'],
    headers: { Accept: 'application/json', 'Digitraffic-User': 'WorldPulse/1.0' },
    parse: parseDigitraffic,
  },
  {
    key: 'hk', name: 'Hong Kong Transport Department', page: 'https://www.hkemobility.gov.hk/',
    list: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml',
    city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK', region: 'asia', type: 'traffic',
    imagePrefixes: ['https://tdcctv.data.one.gov.hk/'],
    parse: parseHongKong,
  },
  {
    key: 'nz', name: 'NZ Transport Agency', page: 'https://www.journeys.nzta.govt.nz/traffic-cameras',
    list: 'https://trafficnz.info/service/traffic/rest/4/cameras/all',
    city: 'New Zealand', country: 'New Zealand', countryCode: 'NZ', region: 'oceania', type: 'traffic',
    imagePrefixes: ['https://www.trafficnz.info/camera/'],
    parse: parseNewZealand,
  },
]

/** A source's parsed cameras as entries: real places, pictures only from the source's own addresses, no repeats */
export function toEntries(src: CameraSource, rows: ParsedCamera[]): CameraEntry[] {
  const seen = new Set<string>()
  const out: CameraEntry[] = []
  for (const r of rows) {
    if (!r.id || !r.name || !onEarth(r.lat, r.lng)) continue
    if (!src.imagePrefixes.some(p => r.image.startsWith(p))) continue
    const id = `${src.key}:${r.id}`
    if (!CAMERA_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push({
      id, name: r.name, region: src.region, country: src.country, countryCode: src.countryCode,
      city: r.city || src.city, lat: round5(r.lat), lng: round5(r.lng),
      snapshotUrl: cameraImageUrl(id), embedUrl: src.page, sourceName: src.name,
      type: src.type, isLive: true, image: r.image,
    })
    if (out.length >= MAX_PER_SOURCE) break
  }
  return out
}

// ─── The directory: every source's cameras, kept on the server ───────────────

const DIR_KEY  = 'cameras:directory:v2'
const SRC_KEY  = (key: string) => `cameras:source:v2:${key}`
const DEAD_KEY = 'cameras:dead'
const KEEP_S   = 7 * 86_400
/** A source's list is read again after this */
export const DIRECTORY_MAX_AGE_MS = 6 * 3_600_000
const MEMO_MS = 5 * 60_000

let memo: { at: number; cameras: CameraEntry[]; byId: Map<string, CameraEntry> } | null = null
let building: Promise<CameraEntry[]> | null = null

function remember(cameras: CameraEntry[]): CameraEntry[] {
  memo = { at: Date.now(), cameras, byId: new Map(cameras.map(c => [c.id, c])) }
  return cameras
}

/** One source's cameras, read from its own list now */
export async function readSource(src: CameraSource, fetchImpl: typeof fetch = fetch): Promise<CameraEntry[]> {
  const res = await fetchImpl(src.list, {
    headers: { 'User-Agent': USER_AGENT, ...src.headers },
    signal:  AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new Error(`${src.key}: HTTP ${res.status}`)
  return toEntries(src, src.parse(await res.text()))
}

/** Reads every source; one that fails keeps its last list */
export async function buildDirectory(fetchImpl: typeof fetch = fetch): Promise<CameraEntry[]> {
  const results = await Promise.allSettled(CAMERA_SOURCES.map(s => readSource(s, fetchImpl)))
  const all: CameraEntry[] = []
  for (const [i, result] of results.entries()) {
    const src = CAMERA_SOURCES[i]
    if (result.status === 'fulfilled' && result.value.length > 0) {
      all.push(...result.value)
      await redis.set(SRC_KEY(src.key), JSON.stringify(result.value), 'EX', KEEP_S).catch(() => {})
      continue
    }
    try {
      const old = await redis.get(SRC_KEY(src.key))
      if (old) all.push(...(JSON.parse(old) as CameraEntry[]))
    } catch { /* nothing kept for it */ }
  }
  if (all.length > 0) await redis.set(DIR_KEY, JSON.stringify({ at: Date.now(), cameras: all }), 'EX', KEEP_S).catch(() => {})
  return all
}

function rebuild(): Promise<CameraEntry[]> {
  if (!building) {
    building = buildDirectory()
      .then(cameras => (cameras.length > 0 ? remember(cameras) : (memo?.cameras ?? [])))
      .finally(() => { building = null })
  }
  return building
}

/** Every camera, from the kept directory (read again in the background after 6 hours) */
export async function cameraDirectory(): Promise<CameraEntry[]> {
  const now = Date.now()
  if (memo && now - memo.at < MEMO_MS) return memo.cameras
  let stored: { at: number; cameras: CameraEntry[] } | null = null
  try {
    const raw = await redis.get(DIR_KEY)
    if (raw) stored = JSON.parse(raw) as { at: number; cameras: CameraEntry[] }
  } catch { /* read the sources below */ }
  if (stored && Array.isArray(stored.cameras) && stored.cameras.length > 0) {
    if (now - Number(stored.at) > DIRECTORY_MAX_AGE_MS) void rebuild().catch(() => {})
    return remember(stored.cameras)
  }
  return rebuild()
}

async function findCamera(id: string): Promise<CameraEntry | null> {
  await cameraDirectory()
  return memo?.byId.get(id) ?? null
}

/** Cameras whose picture failed lately (until when, in ms) */
export async function deadCameras(now = Date.now()): Promise<Set<string>> {
  const dead = new Set<string>()
  try {
    const all = await redis.hgetall(DEAD_KEY)
    const over: string[] = []
    for (const [id, until] of Object.entries(all ?? {})) (Number(until) > now ? dead.add(id) : over.push(id))
    if (over.length > 0) await redis.hdel(DEAD_KEY, ...over)
  } catch { /* none known */ }
  return dead
}

export async function markDead(id: string, ms = 3_600_000): Promise<void> {
  try {
    await redis.multi().hset(DEAD_KEY, id, String(Date.now() + ms)).expire(DEAD_KEY, 86_400).exec()
  } catch { /* try again on the next failure */ }
}

/** Takes one camera from each source in turn, so a short list shows every city */
export function interleave<T extends { id: string }>(cameras: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const c of cameras) {
    const key = c.id.split(':')[0]
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }
  const lists = [...groups.values()]
  const out: T[] = []
  for (let i = 0; out.length < cameras.length; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i])
  }
  return out
}

/** The listing without where the picture really is */
export function publicFeed(c: CameraEntry): CameraFeed {
  const { image: _image, ...feed } = c
  return feed
}

function inBounds(c: { lat: number; lng: number }, b: CameraRegion['bounds']): boolean {
  return c.lat >= b.latMin && c.lat <= b.latMax && c.lng >= b.lngMin && c.lng <= b.lngMax
}

/** Up to `limit` live cameras in a region (by where they are), every city in turn */
export async function fetchPublicCameras(region: string, limit: number, type?: CameraType): Promise<CameraFeed[]> {
  const r = CAMERA_REGIONS.find(x => x.id === region)
  if (!r) return []
  const [all, dead] = await Promise.all([cameraDirectory(), deadCameras()])
  const live = all.filter(c => !dead.has(c.id) && (!type || c.type === type) && (region === 'global' || inBounds(c, r.bounds)))
  return interleave(live).slice(0, limit).map(publicFeed)
}

/** How many cameras each source gives, for the credits under the map */
export async function cameraSources(): Promise<Array<{ key: string; name: string; page: string; count: number }>> {
  const all = await cameraDirectory()
  return CAMERA_SOURCES.map(s => ({
    key: s.key, name: s.name, page: s.page,
    count: all.reduce((n, c) => n + (c.id.startsWith(`${s.key}:`) ? 1 : 0), 0),
  })).filter(s => s.count > 0)
}

// ─── Pictures ─────────────────────────────────────────────────────────────────

export interface CameraPicture {
  body: Buffer
  type: string
  /** When the source took it (its Last-Modified), when it says */
  at: string | null
}

export const PICTURE_CACHE_S = 60
const MAX_PICTURE_BYTES = 2_500_000
/** A picture older than this is a camera that stopped: hidden for an hour */
export const PICTURE_STALE_MS = 6 * 3_600_000
const PIC_KEY  = (id: string) => `cameras:pic:${id}`
const META_KEY = (id: string) => `cameras:picmeta:${id}`

/** A picture from a camera's own address: a JPEG/PNG/WebP/GIF of a sensible size, never via a redirect */
export async function fetchPicture(url: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<CameraPicture | null> {
  try {
    const res = await fetchImpl(url, {
      headers:  { 'User-Agent': USER_AGENT, Accept: 'image/*' },
      redirect: 'error',
      signal:   AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null
    if (Number(res.headers.get('content-length') ?? 0) > MAX_PICTURE_BYTES) return null
    const body = Buffer.from(await res.arrayBuffer())
    // a few hundred bytes is a "no picture" placeholder, not a camera view
    if (body.length < 1_000 || body.length > MAX_PICTURE_BYTES) return null
    const lm = Date.parse(res.headers.get('last-modified') ?? '')
    if (Number.isFinite(lm) && now - lm > PICTURE_STALE_MS) return null
    return { body, type, at: Number.isFinite(lm) ? new Date(lm).toISOString() : null }
  } catch {
    return null
  }
}

/** A camera's current picture: kept a minute; a camera without one is hidden for an hour */
export async function cameraPicture(id: string): Promise<CameraPicture | null> {
  if (!CAMERA_ID.test(id)) return null
  try {
    const [body, meta] = await Promise.all([redis.getBuffer(PIC_KEY(id)), redis.get(META_KEY(id))])
    if (body && meta) {
      const m = JSON.parse(meta) as { type: string; at: string | null }
      return { body, type: m.type, at: m.at }
    }
  } catch { /* fetch it below */ }
  const cam = await findCamera(id)
  if (!cam) return null
  const pic = await fetchPicture(cam.image)
  if (!pic) {
    await markDead(id)
    return null
  }
  await redis.multi()
    .set(PIC_KEY(id), pic.body, 'EX', PICTURE_CACHE_S)
    .set(META_KEY(id), JSON.stringify({ type: pic.type, at: pic.at }), 'EX', PICTURE_CACHE_S)
    .exec()
    .catch(() => {})
  return pic
}

/** For tests: forget the in-process copy */
export function resetCameraMemo(): void {
  memo = null
  building = null
}
