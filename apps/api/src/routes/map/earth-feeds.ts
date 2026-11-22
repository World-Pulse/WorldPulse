/**
 * Two World Map layers from free public feeds that update themselves (Nov 22, 2026; Devon, Nov 21, 11:14 PM: "lets
 * try to add more map layers where it makes sense and is free and automated right now"). Neither reads the database:
 * each is the source's own answer, kept in Redis and remade in the background (lib/swr-cache.ts), so a reader never
 * waits on the source and the server stays light (it was overloaded that night).
 *
 *   GET /api/v1/map/storms: NASA EONET's open events (eonet.gsfc.nasa.gov/api/v3; NASA, public domain; EONET says it
 *     "should not be regarded as an official source for precise spatial or temporal data"): tropical cyclones with
 *     their tracks (from JTWC and NHC), floods, landslides, dust storms, droughts, heat and cold waves, heavy snow and
 *     man-made events. Earthquakes, volcanoes and wildfires are left out: the Natural hazards layer has them. Fresh
 *     for 30 minutes.
 *   GET /api/v1/map/aurora: NOAA SWPC's OVATION aurora forecast (services.swpc.noaa.gov; public domain): the chance of
 *     aurora overhead in the next 30 to 90 minutes on a 1-degree grid, kept where it is 10% or more, on a 2-degree
 *     grid (the highest chance of each 2 x 2 cell, at the cell's middle). Fresh for 15 minutes.
 *   GET /api/v1/map/satellite-maps: the Copernicus Emergency Management Service's Rapid Mapping activations of the last
 *     12 months (rapidmapping.emergency.copernicus.eu, its public list; free to reuse with the source named, "© European
 *     Union"): where the EU had satellites map a disaster, at each activation's middle, with a link to its maps.
 *     Fresh for an hour.
 */
import type { FastifyPluginAsync } from 'fastify'
import { staleWhileRevalidate } from '../../lib/swr-cache'
import { sendError } from '../../lib/errors'

const UA = 'WorldPulse/1.0 (+https://world-pulse.io; map layer, cached)'

export const EONET_CATEGORIES = ['severeStorms', 'floods', 'landslides', 'dustHaze', 'drought', 'tempExtremes', 'snow', 'manmade'] as const
export type EonetCategory = (typeof EONET_CATEGORIES)[number]
export const EONET_URL = `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&category=${EONET_CATEGORIES.join(',')}`
export const AURORA_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json'
export const CEMS_URL = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=100'
export const CEMS_SITE = 'https://rapidmapping.emergency.copernicus.eu'
export const CEMS_DAYS = 365
export const STORMS_FRESH_SECONDS = 30 * 60
export const AURORA_FRESH_SECONDS = 15 * 60
/** A storm's earlier positions shown as its track, at most */
export const TRACK_POINTS = 40
/** Aurora: the lowest chance kept, and the grid it is kept on (degrees) */
export const AURORA_MIN_CHANCE = 10
export const AURORA_CELL = 2

export interface EarthFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, string | number | boolean | null>
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const httpUrl = (v: unknown): string | null => {
  const s = str(v)
  if (!s) return null
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null } catch { return null }
}
const round = (n: number) => Math.round(n * 1e4) / 1e4

/** [lng, lat] if real coordinates */
function lngLat(lng: unknown, lat: unknown): [number, number] | null {
  const lo = num(lng), la = num(lat)
  if (lo === null || la === null || Math.abs(la) > 90 || Math.abs(lo) > 180) return null
  return [round(lo), round(la)]
}

/** A geometry's point: a Point's own, a Polygon's first ring's middle */
function pointOf(g: { type?: unknown; coordinates?: unknown } | null | undefined): [number, number] | null {
  if (!g) return null
  if (g.type === 'Point' && Array.isArray(g.coordinates)) return lngLat(g.coordinates[0], g.coordinates[1])
  if (g.type === 'Polygon' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
    const ring = (g.coordinates[0] as unknown[]).filter((p): p is unknown[] => Array.isArray(p))
    if (!ring.length) return null
    const lng = ring.reduce((s, p) => s + (num(p[0]) ?? 0), 0) / ring.length
    const lat = ring.reduce((s, p) => s + (num(p[1]) ?? 0), 0) / ring.length
    return lngLat(lng, lat)
  }
  return null
}

/**
 * EONET's events as points: each event at its newest position (now: true), and a storm's earlier positions too, as
 * its track (now: false), oldest first
 */
