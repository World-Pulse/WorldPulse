/**
 * Two sea layers from NGA's Maritime Safety Information (Nov 22, 2026; Devon, 9:35 AM: "ok lets add them if they
 * make sense visually"). The US National Geospatial-Intelligence Agency's public API (msi.nga.mil/api/publications),
 * which NGA's own apps read; US government work, so no credit is asked. Like the earth feeds (earth-feeds.ts),
 * neither reads the database: each is NGA's own answer, made into points, kept in Redis and remade in the
 * background (lib/swr-cache.ts), so a reader never waits on NGA.
 *
 *   GET /api/v1/map/ship-attacks: NGA's Anti-Shipping Activity Messages (ASAM) of the last 12 months: piracy,
 *     armed robbery, boarding, hijacking and attacks on ships, each at its reported position. Fresh for 6 hours.
 *   GET /api/v1/map/sea-warnings: NGA's broadcast navigational warnings in force: missile and rocket launches,
 *     naval exercises and gunnery, mines, wrecks and drifting objects, cable and pipeline work, GPS interference.
 *     A warning gives its positions in its text ("26-34.00N 056-15.00E"): each is shown at the middle of the
 *     positions it names, and one naming none is left off the map. Fresh for an hour.
 *
 * NGA's service is down for maintenance at times (it answers 503, or hangs): the last answer is kept for days, and
 * with nothing kept a caller waits 20 seconds at most (lib/still-making.ts).
 */
import type { FastifyPluginAsync } from 'fastify'
import { staleWhileRevalidate } from '../../lib/swr-cache'
import { sendError } from '../../lib/errors'
import { StillMaking, sendStillMaking } from '../../lib/still-making'

const UA = 'WorldPulse/1.0 (+https://world-pulse.io; map layer, cached)'

export const ASAM_URL = 'https://msi.nga.mil/api/publications/asam?sort=date&output=json'
export const SEA_WARNINGS_URL = 'https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A'
export const NGA_SOURCE = "NGA Maritime Safety Information (msi.nga.mil), the US National Geospatial-Intelligence Agency's"
export const ASAM_DAYS = 365
export const ATTACKS_FRESH_SECONDS = 6 * 3_600
export const SEA_WARNINGS_FRESH_SECONDS = 3_600
/** NGA can hang: a read gets this long; an answer this big is refused */
export const NGA_FETCH_MS = 45_000
export const NGA_MAX_BYTES = 25_000_000
const TEXT_MAX = 700

export interface SeaFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, string | number | boolean | null>
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const round = (n: number) => Math.round(n * 1e4) / 1e4
const clip = (s: string | null, max: number) => (s && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

/** The records of an NGA answer: its `member` array, or the answer itself when it is the array */
function recordsOf(answer: unknown, member: string): unknown[] {
  if (Array.isArray(answer)) return answer
  const list = (answer as Record<string, unknown> | null)?.[member]
  return Array.isArray(list) ? list : []
}

// ─── Ship attacks (ASAM) ─────────────────────────────────────────────────────────────

/** NGA's ASAM records of the last `days` days with a real position, newest first; what was read, for the answer */
export function asamFeatures(answer: unknown, now = Date.now(), days = ASAM_DAYS): { features: SeaFeature[]; records: number; newest: string | null } {
  const records = recordsOf(answer, 'asam')
  const since = now - days * 86_400_000
  const features: SeaFeature[] = []
  for (const r of records) {
    if (!r || typeof r !== 'object') continue
    const a = r as Record<string, unknown>
    const lat = num(a.latitude), lng = num(a.longitude)
    const when = str(a.date) ? Date.parse(String(a.date)) : NaN
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue
    if (!Number.isFinite(when) || when < since || when > now + 86_400_000) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [round(lng), round(lat)] },
      properties: {
        reference: str(a.reference), date: new Date(when).toISOString().slice(0, 10),
        hostility: str(a.hostility), victim: str(a.victim), description: clip(str(a.description), TEXT_MAX),
        navArea: str(a.navArea), subreg: str(a.subreg) ?? (num(a.subreg) !== null ? String(num(a.subreg)) : null),
      },
    })
  }
  features.sort((x, y) => String(y.properties.date).localeCompare(String(x.properties.date)))
  return { features, records: records.length, newest: (features[0]?.properties.date as string | undefined) ?? null }
}

