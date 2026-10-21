/**
 * The World Map's Satellites layer (plan M53, Oct 21, 2026; Devon: "Nice!"):
 * about 500 satellites in five of CelesTrak's groups, placed where they are
 * now. The API sends their orbital elements (GET /api/v1/map/satellites,
 * TLEs kept 6 hours); satellite.js (MIT, SGP4) works out each position in
 * the browser, again every few seconds while the layer is on.
 *
 * When the API has too few (Oct 21, 2026: celestrak.org didn't answer our
 * server), the browser asks CelesTrak itself (it allows that: its answers
 * carry Access-Control-Allow-Origin: *), and keeps each group two hours, as
 * CelesTrak asks.
 */

import type { OverlayFeature } from './map-overlays'

export type SatGroup = 'stations' | 'gnss' | 'weather' | 'resource' | 'military'

export interface SatTle { name: string; norad: number; group: SatGroup; tle1: string; tle2: string }

export const SAT_GROUP_LABEL: Record<SatGroup, string> = {
  stations: 'Space station',
  gnss:     'Navigation (GPS, Galileo, GLONASS, BeiDou)',
  weather:  'Weather',
  resource: 'Earth observation',
  military: 'Military',
}

export const SAT_GROUP_COLOR: Record<SatGroup, string> = {
  stations: '#f8fafc',
  gnss:     '#a5b4fc',
  weather:  '#7dd3fc',
  resource: '#86efac',
  military: '#fca5a5',
}

// The parts of satellite.js used here (loaded only when the layer is turned on)
type SatLib = typeof import('satellite.js')
type SatRec = ReturnType<SatLib['twoline2satrec']>

export interface PreparedSats {
  lib: SatLib
  sats: Array<{ satrec: SatRec; name: string; norad: number; group: SatGroup }>
}

function isGroup(v: unknown): v is SatGroup {
  return typeof v === 'string' && v in SAT_GROUP_LABEL
}

/** A TLE line: its number, a space, a 5-digit catalogue number, 69 characters in all (satellite.js reads garbage without a word) */
function isTleLine(line: string, n: 1 | 2): boolean {
  return line.length >= 68 && line.length <= 70 && new RegExp(`^${n} [0-9 ]{5}`).test(line)
}

/** The API's answer as satellites ready to place (bad elements are left out) */
export function prepareWith(lib: SatLib, json: unknown): PreparedSats {
  const list = (json as { satellites?: unknown })?.satellites
  const sats: PreparedSats['sats'] = []
  if (Array.isArray(list)) {
    for (const s of list as Array<Partial<SatTle>>) {
      if (typeof s?.tle1 !== 'string' || typeof s?.tle2 !== 'string' || !isGroup(s.group)) continue
      if (!isTleLine(s.tle1, 1) || !isTleLine(s.tle2, 2)) continue
      try {
        const satrec = lib.twoline2satrec(s.tle1, s.tle2)
        if (satrec.error) continue
        sats.push({ satrec, name: String(s.name ?? '').trim() || `NORAD ${s.norad}`, norad: Number(s.norad) || 0, group: s.group })
      } catch { /* a malformed element set: skip it */ }
    }
  }
  return { lib, sats }
}

const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php'
const GROUPS = Object.keys(SAT_GROUP_LABEL) as SatGroup[]
/** CelesTrak asks that the same data be fetched at most once every two hours: each browser keeps a group that long */
export const CELESTRAK_KEEP_MS = 2 * 60 * 60_000
/** Fewer than this from the API: ask CelesTrak from the browser */
const ENOUGH_FROM_API = 50

/** CelesTrak's three-line text (name, line 1, line 2) as element sets of one group */
export function parseTleText(text: string, group: SatGroup): SatTle[] {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean)
  const out: SatTle[] = []
  let i = 0
  while (i + 2 < lines.length) {
    const [name, tle1, tle2] = [lines[i], lines[i + 1], lines[i + 2]]
    if (!isTleLine(tle1, 1) || !isTleLine(tle2, 2)) { i += 1; continue }
    const norad = Number(tle1.slice(2, 7).trim())
    if (Number.isFinite(norad) && norad > 0) out.push({ name: name.trim(), norad, group, tle1, tle2 })
    i += 3
  }
  return out
}