export function eonetFeatures(json: unknown): EarthFeature[] {
  const events = (json as { events?: unknown } | null)?.events
  if (!Array.isArray(events)) return []
  const out: EarthFeature[] = []
  for (const raw of events.slice(0, 400)) {
    const e = (raw ?? {}) as Record<string, unknown>
    const id = str(e.id), title = str(e.title)
    const category = Array.isArray(e.categories) ? str((e.categories[0] as { id?: unknown } | undefined)?.id) : null
    if (!id || !title || !category || !(EONET_CATEGORIES as readonly string[]).includes(category)) continue
    const source = (Array.isArray(e.sources) ? e.sources as Array<{ id?: unknown; url?: unknown }> : [])
      .map(s => ({ id: str(s?.id), url: httpUrl(s?.url) })).find(s => s.url) ?? null
    const points = (Array.isArray(e.geometry) ? e.geometry as Array<Record<string, unknown>> : [])
      .map(g => ({ at: str(g.date), at_ms: Date.parse(String(g.date)), c: pointOf(g as { type?: unknown; coordinates?: unknown }), kts: g.magnitudeUnit === 'kts' ? num(g.magnitudeValue) : null }))
      .filter((p): p is { at: string; at_ms: number; c: [number, number]; kts: number | null } => !!p.at && Number.isFinite(p.at_ms) && !!p.c)
      .sort((a, b) => a.at_ms - b.at_ms)
    if (!points.length) continue
    const base = { id, title, category, link: source?.url ?? null, source: source?.id ?? null }
    if (category === 'severeStorms') {
      for (const p of points.slice(-(TRACK_POINTS + 1), -1)) {
        out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p.c }, properties: { ...base, at: p.at, wind_kts: p.kts, now: false } })
      }
    }
    const last = points[points.length - 1]!
    out.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: last.c },
      properties: { ...base, at: last.at, wind_kts: last.kts, now: true, positions: points.length, since: points[0]!.at },
    })
  }
  return out
}

/** NOAA's OVATION grid ([longitude 0-359, latitude, chance]) as points where aurora is 10% likely or more, 2 degrees apart */
export function auroraFeatures(json: unknown, minChance = AURORA_MIN_CHANCE, cell = AURORA_CELL): { observed: string | null; forecast: string | null; features: EarthFeature[] } {
  const j = (json ?? {}) as Record<string, unknown>
  const forecast = str(j['Forecast Time'])
  const observed = str(j['Observation Time'])
  const grid = Array.isArray(j.coordinates) ? j.coordinates as unknown[] : []
  const best = new Map<string, { lng: number; lat: number; chance: number }>()
  for (const row of grid) {
    if (!Array.isArray(row)) continue
    const lon = num(row[0]), lat = num(row[1]), chance = num(row[2])
    if (lon === null || lat === null || chance === null || chance < minChance || chance > 100 || Math.abs(lat) > 90) continue
    const lng = lon > 180 ? lon - 360 : lon
    const cx = Math.floor(lng / cell), cy = Math.floor(lat / cell)
    const key = `${cx}:${cy}`
    const had = best.get(key)
    if (!had || chance > had.chance) best.set(key, { lng: (cx + 0.5) * cell, lat: Math.max(-89.9, Math.min(89.9, (cy + 0.5) * cell)), chance })
  }
  const features: EarthFeature[] = [...best.values()]
    .sort((a, b) => a.chance - b.chance)
    .map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [round(p.lng), round(p.lat)] }, properties: { chance: Math.round(p.chance), forecast } }))
  return { observed, forecast, features }
}

/** "POINT (lng lat)" as [lng, lat] */
function wktPoint(v: unknown): [number, number] | null {
  const m = /^\s*POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)\s*$/i.exec(String(v ?? ''))
  return m ? lngLat(m[1], m[2]) : null
}