// ─── Navigational warnings (broadcast-warn) ─────────────────────────────────────────

/** NGA's areas by the codes its records carry: HYDROPAC is "P"; NAVAREA IV and XII by their numbers */
const AREA_NAMES: Record<string, string> = { P: 'HYDROPAC', '4': 'NAVAREA IV', '12': 'NAVAREA XII' }

/** "26-34.00N 056-15.00E", "26-34N 056-15E": degrees, minutes, hemisphere, as NGA writes positions */
const POSITION = /\b(\d{1,2})-(\d{1,2}(?:\.\d+)?)\s?([NS])\s*,?\s*(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s?([EW])\b/g

/** Every position a warning's text names, as [lng, lat] */
export function positionsIn(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const m of text.matchAll(POSITION)) {
    const latDeg = Number(m[1]), latMin = Number(m[2]), lngDeg = Number(m[4]), lngMin = Number(m[5])
    if (latMin >= 60 || lngMin >= 60 || latDeg > 90 || lngDeg > 180) continue
    const lat = (latDeg + latMin / 60) * (m[3] === 'S' ? -1 : 1)
    const lng = (lngDeg + lngMin / 60) * (m[6] === 'W' ? -1 : 1)
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    out.push([lng, lat])
  }
  return out
}

/** The middle of some positions; across the date line, measured the short way round */
export function middleOf(points: Array<[number, number]>): [number, number] | null {
  if (!points.length) return null
  const lngs = points.map(p => p[0])
  const wraps = Math.max(...lngs) - Math.min(...lngs) > 180
  let lng = lngs.reduce((s, x) => s + (wraps && x < 0 ? x + 360 : x), 0) / points.length
  if (lng > 180) lng -= 360
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length
  return [round(lng), round(lat)]
}

/** What a warning is about, from its words: the colour on the map */
export function warningKind(text: string): string {
  const t = text.toUpperCase()
  if (/\bMISSILE|\bROCKET|SPACE DEBRIS|LAUNCH/.test(t)) return 'launch'
  if (/\bMINE(S|FIELD|D)?\b|MINE DANGER|UNEXPLODED|ORDNANCE/.test(t)) return 'mines'
  if (/PIRACY|ARMED ROBBERY|HIJACK|ATTACK|HOSTILE/.test(t)) return 'attack'
  if (/GUNNERY|FIRING|EXERCISE|MILITARY|NAVAL OPERATIONS|LIVE FIRE/.test(t)) return 'military'
  if (/\bGNSS\b|\bGPS\b|JAMMING|INTERFERENCE/.test(t)) return 'gps'
  if (/\bCABLE|PIPELINE/.test(t)) return 'cable'
  if (/WRECK|DERELICT|ADRIFT|DRIFTING|DEBRIS|OBSTRUCTION|AGROUND|SUNKEN/.test(t)) return 'hazard'
  return 'other'
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** NGA's date-time group, "061306Z NOV 2026" (day, hour and minute, UTC), as an ISO time; null when it isn't one */
export function issuedAt(v: unknown): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{4})$/.exec(String(v ?? '').trim().toUpperCase())
  if (!m) return null
  const month = MONTHS.indexOf(m[4]!)
  const day = Number(m[1]), hour = Number(m[2]), minute = Number(m[3])
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  return new Date(Date.UTC(Number(m[5]), month, day, hour, minute)).toISOString()
}