export interface KeptStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

function browserStore(): KeptStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** One group from CelesTrak: this browser's copy while under two hours old, else a fresh one */
export async function celestrakGroup(group: SatGroup, fetchImpl: typeof fetch, store: KeptStore | null = browserStore(), now = Date.now()): Promise<SatTle[]> {
  const key = `wp:celestrak:${group}:v1`
  try {
    const kept = JSON.parse(store?.getItem(key) ?? 'null') as { at?: unknown; text?: unknown } | null
    if (kept && typeof kept.at === 'number' && typeof kept.text === 'string' && now - kept.at >= 0 && now - kept.at < CELESTRAK_KEEP_MS) {
      const list = parseTleText(kept.text, group)
      if (list.length) return list
    }
  } catch { /* nothing kept, or storage blocked */ }
  const res = await fetchImpl(`${CELESTRAK_GP}?GROUP=${group}&FORMAT=tle`)
  if (!res.ok) throw new Error(`CelesTrak ${group}: HTTP ${res.status}`)
  const text = await res.text()
  const list = parseTleText(text, group)
  if (list.length) { try { store?.setItem(key, JSON.stringify({ at: now, text })) } catch { /* storage full or blocked */ } }
  return list
}

/** The five groups from CelesTrak, each satellite once (the first group listed wins); a group that doesn't answer is left out */
export async function celestrakSatellites(fetchImpl: typeof fetch, store: KeptStore | null = browserStore()): Promise<SatTle[]> {
  const lists = await Promise.all(GROUPS.map(g => celestrakGroup(g, fetchImpl, store).catch(() => [] as SatTle[])))
  const seen = new Set<number>()
  const out: SatTle[] = []
  for (const list of lists) for (const s of list) {
    if (seen.has(s.norad)) continue
    seen.add(s.norad)
    out.push(s)
  }
  return out
}

/** The API's satellites, or, when it has fewer than 50, CelesTrak's straight to this browser */
export async function prepareSatellites(json: unknown, fetchImpl: typeof fetch = fetch, store: KeptStore | null = browserStore()): Promise<PreparedSats> {
  const lib = await import('satellite.js')
  const fromApi = prepareWith(lib, json)
  if (fromApi.sats.length >= ENOUGH_FROM_API) return fromApi
  const direct = prepareWith(lib, { satellites: await celestrakSatellites(fetchImpl, store).catch(() => [] as SatTle[]) })
  return direct.sats.length > fromApi.sats.length ? direct : fromApi
}

/** Where each satellite is at `now`: a point, its height (km) and speed (km/s) */
export function satellitePositions(prepared: PreparedSats, now: Date): OverlayFeature[] {
  const { lib, sats } = prepared
  const gmst = lib.gstime(now)
  const out: OverlayFeature[] = []
  for (const s of sats) {
    let pv: ReturnType<SatLib['propagate']> | false
    try { pv = lib.propagate(s.satrec, now) } catch { continue }
    // satellite.js answers false (or no position) when the orbit can't be worked out (decayed, bad elements)
    if (!pv || typeof pv.position !== 'object' || !pv.position) continue
    const geo = lib.eciToGeodetic(pv.position, gmst)
    const lat = lib.degreesLat(geo.latitude)
    const lng = lib.degreesLong(geo.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(geo.height)) continue
    const v = pv.velocity && typeof pv.velocity === 'object' ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : NaN
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Math.round(lng * 1e3) / 1e3, Math.round(lat * 1e3) / 1e3] },
      properties: {
        name: s.name, norad: s.norad, group: s.group, kind: SAT_GROUP_LABEL[s.group], color: SAT_GROUP_COLOR[s.group],
        km: Math.round(geo.height), kms: Number.isFinite(v) ? Math.round(v * 100) / 100 : null,
      },
    })
  }
  return out
}