/** A time the list gives without a zone ("2026-10-19T16:03:00") is UTC: written with its Z */
function utcIso(v: unknown): string | null {
  const t = str(v)
  if (!t) return null
  const z = /T\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(t) ? `${t}Z` : t
  const ms = Date.parse(z)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Copernicus EMS's Rapid Mapping activations of the last 12 months, newest first, each at its middle */
export function cemsFeatures(json: unknown, now = Date.now(), days = CEMS_DAYS): EarthFeature[] {
  const list = (json as { results?: unknown } | null)?.results
  if (!Array.isArray(list)) return []
  const out: EarthFeature[] = []
  for (const raw of list) {
    const a = (raw ?? {}) as Record<string, unknown>
    const code = str(a.code)
    const name = str(a.name)
    const at = wktPoint(a.centroid)
    const activated = utcIso(a.activationTime)
    const activatedMs = Date.parse(String(activated))
    if (!code || !/^EMSR\d+$/.test(code) || !name || !at || !activated || !Number.isFinite(activatedMs) || now - activatedMs > days * 86_400_000) continue
    const countries = Array.isArray(a.countries)
      ? (a.countries as unknown[]).map(c => (typeof c === 'string' ? c : str((c as { name?: unknown } | null)?.name))).filter((c): c is string => !!c)
      : str(a.countries) ? [str(a.countries)!] : []
    out.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: at },
      properties: {
        code, name, category: str(a.category), countries: countries.join(', ') || null,
        event_at: utcIso(a.eventTime), activated_at: activated, closed: a.closed === true,
        maps: num(a.n_products), link: `${CEMS_SITE}/${code}`,
      },
    })
  }
  return out
}

async function fetchJson(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const registerEarthFeedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/storms', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['map'],
      summary: "Storms, floods and other open events, from NASA's EONET (public, no auth required)",
      description: 'GeoJSON points: tropical cyclones at their newest position (now: true) with their earlier positions (now: false, at most 40), and floods, landslides, dust storms, droughts, heat and cold waves, heavy snow and man-made events at their newest. From NASA EONET (public domain), kept 30 minutes; not an official source for precise places or times.',
    },
  }, async (_req, reply) => {
    try {
      const features = await staleWhileRevalidate('map:storms:v1', { freshSeconds: STORMS_FRESH_SECONDS, staleSeconds: 24 * 3600, lockSeconds: 60 },
        async () => eonetFeatures(await fetchJson(EONET_URL)))
      void reply.header('Cache-Control', 'public, max-age=300')
      return reply.send({ success: true, source: 'NASA EONET (eonet.gsfc.nasa.gov)', type: 'FeatureCollection', features })
    } catch (err) {
      warnFeedFailed(app, err, 'storms')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'NASA EONET did not answer; try again in a few minutes')
    }
  })

  app.get('/aurora', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['map'],
      summary: "Where aurora is likely in the next 30 to 90 minutes, from NOAA's OVATION forecast (public, no auth required)",
      description: 'GeoJSON points 2 degrees apart where the chance of aurora overhead is 10% or more (chance, 10-100), with the forecast time. From NOAA SWPC (public domain), kept 15 minutes.',
    },
  }, async (_req, reply) => {
    try {
      const data = await staleWhileRevalidate('map:aurora:v1', { freshSeconds: AURORA_FRESH_SECONDS, staleSeconds: 6 * 3600, lockSeconds: 60 },
        async () => auroraFeatures(await fetchJson(AURORA_URL)))
      void reply.header('Cache-Control', 'public, max-age=300')
      return reply.send({ success: true, source: 'NOAA SWPC OVATION (swpc.noaa.gov)', forecast: data.forecast, observed: data.observed, type: 'FeatureCollection', features: data.features })
    } catch (err) {
      warnFeedFailed(app, err, 'aurora')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'NOAA did not answer; try again in a few minutes')
    }
  })
}

export const registerSatelliteMapRoute: FastifyPluginAsync = async (app) => {
  app.get('/satellite-maps', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['map'],
      summary: "Where the EU's Copernicus EMS mapped a disaster from satellites in the last 12 months (public, no auth required)",
      description: 'GeoJSON points: each Rapid Mapping activation of the last 12 months at its middle, with its code, name, kind of disaster, countries, when it was activated, whether it is closed and a link to its maps. From the Copernicus Emergency Management Service (© European Union), kept an hour.',
    },
  }, async (_req, reply) => {
    try {
      const features = await staleWhileRevalidate('map:satellite-maps:v1', { freshSeconds: 3600, staleSeconds: 24 * 3600, lockSeconds: 60 },
        async () => cemsFeatures(await fetchJson(CEMS_URL)))
      void reply.header('Cache-Control', 'public, max-age=600')
      return reply.send({ success: true, source: 'Copernicus Emergency Management Service (© European Union)', type: 'FeatureCollection', features })
    } catch (err) {
      warnFeedFailed(app, err, 'satellite-maps')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Copernicus EMS did not answer; try again in a few minutes')
    }
  })
}

function warnFeedFailed(app: { log: { warn: (o: object, m: string) => void } }, err: unknown, layer: string): void {
  app.log.warn({ err: String(err), layer }, 'map earth feed: source failed and nothing was kept')
}