/** NGA's warnings in force that name a position, each at the middle of its positions; what was read, for the answer */
export function seaWarningFeatures(answer: unknown): { features: SeaFeature[]; records: number; newest: string | null } {
  const records = recordsOf(answer, 'broadcast-warn')
  const features: SeaFeature[] = []
  for (const r of records) {
    if (!r || typeof r !== 'object') continue
    const w = r as Record<string, unknown>
    const text = str(w.text)
    if (!text) continue
    const points = positionsIn(text)
    const at = middleOf(points)
    if (!at) continue
    const area = str(w.navArea) ?? (num(w.navArea) !== null ? String(num(w.navArea)) : null)
    const number = num(w.msgNumber), year = num(w.msgYear)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: at },
      properties: {
        title: [area ? (AREA_NAMES[area] ?? `NGA area ${area}`) : 'NGA', number !== null && year !== null ? `${number}/${String(year).slice(-2)}` : null].filter(Boolean).join(' '),
        area, subregion: str(w.subregion), issued: issuedAt(w.issueDate), authority: str(w.authority),
        kind: warningKind(text), positions: points.length, text: clip(text, TEXT_MAX),
      },
    })
  }
  const issued = records.map(r => issuedAt((r as Record<string, unknown> | null)?.issueDate)).filter((t): t is string => t !== null).sort()
  return { features, records: records.length, newest: issued.at(-1) ?? null }
}

async function fetchNga(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(NGA_FETCH_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > NGA_MAX_BYTES) throw new Error(`answer of ${text.length} characters`)
  return JSON.parse(text)
}

export const registerSeaFeedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ship-attacks', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['map'],
      summary: "Piracy, robbery and attacks on ships in the last 12 months, from NGA's Anti-Shipping Activity Messages (public, no auth required)",
      description: 'GeoJSON points: each ASAM record of the last 12 months at its reported position, newest first, with its reference, date, who attacked (hostility), the ship (victim) and what happened. From NGA Maritime Safety Information (US government), kept 6 hours.',
    },
  }, async (_req, reply) => {
    try {
      const data = await staleWhileRevalidate('map:ship-attacks:v1', { freshSeconds: ATTACKS_FRESH_SECONDS, staleSeconds: 3 * 86_400, lockSeconds: 120, waitSeconds: 20 },
        async () => asamFeatures(await fetchNga(ASAM_URL)))
      void reply.header('Cache-Control', 'public, max-age=600')
      return reply.send({ success: true, source: `${NGA_SOURCE} Anti-Shipping Activity Messages`, read: { records: data.records, newest: data.newest }, type: 'FeatureCollection', features: data.features })
    } catch (err) {
      if (err instanceof StillMaking) return sendStillMaking(reply, "NGA's ship attack reports are being read")
      app.log.warn({ err: String(err), layer: 'ship-attacks' }, 'map sea feed: NGA failed and nothing was kept')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'NGA did not answer; try again in a few minutes')
    }
  })

  app.get('/sea-warnings', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['map'],
      summary: "Navigational warnings in force at sea, from NGA's broadcast warnings (public, no auth required)",
      description: 'GeoJSON points: each warning in force that names a position, at the middle of the positions in its text, with its title (area and number), when it was issued, what it is about (kind: launch, mines, attack, military, gps, cable, hazard or other) and its text. From NGA Maritime Safety Information (US government), kept an hour.',
    },
  }, async (_req, reply) => {
    try {
      const data = await staleWhileRevalidate('map:sea-warnings:v1', { freshSeconds: SEA_WARNINGS_FRESH_SECONDS, staleSeconds: 86_400, lockSeconds: 120, waitSeconds: 20 },
        async () => seaWarningFeatures(await fetchNga(SEA_WARNINGS_URL)))
      void reply.header('Cache-Control', 'public, max-age=300')
      return reply.send({ success: true, source: `${NGA_SOURCE} broadcast navigational warnings`, read: { records: data.records, newest: data.newest }, type: 'FeatureCollection', features: data.features })
    } catch (err) {
      if (err instanceof StillMaking) return sendStillMaking(reply, "NGA's navigational warnings are being read")
      app.log.warn({ err: String(err), layer: 'sea-warnings' }, 'map sea feed: NGA failed and nothing was kept')
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'NGA did not answer; try again in a few minutes')
    }
  })
}
